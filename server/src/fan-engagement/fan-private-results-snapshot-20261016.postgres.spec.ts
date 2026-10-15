import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { FanEngagementService } from './fan-engagement.service';

jest.setTimeout(90_000);
const COMMIT = 'df193e071499fb4f0e29faf868d586f69e7052ea';
const SERVICE_SHA = '571884698220314566879e7b90957403cbf5d54a7ea3672d73fa31e03fbeb808';
const MAX_BYTES = 50_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const native = process.env.RUN_FAN_PRIVATE_RESULTS_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
type Exclusions = Record<string, string[]>;
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type Preview = { visible: boolean; totalBallots: number;
  options: Array<{ id: string; ballotCount: number; ratio: number }> };
const settle = <T>(promise: Promise<T>): Promise<Outcome<T>> => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function same(left: unknown, right: unknown) {
  // Compare serialized SQL values, not cross-realm prototypes or structuredClone identities.
  return JSON.stringify(left) === JSON.stringify(right);
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(yes => { open = yes; });
  return { promise, open };
}
async function bounded<T>(promise: Promise<T>, ms = 8_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned fan snapshot gate timed out')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

native('fan private results snapshot postgres (actual SQL publication boundary)', () => {
  let setup: PrismaClient, observer: PrismaClient, caller: PrismaClient;
  let artistId: string;
  let initial: TableState[] | undefined, caseStart: TableState[] | undefined;
  const owned: Exclusions = { users: [], concept_votes: [], concept_vote_options: [], concept_vote_ballots: [] };
  let caseOwned: Exclusions = {};
  const voteIds = new Set<string>(), userIds = new Set<string>();
  function remember(table: string, id: string) {
    check(Object.prototype.hasOwnProperty.call(owned, table) && UUID.test(id), 'Exact additive owned row required');
    if (owned[table].includes(id)) return;
    check(owned[table].length < 16, 'Bounded additive fixture count required');
    owned[table].push(id);
    if (caseStart) (caseOwned[table] ??= []).push(id);
  }
  async function snapshot(exclude: Exclusions = {}): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded actual public table inventory required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog relation');
      const ids = exclude[relation] ?? [];
      check(ids.length <= 16 && ids.every(id => UUID.test(id)), 'Bounded exact UUID exclusions required');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const [row] = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(row && /^\d+$/.test(row.rows) && /^[a-f0-9]{32}$/.test(row.digest), 'Actual table JSON/xmin digest required');
      result.push({ relation, ...row });
    }
    return result;
  }
  async function bounds() {
    const [row] = await observer.$queryRaw<Array<{ bytes: string; readonly: boolean }>>`
      SELECT pg_database_size(current_database())::text AS bytes,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    check(row.readonly && Number(row.bytes) > 0 && Number(row.bytes) <= MAX_BYTES,
      'Read-only observer and fresh bounded database required');
  }
  async function noRewards() {
    check(await observer.fanMissionParticipation.count() === 0 && await observer.fanEngagementPointLedger.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'No mission participation, points, wallet, ledger or audit effects allowed');
  }
  async function user() {
    const id = randomUUID();
    await setup.user.create({ data: { id, status: 'active' } });
    remember('users', id); userIds.add(id); return id;
  }
  async function vote(optionCount: number) {
    check(optionCount === 1 || optionCount === 2, 'Bounded fixture options required');
    const id = randomUUID();
    await setup.conceptVote.create({ data: { id, artistId, status: 'active', visibility: 'public' } });
    remember('concept_votes', id); voteIds.add(id);
    const options: string[] = [];
    for (let index = 0; index < optionCount; index++) {
      const optionId = randomUUID();
      await setup.conceptVoteOption.create({ data: {
        id: optionId, voteId: id, optionKey: 'synthetic-' + index, sortOrder: index,
      } });
      remember('concept_vote_options', optionId); options.push(optionId);
    }
    return { id, options };
  }

  // Real included-row lookup, real transaction and real aggregate; no fabricated SQL result.
  function instrument() {
    const stats = { receiptReads: 0, voteReads: 0, transactionCalls: 0, rawAttempts: 0,
      rawSuccesses: 0, sqlFailures: 0, faults: 0, actualError: null as unknown };
    const control: { pause: null | { key: string; entered: ReturnType<typeof gate>;
      release: ReturnType<typeof gate>; used: boolean }; failNext: boolean } = { pause: null, failNext: false };
    function admit(value: unknown, message: string): asserts value {
      if (!value) { stats.faults++; throw new Error(message); }
    }
    const client = new Proxy(caller, { get(target, field) {
      if (field === 'conceptVoteBallot') return new Proxy(target.conceptVoteBallot, { get(model, member) {
        if (member !== 'findUnique') { stats.faults++; throw new Error('Only root ballot lookup is admitted'); }
        return async (args: Prisma.ConceptVoteBallotFindUniqueArgs) => {
          stats.receiptReads++;
          admit(object(args.where) && Object.keys(args.where).length === 1, 'One actual unique lookup required');
          const key = args.where.userId_idempotencyKey;
          const current = args.where.voteId_userId;
          admit((object(key) && typeof key.userId === 'string' && userIds.has(key.userId)
            && typeof key.idempotencyKey === 'string' && key.idempotencyKey.startsWith('fan-native-'))
            || (object(current) && typeof current.userId === 'string' && userIds.has(current.userId)
              && typeof current.voteId === 'string' && voteIds.has(current.voteId)), 'Only owned real ballot lookup required');
          admit(object(key) ? same(args.include, { vote: { include: { artist: true, options: true } }, option: true })
            : args.include === undefined, 'Original receipt inclusion shape required');
          const value = await model.findUnique(args);
          const pause = control.pause;
          if (pause && object(key) && key.idempotencyKey === pause.key && !pause.used) {
            pause.used = true;
            const loaded: unknown = value;
            admit(object(loaded) && object(loaded.vote) && loaded.vote.visibility === 'public',
              'Actual already-loaded public receipt required before withdrawal');
            pause.entered.open(); await bounded(pause.release.promise);
          }
          return value;
        };
      } });
      if (field === 'conceptVote') return new Proxy(target.conceptVote, { get(model, member) {
        if (member !== 'findUnique') { stats.faults++; throw new Error('Only original root vote lookup is admitted'); }
        return async (args: Prisma.ConceptVoteFindUniqueArgs) => {
          stats.voteReads++;
          admit(typeof args.where.id === 'string' && voteIds.has(args.where.id)
            && same(Object.keys(args).sort(), ['include', 'where'])
            && same(args.include, { artist: { select: { id: true, slug: true, displayName: true } }, options: true }),
          'Original owned vote/include query required');
          return model.findUnique(args);
        };
      } });
      if (field === '$transaction') return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => {
        stats.transactionCalls++;
        admit(typeof callback === 'function' && options === undefined, 'Original unmodified transaction callback/options required');
        return target.$transaction(tx => callback(tx), options);
      };
      if (field === '$queryRaw') return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        stats.rawAttempts++;
        const statement = Array.from(strings).join('$1').replace(/\s+/g, ' ').trim();
        admit(strings.length === 2 && values.length === 1 && typeof values[0] === 'string'
          && UUID.test(values[0]) && (voteIds.has(values[0]) || values[0] === missingVoteId)
          && statement === 'SELECT b.option_id AS "optionId", count(b.id)::bigint AS "ballotCount" ' +
            'FROM public.concept_votes v LEFT JOIN public.concept_vote_ballots b ON b.vote_id = v.id ' +
            "WHERE v.id = $1::uuid AND v.visibility = 'public' GROUP BY b.option_id ORDER BY b.option_id",
        'Exact single tagged publication/tally statement and bound owned UUID required');
        const fail = control.failNext; control.failNext = false;
        try {
          // Explicit negative seam: retain actual SQL, substitute one invalid synthetic bound UUID.
          const rows = await target.$queryRaw(strings, ...(fail ? ['not-a-uuid'] : values));
          admit(!fail, 'Injected actual SQL rejection must not become a successful result');
          stats.rawSuccesses++; return rows;
        } catch (error) {
          admit(fail && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010'
            && error.meta?.code === '22P02', 'Actual PostgreSQL invalid-UUID rejection required');
          stats.sqlFailures++; stats.actualError = error; throw error;
        }
      };
      stats.faults++; throw new Error('No unrelated root service operation is admitted');
    } });
    return { service: new FanEngagementService(client as unknown as PrismaService), stats, control };
  }
  const missingVoteId = randomUUID();
  type BallotResult = Awaited<ReturnType<FanEngagementService['submitConceptVoteBallot']>>;
  function receipt(result: BallotResult, expected: { id: string; voteId: string; optionId: string; createdAt: Date }, replay: boolean) {
    check(result.ballot.id === expected.id && result.ballot.voteId === expected.voteId
      && result.ballot.optionId === expected.optionId && result.ballot.createdAt instanceof Date
      && result.ballot.createdAt.getTime() === expected.createdAt.getTime()
      && result.viewer.hasVoted && result.viewer.selectedOptionId === expected.optionId
      && result.idempotentReplay === replay && result.missionParticipation === null
      && same(result.rewards, { pointsGranted: 0, achievementsGranted: [], titlesGranted: [], cashLike: false,
        luminaAmount: 0, settlementEligible: false, transferable: false }), 'Same own receipt and zero rewards required');
  }
  function preview(value: Preview | null, total: number, expected: Array<{ id: string; ballotCount: number; ratio: number }>) {
    check(value !== null && value.visible === true && value.totalBallots === total
      && same(value.options, [...expected].sort((a, b) => a.id.localeCompare(b.id))), 'Exact real public tally and separation required');
  }
  async function cast(seam: ReturnType<typeof instrument>, owner: string, target: { id: string; options: string[] }, option: number) {
    const input = { optionId: target.options[option], idempotencyKey: 'fan-native-' + randomUUID() };
    const result = await seam.service.submitConceptVoteBallot(owner, target.id, input);
    check(UUID.test(result.ballot.id), 'Actual persisted ballot identifier required');
    remember('concept_vote_ballots', result.ballot.id);
    const stored = await observer.conceptVoteBallot.findUnique({ where: { id: result.ballot.id } });
    check(stored !== null && stored.userId === owner && stored.voteId === target.id
      && stored.optionId === input.optionId && stored.idempotencyKey === input.idempotencyKey
      && stored.missionId === null, 'Actual additive ballot must bind owner, vote, option and key');
    receipt(result, stored, false); return { owner, target, input, stored };
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-fan-private-results-snapshot\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_fan_private_results_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.FAN_PRIVATE_RESULTS_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.FAN_PRIVATE_RESULTS_BASE_COMMIT === COMMIT
      && process.env.FAN_PRIVATE_RESULTS_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-fan-private-results-snapshot\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/fan-engagement/fan-private-results-snapshot-20261016.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.FAN_PRIVATE_RESULTS_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'fan-engagement.service.ts'))) === SERVICE_SHA,
    'Exact selected source and fresh owned loopback database required');
    check(Prisma.dmmf.datamodel.models.length === 174, 'Pinned SDK174 required');
    const write = new URL(url!); write.searchParams.set('connection_limit', '1'); write.searchParams.set('pool_timeout', '15');
    const read = new URL(write.toString()); read.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: read.toString() } } });
    caller = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    for (const db of [setup, observer, caller]) await db.$connect();
    const [identity] = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const [migrations] = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"`;
    check(identity.database === expected.split('/').at(-1) && identity.schema === 'public' && identity.port === '55432'
      && migrations.total === 103 && migrations.applied === 103, 'Owned schema103 identity required');
    check(await observer.user.count() === 0 && await observer.conceptVote.count() === 0
      && await observer.conceptVoteOption.count() === 0 && await observer.conceptVoteBallot.count() === 0,
    'Fresh private vote tables required');
    await noRewards();
    const artists = await observer.artist.findMany({ select: {
      id: true, slug: true, displayName: true, status: true, sortOrder: true, launchedAt: true,
    } });
    check(artists.length === 1 && UUID.test(artists[0].id) && artists[0].slug === 'oh-hyerin'
      && artists[0].displayName === String.fromCodePoint(0xc624, 0xd61c, 0xb9b0) && artists[0].status === 'active'
      && artists[0].sortOrder === 50 && artists[0].launchedAt?.toISOString() === '2026-04-27T00:00:00.000Z',
    'Only immutable migration public Artist seed may pre-exist');
    artistId = artists[0].id; await bounds(); initial = await snapshot();
  });
  beforeEach(async () => { if (initial) { caseOwned = {}; caseStart = await snapshot(); } });
  afterEach(async () => {
    if (!initial || !caseStart) return;
    check(same(await snapshot(caseOwned), caseStart), 'Every earlier fixture and original JSON/xmin row must remain unchanged');
    check(same(await snapshot(owned), initial), 'All initial table JSON/xmin rows must remain unchanged');
    await noRewards(); await bounds(); caseStart = undefined;
  });
  afterAll(async () => {
    for (const db of [caller, observer, setup]) if (db) await db.$disconnect();
    // Retain all additive rows and cluster files; the parent recipe alone owns normal PG stop.
  });

  it('FAN.PRIVATE.RESULTS.NATIVE.01 withdrawn loaded receipt hides tally while public zero and other votes stay separate', async () => {
    const a = await user(), b = await user(), c = await user();
    const primary = await vote(2), other = await vote(1), empty = await vote(2);
    const seam = instrument();
    const own = await cast(seam, a, primary, 0);
    await cast(seam, b, primary, 0); await cast(seam, c, primary, 1);
    const otherOwn = await cast(seam, a, other, 0); await cast(seam, b, other, 0);
    check(seam.stats.faults === 0 && seam.stats.transactionCalls === 5 && seam.stats.rawAttempts === 5
      && seam.stats.receiptReads === 10 && seam.stats.voteReads === 5,
      'All five initial ballots must run actual service transactions and aggregates');
    const pause = { key: own.input.idempotencyKey, entered: gate(), release: gate(), used: false };
    seam.control.pause = pause;
    const replay = settle(seam.service.submitConceptVoteBallot(a, primary.id, own.input));
    try {
      await bounded(pause.entered.promise);
      await setup.conceptVote.update({ where: { id: primary.id }, data: { visibility: 'private' } });
      check((await observer.conceptVote.findUnique({ where: { id: primary.id } }))?.visibility === 'private',
        'Real committed withdrawal must precede aggregate dispatch');
      const beforeReplay = await snapshot(); pause.release.open();
      const outcome = await bounded(replay);
      check(outcome.ok && seam.stats.faults === 0 && pause.used, 'Real retained own receipt must replay without fixture faults');
      receipt(outcome.value, own.stored, true);
      check(outcome.value.resultsPreview === null && Number(seam.stats.transactionCalls) === 5
        && Number(seam.stats.rawAttempts) === 6 && Number(seam.stats.receiptReads) === 11,
      'Private tally must be null without another ballot transaction');
      check(same(await snapshot(), beforeReplay), 'Withdrawal replay must change no row, including stored receipt or rewards');
    } finally { pause.release.open(); await bounded(replay); seam.control.pause = null; }
    await setup.conceptVote.update({ where: { id: primary.id }, data: { visibility: 'public', status: 'closed' } });
    const beforePublicReads = await snapshot();
    const publicReplay = await seam.service.submitConceptVoteBallot(a, primary.id, own.input);
    receipt(publicReplay, own.stored, true);
    preview(publicReplay.resultsPreview, 3, [
      { id: primary.options[0], ballotCount: 2, ratio: 66.7 }, { id: primary.options[1], ballotCount: 1, ratio: 33.3 },
    ]);
    const separate = await seam.service.submitConceptVoteBallot(a, other.id, otherOwn.input);
    receipt(separate, otherOwn.stored, true);
    preview(separate.resultsPreview, 2, [{ id: other.options[0], ballotCount: 2, ratio: 100 }]);
    // Zero/missing projections cannot have an own ballot receipt; call the actual private helper transparently.
    const project = seam.service as unknown as { resultsPreview(id: string): Promise<Preview | null> };
    preview(await project.resultsPreview(empty.id), 0, []);
    check(await observer.conceptVote.findUnique({ where: { id: missingVoteId } }) === null,
      'Missing projection identifier must actually be absent from SQL');
    check(await project.resultsPreview(missingVoteId) === null, 'Actually missing UUID must not publish an aggregate');
    check(seam.stats.faults === 0 && Number(seam.stats.transactionCalls) === 5
      && Number(seam.stats.rawAttempts) === 10 && seam.stats.rawSuccesses === 10 && seam.stats.sqlFailures === 0
      && Number(seam.stats.receiptReads) === 13 && Number(seam.stats.voteReads) === 5,
    'Exactly four explicit additional public/empty/missing statements and no write retry required');
    check(same(await snapshot(), beforePublicReads), 'All original and fixture rows must remain unchanged during explicit reads');
  });

  it('FAN.PRIVATE.RESULTS.NATIVE.02 actual aggregate SQL rejection preserves receipt and propagates once without retry', async () => {
    const owner = await user(), target = await vote(1), seam = instrument();
    const own = await cast(seam, owner, target, 0), before = await snapshot();
    seam.control.failNext = true;
    const rejected = await settle(seam.service.submitConceptVoteBallot(owner, target.id, own.input));
    check(seam.stats.faults === 0 && !seam.control.failNext && seam.stats.transactionCalls === 1
      && seam.stats.rawAttempts === 2 && seam.stats.rawSuccesses === 1 && seam.stats.sqlFailures === 1
      && seam.stats.receiptReads === 3 && seam.stats.voteReads === 1,
    'Exactly one actual failed root statement after stored receipt, with no automatic retry or new write');
    check(!rejected.ok && rejected.error === seam.stats.actualError
      && rejected.error instanceof Prisma.PrismaClientKnownRequestError && rejected.error.code === 'P2010'
      && rejected.error.meta?.code === '22P02', 'Same actual PostgreSQL rejection must propagate, not a fabricated empty result');
    check(same(await snapshot(), before), 'Failed read must not alter any stored receipt, earlier fixture, reward or table row');
    const explicit = await seam.service.submitConceptVoteBallot(owner, target.id, own.input);
    receipt(explicit, own.stored, true);
    preview(explicit.resultsPreview, 1, [{ id: target.options[0], ballotCount: 1, ratio: 100 }]);
    check(seam.stats.faults === 0 && Number(seam.stats.rawAttempts) === 3 && Number(seam.stats.rawSuccesses) === 2
      && Number(seam.stats.sqlFailures) === 1 && Number(seam.stats.transactionCalls) === 1
      && Number(seam.stats.receiptReads) === 4 && Number(seam.stats.voteReads) === 1,
    'Only the explicitly invoked later replay may issue another statement');
    check(same(await snapshot(), before), 'Explicit reconciliation must preserve every original and fixture JSON/xmin row');
  });
});

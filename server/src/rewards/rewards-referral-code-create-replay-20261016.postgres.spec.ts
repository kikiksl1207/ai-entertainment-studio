import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import type { UserReferralCode } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PrismaService } from '../prisma/prisma.service';
import { RewardsService } from './rewards.service';

jest.setTimeout(90_000);
const COMMIT = '7786386e848f4e36d29ebe93bf69a79fd369c2c6';
const SERVICE_SHA = '01e8eec812140492ac8c81d9ca81c15123714dac9cbb16f122fd8622262e5ec3';
const MAX_BYTES = 50_000_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CODE = /^LS-[A-F0-9]{10}$/;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const native = process.env.RUN_REFERRAL_CODE_CREATE_REPLAY_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
type Exclusions = Record<string, string[]>;
type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Result<T>> => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      timer = setTimeout(() => reject(new Error('Owned referral gate timed out')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

native('referral code create replay postgres (actual SQL unique conflicts)', () => {
  let setup: PrismaClient, observer: PrismaClient, first: PrismaClient, second: PrismaClient;
  let initial: TableState[] | undefined, caseStart: TableState[] | undefined;
  const owned: Exclusions = { users: [], user_referral_codes: [] };
  let caseOwned: Exclusions = {};
  const service = (db: unknown) => new RewardsService(db as PrismaService);
  function remember(table: string, id: string) {
    check(Object.prototype.hasOwnProperty.call(owned, table) && UUID.test(id), 'Exact owned row required');
    if (owned[table].includes(id)) return;
    check(owned[table].length < 16, 'Bounded additive fixture count required');
    owned[table].push(id);
    if (caseStart) (caseOwned[table] ??= []).push(id);
  }
  async function snapshot(exclude: Exclusions = {}): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded actual table inventory required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog relation');
      const ids = exclude[relation] ?? [];
      check(ids.length <= 16 && ids.every(id => UUID.test(id)), 'Bounded UUID exclusions required');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const [row] = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
      check(row && /^\d+$/.test(row.rows) && /^[a-f0-9]{32}$/.test(row.digest), 'Actual row digest required');
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
  async function user() {
    const id = randomUUID();
    await setup.user.create({ data: { id, status: 'active' } }); remember('users', id);
    return id;
  }
  function row(value: unknown): asserts value is UserReferralCode {
    check(object(value) && typeof value.id === 'string' && UUID.test(value.id)
      && typeof value.userId === 'string' && UUID.test(value.userId)
      && typeof value.code === 'string' && CODE.test(value.code)
      && value.status === 'active' && value.useCount === 0
      && value.createdAt instanceof Date && value.updatedAt instanceof Date,
    'Actual complete persisted referral row and original defaults required');
  }

  // Only gates/counters and the explicit competing-owner fixture INSERT are seams; all queries use real Prisma.
  function instrument(db: PrismaClient, userId: string, mode: 'winner' | 'loser' | 'code-collision', shared: {
    nullReads: number; bothNull: ReturnType<typeof gate>; winnerDone: ReturnType<typeof gate>;
    winner: UserReferralCode | null; candidates: string[]; collisionOwner?: string;
  }) {
    const stats = { activeReads: 0, ownerReads: 0, nullOwnerReads: 0, codeReads: 0,
      createAttempts: 0, actualCreates: 0, sqlP2002: 0, competingFixtureCreates: 0,
      faults: 0, sqlError: null as unknown, collisionRow: null as UserReferralCode | null };
    function admit(value: unknown, message: string): asserts value {
      if (!value) { stats.faults++; throw new Error(message); }
    }
    const client = new Proxy(db, { get(target, field) {
      if (field === 'user') return new Proxy(target.user, { get(model, member) {
        if (member !== 'findFirst') { stats.faults++; throw new Error('Only active-user lookup is admitted'); }
        return async (args: Prisma.UserFindFirstArgs) => {
          stats.activeReads++;
          admit(stats.activeReads === 1 && JSON.stringify(args) === JSON.stringify({
            where: { id: userId, status: 'active', deletedAt: null }, select: { id: true },
          }), 'Original caller-bound active-user lookup required');
          const value = await model.findFirst(args);
          admit(value?.id === userId, 'Actual owned active user required'); return value;
        };
      } });
      if (field === 'userReferralCode') return new Proxy(target.userReferralCode, { get(model, member) {
        if (member === 'findUnique') return async (args: Prisma.UserReferralCodeFindUniqueArgs) => {
          if (object(args.where) && Object.prototype.hasOwnProperty.call(args.where, 'userId')) {
            stats.ownerReads++;
            admit(stats.ownerReads <= 2 && JSON.stringify(args) === JSON.stringify({ where: { userId } }),
              'Only original-owner lookup and one recovery are admitted');
            const value = await model.findUnique(args);
            if (value === null) stats.nullOwnerReads++;
            if (stats.ownerReads === 1) {
              admit(value === null, 'Initial owner lookup must actually return null');
              if (mode !== 'code-collision') {
                shared.nullReads++;
                admit(shared.nullReads <= 2, 'Exactly two initial real null reads required');
                if (shared.nullReads === 2) shared.bothNull.open();
                await bounded(shared.bothNull.promise);
              }
            } else {
              admit(stats.sqlP2002 === 1, 'Recovery must follow an actual failed SQL create');
              if (mode === 'loser') {
                admit(shared.winner !== null && value?.id === shared.winner.id && value.userId === userId,
                  'Recovery must read the actual committed caller winner');
              } else admit(mode === 'code-collision' && value === null, 'No caller winner may be fabricated');
            }
            return value;
          }
          stats.codeReads++;
          admit(stats.codeReads === 1 && JSON.stringify(Object.keys(args).sort()) === '["select","where"]'
            && object(args.where) && Object.keys(args.where).join(',') === 'code'
            && typeof args.where.code === 'string' && CODE.test(args.where.code)
            && JSON.stringify(args.select) === '{"id":true}', 'Actual unchanged generator query required');
          const value = await model.findUnique(args);
          admit(value === null, 'First generated candidate must be actually unused'); return value;
        };
        if (member === 'create') return async (args: Prisma.UserReferralCodeCreateArgs) => {
          stats.createAttempts++;
          admit(stats.createAttempts === 1 && Object.keys(args).join(',') === 'data' && object(args.data)
            && JSON.stringify(Object.keys(args.data).sort()) === '["code","userId"]'
            && args.data.userId === userId && typeof args.data.code === 'string' && CODE.test(args.data.code),
          'Exactly one original create with actual generated code required');
          shared.candidates.push(args.data.code);
          if (mode === 'loser') await bounded(shared.winnerDone.promise);
          if (mode !== 'code-collision') admit(shared.nullReads === 2, 'Both real null reads must precede either create');
          if (mode === 'loser') admit(shared.winner !== null && shared.winner.code !== args.data.code,
            'Loser must conflict on owner, not generated code');
          if (mode === 'code-collision') {
            admit(typeof shared.collisionOwner === 'string' && UUID.test(shared.collisionOwner)
              && shared.collisionOwner !== userId, 'Explicit different-owner collision fixture required');
            stats.competingFixtureCreates++;
            const competing = await setup.userReferralCode.create({ data: {
              id: randomUUID(), userId: shared.collisionOwner, code: args.data.code,
            } });
            row(competing); stats.collisionRow = competing; remember('user_referral_codes', competing.id);
          }
          stats.actualCreates++;
          try {
            const created: unknown = await model.create(args);
            row(created); remember('user_referral_codes', created.id);
            admit(mode === 'winner', 'Only the selected winning create may succeed');
            shared.winner = created; return created;
          } catch (error) {
            admit(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
              'Actual known SQL unique rejection required');
            admit(error.meta?.modelName === 'UserReferralCode'
              && JSON.stringify(error.meta?.target) === JSON.stringify([mode === 'loser' ? 'user_id' : 'code']),
            'Exact SDK model and mapped unique target required');
            stats.sqlP2002++; stats.sqlError = error; throw error;
          } finally { if (mode === 'winner') shared.winnerDone.open(); }
        };
        stats.faults++; throw new Error('No other referral delegate operation is admitted');
      } });
      stats.faults++; throw new Error('No unrelated service delegate or transaction is admitted');
    } });
    return { client, stats };
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-referral-code-create-replay\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_referral_code_replay_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.REFERRAL_CODE_CREATE_REPLAY_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.REFERRAL_CODE_CREATE_REPLAY_BASE_COMMIT === COMMIT
      && process.env.REFERRAL_CODE_CREATE_REPLAY_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-referral-code-create-replay\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/rewards/rewards-referral-code-create-replay-20261016.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.REFERRAL_CODE_CREATE_REPLAY_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'rewards.service.ts'))) === SERVICE_SHA,
    'Exact source and fresh owned loopback database required');
    check(Prisma.dmmf.datamodel.models.length === 174, 'Pinned SDK174 required');
    const write = new URL(url!); write.searchParams.set('connection_limit', '1'); write.searchParams.set('pool_timeout', '15');
    const read = new URL(write.toString()); read.searchParams.set('options', '-c default_transaction_read_only=on');
    setup = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    observer = new PrismaClient({ datasources: { db: { url: read.toString() } } });
    first = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    second = new PrismaClient({ datasources: { db: { url: write.toString() } } });
    for (const db of [setup, observer, first, second]) await db.$connect();
    const [identity] = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const [migrations] = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"`;
    check(identity.database === expected.split('/').at(-1) && identity.schema === 'public' && identity.port === '55432'
      && migrations.total === 103 && migrations.applied === 103, 'Owned schema103 identity required');
    check(await observer.user.count() === 0 && await observer.userReferralCode.count() === 0
      && await observer.referralReward.count() === 0 && await observer.walletAccount.count() === 0
      && await observer.walletLedger.count() === 0 && await observer.auditEvent.count() === 0,
    'Fresh private/referral/financial tables required');
    check(await observer.artist.count() === 1 && await observer.artist.count({ where: {
      slug: 'oh-hyerin', displayName: String.fromCodePoint(0xc624, 0xd61c, 0xb9b0), status: 'active',
      sortOrder: 50, launchedAt: new Date('2026-04-27T00:00:00.000Z'),
    } }) === 1, 'Only immutable migration public Artist seed may pre-exist');
    await bounds(); initial = await snapshot();
  });
  beforeEach(async () => {
    if (!initial) return;
    caseOwned = {}; caseStart = await snapshot();
  });
  afterEach(async () => {
    if (!initial || !caseStart) return;
    check(JSON.stringify(await snapshot(caseOwned)) === JSON.stringify(caseStart),
      'Every earlier fixture and original JSON/xmin row must remain unchanged');
    check(JSON.stringify(await snapshot(owned)) === JSON.stringify(initial), 'All initial table rows must remain unchanged');
    check(await observer.referralReward.count() === 0 && await observer.walletAccount.count() === 0
      && await observer.walletLedger.count() === 0 && await observer.auditEvent.count() === 0,
    'No rewards, wallet, ledger or audit effects are admitted');
    await bounds(); caseStart = undefined;
  });
  afterAll(async () => {
    for (const db of [second, first, observer, setup]) if (db) await db.$disconnect();
    // Keep all additive rows and cluster files; only the parent wrapper owns normal PG stop.
  });

  it('REFERRAL.CODE.REPLAY.NATIVE.01 two real initial null reads recover the actual same-user SQL winner', async () => {
    const owner = await user(), before = await snapshot();
    const shared = { nullReads: 0, bothNull: gate(), winnerDone: gate(),
      winner: null as UserReferralCode | null, candidates: [] as string[] };
    const winner = instrument(first, owner, 'winner', shared), loser = instrument(second, owner, 'loser', shared);
    const tasks = [settle(service(winner.client).getOrCreateReferralCode(owner)),
      settle(service(loser.client).getOrCreateReferralCode(owner))];
    try {
      const outcomes = await bounded(Promise.all(tasks), 15_000);
      check(winner.stats.faults === 0 && loser.stats.faults === 0 && shared.nullReads === 2,
        'Both actual null lookups and all fixture admissions must be witnessed outside product catch');
      check(winner.stats.activeReads === 1 && loser.stats.activeReads === 1
        && winner.stats.ownerReads === 1 && loser.stats.ownerReads === 2
        && winner.stats.nullOwnerReads === 1 && loser.stats.nullOwnerReads === 1
        && winner.stats.codeReads === 1 && loser.stats.codeReads === 1
        && winner.stats.createAttempts === 1 && loser.stats.createAttempts === 1
        && winner.stats.actualCreates === 1 && loser.stats.actualCreates === 1
        && winner.stats.sqlP2002 === 0 && loser.stats.sqlP2002 === 1
        && winner.stats.competingFixtureCreates === 0 && loser.stats.competingFixtureCreates === 0,
      'One winner, one real unique rejection and exactly one caller recovery required');
      check(shared.candidates.length === 2 && new Set(shared.candidates).size === 2,
        'Independent actual code candidates must differ');
      check(outcomes[0].ok && outcomes[1].ok && shared.winner !== null, 'Both real service calls must return the winner');
      const rows = await observer.userReferralCode.findMany({ where: { userId: owner } });
      check(rows.length === 1 && rows[0].id === shared.winner.id && rows[0].userId === owner,
        'Exactly one persisted caller row required');
      check(JSON.stringify(outcomes[0].value) === JSON.stringify(rows[0])
        && JSON.stringify(outcomes[1].value) === JSON.stringify(rows[0]), 'Full returned row/defaults must equal actual SQL winner');
      check(JSON.stringify(await snapshot({ user_referral_codes: [rows[0].id] })) === JSON.stringify(before),
        'Only the one new code row may differ; all users and other JSON/xmin rows stay unchanged');
    } finally {
      shared.bothNull.open(); shared.winnerDone.open(); await bounded(Promise.all(tasks), 15_000);
    }
  });

  it('REFERRAL.CODE.REPLAY.NATIVE.02 actual other-owner code collision without caller row propagates once without effects', async () => {
    const owner = await user(), competingOwner = await user(), before = await snapshot();
    const shared = { nullReads: 0, bothNull: gate(), winnerDone: gate(),
      winner: null as UserReferralCode | null, candidates: [] as string[], collisionOwner: competingOwner };
    const seam = instrument(first, owner, 'code-collision', shared);
    const outcome = await settle(service(seam.client).getOrCreateReferralCode(owner));
    check(seam.stats.faults === 0 && seam.stats.activeReads === 1 && seam.stats.ownerReads === 2
      && seam.stats.nullOwnerReads === 2 && seam.stats.codeReads === 1 && seam.stats.createAttempts === 1
      && seam.stats.actualCreates === 1 && seam.stats.sqlP2002 === 1 && seam.stats.competingFixtureCreates === 1,
    'Real code-conflict failure and one empty caller reread must be exact outside product catch');
    check(!outcome.ok && outcome.error === seam.stats.sqlError
      && outcome.error instanceof Prisma.PrismaClientKnownRequestError && outcome.error.code === 'P2002',
    'The same actual SQL error must propagate, without a fabricated winner or create retry');
    const competing = seam.stats.collisionRow;
    check(competing !== null && await observer.userReferralCode.count({ where: { userId: owner } }) === 0,
      'No caller row may be created on failed statement');
    const actual = await observer.userReferralCode.findUnique({ where: { userId: competingOwner } });
    check(JSON.stringify(actual) === JSON.stringify(competing), 'Only explicit competing fixture INSERT may remain');
    check(JSON.stringify(await snapshot({ user_referral_codes: [competing.id] })) === JSON.stringify(before),
      'Failed original create changes no user/earlier row; only named additive competing fixture is excluded');
  });
});

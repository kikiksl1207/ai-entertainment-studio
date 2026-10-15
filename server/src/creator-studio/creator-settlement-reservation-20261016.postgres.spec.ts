import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CreatorStudioService } from './creator-studio.service';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(90_000);
const COMMIT = '1e95b4ea76a3406b9c7f07e701e6c24b3fbb762d';
const SERVICE_SHA = 'fa7f74098a9b2843a4e7cef92fe35c29570c0863f235ef2426387af991573108';
const MAX_BYTES = 50_000_000;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const native = process.env.RUN_SETTLEMENT_RESERVATION_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
type Exclusions = Record<string, string[]>;
type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };
type ConversionResult = Awaited<ReturnType<CreatorStudioService['createSettlementConversion']>>;
const settle = <T>(promise: Promise<T>): Promise<Result<T>> => promise.then(
  value => ({ ok: true as const, value }), error => ({ ok: false as const, error }),
);
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(yes => { open = yes; });
  return { promise, open };
}
async function bounded<T>(promise: Promise<T>, ms = 6_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Owned native gate timed out')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
function denied<T>(result: Result<T>, status: number, code?: string) {
  check(!result.ok, 'A rejected actual service call was required');
  check(result.error instanceof HttpException && result.error.getStatus() === status,
    'Exact actual HTTP exception status required');
  const response = result.error.getResponse();
  if (code) check(typeof response === 'object' && response !== null
    && (response as Record<string, unknown>).code === code, 'Exact existing exception code required');
}

native('settlement reservation postgres (actual preview and transaction advisory lock)', () => {
  let setup: PrismaClient, observer: PrismaClient, first: PrismaClient, second: PrismaClient;
  let initial: TableState[] | undefined;
  const owned: Exclusions = {
    users: [], artists: [], artist_operators: [], fan_letters: [], settlement_lumina_conversion_requests: [],
  };
  const config = { get() { throw new Error('Unexpected configuration access'); } } as unknown as ConfigService;
  const service = (db: unknown) => new CreatorStudioService(db as PrismaService, config);
  function remember(table: string, id: string) {
    check(Object.prototype.hasOwnProperty.call(owned, table) && /^[a-f0-9-]{36}$/.test(id)
      && owned[table].length < 24 && !owned[table].includes(id), 'Exact bounded owned row required');
    owned[table].push(id);
  }
  async function snapshot(exclude: Exclusions = {}): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded public table inventory required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog relation');
      const ids = exclude[relation] ?? [];
      check(ids.length <= 24 && ids.every(id => /^[a-f0-9-]{36}$/.test(id)), 'Bounded exact exclusions required');
      const where = ids.length ? ` WHERE t.id NOT IN (${ids.map((_, i) => `$${i + 1}::uuid`).join(',')})` : '';
      const [row] = await observer.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ` +
        `ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest FROM "public"."${relation}" t` + where, ...ids);
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
      'Owned read-only snapshot connection and database byte bound required');
  }
  async function fixture() {
    const user = randomUUID(), artist = randomUUID(), operator = randomUUID(), letter = randomUUID();
    await setup.user.create({ data: { id: user, status: 'active' } }); remember('users', user);
    await setup.artist.create({ data: { id: artist, slug: 'reservation-qa-' + artist,
      displayName: 'Owned reservation fixture', status: 'draft' } }); remember('artists', artist);
    await setup.artistOperator.create({ data: { id: operator, userId: user, artistId: artist,
      role: 'owner', status: 'active', revokedAt: null, permissions: ['settlement:read'] } });
    remember('artist_operators', operator);
    await setup.fanLetter.create({ data: { id: letter, senderUserId: user, artistId: artist,
      status: 'submitted', amountLumina: new Decimal(1000), body: 'Synthetic owned fixture, not a paid purchase',
      createdAt: new Date('2026-10-15T00:00:00.000Z') } }); remember('fan_letters', letter);
    const preview = await service(observer).getSettlementPreview(user, { period: '2026-10' });
    check(preview.items.length === 1 && preview.items[0].artist.id === artist
      && preview.totals.eventCount === 1 && preview.totals.grossLumina.equals(1000)
      && preview.totals.creatorShareKrw.greaterThan(7000) && preview.totals.creatorShareKrw.lessThan(7100),
    'Actual access/operator and full revenue preview must yield the synthetic fixture share');
    return { user, artist, operator, input: {
      settlementKey: 'partner:' + user + ':2026-10', amountKrw: '5000', idempotencyKey: randomUUID(),
    } };
  }

  // Delegates always call actual Prisma. Only scheduling, counters, and post-INSERT failure are injected.
  function instrument(db: PrismaClient, options: { pauseAfterSum?: boolean; failAfterCreate?: Error } = {}) {
    const aggregateReached = gate(), releaseAggregate = gate(), entered = gate();
    const stats = {
      transactions: 0, active: 0, rootDuringTx: 0, rawCalls: 0, lockScalars: 0, creates: 0,
      pid: 0, postCreateFailure: false, createdIds: [] as string[], sums: [] as Array<Decimal | null>,
      txReads: {} as Record<string, number>, rootReads: {} as Record<string, number>,
    };
    const delegates = new Set(['artistOperator', 'chatFeatureOrder', 'giftOrder', 'artistBoostEvent',
      'userPremiumVideoUnlock', 'fanLetter', 'settlementLuminaConversionRequest']);
    function wrappedDelegate(client: any, name: string, inside: boolean) {
      const delegate = client[name];
      return new Proxy(delegate, { get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return async (...args: any[]) => {
          if (!inside && stats.active) {
            stats.rootDuringTx++;
            throw new Error('Root database checkout inside transaction is forbidden');
          }
          const counts = inside ? stats.txReads : stats.rootReads;
          const label = name + '.' + String(key); counts[label] = (counts[label] ?? 0) + 1;
          const result = await Reflect.apply(value, target, args);
          if (inside && name === 'settlementLuminaConversionRequest' && key === 'aggregate') {
            check(result !== null && typeof result === 'object' && '_sum' in result
              && result._sum !== null && typeof result._sum === 'object' && 'amountKrw' in result._sum
              && (result._sum.amountKrw === null || result._sum.amountKrw instanceof Decimal),
            'Actual aggregate result must contain a nullable Decimal sum');
            stats.sums.push(result._sum.amountKrw);
            if (options.pauseAfterSum && stats.sums.length === 1) {
              aggregateReached.open(); await bounded(releaseAggregate.promise);
            }
          }
          if (inside && name === 'settlementLuminaConversionRequest' && key === 'create') {
            check(result !== null && typeof result === 'object' && 'id' in result
              && typeof result.id === 'string' && /^[a-f0-9-]{36}$/.test(result.id),
            'Actual inserted conversion must expose its owned UUID');
            stats.creates++; stats.createdIds.push(result.id);
            if (options.failAfterCreate) { stats.postCreateFailure = true; throw options.failAfterCreate; }
          }
          return result;
        };
      } });
    }
    const client = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return async (callback: any, transactionOptions: any) => {
        check(typeof callback === 'function'
          && transactionOptions?.isolationLevel === Prisma.TransactionIsolationLevel.ReadCommitted,
        'Actual interactive ReadCommitted product transaction required');
        stats.transactions++;
        return target.$transaction(async tx => {
          stats.active++;
          try {
            const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
            check(Number.isSafeInteger(row.pid) && row.pid > 0, 'Actual owned backend PID required');
            stats.pid = row.pid; entered.open();
            const wrapped = new Proxy(tx, { get(current, field) {
              if (delegates.has(String(field))) return wrappedDelegate(current, String(field), true);
              const value = Reflect.get(current, field);
              if (field === '$queryRaw') return async (...args: any[]) => {
                stats.rawCalls++;
                const rows = await Reflect.apply(value, current, args);
                check(Array.isArray(rows) && rows.length === 1 && rows[0].locked === 1,
                  'Actual advisory query must decode its one integer projection');
                stats.lockScalars++; return rows;
              };
              return typeof value === 'function' ? value.bind(current) : value;
            } });
            return await callback(wrapped);
          } finally { stats.active--; }
        }, { ...transactionOptions, timeout: 15_000, maxWait: 15_000 });
      };
      if (delegates.has(String(key))) return wrappedDelegate(target, String(key), false);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { client, stats, aggregateReached, releaseAggregate, entered };
  }
  async function waitForOwnedAdvisory(holder: number, waiter: number) {
    check(Number.isSafeInteger(holder) && Number.isSafeInteger(waiter) && holder > 0 && waiter > 0
      && holder !== waiter, 'Two distinct actual owned backend PIDs required');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] = await observer.$queryRaw<Array<{ matches: number }>>`
        SELECT count(*)::int AS matches FROM pg_stat_activity a
        JOIN pg_locks waiting ON waiting.pid = a.pid
        JOIN pg_locks held ON held.locktype = waiting.locktype
          AND held.database = waiting.database AND held.classid = waiting.classid
          AND held.objid = waiting.objid AND held.objsubid = waiting.objsubid
        WHERE a.datname = current_database() AND a.pid = ${waiter}::int
          AND a.wait_event_type = 'Lock' AND a.wait_event = 'advisory'
          AND waiting.locktype = 'advisory' AND NOT waiting.granted
          AND held.pid = ${holder}::int AND held.granted`;
      if (row.matches === 1) return;
      await new Promise<void>(yes => setTimeout(yes, 25));
    }
    throw new Error('Exact owned advisory lock wait was not observed');
  }
  async function noOwnedAdvisory(pid: number) {
    const [row] = await observer.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM pg_locks
      WHERE pid = ${pid}::int AND locktype = 'advisory'`;
    check(row.count === 0, 'Finished owned transaction must leave no advisory lock');
  }
  function checkFullPreview(seam: ReturnType<typeof instrument>) {
    for (const name of ['artistOperator', 'chatFeatureOrder', 'giftOrder', 'artistBoostEvent',
      'userPremiumVideoUnlock', 'fanLetter']) {
      check(seam.stats.txReads[name + '.findMany'] === 1, 'Each actual preview delegate must run on Tx');
    }
    check(seam.stats.txReads['artistOperator.findFirst'] === 1 && seam.stats.rootDuringTx === 0
      && seam.stats.transactions === 1 && seam.stats.rawCalls === 1 && seam.stats.lockScalars === 1,
    'Actual current access, one transaction and scalar lock without root reentry required');
  }
  async function onlyRequest(user: string) {
    const rows = await observer.settlementLuminaConversionRequest.findMany({ where: { requesterUserId: user } });
    check(rows.length === 1 && rows[0].amountKrw.equals(5000) && rows[0].requestedLumina.equals(500)
      && rows[0].status === 'requested' && rows[0].walletLedgerId === null,
    'Exactly one request-only reservation and no wallet link required');
    const aggregate = await observer.settlementLuminaConversionRequest.aggregate({
      where: { requesterUserId: user, settlementKey: rows[0].settlementKey,
        status: { in: ['requested', 'approved', 'credited'] } }, _sum: { amountKrw: true },
    });
    check(aggregate._sum.amountKrw?.equals(5000), 'Actual committed reservation sum must be exact');
    remember('settlement_lumina_conversion_requests', rows[0].id);
    return rows[0];
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-settlement-same-key-reservation\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_settlement_reservation_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.SETTLEMENT_RESERVATION_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.SETTLEMENT_RESERVATION_BASE_COMMIT === COMMIT
      && process.env.SETTLEMENT_RESERVATION_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261016-settlement-same-key-reservation\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/creator-studio/creator-settlement-reservation-20261016.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.SETTLEMENT_RESERVATION_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'creator-studio.service.ts'))) === SERVICE_SHA,
    'Exact frozen source and fresh owned loopback database required');
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
    check(await observer.user.count() === 0 && await observer.artistOperator.count() === 0
      && await observer.fanLetter.count() === 0 && await observer.settlementLuminaConversionRequest.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'Fresh private and financial tables required');
    check(await observer.artist.count() === 1 && await observer.artist.count({ where: {
      slug: 'oh-hyerin', displayName: String.fromCodePoint(0xc624, 0xd61c, 0xb9b0), status: 'active',
      sortOrder: 50, launchedAt: new Date('2026-04-27T00:00:00.000Z'),
    } }) === 1, 'Only the immutable migration public Artist seed may pre-exist');
    await bounds(); initial = await snapshot();
  });
  afterEach(async () => {
    if (!initial) return;
    check(await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'No wallet, ledger or audit effects permitted');
    check(JSON.stringify(await snapshot(owned)) === JSON.stringify(initial),
      'All original public table JSON/xmin digests must remain unchanged');
    await bounds();
  });
  afterAll(async () => {
    for (const db of [second, first, observer, setup]) if (db) await db.$disconnect();
    // Keep all fixtures and cluster; the parent-owned wrapper performs normal PG stop.
  });

  it('SETTLEMENT.RESERVATION.NATIVE.01 same raw key waits then rejects the second over-capacity claim', async () => {
    const current = await fixture(), before = await snapshot();
    const one = instrument(first, { pauseAfterSum: true }), two = instrument(second);
    const taskOne = settle(service(one.client).createSettlementConversion(current.user, current.input));
    let taskTwo: Promise<Result<ConversionResult>> | undefined;
    try {
      await bounded(one.aggregateReached.promise);
      check(one.stats.sums.length === 1 && one.stats.sums[0] === null, 'First actual SQL SUM must be empty');
      taskTwo = settle(service(two.client).createSettlementConversion(current.user,
        { ...current.input, idempotencyKey: randomUUID() }));
      await bounded(two.entered.promise); await waitForOwnedAdvisory(one.stats.pid, two.stats.pid);
      check(Number(two.stats.lockScalars) === 0 && Number(two.stats.txReads['artistOperator.findFirst'] ?? 0) === 0,
        'Second actual capacity/access reads must wait behind the first lock');
      one.releaseAggregate.open();
      const [winner, loser] = await Promise.all([taskOne, taskTwo]);
      check(winner.ok && !winner.value.idempotentReplay, 'First valid request must commit once');
      denied(loser, 400, 'SETTLEMENT_CONVERSION_AMOUNT_EXCEEDS_PREVIEW');
      checkFullPreview(one); checkFullPreview(two);
      check(one.stats.creates === 1 && two.stats.creates === 0 && two.stats.sums.length === 1
        && two.stats.sums[0]?.equals(5000), 'Waiting claim must see the latest committed reservation');
      const row = await onlyRequest(current.user);
      check(row.id === winner.value.conversion.id, 'Committed row must be the actual first result');
      check(JSON.stringify(await snapshot({ settlement_lumina_conversion_requests: [row.id] })) === JSON.stringify(before),
        'Only the committed conversion row may differ from pre-claim JSON/xmin');
      await noOwnedAdvisory(one.stats.pid); await noOwnedAdvisory(two.stats.pid);
    } finally { one.releaseAggregate.open(); await taskOne; if (taskTwo) await taskTwo; }
  });

  it('SETTLEMENT.RESERVATION.NATIVE.02 post-create failure rolls back and releases the transaction lock', async () => {
    const current = await fixture(), before = await snapshot();
    const injected = new Error('Owned injected post-create rollback');
    const one = instrument(first, { failAfterCreate: injected });
    const failed = await settle(service(one.client).createSettlementConversion(current.user, current.input));
    check(!failed.ok && failed.error === injected && one.stats.postCreateFailure && one.stats.creates === 1
      && one.stats.createdIds.length === 1, 'One actual SQL INSERT must precede the identical injected failure');
    checkFullPreview(one); await noOwnedAdvisory(one.stats.pid);
    check(await observer.settlementLuminaConversionRequest.count({ where: { id: one.stats.createdIds[0] } }) === 0
      && JSON.stringify(await snapshot()) === JSON.stringify(before), 'Real rollback must preserve every prior JSON/xmin row');
    const two = instrument(second);
    const next = await settle(service(two.client).createSettlementConversion(current.user,
      { ...current.input, idempotencyKey: randomUUID() }));
    check(next.ok && !next.value.idempotentReplay, 'A separate explicit call may claim after rollback');
    checkFullPreview(two);
    check(two.stats.creates === 1 && two.stats.sums.length === 1 && two.stats.sums[0] === null,
      'The next actual claim must see no rolled-back reservation, without automatic retry');
    const row = await onlyRequest(current.user);
    check(row.id === next.value.conversion.id
      && JSON.stringify(await snapshot({ settlement_lumina_conversion_requests: [row.id] })) === JSON.stringify(before),
    'Only the separate successful request may be retained');
    await noOwnedAdvisory(two.stats.pid);
  });

  it('SETTLEMENT.RESERVATION.NATIVE.03 access revoked while waiting is rechecked after the lock', async () => {
    const current = await fixture(), operatorBefore = await observer.artistOperator.findUnique({ where: { id: current.operator } });
    check(operatorBefore, 'Exact owned operator must exist');
    const before = await snapshot({ artist_operators: [current.operator] });
    const one = instrument(first, { pauseAfterSum: true }), two = instrument(second);
    const taskOne = settle(service(one.client).createSettlementConversion(current.user, current.input));
    let taskTwo: Promise<Result<ConversionResult>> | undefined;
    try {
      await bounded(one.aggregateReached.promise);
      taskTwo = settle(service(two.client).createSettlementConversion(current.user,
        { ...current.input, idempotencyKey: randomUUID() }));
      await bounded(two.entered.promise); await waitForOwnedAdvisory(one.stats.pid, two.stats.pid);
      check(Number(two.stats.rootReads['artistOperator.findFirst']) === 1
        && Number(two.stats.txReads['artistOperator.findFirst'] ?? 0) === 0,
        'Outer actual access must pass before the waiter can acquire the lock');
      const revokedAt = new Date('2026-10-16T00:00:00.000Z');
      const revoked = await setup.artistOperator.update({ where: { id: current.operator },
        data: { status: 'revoked', revokedAt } });
      check(JSON.stringify({ ...revoked, status: operatorBefore.status, revokedAt: operatorBefore.revokedAt })
        === JSON.stringify(operatorBefore), 'Only the explicit owned revocation fields may change');
      one.releaseAggregate.open();
      const [winner, loser] = await Promise.all([taskOne, taskTwo]);
      check(winner.ok && !winner.value.idempotentReplay, 'Already-admitted first request must retain its original behavior');
      denied(loser, 403);
      checkFullPreview(one);
      check(two.stats.transactions === 1 && two.stats.lockScalars === 1 && two.stats.rootDuringTx === 0
        && two.stats.txReads['artistOperator.findFirst'] === 1
        && !two.stats.txReads['artistOperator.findMany'] && two.stats.sums.length === 0 && two.stats.creates === 0,
      'Revoked waiter must allocate nothing and skip preview/SUM/create after actual Tx access fails');
      const row = await onlyRequest(current.user);
      check(row.id === winner.value.conversion.id
        && JSON.stringify(await snapshot({ artist_operators: [current.operator],
          settlement_lumina_conversion_requests: [row.id] })) === JSON.stringify(before),
      'Only the owned revocation and the first request may differ');
      await noOwnedAdvisory(one.stats.pid); await noOwnedAdvisory(two.stats.pid);
    } finally { one.releaseAggregate.open(); await taskOne; if (taskTwo) await taskTwo; }
  });
});

import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(60000);

const COMMIT = 'bd5076fed241261317f8605f53311e72df6fde44';
const SERVICE_SHA = 'd22e343bd2a5932c548bddadbb262d641884cad34d974dde0629d4dff31ee3b2';
const MAX_BYTES = 50_000_000;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const native = process.env.RUN_SETTLEMENT_TERMINAL_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(yes => { open = yes; });
  return { promise, open };
}
async function stage<T>(label: string, promise: Promise<T>): Promise<T> {
  try { return await promise; }
  catch (error) {
    const status = typeof (error as { getStatus?: unknown })?.getStatus === 'function'
      ? (error as { getStatus(): number }).getStatus() : 0;
    throw new Error(label + ':failed:' + status);
  }
}

native('settlement terminal state postgres (actual AdminService and SQL)', () => {
  let setup: PrismaClient, observer: PrismaClient, first: PrismaClient, second: PrismaClient;
  let initial: TableState[], actor: { id: string; adminRole: string };
  const owned = new Map<string, string[]>();
  const conversions: string[] = [], requesters: string[] = [];
  const config = { get() { throw new Error('Unexpected configuration access'); } } as unknown as ConfigService;
  const own = (table: string) => {
    const id = randomUUID(), ids = owned.get(table) ?? [];
    ids.push(id); owned.set(table, ids); return id;
  };
  const service = (db: unknown) => new AdminService(db as PrismaService, config);
  async function snapshot(exclude = false): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded public tables required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog name');
      const ids = exclude ? owned.get(relation) ?? [] : [];
      check(ids.length <= 16, 'Bounded exact owned row IDs required');
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
    check(row.readonly && Number(row.bytes) > 0 && Number(row.bytes) <= MAX_BYTES, 'Owned read-only bounded database required');
  }
  async function fixture(milliseconds = false) {
    const requester = own('users'), id = own('settlement_lumina_conversion_requests');
    requesters.push(requester); conversions.push(id);
    await setup.user.create({ data: { id: requester, status: 'active' } });
    await setup.$executeRaw`INSERT INTO settlement_lumina_conversion_requests
      (id, requester_user_id, settlement_key, settlement_type, period, amount_krw, requested_lumina)
      VALUES (${id}::uuid, ${requester}::uuid, ${'partner:' + requester + ':2026-10'}, 'partner', '2026-10', 100, 10)`;
    if (milliseconds) await setup.settlementLuminaConversionRequest.update({ where: { id },
      data: { updatedAt: new Date('2026-10-15T00:00:00.000Z') } });
    return { id, requester };
  }
  function paused(db: PrismaClient, id: string) {
    const reached = gate(), release = gate(); let reads = 0;
    function observed(target: any, transaction: boolean): any {
      const model = new Proxy(target.settlementLuminaConversionRequest, { get(delegate, key) {
        if (key === 'findUnique') return async (args: any) => {
          const value = await delegate.findUnique(args);
          if (args.where.id === id && ++reads === 1) { reached.open(); await release.promise; }
          return value;
        };
        const value = Reflect.get(delegate, key); return typeof value === 'function' ? value.bind(delegate) : value;
      } });
      return new Proxy(target, { get(client, key) {
        if (key === 'settlementLuminaConversionRequest') return model;
        if (!transaction && key === '$transaction') return (callback: any, options: any) => {
          check(typeof callback === 'function', 'Actual interactive transaction callback required');
          return client.$transaction((tx: Prisma.TransactionClient) => callback(observed(tx, true)), options);
        };
        const value = Reflect.get(client, key); return typeof value === 'function' ? value.bind(client) : value;
      } });
    }
    return { db: observed(db, false), reached, release, reads: () => reads };
  }
  function auditFailure(db: PrismaClient) {
    return new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (callback: any, options: any) => target.$transaction(tx => callback(new Proxy(tx, {
        get(transaction, member) {
          if (member === 'auditEvent') return { create() { throw new Error('synthetic audit failure'); } };
          const value = Reflect.get(transaction, member); return typeof value === 'function' ? value.bind(transaction) : value;
        },
      })), options);
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  async function collectServiceRows() {
    const wallets = await observer.walletAccount.findMany({ where: { userId: { in: requesters } } });
    check(wallets.every(row => row.currencyCode === 'LUMINA'), 'Owned requester wallet scope required');
    const ledgers = await observer.walletLedger.findMany({ where: { referenceId: { in: conversions } } });
    check(ledgers.every(row => row.ledgerType === 'settlement_lumina_conversion'
      && row.referenceType === 'settlement_lumina_conversion_request' && row.direction === 'credit'
      && row.amount.equals(10) && row.idempotencyKey === 'settlement-lumina-conversion:' + row.referenceId
      && wallets.some(wallet => wallet.id === row.walletAccountId)), 'Exact owned ledger relation required');
    const audits = await observer.auditEvent.findMany({ where: { targetId: { in: conversions } } });
    check(audits.every(row => row.actorUserId === actor.id && row.actorType === 'admin'
      && row.action === 'settlement_lumina_conversion.status.update'
      && row.targetType === 'settlement_lumina_conversion_request'), 'Exact owned audit scope required');
    owned.set('wallet_accounts', wallets.map(row => row.id));
    owned.set('wallet_ledger', ledgers.map(row => row.id)); owned.set('audit_events', audits.map(row => row.id));
  }

  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-settlement-terminal-state-cas\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_settlement_terminal_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.SETTLEMENT_TERMINAL_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.SETTLEMENT_TERMINAL_BASE_COMMIT === COMMIT
      && process.env.SETTLEMENT_TERMINAL_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-settlement-terminal-state-cas\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/admin/admin-settlement-terminal-state-20261015.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.SETTLEMENT_TERMINAL_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'admin.service.ts'))) === SERVICE_SHA,
    'Exact frozen source and fresh owned loopback database required');
    check(Prisma.dmmf.datamodel.models.length === 174, 'Pinned SDK174 required');
    setup = new PrismaClient({ datasources: { db: { url } } });
    const readonly = new URL(url!); readonly.searchParams.set('options', '-c default_transaction_read_only=on');
    observer = new PrismaClient({ datasources: { db: { url: readonly.toString() } } });
    first = new PrismaClient({ datasources: { db: { url } } }); second = new PrismaClient({ datasources: { db: { url } } });
    for (const db of [setup, observer, first, second]) await db.$connect();
    const [identity] = await observer.$queryRaw<Array<{ database: string; schema: string; port: string }>>`
      SELECT current_database() AS database, current_schema() AS schema, current_setting('port') AS port`;
    const [migration] = await observer.$queryRaw<Array<{ total: number; applied: number }>>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied
      FROM "_prisma_migrations"`;
    check(identity.database === expected.split('/').at(-1) && identity.schema === 'public' && identity.port === '55432'
      && migration.total === 103 && migration.applied === 103, 'Owned schema103 required');
    check(await observer.user.count() === 0 && await observer.walletAccount.count() === 0
      && await observer.walletLedger.count() === 0 && await observer.auditEvent.count() === 0
      && await observer.settlementLuminaConversionRequest.count() === 0, 'Fresh financial fixture admission required');
    await bounds(); initial = await snapshot();
    actor = { id: own('users'), adminRole: 'accounting_admin' };
    await setup.user.create({ data: { id: actor.id, status: 'active' } });
  });
  afterEach(async () => {
    if (!initial) return;
    await collectServiceRows();
    check(JSON.stringify(await snapshot(true)) === JSON.stringify(initial), 'Every original JSON/xmin row must remain unchanged');
    await bounds();
  });
  afterAll(async () => {
    for (const db of [first, second, observer, setup]) if (db) await db.$disconnect();
    // Retain all owned fixtures and cluster files. Parent owns normal PG stop.
  });

  it('SETTLEMENT.TERMINAL.NATIVE.01 untouched timestamp default, same-conversion replay and audit rollback', async () => {
    const current = await fixture();
    const [defaultPrecision] = await observer.$queryRaw<Array<{ remainder: number }>>`
      SELECT (extract(microseconds FROM updated_at)::bigint % 1000)::int AS remainder
      FROM settlement_lumina_conversion_requests WHERE id = ${current.id}::uuid`;
    check(Number.isInteger(defaultPrecision.remainder) && defaultPrecision.remainder >= 0
      && defaultPrecision.remainder < 1000, 'Actual default precision observation required');
    const approved = await stage('NATIVE01_default_transition_fraction_' + defaultPrecision.remainder,
      service(first).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'approved' }));
    check(approved.ok && approved.conversion.status === 'approved', 'Untouched default timestamp must admit a normal transition');
    const precise = await fixture();
    await setup.$executeRaw`UPDATE settlement_lumina_conversion_requests
      SET updated_at = TIMESTAMPTZ '2026-10-15T00:00:00.123456Z' WHERE id = ${precise.id}::uuid`;
    const [exactPrecision] = await observer.$queryRaw<Array<{ remainder: number }>>`
      SELECT (extract(microseconds FROM updated_at)::bigint % 1000)::int AS remainder
      FROM settlement_lumina_conversion_requests WHERE id = ${precise.id}::uuid`;
    check(exactPrecision.remainder === 456
      && (await observer.settlementLuminaConversionRequest.findUnique({ where: { id: precise.id } }))?.updatedAt.getMilliseconds() === 123,
    'SQL microseconds and rounded JS Date must remain visibly distinct to the oracle');
    const precision = await stage('NATIVE01_fixed_submillisecond_transition',
      service(first).updateBackstageSettlementConversionStatus(actor, precise.id, { status: 'approved' }));
    check(precision.ok && precision.conversion.status === 'approved', 'Unchanged sub-millisecond timestamp must not cause a false conflict');
    const credited = await stage('NATIVE01_first_credit',
      service(first).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'credited' }));
    const replay = await stage('NATIVE01_credit_replay',
      service(second).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'credited' }));
    check(credited.ok && 'idempotentReplay' in credited && 'idempotentReplay' in replay
      && 'walletLedger' in credited && 'walletLedger' in replay
      && credited.idempotentReplay === false && replay.idempotentReplay === true
      && credited.walletLedger?.id === replay.walletLedger?.id, 'Same conversion must reuse exactly the original ledger');
    check(await observer.walletLedger.count({ where: { referenceId: current.id } }) === 1
      && (await observer.walletAccount.findUnique({ where: { userId_currencyCode: { userId: current.requester, currencyCode: 'LUMINA' } } }))?.cachedBalance.equals(10),
    'Original conversion credit has one real ledger and one balance effect');
    const rollback = await fixture(true), before = await snapshot();
    const failed = await service(auditFailure(first)).updateBackstageSettlementConversionStatus(actor, rollback.id, { status: 'approved' })
      .then(() => false, error => error?.message === 'synthetic audit failure');
    check(failed && JSON.stringify(await snapshot()) === JSON.stringify(before), 'Non-credit audit failure must roll back row and all committed state');
  });

  it('SETTLEMENT.TERMINAL.NATIVE.02 delayed non-credit loses409 after a real independent credit', async () => {
    const current = await fixture(true), seam = paused(first, current.id);
    const losing = service(seam.db).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'rejected' });
    // Attach rejection before releasing the barrier; an expected rejection is never unhandled.
    const outcome = losing.then(() => 0, error => error?.getStatus?.());
    try {
      await seam.reached.promise;
      await service(second).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'credited' });
      const winner = await snapshot(); seam.release.open();
      check(await outcome === 409 && seam.reads() === 1, 'Old non-credit snapshot must lose exact409');
      check(JSON.stringify(await snapshot()) === JSON.stringify(winner), 'Defeated handler must commit no extra row, audit, ledger or balance mutation');
    } finally { seam.release.open(); await outcome; }
    const versionOnly = await fixture();
    await setup.$executeRaw`UPDATE settlement_lumina_conversion_requests
      SET updated_at = TIMESTAMPTZ '2026-10-15T00:00:00.123456Z' WHERE id = ${versionOnly.id}::uuid`;
    const beforeMillis = (await observer.settlementLuminaConversionRequest.findUnique({ where: { id: versionOnly.id } }))?.updatedAt.getTime();
    const versionSeam = paused(first, versionOnly.id);
    const staleVersion = service(versionSeam.db).updateBackstageSettlementConversionStatus(actor, versionOnly.id, { status: 'approved' });
    const versionOutcome = staleVersion.then(() => 0, error => error?.getStatus?.());
    try {
      await versionSeam.reached.promise;
      await setup.$executeRaw`UPDATE settlement_lumina_conversion_requests
        SET updated_at = TIMESTAMPTZ '2026-10-15T00:00:00.123457Z' WHERE id = ${versionOnly.id}::uuid`;
      const afterMillis = (await observer.settlementLuminaConversionRequest.findUnique({ where: { id: versionOnly.id } }))?.updatedAt.getTime();
      check(Number.isSafeInteger(beforeMillis) && beforeMillis === afterMillis,
        'Actual before/after Prisma Dates must compare equal while the SQL version changes');
      const winner = await snapshot(); versionSeam.release.open();
      check(await versionOutcome === 409, 'Changed version with the same status must lose409');
      check(JSON.stringify(await snapshot()) === JSON.stringify(winner), 'Version-only stale request must commit no extra state');
    } finally { versionSeam.release.open(); await versionOutcome; }
  });

  it('SETTLEMENT.TERMINAL.NATIVE.03 delayed credit rereads actual rejected and cancelled terminal rows', async () => {
    for (const terminal of ['rejected', 'cancelled']) {
      const current = await fixture(true), seam = paused(first, current.id);
      const losing = service(seam.db).updateBackstageSettlementConversionStatus(actor, current.id, { status: 'credited' });
      const outcome = losing.then(() => 0, error => error?.getStatus?.());
      try {
        await seam.reached.promise;
        await service(second).updateBackstageSettlementConversionStatus(actor, current.id, { status: terminal });
        const winner = await snapshot(); seam.release.open();
        check(await outcome === 400 && seam.reads() === 2, 'Outer snapshot and locked current terminal must retain existing400');
        check(JSON.stringify(await snapshot()) === JSON.stringify(winner), 'Stale credit must commit no extra wallet, ledger, conversion or audit mutation');
      } finally { seam.release.open(); await outcome; }
    }
  });
});

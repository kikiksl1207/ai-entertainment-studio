import 'reflect-metadata';
import { Prisma, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CreatorStudioService } from './creator-studio.service';
import { PrismaService } from '../prisma/prisma.service';

jest.setTimeout(60000);
const COMMIT = '9a2b254397f2a5d626b376553daa54554dd7f8a1';
const SERVICE_SHA = '981c39b21afddf91110ae01bd5b5e3247da761c70c808b491e958e6b5c8c9645';
const MAX_BYTES = 50_000_000;
const normalize = (value: string) => resolve(value).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const native = process.env.RUN_SETTLEMENT_INTENT_NATIVE === '1' ? describe : describe.skip;
type TableState = { relation: string; rows: string; digest: string };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function gate() {
  let open!: () => void;
  const promise = new Promise<void>(yes => { open = yes; });
  return { promise, open };
}

native('settlement idempotency intent postgres (actual CreatorStudioService and unique SQL)', () => {
  let setup: PrismaClient, observer: PrismaClient, first: PrismaClient, second: PrismaClient;
  let initial: TableState[];
  const users: string[] = [], conversions: string[] = [];
  const config = { get() { throw new Error('Unexpected configuration access'); } } as unknown as ConfigService;
  function service(db: unknown) {
    const instance = new CreatorStudioService(db as PrismaService, config);
    const access = jest.spyOn(instance as any, 'assertSettlementConversionAccess').mockResolvedValue(undefined);
    const preview = jest.spyOn(instance, 'getSettlementPreview').mockResolvedValue({
      items: [], totals: { creatorShareKrw: new Decimal(10000) },
    } as any);
    return { instance, access, preview };
  }
  async function fixture() {
    const user = randomUUID(); users.push(user);
    await setup.user.create({ data: { id: user, status: 'active' } });
    return { user, input: { settlementKey: 'partner:' + user + ':2026-10', amountKrw: '1000', idempotencyKey: randomUUID() } };
  }
  async function snapshot(exclude = false): Promise<TableState[]> {
    const tables = await observer.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    check(tables.length > 0 && tables.length <= 256, 'Bounded public tables required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      check(/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation), 'Unexpected catalog name');
      const ids = !exclude ? [] : relation === 'users' ? users
        : relation === 'settlement_lumina_conversion_requests' ? conversions : [];
      check(ids.length <= 16, 'Bounded exact owned rows required');
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
  function paused(db: PrismaClient) {
    const reached = gate(), release = gate();
    let reads = 0, creates = 0;
    const uniqueErrors: Array<{ code: string; target: unknown; modelName: unknown }> = [];
    const delegate = new Proxy(db.settlementLuminaConversionRequest, { get(target, key) {
      if (key === 'findFirst') return async (args: any) => {
        const row = await target.findFirst(args);
        if (++reads === 1) { check(row === null, 'First real lookup must miss'); reached.open(); await release.promise; }
        return row;
      };
      if (key === 'create') return async (args: any) => {
        creates++;
        try { return await target.create(args); }
        catch (error) {
          check(error instanceof Prisma.PrismaClientKnownRequestError, 'Actual known Prisma error required');
          uniqueErrors.push({ code: error.code, target: error.meta?.target, modelName: error.meta?.modelName });
          throw error;
        }
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const client = new Proxy(db, { get(target, key) {
      if (key === 'settlementLuminaConversionRequest') return delegate;
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    return { client, reached, release, uniqueErrors, reads: () => reads, creates: () => creates };
  }
  function assertUnique(seam: ReturnType<typeof paused>) {
    check(seam.creates() === 1 && seam.reads() === 2 && seam.uniqueErrors.length === 1,
      'One failed create and exactly one winner lookup, no create retry');
    const error = seam.uniqueErrors[0];
    check(error.code === 'P2002' && error.modelName === 'SettlementLuminaConversionRequest'
      && Array.isArray(error.target) && error.target.length === 2
      && error.target[0] === 'requester_user_id' && error.target[1] === 'idempotency_key',
    'Actual pinned Prisma mapped composite metadata required');
  }
  beforeAll(async () => {
    const report = normalize(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const match = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-settlement-idempotency-intent\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expected = match ? 'postgresql://lumina_qa@127.0.0.1:55432/lumina_settlement_intent_qa_' + match[1] : null;
    const url = process.env.STORY_TEST_DATABASE_URL, root = process.env.SETTLEMENT_INTENT_SOURCE_ROOT ?? '';
    check(expected && url === expected && process.env.DATABASE_URL === url && process.env.NODE_ENV === 'test'
      && process.env.SETTLEMENT_INTENT_BASE_COMMIT === COMMIT
      && process.env.SETTLEMENT_INTENT_MAX_DB_BYTES === String(MAX_BYTES)
      && /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-settlement-idempotency-intent\/recipe-[a-f0-9]{12}\/source$/.test(normalize(root))
      && normalize(realpathSync(root)) === normalize(root)
      && normalize(realpathSync(dirname(report))) === normalize(dirname(report))
      && normalize(realpathSync(__filename)) === normalize(resolve(root, 'server/src/creator-studio/creator-settlement-idempotency-intent-20261015.postgres.spec.ts'))
      && sha(readFileSync(__filename)) === process.env.SETTLEMENT_INTENT_SPEC_SHA
      && sha(readFileSync(resolve(__dirname, 'creator-studio.service.ts'))) === SERVICE_SHA,
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
    check(await observer.user.count() === 0 && await observer.settlementLuminaConversionRequest.count() === 0
      && await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'Fresh financial fixture admission required');
    await bounds(); initial = await snapshot();
  });
  afterEach(async () => {
    if (!initial) return;
    const rows = await observer.settlementLuminaConversionRequest.findMany({ where: { requesterUserId: { in: users } } });
    check(rows.length <= 8 && rows.every(row => row.status === 'requested' && row.amountKrw.equals(1000)
      && row.requestedLumina.equals(100) && row.walletLedgerId === null), 'Exact request-only fixture values required');
    conversions.splice(0, conversions.length, ...rows.map(row => row.id));
    check(await observer.walletAccount.count() === 0 && await observer.walletLedger.count() === 0
      && await observer.auditEvent.count() === 0, 'No financial effect permitted');
    check(JSON.stringify(await snapshot(true)) === JSON.stringify(initial), 'All original JSON/xmin rows unchanged');
    await bounds();
  });
  afterAll(async () => {
    for (const db of [first, second, observer, setup]) if (db) await db.$disconnect();
    // Retain exact fixtures and cluster. Parent owns normal PG stop.
  });
  it('SETTLEMENT.INTENT.NATIVE.01 exact intent replay and changed body conflict without writes', async () => {
    const current = await fixture(), handler = service(first);
    const created = await handler.instance.createSettlementConversion(current.user, current.input);
    check(!created.idempotentReplay && created.conversion.status === 'requested', 'Normal request creation required');
    const before = await snapshot();
    handler.preview.mockRejectedValue(new Error('Synthetic preview unavailable'));
    const replay = await handler.instance.createSettlementConversion(current.user, { ...current.input, amountKrw: '1000.00', note: null });
    check(replay.idempotentReplay && replay.conversion.id === created.conversion.id && handler.preview.mock.calls.length === 1,
      'Stored intent must replay without re-estimation');
    for (const change of [{ amountKrw: '1001' }, { settlementKey: 'partner:' + current.user + ':2026-11' }, { note: 'changed' }]) {
      await expect(handler.instance.createSettlementConversion(current.user, { ...current.input, ...change }))
        .rejects.toMatchObject({ status: 409, response: { code: 'SETTLEMENT_CONVERSION_IDEMPOTENCY_CONFLICT' } });
    }
    check(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Replay and conflicts must leave all JSON/xmin unchanged');
  });
  it('SETTLEMENT.INTENT.NATIVE.02 real same-intent unique collision reuses one committed winner', async () => {
    const current = await fixture(), seam = paused(first), loser = service(seam.client);
    const pending = loser.instance.createSettlementConversion(current.user, current.input);
    const outcome = pending.then(value => ({ value, error: null }), error => ({ value: null, error }));
    try {
      await seam.reached.promise;
      const winner = await service(second).instance.createSettlementConversion(current.user, current.input);
      const before = await snapshot(); seam.release.open();
      const result = await outcome;
      check(!result.error && result.value?.idempotentReplay && result.value.conversion.id === winner.conversion.id,
        'Collision must replay the original winner');
      assertUnique(seam);
      check(await observer.settlementLuminaConversionRequest.count({ where: { requesterUserId: current.user } }) === 1
        && JSON.stringify(await snapshot()) === JSON.stringify(before), 'No duplicate request or update after collision');
    } finally { seam.release.open(); await outcome; }
  });
  it('SETTLEMENT.INTENT.NATIVE.03 real changed-intent unique collision rejects without overwriting winner', async () => {
    const current = await fixture(), seam = paused(first), loser = service(seam.client);
    const pending = loser.instance.createSettlementConversion(current.user, { ...current.input, amountKrw: '1100', note: 'different' });
    const outcome = pending.then(() => null, error => error);
    try {
      await seam.reached.promise;
      await service(second).instance.createSettlementConversion(current.user, current.input);
      const before = await snapshot(); seam.release.open();
      const error = await outcome;
      check(error?.getStatus?.() === 409 && error.getResponse()?.code === 'SETTLEMENT_CONVERSION_IDEMPOTENCY_CONFLICT',
        'Changed collision intent must return exact conflict');
      assertUnique(seam);
      check(await observer.settlementLuminaConversionRequest.count({ where: { requesterUserId: current.user } }) === 1
        && JSON.stringify(await snapshot()) === JSON.stringify(before), 'Winner JSON/xmin must remain untouched');
    } finally { seam.release.open(); await outcome; }
  });
});

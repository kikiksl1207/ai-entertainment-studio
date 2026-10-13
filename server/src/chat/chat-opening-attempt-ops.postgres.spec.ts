import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ChatService } from './chat.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const day = new Date('2026-10-13T15:00:00.000Z');
const schema = '2026-05-22.character-chat-opening-greeting-v1';
const contract = '2026-06-05.character-chat-opening-greeting-variants.v1';
const providerName = 'synthetic-provider';
type Metadata = { modelMetadata: Record<string, Prisma.InputJsonValue | null>; safetyMetadata: Record<string, Prisma.InputJsonValue | null> };
type Stats = { totalResponses: number; failureCount: number; fallbackCount: number;
  usageByModel: Array<{ provider: string; model: string; responses: number; inputTokens: number;
    outputTokens: number; estimatedCostKrw: string }>; estimatedCostKrw: string };
type Probe = { providerOpsStatsForUser(owner: string, start: Date): Promise<Stats> };
type SnapshotRow = { relation: string; rowId: string; rowVersion: string; payload: Prisma.JsonValue };
const empty: Stats = { totalResponses: 0, failureCount: 0, fallbackCount: 0, usageByModel: [], estimatedCostKrw: '0.00' };

function failed(reason = 'provider_timeout', attempted: Prisma.InputJsonValue = true): Metadata {
  return {
    modelMetadata: { usageSchemaVersion: schema, contractVersion: contract,
      purpose: 'opening_greeting', source: 'fallback', fallbackReason: reason, estimatedCostKrw: '0.00' },
    safetyMetadata: { contractVersion: contract, purpose: 'opening_greeting',
      openingGreetingSource: 'fallback', providerAttempted: attempted, fallbackReason: reason },
  };
}
function success(): Metadata {
  return { modelMetadata: { usageSchemaVersion: schema, contractVersion: contract, purpose: 'opening_greeting',
    provider: providerName, model: 'synthetic-success-model',
    usage: { provider: providerName, model: 'synthetic-success-model', inputTokens: 12, outputTokens: 24, estimatedCostKrw: '0.04' },
    estimatedCostKrw: '0.04' },
  safetyMetadata: { contractVersion: contract, purpose: 'opening_greeting', openingGreetingSource: 'provider',
    providerAttempted: true, fallbackReason: null, provider: providerName, generationStatus: 'completed' } };
}
function basicFallback(): Metadata {
  return { modelMetadata: { provider: providerName, model: 'fallback',
    usage: { provider: providerName, model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
    estimatedCostKrw: '0.00' },
  safetyMetadata: { provider: providerName, generationStatus: 'fallback', reason: 'provider_timeout' } };
}
function readonlyClient(databaseUrl: string) {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [{ level: 'query', emit: 'event' }] });
}

jest.setTimeout(30_000);
native('opening attempt ops postgres (owned SDK174/103, read-only synthetic rows)', () => {
  let setup: PrismaClient;
  let readonly: ReturnType<typeof readonlyClient>;
  let failureClient: ReturnType<typeof readonlyClient>;
  let probe: Probe;
  let failureProbe: Probe;
  let owner: string[];
  let session: string[];
  let before: SnapshotRow[] | undefined;
  let queries: string[] = [];
  let failureQueries: string[] = [];
  let effects: jest.SpyInstance[] = [];
  let http: jest.SpyInstance | undefined;
  const forbidden = () => jest.fn(() => { throw new Error('Provider activity is forbidden'); });
  const provider = { readiness: forbidden(), generate: forbidden(), fallbackResult: forbidden() };

  async function flags(client = readonly) {
    const [row] = await client.$queryRaw<Array<{ database: string; defaultReadOnly: boolean; transactionReadOnly: boolean }>>`
      SELECT current_database() AS database,
        current_setting('default_transaction_read_only') = 'on' AS "defaultReadOnly",
        current_setting('transaction_read_only') = 'on' AS "transactionReadOnly"`;
    return row;
  }
  async function snapshot() {
    // JSONB preserves stored precision; xmin also catches no-op writes to scoped tables.
    return readonly.$queryRaw<SnapshotRow[]>`SELECT * FROM (
      SELECT 'users' AS relation, id::text AS "rowId", xmin::text AS "rowVersion", to_jsonb(t) AS payload FROM users t
      UNION ALL SELECT 'artists', id::text, xmin::text, to_jsonb(t) FROM artists t
      UNION ALL SELECT 'artist_public_profiles', artist_id::text, xmin::text, to_jsonb(t) FROM artist_public_profiles t
      UNION ALL SELECT 'artist_content_profiles', artist_id::text, xmin::text, to_jsonb(t) FROM artist_content_profiles t
      UNION ALL SELECT 'chat_personas', id::text, xmin::text, to_jsonb(t) FROM chat_personas t
      UNION ALL SELECT 'chat_sessions', id::text, xmin::text, to_jsonb(t) FROM chat_sessions t
      UNION ALL SELECT 'chat_messages', id::text, xmin::text, to_jsonb(t) FROM chat_messages t
      UNION ALL SELECT 'chat_feature_products', id::text, xmin::text, to_jsonb(t) FROM chat_feature_products t
      UNION ALL SELECT 'chat_feature_orders', id::text, xmin::text, to_jsonb(t) FROM chat_feature_orders t
      UNION ALL SELECT 'wallet_accounts', id::text, xmin::text, to_jsonb(t) FROM wallet_accounts t
      UNION ALL SELECT 'wallet_ledger', id::text, xmin::text, to_jsonb(t) FROM wallet_ledger t
    ) saved ORDER BY relation, "rowId"`;
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    const report = (process.env.RELEASE_QA_GUARD_REPORT ?? '').replace(/\\/g, '/');
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)
      || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== url
      || !/^E:\/Codex\/LuminaStage\/ai-entertainment-studio-git\/qa\/20261014-chat-opening-attempt-ops\/owned-[a-f0-9]{12}\/test-guards\.json$/i.test(report)) {
      throw new Error('Explicit parent-owned loopback database and scoped E-only QA guards required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing SDK174 mapping required');
    setup = new PrismaClient({ datasources: { db: { url } } });
    const ro = new URL(url!);
    ro.searchParams.set('options', '-c default_transaction_read_only=on');
    readonly = readonlyClient(ro.toString());
    const missing = new URL(ro.toString());
    // A nonexistent namespace causes a real SELECT failure without changing schema or permissions.
    missing.searchParams.set('schema', 'qa_missing_opening_ops');
    failureClient = readonlyClient(missing.toString());
    readonly.$on('query', event => { queries.push(event.query); });
    failureClient.$on('query', event => { failureQueries.push(event.query); });
    await setup.$connect();
    await readonly.$connect();
    await failureClient.$connect();
    for (const client of [readonly, failureClient]) {
      if (!(await flags(client)).defaultReadOnly || !(await flags(client)).transactionReadOnly
        || (await flags(client)).database !== parsed.pathname.slice(1)) throw new Error('Actual read-only connection required');
    }
    const [migration] = await readonly.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished FROM "_prisma_migrations"`;
    if (migration.applied !== 103 || migration.unfinished !== 0) throw new Error('Owned 103-migration baseline required');
    if (await setup.user.count() || await setup.chatSession.count()
      || await setup.chatMessage.count() || await setup.chatFeatureOrder.count()
      || await setup.walletAccount.count() || await setup.walletLedger.count()) throw new Error('Fresh unseeded synthetic database required');

    const nonce = randomUUID();
    const artist = await setup.artist.create({ data: {
      slug: `synthetic-opening-ops-${nonce}`, displayName: 'Synthetic Opening Ops', status: 'active',
      createdAt: day, updatedAt: day,
    } });
    owner = []; session = [];
    for (let index = 0; index < 6; index++) {
      const user = await setup.user.create({ data: { email: `synthetic-opening-${index}-${nonce}@example.invalid`, createdAt: day, updatedAt: day } });
      owner.push(user.id);
      session.push((await setup.chatSession.create({ data: {
        userId: user.id, artistId: artist.id, status: 'active', createdAt: day, updatedAt: day,
      } })).id);
    }
    const product = await setup.chatFeatureProduct.create({ data: {
      sku: `synthetic-opening-${nonce}`, name: 'Synthetic exclusion fixture', featureType: 'special_reply',
      priceLumina: '0.01', metadata: { synthetic: true }, createdAt: day, updatedAt: day,
    } });
    const order = await setup.chatFeatureOrder.create({ data: {
      userId: owner[1], artistId: artist.id, chatSessionId: session[1], chatFeatureProductId: product.id,
      status: 'pending', idempotencyKey: `synthetic-opening-${nonce}`, createdAt: day, updatedAt: day,
    } });
    async function message(index: number, metadata: Metadata, overrides: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) {
      await setup.chatMessage.create({ data: { chatSessionId: session[index], senderType: 'artist', messageType: 'opening_greeting',
        body: null, createdAt: day, ...metadata, ...overrides } });
    }
    await message(0, failed());
    await message(1, failed());
    await message(1, failed(), { createdAt: new Date(day.getTime() - 1) });
    await message(1, failed(), { senderType: 'user' });
    await message(1, failed(), { senderType: 'system' });
    await message(1, failed(), { chatFeatureOrderId: order.id });
    await message(5, failed());
    for (const data of [failed('provider_timeout', false), failed('provider_guard_blocked', false),
      failed('provider_guard_blocked', true), failed('provider_timeout', 'true'), failed('', true)]) await message(2, data);
    const unversioned = failed(); delete unversioned.modelMetadata.usageSchemaVersion;
    await message(2, unversioned);
    const missingReason = failed(); delete missingReason.modelMetadata.fallbackReason; delete missingReason.safetyMetadata.fallbackReason;
    await message(2, missingReason);
    for (const reason of [null, 1, false, ['provider_timeout']] as Array<Prisma.InputJsonValue | null>) {
      const nonstring = failed();
      nonstring.modelMetadata.fallbackReason = reason;
      nonstring.safetyMetadata.fallbackReason = reason;
      await message(2, nonstring);
    }
    await message(3, failed()); await message(3, failed('provider_empty_response'));
    await message(3, success()); await message(3, basicFallback(), { messageType: 'text' });
    await message(4, failed());
    // Every setup write is finished before any ChatService instance receives a connection.
    const service = new ChatService(readonly as never, provider as never);
    probe = service as unknown as Probe;
    failureProbe = new ChatService(failureClient as never, provider as never) as unknown as Probe;
    effects = [jest.spyOn(service, 'createSession'), jest.spyOn(service, 'createMessage'), jest.spyOn(service, 'generateMessage'),
      jest.spyOn(readonly, '$transaction'), jest.spyOn(readonly, '$executeRaw'), jest.spyOn(readonly, '$executeRawUnsafe'),
      jest.spyOn(readonly.chatMessage, 'create'), jest.spyOn(readonly.chatMessage, 'update'), jest.spyOn(readonly.chatMessage, 'delete')];
    http = jest.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('HTTP forbidden in native read fixture'); });
  });

  beforeEach(async () => {
    before = undefined;
    before = await snapshot();
    queries = []; failureQueries = [];
    for (const call of [...Object.values(provider), ...effects, ...(http ? [http] : [])]) call.mockClear();
  });
  afterEach(async () => {
    if (!before) return;
    expect(queries.filter(sql => /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b|\bFOR\s+(?:UPDATE|SHARE)\b/i.test(sql))).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await flags()).toMatchObject({ defaultReadOnly: true, transactionReadOnly: true });
    for (const call of [...Object.values(provider), ...effects, ...(http ? [http] : [])]) expect(call).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    // Parent owns shutdown; do not delete fixtures, drop databases or mutate migrations.
    try { await failureClient?.$disconnect(); }
    finally { try { await readonly?.$disconnect(); } finally { await setup?.$disconnect(); } }
  });

  it('counts one exact stored failed opening without inferred usage tokens or cost', async () => {
    expect(Prisma.dmmf.datamodel.models).toHaveLength(174);
    expect(await probe.providerOpsStatsForUser(owner[0], day)).toEqual({ ...empty, totalResponses: 1, failureCount: 1, fallbackCount: 1 });
    const select = queries.find(sql => /\bchat_messages\b/.test(sql));
    expect(select).toBeDefined();
    expect(select).toMatch(/message_type/);
    expect(select).not.toMatch(/"body"/);
  });

  it('applies owner day artist-sender and paid-order exclusions through actual SQL', async () => {
    expect(await readonly.chatMessage.count({ where: { chatSessionId: session[1] } })).toBe(5);
    expect(await probe.providerOpsStatsForUser(owner[1], day)).toEqual({ ...empty, totalResponses: 1, failureCount: 1, fallbackCount: 1 });
    expect(await probe.providerOpsStatsForUser(owner[5], day)).toEqual({ ...empty, totalResponses: 1, failureCount: 1, fallbackCount: 1 });
    expect(await probe.providerOpsStatsForUser(randomUUID(), day)).toEqual(empty);
  });

  it('excludes false blocked string-true unversioned and malformed-reason stored metadata', async () => {
    expect(await readonly.chatMessage.count({ where: { chatSessionId: session[2] } })).toBe(11);
    expect(await probe.providerOpsStatsForUser(owner[2], day)).toEqual(empty);
  });

  it('keeps only existing success and basic-fallback buckets in mixed stored attempts', async () => {
    const stats = await probe.providerOpsStatsForUser(owner[3], day);
    expect(stats).toMatchObject({ totalResponses: 4, failureCount: 3, fallbackCount: 3, estimatedCostKrw: '0.04' });
    expect(stats.usageByModel).toHaveLength(2);
    expect(stats.usageByModel).toEqual(expect.arrayContaining([
      { provider: providerName, model: 'synthetic-success-model', responses: 1, inputTokens: 12, outputTokens: 24, estimatedCostKrw: '0.04' },
      { provider: providerName, model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
    ]));
    expect(stats.usageByModel.reduce((sum, row) => sum + row.responses, 0)).toBe(2);
  });

  it('propagates a real missing-table read failure and rejects writes without stored changes', async () => {
    await expect(failureProbe.providerOpsStatsForUser(owner[4], day)).rejects.toMatchObject({ code: 'P2021' });
    expect(await flags(failureClient)).toMatchObject({ defaultReadOnly: true, transactionReadOnly: true });
    // Deliberate denied-write probe uses the separate read-only failure client, never the service client.
    await expect(failureClient.$executeRaw`UPDATE public.chat_sessions SET updated_at = updated_at WHERE id = ${session[4]}::uuid`)
      .rejects.toMatchObject({ code: 'P2010', meta: { code: '25006' } });
    expect(failureQueries.filter(sql => /\b(?:INSERT|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql))).toEqual([]);
    expect(await probe.providerOpsStatsForUser(owner[4], day)).toEqual({ ...empty, totalResponses: 1, failureCount: 1, fallbackCount: 1 });
    expect(await snapshot()).toEqual(before);
  });
});

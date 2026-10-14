import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ChatService } from './chat.service';

const ROOT = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const CLEAN = 'E:/Codex/LuminaStage/story-completion-20261003';
const SERVICE_SHA = '64bd3cfa9af36532af5d03a913e0f16d8b52cf2217cc85edd336930766970f69';
const ADAPTER_SHA = 'c96ca7266299a1568db62bc24f812bce97aba3995c783d9d938144e00b0cfabc';
const MAX_BYTES = 50_000_000;
const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const now = new Date('2026-10-15T04:00:00.000Z');
const day = new Date('2026-10-14T15:00:00.000Z');
const future = new Date('2026-10-16T04:00:00.000Z');
const providerName = 'synthetic-estimate-provider';
const marker = 'SYNTHETIC_FAILED_USAGE_NOT_FOR_SUMMARY';
const accounting = { contract: 'chat-provider-estimate-coverage-v1',
  scope: 'stored_current_user_artist_messages_without_feature_order', billingStatus: 'unverified',
  actualProviderCostKrw: null, providerInvoiceVerified: false, failedProviderUsageIncluded: false,
  featureOrderMessagesIncluded: false };
const normalized = (file: string) => resolve(file).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const client = (databaseUrl: string) => new PrismaClient({ datasources: { db: { url: databaseUrl } },
  log: [{ level: 'query', emit: 'event' }] });
type Metadata = Pick<Prisma.ChatMessageUncheckedCreateInput, 'modelMetadata' | 'safetyMetadata'>;
type SavedRow = { relation: string; id: string; version: string; payload: Prisma.JsonValue };
type Query = { query: string; params: string };

function failed(): Metadata {
  return { modelMetadata: { provider: providerName, model: 'fallback', estimatedCostKrw: '0.00',
    usage: { provider: providerName, model: 'fallback', inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' } },
  safetyMetadata: { provider: providerName, generationStatus: 'fallback', reason: 'provider_incomplete_response',
    localFallbackCostOnly: true, failedProviderResponse: { responseStatus: 'incomplete', reason: 'max_output_tokens',
      model: marker, inputTokens: 41, outputTokens: 23, estimatedCostKrw: null, billingStatus: 'unverified' } } };
}
function greeting(): Metadata {
  const purpose = 'opening_greeting', contractVersion = '2026-06-05.character-chat-opening-greeting-variants.v1';
  return { modelMetadata: { purpose, contractVersion, usageSchemaVersion: '2026-05-22.character-chat-opening-greeting-v1',
    source: 'fallback', fallbackReason: 'provider_incomplete_response', estimatedCostKrw: '0.00' },
  safetyMetadata: { purpose, contractVersion, openingGreetingSource: 'fallback', providerAttempted: true,
    fallbackReason: 'provider_incomplete_response', failedProviderResponseStorage: 'greeting_metadata',
    localFallbackCostOnly: true, failedProviderResponse: { responseStatus: 'incomplete', reason: 'max_output_tokens',
      model: marker, inputTokens: null, outputTokens: null, estimatedCostKrw: null, billingStatus: 'unverified' } } };
}
function legacy(model: string, inputTokens: number, outputTokens: number, cost: string): Metadata {
  return { modelMetadata: { provider: providerName, model, estimatedCostKrw: cost,
    usage: { inputTokens, outputTokens, estimatedCostKrw: cost } }, safetyMetadata: { generationStatus: 'completed' } };
}

// Actual getters, preflight, aggregate and SQL; readiness alone is synthetic. No provider pipeline.
jest.setTimeout(30_000);
native('provider estimate coverage postgres (owned SDK174/103, read-only actual getters)', () => {
  let setup: PrismaClient, readonly: ReturnType<typeof client>, service: ChatService;
  let ownerId: string, artistId: string, sessionId: string;
  let queries: Query[] = [], before: SavedRow[] | undefined;
  let findMany: jest.SpyInstance, findFirst: jest.SpyInstance, count: jest.SpyInstance;
  let userRead: jest.SpyInstance, artistRead: jest.SpyInstance;
  const forbidden = () => jest.fn(() => { throw new Error('Provider dispatch forbidden in read-only native fixture'); });
  const provider = { readiness: jest.fn(() => ({ provider: providerName, configured: true,
    status: 'provider_ready', messageKey: 'chat.generation.ready' })), generate: forbidden(), fallbackResult: forbidden() };

  async function flags() {
    const [row] = await readonly.$queryRaw<Array<{ database: string; port: string; defaultReadOnly: boolean; transactionReadOnly: boolean }>>`
      SELECT current_database() AS database, current_setting('port') AS port,
        current_setting('default_transaction_read_only') = 'on' AS "defaultReadOnly",
        current_setting('transaction_read_only') = 'on' AS "transactionReadOnly"`;
    return row;
  }
  async function sizeBound() {
    const [row] = await readonly.$queryRaw<Array<{ bytes: string }>>`SELECT pg_database_size(current_database())::text AS bytes`;
    if (Number(row.bytes) > MAX_BYTES) throw new Error('Owned QA database exceeds admitted byte limit');
  }
  async function snapshot() {
    return readonly.$queryRaw<SavedRow[]>`SELECT * FROM (
      SELECT 'users' AS relation, id::text AS id, xmin::text AS version, to_jsonb(t) AS payload FROM users t
      UNION ALL SELECT 'artists', id::text, xmin::text, to_jsonb(t) FROM artists t
      UNION ALL SELECT 'chat_sessions', id::text, xmin::text, to_jsonb(t) FROM chat_sessions t
      UNION ALL SELECT 'chat_messages', id::text, xmin::text, to_jsonb(t) FROM chat_messages t
      UNION ALL SELECT 'chat_feature_products', id::text, xmin::text, to_jsonb(t) FROM chat_feature_products t
      UNION ALL SELECT 'chat_feature_orders', id::text, xmin::text, to_jsonb(t) FROM chat_feature_orders t
      UNION ALL SELECT 'audit_events', id::text, xmin::text, to_jsonb(t) FROM audit_events t
      UNION ALL SELECT 'wallet_accounts', id::text, xmin::text, to_jsonb(t) FROM wallet_accounts t
      UNION ALL SELECT 'wallet_ledger', id::text, xmin::text, to_jsonb(t) FROM wallet_ledger t
    ) saved ORDER BY relation, id`;
  }
  function expectCoverage(value: unknown) {
    expect(value).toEqual(accounting); expect(Object.isFrozen(value)).toBe(true);
    expect(Object.keys(value as object)).toHaveLength(7);
  }
  function expectOpsRead() {
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({ where: { senderType: 'artist', chatFeatureOrderId: null,
      createdAt: { gte: day }, chatSession: { userId: ownerId } },
    select: { messageType: true, modelMetadata: true, safetyMetadata: true } });
    const messageSql = queries.filter(row => /"chat_messages"/.test(row.query) && /"model_metadata"/.test(row.query));
    expect(messageSql).toHaveLength(1);
    expect(messageSql[0].query).toMatch(/"chat_feature_order_id"\s+IS NULL/);
    expect(messageSql[0].query).toMatch(/"created_at"\s*>=/);
    expect(messageSql[0].query).not.toMatch(/"created_at"\s*</);
    expect(messageSql[0].query).toMatch(/"user_id"\s*=/);
    expect(messageSql[0].query).not.toMatch(/"body"/);
    expect(JSON.parse(messageSql[0].params)).toEqual(expect.arrayContaining([ownerId, 'artist']));
    expect(userRead).toHaveBeenCalledTimes(1);
    expect(userRead).toHaveBeenCalledWith({ where: { id: ownerId }, select: { id: true, email: true } });
  }
  function expectOldTotals(value: { usageByModel: unknown; estimatedCostKrw: string; fallbackCount: number }) {
    expect(value).toMatchObject({ fallbackCount: 2, estimatedCostKrw: '0.10' });
    expect(value.usageByModel).toEqual(expect.arrayContaining([
      { provider: providerName, model: 'fallback', responses: 1, inputTokens: 0, outputTokens: 0, estimatedCostKrw: '0.00' },
      { provider: providerName, model: 'legacy-current', responses: 1, inputTokens: 12, outputTokens: 24, estimatedCostKrw: '0.04' },
      { provider: providerName, model: 'legacy-future', responses: 1, inputTokens: 2, outputTokens: 3, estimatedCostKrw: '0.06' },
    ]));
    expect(value.usageByModel).toHaveLength(3);
    expect(JSON.stringify(value)).not.toContain(marker);
    expect(JSON.stringify(value)).not.toContain('excluded-');
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    const report = normalized(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const admitted = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-chat-failed-usage-read\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    if (!admitted || normalized(realpathSync(dirname(report))) !== normalized(dirname(report))
      || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== `/lumina_failed_cost_qa_${admitted[1]}` || process.env.NODE_ENV !== 'test'
      || process.env.DATABASE_URL !== url || process.env.CHAT_PROVIDER_NATIVE_MAX_DB_BYTES !== String(MAX_BYTES)
      || normalized(realpathSync(__filename)) !== normalized(CLEAN + '/server/src/chat/chat-provider-estimate-coverage.postgres.spec.ts')) {
      throw new Error('Exact source and fresh parent-owned loopback DB required');
    }
    for (const [file, pin] of [['chat.service.ts', SERVICE_SHA], ['llm-provider.adapter.ts', ADAPTER_SHA]]) {
      if (sha(readFileSync(resolve(__dirname, file))) !== pin) throw new Error('Frozen product source required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing SDK174 required');
    setup = new PrismaClient({ datasources: { db: { url } } }); await setup.$connect();
    const ro = new URL(url!); ro.searchParams.set('options', '-c default_transaction_read_only=on');
    readonly = client(ro.toString()); readonly.$on('query', event => { queries.push({ query: event.query, params: event.params }); });
    await readonly.$connect();
    const identity = await flags();
    const [migration] = await readonly.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished FROM "_prisma_migrations"`;
    if (identity.database !== parsed.pathname.slice(1) || identity.port !== '55432' || !identity.defaultReadOnly
      || !identity.transactionReadOnly || migration.applied !== 103 || migration.unfinished !== 0
      || await setup.user.count() || await setup.chatSession.count() || await setup.chatMessage.count()
      || await setup.chatFeatureOrder.count() || await setup.walletLedger.count()) {
      throw new Error('Fresh unseeded SDK174/103 DB required; never clear existing rows');
    }
    await sizeBound();
    const nonce = randomUUID();
    artistId = (await setup.artist.create({ data: { slug: `synthetic-estimate-${nonce}`,
      displayName: 'Synthetic Estimate Reader', status: 'active', createdAt: day, updatedAt: day } })).id;
    ownerId = (await setup.user.create({ data: { email: `synthetic-estimate-${nonce}@example.invalid`, createdAt: day, updatedAt: day } })).id;
    const other = await setup.user.create({ data: { email: `synthetic-other-${nonce}@example.invalid`, createdAt: day, updatedAt: day } });
    sessionId = (await setup.chatSession.create({ data: { userId: ownerId, artistId, status: 'active', createdAt: day, updatedAt: day } })).id;
    const otherSession = await setup.chatSession.create({ data: { userId: other.id, artistId, status: 'active', createdAt: day, updatedAt: day } });
    async function message(metadata: Metadata, overrides: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) {
      await setup.chatMessage.create({ data: { chatSessionId: sessionId, senderType: 'artist', messageType: 'text',
        body: null, createdAt: day, ...metadata, ...overrides } });
    }
    await message(greeting(), { messageType: 'opening_greeting' }); await message(failed());
    await message(legacy('legacy-current', 12, 24, '0.04'));
    // Existing gte-only query includes future rows; this unit must not invent an upper bound.
    await message(legacy('legacy-future', 2, 3, '0.06'), { createdAt: future });
    await message(legacy('excluded-yesterday', 900, 900, '99.00'), { createdAt: new Date(day.getTime() - 1) });
    await message(legacy('excluded-other-owner', 900, 900, '99.00'), { chatSessionId: otherSession.id });
    await message(legacy('excluded-system', 900, 900, '99.00'), { senderType: 'system' });
    await message({}, { senderType: 'user', createdAt: new Date(now.getTime() - 60_000) });
    await message({}, { senderType: 'user', createdAt: new Date(day.getTime() - 1) });
    await message({}, { senderType: 'user', chatSessionId: otherSession.id });
    // No product/price/order preparation, constraint bypass, wallet or audit write.
    await setup.$disconnect(); service = new ChatService(readonly as never, provider as never);
  });
  beforeEach(async () => {
    before = undefined; before = await snapshot();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout',
      'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'hrtime'] }).setSystemTime(now);
    queries = []; for (const call of Object.values(provider)) call.mockClear();
    findMany = jest.spyOn(readonly.chatMessage, 'findMany'); findFirst = jest.spyOn(readonly.chatMessage, 'findFirst');
    count = jest.spyOn(readonly.chatMessage, 'count'); userRead = jest.spyOn(readonly.user, 'findUnique');
    artistRead = jest.spyOn(readonly.artist, 'findFirst');
  });
  afterEach(async () => {
    try {
      if (!before) return;
      expect(queries.filter(row => /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b|\bFOR\s+(?:UPDATE|SHARE)\b/i.test(row.query))).toEqual([]);
      expect(await snapshot()).toEqual(before); await sizeBound();
      expect(await flags()).toMatchObject({ defaultReadOnly: true, transactionReadOnly: true });
      expect(provider.generate).not.toHaveBeenCalled(); expect(provider.fallbackResult).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    jest.useRealTimers(); jest.restoreAllMocks();
    try { await readonly?.$disconnect(); } finally { await setup?.$disconnect(); }
    // Parent owns cluster shutdown; all fixture data is retained, never deleted.
  });

  it('reads current-owner lower-bound SQL totals and adds unverified coverage without inventing failed usage', async () => {
    const result = await service.getProviderOpsStatus(ownerId);
    expect(result.usage).toMatchObject({ totalResponses: 4, failureCount: 2 }); expectOldTotals(result.usage);
    expectCoverage(result.usage.accounting); expectOpsRead();
    expect(result.serviceDay).toEqual({ timeZone: 'Asia/Seoul', startedAt: day.toISOString(), checkedAt: now.toISOString() });
    expect(result.guard).toMatchObject({ requestRemaining: 46, failureRemaining: 3, canAttemptProvider: true });
    expect(result).toMatchObject({ walletMutation: false, settlementMutation: false, secretsReturned: false });
    expect(queries).toHaveLength(2); expect(artistRead).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled();
    expect(provider.readiness).toHaveBeenCalledTimes(1);
  });
  it('projects the same qualifier through actual SQL usage-summary preflight with unchanged old limits and totals', async () => {
    const result = await service.getUsageSummary(ownerId, { artistId });
    expectCoverage(result.providerOps.accounting); expectOldTotals(result.providerOps); expectOpsRead();
    expect(result).toMatchObject({ canSend: true, canGenerate: true, dailyUsed: 1, dailyRemaining: 49,
      cooldownRemainingSeconds: 0, providerDailyUsed: 4, providerDailyRemaining: 46, providerDailyFailureCount: 2,
      providerDailyFailureRemaining: 3, serviceDayStartAt: day.toISOString(), walletMutation: false,
      settlementEligible: false, providerCall: false, rawMessagesExposed: false });
    expect(artistRead).toHaveBeenCalledTimes(1); expect(artistRead).toHaveBeenCalledWith({ where: { id: artistId, status: 'active' },
      select: { id: true, slug: true, displayName: true } });
    expect(findFirst).toHaveBeenCalledTimes(1); expect(findFirst).toHaveBeenCalledWith({ where: { senderType: 'user',
      chatFeatureOrderId: null, createdAt: { gte: new Date(now.getTime() - 30_000) }, chatSession: { userId: ownerId, artistId } },
    orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } });
    expect(count).toHaveBeenCalledTimes(1); expect(count).toHaveBeenCalledWith({ where: { senderType: 'user',
      chatFeatureOrderId: null, createdAt: { gte: day }, chatSession: { userId: ownerId, artistId } } });
    expect(queries).toHaveLength(5); expect(provider.readiness).toHaveBeenCalledTimes(1);
  });
});

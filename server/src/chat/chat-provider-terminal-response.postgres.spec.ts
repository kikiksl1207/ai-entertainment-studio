import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CHAT_FEATURE_PRODUCT_POLICIES } from './chat-feature-policy';
import { ChatService } from './chat.service';
import { ChatLlmProviderRequestError, type ChatFailedProviderResponse } from './llm-provider.adapter';

const ROOT = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const CLEAN = 'E:/Codex/LuminaStage/story-completion-20261003';
const SERVICE_SHA = '5c4497e64f86b499cee0c88695747f48769fb97d9a7a9403ab007c24202b8836';
const ADAPTER_SHA = 'c96ca7266299a1568db62bc24f812bce97aba3995c783d9d938144e00b0cfabc';
const POLICY_SHA = 'e891272c0e79f7b0cdaa5c9fe0f31e45cfb63bf27e6ea33004a5ced8fc8589a5';
const MAX_DATABASE_BYTES = 50_000_000;
const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const normalized = (file: string) => resolve(file).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const client = (databaseUrl: string) => new PrismaClient({
  datasources: { db: { url: databaseUrl } }, log: [{ level: 'query', emit: 'event' }],
});
type Probe = {
  recordFailedProviderResponse(owner: string, session: string, order: string | null,
    error: ChatLlmProviderRequestError): Promise<boolean>;
  failFeatureOrderAndRestoreLumina(owner: string, order: string, reason: string): Promise<unknown>;
  logger: { warn(message: string): void };
};
type TableState = { relation: string; rows: number; digest: string };
type SavedState = { schema: string; tables: TableState[] };
const rawMarker = 'SYNTHETIC_PARTIAL_NOT_FOR_STORAGE';
const reason = 'provider_incomplete_response';

// Direct private-helper integration only: no generate, greeting, adapter dispatch or mocked fetch.
jest.setTimeout(30_000);
native('provider terminal response postgres (owned SDK174/103, direct helpers only)', () => {
  let db: ReturnType<typeof client>, probe: Probe;
  let ownerId: string, otherId: string, sessionId: string, orderId: string, walletId: string;
  let price: Prisma.Decimal, before: SavedState | undefined;
  let tableNames: string[], queryCount = 0;
  let mutationSql: string[] = [], allowedTables = new Set<string>();
  let warn: jest.SpyInstance;
  const forbidden = () => jest.fn(() => { throw new Error('Provider use forbidden in direct native helper scope'); });
  const provider = { readiness: forbidden(), generate: forbidden(), fallbackResult: forbidden() };

  beforeAll(async () => {
    const parsed = new URL(url!);
    const report = normalized(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const admitted = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-chat-provider-terminal-response\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    if (!admitted || normalized(realpathSync(dirname(report))) !== normalized(dirname(report))
      || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== `/lumina_failed_cost_qa_${admitted[1]}`
      || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== url
      || process.env.CHAT_PROVIDER_NATIVE_MAX_DB_BYTES !== String(MAX_DATABASE_BYTES)
      || normalized(realpathSync(__filename)) !== normalized(CLEAN + '/server/src/chat/chat-provider-terminal-response.postgres.spec.ts')) {
      throw new Error('Exact nested source and new parent-owned native environment required');
    }
    for (const [file, expected] of [['chat.service.ts', SERVICE_SHA], ['llm-provider.adapter.ts', ADAPTER_SHA],
      ['chat-feature-policy.ts', POLICY_SHA]]) {
      if (sha(readFileSync(resolve(__dirname, file))) !== expected) throw new Error('Frozen product source required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing SDK174 required');
    db = client(url!);
    db.$on('query', event => {
      queryCount += 1;
      if (/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/.test(event.query)) mutationSql.push(event.query);
    });
    await db.$connect();
    const [identity] = await db.$queryRaw<Array<{ database: string; port: string }>>`
      SELECT current_database() AS database, current_setting('port') AS port`;
    const [migrations] = await db.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished
      FROM "_prisma_migrations"`;
    if (identity.database !== parsed.pathname.slice(1) || identity.port !== '55432'
      || migrations.applied !== 103 || migrations.unfinished !== 0
      || await db.user.count() || await db.chatSession.count() || await db.auditEvent.count()
      || await db.chatMessage.count() || await db.walletLedger.count() || await db.chatFeatureOrder.count()) {
      throw new Error('New unseeded owned 103-migration database required; never clear existing data');
    }
    await sizeBound();
    const relations = await db.$queryRaw<Array<{ name: string }>>`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`;
    tableNames = relations.map(row => row.name);
    if (!tableNames.length || tableNames.length > 250 || tableNames.some(name => !/^[a-z_][a-z0-9_]*$/i.test(name))) {
      throw new Error('Bounded existing public table catalog required');
    }
    const policy = CHAT_FEATURE_PRODUCT_POLICIES.find(row => row.sku === 'CHAT_DEEP_REPLY');
    if (!policy || policy.priceLumina !== 2 || policy.status !== 'active' || policy.mvpLocked) {
      throw new Error('Unchanged current known product price required');
    }
    const nonce = randomUUID();
    // Synthetic rows are created once and retained; existing seeded products are never updated.
    await db.$transaction(async tx => {
      ownerId = (await tx.user.create({ data: { email: `synthetic-terminal-owner-${nonce}@example.invalid` } })).id;
      otherId = (await tx.user.create({ data: { email: `synthetic-terminal-other-${nonce}@example.invalid` } })).id;
      const artist = await tx.artist.create({ data: { slug: `synthetic-terminal-${nonce}`,
        displayName: 'Synthetic native helper fixture', status: 'active' } });
      sessionId = (await tx.chatSession.create({ data: { userId: ownerId, artistId: artist.id, status: 'active' } })).id;
      const existing = await tx.chatFeatureProduct.findUnique({ where: { sku: policy.sku } });
      if (existing && (existing.featureType !== policy.featureType || existing.status !== 'active'
        || !existing.priceLumina.equals(policy.priceLumina))) throw new Error('Baseline known product must match');
      const product = existing ?? await tx.chatFeatureProduct.create({ data: { sku: policy.sku, name: policy.name,
        featureType: policy.featureType, priceLumina: policy.priceLumina, status: 'active', metadata: { synthetic: true } } });
      price = product.priceLumina;
      walletId = (await tx.walletAccount.create({ data: { userId: ownerId, cachedBalance: '10.00' } })).id;
      const debit = await tx.walletLedger.create({ data: { walletAccountId: walletId, direction: 'debit',
        amount: price, ledgerType: 'chat_feature_spend', referenceType: 'chat_feature_product', referenceId: product.id,
        idempotencyKey: `synthetic-terminal-debit-${nonce}` } });
      orderId = (await tx.chatFeatureOrder.create({ data: { userId: ownerId, artistId: artist.id,
        chatSessionId: sessionId, chatFeatureProductId: product.id, walletLedgerId: debit.id,
        status: 'completed', idempotencyKey: `synthetic-terminal-order-${nonce}` } })).id;
    });
    probe = new ChatService(db as never, provider as never) as unknown as Probe;
    warn = jest.spyOn(probe.logger, 'warn').mockImplementation(() => undefined);
  });

  async function sizeBound() {
    const [row] = await db.$queryRaw<Array<{ bytes: bigint }>>`SELECT pg_database_size(current_database()) AS bytes`;
    expect(row.bytes <= BigInt(MAX_DATABASE_BYTES)).toBe(true);
  }

  async function snapshot(): Promise<SavedState> {
    await sizeBound();
    const [schema] = await db.$queryRaw<Array<{ digest: string }>>`
      SELECT md5(string_agg(item, E'\n' ORDER BY item)) AS digest FROM (
        SELECT 'table|' || c.relname || '|' || c.relkind::text AS item
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
        UNION ALL SELECT 'column|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
          || '|' || a.attnotnull::text || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
          FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
        UNION ALL SELECT 'constraint|' || c.conname || '|' || pg_get_constraintdef(c.oid)
          FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'
        UNION ALL SELECT 'index|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public'
        UNION ALL SELECT 'enum|' || t.typname || '|' || e.enumsortorder::text || '|' || e.enumlabel
          FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
      ) definitions`;
    // Names come only from the bounded owned catalog above, not from user inputs.
    const sql = tableNames.map(name => `SELECT '${name}'::text AS relation, count(*)::int AS rows,
      md5(coalesce(string_agg(md5(to_jsonb(t)::text || ':' || t.xmin::text), ','
      ORDER BY md5(to_jsonb(t)::text || ':' || t.xmin::text)), '')) AS digest FROM "public"."${name}" t`).join(' UNION ALL ');
    const tables = await db.$queryRawUnsafe<TableState[]>(`${sql} ORDER BY relation`);
    expect(tables.reduce((count, table) => count + table.rows, 0)).toBeLessThanOrEqual(5_000);
    return { schema: schema.digest, tables };
  }

  function failed(inputTokens: unknown = 41, outputTokens: unknown = 23) {
    return new ChatLlmProviderRequestError(rawMarker, reason, 'synthetic-request-not-durable', {
      responseStatus: 'incomplete', reason: 'max_output_tokens', model: 'synthetic-model',
      inputTokens, outputTokens, estimatedCostKrw: 99, billingStatus: 'claimed-paid',
      output_text: rawMarker, requestId: rawMarker, rawRequest: rawMarker,
    } as unknown as ChatFailedProviderResponse);
  }
  async function audit(error: ChatLlmProviderRequestError, order: string | null = null) {
    const old = new Set((await db.auditEvent.findMany({ select: { id: true } })).map(row => row.id));
    expect(await probe.recordFailedProviderResponse(ownerId, sessionId, order, error)).toBe(true);
    const inserted = (await db.auditEvent.findMany()).filter(row => !old.has(row.id));
    expect(inserted).toHaveLength(1);
    return inserted[0];
  }
  function expectAudit(row: Awaited<ReturnType<typeof audit>>, evidence: ChatFailedProviderResponse, order: string | null = null) {
    expect(row.actorUserId).toBe(ownerId);
    expect(row.actorType).toBe('system');
    expect(row.action).toBe('chat_provider_response_failed');
    expect(row.targetType).toBe(order ? 'chat_feature_order' : 'chat_session');
    expect(row.targetId).toBe(order ?? sessionId);
    expect(row.beforeData).toBeNull(); expect(row.afterData).toBeNull();
    expect(row.metadata).toEqual({ schemaVersion: '2026-10-15.chat-provider-failure-v1',
      provider: 'openai', failedProviderResponse: evidence });
    expect(JSON.stringify(row.metadata)).not.toContain(rawMarker);
    expect(JSON.stringify(row.metadata)).not.toContain('synthetic-request-not-durable');
  }

  beforeEach(async () => {
    before = undefined; allowedTables = new Set();
    before = await snapshot(); mutationSql = []; warn.mockClear();
    Object.values(provider).forEach(call => call.mockClear());
  });
  afterEach(async () => {
    if (!before) return;
    const after = await snapshot();
    expect(after.schema).toBe(before.schema);
    expect(after.tables.filter(row => !allowedTables.has(row.relation)))
      .toEqual(before.tables.filter(row => !allowedTables.has(row.relation)));
    expect(await db.chatMessage.count()).toBe(0);
    expect(mutationSql.some(sql => /\b(?:DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/.test(sql))).toBe(false);
    for (const sql of mutationSql) {
      const table = /\b(?:INSERT INTO|UPDATE)\s+"public"\."([a-z_]+)"/i.exec(sql)?.[1];
      expect(table !== undefined && allowedTables.has(table)).toBe(true);
    }
    Object.values(provider).forEach(call => expect(call).not.toHaveBeenCalled());
  });
  afterAll(async () => { jest.restoreAllMocks(); await db?.$disconnect(); });

  it('persists only bounded failure numbers and owned audit linkage, never partial text or cost claims', async () => {
    allowedTables.add('audit_events');
    const error = failed();
    expect(Object.isFrozen(error.failedResponse)).toBe(true);
    expect(error.failedResponse).toEqual({ responseStatus: 'incomplete', reason: 'max_output_tokens', model: 'synthetic-model',
      inputTokens: 41, outputTokens: 23, estimatedCostKrw: null, billingStatus: 'unverified' });
    expectAudit(await audit(error), error.failedResponse!);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stores unavailable token counts as JSON null without changing old usage or billing authority', async () => {
    allowedTables.add('audit_events');
    const error = failed('41', Number.POSITIVE_INFINITY);
    expect(error.failedResponse?.inputTokens).toBeNull();
    expect(error.failedResponse?.outputTokens).toBeNull();
    expectAudit(await audit(error), error.failedResponse!);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns false on an actual audit foreign-key failure with only a static warning and no refund', async () => {
    allowedTables.add('audit_events'); // The rejected INSERT is allowed; its table contents must remain identical.
    expect(await probe.recordFailedProviderResponse(randomUUID(), sessionId, null, failed())).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Character chat provider failure evidence was not recorded');
    expect((await snapshot()).tables).toEqual(before!.tables);
    expect(mutationSql.filter(sql => /\bINSERT INTO\s+"public"\."audit_events"/.test(sql))).toHaveLength(1);
  });

  it('uses the original refund method once across duplicate recovery, then writes one separate audit', async () => {
    allowedTables = new Set(['chat_feature_orders', 'wallet_accounts', 'wallet_ledger', 'audit_events']);
    const originalWallet = await db.walletAccount.findUniqueOrThrow({ where: { id: walletId } });
    const originalOrder = await db.chatFeatureOrder.findUniqueOrThrow({ where: { id: orderId } });
    const originalLedgers = await db.walletLedger.findMany({ orderBy: { id: 'asc' } });
    await expect(probe.failFeatureOrderAndRestoreLumina(ownerId, orderId, 'generation_failed'))
      .resolves.toMatchObject({ id: orderId, status: 'failed' });
    const recovered = await snapshot();
    await expect(probe.failFeatureOrderAndRestoreLumina(ownerId, orderId, 'generation_failed'))
      .resolves.toMatchObject({ id: orderId, status: 'failed' });
    expect(await snapshot()).toEqual(recovered);
    const refunds = await db.walletLedger.findMany({ where: { idempotencyKey: `chat-feature-refund:${orderId}` } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount.equals(price)).toBe(true);
    expect(refunds[0]).toMatchObject({ direction: 'credit', ledgerType: 'refund', referenceType: 'chat_feature_order', referenceId: orderId });
    const wallet = await db.walletAccount.findUniqueOrThrow({ where: { id: walletId } });
    expect(wallet.cachedBalance.equals(originalWallet.cachedBalance.plus(price))).toBe(true);
    const stableFields = (row: object) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updatedAt'));
    expect(stableFields(wallet)).toEqual(stableFields({ ...originalWallet, cachedBalance: originalWallet.cachedBalance.plus(price) }));
    expect(stableFields(await db.chatFeatureOrder.findUniqueOrThrow({ where: { id: orderId } })))
      .toEqual(stableFields({ ...originalOrder, status: 'failed' }));
    expect(await db.walletLedger.findMany({ where: { id: { in: originalLedgers.map(row => row.id) } }, orderBy: { id: 'asc' } }))
      .toEqual(originalLedgers);
    const error = failed();
    expectAudit(await audit(error, orderId), error.failedResponse!, orderId);
    expect((await db.walletLedger.findMany({ where: { idempotencyKey: `chat-feature-refund:${orderId}` } }))).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { targetType: 'chat_feature_order', targetId: orderId } })).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does no audit SQL without failure evidence and refuses recovery for a different owner without writes', async () => {
    const startQueries = queryCount;
    expect(await probe.recordFailedProviderResponse(ownerId, sessionId, null,
      new ChatLlmProviderRequestError('Synthetic old three-argument error', 'provider_request_failed'))).toBe(false);
    expect(queryCount).toBe(startQueries);
    await expect(probe.failFeatureOrderAndRestoreLumina(otherId, orderId, 'generation_failed')).resolves.toBeNull();
    expect(mutationSql).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

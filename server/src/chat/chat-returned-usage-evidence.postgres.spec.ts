import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ChatService } from './chat.service';
import { captureChatReturnedUsageEvidence, type ChatReturnedUsageEvidence } from './chat-returned-usage-evidence';

// Author UNRUN. Parent owns the fresh SDK174/103 cluster and first execution.
const CLEAN = 'E:/Codex/LuminaStage/story-completion-20261003';
const SERVICE_SHA = '1f5d2fc6a6d1b9df9c36688857e72f1d49dd6238bca113de89bdd756a5cf95b5';
const HELPER_SHA = 'bbb3d3cf69a306e49898ec6dfa36184f5adbe88e2788337917b1e175f836f3df';
const MAX_BYTES = 50_000_000;
const ACTION = 'chat_provider_return_handling_failed';
const PRIVATE_MARKER = 'SYNTHETIC_RETURN_BODY_ERROR_KEY_NOT_FOR_AUDIT';
const WARNING = 'Character chat returned usage evidence was not recorded';
const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const normalized = (file: string) => resolve(file).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const client = (databaseUrl: string) => new PrismaClient({ datasources: { db: { url: databaseUrl } },
  log: [{ level: 'query', emit: 'event' }] });
type TableState = { relation: string; rows: string; digest: string };
type AuditState = { id: string; version: string; digest: string };
type AuditReason = 'source_conflict' | 'storage_or_processing_failure';
type AuditWriter = { recordRejectedReturnedUsage(actor: string, target: string, order: null,
  evidence: ChatReturnedUsageEvidence, reason: AuditReason): Promise<boolean> };

jest.setTimeout(30_000);
native('returned usage audit postgres (owned SDK174/103, actual private method only)', () => {
  let setup: PrismaClient, writer: ReturnType<typeof client>, reader: ReturnType<typeof client>, service: ChatService;
  let ownerId: string, otherId: string, targetId: string;
  let before: TableState[] | undefined, auditBefore: AuditState[];
  let expectedAdded = 0, queries: string[] = [];
  let create: jest.SpyInstance, warn: jest.SpyInstance;
  const forbidden = () => jest.fn(() => { throw new Error('Provider and generation pipeline forbidden in audit-only fixture'); });
  const provider = { generate: forbidden(), fallbackResult: forbidden(), readiness: forbidden() };

  async function flags() {
    const [row] = await reader.$queryRaw<Array<{ database: string; port: string; readonly: boolean }>>`
      SELECT current_database() AS database, current_setting('port') AS port,
        current_setting('default_transaction_read_only') = 'on'
        AND current_setting('transaction_read_only') = 'on' AS readonly`;
    return row;
  }
  async function sizeBound() {
    const [row] = await reader.$queryRaw<Array<{ bytes: string }>>`SELECT pg_database_size(current_database())::text AS bytes`;
    if (Number(row.bytes) > MAX_BYTES) throw new Error('Owned QA database exceeds admitted byte limit');
  }
  async function snapshot(): Promise<TableState[]> {
    const tables = await reader.$queryRaw<Array<{ relation: string }>>`
      SELECT table_name AS relation FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    if (!tables.length || tables.length > 256) throw new Error('Bounded owned schema required');
    const result: TableState[] = [];
    for (const { relation } of tables) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(relation)) throw new Error('Unexpected owned table identifier');
      // Catalog-only identifiers; return count/JSON+xmin fingerprints, never raw rows.
      const [row] = await reader.$queryRawUnsafe<Array<{ rows: string; digest: string }>>(
        `SELECT count(*)::text AS rows, md5(COALESCE(string_agg(` +
        `md5(to_jsonb(t)::text || ':' || t.xmin::text), '' ORDER BY to_jsonb(t)::text, t.xmin::text), '')) AS digest ` +
        `FROM "public"."${relation}" t`);
      result.push({ relation, ...row });
    }
    return result;
  }
  async function auditSnapshot() {
    return reader.$queryRaw<AuditState[]>`
      SELECT id::text, xmin::text AS version, md5(to_jsonb(t)::text) AS digest
      FROM audit_events t ORDER BY id`;
  }
  const record = (actor: string, evidence: ChatReturnedUsageEvidence, reason: AuditReason) =>
    (service as unknown as AuditWriter).recordRejectedReturnedUsage(actor, targetId, null, evidence, reason);
  function capture(status: 'completed' | 'unreported', valid: boolean) {
    const evidence = captureChatReturnedUsageEvidence({ body: PRIVATE_MARKER, raw: PRIVATE_MARKER,
      error: PRIVATE_MARKER, requestId: PRIVATE_MARKER, configToken: PRIVATE_MARKER,
      usage: { provider: 'openai', model: valid ? 'gpt-4.1-mini' : PRIVATE_MARKER,
        inputTokens: valid ? 9 : -1, outputTokens: valid ? 4 : Infinity, estimatedCostKrw: PRIVATE_MARKER },
      safetyMetadata: { providerResponseStatus: status, providerCompletionVerified: true,
        requestId: PRIVATE_MARKER, error: PRIVATE_MARKER } });
    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('Actual producer-shaped capture required');
    return evidence;
  }

  beforeAll(async () => {
    const report = normalized(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const admitted = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-chat-post-provider-usage\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expectedUrl = admitted ? `postgresql://lumina_qa@127.0.0.1:55432/lumina_failed_cost_qa_${admitted[1]}` : null;
    if (!admitted || url !== expectedUrl || process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test'
      || process.env.CHAT_PROVIDER_NATIVE_MAX_DB_BYTES !== String(MAX_BYTES)
      || normalized(realpathSync(dirname(report))) !== normalized(dirname(report))
      || normalized(realpathSync(__filename)) !== normalized(CLEAN + '/server/src/chat/chat-returned-usage-evidence.postgres.spec.ts')) {
      throw new Error('Exact source and fresh parent-owned loopback cluster required');
    }
    for (const [file, pin] of [['chat.service.ts', SERVICE_SHA], ['chat-returned-usage-evidence.ts', HELPER_SHA]]) {
      if (sha(readFileSync(resolve(__dirname, file))) !== pin) throw new Error('Frozen product source required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing SDK174 required');
    setup = new PrismaClient({ datasources: { db: { url } } }); await setup.$connect();
    const ro = new URL(url!); ro.searchParams.set('options', '-c default_transaction_read_only=on');
    reader = client(ro.toString()); reader.$on('query', event => { queries.push(event.query); }); await reader.$connect();
    const [migration] = await reader.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished FROM "_prisma_migrations"`;
    const identity = await flags();
    if (identity.database !== expectedUrl!.split('/').at(-1) || identity.port !== '55432' || !identity.readonly
      || migration.applied !== 103 || migration.unfinished !== 0 || await setup.user.count()
      || await setup.auditEvent.count() || await setup.chatSession.count() || await setup.chatMessage.count()
      || await setup.chatFeatureOrder.count() || await setup.walletAccount.count() || await setup.walletLedger.count()) {
      throw new Error('Fresh unseeded SDK174/103 cluster required; never clear existing rows');
    }
    await sizeBound();
    ownerId = randomUUID(); otherId = randomUUID(); targetId = randomUUID();
    await setup.user.create({ data: { id: ownerId, email: `synthetic-return-${ownerId}@example.invalid` } });
    await setup.user.create({ data: { id: otherId, email: `synthetic-other-${otherId}@example.invalid` } });
    // targetId is deliberately opaque: AuditEvent does not establish session ownership.
    await setup.auditEvent.create({ data: { actorUserId: otherId, actorType: 'system', action: 'synthetic_fixture_only',
      targetType: 'chat_session', targetId: randomUUID(), metadata: { fixture: 'other-owned-before' } } });
    await setup.$disconnect();
    writer = client(url!); writer.$on('query', event => { queries.push(event.query); }); await writer.$connect();
    service = new ChatService(writer as never, provider as never);
  });
  beforeEach(async () => {
    before = undefined; before = await snapshot(); auditBefore = await auditSnapshot();
    queries = []; expectedAdded = 0;
    for (const method of Object.values(provider)) method.mockClear();
    create = jest.spyOn(writer.auditEvent, 'create');
    const logger = (service as unknown as { logger: { warn(message: string): void } }).logger;
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(async () => {
    try {
      if (!before) return;
      const after = await snapshot(), auditAfter = await auditSnapshot();
      expect(after.filter(row => row.relation !== 'audit_events')).toEqual(before.filter(row => row.relation !== 'audit_events'));
      expect(Number(after.find(row => row.relation === 'audit_events')!.rows))
        .toBe(Number(before.find(row => row.relation === 'audit_events')!.rows) + expectedAdded);
      const known = new Set(auditBefore.map(row => row.id));
      expect(auditAfter.filter(row => known.has(row.id))).toEqual(auditBefore);
      if (!expectedAdded) expect(after).toEqual(before);
      const mutations = queries.filter(query => /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(query));
      expect(mutations).toHaveLength(1); expect(mutations[0]).toMatch(/INSERT INTO (?:"public"\.)?"audit_events"/);
      expect(mutations[0]).not.toMatch(/\b(?:UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
      expect(await flags()).toMatchObject({ readonly: true }); await sizeBound();
      for (const method of Object.values(provider)) expect(method).not.toHaveBeenCalled();
      expect(sha(readFileSync(resolve(__dirname, 'chat.service.ts')))).toBe(SERVICE_SHA);
      expect(sha(readFileSync(resolve(__dirname, 'chat-returned-usage-evidence.ts')))).toBe(HELPER_SHA);
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    try { await reader?.$disconnect(); } finally {
      try { await writer?.$disconnect(); } finally { await setup?.$disconnect(); }
    }
    // Parent wrapper stops only its own cluster gracefully; retain every fixture row.
  });

  it('RETURNED.NATIVE.01 actual audit stores producer-shaped safe evidence and supplied actor/opaque target only', async () => {
    const evidence = capture('completed', true);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence).toEqual({ contract: 'chat-returned-usage-evidence-v1', responseStatus: 'completed', completionVerified: true,
      model: 'gpt-4.1-mini', inputTokens: 9, outputTokens: 4, cachedInputTokens: null, normalizedUsageOnly: true,
      semanticQualityVerified: false, actualProviderCostKrw: null, providerInvoiceVerified: false, billingStatus: 'unverified' });
    expectedAdded = 1;
    expect(await record(ownerId, evidence, 'source_conflict')).toBe(true);
    expect(create).toHaveBeenCalledTimes(1); expect(warn).not.toHaveBeenCalled();
    const rows = await reader.auditEvent.findMany({ where: { actorUserId: ownerId, action: ACTION },
      select: { actorUserId: true, actorType: true, action: true, targetType: true, targetId: true,
        beforeData: true, afterData: true, metadata: true } });
    expect(rows).toEqual([{ actorUserId: ownerId, actorType: 'system', action: ACTION, targetType: 'chat_session', targetId,
      beforeData: null, afterData: null, metadata: { schemaVersion: '2026-10-15.chat-returned-usage-v1', provider: 'openai',
        stage: 'application_after_provider_return', reason: 'source_conflict', applicationOutcome: 'rejected_or_unconfirmed',
        returnedUsageEvidence: evidence } }]);
    expect(JSON.stringify(rows[0].metadata)).not.toContain(PRIVATE_MARKER);
    expect(await reader.auditEvent.count({ where: { actorUserId: otherId } })).toBe(1);
    expect(await reader.chatMessage.count()).toBe(0);
  });
  it('RETURNED.NATIVE.02 real readonly SQL rejection returns false/static warning and leaves all tables unchanged', async () => {
    const evidence = capture('unreported', false);
    expect(evidence).toMatchObject({ responseStatus: 'unreported', completionVerified: false, model: null,
      inputTokens: null, outputTokens: null, actualProviderCostKrw: null, billingStatus: 'unverified', semanticQualityVerified: false });
    expect(captureChatReturnedUsageEvidence({ usage: { provider: 'local' } })).toBeNull();
    jest.restoreAllMocks();
    service = new ChatService(reader as never, provider as never);
    create = jest.spyOn(reader.auditEvent, 'create');
    const logger = (service as unknown as { logger: { warn(message: string): void } }).logger;
    warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const saved = await reader.auditEvent.count({ where: { actorUserId: ownerId, action: ACTION } });
    expect(await flags()).toMatchObject({ readonly: true });
    expect(await record(ownerId, evidence, 'storage_or_processing_failure')).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledWith(WARNING);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE_MARKER);
    expect(await reader.auditEvent.count({ where: { actorUserId: ownerId, action: ACTION } })).toBe(saved);
  });
});

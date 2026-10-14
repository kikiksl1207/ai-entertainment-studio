import { ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ChatService } from './chat.service';
import { captureChatReturnedUsageEvidence } from './chat-returned-usage-evidence';
import type { ChatGenerationResult } from './llm-provider.adapter';

// Author UNRUN. Parent alone dispatches the fresh owned SDK174/103 cluster.
const CLEAN = 'E:/Codex/LuminaStage/story-completion-20261003';
const SERVICE_SHA = 'a0b2404e174663b5ecf4fca105344c0bf320617a9cdb3ec24f09dbeb795103a9';
const HELPER_SHA = 'bbb3d3cf69a306e49898ec6dfa36184f5adbe88e2788337917b1e175f836f3df';
const MAX_BYTES = 50_000_000;
const ACTION = 'chat_provider_return_handling_failed';
const BODY_MARKER = 'SYNTHETIC_GREETING_RETURN_BODY_NOT_FOR_AUDIT';
const SECRET_MARKER = 'SYNTHETIC_ERROR_REQUEST_KEY_NOT_FOR_AUDIT';
const WARNING = 'Character chat returned usage evidence was not recorded';
const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const normalized = (file: string) => resolve(file).replace(/\\/g, '/').toLowerCase();
const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const client = (databaseUrl: string) => new PrismaClient({ datasources: { db: { url: databaseUrl } },
  log: [{ level: 'query', emit: 'event' }] });
type TableState = { relation: string; rows: string; digest: string };
type AuditState = { id: string; version: string; digest: string };
type Session = Prisma.ChatSessionGetPayload<{ include: { artist: true; chatPersona: true } }>;
type Message = Prisma.ChatMessageGetPayload<{}>;
type Candidate = {
  body: string; source: 'provider'; providerCall: true; providerAttempted: true;
  generated: ChatGenerationResult;
  toneCandidate: { contractVersion: string; characterSlug: string; guideKo: string; guideSource: string;
    toneTags: string[]; personaTags: string[]; displaySafe: true; rawPersonaPromptStored: false };
};
type NativeGreeting = {
  ensureSessionOpeningGreeting(actor: string, session: Session): Promise<unknown>;
  buildOpeningGreetingCandidate(actor: string, session: Session,
    onProviderReturn?: (generated: ChatGenerationResult) => void): Promise<Candidate>;
  assertArtistPersonaSelectionCurrent(selection: unknown, tx?: Prisma.TransactionClient): Promise<void>;
  openingGreetingResponse(message: Message, options: { cacheHit: boolean; providerCall: boolean }): unknown;
  logger: { warn(message: string): void };
};

jest.setTimeout(30_000);
native('greeting returned usage postgres (owned SDK174/103, actual ensure and rollback)', () => {
  let setup: PrismaClient, writer: ReturnType<typeof client>, reader: ReturnType<typeof client>;
  let service: ChatService, view: NativeGreeting, session: Session;
  let ownerId: string, otherId: string, absentActor: string;
  let before: TableState[] | undefined, auditBefore: AuditState[];
  let expectedAdded = 0, queries: string[] = [];
  let create: jest.SpyInstance, warn: jest.SpyInstance, builder: jest.SpyInstance;
  let response: jest.SpyInstance, currentness: jest.SpyInstance, inserted: Message | undefined;
  const forbidden = () => jest.fn(() => { throw new Error('Actual provider/refund path forbidden in greeting SQL fixture'); });
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
      // Catalog identifiers only; export count/JSON+xmin fingerprints, never rows or params.
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
  function generated(status: 'completed' | 'unreported'): ChatGenerationResult {
    return { body: BODY_MARKER, usage: { provider: 'openai', model: 'gpt-4.1-mini',
      inputTokens: 9, outputTokens: 4, estimatedCostKrw: '12345.00' },
      safetyMetadata: { providerResponseStatus: status, providerCompletionVerified: true,
        rawResponse: SECRET_MARKER, error: SECRET_MARKER, requestId: SECRET_MARKER, configToken: SECRET_MARKER } };
  }
  function failAfterInsert(original: Error, status: 'completed' | 'unreported') {
    const returned = generated(status);
    // Synthetic builder/approval boundaries only; ensure, capture, metadata, SQL and audit stay real.
    builder.mockImplementation(async (_actor: string, actual: Session,
      onProviderReturn?: (result: ChatGenerationResult) => void): Promise<Candidate> => {
      expect(actual.id).toBe(session.id);
      expect(onProviderReturn).toEqual(expect.any(Function));
      onProviderReturn!(returned);
      return { body: returned.body, source: 'provider', providerCall: true, providerAttempted: true,
        generated: returned, toneCandidate: { contractVersion: 'synthetic-greeting-sql-only',
          characterSlug: session.artist.slug, guideKo: 'Synthetic fixture', guideSource: 'synthetic',
          toneTags: [], personaTags: [], displaySafe: true, rawPersonaPromptStored: false } };
    });
    response.mockImplementation((message: Message, options: { cacheHit: boolean; providerCall: boolean }) => {
      inserted = message;
      expect(message.chatSessionId).toBe(session.id);
      expect(message.messageType).toBe('opening_greeting');
      expect(message.body).toBe(BODY_MARKER);
      expect(options).toEqual({ cacheHit: false, providerCall: true });
      // The actual INSERT has resolved; rejection here must roll back the real callback transaction.
      throw original;
    });
    return captureChatReturnedUsageEvidence(returned);
  }

  beforeAll(async () => {
    const report = normalized(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const admitted = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261015-chat-greeting-returned-usage\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    const expectedUrl = admitted ? `postgresql://lumina_qa@127.0.0.1:55432/lumina_failed_cost_qa_${admitted[1]}` : null;
    if (!admitted || url !== expectedUrl || process.env.DATABASE_URL !== url || process.env.NODE_ENV !== 'test'
      || process.env.CHAT_PROVIDER_NATIVE_MAX_DB_BYTES !== String(MAX_BYTES)
      || normalized(realpathSync(dirname(report))) !== normalized(dirname(report))
      || normalized(realpathSync(__filename)) !== normalized(CLEAN + '/server/src/chat/chat-greeting-returned-usage.postgres.spec.ts')) {
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
      || migration.applied !== 103 || migration.unfinished !== 0) {
      throw new Error('Fresh owned SDK174/103 identity and migration admission required');
    }
    const privateCounts = { users: await reader.user.count(), audit_events: await reader.auditEvent.count(),
      chat_sessions: await reader.chatSession.count(), chat_messages: await reader.chatMessage.count(),
      chat_feature_orders: await reader.chatFeatureOrder.count(), wallet_accounts: await reader.walletAccount.count(),
      wallet_ledger: await reader.walletLedger.count() };
    for (const [relation, count] of Object.entries(privateCounts)) {
      if (count !== 0) throw new Error('Fresh owned native admission has private rows: ' + relation);
    }
    // Pinned migration0045 inserts one public Artist; UUID/creation timestamps are database defaults.
    const [publicArtists] = await reader.$queryRaw<Array<{ total: number; admitted: number }>>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE slug = 'oh-hyerin'
          AND display_name = ${String.fromCodePoint(0xc624, 0xd61c, 0xb9b0)}
          AND status = 'active' AND sort_order = 50
          AND launched_at = TIMESTAMPTZ '2026-04-27T00:00:00.000Z')::int AS admitted
      FROM artists`;
    if (publicArtists.total !== 1 || publicArtists.admitted !== 1) {
      throw new Error('Pinned public Artist baseline admission required; never clear existing rows');
    }
    await sizeBound();
    ownerId = randomUUID(); otherId = randomUUID(); absentActor = randomUUID();
    await setup.user.create({ data: { id: ownerId, email: `synthetic-greeting-${ownerId}@example.invalid` } });
    await setup.user.create({ data: { id: otherId, email: `synthetic-other-${otherId}@example.invalid` } });
    const artist = await setup.artist.create({ data: { slug: `synthetic-greeting-${randomUUID()}`,
      displayName: 'Synthetic SQL Fixture', status: 'draft' } });
    session = await setup.chatSession.create({ data: { userId: ownerId, artistId: artist.id },
      include: { artist: true, chatPersona: true } });
    const otherSession = await setup.chatSession.create({ data: { userId: otherId, artistId: artist.id } });
    await setup.chatMessage.create({ data: { chatSessionId: session.id, senderType: 'user',
      messageType: 'text', body: 'Synthetic retained owner row' } });
    await setup.chatMessage.create({ data: { chatSessionId: otherSession.id, senderType: 'artist',
      messageType: 'opening_greeting', body: 'Synthetic retained other-session cache' } });
    await setup.auditEvent.create({ data: { actorUserId: otherId, actorType: 'system', action: 'synthetic_fixture_only',
      targetType: 'chat_session', targetId: otherSession.id, metadata: { fixture: 'other-owned-before' } } });
    await setup.$disconnect();
    writer = client(url!); writer.$on('query', event => { queries.push(event.query); }); await writer.$connect();
    service = new ChatService(writer as never, provider as never);
    view = service as unknown as NativeGreeting;
  });
  beforeEach(async () => {
    before = undefined; before = await snapshot(); auditBefore = await auditSnapshot();
    queries = []; expectedAdded = 0; inserted = undefined;
    for (const method of Object.values(provider)) method.mockClear();
    create = jest.spyOn(writer.auditEvent, 'create');
    warn = jest.spyOn(view.logger, 'warn').mockImplementation(() => undefined);
    builder = jest.spyOn(view, 'buildOpeningGreetingCandidate');
    currentness = jest.spyOn(view, 'assertArtistPersonaSelectionCurrent').mockImplementation(async (_selection, tx) => {
      expect(tx).toBeDefined();
    });
    response = jest.spyOn(view, 'openingGreetingResponse');
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
      expect(mutations).toHaveLength(3);
      expect(mutations[0]).toMatch(/UPDATE (?:"public"\.)?"chat_sessions"/);
      expect(mutations[1]).toMatch(/INSERT INTO (?:"public"\.)?"chat_messages"/);
      expect(mutations[2]).toMatch(/INSERT INTO (?:"public"\.)?"audit_events"/);
      const messageAt = queries.findIndex(query => /INSERT INTO (?:"public"\.)?"chat_messages"/.test(query));
      const rollbackAt = queries.findIndex(query => /^\s*ROLLBACK\b/i.test(query));
      const auditAt = queries.findIndex(query => /INSERT INTO (?:"public"\.)?"audit_events"/.test(query));
      expect(messageAt).toBeGreaterThanOrEqual(0); expect(rollbackAt).toBeGreaterThan(messageAt);
      expect(auditAt).toBeGreaterThan(rollbackAt);
      expect(builder).toHaveBeenCalledTimes(1); expect(currentness).toHaveBeenCalledTimes(1);
      expect(response).toHaveBeenCalledTimes(1); expect(inserted?.id).toEqual(expect.any(String));
      expect(create).toHaveBeenCalledTimes(1);
      expect(await reader.chatMessage.count({ where: { chatSessionId: session.id, messageType: 'opening_greeting' } })).toBe(0);
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
    // Preserve fixtures; parent stops only its own cluster gracefully and proves port-free.
  });

  it('GREETING.RETURNED.NATIVE.01 actual greeting INSERT rolls back while outside audit persists safe returned usage', async () => {
    const original = new ConflictException(SECRET_MARKER);
    const evidence = failAfterInsert(original, 'completed');
    expect(evidence).not.toBeNull(); expect(Object.isFrozen(evidence)).toBe(true);
    expectedAdded = 1;
    await expect(view.ensureSessionOpeningGreeting(ownerId, session)).rejects.toBe(original);
    expect(warn).not.toHaveBeenCalled();
    const rows = await reader.auditEvent.findMany({ where: { actorUserId: ownerId, action: ACTION },
      select: { actorUserId: true, actorType: true, action: true, targetType: true, targetId: true,
        beforeData: true, afterData: true, metadata: true } });
    expect(rows).toEqual([{ actorUserId: ownerId, actorType: 'system', action: ACTION, targetType: 'chat_session',
      targetId: session.id, beforeData: null, afterData: null, metadata: {
        schemaVersion: '2026-10-15.chat-returned-usage-v1', provider: 'openai', stage: 'application_after_provider_return',
        reason: 'source_conflict', applicationOutcome: 'rejected_or_unconfirmed', returnedUsageEvidence: evidence } }]);
    expect(evidence).toEqual({ contract: 'chat-returned-usage-evidence-v1', responseStatus: 'completed', completionVerified: true,
      model: 'gpt-4.1-mini', inputTokens: 9, outputTokens: 4, cachedInputTokens: null, normalizedUsageOnly: true,
      semanticQualityVerified: false, actualProviderCostKrw: null, providerInvoiceVerified: false, billingStatus: 'unverified' });
    expect(JSON.stringify(rows[0].metadata)).not.toContain(BODY_MARKER);
    expect(JSON.stringify(rows[0].metadata)).not.toContain(SECRET_MARKER);
    expect(await reader.auditEvent.count({ where: { actorUserId: otherId } })).toBe(1);
  });
  it('GREETING.RETURNED.NATIVE.02 real outside audit FK denial preserves original greeting error and rollback', async () => {
    const original = new Error(SECRET_MARKER);
    const evidence = failAfterInsert(original, 'unreported');
    expect(evidence).toMatchObject({ responseStatus: 'unreported', completionVerified: false,
      actualProviderCostKrw: null, billingStatus: 'unverified', semanticQualityVerified: false });
    expect(await reader.user.count({ where: { id: absentActor } })).toBe(0);
    // Private method caller is intentionally invalid for audit FK only, not an authenticated actor claim.
    await expect(view.ensureSessionOpeningGreeting(absentActor, session)).rejects.toBe(original);
    expect(warn).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledWith(WARNING);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET_MARKER);
    expect(await reader.auditEvent.count({ where: { actorUserId: absentActor, action: ACTION } })).toBe(0);
    expect(create.mock.calls[0][0]).toMatchObject({ data: { actorUserId: absentActor, targetId: session.id,
      metadata: { reason: 'storage_or_processing_failure', applicationOutcome: 'rejected_or_unconfirmed',
        returnedUsageEvidence: evidence } } });
  });
});

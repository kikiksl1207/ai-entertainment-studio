import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  APPROVED_ARTIST_CHAT_CRLF_SHA256,
  APPROVED_ARTIST_CHAT_MANIFEST_PATH,
  APPROVED_ARTIST_CHAT_RELEASE,
  APPROVED_ARTIST_CHAT_SOURCE_SHA256,
  isLockedArtistPersona,
  selectArtistPersona,
} from './artist-persona-lock';
import { CHAT_FEATURE_PRODUCT_POLICIES } from './chat-feature-policy';
import { ChatService } from './chat.service';

const ROOT = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const CLEAN = 'E:/Codex/LuminaStage/story-completion-20261003';
const SERVICE_SHA256 = '6c0ed92c46ecf696c0802bb3958f8f7112e04a10019d0dacd0a8d34445162e18';
const POLICY_SHA256 = 'e891272c0e79f7b0cdaa5c9fe0f31e45cfb63bf27e6ea33004a5ced8fc8589a5';
const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const savedAt = new Date('2026-10-13T00:00:00.000Z');
const approvalCode = 'CHAT_ARTIST_PERSONA_APPROVAL_REQUIRED';
const sourceCode = 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED';
const normalizePath = (path: string) => resolve(path).replace(/\\/g, '/').toLowerCase();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

type Entry = {
  slug: string; displayName: string; tagline: string; summary: string; publicStory: string;
  personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string>;
};
type NativeRow = { relation: string; rowId: string; rowVersion: string; payload: Prisma.JsonValue };
type GatedCase = { artistId: string; sessionId: string; code: string };
type Probe = {
  selectDispatchArtistPersona(...args: unknown[]): unknown;
  assertArtistPersonaSelectionCurrent(...args: unknown[]): Promise<void>;
  failFeatureOrderAndRestoreLumina(...args: unknown[]): Promise<unknown>;
  fallbackOpeningGreeting(...args: unknown[]): string;
};
const nativeClient = (databaseUrl: string) => new PrismaClient({
  datasources: { db: { url: databaseUrl } }, log: [{ level: 'query', emit: 'event' }],
});

// Parent owns the exact unseeded SDK174/103 database and process guards. No DDL or cleanup here.
jest.setTimeout(30_000);
native('approved generation required postgres (owned SDK174/103, no provider)', () => {
  let db: ReturnType<typeof nativeClient>;
  let service: ChatService;
  let ownerId: string, otherOwnerId: string, legacyArtistId: string;
  let legacySessionId: string, emptySessionId: string, approvedSessionId: string;
  let replayOrderId: string, heldOrderId: string, pendingOrderId: string;
  let walletId: string, deepProductId: string, storyProductId: string;
  let originalRows: Awaited<ReturnType<ChatService['getMessages']>>;
  let paidMessage: Awaited<ReturnType<PrismaClient['chatMessage']['findFirstOrThrow']>>;
  let before: NativeRow[] | undefined;
  let querySql: string[] = [];
  let selection: jest.SpyInstance, currency: jest.SpyInstance, refund: jest.SpyInstance, local: jest.SpyInstance;
  let approvedDelta: { orderId: string; ledgerId: string } | undefined;
  const gated: GatedCase[] = [];
  const forbidden = () => jest.fn(() => { throw new Error('Native fixture must not dispatch a provider or fallback'); });
  const ready = { provider: 'synthetic-provider', configured: true,
    status: 'provider_ready', messageKey: 'chat.generation.ready' };
  const provider = { readiness: jest.fn(() => ready), generate: forbidden(), fallbackResult: forbidden() };

  beforeAll(async () => {
    const parsed = new URL(url!);
    const report = normalizePath(process.env.RELEASE_QA_GUARD_REPORT ?? '');
    const admitted = /^e:\/codex\/luminastage\/ai-entertainment-studio-git\/qa\/20261014-chat-approved-generation-required\/owned-([a-f0-9]{12})\/test-guards\.json$/.exec(report);
    if (!admitted || normalizePath(realpathSync(dirname(report))) !== normalizePath(dirname(report))
      || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== `/lumina_failed_cost_qa_${admitted[1]}`
      || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== url
      || normalizePath(realpathSync(__filename)) !== normalizePath(CLEAN + '/server/src/chat/chat-approved-generation-required.postgres.spec.ts')
      || normalizePath(realpathSync(APPROVED_ARTIST_CHAT_MANIFEST_PATH)) !== normalizePath(CLEAN + '/server/prisma/approved-public-artists-2026-09-27.json')
      || !report.startsWith(normalizePath(ROOT + '/qa/20261014-chat-approved-generation-required') + '/owned-')) {
      throw new Error('Exact nested source and parent-owned SDK174/103 guard environment required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174
      || sha(readFileSync(resolve(__dirname, 'chat.service.ts'))) !== SERVICE_SHA256
      || sha(readFileSync(resolve(__dirname, 'chat-feature-policy.ts'))) !== POLICY_SHA256) {
      throw new Error('Pinned actual service/policy and existing SDK174 required');
    }
    const bytes = readFileSync(APPROVED_ARTIST_CHAT_MANIFEST_PATH);
    if (![APPROVED_ARTIST_CHAT_SOURCE_SHA256, APPROVED_ARTIST_CHAT_CRLF_SHA256].includes(sha(bytes))) {
      throw new Error('Existing exact approved public manifest bytes required');
    }
    const manifest = JSON.parse(bytes.toString('utf8')) as { release: string; artists: Entry[] };
    if (manifest.release !== APPROVED_ARTIST_CHAT_RELEASE || manifest.artists.length < 5) {
      throw new Error('Existing public release fixture required');
    }
    const used = new Set(manifest.artists.slice(0, 4).map(entry => entry.slug));
    const factEntry = manifest.artists.find(entry => !used.has(entry.slug) && entry.profileFacts['\uD32C\uB364\uBA85']);
    if (!factEntry) throw new Error('Existing public fact-withdrawal fixture required');
    db = nativeClient(url!);
    db.$on('query', event => { querySql.push(event.query); });
    await db.$connect();
    const [database] = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    const [migrations] = await db.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished
      FROM "_prisma_migrations"`;
    if (database.database !== parsed.pathname.slice(1) || migrations.applied !== 103 || migrations.unfinished !== 0
      || await db.user.count() || await db.chatSession.count()
      || await db.artist.count({ where: { slug: { in: [...used, factEntry.slug] } } })) {
      throw new Error('Unseeded parent-owned 103-migration database required; never replace existing fixtures');
    }

    const nonce = randomUUID();
    // Original fixtures are written once, before per-operation payload/xmin snapshots. No resets or deletions.
    await db.$transaction(async tx => {
      const owner = await tx.user.create({ data: { email: `synthetic-generation-owner-${nonce}@example.invalid` } });
      const other = await tx.user.create({ data: { email: `synthetic-generation-other-${nonce}@example.invalid` } });
      ownerId = owner.id; otherOwnerId = other.id;
      const legacy = await tx.artist.create({ data: {
        slug: `synthetic-generation-${nonce}`, displayName: 'Synthetic outside-pack artist', status: 'active',
        publicProfile: { create: { publicMetadata: { synthetic: true } } },
        contentProfile: { create: { contentTone: 'Synthetic presentation only' } },
      } });
      legacyArtistId = legacy.id;
      async function session(artistId: string) {
        return tx.chatSession.create({ data: { userId: ownerId, artistId,
          status: 'active', createdAt: savedAt, updatedAt: savedAt } });
      }
      legacySessionId = (await session(legacy.id)).id;
      emptySessionId = (await session(legacy.id)).id;
      gated.push({ artistId: legacy.id, sessionId: emptySessionId, code: approvalCode });
      for (const [index, entry] of [...manifest.artists.slice(0, 4), factEntry].entries()) {
        const artist = await tx.artist.create({ data: {
          slug: entry.slug, displayName: index === 2 ? 'Synthetic mismatched identity' : entry.displayName, status: 'active',
          publicProfile: { create: { tagline: entry.tagline, summary: entry.summary, publicStory: entry.publicStory,
            personalityKeywords: [...entry.personalityKeywords],
            publicMetadata: index === 1 ? {} : { approvedRelease: manifest.release,
              profileFacts: index === 4 ? { fandomNameStatus: 'withdrawn' } : { ...entry.profileFacts } },
            updatedAt: savedAt } },
          ...(index === 3 ? {} : { contentProfile: { create: { contentTone: entry.contentTone, updatedAt: savedAt } } }),
        }, include: { publicProfile: true, contentProfile: true } });
        const savedSession = await session(artist.id);
        if (index === 0) {
          if (!isLockedArtistPersona(selectArtistPersona(artist))) throw new Error('Real issuer must approve the exact public fixture');
          approvedSessionId = savedSession.id;
        } else {
          if (isLockedArtistPersona(selectArtistPersona(artist))) throw new Error('Invalid fixture must remain unapproved');
          gated.push({ artistId: artist.id, sessionId: savedSession.id, code: index === 1 ? approvalCode : sourceCode });
        }
      }
      async function product(sku: string) {
        const policy = CHAT_FEATURE_PRODUCT_POLICIES.find(row => row.sku === sku);
        if (!policy || !policy.providerRequired || policy.mvpLocked || policy.status !== 'active') {
          throw new Error('Current known provider-required product contract required');
        }
        const existing = await tx.chatFeatureProduct.findUnique({ where: { sku } });
        if (existing) {
          if (existing.featureType !== policy.featureType || !existing.priceLumina.equals(policy.priceLumina)
            || existing.status !== 'active') throw new Error('Existing baseline product must match current contract');
          return existing;
        }
        return tx.chatFeatureProduct.create({ data: { sku, name: policy.name, featureType: policy.featureType,
          priceLumina: policy.priceLumina, status: 'active', metadata: { synthetic: true },
          createdAt: savedAt, updatedAt: savedAt } });
      }
      const deep = await product('CHAT_DEEP_REPLY'), story = await product('CHAT_STORY_REPLY');
      deepProductId = deep.id; storyProductId = story.id;
      const wallet = await tx.walletAccount.create({ data: { userId: ownerId, cachedBalance: '96.00',
        createdAt: savedAt, updatedAt: savedAt } });
      walletId = wallet.id;
      async function order(label: string, chatSessionId: string, status = 'completed') {
        const ledger = status === 'completed' ? await tx.walletLedger.create({ data: {
          walletAccountId: wallet.id, direction: 'debit', amount: deep.priceLumina,
          ledgerType: 'chat_feature_spend', referenceType: 'chat_feature_product', referenceId: deep.id,
          idempotencyKey: `synthetic-generation-ledger-${nonce}-${label}`,
          memo: 'Synthetic previously completed fixture receipt', createdAt: savedAt,
        } }) : null;
        return tx.chatFeatureOrder.create({ data: { userId: ownerId, artistId: legacy.id, chatSessionId,
          chatFeatureProductId: deep.id, walletLedgerId: ledger?.id, status,
          idempotencyKey: `synthetic-generation-order-${nonce}-${label}`, createdAt: savedAt, updatedAt: savedAt } });
      }
      const replay = await order('saved', legacySessionId), held = await order('held', emptySessionId);
      replayOrderId = replay.id; heldOrderId = held.id;
      pendingOrderId = (await order('pending', emptySessionId, 'pending')).id;
      await tx.chatMessage.create({ data: { chatSessionId: legacySessionId, senderType: 'artist',
        messageType: 'opening_greeting', body: 'Synthetic stored legacy greeting.',
        modelMetadata: { source: 'fallback', savedVariant: 2 },
        safetyMetadata: { artistPersonaLock: { status: 'unverified', allArtistsCovered: false } }, createdAt: savedAt } });
      paidMessage = await tx.chatMessage.create({ data: { chatSessionId: legacySessionId, senderType: 'artist',
        body: 'Synthetic previously completed paid reply.', chatFeatureOrderId: replay.id,
        modelMetadata: { usage: { syntheticSaved: true } }, safetyMetadata: {},
        createdAt: new Date(savedAt.getTime() + 1000) } });
    });
    originalRows = await db.chatMessage.findMany({ where: { chatSessionId: legacySessionId }, orderBy: { createdAt: 'asc' } });
    service = new ChatService(db as never, provider as never);
    const probe = service as unknown as Probe;
    // Observe actual helpers without replacing selection, currency, ownership or compensation implementations.
    selection = jest.spyOn(probe, 'selectDispatchArtistPersona');
    currency = jest.spyOn(probe, 'assertArtistPersonaSelectionCurrent');
    refund = jest.spyOn(probe, 'failFeatureOrderAndRestoreLumina');
    local = jest.spyOn(probe, 'fallbackOpeningGreeting');
  });

  async function snapshot() {
    return db.$queryRaw<NativeRow[]>`SELECT * FROM (
      SELECT 'artists' AS relation, id::text AS "rowId", xmin::text AS "rowVersion", to_jsonb(t) AS payload FROM artists t
      UNION ALL SELECT 'artist_public_profiles', artist_id::text, xmin::text, to_jsonb(t) FROM artist_public_profiles t
      UNION ALL SELECT 'artist_content_profiles', artist_id::text, xmin::text, to_jsonb(t) FROM artist_content_profiles t
      UNION ALL SELECT 'users', id::text, xmin::text, to_jsonb(t) FROM users t
      UNION ALL SELECT 'assets', id::text, xmin::text, to_jsonb(t) FROM assets t
      UNION ALL SELECT 'chat_personas', id::text, xmin::text, to_jsonb(t) FROM chat_personas t
      UNION ALL SELECT 'chat_sessions', id::text, xmin::text, to_jsonb(t) FROM chat_sessions t
      UNION ALL SELECT 'chat_messages', id::text, xmin::text, to_jsonb(t) FROM chat_messages t
      UNION ALL SELECT 'chat_feature_products', id::text, xmin::text, to_jsonb(t) FROM chat_feature_products t
      UNION ALL SELECT 'chat_feature_orders', id::text, xmin::text, to_jsonb(t) FROM chat_feature_orders t
      UNION ALL SELECT 'wallet_accounts', id::text, xmin::text, to_jsonb(t) FROM wallet_accounts t
      UNION ALL SELECT 'wallet_ledger', id::text, xmin::text, to_jsonb(t) FROM wallet_ledger t
      UNION ALL SELECT 'premium_chat_rooms', id::text, xmin::text, to_jsonb(t) FROM premium_chat_rooms t
      UNION ALL SELECT 'story_reader_progress', id::text, xmin::text, to_jsonb(t) FROM story_reader_progress t
      UNION ALL SELECT 'story_progress_route_nodes', id::text, xmin::text, to_jsonb(t) FROM story_progress_route_nodes t
      UNION ALL SELECT 'story_progress_artist_participants', id::text, xmin::text, to_jsonb(t) FROM story_progress_artist_participants t
      UNION ALL SELECT 'story_reset_commands', id::text, xmin::text, to_jsonb(t) FROM story_reset_commands t
      UNION ALL SELECT 'artist_story_identity_profiles', id::text, xmin::text, to_jsonb(t) FROM artist_story_identity_profiles t
      UNION ALL SELECT 'story_memory_records', id::text, xmin::text, to_jsonb(t) FROM story_memory_records t
    ) saved ORDER BY relation, "rowId"`;
  }

  beforeEach(async () => {
    before = undefined; approvedDelta = undefined;
    before = await snapshot();
    querySql = [];
    provider.readiness.mockReturnValue(ready);
    for (const call of [...Object.values(provider), selection, currency, refund, local]) call.mockClear();
  });
  afterEach(async () => {
    if (!before) return;
    const after = await snapshot();
    if (!approvedDelta) {
      expect(isDeepStrictEqual(after, before)).toBe(true);
    } else {
      const delta = approvedDelta;
      const retained = after.filter(row => !(row.relation === 'chat_feature_orders' && row.rowId === delta.orderId)
        && !(row.relation === 'wallet_ledger' && row.rowId === delta.ledgerId)
        && !(row.relation === 'wallet_accounts' && row.rowId === walletId));
      expect(isDeepStrictEqual(retained, before.filter(row => !(row.relation === 'wallet_accounts' && row.rowId === walletId)))).toBe(true);
      expect(after.length).toBe(before.length + 2);
      const oldWallet = before.find(row => row.relation === 'wallet_accounts' && row.rowId === walletId)!;
      const newWallet = after.find(row => row.relation === 'wallet_accounts' && row.rowId === walletId)!;
      expect(newWallet.rowVersion).not.toBe(oldWallet.rowVersion);
      const oldPayload = oldWallet.payload as Prisma.JsonObject;
      expect(isDeepStrictEqual(newWallet.payload, { ...oldPayload, cached_balance: Number(oldPayload.cached_balance) - 2 })).toBe(true);
    }
    for (const call of [provider.generate, provider.fallbackResult, refund, local]) expect(call).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    // Retain original fixtures and positive test rows. Parent owns stopping its database; no DROP/delete/DDL.
    await db?.$disconnect();
  });

  const buy = (chatSessionId: string, productId = deepProductId, key: string = randomUUID()) => service.createFeatureOrder(ownerId, {
    chatSessionId, chatFeatureProductId: productId, idempotencyKey: key,
  });

  it('checks ownership first with 404 without generation, approval or any mutation', async () => {
    await expect(service.generateMessage(otherOwnerId, emptySessionId, {
      body: '', chatFeatureOrderId: heldOrderId, storyProgressId: 'malformed',
    })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getMessages(otherOwnerId, legacySessionId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createFeatureOrder(otherOwnerId, { chatSessionId: emptySessionId,
      chatFeatureProductId: deepProductId, idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(NotFoundException);
    expect(selection).not.toHaveBeenCalled();
    expect(currency).not.toHaveBeenCalled();
  });

  it('keeps ordinary stored legacy history, existing greeting and owned empty-session reads stable', async () => {
    expect(isDeepStrictEqual(await service.getMessages(ownerId, legacySessionId), originalRows)).toBe(true);
    expect(isDeepStrictEqual(await service.getMessages(ownerId, legacySessionId), originalRows)).toBe(true);
    expect(await service.getMessages(ownerId, emptySessionId)).toEqual([]);
    const session = await db.chatSession.findUniqueOrThrow({ where: { id: legacySessionId },
      include: { artist: { include: { publicProfile: true, contentProfile: true } }, chatPersona: true } });
    const first = await service['ensureSessionOpeningGreeting'](ownerId, session);
    const second = await service['ensureSessionOpeningGreeting'](ownerId, session);
    expect(isDeepStrictEqual(first, second)).toBe(true);
    expect(first.cache.hit).toBe(true);
    expect(selection).not.toHaveBeenCalled();
    expect(currency).not.toHaveBeenCalled();
  });

  it('replays the previously completed paid result and idempotent receipt without mutations', async () => {
    const result = await service.generateMessage(ownerId, legacySessionId, {
      body: 'Synthetic repeated request', chatFeatureOrderId: replayOrderId,
    });
    expect(result.generationStatus).toBe('completed');
    expect(isDeepStrictEqual(result.message, paidMessage)).toBe(true);
    const receipt = await db.chatFeatureOrder.findUniqueOrThrow({ where: { id: replayOrderId } });
    const replay = await buy(legacySessionId, deepProductId, receipt.idempotencyKey!);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.id).toBe(receipt.id);
    expect(selection).not.toHaveBeenCalled();
    expect(currency).not.toHaveBeenCalled();
  });

  it('rejects new unapproved free sends including malformed/withdrawn selected identities without output', async () => {
    for (const entry of gated) {
      await expect(service.generateMessage(ownerId, entry.sessionId, { body: 'Synthetic new request' }))
        .rejects.toMatchObject({ response: { code: entry.code } });
    }
    expect(selection).toHaveBeenCalledTimes(gated.length);
    expect(currency).not.toHaveBeenCalled();
  });

  it('holds a paid receipt without a result and a stored pending order without refund or row changes', async () => {
    for (const configured of [true, false]) {
      provider.readiness.mockReturnValue({ ...ready, configured });
      const beforeReadiness = provider.readiness.mock.calls.length;
      await expect(service.generateMessage(ownerId, emptySessionId, {
        body: 'Synthetic new paid request', chatFeatureOrderId: heldOrderId,
      })).rejects.toMatchObject({ response: { code: approvalCode } });
      expect(provider.readiness).toHaveBeenCalledTimes(beforeReadiness);
    }
    await expect(service.generateMessage(ownerId, emptySessionId, {
      body: 'Synthetic pending request', chatFeatureOrderId: pendingOrderId,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rolls back the existing greeting transaction update when new local generation is unapproved', async () => {
    provider.readiness.mockReturnValue({ ...ready, configured: false });
    const session = await db.chatSession.findUniqueOrThrow({ where: { id: emptySessionId },
      include: { artist: { include: { publicProfile: true, contentProfile: true } }, chatPersona: true } });
    await expect(service['ensureSessionOpeningGreeting'](ownerId, session))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    expect(querySql.some(sql => /\bUPDATE\b[\s\S]*"chat_sessions"/.test(sql))).toBe(true);
    expect(querySql.some(sql => /\bROLLBACK\b/.test(sql))).toBe(true);
    expect(provider.readiness).not.toHaveBeenCalled();
    expect(await service.getMessages(ownerId, emptySessionId)).toEqual([]);
  });

  it('rejects initially unapproved sessions and new known Deep/Story purchases before writes or debit', async () => {
    for (const entry of gated) {
      await expect(service.createSession(ownerId, { artistId: entry.artistId }))
        .rejects.toMatchObject({ response: { code: entry.code } });
      for (const productId of [deepProductId, storyProductId]) {
        await expect(buy(entry.sessionId, productId))
          .rejects.toMatchObject({ response: { code: entry.code } });
      }
    }
    await expect(service.createSession(ownerId, { artistId: randomUUID() })).rejects.toBeInstanceOf(NotFoundException);
    expect(querySql.some(sql => /\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(currency).not.toHaveBeenCalled();
  });

  it('fences genuinely current approved rows before one unchanged known Deep debit and order creation', async () => {
    const result = await buy(approvedSessionId);
    expect(result.idempotentReplay).toBe(false);
    expect(result.order.status).toBe('completed');
    const persisted = await db.chatFeatureOrder.findUniqueOrThrow({ where: { id: result.order.id } });
    if (!persisted.walletLedgerId) throw new Error('Actual known product debit receipt required');
    approvedDelta = { orderId: persisted.id, ledgerId: persisted.walletLedgerId };
    const ledger = await db.walletLedger.findUniqueOrThrow({ where: { id: persisted.walletLedgerId } });
    expect(ledger.direction).toBe('debit');
    expect(ledger.amount.equals(2)).toBe(true);
    expect(ledger.ledgerType).toBe('chat_feature_spend');
    expect(ledger.referenceId).toBe(deepProductId);
    expect(selection).toHaveBeenCalledTimes(1);
    expect(currency).toHaveBeenCalledTimes(1);
    const selectionResult = selection.mock.results[0];
    expect(selectionResult.type).toBe('return');
    expect(isLockedArtistPersona(selectionResult.value)).toBe(true);
    const shares = querySql.map((sql, index) => /\bFOR SHARE\b/.test(sql) ? index : -1).filter(index => index >= 0);
    const walletRead = querySql.findIndex(sql => /\bSELECT\b[\s\S]*"wallet_accounts"/.test(sql));
    expect(shares).toHaveLength(3);
    expect(shares[2]).toBeLessThan(walletRead);
  });
});

import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  APPROVED_ARTIST_CHAT_CRLF_SHA256,
  APPROVED_ARTIST_CHAT_MANIFEST_PATH,
  APPROVED_ARTIST_CHAT_RELEASE,
  APPROVED_ARTIST_CHAT_SOURCE_SHA256,
  artistPersonaLockMetadata,
  isLockedArtistPersona,
  selectArtistPersona,
} from './artist-persona-lock';
import { ChatService } from './chat.service';

const url = process.env.STORY_TEST_DATABASE_URL;
const native = url ? describe : describe.skip;
const savedAt = new Date('2026-10-13T00:00:00.000Z');
const readOnlyClient = (databaseUrl: string) => new PrismaClient({
  datasources: { db: { url: databaseUrl } }, log: [{ level: 'query', emit: 'event' }],
});
type SavedRows = Awaited<ReturnType<ChatService['getMessages']>>;
type NativeRow = { relation: string; rowId: string; rowVersion: string; payload: Prisma.JsonValue };
type Entry = {
  slug: string; displayName: string; tagline: string; summary: string; publicStory: string;
  personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string>;
};
type Probe = {
  ensureSessionOpeningGreeting(...args: unknown[]): Promise<unknown>;
  buildOpeningGreetingCandidate(...args: unknown[]): Promise<unknown>;
  assertArtistPersonaSelectionCurrent(...args: unknown[]): Promise<void>;
};

jest.setTimeout(30_000);
native('saved history read-only postgres (owned SDK174/103, no provider)', () => {
  let writablePrisma: PrismaClient;
  let readonlyPrisma: ReturnType<typeof readOnlyClient>;
  let service: ChatService;
  let ownerId: string, otherOwnerId: string;
  let emptyId: string, legacyId: string, filteredId: string, closedId: string, archivedId: string;
  let lockedId: string, staleId: string;
  let legacyRows: SavedRows, ordinaryRows: SavedRows, lockedRows: SavedRows;
  let before: NativeRow[] | undefined;
  let querySql: string[] = [];
  let effects: jest.SpyInstance[] = [];
  let currency: jest.SpyInstance;
  const forbidden = () => jest.fn(() => { throw new Error('Saved history must not dispatch effects'); });
  const provider = { readiness: forbidden(), generate: forbidden(), fallbackResult: forbidden() };

  async function flags() {
    const [row] = await readonlyPrisma.$queryRaw<Array<{
      database: string; defaultReadOnly: boolean; transactionReadOnly: boolean;
    }>>`SELECT current_database() AS database,
      current_setting('default_transaction_read_only') = 'on' AS "defaultReadOnly",
      current_setting('transaction_read_only') = 'on' AS "transactionReadOnly"`;
    return row;
  }

  beforeAll(async () => {
    const parsed = new URL(url!);
    const guardReport = (process.env.RELEASE_QA_GUARD_REPORT ?? '').replace(/\\/g, '/');
    if (parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '55432'
      || parsed.username !== 'lumina_qa' || parsed.password || parsed.search || parsed.hash
      || !/^\/lumina_failed_cost_qa_[a-f0-9]{12}$/.test(parsed.pathname)
      || process.env.NODE_ENV !== 'test' || process.env.DATABASE_URL !== url
      || !/^E:\/Codex\/LuminaStage\/ai-entertainment-studio-git\/qa\/20261014-artist-readonly-history\/owned-[a-f0-9]{12}\/test-guards\.json$/i.test(guardReport)) {
      throw new Error('Explicit parent-owned loopback isolation and QA guard environment required');
    }
    if (Prisma.dmmf.datamodel.models.length !== 174) throw new Error('Existing SDK174 mapping required');
    const bytes = readFileSync(APPROVED_ARTIST_CHAT_MANIFEST_PATH);
    if (![APPROVED_ARTIST_CHAT_SOURCE_SHA256, APPROVED_ARTIST_CHAT_CRLF_SHA256]
      .includes(createHash('sha256').update(bytes).digest('hex'))) {
      throw new Error('Exact existing approved public source required');
    }
    const manifest = JSON.parse(bytes.toString('utf8')) as { release: string; artists: Entry[] };
    const entry = manifest.artists.find(row => row.slug === 'jang-taegeon');
    if (manifest.release !== APPROVED_ARTIST_CHAT_RELEASE || !entry) throw new Error('Existing canonical fixture required');

    writablePrisma = new PrismaClient({ datasources: { db: { url } } });
    const readonlyUrl = new URL(url!);
    readonlyUrl.searchParams.set('options', '-c default_transaction_read_only=on');
    readonlyPrisma = readOnlyClient(readonlyUrl.toString());
    readonlyPrisma.$on('query', event => { querySql.push(event.query); });
    await writablePrisma.$connect();
    await readonlyPrisma.$connect();
    const admitted = await flags();
    if (admitted.database !== parsed.pathname.slice(1) || !admitted.defaultReadOnly || !admitted.transactionReadOnly) {
      throw new Error('Actual PostgreSQL read-only startup options were not applied');
    }
    const [migration] = await readonlyPrisma.$queryRaw<Array<{ applied: number; unfinished: number }>>`
      SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
        count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS unfinished
      FROM "_prisma_migrations"`;
    if (migration.applied !== 103 || migration.unfinished !== 0) throw new Error('Owned 103-migration baseline required');
    if (await writablePrisma.user.count() || await writablePrisma.chatSession.count()
      || await writablePrisma.artist.count({ where: { slug: entry.slug } })) {
      throw new Error('Unseeded owner/session fixture required; never overwrite an existing canonical artist');
    }

    // All fixture writes finish here, before the service receives only the read-only client.
    const nonce = randomUUID();
    const owner = await writablePrisma.user.create({ data: { email: `synthetic-history-owner-${nonce}@example.invalid` } });
    const other = await writablePrisma.user.create({ data: { email: `synthetic-history-other-${nonce}@example.invalid` } });
    ownerId = owner.id; otherOwnerId = other.id;
    const legacyArtist = await writablePrisma.artist.create({ data: {
      slug: `synthetic-history-${nonce}`, displayName: 'Synthetic legacy history artist', status: 'active',
    } });
    const canonicalArtist = await writablePrisma.artist.create({ data: {
      slug: entry.slug, displayName: entry.displayName, status: 'active',
      publicProfile: { create: { tagline: entry.tagline, summary: entry.summary, publicStory: entry.publicStory,
        personalityKeywords: [...entry.personalityKeywords],
        publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...entry.profileFacts } }, updatedAt: savedAt } },
      contentProfile: { create: { contentTone: entry.contentTone, updatedAt: savedAt } },
    }, include: { publicProfile: true, contentProfile: true } });
    const selection = selectArtistPersona(canonicalArtist);
    if (!isLockedArtistPersona(selection)) throw new Error('Actual canonical source must issue the fixture lock');
    const lock = artistPersonaLockMetadata(selection);
    async function session(artistId = legacyArtist.id, status = 'active') {
      return (await writablePrisma.chatSession.create({ data: {
        userId: ownerId, artistId, status, createdAt: savedAt, updatedAt: savedAt,
      } })).id;
    }
    emptyId = await session(); legacyId = await session(); filteredId = await session();
    closedId = await session(legacyArtist.id, 'closed'); archivedId = await session(legacyArtist.id, 'archived');
    lockedId = await session(canonicalArtist.id); staleId = await session(canonicalArtist.id);
    const asset = await writablePrisma.asset.create({ data: {
      assetType: 'image', visibility: 'private', storageProvider: 'local', mimeType: 'image/png',
      storageKey: `synthetic-history/${nonce}.png`, metadata: { synthetic: true }, createdAt: savedAt, updatedAt: savedAt,
    } });
    const product = await writablePrisma.chatFeatureProduct.create({ data: {
      sku: `synthetic-history-${nonce}`, name: 'Synthetic saved image', featureType: 'image_reply', priceLumina: '0.29',
      metadata: { synthetic: true }, createdAt: savedAt, updatedAt: savedAt,
    } });
    const wallet = await writablePrisma.walletAccount.create({ data: {
      userId: ownerId, cachedBalance: '999.71', createdAt: savedAt, updatedAt: savedAt,
    } });
    const ledger = await writablePrisma.walletLedger.create({ data: {
      walletAccountId: wallet.id, direction: 'debit', amount: '0.29', ledgerType: 'chat_feature_spend',
      referenceType: 'chat_feature_product', referenceId: product.id,
      idempotencyKey: `synthetic-history-ledger-${nonce}`, memo: 'Synthetic saved fixture, not a GET debit', createdAt: savedAt,
    } });
    const order = await writablePrisma.chatFeatureOrder.create({ data: {
      userId: ownerId, artistId: legacyArtist.id, chatSessionId: legacyId, chatFeatureProductId: product.id,
      walletLedgerId: ledger.id, status: 'completed', idempotencyKey: `synthetic-history-order-${nonce}`,
      createdAt: savedAt, updatedAt: savedAt,
    } });
    async function message(chatSessionId: string, offset: number,
      data: Omit<Prisma.ChatMessageUncheckedCreateInput, 'chatSessionId' | 'createdAt'>) {
      return writablePrisma.chatMessage.create({ data: {
        ...data, chatSessionId, createdAt: new Date(savedAt.getTime() + offset * 1000),
      } });
    }
    const last = await message(legacyId, 2, { senderType: 'user', body: '', modelMetadata: Prisma.JsonNull });
    const greeting = await message(legacyId, 0, { senderType: 'artist', messageType: 'opening_greeting',
      body: 'Synthetic saved legacy greeting', modelMetadata: { source: 'fallback', variantIndex: 3 },
      safetyMetadata: { openingGreetingSource: 'fallback', artistPersonaLock: { status: 'unverified' } } });
    const image = await message(legacyId, 1, { senderType: 'artist', messageType: 'image', body: null,
      assetId: asset.id, chatFeatureOrderId: order.id,
      modelMetadata: { saved: { value: ['unchanged', 0, false, null] } }, safetyMetadata: { legacy: true } });
    legacyRows = [greeting, image, last];
    const ordinary = await message(filteredId, 0, { senderType: 'user', body: 'Synthetic ordinary saved row' });
    const nested = await message(filteredId, 20, { senderType: 'artist', body: 'Synthetic nested marker row',
      modelMetadata: { nested: { storyRouteScope: null } }, safetyMetadata: { storyRouteScope: 'not-model' } });
    ordinaryRows = [ordinary, nested];
    const markers: Array<Prisma.InputJsonValue | null> = [null, false, 0, '', {}, [], 'malformed', { version: 1 }];
    for (const [index, marker] of markers.entries()) {
      await message(filteredId, index + 1, { senderType: 'user', body: 'Synthetic excluded saved route row',
        modelMetadata: { storyRouteScope: marker, savedIndex: index } });
    }
    const lockedGreeting = await message(lockedId, 0, { senderType: 'artist', messageType: 'opening_greeting',
      body: 'Synthetic canonical cached greeting', safetyMetadata: { artistPersonaLock: lock } });
    const lockedUser = await message(lockedId, 1, { senderType: 'user', body: 'Synthetic saved canonical user row' });
    lockedRows = [lockedGreeting, lockedUser];
    await message(staleId, 0, { senderType: 'artist', messageType: 'opening_greeting',
      body: 'Synthetic stale cached greeting', modelMetadata: { storyRouteScope: null },
      safetyMetadata: { artistPersonaLock: { ...lock, binding: 'synthetic-stale-binding' } } });
    for (const id of [closedId, archivedId]) await message(id, 0, { senderType: 'user', body: 'Synthetic inaccessible saved row' });

    service = new ChatService(readonlyPrisma as never, provider as never);
    const probe = service as unknown as Probe;
    effects = [jest.spyOn(probe, 'ensureSessionOpeningGreeting'), jest.spyOn(probe, 'buildOpeningGreetingCandidate'),
      jest.spyOn(service, 'createSession'), jest.spyOn(service, 'createMessage'), jest.spyOn(service, 'generateMessage'),
      jest.spyOn(readonlyPrisma, '$transaction'), jest.spyOn(readonlyPrisma, '$executeRaw'), jest.spyOn(readonlyPrisma, '$executeRawUnsafe')];
    currency = jest.spyOn(probe, 'assertArtistPersonaSelectionCurrent');
  });

  async function snapshot() {
    // Native xmin catches no-op UPDATEs; JSONB preserves DB timestamp precision and every stored payload field.
    return readonlyPrisma.$queryRaw<NativeRow[]>`SELECT * FROM (
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
    before = undefined;
    before = await snapshot();
    querySql = [];
    for (const call of [...Object.values(provider), ...effects, currency]) call.mockClear();
  });
  afterEach(async () => {
    if (!before) return;
    expect(querySql.filter(sql => /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b|\bFOR\s+(?:UPDATE|SHARE)\b/i.test(sql))).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await flags()).toMatchObject({ defaultReadOnly: true, transactionReadOnly: true });
    for (const call of [...Object.values(provider), ...effects]) expect(call).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    // Preserve every fixture and migration row. Parent owns PostgreSQL stop, never DROP/delete here.
    try { await readonlyPrisma?.$disconnect(); }
    finally { await writablePrisma?.$disconnect(); }
  });

  it('uses actual PostgreSQL read-only startup flags while the separate setup connection stays writable', async () => {
    const [setup] = await writablePrisma.$queryRaw<Array<{ readOnly: boolean }>>`
      SELECT current_setting('transaction_read_only') = 'on' AS "readOnly"`;
    expect(setup.readOnly).toBe(false);
    for (const row of await Promise.all([flags(), flags(), flags()])) {
      expect(row).toEqual({ database: new URL(url!).pathname.slice(1), defaultReadOnly: true, transactionReadOnly: true });
    }
    expect(Prisma.dmmf.datamodel.models).toHaveLength(174);
  });

  it('returns empty history on sequential and concurrent real reads without creating a greeting', async () => {
    for (let read = 0; read < 2; read++) expect(await service.getMessages(ownerId, emptyId)).toEqual([]);
    expect(await Promise.all([service.getMessages(ownerId, emptyId), service.getMessages(ownerId, emptyId)])).toEqual([[], []]);
    expect(currency).not.toHaveBeenCalled();
  });

  it('replays exact legacy scalar rows, timestamps, safety, asset and order links in saved order', async () => {
    expect(legacyRows.map(row => row.createdAt.toISOString())).toEqual([
      '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:01.000Z', '2026-10-13T00:00:02.000Z',
    ]);
    expect(legacyRows[1]).toMatchObject({ body: null, assetId: expect.any(String), chatFeatureOrderId: expect.any(String),
      modelMetadata: { saved: { value: ['unchanged', 0, false, null] } }, safetyMetadata: { legacy: true } });
    expect(legacyRows[2]).toMatchObject({ body: '', modelMetadata: null });
    for (let read = 0; read < 2; read++) expect(await service.getMessages(ownerId, legacyId)).toEqual(legacyRows);
    for (const result of await Promise.all([service.getMessages(ownerId, legacyId), service.getMessages(ownerId, legacyId)])) {
      expect(result).toEqual(legacyRows);
    }
    expect(currency).not.toHaveBeenCalled();
  });

  it('excludes persisted own falsy or malformed story markers but keeps nested and safety-only markers', async () => {
    expect(await readonlyPrisma.chatMessage.count({ where: { chatSessionId: filteredId } })).toBe(10);
    expect(await service.getMessages(ownerId, filteredId)).toEqual(ordinaryRows);
    expect(await service.getMessages(ownerId, filteredId)).toEqual(ordinaryRows);
  });

  it('rejects another owner and a missing session through the actual owner gate', async () => {
    for (const [userId, sessionId] of [[otherOwnerId, legacyId], [ownerId, randomUUID()]]) {
      const operation = service.getMessages(userId, sessionId);
      await expect(operation).rejects.toBeInstanceOf(NotFoundException);
      await expect(operation).rejects.toMatchObject({ status: 404, response: { message: 'Active chat session not found' } });
    }
    expect(querySql.some(sql => /\bchat_messages\b/i.test(sql))).toBe(false);
    expect(currency).not.toHaveBeenCalled();
  });

  it('rejects inactive closed and archived saved sessions using baseline-valid stored statuses', async () => {
    for (const sessionId of [closedId, archivedId]) {
      const operation = service.getMessages(ownerId, sessionId);
      await expect(operation).rejects.toBeInstanceOf(NotFoundException);
      await expect(operation).rejects.toMatchObject({ status: 404, response: { message: 'Active chat session not found' } });
    }
    expect(querySql.some(sql => /\bchat_messages\b/i.test(sql))).toBe(false);
    expect(currency).not.toHaveBeenCalled();
  });

  it('retains actual cached canonical-source currency checking on repeated and concurrent saved reads', async () => {
    expect(await service.getMessages(ownerId, lockedId)).toEqual(lockedRows);
    for (const result of await Promise.all([service.getMessages(ownerId, lockedId), service.getMessages(ownerId, lockedId)])) {
      expect(result).toEqual(lockedRows);
    }
    expect(currency).toHaveBeenCalledTimes(3);
    for (const [selection, transaction] of currency.mock.calls) {
      expect(isLockedArtistPersona(selection)).toBe(true);
      expect(selection).toMatchObject({ slug: 'jang-taegeon', release: APPROVED_ARTIST_CHAT_RELEASE });
      expect(transaction).toBeUndefined();
    }
  });

  it('rejects a stale cached binding even on an excluded story-marked greeting without repair', async () => {
    for (let read = 0; read < 2; read++) {
      const operation = service.getMessages(ownerId, staleId);
      await expect(operation).rejects.toBeInstanceOf(ConflictException);
      await expect(operation).rejects.toMatchObject({ status: 409, response: { code: 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED' } });
    }
    expect(currency).not.toHaveBeenCalled();
  });
});

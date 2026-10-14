import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import {
  APPROVED_ARTIST_CHAT_MANIFEST_PATH,
  APPROVED_ARTIST_CHAT_RELEASE,
  artistPersonaLockMetadata,
  isLockedArtistPersona,
  selectArtistPersona,
  type ArtistPersonaSourceArtist,
} from './artist-persona-lock';
import { ChatService } from './chat.service';
import {
  ChatLlmProviderAdapter,
  ChatLlmProviderRequestError,
  type ChatGenerationRequest,
  type ChatGenerationResult,
} from './llm-provider.adapter';

type Entry = {
  slug: string; displayName: string; tagline: string; summary: string; publicStory: string;
  personalityKeywords: string[]; contentTone: string; profileFacts: Record<string, string>;
};
const manifest = JSON.parse(readFileSync(APPROVED_ARTIST_CHAT_MANIFEST_PATH, 'utf8')) as {
  release: string; artists: Entry[];
};
const owner = '00000000-0000-4000-8000-000000001451';
const outsider = '00000000-0000-4000-8000-000000001452';
const artistId = '00000000-0000-4000-8000-000000001453';
const sessionId = '00000000-0000-4000-8000-000000001454';
const orderId = '00000000-0000-4000-8000-000000001455';
const savedAt = new Date('2026-10-14T00:00:00.000Z');
const approvalCode = 'CHAT_ARTIST_PERSONA_APPROVAL_REQUIRED';
const sourceCode = 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type SavedMessage = {
  id: string; chatSessionId: string; senderType: string; messageType: string;
  body: string; modelMetadata: Record<string, unknown>; safetyMetadata: Record<string, unknown>;
  createdAt: Date;
};
type Probe = {
  getProviderUserContext(...args: unknown[]): Promise<unknown>;
  providerOpsStatsForUser(...args: unknown[]): Promise<unknown>;
  buildBasicChatPreflight(...args: unknown[]): Promise<unknown>;
  loadApprovedArtistKnowledgeContext(...args: unknown[]): Promise<unknown>;
  loadOptionalStoryMemory(...args: unknown[]): Promise<unknown>;
  recentProviderMessages(...args: unknown[]): Promise<unknown>;
};

function approvedArtist(entry = manifest.artists[0]): ArtistPersonaSourceArtist {
  if (manifest.release !== APPROVED_ARTIST_CHAT_RELEASE || !entry) {
    throw new Error('Existing pinned public release fixture required');
  }
  return {
    id: artistId, slug: entry.slug, displayName: entry.displayName, status: 'active',
    publicProfile: {
      tagline: entry.tagline, summary: entry.summary, publicStory: entry.publicStory,
      personalityKeywords: [...entry.personalityKeywords],
      publicMetadata: { approvedRelease: manifest.release, profileFacts: { ...entry.profileFacts } },
    },
    contentProfile: { contentTone: entry.contentTone },
  };
}

const unapprovedCases = ['outside-pack', 'missing-selection', 'removed-selection', 'wrong-release'] as const;
type UnapprovedCase = typeof unapprovedCases[number];
function unapprovedArtist(condition: UnapprovedCase) {
  const artist = approvedArtist();
  const metadata = artist.publicProfile!.publicMetadata as Record<string, unknown>;
  if (condition === 'outside-pack') {
    artist.slug = 'synthetic-outside-approved-pack';
    artist.displayName = 'Synthetic outside-pack artist';
  } else if (condition === 'missing-selection') {
    artist.publicProfile!.publicMetadata = {};
  } else if (condition === 'removed-selection') {
    if (!isLockedArtistPersona(selectArtistPersona(artist))) throw new Error('Original selection must be issued');
    delete metadata.approvedRelease;
  } else {
    metadata.approvedRelease = 'synthetic-retired-release';
  }
  return artist;
}

function savedGreeting(): SavedMessage {
  return {
    id: 'synthetic-saved-greeting', chatSessionId: sessionId, senderType: 'artist',
    messageType: 'opening_greeting', body: 'Synthetic previously saved legacy greeting.',
    modelMetadata: { source: 'fallback', savedVariant: 2 },
    safetyMetadata: { artistPersonaLock: { status: 'unverified', allArtistsCovered: false } },
    createdAt: savedAt,
  };
}

function fixture(artist = approvedArtist()) {
  const session = { id: sessionId, userId: owner, artistId, status: 'active', chatPersonaId: null,
    createdAt: savedAt, updatedAt: savedAt, artist, chatPersona: null };
  const state = {
    current: clone(artist), atSave: null as ArtistPersonaSourceArtist | null,
    savedSession: true, cached: null as SavedMessage | null,
    cachedInTransaction: null as SavedMessage | null, rows: [] as SavedMessage[],
    replayReceipt: false,
    product: { id: 'synthetic-product', sku: 'synthetic-paid-reply', name: 'Synthetic paid reply',
      featureType: 'deep_talk', priceLumina: '0.29', status: 'active', metadata: {} },
    order: null as null | {
      id: string; userId: string; artistId: string; chatSessionId: string; chatFeatureProductId: string;
      status: string; messages: SavedMessage[];
      walletLedger: { id: string; amount: string };
      chatFeatureProduct: { id: string; sku: string; name: string; featureType: string;
        priceLumina: string; status: string; metadata: Record<string, unknown> };
    },
  };
  const forbidden = jest.fn(() => { throw new Error('Unexpected mutation or refund'); });
  const writes = { create: forbidden, createMany: forbidden, update: forbidden, updateMany: forbidden,
    upsert: forbidden, delete: forbidden, deleteMany: forbidden };
  const tx = {
    artist: { ...writes, findUnique: jest.fn(async () => state.atSave ?? state.current) },
    artistPublicProfile: writes, artistContentProfile: writes,
    chatFeatureOrder: { ...writes, findFirst: forbidden,
      findUnique: jest.fn(async () => state.replayReceipt ? state.order : null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: orderId, ...data, chatFeatureProduct: state.product,
      })),
    },
    walletAccount: { ...writes,
      findUnique: jest.fn(async () => ({ id: 'synthetic-wallet', status: 'active', cachedBalance: '9.00' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    walletLedger: { ...writes, create: jest.fn(async () => ({ id: 'synthetic-receipt' })) },
    chatSession: { ...writes, update: jest.fn(async () => session) },
    chatMessage: { ...writes,
      findFirst: jest.fn(async () => state.cachedInTransaction),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'synthetic-created-message', ...data, createdAt: savedAt,
      })),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
      if (strings[1] !== '::uuid FOR SHARE') throw new Error('Unexpected native statement');
      if (strings[0] === 'SELECT id FROM artists WHERE id = ') return [{ id }];
      if (['SELECT artist_id FROM artist_public_profiles WHERE artist_id = ',
        'SELECT artist_id FROM artist_content_profiles WHERE artist_id = '].includes(strings[0])) {
        return [{ artist_id: id }];
      }
      throw new Error('Unexpected native relation');
    }),
  };
  const prisma = {
    artist: { ...writes, findFirst: jest.fn(async () => artist),
      findUnique: jest.fn(async () => state.current) },
    artistPublicProfile: writes, artistContentProfile: writes,
    chatPersona: { findFirst: jest.fn(async () => null) },
    chatFeatureProduct: { findFirst: jest.fn(async () => state.product) },
    chatSession: { ...writes,
      create: jest.fn(async () => { state.savedSession = true; return session; }),
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string; status: string } }) =>
        state.savedSession && where.id === session.id && where.userId === owner &&
        where.status === session.status ? session : null),
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        state.savedSession && where.userId === owner ? [session] : []),
    },
    chatMessage: { ...writes, findFirst: jest.fn(async () => state.cached),
      findMany: jest.fn(async () => state.rows) },
    chatFeatureOrder: { ...writes,
      findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string; chatSessionId: string } }) => {
        const order = state.order;
        return order && order.id === where.id && order.userId === where.userId &&
          order.chatSessionId === where.chatSessionId ? order : null;
      }),
    },
    walletAccount: writes, walletLedger: writes,
    $transaction: jest.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const provider = {
    readiness: jest.fn(() => ({ provider: 'synthetic-provider', configured: true,
      status: 'provider_ready', messageKey: 'chat.generation.ready' })),
    generate: jest.fn(async (request: ChatGenerationRequest): Promise<ChatGenerationResult> => ({
      body: 'Synthetic approved reply.',
      usage: { provider: 'synthetic-provider', model: 'synthetic-model',
        inputTokens: 1, outputTokens: 1, estimatedCostKrw: '0.00' },
      safetyMetadata: { generationStatus: 'completed', artistPersonaLock: artistPersonaLockMetadata(
        request.personaSelection ?? { status: 'unverified', reason: 'missing-selection' },
      ) },
    })),
    fallbackResult: jest.fn((error: unknown) =>
      new ChatLlmProviderAdapter({ get: jest.fn() } as never).fallbackResult(error)),
  };
  const service = new ChatService(prisma as never, provider as never);
  const probe = service as unknown as Probe;
  const userContext = jest.spyOn(probe, 'getProviderUserContext').mockResolvedValue({ userId: owner, userEmail: null });
  const ops = jest.spyOn(probe, 'providerOpsStatsForUser').mockResolvedValue({ totalResponses: 0, failureCount: 0 });
  const preflight = jest.spyOn(probe, 'buildBasicChatPreflight').mockResolvedValue({ canGenerate: true });
  jest.spyOn(probe, 'loadApprovedArtistKnowledgeContext').mockResolvedValue({ items: [] });
  jest.spyOn(probe, 'loadOptionalStoryMemory').mockResolvedValue({ source: 'no_verified_interaction', items: [] });
  jest.spyOn(probe, 'recentProviderMessages').mockResolvedValue([]);
  const selection = jest.spyOn(service as unknown as { selectDispatchArtistPersona(...args: unknown[]): unknown },
    'selectDispatchArtistPersona');
  const local = jest.spyOn(service as unknown as { fallbackOpeningGreeting(...args: unknown[]): string },
    'fallbackOpeningGreeting');
  const refund = jest.spyOn(service as unknown as { failFeatureOrderAndRestoreLumina(...args: unknown[]): Promise<unknown> },
    'failFeatureOrderAndRestoreLumina');
  function paid(status = 'completed', messages: SavedMessage[] = []) {
    state.order = { id: orderId, userId: owner, artistId, chatSessionId: sessionId,
      chatFeatureProductId: state.product.id, status, messages,
      walletLedger: { id: 'synthetic-receipt', amount: '0.29' },
      chatFeatureProduct: state.product };
  }
  function noOutputOrMoney() {
    for (const call of [provider.generate, provider.fallbackResult, local, refund, forbidden,
      prisma.chatMessage.create, tx.chatMessage.create, tx.walletAccount.updateMany,
      tx.walletLedger.create, tx.chatFeatureOrder.create]) expect(call).not.toHaveBeenCalled();
  }
  return { service, session, prisma, tx, provider, state, selection, local, refund, userContext, ops,
    preflight, paid, noOutputOrMoney };
}

afterEach(() => jest.restoreAllMocks());

describe('new artist output requires genuinely selected approved canon (20261014)', () => {
  it.each(unapprovedCases)('holds %s new send and greeting before provider or local fallback', async condition => {
    const f = fixture(unapprovedArtist(condition));
    const before = clone(f.session.artist);
    await expect(f.service.generateMessage(owner, sessionId, { body: 'Synthetic new request' }))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    await expect(f.service['ensureSessionOpeningGreeting'](owner, f.session as never))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    expect(f.tx.chatSession.update).toHaveBeenCalledTimes(1);
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.ops).not.toHaveBeenCalled();
    expect(f.session.artist).toEqual(before);
    f.noOutputOrMoney();
  });

  it.each(['identity-mismatch', 'malformed-metadata', 'withdrawn-fact', 'missing-content'] as const)(
    'keeps the existing selected-source error for %s without output', async condition => {
      const entry = condition === 'withdrawn-fact'
        ? manifest.artists.find(row => row.profileFacts['\uD32C\uB364\uBA85']) : manifest.artists[0];
      if (!entry) throw new Error('Existing public fact fixture required');
      const artist = approvedArtist(entry);
      if (condition === 'identity-mismatch') artist.displayName = 'Synthetic changed identity';
      if (condition === 'malformed-metadata') artist.publicProfile!.publicMetadata = [];
      if (condition === 'withdrawn-fact') {
        (artist.publicProfile!.publicMetadata as Record<string, unknown>).profileFacts = { fandomNameStatus: 'withdrawn' };
      }
      if (condition === 'missing-content') artist.contentProfile = null;
      const f = fixture(artist);
      const code = condition === 'malformed-metadata' ? approvalCode : sourceCode;
      await expect(f.service.generateMessage(owner, sessionId, { body: 'Synthetic request' }))
        .rejects.toMatchObject({ response: { code } });
      await expect(f.service['ensureSessionOpeningGreeting'](owner, f.session as never))
        .rejects.toMatchObject({ response: { code } });
      f.noOutputOrMoney();
    },
  );

  it.each(['ready', 'unavailable', 'failed', 'empty', 'ops-guard'] as const)(
    'does not create an unapproved local greeting under %s provider conditions', async condition => {
      const f = fixture(unapprovedArtist('outside-pack'));
      if (condition === 'unavailable') f.provider.readiness.mockReturnValue({ provider: 'synthetic-provider',
        configured: false, status: 'provider_disabled', messageKey: 'chat.generation.disabled' });
      if (condition === 'failed') f.provider.generate.mockRejectedValue(
        new ChatLlmProviderRequestError('Synthetic failure', 'provider_timeout'));
      if (condition === 'empty') {
        const generate = f.provider.generate.getMockImplementation()!;
        f.provider.generate.mockImplementation(async request => ({ ...await generate(request), body: '  ' }));
      }
      if (condition === 'ops-guard') f.ops.mockResolvedValue({ totalResponses: 50, failureCount: 50 });
      await expect(f.service['ensureSessionOpeningGreeting'](owner, f.session as never))
        .rejects.toMatchObject({ response: { code: approvalCode } });
      expect(f.userContext).not.toHaveBeenCalled();
      expect(f.provider.readiness).not.toHaveBeenCalled();
      f.noOutputOrMoney();
    },
  );

  it('does not turn mutable approval-looking flags or a copied lock into issued approval', async () => {
    const f = fixture(unapprovedArtist('missing-selection'));
    f.session.artist.publicProfile!.publicMetadata = {
      approved: true, status: 'approved_public_fields_locked', canonApproved: true,
      artistPersonaLock: { status: 'approved_public_fields_locked', release: manifest.release },
    };
    const genuine = selectArtistPersona(approvedArtist());
    expect(isLockedArtistPersona(genuine)).toBe(true);
    expect(isLockedArtistPersona(clone(genuine))).toBe(false);
    expect(artistPersonaLockMetadata(clone(genuine))).toMatchObject({ status: 'unverified', allArtistsCovered: false });
    await expect(f.service.generateMessage(owner, sessionId, { body: 'Synthetic request' }))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    f.noOutputOrMoney();
  });
});

describe('history, greeting cache and existing paid receipts stay separate from new generation', () => {
  it.each(['outer-cache', 'transaction-double-check'] as const)(
    'replays unchanged legacy greeting from %s without dispatch selection', async location => {
      const f = fixture(unapprovedArtist('removed-selection'));
      const greeting = savedGreeting();
      const before = clone(greeting);
      if (location === 'outer-cache') f.state.cached = greeting;
      else f.state.cachedInTransaction = greeting;
      const first = await f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
      const second = await f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
      expect(first).toEqual(second);
      expect(first).toMatchObject({ text: greeting.body, cache: { hit: true } });
      expect(clone(greeting)).toEqual(before);
      expect(f.selection).not.toHaveBeenCalled();
      expect(f.prisma.artist.findUnique).not.toHaveBeenCalled();
      expect(f.tx.artist.findUnique).not.toHaveBeenCalled();
      expect(f.tx.$queryRaw).not.toHaveBeenCalled();
      if (location === 'outer-cache') expect(f.prisma.$transaction).not.toHaveBeenCalled();
      else expect(f.tx.chatSession.update).toHaveBeenCalledTimes(2);
      f.noOutputOrMoney();
    },
  );

  it.each(unapprovedCases)('replays a completed paid legacy result for %s without mutation', async condition => {
    const f = fixture(unapprovedArtist(condition));
    const message = { ...savedGreeting(), messageType: 'text', modelMetadata: { usage: { saved: true } } };
    f.paid('completed', [message]);
    const before = clone(f.state.order);
    const result = await f.service.generateMessage(owner, sessionId, {
      body: 'Synthetic replay request', chatFeatureOrderId: orderId,
    });
    expect(result).toMatchObject({ generationStatus: 'completed', usage: { saved: true } });
    expect(result.message).toBe(message);
    expect(clone(f.state.order)).toEqual(before);
    expect(f.selection).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it.each(['ready', 'unavailable'] as const)(
    'holds a paid receipt without a generated result before %s readiness or compensation', async condition => {
      const f = fixture(unapprovedArtist('missing-selection'));
      f.paid();
      if (condition === 'unavailable') f.provider.readiness.mockReturnValue({ provider: 'synthetic-provider',
        configured: false, status: 'provider_disabled', messageKey: 'chat.generation.disabled' });
      const before = clone(f.state.order);
      await expect(f.service.generateMessage(owner, sessionId, {
        body: 'Synthetic new paid request', chatFeatureOrderId: orderId,
      })).rejects.toMatchObject({ response: { code: approvalCode } });
      expect(f.provider.readiness).not.toHaveBeenCalled();
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
      expect(clone(f.state.order)).toEqual(before);
      f.noOutputOrMoney();
    },
  );

  it('retains the preexisting completed-order requirement for a literal queued order', async () => {
    const f = fixture(unapprovedArtist('outside-pack'));
    f.paid('queued');
    const before = clone(f.state.order);
    await expect(f.service.generateMessage(owner, sessionId, {
      body: 'Synthetic queued request', chatFeatureOrderId: orderId,
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.selection).not.toHaveBeenCalled();
    expect(clone(f.state.order)).toEqual(before);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it('keeps a stale locked cache rejected by the original currency check', async () => {
    const f = fixture();
    f.state.cached = { ...savedGreeting(), safetyMetadata: { artistPersonaLock: {
      ...artistPersonaLockMetadata(selectArtistPersona(f.session.artist)), binding: 'synthetic-stale-binding',
    } } };
    await expect(f.service['ensureSessionOpeningGreeting'](owner, f.session as never))
      .rejects.toMatchObject({ response: { code: sourceCode } });
    expect(f.selection).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it('rejects an initially unapproved session before creation and preserves owned legacy history', async () => {
    const f = fixture(unapprovedArtist('outside-pack'));
    await expect(f.service.createSession(owner, { artistId }))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    expect(f.prisma.chatSession.create).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(await f.service.getSessions(owner)).toEqual([f.session]);
    expect(await f.service.getMessages(owner, sessionId)).toEqual([]);
    const saved = savedGreeting();
    f.state.cached = saved;
    f.state.rows = [saved];
    const before = clone(saved);
    expect(await f.service.getMessages(owner, sessionId)).toEqual([saved]);
    expect(clone(saved)).toEqual(before);
    f.noOutputOrMoney();
  });

  it('can read an empty owned session when withdrawal races after the pre-create approval check', async () => {
    const f = fixture();
    f.state.savedSession = false;
    f.prisma.chatSession.create.mockImplementation(async () => {
      f.state.savedSession = true;
      delete (f.session.artist.publicProfile!.publicMetadata as Record<string, unknown>).approvedRelease;
      return f.session;
    });
    await expect(f.service.createSession(owner, { artistId }))
      .rejects.toMatchObject({ response: { code: approvalCode } });
    expect(f.prisma.chatSession.create).toHaveBeenCalledTimes(1);
    expect(await f.service.getSessions(owner)).toEqual([f.session]);
    expect(await f.service.getMessages(owner, sessionId)).toEqual([]);
    await expect(f.service.getMessages(outsider, sessionId)).rejects.toBeInstanceOf(NotFoundException);
    f.noOutputOrMoney();
  });
});

describe('new provider-required paid order gates before wallet debit but retains receipt replay', () => {
  const purchase = (f: ReturnType<typeof fixture>) => f.service.createFeatureOrder(owner, {
    chatSessionId: sessionId, chatFeatureProductId: f.state.product.id, idempotencyKey: 'synthetic-new-order',
  });

  it.each([
    ['CHAT_DEEP_REPLY', 'deep_reply', '2.00'],
    ['CHAT_STORY_REPLY', 'story_reply', '5.00'],
  ] as const)('holds a new unapproved %s purchase without money or rows', async (sku, featureType, priceLumina) => {
    const f = fixture(unapprovedArtist('outside-pack'));
    f.state.product.sku = sku;
    f.state.product.featureType = featureType;
    f.state.product.priceLumina = priceLumina;
    await expect(purchase(f)).rejects.toMatchObject({ response: { code: approvalCode } });
    expect(f.tx.artist.findUnique).toHaveBeenCalledTimes(1);
    expect(f.tx.walletAccount.findUnique).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it('replays an existing idempotent receipt without selecting the now-unapproved artist', async () => {
    const f = fixture(unapprovedArtist('removed-selection'));
    f.paid();
    f.state.replayReceipt = true;
    const before = clone(f.state.order);
    const result = await purchase(f);
    expect(result.idempotentReplay).toBe(true);
    expect(result.order).toBe(f.state.order);
    expect(clone(f.state.order)).toEqual(before);
    expect(f.selection).not.toHaveBeenCalled();
    expect(f.tx.artist.findUnique).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.walletAccount.findUnique).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it('checks current approved rows and their shared locks before the unchanged debit path', async () => {
    const f = fixture();
    f.state.product.sku = 'CHAT_DEEP_REPLY';
    f.state.product.featureType = 'deep_reply';
    f.state.product.priceLumina = '2.00';
    const result = await purchase(f);
    expect(result.idempotentReplay).toBe(false);
    expect(f.tx.artist.findUnique).toHaveBeenCalledTimes(2);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(f.tx.artist.findUnique.mock.invocationCallOrder[1]);
    expect(f.tx.artist.findUnique.mock.invocationCallOrder[1]).toBeLessThan(f.tx.walletAccount.findUnique.mock.invocationCallOrder[0]);
    expect(f.tx.walletAccount.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.walletLedger.create).toHaveBeenCalledTimes(1);
    expect(f.tx.chatFeatureOrder.create).toHaveBeenCalledTimes(1);
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.refund).not.toHaveBeenCalled();
  });

  it.each(['missing', 'withdrawn-before-lock', 'withdrawn-at-lock'] as const)(
    'rejects a %s current artist without debit or receipt creation', async condition => {
      const f = fixture();
      f.state.product.sku = 'CHAT_DEEP_REPLY';
      f.state.product.featureType = 'deep_reply';
      f.state.product.priceLumina = '2.00';
      if (condition === 'missing') f.tx.artist.findUnique.mockResolvedValueOnce(null as never);
      else {
        const current = clone(f.state.current);
        delete (current.publicProfile!.publicMetadata as Record<string, unknown>).approvedRelease;
        if (condition === 'withdrawn-before-lock') f.state.current = current;
        else f.tx.artist.findUnique.mockResolvedValueOnce(clone(f.state.current)).mockResolvedValueOnce(current);
      }
      const operation = purchase(f);
      if (condition === 'missing') await expect(operation).rejects.toBeInstanceOf(NotFoundException);
      else await expect(operation).rejects.toMatchObject({ response: {
        code: condition === 'withdrawn-before-lock' ? approvalCode : sourceCode,
      } });
      expect(f.tx.walletAccount.findUnique).not.toHaveBeenCalled();
      f.noOutputOrMoney();
    },
  );
});

describe('existing entry checks and valid approved currency remain in force', () => {
  it('checks ownership before body, route, order and approval', async () => {
    const f = fixture(unapprovedArtist('outside-pack'));
    await expect(f.service.generateMessage(outsider, sessionId, {
      body: '', storyProgressId: 'not-a-uuid', chatFeatureOrderId: orderId,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.prisma.chatFeatureOrder.findFirst).not.toHaveBeenCalled();
    expect(f.selection).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it.each(['body', 'route'] as const)('retains %s validation ahead of the new approval gate', async condition => {
    const f = fixture(unapprovedArtist('outside-pack'));
    await expect(f.service.generateMessage(owner, sessionId, {
      body: condition === 'body' ? '' : 'Synthetic request',
      ...(condition === 'route' ? { storyProgressId: 'not-a-uuid' } : {}),
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.selection).not.toHaveBeenCalled();
    f.noOutputOrMoney();
  });

  it.each(['send', 'greeting'] as const)('keeps pre/post-provider and final-save currency for approved %s', async callsite => {
    const f = fixture();
    if (callsite === 'send') await f.service.generateMessage(owner, sessionId, { body: 'Synthetic request' });
    else await f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    const selected = f.provider.generate.mock.calls[0][0].personaSelection;
    expect(isLockedArtistPersona(selected)).toBe(true);
    expect(f.prisma.artist.findUnique).toHaveBeenCalledTimes(2);
    expect(f.tx.artist.findUnique).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
    const reads = f.prisma.artist.findUnique.mock.invocationCallOrder;
    const dispatch = f.provider.generate.mock.invocationCallOrder[0];
    expect(reads[0]).toBeLessThan(dispatch);
    expect(dispatch).toBeLessThan(reads[1]);
    expect(reads[1]).toBeLessThan(f.tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(f.tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(f.tx.artist.findUnique.mock.invocationCallOrder[0]);
    expect(f.tx.artist.findUnique.mock.invocationCallOrder[0]).toBeLessThan(f.tx.chatMessage.create.mock.invocationCallOrder[0]);
    expect(f.tx.chatMessage.create).toHaveBeenCalledTimes(callsite === 'send' ? 2 : 1);
    expect(artistPersonaLockMetadata(selected!)).toMatchObject({ allArtistsCovered: false, mutableProfileValuesApproved: false });
  });

  it.each(['send', 'greeting'] as const)('rejects approved %s withdrawal after dispatch before saving', async callsite => {
    const f = fixture();
    const generate = f.provider.generate.getMockImplementation()!;
    f.provider.generate.mockImplementation(async request => {
      const result = await generate(request);
      delete (f.state.current.publicProfile!.publicMetadata as Record<string, unknown>).approvedRelease;
      return result;
    });
    const operation = callsite === 'send'
      ? f.service.generateMessage(owner, sessionId, { body: 'Synthetic request' })
      : f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
    await expect(operation).rejects.toBeInstanceOf(ConflictException);
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.tx.chatMessage.create).not.toHaveBeenCalled();
    expect(f.local).not.toHaveBeenCalled();
    expect(f.refund).not.toHaveBeenCalled();
  });

  it.each(['send', 'greeting'] as const)('rejects inactive approved %s final-save rows', async callsite => {
    const f = fixture();
    f.state.atSave = clone(f.state.current);
    f.state.atSave.status = 'archived';
    const operation = callsite === 'send'
      ? f.service.generateMessage(owner, sessionId, { body: 'Synthetic request' })
      : f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
    await expect(operation).rejects.toMatchObject({ response: { code: sourceCode } });
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(f.tx.chatMessage.create).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'failed'] as const)('still fences approved local greeting fallback for %s', async condition => {
    const f = fixture();
    if (condition === 'unavailable') f.provider.readiness.mockReturnValue({ provider: 'synthetic-provider',
      configured: false, status: 'provider_disabled', messageKey: 'chat.generation.disabled' });
    else f.provider.generate.mockRejectedValue(new ChatLlmProviderRequestError('Synthetic failure', 'provider_timeout'));
    await f.service['ensureSessionOpeningGreeting'](owner, f.session as never);
    expect(f.local).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(f.tx.chatMessage.create).toHaveBeenCalledTimes(1);
    expect(f.tx.chatMessage.create.mock.calls[0][0].data.safetyMetadata).toMatchObject({
      artistPersonaLock: { status: 'unverified', allArtistsCovered: false },
    });
  });
});

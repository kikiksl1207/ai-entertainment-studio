import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ChatService } from './chat.service';
import {
  artistPersonaLockMetadata,
  isLockedArtistPersona,
  selectArtistPersona,
  type ArtistPersonaSourceArtist,
} from './artist-persona-lock';
import { storyChatRouteMarker, type StoryChatRouteScope } from './story-chat-route-scope';

const userId = '00000000-0000-4000-8000-000000001411';
const artistId = '00000000-0000-4000-8000-000000001412';
const sessionId = '00000000-0000-4000-8000-000000001413';
const progressId = '00000000-0000-4000-8000-000000001414';
const savedAt = new Date('2026-10-13T00:00:00.000Z');
const manifest = JSON.parse(readFileSync(resolve(__dirname,
  '../../prisma/approved-public-artists-2026-09-27.json'), 'utf8')) as {
  release: string;
  artists: Array<{ slug: string; displayName: string }>;
};

type SavedMessage = {
  id: string; chatSessionId: string; senderType: string; messageType: string;
  body: string | null; assetId: string | null; chatFeatureOrderId: string | null;
  modelMetadata: unknown; safetyMetadata: unknown; createdAt: Date;
};
type SessionWhere = { id: string; userId: string; status: string };
type MessageWhere = {
  chatSessionId: string; senderType?: string; messageType?: string;
  modelMetadata?: { path: string[]; equals: unknown };
};

function message(id: string, overrides: Partial<SavedMessage> = {}): SavedMessage {
  return {
    id, chatSessionId: sessionId, senderType: 'user', messageType: 'text',
    body: 'Synthetic saved body', assetId: null, chatFeatureOrderId: null,
    modelMetadata: {}, safetyMetadata: {}, createdAt: savedAt, ...overrides,
  };
}

function artistFixture(locked: boolean): ArtistPersonaSourceArtist {
  const entry = manifest.artists.find(row => row.slug === 'jang-taegeon');
  if (!entry) throw new Error('Existing approved source fixture is missing');
  return {
    id: artistId, slug: locked ? entry.slug : 'synthetic-legacy-artist',
    displayName: locked ? entry.displayName : 'Synthetic legacy artist', status: 'active',
    publicProfile: { publicMetadata: locked ? { approvedRelease: manifest.release } : {} },
    contentProfile: { contentTone: 'Synthetic presentation only' },
  };
}

function mutationGuards() {
  const blocked = () => jest.fn(() => { throw new Error('History must not mutate storage'); });
  return {
    create: blocked(), createMany: blocked(), createManyAndReturn: blocked(),
    update: blocked(), updateMany: blocked(), updateManyAndReturn: blocked(),
    upsert: blocked(), delete: blocked(), deleteMany: blocked(),
  };
}

function rootMock(rows: SavedMessage[] = [], locked = false) {
  const artist = artistFixture(locked);
  const session = {
    id: sessionId, userId, artistId, chatPersonaId: null, status: 'active',
    createdAt: savedAt, updatedAt: savedAt, artist, chatPersona: null,
  };
  const scope: StoryChatRouteScope = {
    progressId, workId: 'work-1', releaseId: 'release-1', routeNodeId: 'route-1',
    progressRevision: 7, progressUpdatedAt: savedAt,
    resetCommandId: null, resetAfterRevision: null,
    identityProfileId: 'profile-1', identityProfileVersion: 1,
    identityReviewRevision: 1, identitySourceFingerprint: 'source-1',
    identityApprovedFingerprint: 'approved-1',
  };
  const progress = {
    id: progressId, userId, status: 'active', workId: scope.workId,
    activeReleaseId: scope.releaseId, routeNodeId: scope.routeNodeId,
    progressRevision: scope.progressRevision, updatedAt: savedAt,
    participantArtist: {
      artistId, identityProfileId: scope.identityProfileId,
      identityProfileVersion: scope.identityProfileVersion,
      identityReviewRevision: scope.identityReviewRevision,
      identitySourceFingerprint: scope.identitySourceFingerprint,
      identityApprovedFingerprint: scope.identityApprovedFingerprint,
    },
  };
  const state = { rows, session: session as typeof session | null,
    currentArtist: artist as ArtistPersonaSourceArtist | null,
    progress: null as typeof progress | null };
  const writes = {
    artist: mutationGuards(), artistPublicProfile: mutationGuards(),
    artistContentProfile: mutationGuards(), artistStoryIdentityProfile: mutationGuards(),
    chatSession: mutationGuards(), chatMessage: mutationGuards(), chatFeatureOrder: mutationGuards(),
    walletAccount: mutationGuards(), walletLedger: mutationGuards(),
    storyReaderProgress: mutationGuards(), storyProgressRouteNode: mutationGuards(),
    storyResetCommand: mutationGuards(),
  };
  const prisma = {
    ...writes,
    artist: { ...writes.artist, findUnique: jest.fn(async () => state.currentArtist) },
    chatSession: { ...writes.chatSession, findFirst: jest.fn(async ({ where }: { where: SessionWhere }) => {
      const row = state.session;
      return row && row.id === where.id && row.userId === where.userId && row.status === where.status
        ? row : null;
    }) },
    chatMessage: {
      ...writes.chatMessage,
      findFirst: jest.fn(async ({ where }: { where: MessageWhere }) => state.rows.find(row =>
        row.chatSessionId === where.chatSessionId && row.senderType === where.senderType &&
        row.messageType === where.messageType) ?? null),
      findMany: jest.fn(async ({ where }: { where: MessageWhere }) => state.rows.filter(row =>
        row.chatSessionId === where.chatSessionId && (!where.modelMetadata || isDeepStrictEqual(
          (row.modelMetadata as Record<string, unknown> | null)?.storyRouteScope,
          where.modelMetadata.equals,
        )))),
    },
    storyReaderProgress: {
      ...writes.storyReaderProgress,
      findFirst: jest.fn(async ({ where }: { where: {
        id: string; userId: string; participantArtist: { is: { artistId: string } };
      } }) => {
        const row = state.progress;
        return row && row.id === where.id && row.userId === where.userId &&
          row.participantArtist.artistId === where.participantArtist.is.artistId ? row : null;
      }),
    },
    storyProgressRouteNode: { ...writes.storyProgressRouteNode,
      findFirst: jest.fn(async (): Promise<{ id: string } | null> => ({ id: scope.routeNodeId })) },
    artistStoryIdentityProfile: { ...writes.artistStoryIdentityProfile,
      findFirst: jest.fn(async (): Promise<{ id: string } | null> => ({ id: scope.identityProfileId })) },
    storyResetCommand: { ...writes.storyResetCommand, findFirst: jest.fn(async () => null) },
    chatFeatureOrder: { ...writes.chatFeatureOrder, findFirst: jest.fn(), findUnique: jest.fn() },
    walletAccount: { ...writes.walletAccount, findUnique: jest.fn() },
    walletLedger: { ...writes.walletLedger, findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(() => { throw new Error('History must not start a transaction'); }),
    $queryRaw: jest.fn(), $queryRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(), $executeRawUnsafe: jest.fn(),
  };
  const provider = { readiness: jest.fn(), generate: jest.fn(), fallbackResult: jest.fn() };
  const service = new ChatService(prisma as never, provider as never);
  // Observe the actual helpers without replacing their implementations.
  const greeting = jest.spyOn(service as unknown as {
    ensureSessionOpeningGreeting(...args: unknown[]): Promise<unknown>;
  }, 'ensureSessionOpeningGreeting');
  const builder = jest.spyOn(service as unknown as {
    buildOpeningGreetingCandidate(...args: unknown[]): Promise<unknown>;
  }, 'buildOpeningGreetingCandidate');
  const createSession = jest.spyOn(service, 'createSession');

  function expectReadOnly() {
    for (const delegate of Object.values(writes)) {
      for (const guard of Object.values(delegate)) expect(guard).not.toHaveBeenCalled();
    }
    for (const call of [prisma.$transaction, prisma.$queryRaw, prisma.$queryRawUnsafe,
      prisma.$executeRaw, prisma.$executeRawUnsafe, prisma.user.findUnique,
      prisma.chatFeatureOrder.findFirst, prisma.chatFeatureOrder.findUnique,
      prisma.walletAccount.findUnique, prisma.walletLedger.findMany,
      provider.readiness, provider.generate, provider.fallbackResult, greeting, builder, createSession]) {
      expect(call).not.toHaveBeenCalled();
    }
  }
  function snapshot() {
    return JSON.stringify({ session: state.session, rows: state.rows,
      artist: state.currentArtist, progress: state.progress });
  }
  return { service, prisma, state, session, scope, progress, expectReadOnly, snapshot };
}

function lockedGreeting(f: ReturnType<typeof rootMock>) {
  const selection = selectArtistPersona(f.session.artist);
  if (!isLockedArtistPersona(selection)) throw new Error('Existing source must issue the fixture lock');
  return message('locked-greeting', { senderType: 'artist', messageType: 'opening_greeting',
    safetyMetadata: { artistPersonaLock: artistPersonaLockMetadata(selection) } });
}

function expectOrdinaryQueries(f: ReturnType<typeof rootMock>, reads = 1) {
  expect(f.prisma.chatSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: sessionId, userId, status: 'active' },
    include: expect.objectContaining({ chatPersona: true, artist: expect.anything() }),
  }));
  expect(f.prisma.chatMessage.findFirst).toHaveBeenCalledTimes(reads);
  expect(f.prisma.chatMessage.findFirst).toHaveBeenCalledWith({
    where: { chatSessionId: sessionId, senderType: 'artist', messageType: 'opening_greeting' },
    orderBy: { createdAt: 'asc' },
  });
  expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(reads);
  expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
    where: { chatSessionId: sessionId }, orderBy: { createdAt: 'asc' },
  });
  expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
}

afterEach(() => jest.restoreAllMocks());

describe('ChatService saved history read-only boundary (source-only 20261014)', () => {
  it('returns empty saved history on repeated and concurrent reads without bootstrapping', async () => {
    const f = rootMock();
    const before = f.snapshot();
    expect(await f.service.getMessages(userId, sessionId)).toEqual([]);
    expect(await Promise.all([f.service.getMessages(userId, sessionId),
      f.service.getMessages(userId, sessionId)])).toEqual([[], []]);
    expectOrdinaryQueries(f, 3);
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it('replays legacy scalar rows and metadata in saved order without approval rewriting', async () => {
    const rows = [
      message('legacy-greeting', { senderType: 'artist', messageType: 'opening_greeting',
        body: 'Synthetic saved legacy greeting', modelMetadata: { source: 'fallback', variantIndex: 3 },
        safetyMetadata: { openingGreetingSource: 'fallback', artistPersonaLock: { status: 'unverified' } } }),
      message('asset-row', { senderType: 'artist', messageType: 'image', body: null,
        assetId: '00000000-0000-4000-8000-000000001415',
        chatFeatureOrderId: '00000000-0000-4000-8000-000000001416',
        modelMetadata: { saved: { value: ['unchanged', 0, false, null] } }, safetyMetadata: { legacy: true } }),
      message('last-row', { body: '', modelMetadata: null,
        createdAt: new Date('2026-10-13T00:00:01.000Z') }),
    ];
    const f = rootMock(rows);
    const before = f.snapshot();
    for (let read = 0; read < 2; read += 1) {
      const result = await f.service.getMessages(userId, sessionId);
      expect(result).toEqual(rows);
      rows.forEach((row, index) => expect(result[index]).toBe(row));
    }
    expectOrdinaryQueries(f, 2);
    expect(f.prisma.artist.findUnique).not.toHaveBeenCalled();
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it('preserves the real cached locked-greeting currency read before returning exact saved rows', async () => {
    const f = rootMock([], true);
    f.state.rows = [lockedGreeting(f), message('saved-user')];
    const before = f.snapshot();
    expect(await f.service.getMessages(userId, sessionId)).toEqual(f.state.rows);
    expect(await f.service.getMessages(userId, sessionId)).toEqual(f.state.rows);
    expectOrdinaryQueries(f, 2);
    expect(f.prisma.artist.findUnique).toHaveBeenCalledTimes(2);
    expect(f.prisma.artist.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: artistId } }));
    expect(f.prisma.artist.findUnique.mock.invocationCallOrder[0])
      .toBeLessThan(f.prisma.chatMessage.findMany.mock.invocationCallOrder[0]);
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it.each(['binding-mismatch', 'current-release-withdrawn', 'current-artist-missing'] as const)(
    'rejects %s cached currency without reading messages or repairing the greeting', async condition => {
      const f = rootMock([], true);
      const cached = lockedGreeting(f);
      f.state.rows = [cached];
      if (condition === 'binding-mismatch') {
        (cached.safetyMetadata as { artistPersonaLock: { binding: string } }).artistPersonaLock.binding = 'stale';
      } else if (condition === 'current-release-withdrawn') {
        f.state.currentArtist = { ...f.session.artist,
          publicProfile: { publicMetadata: { approvedRelease: 'withdrawn' } } };
      } else f.state.currentArtist = null;
      const before = f.snapshot();
      await expect(f.service.getMessages(userId, sessionId)).rejects.toMatchObject({
        status: 409, response: { code: 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED' },
      });
      expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(f.prisma.artist.findUnique).toHaveBeenCalledTimes(condition === 'binding-mismatch' ? 0 : 1);
      expect(f.snapshot()).toBe(before);
      f.expectReadOnly();
    },
  );

  it('excludes every own storyRouteScope property, including falsy or malformed markers', async () => {
    const f = rootMock();
    const ordinary = [message('general-user'), message('general-artist', { senderType: 'artist',
      modelMetadata: { nested: { storyRouteScope: null } }, safetyMetadata: { storyRouteScope: 'not-model' } })];
    const marker = storyChatRouteMarker(f.scope);
    const markers: unknown[] = [undefined, null, false, 0, '', {}, [], 'malformed',
      { version: 1 }, marker, { ...marker, routeNodeId: 'other-route' }];
    const excluded = markers.map((marker, index) => message(`story-${index}`, {
      modelMetadata: { storyRouteScope: marker, original: index },
    }));
    f.state.rows = [ordinary[0], ...excluded, ordinary[1]];
    const before = f.snapshot();
    expect(await f.service.getMessages(userId, sessionId)).toEqual(ordinary);
    expectOrdinaryQueries(f);
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it('keeps the cached currency gate even when the greeting carries an excluded story marker', async () => {
    const f = rootMock([], true);
    const cached = lockedGreeting(f);
    cached.modelMetadata = { storyRouteScope: storyChatRouteMarker(f.scope) };
    (cached.safetyMetadata as { artistPersonaLock: { binding: string } }).artistPersonaLock.binding = 'stale';
    f.state.rows = [cached, message('ordinary')];
    const before = f.snapshot();
    await expect(f.service.getMessages(userId, sessionId)).rejects.toMatchObject({
      status: 409, response: { code: 'CHAT_ARTIST_PERSONA_SOURCE_CHANGED' },
    });
    expect(f.prisma.chatMessage.findFirst).toHaveBeenCalledWith({
      where: { chatSessionId: sessionId, senderType: 'artist', messageType: 'opening_greeting' },
      orderBy: { createdAt: 'asc' },
    });
    expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it.each(['other-owner', 'archived', 'inactive', 'unknown'] as const)(
    'rejects an %s session before ordinary or story message access', async condition => {
      const f = rootMock([message('private-synthetic-row')]);
      if (condition === 'other-owner') f.session.userId = '00000000-0000-4000-8000-000000001419';
      else if (condition === 'unknown') f.state.session = null;
      else f.session.status = condition;
      const before = f.snapshot();
      for (const intent of [undefined, progressId]) {
        await expect(f.service.getMessages(userId, sessionId, intent)).rejects.toMatchObject({
          status: 404, response: { message: 'Active chat session not found' },
        });
      }
      expect(f.prisma.chatSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: sessionId, userId, status: 'active' },
      }));
      expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
      expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
      expect(f.snapshot()).toBe(before);
      f.expectReadOnly();
    },
  );

  it.each([false, true])('reads only the exact current story route (empty=%s) with both scope loads', async empty => {
    const f = rootMock();
    f.state.progress = f.progress;
    const marker = storyChatRouteMarker(f.scope);
    const saved = message('current-route', { modelMetadata: { storyRouteScope: marker, saved: true } });
    f.state.rows = [message('ordinary'), message('other-route', {
      modelMetadata: { storyRouteScope: { ...marker, routeNodeId: 'other-route' } },
    }), ...(empty ? [] : [saved])];
    const before = f.snapshot();
    expect(await f.service.getMessages(userId, sessionId, progressId)).toEqual(empty ? [] : [saved]);
    expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
      where: { chatSessionId: sessionId, modelMetadata: { path: ['storyRouteScope'], equals: marker } },
      orderBy: { createdAt: 'asc' },
    });
    expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledTimes(2);
    expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: progressId, userId, status: { in: ['active', 'completed'] },
        participantArtist: { is: { artistId, identityApprovedFingerprint: { not: null } } } },
    }));
    expect(f.prisma.storyProgressRouteNode.findFirst).toHaveBeenCalledTimes(2);
    expect(f.prisma.artistStoryIdentityProfile.findFirst).toHaveBeenCalledTimes(2);
    expect(f.prisma.storyResetCommand.findFirst).toHaveBeenCalledTimes(2);
    const loads = f.prisma.storyReaderProgress.findFirst.mock.invocationCallOrder;
    const query = f.prisma.chatMessage.findMany.mock.invocationCallOrder[0];
    expect(loads[0]).toBeLessThan(query);
    expect(loads[1]).toBeGreaterThan(query);
    expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.artist.findUnique).not.toHaveBeenCalled();
    expect(f.snapshot()).toBe(before);
    f.expectReadOnly();
  });

  it.each(['', 'not-a-uuid', '00000000-0000-1000-8000-000000001414', null, 7])(
    'rejects malformed explicit story intent %s without normal-history fallback', async intent => {
      const f = rootMock([message('ordinary')]);
      await expect(f.service.getMessages(userId, sessionId, intent as never)).rejects.toMatchObject({ status: 400 });
      expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
      expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
      expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
      f.expectReadOnly();
    },
  );

  it.each(['unowned-progress', 'missing-route', 'unapproved-identity'] as const)(
    'rejects %s story history without normal-history fallback', async condition => {
      const f = rootMock([message('ordinary')]);
      f.state.progress = { ...f.progress };
      if (condition === 'unowned-progress') f.state.progress.userId = 'other-owner';
      if (condition === 'missing-route') f.prisma.storyProgressRouteNode.findFirst.mockResolvedValue(null);
      if (condition === 'unapproved-identity') f.prisma.artistStoryIdentityProfile.findFirst.mockResolvedValue(null);
      const before = f.snapshot();
      await expect(f.service.getMessages(userId, sessionId, progressId)).rejects.toMatchObject({
        status: 409, response: { code: 'STORY_CHAT_ROUTE_CHANGED' },
      });
      expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
      expect(f.prisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(f.snapshot()).toBe(before);
      f.expectReadOnly();
    },
  );

  it.each(['route-changed', 'identity-withdrawn', 'progress-disappeared'] as const)(
    'rejects a %s scope reload after the scoped read without returning general history', async condition => {
      const f = rootMock();
      f.state.progress = f.progress;
      const marker = storyChatRouteMarker(f.scope);
      f.state.rows = [message('ordinary'), message('story', { modelMetadata: { storyRouteScope: marker } })];
      if (condition === 'route-changed') {
        f.prisma.storyReaderProgress.findFirst.mockResolvedValueOnce(f.progress)
          .mockResolvedValueOnce({ ...f.progress, routeNodeId: 'changed-route' });
      } else if (condition === 'progress-disappeared') {
        f.prisma.storyReaderProgress.findFirst.mockResolvedValueOnce(f.progress).mockResolvedValueOnce(null);
      } else f.prisma.artistStoryIdentityProfile.findFirst
        .mockResolvedValueOnce({ id: f.scope.identityProfileId }).mockResolvedValueOnce(null);
      const before = f.snapshot();
      await expect(f.service.getMessages(userId, sessionId, progressId)).rejects.toMatchObject({
        status: 409, response: { code: 'STORY_CHAT_ROUTE_CHANGED' },
      });
      expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledTimes(2);
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { chatSessionId: sessionId, modelMetadata: { path: ['storyRouteScope'], equals: marker } },
        orderBy: { createdAt: 'asc' },
      });
      expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
      expect(f.snapshot()).toBe(before);
      f.expectReadOnly();
    },
  );
});

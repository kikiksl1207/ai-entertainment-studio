import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { request, type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { storyChatHistoryPrivacyMiddleware } from './story-chat-history.privacy';
import { storyChatRouteMarker, type StoryChatRouteScope } from './story-chat-route-scope';

// Author UNRUN: actual HTTP controller, production global pipe, and actual getMessages implementation.
// Only synthetic in-memory storage/provider dependencies are supplied; no DB or external network.
jest.setTimeout(60000);

const OWNER = '00000000-0000-4000-8000-000000001501';
const OTHER_OWNER = '00000000-0000-4000-8000-000000001502';
const SESSION = '0000000a-0000-4000-8000-000000001503';
const PROGRESS = '0000000b-0000-4000-8000-000000001504';
const OTHER_PROGRESS = '0000000c-0000-4000-8000-000000001505';
const ARTIST = '00000000-0000-4000-8000-000000001506';
const WORK = '00000000-0000-4000-8000-000000001507';
const RELEASE = '00000000-0000-4000-8000-000000001508';
const ROUTE = '00000000-0000-4000-8000-000000001509';
const CHANGED_ROUTE = '00000000-0000-4000-8000-00000000150a';
const PROFILE = '00000000-0000-4000-8000-00000000150b';
const SAVED_AT = new Date('2026-10-14T00:00:00.000Z');
const METHODS = ['GET', 'HEAD'] as const;
type Method = typeof METHODS[number];
type SavedMessage = {
  id: string; chatSessionId: string; senderType: string; messageType: string;
  body: string; assetId: null; chatFeatureOrderId: null;
  modelMetadata: unknown; safetyMetadata: unknown; createdAt: Date;
};

function message(id: string, modelMetadata: unknown = {}, body = 'Synthetic ordinary body'): SavedMessage {
  return { id, chatSessionId: SESSION, senderType: 'user', messageType: 'text', body,
    assetId: null, chatFeatureOrderId: null, modelMetadata, safetyMetadata: {}, createdAt: SAVED_AT };
}

function query(value?: string) {
  return value === undefined ? '' : '?' + new URLSearchParams({ storyProgressId: value }).toString();
}

function keyedQuery(key: string, value: string) {
  return '?' + new URLSearchParams({ [key]: value }).toString();
}

function repeatedQuery(values: string[]) {
  const params = new URLSearchParams();
  for (const value of values) params.append('storyProgressId', value);
  return '?' + params.toString();
}

const SINGLETON_QUERY = keyedQuery('storyProgressId[]', PROGRESS);
const INVALID_QUERIES = [
  repeatedQuery([PROGRESS, OTHER_PROGRESS]),
  repeatedQuery([PROGRESS, PROGRESS]),
  keyedQuery('storyProgressId[node]', PROGRESS),
  keyedQuery('storyProgressId[0][node]', PROGRESS),
  query('synthetic-not-a-uuid'),
  query(PROGRESS.replace('-4000-', '-1000-')),
  query(''),
  query(' ' + PROGRESS),
  query('00000000-0000-0000-0000-000000000000'),
];

function mutationGuards() {
  const denied = () => jest.fn(() => { throw new Error('Synthetic history mutation forbidden'); });
  return { create: denied(), createMany: denied(), createManyAndReturn: denied(),
    update: denied(), updateMany: denied(), updateManyAndReturn: denied(),
    upsert: denied(), delete: denied(), deleteMany: denied() };
}

function storageFixture() {
  const scope: StoryChatRouteScope = {
    progressId: PROGRESS, workId: WORK, releaseId: RELEASE, routeNodeId: ROUTE,
    progressRevision: 7, progressUpdatedAt: SAVED_AT,
    resetCommandId: null, resetAfterRevision: null,
    identityProfileId: PROFILE, identityProfileVersion: 1, identityReviewRevision: 1,
    identitySourceFingerprint: 'synthetic-source-fingerprint',
    identityApprovedFingerprint: 'synthetic-approved-fingerprint',
  };
  const newSession = () => ({ id: SESSION, userId: OWNER, artistId: ARTIST, chatPersonaId: null,
    status: 'active', createdAt: SAVED_AT, updatedAt: SAVED_AT, chatPersona: null,
    artist: { id: ARTIST, slug: 'synthetic-history-artist', displayName: 'Synthetic history artist',
      status: 'active', publicProfile: { publicMetadata: {} }, contentProfile: { contentTone: 'Synthetic only' } } });
  const newProgress = () => ({ id: PROGRESS, userId: OWNER, status: 'active', workId: WORK,
    activeReleaseId: RELEASE, routeNodeId: ROUTE, progressRevision: 7, updatedAt: SAVED_AT,
    participantArtist: { artistId: ARTIST, identityProfileId: PROFILE, identityProfileVersion: 1,
      identityReviewRevision: 1, identitySourceFingerprint: scope.identitySourceFingerprint,
      identityApprovedFingerprint: scope.identityApprovedFingerprint } });
  const state = { session: newSession() as ReturnType<typeof newSession> | null,
    progress: newProgress() as ReturnType<typeof newProgress> | null,
    rows: [] as SavedMessage[], routeMissing: false,
    reload: 'none' as 'none' | 'changed' | 'gone', scopeReads: 0,
    storageFailure: null as Error | null };
  const writes = { artist: mutationGuards(), artistPublicProfile: mutationGuards(),
    artistContentProfile: mutationGuards(), artistStoryIdentityProfile: mutationGuards(),
    chatSession: mutationGuards(), chatMessage: mutationGuards(), chatFeatureOrder: mutationGuards(),
    walletAccount: mutationGuards(), walletLedger: mutationGuards(),
    storyReaderProgress: mutationGuards(), storyProgressRouteNode: mutationGuards(),
    storyResetCommand: mutationGuards() };
  const blocked = () => jest.fn(() => { throw new Error('Synthetic history side effect or paid dependency forbidden'); });
  const prisma = {
    ...writes,
    artist: { ...writes.artist, findUnique: blocked() },
    chatSession: { ...writes.chatSession, findFirst: jest.fn(async ({ where }: {
      where: { id: string; userId: string; status: string };
    }) => {
      const row = state.session;
      return row && row.id === where.id && row.userId === where.userId && row.status === where.status ? row : null;
    }) },
    chatMessage: { ...writes.chatMessage,
      findFirst: jest.fn(async ({ where }: { where: { chatSessionId: string; senderType: string; messageType: string } }) =>
        state.rows.find(row => row.chatSessionId === where.chatSessionId && row.senderType === where.senderType &&
          row.messageType === where.messageType) ?? null),
      findMany: jest.fn(async ({ where }: { where: {
        chatSessionId: string; modelMetadata?: { path: string[]; equals: unknown };
      } }) => {
        if (state.storageFailure) throw state.storageFailure;
        return state.rows.filter(row => row.chatSessionId === where.chatSessionId &&
          (!where.modelMetadata || isDeepStrictEqual(
            (row.modelMetadata as Record<string, unknown> | null)?.storyRouteScope, where.modelMetadata.equals)));
      }),
    },
    storyReaderProgress: { ...writes.storyReaderProgress, findFirst: jest.fn(async ({ where }: {
      where: { id: string; userId: string; participantArtist: { is: { artistId: string } } };
    }) => {
      ++state.scopeReads;
      const row = state.progress;
      // Synthetic UUID storage matches case-insensitively; the service's input validation is not replaced.
      if (!row || row.id.toLowerCase() !== where.id.toLowerCase() || row.userId !== where.userId ||
          row.participantArtist.artistId !== where.participantArtist.is.artistId) return null;
      if (state.scopeReads > 1 && state.reload === 'gone') return null;
      return state.scopeReads > 1 && state.reload === 'changed' ? { ...row, routeNodeId: CHANGED_ROUTE } : row;
    }) },
    storyProgressRouteNode: { ...writes.storyProgressRouteNode, findFirst: jest.fn(async ({ where }: {
      where: { id: string };
    }) => state.routeMissing ? null : { id: where.id }) },
    artistStoryIdentityProfile: { ...writes.artistStoryIdentityProfile,
      findFirst: jest.fn(async () => ({ id: PROFILE })) },
    storyResetCommand: { ...writes.storyResetCommand, findFirst: jest.fn(async () => null) },
    chatFeatureOrder: { ...writes.chatFeatureOrder, findFirst: blocked(), findUnique: blocked() },
    walletAccount: { ...writes.walletAccount, findUnique: blocked() },
    walletLedger: { ...writes.walletLedger, findMany: blocked() },
    user: { findUnique: blocked() },
    $transaction: blocked(), $queryRaw: blocked(), $queryRawUnsafe: blocked(),
    $executeRaw: blocked(), $executeRawUnsafe: blocked(),
  };
  const provider = { readiness: blocked(), generate: blocked(), fallbackResult: blocked() };
  const service = new ChatService(prisma as never, provider as never);
  const getMessages = jest.spyOn(service, 'getMessages');
  const effects = [
    jest.spyOn(service as unknown as { ensureSessionOpeningGreeting(...args: unknown[]): Promise<unknown> },
      'ensureSessionOpeningGreeting'),
    jest.spyOn(service as unknown as { buildOpeningGreetingCandidate(...args: unknown[]): Promise<unknown> },
      'buildOpeningGreetingCandidate'),
    jest.spyOn(service, 'createSession'), jest.spyOn(service, 'createMessage'),
    jest.spyOn(service, 'generateMessage'), jest.spyOn(service, 'preflightMessage'),
    jest.spyOn(service as unknown as { failFeatureOrderAndRestoreLumina(...args: unknown[]): Promise<unknown> },
      'failFeatureOrderAndRestoreLumina'),
  ];
  const forbidden = [prisma.artist.findUnique, prisma.user.findUnique,
    prisma.chatFeatureOrder.findFirst, prisma.chatFeatureOrder.findUnique,
    prisma.walletAccount.findUnique, prisma.walletLedger.findMany,
    prisma.$transaction, prisma.$queryRaw, prisma.$queryRawUnsafe, prisma.$executeRaw, prisma.$executeRawUnsafe,
    ...Object.values(provider), ...effects];
  const reads = [prisma.chatSession.findFirst, prisma.chatMessage.findFirst, prisma.chatMessage.findMany,
    prisma.storyReaderProgress.findFirst, prisma.storyProgressRouteNode.findFirst,
    prisma.artistStoryIdentityProfile.findFirst, prisma.storyResetCommand.findFirst];
  function clearReads() {
    state.scopeReads = 0;
    for (const read of reads) read.mockClear();
  }
  return { state, scope, prisma, service, getMessages, clearReads,
    snapshot: () => JSON.stringify({ session: state.session, progress: state.progress, rows: state.rows }),
    reset() {
      state.session = newSession(); state.progress = newProgress(); state.rows = [];
      state.routeMissing = false; state.reload = 'none'; state.storageFailure = null;
      clearReads(); getMessages.mockClear();
      for (const guard of forbidden) guard.mockClear();
      for (const delegate of Object.values(writes)) for (const guard of Object.values(delegate)) guard.mockClear();
    },
    expectReadOnly() {
      for (const delegate of Object.values(writes)) for (const guard of Object.values(delegate)) {
        expect(guard).not.toHaveBeenCalled();
      }
      for (const guard of forbidden) expect(guard).not.toHaveBeenCalled();
    },
  };
}

type Reply = { status: number; headers: IncomingHttpHeaders; text: string; body: unknown };
const rawQueries: unknown[] = [];
const authenticate = jest.fn((context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>;
    user?: { id: string } }>();
  if (req.headers['x-qa-auth'] !== 'synthetic-allowed') {
    throw new UnauthorizedException('Synthetic history authentication rejected');
  }
  req.user = { id: OWNER };
  return true;
});

describe('saved history raw storyProgressId boundary through real Nest HTTP and ChatService', () => {
  let app: INestApplication | undefined;
  let port: number;
  let f: ReturnType<typeof storageFixture>;
  const activeRequests = new Set<ClientRequest>();

  beforeAll(async () => {
    f = storageFixture();
    const module = await Test.createTestingModule({ controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: f.service }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: authenticate }).compile();
    app = module.createNestApplication({ logger: false });
    app.use((req: { query?: { storyProgressId?: unknown } }, _res: unknown, next: () => void) => {
      rawQueries.push(req.query?.storyProgressId); next();
    });
    app.use(storyChatHistoryPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { f.reset(); authenticate.mockClear(); rawQueries.length = 0; });
  afterEach(() => { f.expectReadOnly(); });
  afterAll(async () => {
    try {
      for (const req of activeRequests) req.destroy();
      activeRequests.clear();
      await app?.close();
    } finally { jest.restoreAllMocks(); }
  });

  function call(method: Method, suffix = '', allowed = true) {
    return new Promise<Reply>((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const finish = (error: unknown, reply?: Reply) => {
        if (settled) return;
        settled = true; clearTimeout(deadline); activeRequests.delete(req);
        if (error) reject(error); else resolve(reply!);
      };
      const req = request({ hostname: '127.0.0.1', port, method, agent: false,
        path: `/api/v1/chat/sessions/${SESSION}/messages${suffix}`,
        headers: allowed ? { 'x-qa-auth': 'synthetic-allowed' } : {},
      }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 65536) {
            const error = new Error('Synthetic history response exceeded fixture bound');
            req.destroy(error); finish(error); return;
          }
          chunks.push(chunk);
        });
        res.on('aborted', () => finish(new Error('Synthetic history response aborted')));
        res.on('error', error => finish(error));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            finish(null, { status: res.statusCode!, headers: res.headers, text,
              body: text ? JSON.parse(text) : undefined });
          } catch (error) { finish(error); }
        });
      });
      activeRequests.add(req);
      deadline = setTimeout(() => {
        const error = new Error('Synthetic history loopback 15-second deadline exceeded');
        req.destroy(error); finish(error);
      }, 15000);
      req.on('error', error => finish(error));
      req.end();
    });
  }

  function status(reply: Reply, expected: number, method: Method, code?: string) {
    expect(reply.status).toBe(expected);
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers['set-cookie']).toBeUndefined();
    if (method === 'HEAD') expect(reply.text).toBe('');
    else if (expected >= 400) expect(reply.body).toMatchObject({ success: false, error: {
      statusCode: expected, code,
    } });
  }

  function ownedCheck() {
    expect(f.prisma.chatSession.findFirst).toHaveBeenCalledTimes(1);
    expect(f.prisma.chatSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: SESSION, userId: OWNER, status: 'active' },
    }));
  }

  function noHistoryOrRouteReads() {
    for (const read of [f.prisma.chatMessage.findFirst, f.prisma.chatMessage.findMany,
      f.prisma.storyReaderProgress.findFirst, f.prisma.storyProgressRouteNode.findFirst,
      f.prisma.artistStoryIdentityProfile.findFirst, f.prisma.storyResetCommand.findFirst]) {
      expect(read).not.toHaveBeenCalled();
    }
  }

  it('missing optional progress returns ordinary empty history without bootstrapping on GET and HEAD', async () => {
    const before = f.snapshot();
    for (const method of METHODS) {
      f.clearReads(); const reply = await call(method); status(reply, 200, method);
      if (method === 'GET') expect(reply.body).toEqual([]);
      ownedCheck();
      expect(f.getMessages).toHaveBeenLastCalledWith(OWNER, SESSION, undefined);
      expect(f.prisma.chatMessage.findFirst).toHaveBeenCalledWith({
        where: { chatSessionId: SESSION, senderType: 'artist', messageType: 'opening_greeting' },
        orderBy: { createdAt: 'asc' },
      });
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { chatSessionId: SESSION }, orderBy: { createdAt: 'asc' },
      });
      expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(2);
  });

  it('valid v4 and uppercase progress stay unchanged through two current-route loads and exact marker filtering', async () => {
    const marker = storyChatRouteMarker(f.scope);
    const saved = message('synthetic-current-route-row', { storyRouteScope: marker }, 'Synthetic saved route body');
    f.state.rows = [message('synthetic-ordinary-row'),
      message('synthetic-other-route-row', { storyRouteScope: { ...marker, routeNodeId: CHANGED_ROUTE } }), saved];
    const before = f.snapshot();
    for (const progress of [PROGRESS, PROGRESS.toUpperCase()]) for (const method of METHODS) {
      f.clearReads(); const reply = await call(method, query(progress)); status(reply, 200, method);
      if (method === 'GET') expect(reply.body).toEqual(JSON.parse(JSON.stringify([saved])));
      ownedCheck();
      expect(f.getMessages).toHaveBeenLastCalledWith(OWNER, SESSION, progress);
      expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledTimes(2);
      expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: progress, userId: OWNER, status: { in: ['active', 'completed'] },
          participantArtist: { is: { artistId: ARTIST, identityApprovedFingerprint: { not: null } } } },
      }));
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { chatSessionId: SESSION, modelMetadata: { path: ['storyRouteScope'], equals: marker } },
        orderBy: { createdAt: 'asc' },
      });
      const loads = f.prisma.storyReaderProgress.findFirst.mock.invocationCallOrder;
      const read = f.prisma.chatMessage.findMany.mock.invocationCallOrder[0];
      expect(loads[0]).toBeLessThan(read); expect(loads[1]).toBeGreaterThan(read);
      for (const lookup of [f.prisma.storyProgressRouteNode.findFirst,
        f.prisma.artistStoryIdentityProfile.findFirst, f.prisma.storyResetCommand.findFirst]) {
        expect(lookup).toHaveBeenCalledTimes(2);
      }
      expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(4);
  });

  it('singleton bracket-array progress is private 400 after the owned-session check without route or message reads', async () => {
    const before = f.snapshot();
    for (const method of METHODS) {
      f.clearReads(); const reply = await call(method, SINGLETON_QUERY);
      expect(rawQueries.at(-1)).toEqual([PROGRESS]);
      status(reply, 400, method, 'BAD_REQUEST');
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'storyProgressId must be a UUID v4' } });
      expect(f.getMessages).toHaveBeenLastCalledWith(OWNER, SESSION, [PROGRESS]);
      ownedCheck(); noHistoryOrRouteReads();
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(2);
  });

  it('repeated nested malformed non-v4 and empty progress are private 400 after ownership without history fallback', async () => {
    const before = f.snapshot();
    for (const suffix of INVALID_QUERIES) for (const method of METHODS) {
      f.clearReads(); const reply = await call(method, suffix); status(reply, 400, method, 'BAD_REQUEST');
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'storyProgressId must be a UUID v4' } });
      ownedCheck(); noHistoryOrRouteReads();
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(INVALID_QUERIES.length * 2);
  });

  it('anonymous history requests are private 401 before the real service or synthetic storage', async () => {
    const before = f.snapshot();
    for (const suffix of ['', query(PROGRESS), SINGLETON_QUERY, query('synthetic-not-a-uuid')]) {
      for (const method of METHODS) status(await call(method, suffix, false), 401, method, 'UNAUTHORIZED');
    }
    expect(authenticate).toHaveBeenCalledTimes(8);
    expect(f.getMessages).not.toHaveBeenCalled();
    expect(f.prisma.chatSession.findFirst).not.toHaveBeenCalled(); noHistoryOrRouteReads();
    expect(f.snapshot()).toBe(before);
  });

  it('unowned session 404 precedes malformed or bracket-array progress validation', async () => {
    f.state.session!.userId = OTHER_OWNER;
    const before = f.snapshot();
    for (const suffix of [query('synthetic-not-a-uuid'), SINGLETON_QUERY]) for (const method of METHODS) {
      f.clearReads(); const reply = await call(method, suffix); status(reply, 404, method, 'NOT_FOUND');
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'Active chat session not found' } });
      ownedCheck(); noHistoryOrRouteReads();
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(4);
  });

  it('missing and stale current routes return private 409 without ordinary or scoped message leakage', async () => {
    const marker = storyChatRouteMarker(f.scope);
    const saved = message('synthetic-scoped-row', { storyRouteScope: marker }, 'Synthetic saved route body');
    f.state.rows = [message('synthetic-ordinary-row'), saved];
    const progress = f.state.progress;
    for (const condition of ['missing-progress', 'missing-route', 'changed-reload', 'gone-reload']) {
      f.state.progress = condition === 'missing-progress' ? null : progress;
      f.state.routeMissing = condition === 'missing-route';
      f.state.reload = condition === 'changed-reload' ? 'changed' : condition === 'gone-reload' ? 'gone' : 'none';
      const before = f.snapshot();
      for (const method of METHODS) {
        f.clearReads(); const reply = await call(method, query(PROGRESS));
        status(reply, 409, method, 'STORY_CHAT_ROUTE_CHANGED'); ownedCheck();
        expect(reply.text).not.toContain('Synthetic saved route body');
        expect(reply.text).not.toContain('Synthetic ordinary body');
        const stale = condition.endsWith('reload');
        expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledTimes(stale ? 2 : 1);
        expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(stale ? 1 : 0);
        if (stale) expect(f.prisma.chatMessage.findMany).toHaveBeenCalledWith({
          where: { chatSessionId: SESSION, modelMetadata: { path: ['storyRouteScope'], equals: marker } },
          orderBy: { createdAt: 'asc' },
        });
        expect(f.prisma.chatMessage.findFirst).not.toHaveBeenCalled();
        expect(f.snapshot()).toBe(before);
      }
    }
    expect(f.getMessages).toHaveBeenCalledTimes(8);
  });

  it('storage failures stay private filtered 500 without provider greeting writes transactions or paid retries', async () => {
    f.state.storageFailure = new Error('Synthetic history storage failure');
    f.state.rows = [message('synthetic-unreturned-row')];
    const before = f.snapshot();
    for (const suffix of ['', query(PROGRESS)]) for (const method of METHODS) {
      f.clearReads(); const reply = await call(method, suffix); status(reply, 500, method, 'INTERNAL_SERVER_ERROR');
      if (method === 'GET') expect(reply.body).toMatchObject({ error: { message: 'Internal server error' } });
      expect(reply.text).not.toContain('Synthetic history storage failure');
      expect(reply.text).not.toContain('Synthetic ordinary body');
      ownedCheck();
      expect(f.prisma.chatMessage.findMany).toHaveBeenCalledTimes(1);
      expect(f.prisma.storyReaderProgress.findFirst).toHaveBeenCalledTimes(suffix ? 1 : 0);
      expect(f.prisma.chatMessage.findFirst).toHaveBeenCalledTimes(suffix ? 0 : 1);
      expect(f.snapshot()).toBe(before);
    }
    expect(f.getMessages).toHaveBeenCalledTimes(4);
  });
});

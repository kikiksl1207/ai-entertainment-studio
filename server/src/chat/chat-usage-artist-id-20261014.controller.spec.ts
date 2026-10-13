import 'reflect-metadata';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { chatBoostsPrivacyMiddleware } from '../common/chat-boosts-privacy';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

// Author UNRUN: actual Nest HTTP/controller/filter routing with synthetic guards and one inert method.
// No Prisma instance, real authentication, provider, cache-store behavior, or actual AI is exercised.
jest.setTimeout(20000);

const OWNER_A = '00000000-0000-4000-8000-000000001201';
const OWNER_B = '00000000-0000-4000-8000-000000001202';
const ARTIST_A = '0000000a-0000-4000-8000-000000001203';
const ARTIST_B = '0000000b-0000-4000-8000-000000001204';
const ORIGIN = 'https://chat-usage-artist-id-qa.example.invalid';
const PATH = '/chat/usage-summary';
const METHODS = ['GET', 'HEAD'] as const;
const CANONICAL_ARTIST_IDS = [
  { label: 'uppercase-v4', value: ARTIST_A.toUpperCase() },
  { label: 'v1', value: '00000000-0000-1000-8000-000000001205' },
  { label: 'v3', value: '00000000-0000-3000-8000-000000001206' },
  { label: 'v5', value: '00000000-0000-5000-8000-000000001207' },
  { label: 'v7', value: '00000000-0000-7000-8000-000000001208' },
  { label: 'zero-version-and-variant', value: '00000000-0000-0000-0000-000000001209' },
  { label: 'hex-f-version-and-non-rfc-variant', value: '00000000-0000-f000-1000-00000000120a' },
  { label: 'nil', value: '00000000-0000-0000-0000-000000000000' },
  { label: 'max', value: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
];
const MALFORMED_ARTIST_IDS = [
  'synthetic-not-a-uuid',
  ARTIST_A.replace(/-/g, ''),
  '{' + ARTIST_A + '}',
  ARTIST_A.replace('a', '\uff41'),
  ' ' + ARTIST_A,
  ARTIST_A + ' ',
  '\t' + ARTIST_A,
  ARTIST_A + '\n',
];

function pathFor(artistId?: string) {
  return artistId === undefined ? PATH : PATH + '?' + new URLSearchParams({ artistId }).toString();
}

function duplicatePath(values: readonly string[]) {
  const query = new URLSearchParams();
  for (const value of values) query.append('artistId', value);
  return PATH + '?' + query.toString();
}

const BAD_QUERY_PATHS = [pathFor(MALFORMED_ARTIST_IDS[0]), duplicatePath([ARTIST_A, ARTIST_B])];
type SyntheticIdentity = 'a' | 'b';
type SyntheticRequest = {
  headers: Record<string, string | string[] | undefined>;
  query?: { artistId?: unknown };
  user?: { id: string };
};
let authenticationChecks = 0;
const receivedArtistQueries: unknown[] = [];

@Injectable()
class SyntheticGlobal429Guard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SyntheticRequest>();
    if (request.headers['x-qa-global-429'] === 'yes') {
      throw new HttpException('Synthetic global rejection', 429);
    }
    return true;
  }
}

@Injectable()
class SyntheticAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    authenticationChecks += 1;
    const request = context.switchToHttp().getRequest<SyntheticRequest>();
    const identity = request.headers['x-qa-identity'];
    if (request.headers['x-qa-auth'] !== 'synthetic-allowed' ||
        (identity !== 'a' && identity !== 'b')) {
      throw new UnauthorizedException('Synthetic authentication rejection');
    }
    if (request.headers['x-qa-forbidden'] === 'yes') {
      throw new ForbiddenException('Synthetic permission rejection');
    }
    request.user = { id: identity === 'a' ? OWNER_A : OWNER_B };
    return true;
  }
}

const usageFixture = (userId: string, artistId: string) => ({
  syntheticOnly: true, surface: 'usage-summary', userId, artistId,
});
const chat = {
  getUsageSummary: jest.fn(async (userId: string, input: { artistId: string }) =>
    usageFixture(userId, input.artistId)),
};

describe('chat usage artistId validation through existing Nest HTTP routes', () => {
  let app: INestApplication | undefined;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: chat },
        { provide: APP_GUARD, useClass: SyntheticGlobal429Guard },
      ],
    }).overrideGuard(JwtAuthGuard).useClass(SyntheticAuthenticationGuard).compile();
    app = module.createNestApplication({ logger: false });
    app.use((request: SyntheticRequest, response: { vary(field: string): unknown }, next: () => void) => {
      receivedArtistQueries.push(request.query?.artistId);
      response.vary('Origin');
      response.vary('Accept-Encoding');
      next();
    });
    app.use(chatBoostsPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [ORIGIN], credentials: true });
    await app.listen(0, '127.0.0.1');
    base = 'http://127.0.0.1:' + app.getHttpServer().address().port;
  });

  beforeEach(() => {
    authenticationChecks = 0;
    receivedArtistQueries.length = 0;
    chat.getUsageSummary.mockReset().mockImplementation(async (userId, input) =>
      usageFixture(userId, input.artistId));
  });

  afterAll(async () => { await app?.close(); });

  function allowed(identity: SyntheticIdentity = 'a'): Record<string, string> {
    return { 'x-qa-auth': 'synthetic-allowed', 'x-qa-identity': identity };
  }

  async function call(method: string, path: string, extra: Record<string, string> = {}) {
    const response = await fetch(base + '/api/v1' + path, {
      method, headers: { Origin: ORIGIN, ...extra },
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    expect(response.headers.get('set-cookie')).toBeNull();
    if (method === 'HEAD') expect(text).toBe('');
    return { response, text };
  }

  type Result = Awaited<ReturnType<typeof call>>;

  function privateStatus(result: Result, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    const vary = (result.response.headers.get('vary') ?? '')
      .toLowerCase().split(',').map(value => value.trim());
    expect(vary.slice().sort()).toEqual(['accept-encoding', 'authorization', 'origin']);
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  }

  function filteredError(result: Result, statusCode: number, code: string) {
    expect(JSON.parse(result.text)).toMatchObject({ success: false, error: { statusCode, code } });
  }

  it('valid GET preserves the synthetic owner and artist arguments with private 200', async () => {
    const result = await call('GET', pathFor(ARTIST_A), allowed());
    privateStatus(result, 200);
    expect(JSON.parse(result.text)).toEqual(usageFixture(OWNER_A, ARTIST_A));
    expect(receivedArtistQueries).toEqual([ARTIST_A]);
    expect(chat.getUsageSummary.mock.calls).toEqual([[OWNER_A, { artistId: ARTIST_A }]]);
  });

  it('valid HEAD preserves the GET service arguments with private 200 and no body', async () => {
    const result = await call('HEAD', pathFor(ARTIST_A), allowed());
    privateStatus(result, 200);
    expect(result.text).toBe('');
    expect(chat.getUsageSummary.mock.calls).toEqual([[OWNER_A, { artistId: ARTIST_A }]]);
  });

  it('canonical all UUID matrix preserves uppercase non-v4 nil max and unrestricted hex version and variant', async () => {
    const expectedCalls: Array<[string, { artistId: string }]> = [];
    for (const { value: artistId } of CANONICAL_ARTIST_IDS) for (const method of METHODS) {
      const result = await call(method, pathFor(artistId), allowed());
      privateStatus(result, 200);
      if (method === 'GET') expect(JSON.parse(result.text)).toEqual(usageFixture(OWNER_A, artistId));
      expectedCalls.push([OWNER_A, { artistId }]);
    }
    expect(chat.getUsageSummary.mock.calls).toEqual(expectedCalls);
    expect(chat.getUsageSummary).toHaveBeenCalledTimes(CANONICAL_ARTIST_IDS.length * 2);
  });

  it('missing artistId retains the original required-field 400 message without service dispatch', async () => {
    for (const method of METHODS) {
      const result = await call(method, pathFor(), allowed());
      privateStatus(result, 400);
      if (method === 'GET') {
        filteredError(result, 400, 'BAD_REQUEST');
        expect(JSON.parse(result.text).error.message).toBe('artistId is required');
      }
    }
    expect(receivedArtistQueries).toEqual([undefined, undefined]);
    expect(authenticationChecks).toBe(2);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('empty artistId remains private 400 without service dispatch or an old empty-message requirement', async () => {
    for (const method of METHODS) {
      const result = await call(method, pathFor(''), allowed());
      privateStatus(result, 400);
      if (method === 'GET') filteredError(result, 400, 'BAD_REQUEST');
    }
    expect(receivedArtistQueries).toEqual(['', '']);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('malformed non-UUID compact brace Unicode and whitespace artistId values are private 400 before service dispatch', async () => {
    for (const artistId of MALFORMED_ARTIST_IDS) for (const method of METHODS) {
      const result = await call(method, pathFor(artistId), allowed());
      expect(receivedArtistQueries.at(-1)).toBe(artistId);
      privateStatus(result, 400);
      if (method === 'GET') filteredError(result, 400, 'BAD_REQUEST');
    }
    expect(authenticationChecks).toBe(MALFORMED_ARTIST_IDS.length * 2);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('actual duplicate artistId query arrays are private 400 without selecting coercing or dispatching a value', async () => {
    for (const values of [[ARTIST_A, ARTIST_B], [ARTIST_A, ARTIST_A], ['', ARTIST_A]]) {
      for (const method of METHODS) {
        const result = await call(method, duplicatePath(values), allowed());
        expect(Array.isArray(receivedArtistQueries.at(-1))).toBe(true);
        expect(receivedArtistQueries.at(-1)).toEqual(values);
        privateStatus(result, 400);
        if (method === 'GET') filteredError(result, 400, 'BAD_REQUEST');
      }
    }
    expect(authenticationChecks).toBe(6);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('anonymous malformed and duplicate queries receive private 401 before the pipe without service dispatch', async () => {
    for (const path of BAD_QUERY_PATHS) for (const method of METHODS) {
      const result = await call(method, path);
      privateStatus(result, 401);
      if (method === 'GET') filteredError(result, 401, 'UNAUTHORIZED');
    }
    expect(authenticationChecks).toBe(4);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('synthetic forbidden bad queries receive private 403 before the pipe without service dispatch', async () => {
    const headers = { ...allowed(), 'x-qa-forbidden': 'yes' };
    for (const path of BAD_QUERY_PATHS) for (const method of METHODS) {
      const result = await call(method, path, headers);
      privateStatus(result, 403);
      if (method === 'GET') filteredError(result, 403, 'FORBIDDEN');
    }
    expect(authenticationChecks).toBe(4);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('synthetic global429 rejects bad queries privately before authentication or the pipe', async () => {
    for (const path of BAD_QUERY_PATHS) for (const method of METHODS) {
      const result = await call(method, path, { 'x-qa-global-429': 'yes' });
      privateStatus(result, 429);
      if (method === 'GET') filteredError(result, 429, 'TOO_MANY_REQUESTS');
    }
    expect(authenticationChecks).toBe(0);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('repeated valid reads preserve both synthetic owner and artist scopes across GET and HEAD', async () => {
    const sequence: Array<{ identity: SyntheticIdentity; userId: string; artistId: string }> = [
      { identity: 'a', userId: OWNER_A, artistId: ARTIST_A },
      { identity: 'b', userId: OWNER_B, artistId: ARTIST_B },
      { identity: 'a', userId: OWNER_A, artistId: ARTIST_B },
      { identity: 'b', userId: OWNER_B, artistId: ARTIST_A },
    ];
    const expectedCalls: Array<[string, { artistId: string }]> = [];
    for (const { identity, userId, artistId } of sequence) for (const method of METHODS) {
      const result = await call(method, pathFor(artistId), allowed(identity));
      privateStatus(result, 200);
      if (method === 'GET') expect(JSON.parse(result.text)).toEqual(usageFixture(userId, artistId));
      expectedCalls.push([userId, { artistId }]);
    }
    expect(chat.getUsageSummary.mock.calls).toEqual(expectedCalls);
    expect(chat.getUsageSummary).toHaveBeenCalledTimes(8);
  });

  it('inert service 404 and 500 retain private filtered errors for valid GET and HEAD', async () => {
    const notFound = new NotFoundException('Synthetic artist fixture not found');
    const failure = new Error('Synthetic inert service failure');
    for (const rejection of [notFound, failure]) {
      chat.getUsageSummary.mockRejectedValue(rejection);
      const status = rejection === notFound ? 404 : 500;
      for (const method of METHODS) {
        const result = await call(method, pathFor(ARTIST_A), allowed());
        privateStatus(result, status);
        if (method === 'GET') {
          filteredError(result, status, status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
          expect(JSON.parse(result.text).error.message).toBe(
            status === 404 ? 'Synthetic artist fixture not found' : 'Internal server error');
          if (status === 500) expect(result.text).not.toContain(failure.message);
        }
      }
    }
    expect(chat.getUsageSummary.mock.calls).toEqual([
      [OWNER_A, { artistId: ARTIST_A }], [OWNER_A, { artistId: ARTIST_A }],
      [OWNER_A, { artistId: ARTIST_A }], [OWNER_A, { artistId: ARTIST_A }],
    ]);
  });
});

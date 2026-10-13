import 'reflect-metadata';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatController } from '../chat/chat.controller';
import { ChatService } from '../chat/chat.service';
import { chatBoostsPrivacyMiddleware } from './chat-boosts-privacy';
import { HttpExceptionFilter } from './http-exception.filter';
import { configureHttpRouting } from './http-routing';

// Source plan UNRUN: real Nest HTTP routing, synthetic guards, and two inert service methods only.
// No production authentication, database, provider, usage accounting, or actual AI is exercised.
jest.setTimeout(20000);

const USER_A = '00000000-0000-4000-8000-000000000901';
const USER_B = '00000000-0000-4000-8000-000000000902';
const ARTIST_A = '00000000-0000-4000-8000-000000000903';
const ARTIST_B = '00000000-0000-4000-8000-000000000904';
const ORIGIN = 'https://chat-usage-privacy-qa.example.invalid';
const USAGE_PATH = '/chat/usage-summary';
const OPS_PATH = '/chat/provider-ops-status';
const usagePath = (artistId = ARTIST_A) => USAGE_PATH + '?artistId=' + artistId;
const READ_PATHS = [usagePath(), OPS_PATH];
const READ_METHODS = ['GET', 'HEAD'] as const;
type SyntheticIdentity = 'a' | 'b';
type SyntheticRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: { id: string };
};
let authenticationChecks = 0;

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
    request.user = { id: identity === 'a' ? USER_A : USER_B };
    return true;
  }
}

const usageFixture = (userId: string, artistId: string) => ({
  syntheticOnly: true, surface: 'usage-summary', userId, artistId,
});
const opsFixture = (userId: string) => ({
  syntheticOnly: true, surface: 'provider-ops-status', userId,
});
const chat = {
  getUsageSummary: jest.fn(async (userId: string, input: { artistId: string }) =>
    usageFixture(userId, input.artistId)),
  getProviderOpsStatus: jest.fn(async (userId: string) => opsFixture(userId)),
};

describe('chat usage and provider-ops privacy through existing Nest HTTP routes', () => {
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
    app.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
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
    chat.getUsageSummary.mockReset().mockImplementation(async (userId, input) =>
      usageFixture(userId, input.artistId));
    chat.getProviderOpsStatus.mockReset().mockImplementation(async userId => opsFixture(userId));
  });

  afterAll(async () => { await app?.close(); });

  function allowed(identity: SyntheticIdentity = 'a'): Record<string, string> {
    return { 'x-qa-auth': 'synthetic-allowed', 'x-qa-identity': identity };
  }

  function dispatches() {
    return chat.getUsageSummary.mock.calls.length + chat.getProviderOpsStatus.mock.calls.length;
  }

  async function call(method: string, path: string, extra: Record<string, string> = {}, body?: string) {
    const headers: Record<string, string> = { Origin: ORIGIN, ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + '/api/v1' + path, {
      method, headers, body, redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    const text = await response.text();
    expect(response.headers.get('set-cookie')).toBeNull();
    if (method === 'HEAD') expect(text).toBe('');
    return { response, text };
  }

  type Result = Awaited<ReturnType<typeof call>>;

  function varyFields(result: Result) {
    return (result.response.headers.get('vary') ?? '')
      .toLowerCase().split(',').map(value => value.trim());
  }

  function privateStatus(result: Result, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    const vary = varyFields(result);
    expect(vary.slice().sort()).toEqual(['accept-encoding', 'authorization', 'origin']);
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  }

  function unaffectedStatus(result: Result, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBeNull();
    expect(varyFields(result)).toEqual(expect.arrayContaining(['origin', 'accept-encoding']));
    expect(varyFields(result)).not.toContain('authorization');
  }

  function filteredError(result: Result, statusCode: number) {
    expect(JSON.parse(result.text)).toMatchObject({ success: false, error: { statusCode } });
  }

  it('GET usage-summary is private and preserves synthetic user and artist arguments', async () => {
    const result = await call('GET', usagePath(), allowed());
    privateStatus(result, 200);
    expect(JSON.parse(result.text)).toEqual(usageFixture(USER_A, ARTIST_A));
    expect(chat.getUsageSummary.mock.calls).toEqual([[USER_A, { artistId: ARTIST_A }]]);
    expect(chat.getProviderOpsStatus).not.toHaveBeenCalled();
  });

  it('HEAD usage-summary is private with no body and preserves GET service arguments', async () => {
    const result = await call('HEAD', usagePath(), allowed());
    privateStatus(result, 200);
    expect(result.text).toBe('');
    expect(chat.getUsageSummary.mock.calls).toEqual([[USER_A, { artistId: ARTIST_A }]]);
    expect(chat.getProviderOpsStatus).not.toHaveBeenCalled();
  });

  it('GET provider-ops-status is private and preserves the synthetic user argument', async () => {
    const result = await call('GET', OPS_PATH, allowed());
    privateStatus(result, 200);
    expect(JSON.parse(result.text)).toEqual(opsFixture(USER_A));
    expect(chat.getProviderOpsStatus.mock.calls).toEqual([[USER_A]]);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('HEAD provider-ops-status is private with no body and preserves the GET service argument', async () => {
    const result = await call('HEAD', OPS_PATH, allowed());
    privateStatus(result, 200);
    expect(result.text).toBe('');
    expect(chat.getProviderOpsStatus.mock.calls).toEqual([[USER_A]]);
    expect(chat.getUsageSummary).not.toHaveBeenCalled();
  });

  it('anonymous GET and HEAD receive private 401 on both reads without service dispatch', async () => {
    for (const path of READ_PATHS) for (const method of READ_METHODS) {
      const result = await call(method, path);
      privateStatus(result, 401);
      if (method === 'GET') filteredError(result, 401);
    }
    expect(authenticationChecks).toBe(4);
    expect(dispatches()).toBe(0);
  });

  it('synthetic forbidden GET and HEAD receive private 403 on both reads without service dispatch', async () => {
    const headers = { ...allowed(), 'x-qa-forbidden': 'yes' };
    for (const path of READ_PATHS) for (const method of READ_METHODS) {
      const result = await call(method, path, headers);
      privateStatus(result, 403);
      if (method === 'GET') filteredError(result, 403);
    }
    expect(authenticationChecks).toBe(4);
    expect(dispatches()).toBe(0);
  });

  it('synthetic global429 protects GET and HEAD on both reads before authentication or service dispatch', async () => {
    for (const path of READ_PATHS) for (const method of READ_METHODS) {
      const result = await call(method, path, { 'x-qa-global-429': 'yes' });
      privateStatus(result, 429);
      if (method === 'GET') filteredError(result, 429);
    }
    expect(authenticationChecks).toBe(0);
    expect(dispatches()).toBe(0);
  });

  it('controller missing or empty artistId returns private 400 for GET and HEAD without service dispatch', async () => {
    for (const path of [USAGE_PATH, USAGE_PATH + '?artistId=']) for (const method of READ_METHODS) {
      const result = await call(method, path, allowed());
      privateStatus(result, 400);
      if (method === 'GET') {
        filteredError(result, 400);
        expect(JSON.parse(result.text).error.message).toBe(path === USAGE_PATH ?
          'artistId is required' : 'Validation failed (uuid is expected)');
      }
    }
    expect(authenticationChecks).toBe(4);
    expect(dispatches()).toBe(0);
  });

  it('inert service failures retain private filtered 500 for GET and HEAD on both reads', async () => {
    const failure = new Error('Synthetic inert service failure');
    chat.getUsageSummary.mockRejectedValue(failure);
    chat.getProviderOpsStatus.mockRejectedValue(failure);
    for (const path of READ_PATHS) for (const method of READ_METHODS) {
      const result = await call(method, path, allowed());
      privateStatus(result, 500);
      if (method === 'GET') {
        filteredError(result, 500);
        expect(JSON.parse(result.text).error).toMatchObject({
          code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error',
        });
        expect(result.text).not.toContain(failure.message);
      }
    }
    expect(chat.getUsageSummary.mock.calls).toEqual([
      [USER_A, { artistId: ARTIST_A }], [USER_A, { artistId: ARTIST_A }],
    ]);
    expect(chat.getProviderOpsStatus.mock.calls).toEqual([[USER_A], [USER_A]]);
    expect(dispatches()).toBe(4);
  });

  it('repeated alternating synthetic reads keep identities and artist arguments separate across GET and HEAD', async () => {
    const sequence: Array<{ identity: SyntheticIdentity; userId: string; artistId: string }> = [
      { identity: 'a', userId: USER_A, artistId: ARTIST_A },
      { identity: 'b', userId: USER_B, artistId: ARTIST_B },
      { identity: 'a', userId: USER_A, artistId: ARTIST_B },
    ];
    const usageCalls: Array<[string, { artistId: string }]> = [];
    const opsCalls: Array<[string]> = [];
    for (const { identity, userId, artistId } of sequence) {
      for (const method of READ_METHODS) {
        const usage = await call(method, usagePath(artistId), allowed(identity));
        privateStatus(usage, 200);
        if (method === 'GET') expect(JSON.parse(usage.text)).toEqual(usageFixture(userId, artistId));
        usageCalls.push([userId, { artistId }]);
        const ops = await call(method, OPS_PATH, allowed(identity));
        privateStatus(ops, 200);
        if (method === 'GET') expect(JSON.parse(ops.text)).toEqual(opsFixture(userId));
        opsCalls.push([userId]);
      }
    }
    expect(chat.getUsageSummary.mock.calls).toEqual(usageCalls);
    expect(chat.getProviderOpsStatus.mock.calls).toEqual(opsCalls);
    expect(dispatches()).toBe(12);
  });

  it('adjacent child and lookalike GET and HEAD paths remain non-private 404 without dispatch', async () => {
    for (const path of [USAGE_PATH, OPS_PATH]) for (const suffix of ['/child', '-adjacent']) {
      for (const method of READ_METHODS) {
        unaffectedStatus(await call(method, path + suffix, allowed()), 404);
      }
    }
    expect(authenticationChecks).toBe(0);
    expect(dispatches()).toBe(0);
  });

  it('CORS OPTIONS and wrong mutation methods remain unaffected on both read paths without dispatch', async () => {
    for (const path of READ_PATHS) {
      const preflight = await call('OPTIONS', path, {
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      });
      unaffectedStatus(preflight, 204);
      expect(preflight.text).toBe('');
      expect(preflight.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        unaffectedStatus(await call(method, path, allowed(), '{}'), 404);
      }
    }
    expect(authenticationChecks).toBe(0);
    expect(dispatches()).toBe(0);
  });
});

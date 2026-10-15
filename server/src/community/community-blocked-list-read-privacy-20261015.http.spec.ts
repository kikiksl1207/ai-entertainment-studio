import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import {
  BadRequestException, Controller, ForbiddenException, Get, Header,
  INestApplication, NotFoundException, ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { communityPersonalizedReadPrivacyMiddleware as privacy } from './community-personalized-read.privacy';

jest.setTimeout(20000);
const OWNER_A = '00000000-0000-4000-8000-000000000941';
const OWNER_B = '00000000-0000-4000-8000-000000000942';
const ROUTE = '/api/v1/me/blocked-users';
const ORIGIN = 'https://blocked-cache-qa.example.invalid';
const REASON = 'SYNTHETIC_PRIVATE_BLOCK_REASON';

@Controller('qa-block-cache-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

describe('community blocked list read privacy native HTTP', () => {
  let app: INestApplication | undefined, port = 0, requests = 0, active = true;
  let accessA = '', accessB = '', invalid = '';
  let verify: jest.SpyInstance | undefined;
  const db = { user: { findFirst: jest.fn(async ({ where }: {
    where: { id: string; status: string; deletedAt: unknown };
  }) => active && [OWNER_A, OWNER_B].includes(where.id)
    && where.status === 'active' && where.deletedAt === null
    ? { id: where.id, email: null } : null) } };
  const fixture = (owner: string) => [{ id: 'synthetic-block', status: 'active', reason: REASON,
    blockedAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    user: { id: owner === OWNER_A ? OWNER_B : OWNER_A, displayName: 'Synthetic target' } }];
  const forbiddenReader = () => jest.fn(() => { throw new Error('Unselected community reader forbidden'); });
  const service = {
    getMyBlockedUsers: jest.fn(async (owner: string, _query: Record<string, string>) => fixture(owner)),
    getPersonalizedFeed: forbiddenReader(), getMyLikedPosts: forbiddenReader(),
    getMyHiddenPosts: forbiddenReader(), getFeed: forbiddenReader(), searchFeed: forbiddenReader(),
  };

  beforeAll(async () => {
    // This checks installation text only; main and AppModule are not imported.
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect((main.match(/^import \{ communityPersonalizedReadPrivacyMiddleware \} from '\.\/community\/community-personalized-read\.privacy';$/gm) ?? []).length).toBe(1);
    const install = main.indexOf('app.use(communityPersonalizedReadPrivacyMiddleware)');
    expect(install > main.indexOf('export async function createApplication()') && install < main.indexOf('configureHttpRouting(app)')).toBe(true);
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [CommunityController, PublicProbeController],
      providers: [JwtAuthGuard, { provide: PrismaService, useValue: db },
        { provide: CommunityService, useValue: service },
        { provide: ConfigService, useValue: { getOrThrow(name: string) {
          if (name !== 'JWT_ACCESS_SECRET') throw new Error('Unexpected synthetic configuration key');
          return secret;
        } } },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    accessA = await jwt.signAsync({ sub: OWNER_A, tokenType: 'access' });
    accessB = await jwt.signAsync({ sub: OWNER_B, tokenType: 'access' });
    invalid = await jwt.signAsync({ sub: OWNER_A, tokenType: 'access' }, { secret: randomBytes(32).toString('hex') });
    verify = jest.spyOn(jwt, 'verifyAsync');
    app = module.createNestApplication({ logger: false });
    app.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    app.use(privacy);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [ORIGIN], credentials: true });
    await app.listen(0, '127.0.0.1');
    port = app.getHttpServer().address().port;
  });
  beforeEach(() => {
    active = true; db.user.findFirst.mockClear(); verify?.mockClear();
    service.getMyBlockedUsers.mockReset().mockImplementation(async owner => fixture(owner));
    for (const [name, reader] of Object.entries(service)) if (name !== 'getMyBlockedUsers') reader.mockClear();
  });
  afterEach(() => {
    for (const [name, reader] of Object.entries(service)) if (name !== 'getMyBlockedUsers') expect(reader).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    const server = app?.getHttpServer();
    try { await app?.close(); }
    finally { verify?.mockRestore(); accessA = ''; accessB = ''; invalid = ''; }
    if (server) expect(server.listening).toBe(false);
  });

  async function call(method: string, path: string, token: string | null = accessA, body?: string) {
    requests += 1;
    if (requests > 16 || port <= 0 || !/^\/api\/v1\//i.test(path) || /[\r\n]/.test(path)) {
      throw new Error('Synthetic blocked-list HTTP bound exceeded');
    }
    const headers: Record<string, string> = { connection: 'close', origin: ORIGIN };
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) {
      headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(body));
    }
    const result = await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers, agent: false }, response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 16384) req.destroy(new Error('Synthetic response bound exceeded'));
          else chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers,
          text: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', () => reject(new Error('Synthetic response failed')));
      });
      req.setTimeout(4000, () => req.destroy(new Error('Synthetic HTTP timeout')));
      req.on('error', () => reject(new Error('Synthetic request failed')));
      req.end(body);
    });
    expect([accessA, accessB, invalid].every(tokenValue => tokenValue.length > 0 && !result.text.includes(tokenValue))).toBe(true);
    expect(result.headers['set-cookie']).toBeUndefined();
    return result;
  }
  function privateStatus(result: Awaited<ReturnType<typeof call>>, status: number) {
    expect(result.status).toBe(status);
    expect(result.headers['cache-control']).toBe('private, no-store');
    const vary = String(result.headers.vary ?? '').toLowerCase().split(',').map(value => value.trim());
    expect(vary).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(result.headers['access-control-allow-origin']).toBe(ORIGIN);
  }

  it('01 blockedlistOwnerGetPrivate', async () => {
    const response = await call('GET', ROUTE + '?take=1&userId=' + OWNER_B);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(fixture(OWNER_A));
    expect(service.getMyBlockedUsers.mock.calls).toEqual([[OWNER_A, { take: '1', userId: OWNER_B }]]);
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: OWNER_A, status: 'active', deletedAt: null }, select: { id: true, email: true } });
    expect(verify?.mock.calls.length).toBe(1);
    privateStatus(response, 200);
  });

  it('02 blockedlistHeadAndEarlyErrorsPrivate', async () => {
    const before = requests;
    const head = await call('HEAD', ROUTE + '?take=1&userId=' + OWNER_A, accessB);
    privateStatus(head, 200); expect(head.text).toBe('');
    expect(service.getMyBlockedUsers.mock.calls).toEqual([[OWNER_B, { take: '1', userId: OWNER_A }]]);
    service.getMyBlockedUsers.mockClear(); verify?.mockClear(); db.user.findFirst.mockClear();
    for (const method of ['GET', 'HEAD']) {
      const response = await call(method, ROUTE, null);
      privateStatus(response, 401);
      if (method === 'HEAD') expect(response.text).toBe('');
      else expect(JSON.parse(response.text).error.statusCode).toBe(401);
    }
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst).not.toHaveBeenCalled();
    privateStatus(await call('GET', ROUTE, invalid), 401);
    expect(verify?.mock.calls.length).toBe(1); expect(db.user.findFirst).not.toHaveBeenCalled();
    active = false;
    privateStatus(await call('HEAD', ROUTE), 401);
    expect(verify?.mock.calls.length).toBe(2); expect(db.user.findFirst).toHaveBeenCalledTimes(1);
    expect(service.getMyBlockedUsers).not.toHaveBeenCalled();
    active = true; verify?.mockClear(); db.user.findFirst.mockClear();
    privateStatus(await call('GET', ROUTE, null, '{'), 400);
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst).not.toHaveBeenCalled();
    expect(service.getMyBlockedUsers).not.toHaveBeenCalled();
    for (const [status, error] of [
      [400, new BadRequestException('Synthetic input rejection')],
      [403, new ForbiddenException('Synthetic access rejection')],
      [404, new NotFoundException('Synthetic item unavailable')],
      [500, new Error('SYNTHETIC_INTERNAL_BLOCK_DETAIL')],
    ] as const) {
      service.getMyBlockedUsers.mockRejectedValueOnce(error);
      const response = await call(status === 404 ? 'HEAD' : 'GET', ROUTE);
      privateStatus(response, status);
      if (status === 404) expect(response.text).toBe('');
      else expect(JSON.parse(response.text).error.statusCode).toBe(status);
      expect(response.text.includes('SYNTHETIC_INTERNAL_BLOCK_DETAIL')).toBe(false);
      expect(response.text.includes(REASON)).toBe(false);
    }
    expect(service.getMyBlockedUsers).toHaveBeenCalledTimes(4);
    expect(verify?.mock.calls.length).toBe(4); expect(db.user.findFirst).toHaveBeenCalledTimes(4);
    expect(requests - before).toBe(10);
  });

  it('03 blockedlistExactBoundaryAndVary', async () => {
    const before = requests;
    privateStatus(await call('GET', ROUTE.toUpperCase() + '/?take=1'), 200);
    for (const [method, path, status] of [
      ['POST', ROUTE, 404], ['GET', ROUTE + '-extra', 404], ['GET', ROUTE + '/child', 404],
      ['GET', '/api/v1/qa-block-cache-public', 200],
    ] as const) {
      const response = await call(method, path, null);
      expect(response.status).toBe(status);
      expect(response.headers['cache-control']).toBe(status === 200 ? 'public, max-age=60' : undefined);
      expect(String(response.headers.vary ?? '').toLowerCase()).not.toContain('authorization');
      expect(response.text.includes(REASON)).toBe(false);
    }
    expect(requests - before).toBe(5);
    const headers = new Map<string, string>(), vary = new Set(['Origin', 'Accept-Encoding']);
    const next = jest.fn(() => {
      expect(headers.get('Cache-Control')).toBe('private, no-store');
      expect([...vary]).toEqual(['Origin', 'Accept-Encoding', 'Authorization']);
    });
    privacy(Object.freeze({ method: 'HEAD', path: ROUTE,
      get headers(): never { throw new Error('Unexpected credential read'); },
      get body(): never { throw new Error('Unexpected body read'); },
      get url(): never { throw new Error('Unexpected raw URL read'); },
    }), { setHeader(name, value) { headers.set(name, value); }, vary(field) { vary.add(field); } }, next);
    expect(next).toHaveBeenCalledTimes(1);
    for (const [method, path] of [
      ['PATCH', ROUTE], ['OPTIONS', ROUTE], ['get', ROUTE], ['HEAD', ROUTE + '//'],
      ['GET', ROUTE + '\n'], ['GET', ROUTE + '?raw=1'], ['GET', '/api/v1/lumina-feed/search'],
    ]) {
      const setHeader = jest.fn(), addVary = jest.fn(), proceed = jest.fn();
      privacy({ method, path }, { setHeader, vary: addVary }, proceed);
      expect(setHeader).not.toHaveBeenCalled(); expect(addVary).not.toHaveBeenCalled();
      expect(proceed).toHaveBeenCalledTimes(1);
    }
    const blockedNext = jest.fn();
    expect(() => privacy({ method: 'GET', path: ROUTE }, { setHeader: jest.fn() }, blockedNext))
      .toThrow('Personalized feed read response requires Vary support');
    expect(blockedNext).not.toHaveBeenCalled();
  });
});

import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import {
  BadRequestException, CanActivate, Controller, ForbiddenException, Get, Header,
  HttpException, INestApplication, Injectable, NotFoundException, ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { communityPersonalizedReadPrivacyMiddleware } from './community-personalized-read.privacy';

jest.setTimeout(20000);
const OWNER = '00000000-0000-4000-8000-000000000931';
const OTHER = '00000000-0000-4000-8000-000000000932';
const ORIGIN = 'https://feed-cache-qa.example.invalid';
const routes = ['/api/v1/me/lumina-feed', '/api/v1/me/lumina-feed/likes', '/api/v1/me/hidden-posts'];
let controlled429 = false;

@Injectable()
class ControlledGlobal429Guard implements CanActivate {
  canActivate() {
    if (controlled429) throw new HttpException('Synthetic global rejection', 429);
    return true;
  }
}

@Controller('qa-feed-cache-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

describe('community personalized read privacy native HTTP', () => {
  let app: INestApplication | undefined, port = 0, access = '', wrongSignature = '', active = true;
  let verify: jest.SpyInstance | undefined;
  let requests = 0;
  const db = { user: { findFirst: jest.fn(async ({ where }: {
    where: { id: string; status: string; deletedAt: unknown };
  }) => active && where.id === OWNER && where.status === 'active' && where.deletedAt === null
    ? { id: OWNER, email: null } : null) } };
  const service = {
    getPersonalizedFeed: jest.fn(), getMyLikedPosts: jest.fn(), getMyHiddenPosts: jest.fn(),
    getFeed: jest.fn(), searchFeed: jest.fn(() => { throw new Error('Search writer must not be dispatched'); }),
  };
  const readers = [service.getPersonalizedFeed, service.getMyLikedPosts, service.getMyHiddenPosts];

  beforeAll(async () => {
    // Static installation assertion; main/AppModule is deliberately not imported or booted.
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect((main.match(/^import \{ communityPersonalizedReadPrivacyMiddleware \} from '\.\/community\/community-personalized-read\.privacy';$/gm) ?? []).length).toBe(1);
    expect((main.match(/^\s*app\.use\(communityPersonalizedReadPrivacyMiddleware\);\s*$/gm) ?? []).length).toBe(1);
    const install = main.indexOf('app.use(communityPersonalizedReadPrivacyMiddleware)');
    expect(install > main.indexOf('export async function createApplication()') && install < main.indexOf('configureHttpRouting(app)')).toBe(true);
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [CommunityController, PublicProbeController],
      providers: [JwtAuthGuard, { provide: APP_GUARD, useClass: ControlledGlobal429Guard },
        { provide: PrismaService, useValue: db }, { provide: CommunityService, useValue: service },
        { provide: ConfigService, useValue: { getOrThrow(name: string) {
          if (name !== 'JWT_ACCESS_SECRET') throw new Error('Unexpected synthetic configuration key');
          return secret;
        } } },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    access = await jwt.signAsync({ sub: OWNER, tokenType: 'access' });
    wrongSignature = await jwt.signAsync({ sub: OWNER, tokenType: 'access' }, { secret: randomBytes(32).toString('hex') });
    verify = jest.spyOn(jwt, 'verifyAsync');
    app = module.createNestApplication({ logger: false });
    app.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    app.use(communityPersonalizedReadPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({ origin: [ORIGIN], credentials: true });
    await app.listen(0, '127.0.0.1');
    port = app.getHttpServer().address().port;
  });
  beforeEach(() => {
    active = true; controlled429 = false;
    db.user.findFirst.mockClear(); verify?.mockClear();
    for (const reader of readers) reader.mockReset().mockResolvedValue({ items: [{ syntheticOnly: true }], nextCursor: null });
    service.getFeed.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    service.searchFeed.mockClear();
  });
  afterEach(() => { expect(service.searchFeed).not.toHaveBeenCalled(); });
  afterAll(async () => {
    try { await app?.close(); }
    finally { verify?.mockRestore(); access = ''; wrongSignature = ''; controlled429 = false; }
    expect(requests).toBe(30);
  });

  async function call(method: string, path: string, token: string | null = access, body?: string) {
    requests += 1;
    if (requests > 40 || port <= 0 || !path.startsWith('/api/v1/')) throw new Error('Synthetic HTTP bound exceeded');
    const headers: Record<string, string> = { connection: 'close', origin: ORIGIN };
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) {
      headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(body));
    }
    const result = await new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers, agent: false }, response => {
        const chunks: Buffer[] = [];
        let bytes = 0;
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
    expect(access.length > 0 && wrongSignature.length > 0).toBe(true);
    expect(result.text.includes(access) || result.text.includes(wrongSignature)).toBe(false);
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
  function noService() { for (const spy of Object.values(service)) expect(spy.mock.calls.length).toBe(0); }

  it('03 anonymous401, invalid JWT, inactive owner and global429 are private before protected service reads', async () => {
    for (const path of routes) for (const method of ['GET', 'HEAD']) privateStatus(await call(method, path, null), 401);
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0);
    privateStatus(await call('HEAD', routes[1], wrongSignature), 401);
    expect(verify?.mock.calls.length).toBe(1); expect(db.user.findFirst.mock.calls.length).toBe(0);
    active = false;
    privateStatus(await call('GET', routes[2]), 401);
    expect(verify?.mock.calls.length).toBe(2); expect(db.user.findFirst.mock.calls.length).toBe(1);
    verify?.mockClear(); db.user.findFirst.mockClear(); controlled429 = true;
    privateStatus(await call('HEAD', routes[0], null), 429);
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0);
    noService();
  });

  it('04 GET/HEAD200 use native JWT owner binding, keep existing shapes and merge Vary once', async () => {
    for (let index = 0; index < routes.length; index += 1) {
      for (const method of ['GET', 'HEAD']) {
        const result = await call(method, routes[index] + '/?take=2&userId=' + OTHER);
        privateStatus(result, 200);
        if (method === 'HEAD') expect(result.text).toBe('');
        else expect(JSON.parse(result.text)).toEqual({ items: [{ syntheticOnly: true }], nextCursor: null });
      }
      expect(readers[index].mock.calls).toEqual([[OWNER, { take: '2', userId: OTHER }], [OWNER, { take: '2', userId: OTHER }]]);
    }
    expect(verify?.mock.calls.length).toBe(6);
    expect(db.user.findFirst).toHaveBeenCalledTimes(6);
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { id: OWNER, status: 'active', deletedAt: null }, select: { id: true, email: true } });
    expect(service.getFeed).not.toHaveBeenCalled();
  });

  it('05 parser400 before auth and controlled service400/403/404/500 retain private filtered responses', async () => {
    privateStatus(await call('GET', routes[0], null, '{'), 400);
    noService(); expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0);
    const failures = [
      [400, new BadRequestException('Synthetic input rejection')],
      [403, new ForbiddenException('Synthetic access rejection')],
      [404, new NotFoundException('Synthetic item unavailable')],
      [500, new Error('Synthetic internal-only service detail')],
    ] as const;
    for (let index = 0; index < failures.length; index += 1) {
      const [status, error] = failures[index], routeIndex = index % routes.length;
      readers[routeIndex].mockRejectedValueOnce(error);
      const result = await call(status === 404 ? 'HEAD' : 'GET', routes[routeIndex]);
      privateStatus(result, status);
      if (status === 404) expect(result.text).toBe('');
      else expect(JSON.parse(result.text).error.statusCode).toBe(status);
      expect(result.text.includes('Synthetic internal-only service detail')).toBe(false);
    }
    expect(readers.reduce((count, reader) => count + reader.mock.calls.length, 0)).toBe(4);
    expect(verify?.mock.calls.length).toBe(4); expect(db.user.findFirst.mock.calls.length).toBe(4);
    expect(service.getFeed).not.toHaveBeenCalled();
  });

  it('06 public cache and wrong method/path responses remain outside the private-read boundary', async () => {
    for (const method of ['GET', 'HEAD']) {
      const result = await call(method, '/api/v1/qa-feed-cache-public', null);
      expect(result.status).toBe(200); expect(result.headers['cache-control']).toBe('public, max-age=60');
      expect(String(result.headers.vary ?? '').toLowerCase()).not.toContain('authorization');
      if (method === 'HEAD') expect(result.text).toBe('');
    }
    const publicFeed = await call('GET', '/api/v1/lumina-feed', null);
    expect(publicFeed.status).toBe(200); expect(publicFeed.headers['cache-control']).toBeUndefined();
    expect(String(publicFeed.headers.vary ?? '').toLowerCase()).not.toContain('authorization');
    expect(service.getFeed.mock.calls).toEqual([[{}]]);
    for (const [method, path, status] of [
      ['GET', routes[0] + '-extra', 404], ['GET', routes[1] + '/child', 404],
      ['GET', routes[2] + '/child', 404], ['GET', '/api/v1/me/blocked-users', 401],
      ['POST', routes[0], 404], ['PATCH', routes[2], 404], ['OPTIONS', routes[1], 204],
    ] as const) {
      const result = await call(method, path, null);
      expect(result.status).toBe(status); expect(result.headers['cache-control']).toBeUndefined();
      expect(String(result.headers.vary ?? '').toLowerCase()).not.toContain('authorization');
    }
    for (const reader of readers) expect(reader).not.toHaveBeenCalled();
    expect(verify?.mock.calls.length).toBe(0); expect(db.user.findFirst.mock.calls.length).toBe(0);
  });
});

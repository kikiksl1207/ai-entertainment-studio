import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
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
import { MyFanEngagementController } from './fan-engagement.controller';
import { fanEngagementPrivacyMiddleware } from './fan-engagement.privacy';
import { FanEngagementService } from './fan-engagement.service';

const parseUrl = require('parseurl') as (request: { url: string }) => { pathname: string | null };

const USER = '00000000-0000-4000-8000-000000000931';
const OTHER = '00000000-0000-4000-8000-000000000932';
const SUMMARY = '/api/v1/me/fan-engagement/summary';
const TITLE = '/api/v1/me/fan-engagement/title';
type Method = 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'OPTIONS';
const protectedRoutes: Array<[Method, string]> = [
  ['GET', SUMMARY], ['HEAD', SUMMARY], ['PATCH', TITLE],
];
let controlled429 = false;

@Injectable()
class ControlledGlobal429Guard implements CanActivate {
  canActivate() {
    if (controlled429) throw new HttpException('Synthetic global rejection', 429);
    return true;
  }
}

@Controller('qa-fan-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

describe('fan privacy: native localhost HTTP/JWT/parser with synthetic readers and service', () => {
  let app: INestApplication | undefined;
  let base: string, access = '', badAccess = '', active = true;
  let verify: jest.SpyInstance | undefined;
  const db = {
    user: { findFirst: jest.fn(async ({ where }: {
      where: { id: string; status: string; deletedAt: unknown };
    }) => active && where.id === USER && where.status === 'active' && where.deletedAt === null
      ? { id: USER, email: null } : null) },
  };
  const service = { getMySummary: jest.fn(), equipTitle: jest.fn() };

  beforeAll(async () => {
    // Check this checkout's registration without importing bootstrap/AppModule.
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(/import\s*\{\s*fanEngagementPrivacyMiddleware\s*\}\s*from\s*['"]\.\/fan-engagement\/fan-engagement\.privacy['"]/.test(main)).toBe(true);
    expect((main.match(/^\s*app\.use\(fanEngagementPrivacyMiddleware\);?\s*$/gm) ?? []).length).toBe(1);
    const use = main.indexOf('app.use(fanEngagementPrivacyMiddleware)');
    expect(use >= 0 && main.indexOf('configureHttpRouting(app)') > use).toBe(true);
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [MyFanEngagementController, PublicProbeController],
      providers: [JwtAuthGuard,
        { provide: APP_GUARD, useClass: ControlledGlobal429Guard },
        { provide: PrismaService, useValue: db },
        { provide: FanEngagementService, useValue: service },
        { provide: ConfigService, useValue: {
          getOrThrow(name: string) {
            if (name !== 'JWT_ACCESS_SECRET') throw new Error('Unexpected synthetic config key');
            return secret;
          },
        } },
      ],
    }).compile();
    const jwt = module.get(JwtService);
    access = await jwt.signAsync({ sub: USER, tokenType: 'access' });
    badAccess = await jwt.signAsync({ sub: USER, tokenType: 'access' },
      { secret: randomBytes(32).toString('hex') });
    verify = jest.spyOn(jwt, 'verifyAsync');
    app = module.createNestApplication({ logger: false });
    app.use(fanEngagementPrivacyMiddleware);
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });

  beforeEach(() => {
    active = true; controlled429 = false;
    db.user.findFirst.mockClear(); verify?.mockClear();
    service.getMySummary.mockReset().mockResolvedValue({
      titles: { items: [], equipped: null }, syntheticOnly: true,
    });
    service.equipTitle.mockReset().mockResolvedValue({ equipped: { code: 'SYNTHETIC_TITLE' } });
  });

  afterAll(async () => {
    try { await app?.close(); }
    finally { verify?.mockRestore(); access = ''; badAccess = ''; controlled429 = false; }
  });

  async function request(method: Method, path: string, token: string | null = access, body?: string) {
    const headers: Record<string, string> = { connection: 'close' };
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body, redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    const text = await response.text();
    expect(access.length > 0 && badAccess.length > 0).toBe(true);
    expect(text.includes(access) || text.includes(badAccess)).toBe(false);
    expect(response.headers.get('set-cookie')).toBeNull();
    return { response, text };
  }
  function privateStatus(result: Awaited<ReturnType<typeof request>>, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
  }
  function noService() {
    for (const spy of Object.values(service)) expect(spy.mock.calls.length).toBe(0);
  }

  it('GET/HEAD summary query and trailing slash preserve privacy and CurrentUser ownership', async () => {
    const result = await request('GET', SUMMARY + '/?locale=ja&userId=' + OTHER);
    privateStatus(result, 200); expect(JSON.parse(result.text).titles).toEqual({ items: [], equipped: null });
    expect(service.getMySummary).toHaveBeenCalledWith(USER, { locale: 'ja', userId: OTHER });
    const head = await request('HEAD', SUMMARY + '/?locale=en');
    privateStatus(head, 200); expect(head.text).toBe('');
    expect(service.getMySummary).toHaveBeenCalledWith(USER, { locale: 'en' });
    expect(service.getMySummary.mock.calls.length).toBe(2); expect(service.equipTitle.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(2);
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER, status: 'active', deletedAt: null }, select: { id: true, email: true },
    });
  });

  it('explicit PATCH title query/trailing and absolute-form retain controller body and current owner', async () => {
    const result = await request('PATCH', TITLE + '/?userId=' + OTHER, access,
      JSON.stringify({ titleCode: 'SYNTHETIC_TITLE' }));
    privateStatus(result, 200); expect(JSON.parse(result.text)).toEqual({ equipped: { code: 'SYNTHETIC_TITLE' } });
    expect(service.equipTitle).toHaveBeenCalledWith(USER, { titleCode: 'SYNTHETIC_TITLE' });
    const local = new URL(base), body = JSON.stringify({ titleCode: 'SYNTHETIC_TITLE' });
    const raw = await new Promise<{ status: number | undefined; cache: string | undefined;
      cookie: string[] | undefined; text: string }>((resolve, reject) => {
      // Absolute request-target only: the socket destination remains the owned localhost listener.
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(local.port), method: 'PATCH',
        path: 'http://qa-fan.invalid' + TITLE + '/?probe=synthetic', agent: false,
        signal: AbortSignal.timeout(4000), headers: { authorization: 'Bearer ' + access,
          connection: 'close', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, incoming => {
        let text = ''; incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => { text += chunk; });
        incoming.once('error', reject);
        incoming.once('end', () => resolve({ status: incoming.statusCode,
          cache: incoming.headers['cache-control'], cookie: incoming.headers['set-cookie'], text }));
      });
      outgoing.once('error', reject); outgoing.end(body);
    });
    expect(raw.status).toBe(200); expect(raw.cache).toBe('private, no-store');
    expect(raw.cookie).toBeUndefined(); expect(raw.text.includes(access) || raw.text.includes(badAccess)).toBe(false);
    expect(JSON.parse(raw.text)).toEqual({ equipped: { code: 'SYNTHETIC_TITLE' } });
    expect(service.equipTitle).toHaveBeenNthCalledWith(2, USER, { titleCode: 'SYNTHETIC_TITLE' });
    expect(service.equipTitle.mock.calls.length).toBe(2); expect(service.getMySummary.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(2);
  });

  it('missing/wrong-signature/inactive JWT401 stay private without service dispatch', async () => {
    for (const token of [null, badAccess]) {
      for (const [method, path] of protectedRoutes) {
        const result = await request(method, path, token, method === 'PATCH' ? '{}' : undefined);
        privateStatus(result, 401); if (method === 'HEAD') expect(result.text).toBe('');
      }
      if (token === null) expect(verify?.mock.calls.length).toBe(0);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(3);
    active = false;
    for (const [method, path] of protectedRoutes) {
      privateStatus(await request(method, path, access, method === 'PATCH' ? '{}' : undefined), 401);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(3); expect(verify?.mock.calls.length).toBe(6);
  });

  it('controlled downstream400/403/404/500 retain native filter status and privacy including HEAD', async () => {
    for (const [status, error] of [
      [400, new BadRequestException('Synthetic invalid input')],
      [403, new ForbiddenException('Synthetic rejection')],
      [404, new NotFoundException('Synthetic title unavailable')],
      [500, new Error('Synthetic controlled failure')],
    ] as const) {
      for (const spy of Object.values(service)) spy.mockRejectedValue(error);
      for (const [method, path] of protectedRoutes) {
        const result = await request(method, path, access, method === 'PATCH' ? '{}' : undefined);
        privateStatus(result, status);
        if (method === 'HEAD') expect(result.text).toBe('');
        else expect(JSON.parse(result.text).error.statusCode).toBe(status);
      }
    }
    expect(service.getMySummary.mock.calls.length).toBe(8); expect(service.equipTitle.mock.calls.length).toBe(4);
  });

  it('malformed PATCH JSON400 is private before authentication/service and never sets a cookie', async () => {
    for (const suffix of ['', '/', '?probe=synthetic', '/?probe=synthetic']) {
      privateStatus(await request('PATCH', TITLE + suffix, null, '{'), 400);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0); expect(verify?.mock.calls.length).toBe(0);
  });

  it('controlled global429 stays private before JWT without claiming a production quota', async () => {
    controlled429 = true;
    for (const [method, path] of protectedRoutes) {
      privateStatus(await request(method, path, null, method === 'PATCH' ? '{}' : undefined), 429);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0); expect(verify?.mock.calls.length).toBe(0);
  });

  it('exact v1 endpoint/method matcher handles query/trailing and calls next once without expansion', () => {
    for (const suffix of ['', '/', '?probe=synthetic', '/?probe=synthetic']) {
      for (const [method, url] of [['GET', SUMMARY], ['HEAD', SUMMARY], ['PATCH', TITLE]]) {
        for (const prefix of ['', 'http://qa-fan.invalid']) {
          const setHeader = jest.fn(), next = jest.fn();
          fanEngagementPrivacyMiddleware({ method, path: parseUrl({ url: prefix + url + suffix }).pathname ?? '' },
            { setHeader }, next);
          expect(setHeader.mock.calls).toEqual([['Cache-Control', 'private, no-store']]);
          expect(next.mock.calls.length).toBe(1);
        }
      }
    }
    const negatives = [
      ['GET', SUMMARY + '-extra'], ['GET', SUMMARY + '/child'], ['GET', SUMMARY + '//'],
      ['GET', TITLE], ['HEAD', TITLE], ['PATCH', SUMMARY], ['PATCH', TITLE + '/child'],
      ['PATCH', TITLE + '-extra'], ['PATCH', TITLE + '//'], ['GET', '/api/me/fan-engagement/summary'],
      ['GET', '/api/v2/me/fan-engagement/summary'], ['PATCH', '/api/me/fan-engagement/title'],
      ['GET', '/api/v1/fan-engagement/missions'], ['GET', '/api/v1/users/' + OTHER + '/fan-engagement/public-summary'],
      ...['OPTIONS', 'POST', 'PUT', 'DELETE', 'get', ''].map(method => [method, SUMMARY]),
      ...['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'patch', ''].map(method => [method, TITLE]),
    ];
    for (const [method, url] of negatives) {
      for (const prefix of ['', 'http://qa-fan.invalid']) {
        const setHeader = jest.fn(), next = jest.fn();
        fanEngagementPrivacyMiddleware({ method, path: parseUrl({ url: prefix + url }).pathname ?? '' },
          { setHeader }, next);
        expect(setHeader.mock.calls.length).toBe(0); expect(next.mock.calls.length).toBe(1);
      }
    }
    for (const [method, url] of [
      ['GET', '/api/v1/me/fan-engagement\\summary'],
      ['PATCH', '/api/v1/me/fan-engagement\\title'],
    ]) {
      const setHeader = jest.fn(), next = jest.fn();
      const path = parseUrl({ url }).pathname ?? '';
      expect(path).toBe(url);
      fanEngagementPrivacyMiddleware({ method, path }, { setHeader }, next);
      expect(setHeader.mock.calls.length).toBe(0); expect(next.mock.calls.length).toBe(1);
    }
  });

  it('unrelated public GET/HEAD cache and wrong methods/nearby/legacy paths remain untouched', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const result = await request(method, '/api/v1/qa-fan-public', null);
      expect(result.response.status).toBe(200);
      expect(result.response.headers.get('cache-control')).toBe('public, max-age=60');
      if (method === 'HEAD') expect(result.text).toBe('');
    }
    for (const [method, path] of [
      ['GET', SUMMARY + '-extra'], ['GET', SUMMARY + '/child'], ['GET', TITLE],
      ['PATCH', SUMMARY], ['PATCH', TITLE + '/child'], ['POST', SUMMARY], ['OPTIONS', TITLE],
      ['GET', '/api/me/fan-engagement/summary'], ['PATCH', '/api/me/fan-engagement/title'],
    ] as Array<[Method, string]>) {
      const result = await request(method, path, null, ['PATCH', 'POST'].includes(method) ? '{}' : undefined);
      expect(result.response.headers.get('cache-control')).toBeNull();
      if (method !== 'OPTIONS') expect(result.response.status).toBe(404);
    }
    const local = new URL(base), body = '{}';
    const raw = await new Promise<{ status: number | undefined; cache: string | undefined;
      cookie: string[] | undefined; text: string }>((resolve, reject) => {
      // Keep the origin-form backslash intact; fetch would normalize it before transport.
      const outgoing = httpRequest({ hostname: '127.0.0.1', port: Number(local.port), method: 'PATCH',
        path: '/api/v1/me/fan-engagement\\title', agent: false,
        signal: AbortSignal.timeout(4000), headers: {
          connection: 'close', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body),
        },
      }, incoming => {
        let text = ''; incoming.setEncoding('utf8');
        incoming.on('data', (chunk: string) => { text += chunk; });
        incoming.once('error', reject);
        incoming.once('end', () => resolve({ status: incoming.statusCode,
          cache: incoming.headers['cache-control'], cookie: incoming.headers['set-cookie'], text }));
      });
      outgoing.once('error', reject); outgoing.end(body);
    });
    expect(raw.status).toBe(404); expect(raw.cache).toBeUndefined(); expect(raw.cookie).toBeUndefined();
    expect(raw.text.includes(access) || raw.text.includes(badAccess)).toBe(false);
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0); expect(verify?.mock.calls.length).toBe(0);
  });
});

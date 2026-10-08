import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CanActivate, Controller, ForbiddenException, Get, Header, HttpException,
  INestApplication, Injectable, NotFoundException, ValidationPipe,
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
import { NotificationsController } from './notifications.controller';
import { notificationPrivacyMiddleware } from './notifications.privacy';
import { NotificationsService } from './notifications.service';

const USER = '00000000-0000-4000-8000-000000000921';
const OTHER = '00000000-0000-4000-8000-000000000922';
const NOTIFICATION = '00000000-0000-4000-8000-000000000923';
const ROUTE = '/api/v1/me/notifications';
type Method = 'GET' | 'HEAD' | 'PATCH' | 'OPTIONS' | 'POST';
const protectedRoutes: Array<[Method, string]> = [
  ['GET', ROUTE], ['GET', ROUTE + '/unread-count'], ['HEAD', ROUTE],
  ['PATCH', ROUTE + '/read-all'], ['PATCH', ROUTE + '/' + NOTIFICATION + '/read'],
];
let controlled429 = false;

@Injectable()
class ControlledGlobal429Guard implements CanActivate {
  canActivate() {
    if (controlled429) throw new HttpException('Synthetic global rejection', 429);
    return true;
  }
}

@Controller('qa-notification-public')
class PublicProbeController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  get() { return { syntheticOnly: true }; }
}

describe('notification privacy: native localhost HTTP/JWT with synthetic service readers', () => {
  let app: INestApplication | undefined;
  let base: string, access = '', badAccess = '', active = true;
  let verify: jest.SpyInstance | undefined;
  const db = {
    user: { findFirst: jest.fn(async ({ where }: {
      where: { id: string; status: string; deletedAt: unknown };
    }) => active && where.id === USER && where.status === 'active' && where.deletedAt === null
      ? { id: USER, email: null } : null) },
  };
  const service = {
    list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn(),
  };

  beforeAll(async () => {
    // Read this checkout's source without importing bootstrap or requiring adjacency.
    const main = readFileSync(join(__dirname, '..', 'main.ts'), 'utf8');
    expect(/import\s*\{\s*notificationPrivacyMiddleware\s*\}\s*from\s*['"]\.\/notifications\/notifications\.privacy['"]/.test(main)).toBe(true);
    expect((main.match(/^\s*app\.use\(notificationPrivacyMiddleware\);?\s*$/gm) ?? []).length).toBe(1);
    const use = main.indexOf('app.use(notificationPrivacyMiddleware)');
    const routing = main.indexOf('configureHttpRouting(app)');
    expect(use >= 0 && routing > use).toBe(true);
    const secret = randomBytes(32).toString('hex');
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret, signOptions: { expiresIn: '5m' } })],
      controllers: [NotificationsController, PublicProbeController],
      providers: [JwtAuthGuard,
        { provide: APP_GUARD, useClass: ControlledGlobal429Guard },
        { provide: PrismaService, useValue: db },
        { provide: NotificationsService, useValue: service },
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
    app.use(notificationPrivacyMiddleware);
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
    service.list.mockReset().mockResolvedValue({
      notifications: [{ id: NOTIFICATION, readAt: null }], unreadCount: 1, nextCursor: null,
    });
    service.unreadCount.mockReset().mockResolvedValue({ unreadCount: 1 });
    service.markRead.mockReset().mockResolvedValue({ notification: { id: NOTIFICATION } });
    service.markAllRead.mockReset().mockResolvedValue({ ok: true, updatedCount: 1 });
  });

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      verify?.mockRestore(); access = ''; badAccess = '';
      controlled429 = false;
    }
  });

  async function request(method: Method, path = ROUTE, token: string | null = access, body?: string) {
    const headers: Record<string, string> = { connection: 'close' };
    if (token !== null) headers.authorization = 'Bearer ' + token;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, {
      method, headers, body, redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    const text = await response.text();
    // Only booleans are asserted, so a failed assertion cannot dump a signed JWT.
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

  it('GET list/count and HEAD keep privacy after native JWT validation for the current owner', async () => {
    const list = await request('GET', ROUTE + '?take=2&status=unread&userId=' + OTHER);
    privateStatus(list, 200); expect(JSON.parse(list.text).unreadCount).toBe(1);
    expect(service.list).toHaveBeenCalledWith(USER, { take: '2', status: 'unread', userId: OTHER });
    const count = await request('GET', ROUTE + '/unread-count');
    privateStatus(count, 200); expect(JSON.parse(count.text)).toEqual({ unreadCount: 1 });
    for (const path of [ROUTE, ROUTE + '/unread-count']) {
      const head = await request('HEAD', path); privateStatus(head, 200); expect(head.text).toBe('');
    }
    expect(service.list.mock.calls.length).toBe(2);
    expect(service.unreadCount.mock.calls.length).toBe(2);
    expect(service.markRead.mock.calls.length + service.markAllRead.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(4);
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER, status: 'active', deletedAt: null }, select: { id: true, email: true },
    });
  });

  it('PATCH read-all and one read preserve native controller ownership and response shapes', async () => {
    const all = await request('PATCH', ROUTE + '/read-all/?userId=' + OTHER, access, '{}');
    privateStatus(all, 200); expect(JSON.parse(all.text)).toEqual({ ok: true, updatedCount: 1 });
    const one = await request('PATCH', ROUTE + '/' + NOTIFICATION + '/read', access, '{}');
    privateStatus(one, 200); expect(JSON.parse(one.text)).toEqual({ notification: { id: NOTIFICATION } });
    expect(service.markAllRead).toHaveBeenCalledWith(USER);
    expect(service.markRead).toHaveBeenCalledWith(USER, NOTIFICATION);
    expect(service.markAllRead.mock.calls.length).toBe(1); expect(service.markRead.mock.calls.length).toBe(1);
    expect(service.list.mock.calls.length + service.unreadCount.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(2);
  });

  it('missing and wrong-signature JWT401 stay private without service or identity reader dispatch', async () => {
    for (const token of [null, badAccess]) {
      for (const [method, path] of protectedRoutes) {
        privateStatus(await request(method, path, token, method === 'PATCH' ? '{}' : undefined), 401);
      }
      if (token === null) expect(verify?.mock.calls.length).toBe(0);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(protectedRoutes.length);
  });

  it('inactive synthetic owner401 stays private without notification service dispatch', async () => {
    active = false;
    for (const [method, path] of protectedRoutes) {
      privateStatus(await request(method, path, access, method === 'PATCH' ? '{}' : undefined), 401);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(protectedRoutes.length);
    expect(verify?.mock.calls.length).toBe(protectedRoutes.length);
  });

  it('controlled downstream403/404/500 retain native filter statuses and private headers', async () => {
    for (const [status, error] of [
      [403, new ForbiddenException('Synthetic downstream rejection')],
      [404, new NotFoundException('Synthetic notification unavailable')],
      [500, new Error('Synthetic notification failure')],
    ] as const) {
      for (const spy of Object.values(service)) spy.mockRejectedValue(error);
      for (const [method, path] of protectedRoutes.filter(([method]) => method !== 'HEAD')) {
        const result = await request(method, path, access, method === 'PATCH' ? '{}' : undefined);
        privateStatus(result, status);
        expect(JSON.parse(result.text).error.statusCode).toBe(status);
      }
    }
    for (const spy of Object.values(service)) expect(spy.mock.calls.length).toBe(3);
  });

  it('malformed JSON400 is private before authentication or service for current and legacy PATCH paths', async () => {
    for (const prefix of ['/api/v1', '/api']) {
      for (const suffix of ['/read-all/?probe=synthetic', '/' + NOTIFICATION + '/read']) {
        privateStatus(await request('PATCH', prefix + '/me/notifications' + suffix, null, '{'), 400);
      }
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(0);
  });

  it('controlled global guard429 is private before JWT without claiming production quotas', async () => {
    controlled429 = true;
    for (const [method, path] of protectedRoutes) {
      privateStatus(await request(method, path, null, method === 'PATCH' ? '{}' : undefined), 429);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(0);
  });

  it('exact middleware methods/paths call next once and preserve current query/trailing and legacy privacy', async () => {
    const positives: Array<[string, string]> = [];
    for (const prefix of ['/api/v1', '/api']) {
      const base = prefix + '/me/notifications';
      for (const ending of ['', '/', '?probe=synthetic', '/?probe=synthetic']) {
        for (const method of ['GET', 'HEAD']) {
          positives.push([method, base + ending], [method, base + '/unread-count' + ending]);
        }
        positives.push(['PATCH', base + '/read-all' + ending],
          ['PATCH', base + '/' + NOTIFICATION + '/read' + ending]);
      }
    }
    for (const [method, url] of positives) {
      const setHeader = jest.fn(), next = jest.fn();
      notificationPrivacyMiddleware({ method, url }, { setHeader }, next);
      expect(setHeader.mock.calls).toEqual([['Cache-Control', 'private, no-store']]);
      expect(next.mock.calls.length).toBe(1);
    }
    const negatives = [
      ['GET', ROUTE + '-extra'], ['GET', ROUTE + '/child'], ['GET', ROUTE + '//'],
      ['GET', ROUTE + '/unread-count/child'], ['GET', ROUTE + '/read-all'],
      ['HEAD', ROUTE + '/' + NOTIFICATION + '/read'], ['PATCH', ROUTE],
      ['PATCH', ROUTE + '/unread-count'], ['PATCH', ROUTE + '/read-all-extra'],
      ['PATCH', ROUTE + '/' + NOTIFICATION + '/read/child'], ['GET', '/api/v2/me/notifications'],
      ...['OPTIONS', 'POST', 'PUT', 'DELETE', 'get'].map(method => [method, ROUTE]),
    ];
    for (const [method, url] of negatives) {
      const setHeader = jest.fn(), next = jest.fn();
      notificationPrivacyMiddleware({ method, url }, { setHeader }, next);
      expect(setHeader.mock.calls.length).toBe(0); expect(next.mock.calls.length).toBe(1);
    }
    privateStatus(await request('GET', ROUTE + '/?probe=synthetic'), 200);
    privateStatus(await request('GET', ROUTE + '/unread-count/?probe=synthetic'), 200);
    // The unchanged router registers api/v1 only; legacy header coverage is not an API alias claim.
    for (const [method, path] of [
      ['GET', '/api/me/notifications/?probe=synthetic'],
      ['GET', '/api/me/notifications/unread-count'],
      ['PATCH', '/api/me/notifications/read-all'],
      ['PATCH', '/api/me/notifications/' + NOTIFICATION + '/read/?probe=synthetic'],
    ] as Array<[Method, string]>) {
      privateStatus(await request(method, path, null, method === 'PATCH' ? '{}' : undefined), 404);
    }
    expect(service.list.mock.calls.length).toBe(1); expect(service.unreadCount.mock.calls.length).toBe(1);
    expect(service.markRead.mock.calls.length + service.markAllRead.mock.calls.length).toBe(0);
  });

  it('unrelated public cache and unmatched paths/methods are untouched by the privacy middleware', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      const result = await request(method, '/api/v1/qa-notification-public', null);
      expect(result.response.status).toBe(200);
      expect(result.response.headers.get('cache-control')).toBe('public, max-age=60');
      if (method === 'HEAD') expect(result.text).toBe('');
    }
    for (const [method, path] of [
      ['GET', ROUTE + '-extra'], ['GET', ROUTE + '/unread-count/child'],
      ['POST', ROUTE], ['OPTIONS', ROUTE],
    ] as Array<[Method, string]>) {
      const result = await request(method, path, null, method === 'POST' ? '{}' : undefined);
      expect(result.response.headers.get('cache-control')).toBeNull();
      if (method !== 'OPTIONS') expect(result.response.status).toBe(404);
    }
    noService(); expect(db.user.findFirst.mock.calls.length).toBe(0);
    expect(verify?.mock.calls.length).toBe(0);
  });
});

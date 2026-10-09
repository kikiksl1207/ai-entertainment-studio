import 'reflect-metadata';
import {
  BadRequestException,
  Global,
  INestApplication,
  Logger,
  Module,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { IncomingHttpHeaders, OutgoingHttpHeaders, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { AdminTestAccountPrivacyMiddleware } from '../admin/admin-test-account.privacy';
import { AuthUser } from '../auth/auth.types';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { SiteContentModule } from './site-content.module';
import { SiteContentService } from './site-content.service';

type PrivateMethod = 'listAdmin' | 'getAdmin' | 'createAdmin' | 'updateAdmin'
  | 'publishAdmin' | 'archiveAdmin' | 'restoreAdmin';
type Body = Record<string, unknown>;
type Route = {
  name: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  status: number;
  service: PrivateMethod;
  body?: Body;
  args: (user: AuthUser) => unknown[];
  reply: () => Body;
};
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };

const BASE = '/admin/api/v1/backstage/site-content';
const USER_ID = '00000000-0000-4000-8000-000000000201';
const STAFF_ID = '00000000-0000-4000-8000-000000000202';
const ENTRY_ID = '00000000-0000-4000-8000-000000000203';
const EMAIL = 'cms-cache-http@example.test';
const ACCESS_SECRET = 'synthetic-cms-private-cache-transport-secret';
const PRIVATE_COPY = 'SYNTHETIC_CMS_PRIVATE_DRAFT_COPY';
const PRIVATE_AUDIT = 'SYNTHETIC_CMS_PRIVATE_AUDIT';
const privateItem = {
  id: ENTRY_ID, locale: 'ko-KR', status: 'draft', body: PRIVATE_COPY,
  createdByUserId: USER_ID,
};
const listReply = () => ({ items: [privateItem], pagination: { total: 1, take: 50 } });
const detailReply = () => ({ item: privateItem, auditLogs: [{ actorUserId: USER_ID, action: PRIVATE_AUDIT }] });
const writeReply = (action: string) => ({ item: privateItem, action });
const createBody = { contentKey: 'artists.hero.body', locale: 'ko-KR', body: 'SYNTHETIC_CREATE_COPY' };
const editBody = { body: 'SYNTHETIC_EDIT_COPY' };
const restoreBody = { status: 'draft' };

const routes: Route[] = [
  {
    name: 'list', method: 'GET', path: BASE + '?locale=ko-KR&status=draft', status: 200,
    service: 'listAdmin', args: user => [user, { locale: 'ko-KR', status: 'draft' }], reply: listReply,
  },
  {
    name: 'detail', method: 'GET', path: BASE + '/' + ENTRY_ID, status: 200,
    service: 'getAdmin', args: user => [user, ENTRY_ID], reply: detailReply,
  },
  {
    name: 'create', method: 'POST', path: BASE, status: 201, body: createBody,
    service: 'createAdmin', args: user => [user, createBody], reply: () => writeReply('create'),
  },
  {
    name: 'edit', method: 'PATCH', path: BASE + '/' + ENTRY_ID, status: 200, body: editBody,
    service: 'updateAdmin', args: user => [user, ENTRY_ID, editBody], reply: () => writeReply('edit'),
  },
  {
    name: 'publish', method: 'POST', path: BASE + '/' + ENTRY_ID + '/publish', status: 201,
    service: 'publishAdmin', args: user => [user, ENTRY_ID], reply: () => writeReply('publish'),
  },
  {
    name: 'archive', method: 'POST', path: BASE + '/' + ENTRY_ID + '/archive', status: 201,
    service: 'archiveAdmin', args: user => [user, ENTRY_ID], reply: () => writeReply('archive'),
  },
  {
    name: 'restore', method: 'POST', path: BASE + '/' + ENTRY_ID + '/restore', status: 201, body: restoreBody,
    service: 'restoreAdmin', args: user => [user, ENTRY_ID, restoreBody], reply: () => writeReply('restore'),
  },
];
const reads = routes.slice(0, 2);
const writes = routes.slice(2);
let permissions: string[] = ['*'];
let serviceStatus: 400 | 500 | undefined;

// All storage operations, including the real guard's lastAccessAt write, are mocks.
const db = {
  user: {
    findFirst: jest.fn(async (args: { where: { id: string } }) =>
      args.where.id === USER_ID ? { id: USER_ID, email: EMAIL } : null),
  },
  adminUser: {
    findUnique: jest.fn(async (_args: unknown) => ({
      id: STAFF_ID, status: 'active', role: { name: 'super_admin', permissions: [...permissions] },
    })),
    update: jest.fn(async (_args: unknown) => ({ id: STAFF_ID })),
  },
};

// Only SiteContentModule is a production module under test. This fixture supplies
// normally global auth dependencies, with no controllers or middleware registration.
@Global()
@Module({
  providers: [
    JwtAuthGuard, AdminAuthGuard, AdminPermissionGuard,
    { provide: PrismaService, useValue: db },
    { provide: JwtService, useValue: new JwtService({ secret: ACCESS_SECRET }) },
    { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: ACCESS_SECRET, ADMIN_EMAILS: '' }) },
  ],
  exports: [PrismaService, JwtService, ConfigService, JwtAuthGuard, AdminAuthGuard, AdminPermissionGuard],
})
class CmsCacheDependenciesModule {}

function privateService(route: Route) {
  return jest.fn(async (..._args: unknown[]) => {
    if (serviceStatus === 400) {
      throw new BadRequestException({ code: 'SYNTHETIC_CMS_BAD_REQUEST', message: 'Synthetic invalid request' });
    }
    if (serviceStatus === 500) throw new Error('SYNTHETIC_INTERNAL_ONLY');
    return route.reply();
  });
}

const privateMocks: Record<PrivateMethod, ReturnType<typeof privateService>> = {
  listAdmin: privateService(routes[0]),
  getAdmin: privateService(routes[1]),
  createAdmin: privateService(routes[2]),
  updateAdmin: privateService(routes[3]),
  publishAdmin: privateService(routes[4]),
  archiveAdmin: privateService(routes[5]),
  restoreAdmin: privateService(routes[6]),
};
const publicReply = (locale: string) => ({
  locale,
  items: [{ id: 'synthetic-public-entry', locale, status: 'published', body: 'SYNTHETIC_PUBLIC_COPY' }],
  policy: { publishedOnly: true },
});
const service = {
  ...privateMocks,
  getBootstrap: jest.fn(async (query: Record<string, string | undefined>) => publicReply(query.locale!)),
};

const serviceErrors: Array<[string, 400 | 500, Route]> = [
  ...routes.map((route, index): [string, 400 | 500, Route] =>
    [route.name, index % 2 === 0 ? 400 : 500, route]),
  ['list', 500, reads[0]],
  ['detail', 400, reads[1]],
];
const headCases: Array<[string, number, Route]> = [
  ['list', 200, reads[0]], ['detail', 200, reads[1]],
  ...[401, 403, 400, 500].map((status): [string, number, Route] => ['detail', status, reads[1]]),
];

// 40 cases: RED2 + writes5 + missing7 + expired1 + permission7 + service9 + HEAD6 + public2 + Vary1.
// Synthetic JWT/storage evidence is not an operating JWT, staff grant or real lastAccess write.
describe('CMS private cache transport (real guards, synthetic JWT and storage only)', () => {
  let app: INestApplication | undefined;
  let base: string;
  let token: string;
  let expiredToken: string;
  let permissionSpy: jest.SpyInstance;
  let adminSpy: jest.SpyInstance;
  let jwtSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    permissionSpy = jest.spyOn(AdminPermissionGuard.prototype, 'canActivate');
    adminSpy = jest.spyOn(AdminAuthGuard.prototype, 'canActivate');
    jwtSpy = jest.spyOn(JwtAuthGuard.prototype, 'canActivate');
    logSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const module = await Test.createTestingModule({ imports: [CmsCacheDependenciesModule, SiteContentModule] })
      .overrideProvider(SiteContentService).useValue(service).compile();
    const jwt = module.get(JwtService);
    const payload = { sub: USER_ID, email: EMAIL, tokenType: 'access' };
    token = jwt.sign(payload, { expiresIn: 600 });
    expiredToken = jwt.sign(payload, { expiresIn: -60 });
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    if (address.address !== '127.0.0.1' || address.port <= 0) throw new Error('Expected owned loopback listener');
    base = `http://127.0.0.1:${address.port}`;
  }, 15000);

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      permissionSpy?.mockRestore();
      adminSpy?.mockRestore();
      jwtSpy?.mockRestore();
      logSpy?.mockRestore();
    }
  });

  beforeEach(() => {
    permissions = ['*'];
    serviceStatus = undefined;
    for (const mock of Object.values(privateMocks)) mock.mockClear();
    service.getBootstrap.mockClear();
    db.user.findFirst.mockClear();
    db.adminUser.findUnique.mockClear();
    db.adminUser.update.mockClear();
    permissionSpy.mockClear();
    adminSpy.mockClear();
    jwtSpy.mockClear();
    logSpy.mockClear();
  });

  function readHttp(method: string, path: string, bearer: string | undefined, body?: Body): Promise<Reply> {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const headers: OutgoingHttpHeaders = {};
    if (bearer !== undefined) headers.authorization = 'Bearer ' + bearer;
    if (bytes) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = bytes.length;
    }
    return new Promise((resolve, reject) => {
      const req = request(base + path, { method, headers, agent: false }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({ status: response.statusCode ?? 0, headers: response.headers, raw,
              body: raw ? JSON.parse(raw) : undefined });
          } catch (error) { reject(error); }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic CMS request timeout')));
      req.end(bytes);
    });
  }

  function call(route: Route, bearer: string | undefined) {
    return readHttp(route.method, route.path, bearer, route.body);
  }

  function privateCalls() {
    return Object.values(privateMocks).reduce((sum, mock) => sum + mock.mock.calls.length, 0);
  }

  function expectPrivacy(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache');
    expect(reply.headers.expires).toBe('0');
    expect(String(reply.headers.vary ?? '').split(',').map(value => value.trim().toLowerCase()))
      .toContain('authorization');
  }

  function expectAcceptedIdentity() {
    expect(adminSpy).toHaveBeenCalledTimes(1);
    expect(jwtSpy).toHaveBeenCalledTimes(1);
    expect(permissionSpy).toHaveBeenCalledTimes(1);
    expect(db.user.findFirst).toHaveBeenCalledWith({
      where: { id: USER_ID, status: 'active', deletedAt: null }, select: { id: true, email: true },
    });
    expect(db.adminUser.findUnique).toHaveBeenCalledWith({ where: { userId: USER_ID }, include: { role: true } });
    expect(db.adminUser.update).toHaveBeenCalledTimes(1);
    const update = db.adminUser.update.mock.calls[0][0] as { where: { id: string }; data: { lastAccessAt: Date } };
    expect(update.where).toEqual({ id: STAFF_ID });
    expect(Number.isFinite(Date.prototype.getTime.call(update.data.lastAccessAt))).toBe(true);
  }

  function expectDispatch(route: Route) {
    expectAcceptedIdentity();
    expect(privateCalls()).toBe(1);
    expect(privateMocks[route.service]).toHaveBeenCalledWith(...route.args({
      id: USER_ID, email: EMAIL, adminRole: 'super_admin', adminPermissions: ['*'],
    }));
    expect(service.getBootstrap).not.toHaveBeenCalled();
  }

  function expectError(reply: Reply, status: number) {
    expect(reply.status).toBe(status);
    expect(reply.body).toMatchObject({ success: false, error: { statusCode: status } });
    expect(reply.body).not.toHaveProperty('item');
    expect(reply.body).not.toHaveProperty('items');
    expect(reply.body).not.toHaveProperty('auditLogs');
    expect(reply.raw).not.toContain(PRIVATE_COPY);
    expect(reply.raw).not.toContain(PRIVATE_AUDIT);
    expect(reply.raw).not.toContain(USER_ID);
    if (status === 400) expect(reply.body).toMatchObject({ error: { code: 'SYNTHETIC_CMS_BAD_REQUEST' } });
    if (status === 500) {
      expect(reply.body).toMatchObject({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' } });
      expect(reply.raw).not.toContain('SYNTHETIC_INTERNAL_ONLY');
    }
  }

  function expectDenied(status: 401 | 403) {
    expect(privateCalls()).toBe(0);
    expect(service.getBootstrap).not.toHaveBeenCalled();
    expect(adminSpy).toHaveBeenCalledTimes(1);
    expect(jwtSpy).toHaveBeenCalledTimes(1);
    if (status === 401) {
      expect(permissionSpy).not.toHaveBeenCalled();
      expect(db.user.findFirst).not.toHaveBeenCalled();
      expect(db.adminUser.findUnique).not.toHaveBeenCalled();
      expect(db.adminUser.update).not.toHaveBeenCalled();
    } else {
      expectAcceptedIdentity();
    }
  }

  // RED2 validates the original successful routing/body/identity before header assertions.
  it.each(reads.map(route => [route.name, route] as const))
    ('CMS-PRIVATE-RED: successful %s keeps its baseline and forbids storage', async (_name, route) => {
      const reply = await call(route, token);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual(route.reply());
      expectDispatch(route);
      expectPrivacy(reply);
    });

  it.each(writes.map(route => [route.name, route] as const))
    ('successful %s preserves write dispatch and original status with privacy', async (_name, route) => {
      const reply = await call(route, token);
      expect(reply.status).toBe(route.status);
      expect(reply.body).toEqual(route.reply());
      expectDispatch(route);
      expectPrivacy(reply);
    });

  it.each(routes.map(route => [route.name, route] as const))
    ('missing bearer rejects %s before service dispatch with privacy', async (_name, route) => {
      const reply = await call(route, undefined);
      expectError(reply, 401);
      expectDenied(401);
      expectPrivacy(reply);
    });

  it('expired synthetic JWT rejects detail before storage lookup with privacy', async () => {
    const reply = await call(reads[1], expiredToken);
    expectError(reply, 401);
    expectDenied(401);
    expectPrivacy(reply);
  });

  it.each(routes.map(route => [route.name, route] as const))
    ('actual permission guard rejects %s without a grant or service dispatch', async (_name, route) => {
      permissions = [];
      const reply = await call(route, token);
      expectError(reply, 403);
      expectDenied(403);
      expectPrivacy(reply);
    });

  it.each(serviceErrors)
    ('%s service error %s preserves the common filter and privacy', async (_name, status, route) => {
      serviceStatus = status;
      const reply = await call(route, token);
      expectError(reply, status);
      expectDispatch(route);
      expectPrivacy(reply);
    });

  it.each(headCases)
    ('HEAD %s with status %s stays bodyless without bypassing its guarded GET', async (_name, status, route) => {
      if (status === 403) permissions = [];
      if (status === 400 || status === 500) serviceStatus = status;
      const reply = await readHttp('HEAD', route.path, status === 401 ? undefined : token);
      expect(reply.status).toBe(status);
      expect(reply.raw).toBe('');
      expect(reply.body).toBeUndefined();
      if (status === 401 || status === 403) expectDenied(status);
      else expectDispatch(route);
      expectPrivacy(reply);
    });

  it.each(['ko-KR', 'en-US'])
    ('public bootstrap %s remains unguarded and outside private cache registration', async locale => {
      const reply = await readHttp('GET', '/api/v1/site-content/bootstrap?locale=' + locale + '&pageKey=artists', undefined);
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual(publicReply(locale));
      expect(service.getBootstrap).toHaveBeenCalledTimes(1);
      expect(service.getBootstrap).toHaveBeenCalledWith({ locale, pageKey: 'artists' });
      expect(privateCalls()).toBe(0);
      expect(adminSpy).not.toHaveBeenCalled();
      expect(jwtSpy).not.toHaveBeenCalled();
      expect(permissionSpy).not.toHaveBeenCalled();
      expect(db.adminUser.update).not.toHaveBeenCalled();
      expect(reply.headers['cache-control']).toBeUndefined();
      expect(reply.headers.pragma).toBeUndefined();
      expect(reply.headers.expires).toBeUndefined();
      expect(String(reply.headers.vary ?? '').toLowerCase()).not.toContain('authorization');
      expect(reply.raw).not.toContain(PRIVATE_COPY);
      expect(reply.raw).not.toContain(PRIVATE_AUDIT);
      expect(reply.raw).not.toContain(USER_ID);
    });

  it('existing middleware preserves the prior Vary dimension in isolation', () => {
    const headers: Record<string, string> = { vary: 'Origin' };
    const response = {
      getHeader: (name: string) => headers[name.toLowerCase()],
      setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    };
    const next = jest.fn();
    new AdminTestAccountPrivacyMiddleware().use({}, response, next);
    expect(headers).toEqual({
      vary: 'Origin, Authorization', 'cache-control': 'private, no-store', pragma: 'no-cache', expires: '0',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

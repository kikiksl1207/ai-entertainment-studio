import 'reflect-metadata';
import {
  CanActivate, Controller, ExecutionContext, Get, Header, HttpException, Injectable,
  INestApplication, Logger, UnauthorizedException, ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AdminController } from '../admin/admin.controller';
import { AdminModule } from '../admin/admin.module';
import { AdminService } from '../admin/admin.service';
import { AdminTestAccountService } from '../admin/admin-test-account.service';
import { AdminUsersReadService } from '../admin/admin-users-read.service';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { CreatorStudioController } from '../creator-studio/creator-studio.controller';
import { CreatorStudioService } from '../creator-studio/creator-studio.service';
import {
  CreatorStudioSettlementConversionQueryDto, CreatorStudioSettlementPreviewQueryDto,
} from '../creator-studio/dto/creator-studio.dto';
import { settlementPreviewPrivacyMiddleware } from './settlement-preview.privacy';

const OWNER = '00000000-0000-4000-8000-000000000951';
const OTHER_OWNER = '00000000-0000-4000-8000-000000000952';
const CONVERSION = '00000000-0000-4000-8000-000000000953';
const ORIGIN = 'https://settlement-privacy-qa.example.invalid';
const OWNER_ROOT = '/api/v1/me/creator-studio';
const ADMIN_ROOT = '/admin/api/v1/backstage';
const INTERNAL_DETAIL = 'PRIVATE_SYNTHETIC_SETTLEMENT_ERROR';
const authChecks = jest.fn();
const creator = {
  getSettlementPreview: jest.fn(), getPayoutSummary: jest.fn(), getSettlementConversions: jest.fn(),
  createSettlementConversion: jest.fn(),
};
const admin = {
  getBackstageSettlementPreview: jest.fn(), getBackstagePartnerSettlementPreview: jest.fn(),
  getBackstageSettlementConversions: jest.fn(), updateBackstageSettlementConversionStatus: jest.fn(),
  updateBackstageSettlementStatus: jest.fn(),
};
function syntheticPayload(kind: string) {
  return Object.freeze({ syntheticOnly: true, kind,
    items: Object.freeze([Object.freeze({ marker: 'synthetic-not-a-settlement-record' })]) });
}
type ReadRoute = { path: string; owner: boolean; query: Record<string, string>;
  service: jest.Mock; payload: ReturnType<typeof syntheticPayload> };
const routes: ReadRoute[] = [
  { path: OWNER_ROOT + '/settlement-preview', owner: true, query: { period: '2026-10' },
    service: creator.getSettlementPreview, payload: syntheticPayload('owner-preview') },
  { path: OWNER_ROOT + '/payout-summary', owner: true, query: { period: '2026-10' },
    service: creator.getPayoutSummary, payload: syntheticPayload('owner-payout') },
  { path: OWNER_ROOT + '/settlement-conversions', owner: true, query: { period: '2026-10', status: 'requested' },
    service: creator.getSettlementConversions, payload: syntheticPayload('owner-conversions') },
  { path: ADMIN_ROOT + '/operations/settlement-preview', owner: false, query: { period: '2026-10' },
    service: admin.getBackstageSettlementPreview, payload: syntheticPayload('admin-preview') },
  { path: ADMIN_ROOT + '/operations/partner-settlement-preview', owner: false, query: { period: '2026-10' },
    service: admin.getBackstagePartnerSettlementPreview, payload: syntheticPayload('admin-partner-preview') },
  { path: ADMIN_ROOT + '/settlement-conversions', owner: false, query: { period: '2026-10', status: 'requested' },
    service: admin.getBackstageSettlementConversions, payload: syntheticPayload('admin-conversions') },
];
const payloadsBefore = JSON.stringify(routes.map(route => route.payload));
const writeMocks = [creator.createSettlementConversion, admin.updateBackstageSettlementConversionStatus,
  admin.updateBackstageSettlementStatus];
const allowed = { 'x-qa-auth': 'synthetic-only', 'x-qa-permission': 'read' };

@Injectable()
class SyntheticAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    authChecks();
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-qa-auth'] !== 'synthetic-only') throw new UnauthorizedException('Synthetic auth rejection');
    const permission = request.headers['x-qa-permission'];
    request.user = {
      id: request.headers['x-qa-owner'] === 'other' ? OTHER_OWNER : OWNER,
      adminPermissions: permission === 'read' ? ['payments:read'] : permission === 'write' ? ['payments:write']
        : permission === 'unrelated' ? ['users:read'] : permission === 'settlement-write' ? ['settlements:write'] : [],
    };
    return true;
  }
}

@Injectable()
class SyntheticGlobalDenialGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest().headers['x-qa-throttled'] === 'yes') {
      throw new HttpException('Synthetic global rejection', 429);
    }
    return true;
  }
}

@Controller('synthetic-settlement-public')
class SyntheticPublicController {
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  read() { return { syntheticPublic: true }; }
}

// Import the actual AdminModule.configure hook in both apps; only candidate adds the new early boundary.
describe('settlement preview private responses through existing Nest HTTP controllers', () => {
  let app: INestApplication | undefined, baselineApp: INestApplication | undefined;
  let base = '', baselineBase = '', issued = 0;
  let errorLog: jest.SpyInstance | undefined;
  async function createApplication(earlyPrivacy: boolean) {
    const module = await Test.createTestingModule({
      imports: [AdminModule],
      controllers: [CreatorStudioController, SyntheticPublicController],
      providers: [
        { provide: CreatorStudioService, useValue: creator },
        AdminPermissionGuard,
        { provide: APP_GUARD, useClass: SyntheticGlobalDenialGuard },
      ],
    }).overrideProvider(AdminService).useValue(admin)
      .overrideProvider(AdminUsersReadService).useValue(Object.freeze({}))
      .overrideProvider(AdminTestAccountService).useValue(Object.freeze({}))
      .overrideGuard(JwtAuthGuard).useClass(SyntheticAuthenticationGuard)
      .overrideGuard(AdminAuthGuard).useClass(SyntheticAuthenticationGuard).compile();
    expect(module.get(AdminController, { strict: false })).toBeInstanceOf(AdminController);
    const application = module.createNestApplication({ logger: false });
    if (earlyPrivacy) app = application; else baselineApp = application;
    application.use((_request: unknown, response: { vary(field: string): unknown }, next: () => void) => {
      response.vary('Origin'); response.vary('Accept-Encoding'); next();
    });
    if (earlyPrivacy) application.use(settlementPreviewPrivacyMiddleware);
    configureHttpRouting(application);
    application.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transform: true,
      exceptionFactory: createValidationException,
    }));
    application.useGlobalFilters(new HttpExceptionFilter());
    application.enableCors({ origin: [ORIGIN], credentials: true });
    // Controlled pre-module response, distinct from Nest's global guard and real parser errors.
    application.use((request: { headers: Record<string, unknown> },
      response: { status(code: number): { json(body: unknown): void } }, next: () => void) => {
      if (request.headers['x-qa-pre-module'] === 'yes') {
        response.status(429).json({ syntheticEarlyRejection: true }); return;
      }
      next();
    });
    await application.listen(0, '127.0.0.1');
    return 'http://127.0.0.1:' + application.getHttpServer().address().port;
  }
  beforeAll(async () => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    baselineBase = await createApplication(false);
    base = await createApplication(true);
    expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(baselineBase).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(base).not.toBe(baselineBase);
  }, 30000);
  beforeEach(() => {
    issued = 0; authChecks.mockClear();
    for (const route of routes) route.service.mockReset().mockResolvedValue(route.payload);
    for (const mock of writeMocks) mock.mockReset().mockImplementation(() => { throw new Error('Synthetic write forbidden'); });
  });
  afterEach(() => {
    expect(JSON.stringify(routes.map(route => route.payload))).toBe(payloadsBefore);
    for (const mock of writeMocks) expect(mock).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    try { await app?.close(); }
    finally { try { await baselineApp?.close(); } finally { errorLog?.mockRestore(); } }
  }, 10000);

  function readCalls() { return routes.reduce((sum, route) => sum + route.service.mock.calls.length, 0); }
  async function call(method: string, path: string, headers: Record<string, string> = {}, baseline = false) {
    expect(++issued).toBeLessThanOrEqual(40);
    const target = baseline ? baselineBase : base;
    expect(new URL(path, target).origin).toBe(target);
    const response = await fetch(target + path, { method, credentials: 'omit', redirect: 'error',
      headers: { Origin: ORIGIN, ...headers }, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16384);
    if (method === 'HEAD') expect(text).toBe('');
    return { response, text };
  }
  type Result = Awaited<ReturnType<typeof call>>;
  function vary(result: Result) {
    return (result.response.headers.get('vary') ?? '').toLowerCase().split(',').map(value => value.trim());
  }
  function cors(result: Result) {
    expect(result.response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(result.response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(result.response.headers.get('set-cookie')).toBeNull();
    for (const token of ['origin', 'accept-encoding']) expect(vary(result).filter(value => value === token)).toHaveLength(1);
  }
  function privateResult(result: Result, status: number) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    expect(vary(result).filter(value => value === 'authorization')).toHaveLength(1);
    cors(result);
  }
  function unprotectedResult(result: Result, status: number, cache: string | null = null) {
    expect(result.response.status).toBe(status);
    expect(result.response.headers.get('cache-control')).toBe(cache);
    expect(vary(result)).not.toContain('authorization');
    cors(result);
  }
  function samePolicy(result: Result, baseline: Result, status: number) {
    expect(result.response.status).toBe(status); expect(baseline.response.status).toBe(status);
    for (const header of ['cache-control', 'pragma', 'expires', 'access-control-allow-origin',
      'access-control-allow-credentials', 'set-cookie']) {
      expect(result.response.headers.get(header)).toBe(baseline.response.headers.get(header));
    }
    expect(vary(result).sort()).toEqual(vary(baseline).sort());
    cors(result); cors(baseline);
  }

  it('keeps all six anonymous GET/HEAD401 private, preserving existing admin module protection rather than claiming six gaps', async () => {
    for (const route of routes) for (const method of ['GET', 'HEAD']) {
      privateResult(await call(method, route.path), 401);
    }
    for (const route of routes) {
      const legacy = await call('GET', route.path, {}, true);
      if (route.owner) unprotectedResult(legacy, 401);
      else {
        privateResult(legacy, 401);
        expect(legacy.response.headers.get('pragma')).toBe('no-cache');
        expect(legacy.response.headers.get('expires')).toBe('0');
      }
    }
    expect(readCalls()).toBe(0);
  }, 15000);

  it('keeps actual admin payment-read denials403 private without widening other permissions', async () => {
    for (const permission of ['denied', 'unrelated', 'settlement-write']) {
      for (const route of routes.filter(route => !route.owner)) for (const method of ['GET', 'HEAD']) {
        privateResult(await call(method, route.path, { ...allowed, 'x-qa-permission': permission }), 403);
      }
    }
    expect(readCalls()).toBe(0);
  }, 15000);

  it('preserves owner GET/HEAD200 payloads and forwards CurrentUser.id plus actual transformed query DTO', async () => {
    for (const route of routes.filter(route => route.owner)) {
      for (const owner of [OWNER, OTHER_OWNER]) for (const method of ['GET', 'HEAD']) {
        const result = await call(method, route.path + '?' + new URLSearchParams(route.query),
          { ...allowed, 'x-qa-owner': owner === OTHER_OWNER ? 'other' : 'first' });
        privateResult(result, 200);
        if (method === 'GET') expect(JSON.parse(result.text)).toEqual(route.payload);
        const [actualOwner, actualQuery] = route.service.mock.calls.at(-1)!;
        expect(actualOwner).toBe(owner);
        expect(actualQuery).toEqual(route.query);
        expect(actualQuery).toBeInstanceOf(route.path.endsWith('/settlement-conversions')
          ? CreatorStudioSettlementConversionQueryDto : CreatorStudioSettlementPreviewQueryDto);
      }
      expect(route.service).toHaveBeenCalledTimes(4);
    }
    expect(readCalls()).toBe(12);
  }, 15000);

  it('preserves admin GET/HEAD200 query/payloads for real read permission and its existing payment-write implication', async () => {
    for (const route of routes.filter(route => !route.owner)) {
      for (const permission of ['read', 'write']) for (const method of ['GET', 'HEAD']) {
        const result = await call(method, route.path + '?' + new URLSearchParams(route.query),
          { ...allowed, 'x-qa-permission': permission });
        privateResult(result, 200);
        if (method === 'GET') expect(JSON.parse(result.text)).toEqual(route.payload);
        expect(route.service.mock.calls.at(-1)).toEqual([route.query]);
      }
      expect(route.service).toHaveBeenCalledTimes(4);
    }
    expect(readCalls()).toBe(12);
  }, 15000);

  it('keeps owner malformed period/status and forbidden owner/query400 private before service dispatch', async () => {
    for (const route of routes.filter(route => route.owner)) {
      const invalid = ['period=not-a-period', 'period=2026-10&period=2026-11',
        'ownerId=' + OTHER_OWNER, 'unexpectedQuery=synthetic'];
      if (route.path.endsWith('/settlement-conversions')) {
        invalid.push('status=pending', 'status=requested&status=approved');
      } else invalid.push('status=requested');
      for (const query of invalid) for (const method of ['GET', 'HEAD']) {
        const result = await call(method, route.path + '?' + query, allowed);
        privateResult(result, 400);
        if (method === 'GET') expect(JSON.parse(result.text).error.code).toBe('VALIDATION_FAILED');
      }
    }
    expect(readCalls()).toBe(0);
  }, 15000);

  it('protects synthetic pre-module429 as well as global-guard429 without attributing all admin privacy to the new helper', async () => {
    for (const route of routes) for (const method of ['GET', 'HEAD']) {
      privateResult(await call(method, route.path, { 'x-qa-throttled': 'yes' }), 429);
      privateResult(await call(method, route.path, { 'x-qa-pre-module': 'yes' }), 429);
    }
    for (const route of routes) {
      unprotectedResult(await call('GET', route.path, { 'x-qa-pre-module': 'yes' }, true), 429);
    }
    expect(authChecks).not.toHaveBeenCalled();
    expect(readCalls()).toBe(0);
  }, 15000);

  it('keeps all six service500 responses private and hides the synthetic internal error detail', async () => {
    for (const route of routes) for (const method of ['GET', 'HEAD']) {
      route.service.mockRejectedValueOnce(new Error(INTERNAL_DETAIL));
      const result = await call(method, route.path, allowed);
      privateResult(result, 500);
      expect(result.text).not.toContain(INTERNAL_DETAIL);
      if (method === 'GET') {
        expect(JSON.parse(result.text).error.code).toBe('INTERNAL_SERVER_ERROR');
        expect(JSON.parse(result.text).error.message).toBe('Internal server error');
      }
    }
    expect(readCalls()).toBe(12);
  }, 15000);

  it('preserves optional query-free GET/HEAD200 rather than inventing new required filters', async () => {
    for (const route of routes) for (const method of ['GET', 'HEAD']) {
      const result = await call(method, route.path, allowed);
      privateResult(result, 200);
      if (method === 'GET') expect(JSON.parse(result.text)).toEqual(route.payload);
      const args = route.service.mock.calls.at(-1)!;
      expect(args).toEqual(route.owner ? [OWNER, {}] : [{}]);
    }
    expect(readCalls()).toBe(12);
  }, 15000);

  it('leaves non-target policies unchanged, including already-private admin siblings and writes', async () => {
    for (const method of ['GET', 'HEAD']) {
      const publicBaseline = await call(method, '/api/v1/synthetic-settlement-public', {}, true);
      const result = await call(method, '/api/v1/synthetic-settlement-public');
      unprotectedResult(result, 200, 'public, max-age=60');
      samePolicy(result, publicBaseline, 200);
      if (method === 'GET') expect(JSON.parse(result.text)).toEqual({ syntheticPublic: true });
      for (const path of [OWNER_ROOT + '/settlement-preview-extra', OWNER_ROOT + '/payout-summary/one',
        ADMIN_ROOT + '/operations/partner-settlement-preview/one']) {
        const previous = await call(method, path, {}, true);
        samePolicy(await call(method, path), previous, 404);
      }
      const previous = await call(method, ADMIN_ROOT + '/settlements', {}, true);
      const sibling = await call(method, ADMIN_ROOT + '/settlements');
      samePolicy(sibling, previous, 401);
      if (method === 'GET') expect(sibling.response.headers.get('cache-control')).toBe('private, no-store');
    }
    const creatorWrite = await call('POST', OWNER_ROOT + '/settlement-conversions', {}, true);
    const currentCreatorWrite = await call('POST', OWNER_ROOT + '/settlement-conversions');
    unprotectedResult(currentCreatorWrite, 401); samePolicy(currentCreatorWrite, creatorWrite, 401);
    const adminWritePath = ADMIN_ROOT + '/settlement-conversions/' + CONVERSION + '/status';
    const adminWrite = await call('POST', adminWritePath, allowed, true);
    const currentAdminWrite = await call('POST', adminWritePath, allowed);
    samePolicy(currentAdminWrite, adminWrite, 403);
    expect(currentAdminWrite.response.headers.get('cache-control')).toBe('private, no-store');
    expect(readCalls()).toBe(0);
    for (const mock of writeMocks) expect(mock).not.toHaveBeenCalled();
  }, 15000);

  it('preserves all six CORS OPTIONS preflights without private-read headers or service/auth dispatch', async () => {
    for (const route of routes) {
      const result = await call('OPTIONS', route.path,
        { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' });
      unprotectedResult(result, 204);
      expect(result.response.headers.get('access-control-allow-headers')?.toLowerCase()).toBe('authorization');
    }
    expect(authChecks).not.toHaveBeenCalled();
    expect(readCalls()).toBe(0);
  }, 15000);
});

import 'reflect-metadata';
import assert = require('node:assert/strict');
import { ExecutionContext, INestApplication, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IncomingHttpHeaders, request, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

// AUTHOR UNRUN. Real controller/cache guards/filter/CORS; authentication and services are explicit doubles.
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const work = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const authorization = 'Bearer unit29-synthetic-http-not-a-jwt';
const origin = 'https://unit29-reader.example.invalid';
const deniedOrigin = 'https://unit29-unlisted.example.invalid';
const path = '/api/v1/me/creator-studio/approved-reading-catalog?locale=en&limit=12';
const privateTitle = 'UNIT29_SYNTHETIC_PRIVATE_TITLE';
const packet = { contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
  readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: [{ workId: work, title: { value: privateTitle, locale: 'en', fallback: false, bounded: false },
    defaultLocale: 'en', recordedState: { workStatus: 'draft', approval: 'not_checked' } }], nextCursor: null };
const reasons = [
  { code: 'AUTH_TOKEN_EXPIRED', status: 401, message: 'Invalid or expired access token' },
  { code: 'AUTH_CONFIG_UNAVAILABLE', status: 503, message: 'Authentication temporarily unavailable' },
  { code: 'AUTH_LOOKUP_UNAVAILABLE', status: 503, message: 'Authentication temporarily unavailable' },
] as const;
type Denial = typeof reasons[number];
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };
const tokens = (value: string | string[] | undefined) => String(value ?? '').split(',')
  .map(value => value.trim().toLowerCase()).filter(Boolean).sort();

// This models only response-header visibility, not a native browser or a second product decoder.
function browserHeaders(reply: Reply, requestOrigin = origin) {
  if (reply.headers['access-control-allow-origin'] !== requestOrigin) return null;
  const allowed = new Set(['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma',
    ...tokens(reply.headers['access-control-expose-headers'])]);
  return { get(name: string) {
    const key = name.toLowerCase();
    return allowed.has(key) && key !== 'set-cookie' ? String(reply.headers[key] ?? '') || null : null;
  } };
}

describe('owner approved catalog auth reason CORS (synthetic HTTP)', () => {
  let app: INestApplication | undefined;
  let port: number;
  let denial: Denial | null = reasons[0];
  const approvedReadingCatalog = jest.fn(async (_owner: string, _query: unknown) => packet);
  const creatorCatalog = jest.fn(async (_owner: string, _query: unknown) => ({ items: [] }));
  const catalog = jest.fn(async (_owner: string | undefined, _query: unknown) => ({ items: [] }));
  const graph = jest.fn(async (_owner: string, _work: string, _focus: unknown, _locale: string) => ({ nodes: [], edges: [] }));
  const requiredAuth = jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<{ headers: IncomingHttpHeaders; user?: { id: string } }>();
    if (req.headers.authorization !== authorization) throw new UnauthorizedException('Synthetic authorization required');
    if (denial) {
      const body = { code: denial.code, message: denial.message };
      throw denial.status === 401 ? new UnauthorizedException(body) : new ServiceUnavailableException(body);
    }
    req.user = { id: owner }; return true;
  });
  const optionalAuth = jest.fn(() => true);
  const unusedAdmin = jest.fn(() => { throw new UnauthorizedException('Unused synthetic admin boundary'); });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
      { provide: StoryProductionService, useValue: { approvedReadingCatalog, creatorCatalog, catalog, graph } },
      { provide: StoryProgressControlService, useValue: {} },
    ] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: requiredAuth })
      .overrideGuard(OptionalJwtAuthGuard).useValue({ canActivate: optionalAuth })
      .overrideGuard(AdminAuthGuard).useValue({ canActivate: unusedAdmin })
      .overrideGuard(AdminPermissionGuard).useValue({ canActivate: unusedAdmin })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('X-Fixture-Unexposed', 'synthetic-only');
      next();
    });
    app.enableCors({ origin: [origin], credentials: true });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true,
      forbidUnknownValues: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    denial = reasons[0];
    for (const mock of [approvedReadingCatalog, creatorCatalog, catalog, graph, requiredAuth, optionalAuth, unusedAdmin]) mock.mockClear();
  });
  afterAll(async () => { await app?.close(); });

  function call(target = path, method = 'GET', requestOrigin = origin): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Origin: requestOrigin, Authorization: authorization };
      if (method === 'OPTIONS') {
        delete headers.Authorization;
        headers['Access-Control-Request-Method'] = 'GET';
        headers['Access-Control-Request-Headers'] = 'authorization,cache-control';
      }
      const req = request({ hostname: '127.0.0.1', port, path: target, method, headers, agent: false }, res => {
        const chunks: Buffer[] = []; let length = 0;
        res.on('error', reject);
        res.on('data', (chunk: Buffer) => {
          length += chunk.length;
          if (length > 8192) { res.destroy(); req.destroy(new Error('Synthetic HTTP response bound')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode!, headers: res.headers, raw, body: raw ? JSON.parse(raw) : undefined });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(4000, () => req.destroy(new Error('Synthetic loopback HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }
  function privatePolicy(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache'); expect(reply.headers.expires).toBe('0');
    expect(tokens(reply.headers.vary)).toEqual(['accept-encoding', 'authorization', 'origin']);
  }

  it('01 guard errors expose only Vary and preserve the finite source-matched filter envelopes', async () => {
    for (const item of reasons) {
      denial = item;
      for (const method of ['GET', 'HEAD']) {
        const reply = await call(path, method);
        expect(reply.status).toBe(item.status); privatePolicy(reply);
        expect(reply.headers['access-control-allow-origin']).toBe(origin);
        expect(reply.headers['access-control-allow-credentials']).toBe('true');
        if (method === 'GET') {
          const body = reply.body as { success: boolean; error: Record<string, unknown> };
          expect(body).toMatchObject({ success: false, error: { code: item.code, message: item.message, statusCode: item.status, path } });
          expect(Object.keys(body)).toEqual(['success', 'error']);
          expect(Object.keys(body.error)).toEqual(['code', 'message', 'statusCode', 'path', 'timestamp']);
          expect(new Date(body.error.timestamp as string).toISOString()).toBe(body.error.timestamp);
          expect(reply.raw).toBe(JSON.stringify(reply.body));
          expect(Buffer.byteLength(reply.raw)).toBeLessThanOrEqual(1024);
          for (const value of [privateTitle, work, owner, authorization]) expect(reply.raw).not.toContain(value);
        } else expect(reply.raw).toBe('');
        // Baseline must reach this named HTTP assertion, not fail module/bootstrap admission.
        assert.equal(reply.headers['access-control-expose-headers'], 'Vary', 'AUTH_REASON_CORS_PREAUTH_VARY');
        const visible = browserHeaders(reply);
        assert(visible);
        expect(visible.get('vary')).toBe(reply.headers.vary);
        expect(visible.get('cache-control')).toBe('private, no-store');
        expect(visible.get('x-fixture-unexposed')).toBeNull();
        expect(visible.get('authorization')).toBeNull();
      }
    }
    expect(requiredAuth).toHaveBeenCalledTimes(6);
    for (const mock of [approvedReadingCatalog, creatorCatalog, catalog, graph, optionalAuth, unusedAdmin]) expect(mock).not.toHaveBeenCalled();
  });

  it('02 successful catalog and neighboring public preflight and denied-origin boundaries remain scoped', async () => {
    denial = null;
    const success = await call();
    expect(success.status).toBe(200); privatePolicy(success);
    expect(success.body).toEqual(packet);
    expect(success.headers['access-control-expose-headers']).toBe('Vary');
    expect(browserHeaders(success)?.get('vary')).toBe(success.headers.vary);
    expect(approvedReadingCatalog.mock.calls).toEqual([[owner, expect.objectContaining({ locale: 'en', limit: 12 })]]);
    for (const target of ['/api/v1/me/creator-studio/stories?locale=en&limit=12', `/api/v1/stories/${work}/graph?locale=en`]) {
      const neighbor = await call(target);
      expect(neighbor.status).toBe(200); privatePolicy(neighbor);
      expect(neighbor.headers['access-control-expose-headers']).toBeUndefined();
      expect(browserHeaders(neighbor)?.get('vary')).toBeNull();
    }
    const publicRead = await call('/api/v1/stories?locale=en&limit=12');
    expect(publicRead.status).toBe(200); expect(publicRead.body).toEqual({ items: [] });
    expect(publicRead.headers['access-control-expose-headers']).toBeUndefined();
    expect(tokens(publicRead.headers.vary)).toEqual(['accept-encoding', 'origin']);
    for (const key of ['cache-control', 'pragma', 'expires']) expect(publicRead.headers[key]).toBeUndefined();
    const preflight = await call(path, 'OPTIONS');
    expect(preflight.status).toBe(204); expect(preflight.raw).toBe('');
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(tokens(preflight.headers['access-control-allow-headers'])).toEqual(['authorization', 'cache-control']);
    expect(preflight.headers['access-control-expose-headers']).toBeUndefined();
    denial = reasons[0];
    const unlisted = await call(path, 'GET', deniedOrigin);
    expect(unlisted.status).toBe(401); privatePolicy(unlisted);
    expect(unlisted.headers['access-control-allow-origin']).toBeUndefined();
    expect(unlisted.headers['access-control-expose-headers']).toBe('Vary');
    expect(browserHeaders(unlisted, deniedOrigin)).toBeNull();
    expect(unlisted.raw).not.toContain(privateTitle);
    expect(requiredAuth).toHaveBeenCalledTimes(4); expect(optionalAuth).toHaveBeenCalledTimes(1);
    expect(approvedReadingCatalog).toHaveBeenCalledTimes(1); expect(creatorCatalog).toHaveBeenCalledTimes(1);
    expect(graph).toHaveBeenCalledTimes(1); expect(catalog).toHaveBeenCalledTimes(1); expect(unusedAdmin).not.toHaveBeenCalled();
  });
});

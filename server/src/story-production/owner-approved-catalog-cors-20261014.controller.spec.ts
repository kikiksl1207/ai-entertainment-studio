import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { IncomingHttpHeaders, request, ServerResponse } from 'http';
import { AddressInfo } from 'net';
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

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const authorization = 'Bearer synthetic-owner-catalog-cors';
const allowedOrigin = 'https://owner-catalog.example.invalid';
const deniedOrigin = 'https://unlisted-catalog.example.invalid';
const catalogPath = '/api/v1/me/creator-studio/approved-reading-catalog?locale=en&limit=12';
const privateTitle = 'SYNTHETIC_PRIVATE_APPROVED_READING_TITLE';
const approvedPacket = {
  contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
  readOnly: true, providerCalls: 0, operatingWrites: 0,
  items: [{ workId, title: { value: privateTitle, locale: 'en', fallback: false, bounded: false },
    defaultLocale: 'en', recordedState: { workStatus: 'draft', approval: 'not_checked' } }],
  nextCursor: null,
};
const creatorPacket = { items: [{ id: workId, title: 'Synthetic creator catalog' }] };
const publicPacket = { items: [{ slug: 'synthetic-public-story', title: 'Synthetic public catalog' }] };
const graphPacket = { nodes: [], edges: [] };
type AuthRequest = { headers: IncomingHttpHeaders; user?: { id: string } };
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };
const tokens = (value: string | string[] | undefined) => String(value ?? '').split(',')
  .map(token => token.trim().toLowerCase()).filter(Boolean).sort();

// Only the existing controller/cache guard and Nest/Express HTTP pipeline are real.
// No AppModule, JWT verification, database, provider or account fixture is used.
describe('owner approved catalog route-scoped CORS exposure (synthetic HTTP)', () => {
  let app: INestApplication;
  let port: number;
  const approvedReadingCatalog = jest.fn(async (_owner: string, _query: unknown) => approvedPacket);
  const creatorCatalog = jest.fn(async (_owner: string, _query: unknown) => creatorPacket);
  const catalog = jest.fn(async (_owner: string | undefined, _query: unknown) => publicPacket);
  const graph = jest.fn(async (_owner: string, _work: string, _focus: unknown, _locale: string) => graphPacket);
  const requiredAuth = jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.headers.authorization !== authorization) throw new UnauthorizedException('Synthetic authorization required');
    req.user = { id: ownerId };
    return true;
  });
  const optionalAuth = jest.fn(() => true);
  const rejectUnusedAdminAuth = jest.fn(() => { throw new UnauthorizedException('Unused synthetic admin route'); });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryProductionController],
      providers: [
        { provide: StoryProductionService, useValue: { approvedReadingCatalog, creatorCatalog, catalog, graph } },
        { provide: StoryProgressControlService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: requiredAuth })
      .overrideGuard(OptionalJwtAuthGuard).useValue({ canActivate: optionalAuth })
      .overrideGuard(AdminAuthGuard).useValue({ canActivate: rejectUnusedAdminAuth })
      .overrideGuard(AdminPermissionGuard).useValue({ canActivate: rejectUnusedAdminAuth })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    // Seed only an unrelated Vary token, never the exposure header under test.
    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('Vary', 'Accept-Encoding');
      next();
    });
    app.enableCors({ origin: [allowedOrigin], credentials: true });
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
      exceptionFactory: createValidationException,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    for (const mock of [approvedReadingCatalog, creatorCatalog, catalog, graph, requiredAuth, optionalAuth, rejectUnusedAdminAuth]) {
      mock.mockClear();
    }
  });
  afterAll(async () => { await app?.close(); });

  function call(path: string, method = 'GET', authenticated = true, origin = allowedOrigin): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Origin: origin };
      if (authenticated) headers.Authorization = authorization;
      if (method === 'OPTIONS') {
        delete headers.Authorization;
        headers['Access-Control-Request-Method'] = 'GET';
        headers['Access-Control-Request-Headers'] = 'authorization,cache-control';
      }
      const req = request({ hostname: '127.0.0.1', port, path, method, headers, agent: false }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode!, headers: res.headers, raw, body: raw ? JSON.parse(raw) : undefined });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic loopback HTTP timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  function expectPrivatePolicy(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache');
    expect(reply.headers.expires).toBe('0');
    expect(tokens(reply.headers.vary)).toEqual(['accept-encoding', 'authorization', 'origin']);
  }

  it.each(['GET', 'HEAD'])('%s original route exposes only Vary without replacing real Vary or private policy', async method => {
    const reply = await call(catalogPath, method);
    expect(reply.status).toBe(200);
    expect(reply.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(reply.headers['access-control-allow-credentials']).toBe('true');
    expect(reply.headers['access-control-expose-headers']).toBe('Vary');
    expectPrivatePolicy(reply);
    expect(reply.raw).toBe(method === 'HEAD' ? '' : JSON.stringify(approvedPacket));
    expect(reply.body).toEqual(method === 'HEAD' ? undefined : approvedPacket);
    expect(approvedReadingCatalog.mock.calls).toEqual([[ownerId, expect.objectContaining({ locale: 'en', limit: 12 })]]);
    expect(requiredAuth).toHaveBeenCalledTimes(1);
    expect(optionalAuth).not.toHaveBeenCalled();
    expect(creatorCatalog).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
    expect(rejectUnusedAdminAuth).not.toHaveBeenCalled();
    // Pin the intended original method decorator as well as its HTTP effect.
    expect(Reflect.getMetadata(HEADERS_METADATA, StoryProductionController.prototype.approvedReadingCatalog))
      .toContainEqual({ name: 'Access-Control-Expose-Headers', value: 'Vary' });
  });

  it.each(['GET', 'HEAD'])('anonymous %s stays private before auth denial and never reaches the catalog service', async method => {
    const reply = await call(catalogPath, method, false);
    expect(reply.status).toBe(401);
    expectPrivatePolicy(reply);
    expect(reply.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    if (method === 'HEAD') expect(reply.raw).toBe('');
    else {
      expect(reply.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED', statusCode: 401 } });
      expect(reply.body).not.toHaveProperty('items');
    }
    expect(reply.raw).not.toContain(privateTitle);
    expect(reply.raw).not.toContain(workId);
    expect(approvedReadingCatalog).not.toHaveBeenCalled();
    expect(requiredAuth).toHaveBeenCalledTimes(1);
    expect(optionalAuth).not.toHaveBeenCalled();
  });

  it.each([
    { path: '/api/v1/me/creator-studio/stories?locale=en&limit=12', packet: creatorPacket, service: creatorCatalog },
    { path: `/api/v1/stories/${workId}/graph?locale=en`, packet: graphPacket, service: graph },
  ])('neighbor $path sharing the real no-store guard does not inherit exposure', async ({ path, packet, service }) => {
    const reply = await call(path);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(packet);
    expectPrivatePolicy(reply);
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    expect(service).toHaveBeenCalledTimes(1);
    expect(approvedReadingCatalog).not.toHaveBeenCalled();
    expect(requiredAuth).toHaveBeenCalledTimes(1);
  });

  it('public catalog does not inherit exposure, authorization Vary or private cache headers', async () => {
    const reply = await call('/api/v1/stories?locale=en&limit=12', 'GET', false);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(publicPacket);
    expect(reply.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    expect(tokens(reply.headers.vary)).toEqual(['accept-encoding', 'origin']);
    expect(reply.headers['cache-control']).toBeUndefined();
    expect(reply.headers.pragma).toBeUndefined();
    expect(reply.headers.expires).toBeUndefined();
    expect(catalog.mock.calls).toEqual([[undefined, expect.objectContaining({ locale: 'en', limit: 12 })]]);
    expect(approvedReadingCatalog).not.toHaveBeenCalled();
    expect(requiredAuth).not.toHaveBeenCalled();
    expect(optionalAuth).toHaveBeenCalledTimes(1);
  });

  it('exposing Vary never authorizes a disallowed origin to read the response', async () => {
    const reply = await call(catalogPath, 'GET', true, deniedOrigin);
    // CORS is not authentication: Node sees the body, but no origin permission is granted.
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(approvedPacket);
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
    expect(reply.headers['access-control-expose-headers']).toBe('Vary');
    expectPrivatePolicy(reply);
  });

  it('preflight keeps authorization/cache-control permitted without running auth or exposing other routes', async () => {
    const reply = await call(catalogPath, 'OPTIONS', false);
    expect(reply.status).toBe(204);
    expect(reply.raw).toBe('');
    expect(reply.headers['access-control-allow-origin']).toBe(allowedOrigin);
    expect(tokens(reply.headers['access-control-allow-headers'])).toEqual(['authorization', 'cache-control']);
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    expect(approvedReadingCatalog).not.toHaveBeenCalled();
    expect(requiredAuth).not.toHaveBeenCalled();
    expect(optionalAuth).not.toHaveBeenCalled();
  });
});

import 'reflect-metadata';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { IncomingHttpHeaders, request, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

const subject = randomUUID();
const privateTitle = 'SYNTHETIC_PRIVATE_AUTHOR_CATALOG_TITLE';
const privateSnapshot = {
  items: [{ id: randomUUID(), title: privateTitle, status: 'draft', version: 3 }],
  pagination: { total: 1, nextCursor: null },
};
const publicSnapshot = { items: [{ slug: 'synthetic-public-work', title: 'Synthetic public work' }] };
const privatePath = '/api/v1/me/creator-studio/stories';
const publicPath = '/api/v1/stories';
const query = 'locale=en&limit=2&q=synthetic';
const vary = 'Origin, Accept-Encoding';
const publicCache = 'public, max-age=37';
const validAuthorization = 'Bearer synthetic-author-catalog-valid';
const forbiddenAuthorization = 'Bearer synthetic-author-catalog-forbidden';
const brokenAuthorization = 'Bearer synthetic-author-catalog-guard-error';
const methods = ['GET', 'HEAD'] as const;
type Method = typeof methods[number];
type AuthRequest = {
  headers: IncomingHttpHeaders;
  user?: { id: string; email: string };
};
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };

// Twenty registered cases, one RED marker. Guard outcomes and all service data are
// synthetic; the actual controller, catalog guard, Nest/Express and filter run.
// This is not real JWT/account permission, DB, provider or browser cache-hit proof.
describe('author catalog private-cache HTTP (real controller, synthetic auth/service)', () => {
  let app: INestApplication;
  let port: number;
  const creatorCatalog = jest.fn(async (_id: string, _query: StoryCatalogQueryDto) => privateSnapshot);
  const catalog = jest.fn(async (_id: string | undefined, _query: StoryCatalogQueryDto) => publicSnapshot);
  const requiredGuard = jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.headers.authorization === forbiddenAuthorization) {
      throw new ForbiddenException('Synthetic guard denial');
    }
    if (req.headers.authorization === brokenAuthorization) {
      throw new Error('SYNTHETIC_INTERNAL_GUARD_FAILURE');
    }
    if (req.headers.authorization !== validAuthorization) {
      throw new UnauthorizedException('Synthetic missing authorization');
    }
    req.user = { id: subject, email: 'synthetic-author@example.invalid' };
    return true;
  });
  const optionalGuard = jest.fn(() => true);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryProductionController],
      providers: [
        { provide: StoryProductionService, useValue: { creatorCatalog, catalog } },
        { provide: StoryProgressControlService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: requiredGuard })
      .overrideGuard(OptionalJwtAuthGuard).useValue({ canActivate: optionalGuard })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    // Seed unrelated transport policy only; no private-cache middleware is added.
    app.use((req: { url: string; headers: IncomingHttpHeaders }, res: ServerResponse, next: () => void) => {
      res.setHeader('Vary', vary);
      if (req.url.split('?')[0] === publicPath && req.headers['x-synthetic-public-cache'] === 'seed') {
        res.setHeader('Cache-Control', publicCache);
      }
      next();
    });
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
      exceptionFactory: createValidationException,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  beforeEach(() => {
    creatorCatalog.mockReset().mockResolvedValue(privateSnapshot);
    catalog.mockReset().mockResolvedValue(publicSnapshot);
    requiredGuard.mockClear();
    optionalGuard.mockClear();
  });
  afterAll(async () => { await app?.close(); });

  function call(
    path: string,
    method: Method,
    authorization: string | null = validAuthorization,
    seedPublicCache = false,
  ): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (authorization !== null) headers.authorization = authorization;
      if (seedPublicCache) headers['x-synthetic-public-cache'] = 'seed';
      const req = request({ hostname: '127.0.0.1', port, method, path, headers, agent: false }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode!, headers: res.headers, raw,
              body: raw ? JSON.parse(raw) : undefined });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  function expectEmptyHead(reply: Reply) {
    expect(reply.raw).toBe('');
    expect(reply.body).toBeUndefined();
  }

  function expectError(reply: Reply, method: Method, status: number, code: string, path: string) {
    expect(reply.status).toBe(status);
    if (method === 'HEAD') expectEmptyHead(reply);
    else {
      expect(reply.body).toMatchObject({ success: false, error: { code, statusCode: status, path } });
      expect(reply.body).not.toHaveProperty('items');
      expect(reply.raw).not.toContain(privateTitle);
      expect(reply.raw).not.toContain('SYNTHETIC_INTERNAL_GUARD_FAILURE');
      expect(reply.raw).not.toContain('SYNTHETIC_INTERNAL_SERVICE_FAILURE');
    }
  }

  function expectPrivatePolicy(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache');
    expect(reply.headers.expires).toBe('0');
    const tokens = String(reply.headers.vary ?? '').split(',').map(value => value.trim().toLowerCase());
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
    expect(tokens).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
  }

  function expectPrivateCalls(serviceReached: boolean) {
    expect(requiredGuard).toHaveBeenCalledTimes(1);
    expect(optionalGuard).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    if (serviceReached) {
      expect(creatorCatalog.mock.calls).toEqual([[subject,
        expect.objectContaining({ locale: 'en', limit: 2, q: 'synthetic' })]]);
    } else expect(creatorCatalog).not.toHaveBeenCalled();
  }

  const guardFailures = [
    { name: 'anonymous 401', authorization: null, status: 401, code: 'UNAUTHORIZED' },
    { name: 'synthetic guard 403', authorization: forbiddenAuthorization, status: 403, code: 'FORBIDDEN' },
    { name: 'synthetic guard throws 500', authorization: brokenAuthorization, status: 500, code: 'INTERNAL_SERVER_ERROR' },
  ];
  const serviceFailures = [
    { name: 'service 403', status: 403, code: 'FORBIDDEN',
      error: () => new ForbiddenException('Synthetic service denial') },
    { name: 'service 503', status: 503, code: 'SYNTHETIC_AUTHOR_CATALOG_UNAVAILABLE',
      error: () => new ServiceUnavailableException({ code: 'SYNTHETIC_AUTHOR_CATALOG_UNAVAILABLE' }) },
    { name: 'service throws 500', status: 500, code: 'INTERNAL_SERVER_ERROR',
      error: () => new Error('SYNTHETIC_INTERNAL_SERVICE_FAILURE') },
  ];

  for (const method of methods) {
    for (const failure of guardFailures) {
      const marker = method === 'GET' && failure.authorization === null
        ? 'AUTHOR-CATALOG-PRIVATE-RED' : 'AUTHOR-CATALOG-PRIVATE';
      it(`${marker}: ${method} ${failure.name} sets no-store before auth failure`, async () => {
        const path = `${privatePath}?${query}`;
        const reply = await call(path, method, failure.authorization);
        expectError(reply, method, failure.status, failure.code, path);
        expectPrivateCalls(false);
        expectPrivatePolicy(reply);
      });
    }

    it(`AUTHOR-CATALOG-PRIVATE: ${method} 200 preserves the service payload and synthetic subject`, async () => {
      const reply = await call(`${privatePath}?${query}`, method);
      expect(reply.status).toBe(200);
      if (method === 'HEAD') expectEmptyHead(reply);
      else {
        expect(reply.body).toEqual(privateSnapshot);
        expect(reply.raw).toBe(JSON.stringify(privateSnapshot));
      }
      expect(reply.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(privateSnapshot))));
      expectPrivateCalls(true);
      expectPrivatePolicy(reply);
    });

    for (const failure of serviceFailures) {
      it(`AUTHOR-CATALOG-PRIVATE: ${method} ${failure.name} keeps the existing error boundary private`, async () => {
        creatorCatalog.mockRejectedValueOnce(failure.error());
        const path = `${privatePath}?${query}`;
        const reply = await call(path, method);
        expectError(reply, method, failure.status, failure.code, path);
        expectPrivateCalls(true);
        expectPrivatePolicy(reply);
      });
    }

    it(`AUTHOR-CATALOG-PRIVATE: ${method} invalid locale is private without a service call`, async () => {
      const path = `${privatePath}?locale=unsupported`;
      const reply = await call(path, method);
      expectError(reply, method, 400, 'VALIDATION_FAILED', path);
      if (method === 'GET') {
        expect(reply.body).toMatchObject({ error: { details: expect.arrayContaining([
          expect.objectContaining({ field: 'locale' }),
        ]) } });
      }
      expectPrivateCalls(false);
      expectPrivatePolicy(reply);
    });

    for (const seeded of [false, true]) {
      it(`AUTHOR-CATALOG-PRIVATE: public ${method} stays nonprotected with ${seeded ? 'existing public' : 'unset'} cache`, async () => {
        const reply = await call(`${publicPath}?${query}`, method, null, seeded);
        expect(reply.status).toBe(200);
        if (method === 'HEAD') expectEmptyHead(reply);
        else {
          expect(reply.body).toEqual(publicSnapshot);
          expect(reply.raw).toBe(JSON.stringify(publicSnapshot));
        }
        expect(catalog.mock.calls).toEqual([[undefined,
          expect.objectContaining({ locale: 'en', limit: 2, q: 'synthetic' })]]);
        expect(creatorCatalog).not.toHaveBeenCalled();
        expect(requiredGuard).not.toHaveBeenCalled();
        expect(optionalGuard).toHaveBeenCalledTimes(1);
        expect(reply.headers['cache-control']).toBe(seeded ? publicCache : undefined);
        expect(reply.headers.pragma).toBeUndefined();
        expect(reply.headers.expires).toBeUndefined();
        expect(reply.headers.vary).toBe(vary);
      });
    }
  }
});

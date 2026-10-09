import 'reflect-metadata';
import {
  ForbiddenException,
  HttpException,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { PrismaService } from '../prisma/prisma.service';
import { StoryCatalogQueryDto } from './dto/story-production.dto';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

const subject = randomUUID(), decoySubject = randomUUID();
const progressId = randomUUID().toUpperCase(), workId = randomUUID();
const requestedLocale = 'zh-Hant';
const privateText = 'SYNTHETIC_PRIVATE_CURRENT_SCENE';
const snapshot = {
  progressId, workId, status: 'active', revision: 1, storyVersion: 1,
  scene: { id: randomUUID(), beats: [{ id: randomUUID(), position: 1, content: privateText }] },
  choices: [], path: [{ sceneKey: 'synthetic-reader-route' }],
};
const catalogSnapshot = { items: [{ slug: 'synthetic-public-catalog', title: 'Synthetic public title' }] };
const routes = [
  { name: 'current', path: `/api/v1/me/story-progress/${progressId}` },
  { name: 'currentScene', path: `/api/v1/story-sessions/${progressId}/current-scene` },
] as const;
type Route = typeof routes[number];
type Method = 'GET' | 'HEAD';
type AuthKind = 'missing' | 'expired' | 'refresh';
type Scenario =
  | { name: string; kind: 'success'; status: 200 }
  | { name: string; kind: 'auth'; status: 401; auth: AuthKind }
  | { name: string; kind: 'service'; status: number; error: () => HttpException; code: string }
  | { name: string; kind: 'query'; status: 400; query: string; field: string };
const success: Scenario = { name: 'authenticated 200', kind: 'success', status: 200 };
const failures: Scenario[] = [
  { name: 'missing-token 401', kind: 'auth', status: 401, auth: 'missing' },
  { name: 'expired-token 401', kind: 'auth', status: 401, auth: 'expired' },
  { name: 'refresh-token 401', kind: 'auth', status: 401, auth: 'refresh' },
  { name: 'service 403', kind: 'service', status: 403, code: 'FORBIDDEN',
    error: () => new ForbiddenException('Story entitlement required') },
  { name: 'service 404', kind: 'service', status: 404, code: 'NOT_FOUND',
    error: () => new NotFoundException('Story progress not found') },
  { name: 'service 503', kind: 'service', status: 503, code: 'SYNTHETIC_CURRENT_SCENE_UNAVAILABLE',
    error: () => new ServiceUnavailableException({ code: 'SYNTHETIC_CURRENT_SCENE_UNAVAILABLE' }) },
  { name: 'invalid-locale 400', kind: 'query', status: 400, query: 'locale=unsupported', field: 'locale' },
  { name: 'unknown-query 400', kind: 'query', status: 400,
    query: `locale=${requestedLocale}&userId=${decoySubject}`, field: 'userId' },
];

describe('current-scene cache HTTP (real Nest/JWT/validation/filter, synthetic account/service, no DB/provider)', () => {
  let app: INestApplication, port: number, token: string;
  let invalidTokens: Record<Exclude<AuthKind, 'missing'>, string>;
  // Service errors are synthetic header-boundary fixtures, not entitlement/database proof.
  const currentProgress = jest.fn(async (_user: string, _progress: string, _locale: string) => snapshot);
  const catalog = jest.fn(async (_user: string | undefined, _query: StoryCatalogQueryDto) => catalogSnapshot);
  const findAccount = jest.fn(async ({ where }: {
    where: { id: string; status: string; deletedAt: unknown };
  }) => where.id === subject && where.status === 'active' && where.deletedAt === null
    ? { id: subject, email: 'synthetic-reader@example.invalid' } : null);

  beforeAll(async () => {
    const secret = randomUUID(), jwt = new JwtService();
    const payload = { sub: subject, userId: decoySubject, tokenType: 'access' };
    token = await jwt.signAsync(payload, { secret, expiresIn: '5m' });
    invalidTokens = {
      expired: await jwt.signAsync(payload, { secret, expiresIn: -60 }),
      refresh: await jwt.signAsync({ ...payload, tokenType: 'refresh' }, { secret, expiresIn: '5m' }),
    };
    const module = await Test.createTestingModule({
      controllers: [StoryProductionController],
      providers: [
        { provide: StoryProductionService, useValue: { currentProgress, catalog } },
        { provide: StoryProgressControlService, useValue: {} },
        { provide: PrismaService, useValue: { user: { findFirst: findAccount } } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
        JwtAuthGuard, OptionalJwtAuthGuard,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
      exceptionFactory: createValidationException,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  beforeEach(() => {
    currentProgress.mockReset().mockResolvedValue(snapshot);
    catalog.mockReset().mockResolvedValue(catalogSnapshot);
    findAccount.mockClear();
  });
  afterAll(async () => { await app?.close(); });

  type Reply = { status: number; cache?: string; body: unknown; raw: string };
  function call(path: string, method: Method = 'GET', authorization: string | null = token): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port, method, path,
        headers: authorization === null ? {} : { authorization: `Bearer ${authorization}` },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString();
            resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
              raw, body: raw ? JSON.parse(raw) : undefined });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  async function exercise(route: Route, method: Method, scenario: Scenario) {
    if (scenario.kind === 'service') currentProgress.mockRejectedValueOnce(scenario.error());
    const authorization = scenario.kind === 'auth'
      ? scenario.auth === 'missing' ? null : invalidTokens[scenario.auth] : token;
    const query = scenario.kind === 'query' ? scenario.query : `locale=${requestedLocale}`;
    return call(`${route.path}?${query}`, method, authorization);
  }

  function expectBaseline(reply: Reply, route: Route, method: Method, scenario: Scenario) {
    expect(reply.status).toBe(scenario.status);
    if (method === 'HEAD') {
      expect(reply.raw).toBe('');
      expect(reply.body).toBeUndefined();
    } else if (scenario.kind === 'success') {
      expect(reply.body).toEqual(snapshot);
    } else {
      const code = scenario.kind === 'auth' ? 'UNAUTHORIZED'
        : scenario.kind === 'query' ? 'VALIDATION_FAILED' : scenario.code;
      expect(reply.body).toMatchObject({ success: false, error: { statusCode: scenario.status, code } });
      expect(reply.body).not.toHaveProperty('scene');
      expect(reply.raw).not.toContain(privateText);
      expect(reply.raw).not.toContain('synthetic-reader-route');
      if (scenario.kind === 'query') {
        expect(reply.body).toMatchObject({ error: { details: expect.arrayContaining([
          expect.objectContaining({ field: scenario.field }),
        ]) } });
      }
    }
    if (scenario.kind === 'success' || scenario.kind === 'service') {
      expect(currentProgress.mock.calls).toEqual([[subject, progressId, requestedLocale]]);
    } else {
      expect(currentProgress).not.toHaveBeenCalled();
    }
    if (scenario.kind === 'auth') {
      expect(findAccount).not.toHaveBeenCalled();
    } else {
      expect(findAccount.mock.calls).toEqual([[{
        where: { id: subject, status: 'active', deletedAt: null }, select: { id: true, email: true },
      }]]);
    }
    expect(catalog).not.toHaveBeenCalled();
    if (method === 'GET' && scenario.kind !== 'success') {
      expect(reply.body).toMatchObject({ error: { path: expect.stringContaining(route.path) } });
    }
  }

  describe.each(routes)('$name', route => {
    describe.each(['GET', 'HEAD'] as const)('%s', method => {
      it.each([success, ...failures])('baseline $name preserves status and identity forwarding', async scenario => {
        expectBaseline(await exercise(route, method, scenario), route, method, scenario);
      });

      it('cache-policy RED authenticated 200', async () => {
        const reply = await exercise(route, method, success);
        expectBaseline(reply, route, method, success);
        expect(reply.cache).toBe('private, no-store');
      });

      it.each(failures)('cache-policy $name', async scenario => {
        const reply = await exercise(route, method, scenario);
        expectBaseline(reply, route, method, scenario);
        expect(reply.cache).toBe('private, no-store');
      });
    });

    it('returns changed fresh GET responses without changing default locale or caller identity', async () => {
      const updated = { ...snapshot, revision: 2,
        scene: { ...snapshot.scene, beats: [{ ...snapshot.scene.beats[0], content: 'SYNTHETIC_UPDATED_CURRENT_SCENE' }] } };
      currentProgress.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(updated);
      const first = await call(route.path), second = await call(route.path);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body).toEqual(snapshot);
      expect(second.body).toEqual(updated);
      expect(currentProgress.mock.calls).toEqual([[subject, progressId, 'ko'], [subject, progressId, 'ko']]);
      expect(findAccount).toHaveBeenCalledTimes(2);
      expect(catalog).not.toHaveBeenCalled();
      // Fresh origin replies do not claim browser cache replay or actual AI quality.
      expect(first.cache).toBe('private, no-store');
      expect(second.cache).toBe('private, no-store');
    });
  });

  it('leaves the actual anonymous public catalog response and existing cache policy unchanged', async () => {
    const reply = await call('/api/v1/stories?locale=en', 'GET', null);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(catalogSnapshot);
    expect(reply.cache).toBeUndefined();
    expect(catalog.mock.calls).toEqual([[undefined, expect.objectContaining({ locale: 'en' })]]);
    expect(currentProgress).not.toHaveBeenCalled();
    expect(findAccount).not.toHaveBeenCalled();
  });
});

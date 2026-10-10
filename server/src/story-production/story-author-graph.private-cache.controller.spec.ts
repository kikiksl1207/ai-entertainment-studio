import 'reflect-metadata';
import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { IncomingHttpHeaders, request, ServerResponse } from 'http';
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
const workId = randomUUID(), focusSceneId = randomUUID();
const requestedLocale = 'zh-Hant';
const privateTitle = 'SYNTHETIC_PRIVATE_OWNER_GRAPH';
const snapshot = {
  vocabulary: ['scene', 'choice', 'branch', 'rejoin', 'ending'],
  part: { id: randomUUID(), status: 'draft', title: privateTitle },
  focus: { id: focusSceneId, sceneKey: 'synthetic-private-focus', position: 1,
    status: 'draft', title: privateTitle, endingType: null },
  parents: [], choices: [], destinations: [], validation: null,
  page: { bounded: true, maxChoices: 20, fullGraphIncluded: false },
};
const publicSnapshot = { items: [{ slug: 'synthetic-public-work', title: 'Synthetic public work' }] };
const graphPath = `/api/v1/stories/${workId}/graph`;
const publicPath = '/api/v1/stories';
const query = `locale=${requestedLocale}&focusSceneId=${focusSceneId}`;
const vary = 'Origin, Accept-Encoding';
const publicCache = 'public, max-age=37';
const methods = ['GET', 'HEAD'] as const;
type Method = typeof methods[number];
type AuthKind = 'missing' | 'expired' | 'refresh';
type Scenario =
  | { name: string; kind: 'success'; status: 200 }
  | { name: string; kind: 'auth'; status: 401; auth: AuthKind }
  | { name: string; kind: 'service'; status: number; code: string; error: () => Error }
  | { name: string; kind: 'query'; status: 400; query: string; field: string };
const scenarios: Scenario[] = [
  { name: 'authenticated 200', kind: 'success', status: 200 },
  { name: 'missing-token 401', kind: 'auth', status: 401, auth: 'missing' },
  { name: 'expired-token 401', kind: 'auth', status: 401, auth: 'expired' },
  { name: 'refresh-token 401', kind: 'auth', status: 401, auth: 'refresh' },
  { name: 'service 403', kind: 'service', status: 403, code: 'FORBIDDEN',
    error: () => new ForbiddenException('Synthetic service denial') },
  { name: 'service 404', kind: 'service', status: 404, code: 'NOT_FOUND',
    error: () => new NotFoundException('Story work not found') },
  { name: 'service 503', kind: 'service', status: 503, code: 'SYNTHETIC_PRIVATE_GRAPH_UNAVAILABLE',
    error: () => new ServiceUnavailableException({ code: 'SYNTHETIC_PRIVATE_GRAPH_UNAVAILABLE' }) },
  { name: 'service throws 500', kind: 'service', status: 500, code: 'INTERNAL_SERVER_ERROR',
    error: () => new Error('SYNTHETIC_INTERNAL_GRAPH_FAILURE') },
  { name: 'invalid-locale 400', kind: 'query', status: 400, query: 'locale=unsupported', field: 'locale' },
  { name: 'invalid-focus 400', kind: 'query', status: 400,
    query: `locale=${requestedLocale}&focusSceneId=not-a-uuid`, field: 'focusSceneId' },
  { name: 'unknown-query 400', kind: 'query', status: 400,
    query: `${query}&userId=${decoySubject}`, field: 'userId' },
];
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };

// Twenty-four cases, one RED marker. Nest/controller/JWT/validation/filter are real;
// account lookup and graph/catalog service outcomes are synthetic. No DB/provider,
// real author approval, assertOwner execution or browser cache-hit proof is claimed.
describe('author graph private-cache HTTP (real Nest/JWT, synthetic account/service)', () => {
  let app: INestApplication, port: number, token: string;
  let invalidTokens: Record<Exclude<AuthKind, 'missing'>, string>;
  const graph = jest.fn(async (_subject: string, _work: string, _focus: string | undefined, _locale: string) => snapshot);
  const catalog = jest.fn(async (_subject: string | undefined, _query: StoryCatalogQueryDto) => publicSnapshot);
  const findAccount = jest.fn(async ({ where }: {
    where: { id: string; status: string; deletedAt: unknown };
  }) => where.id === subject && where.status === 'active' && where.deletedAt === null
    ? { id: subject, email: 'synthetic-author@example.invalid' } : null);

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
        { provide: StoryProductionService, useValue: { graph, catalog } },
        { provide: StoryProgressControlService, useValue: {} },
        { provide: PrismaService, useValue: { user: { findFirst: findAccount } } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
        JwtAuthGuard, OptionalJwtAuthGuard,
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    // Preserve an unrelated Vary/public-cache seed; never inject graph privacy headers.
    app.use((req: { url: string }, res: ServerResponse, next: () => void) => {
      res.setHeader('Vary', vary);
      if (req.url.split('?')[0] === publicPath) res.setHeader('Cache-Control', publicCache);
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
    graph.mockReset().mockResolvedValue(snapshot);
    catalog.mockReset().mockResolvedValue(publicSnapshot);
    findAccount.mockClear();
  });
  afterAll(async () => { await app?.close(); });

  function call(path: string, method: Method = 'GET', authorization: string | null = token): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1', port, method, path, agent: false,
        headers: authorization === null ? {} : { authorization: `Bearer ${authorization}` },
      }, res => {
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

  function expectPrivatePolicy(reply: Reply) {
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.pragma).toBe('no-cache');
    expect(reply.headers.expires).toBe('0');
    const tokens = String(reply.headers.vary ?? '').split(',').map(value => value.trim().toLowerCase());
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
    expect(tokens).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
    expect(reply.headers['set-cookie']).toBeUndefined();
  }

  function expectBaseline(reply: Reply, path: string, method: Method, scenario: Scenario) {
    expect(reply.status).toBe(scenario.status);
    if (method === 'HEAD') {
      expect(reply.raw).toBe('');
      expect(reply.body).toBeUndefined();
    } else if (scenario.kind === 'success') {
      expect(reply.body).toEqual(snapshot);
      expect(reply.raw).toBe(JSON.stringify(snapshot));
    } else {
      const code = scenario.kind === 'auth' ? 'UNAUTHORIZED'
        : scenario.kind === 'query' ? 'VALIDATION_FAILED' : scenario.code;
      expect(reply.body).toMatchObject({ success: false, error: { code, statusCode: scenario.status, path } });
      expect(reply.body).not.toHaveProperty('focus');
      expect(reply.raw).not.toContain(privateTitle);
      expect(reply.raw).not.toContain('synthetic-private-focus');
      expect(reply.raw).not.toContain('SYNTHETIC_INTERNAL_GRAPH_FAILURE');
      if (scenario.kind === 'query') {
        expect(reply.body).toMatchObject({ error: { details: expect.arrayContaining([
          expect.objectContaining({ field: scenario.field }),
        ]) } });
      }
    }
    if (scenario.kind === 'success') {
      expect(reply.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(snapshot))));
    }
    if (scenario.kind === 'success' || scenario.kind === 'service') {
      expect(graph.mock.calls).toEqual([[subject, workId, focusSceneId, requestedLocale]]);
    } else expect(graph).not.toHaveBeenCalled();
    if (scenario.kind === 'auth') expect(findAccount).not.toHaveBeenCalled();
    else {
      expect(findAccount.mock.calls).toEqual([[{
        where: { id: subject, status: 'active', deletedAt: null }, select: { id: true, email: true },
      }]]);
    }
    expect(catalog).not.toHaveBeenCalled();
  }

  for (const method of methods) {
    for (const scenario of scenarios) {
      const marker = method === 'GET' && scenario.kind === 'success'
        ? 'AUTHOR-GRAPH-PRIVATE-RED' : 'AUTHOR-GRAPH-PRIVATE';
      it(`${marker}: ${method} ${scenario.name} preserves the boundary and private headers`, async () => {
        if (scenario.kind === 'service') graph.mockRejectedValueOnce(scenario.error());
        const authorization = scenario.kind === 'auth'
          ? scenario.auth === 'missing' ? null : invalidTokens[scenario.auth] : token;
        const requestedQuery = scenario.kind === 'query' ? scenario.query : query;
        const path = `${graphPath}?${requestedQuery}`;
        const reply = await call(path, method, authorization);
        expectBaseline(reply, path, method, scenario);
        expectPrivatePolicy(reply);
      });
    }
  }

  it('AUTHOR-GRAPH-PRIVATE: fresh GET payloads preserve default locale and absent focus without implicit requests', async () => {
    const updated = { ...snapshot, focus: { ...snapshot.focus, title: 'SYNTHETIC_UPDATED_OWNER_GRAPH' } };
    graph.mockResolvedValueOnce(snapshot).mockResolvedValueOnce(updated);
    const first = await call(graphPath), second = await call(graphPath);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toEqual(snapshot);
    expect(second.body).toEqual(updated);
    expect(graph.mock.calls).toEqual([[subject, workId, undefined, 'ko'], [subject, workId, undefined, 'ko']]);
    expect(findAccount.mock.calls).toEqual([0, 1].map(() => [{
      where: { id: subject, status: 'active', deletedAt: null }, select: { id: true, email: true },
    }]));
    expect(catalog).not.toHaveBeenCalled();
    expectPrivatePolicy(first);
    expectPrivatePolicy(second);
  });

  it('AUTHOR-GRAPH-PRIVATE: anonymous public catalog keeps its existing cache and Vary policy', async () => {
    const reply = await call(`${publicPath}?locale=en`, 'GET', null);
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual(publicSnapshot);
    expect(catalog.mock.calls).toEqual([[undefined, expect.objectContaining({ locale: 'en' })]]);
    expect(graph).not.toHaveBeenCalled();
    expect(findAccount).not.toHaveBeenCalled();
    expect(reply.headers['cache-control']).toBe(publicCache);
    expect(reply.headers.pragma).toBeUndefined();
    expect(reply.headers.expires).toBeUndefined();
    expect(reply.headers.vary).toBe(vary);
    expect(reply.headers['set-cookie']).toBeUndefined();
  });
});

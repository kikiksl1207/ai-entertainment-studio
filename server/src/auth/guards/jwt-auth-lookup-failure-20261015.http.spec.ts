import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { writeFileSync } from 'node:fs';
import { IncomingHttpHeaders, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpExceptionFilter } from '../../common/http-exception.filter';
import { configureHttpRouting } from '../../common/http-routing';
import { StoryAuthorApprovedSectionBytesController } from '../../story-production/story-author-approved-section-bytes.controller';
import { StoryAuthorApprovedSectionBytesService } from '../../story-production/story-author-approved-section-bytes.service';
import { StoryAuthorApprovedSectionBytesQueryDto } from '../../story-production/dto/story-author-approved-section-bytes.dto';
import { AuthUser } from '../auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

// Keep actual guard/controller/filter code; isolate only the repository, metric service and unrelated parser normalization.
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class PrismaService {} }));
jest.mock('../../story-production/story-author-approved-section-bytes.service', () => ({
  StoryAuthorApprovedSectionBytesService: class StoryAuthorApprovedSectionBytesService {},
}));
jest.mock('../../story-production/story-author-body-review.privacy', () => ({
  normalizeStoryAuthorCurrentFitParserException: (error: unknown) => error,
}));

const OWNER = '00000000-0000-4000-8000-000000000815';
const WORK = '00000000-0000-4000-8000-000000000816';
const TOKEN = 'synthetic-lookup-access';
const SECRET = 'synthetic-lookup-secret-not-a-real-key';
const PRIVATE_DETAIL = 'SYNTHETIC_PRIVATE_LOOKUP_DETAIL';
const ROUTE = `/api/v1/me/creator-studio/stories/${WORK}/generation-profile/approved-section-bytes?measurement=json-utf8-v1`;
const PACKET = Object.freeze({ syntheticOnly: true, readOnly: true });
type AuthRequest = { user?: AuthUser };
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: any };
type Outcome = { method: string; status: number; code: string | null; guardVerificationCalls: number;
  lookupCalls: number; serviceCalls: number; userAttached: boolean; bodyBytes: number };

describe('JwtAuthGuard lookup classification on actual section-byte Nest HTTP route', () => {
  let app: INestApplication | undefined;
  let port = 0;
  let issued = 0;
  const requests: AuthRequest[] = [];
  const outcomes: Outcome[] = [];
  const jwt = { verifyAsync: jest.fn() };
  const config = { getOrThrow: jest.fn() };
  const prisma = { user: { findFirst: jest.fn() } };
  const inspect = jest.fn();

  beforeAll(async () => {
    expect(Reflect.getMetadata(PATH_METADATA, StoryAuthorApprovedSectionBytesController))
      .toBe('me/creator-studio/stories/:workId/generation-profile/approved-section-bytes');
    const guards = Reflect.getMetadata(GUARDS_METADATA, StoryAuthorApprovedSectionBytesController);
    expect(guards).toHaveLength(2);
    expect(guards[0].name).toBe('ApprovedSectionBytesNoStoreGuard');
    expect(guards[1]).toBe(JwtAuthGuard);
    expect(Reflect.getMetadata(HEADERS_METADATA, StoryAuthorApprovedSectionBytesController.prototype.inspect))
      .toContainEqual({ name: 'Access-Control-Expose-Headers', value: 'Vary' });
    const module = await Test.createTestingModule({
      controllers: [StoryAuthorApprovedSectionBytesController],
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: config },
        { provide: PrismaService, useValue: prisma },
        { provide: StoryAuthorApprovedSectionBytesService, useValue: { inspect } },
      ],
    }).compile();
    expect(module.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    app = module.createNestApplication({ logger: false });
    app.use((req: AuthRequest, _response: unknown, next: () => void) => { requests.push(req); next(); });
    configureHttpRouting(app);
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    expect(port).toBeGreaterThan(0);
  }, 30000);

  function resetState() {
    requests.length = 0;
    jwt.verifyAsync.mockReset().mockResolvedValue({
      sub: OWNER, tokenType: 'access', email: 'synthetic-token@example.invalid',
    });
    config.getOrThrow.mockReset().mockReturnValue(SECRET);
    prisma.user.findFirst.mockReset().mockResolvedValue({ id: OWNER, email: 'synthetic-user@example.invalid' });
    inspect.mockReset().mockResolvedValue(PACKET);
  }
  beforeEach(resetState);

  afterAll(async () => {
    let closed = false;
    try {
      await app?.close();
      closed = true;
    } finally {
      const report = process.env.GUARD_LOOKUP_HTTP_REPORT;
      if (report) writeFileSync(report, JSON.stringify({
        actualGuardAndController: true, syntheticAuthenticationRepositoryAndMetricService: true,
        issued, closed, outcomes,
      }, null, 2) + '\n', { flag: 'wx' });
    }
  }, 10000);

  function call(method: 'GET' | 'HEAD'): Promise<Reply> {
    expect(++issued).toBeLessThanOrEqual(6);
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: ROUTE, method, agent: false,
        headers: { Authorization: `Bearer ${TOKEN}`, 'x-request-id': 'synthetic-lookup-http' } }, res => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 4096) res.destroy(new Error('Synthetic response exceeds bounded envelope'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const body = raw ? JSON.parse(raw) : undefined;
            const status = res.statusCode!;
            outcomes.push({ method, status, code: body?.error?.code ?? null,
              guardVerificationCalls: jwt.verifyAsync.mock.calls.length,
              lookupCalls: prisma.user.findFirst.mock.calls.length, serviceCalls: inspect.mock.calls.length,
              userAttached: requests.some(value => value.user !== undefined), bodyBytes: bytes });
            resolve({ status, headers: res.headers, raw, body });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('Synthetic loopback HTTP timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  function expectPrivate(reply: Reply, method: 'GET' | 'HEAD', status: number) {
    expect(reply.status).toBe(status);
    expect(reply.headers['cache-control']).toBe('private, no-store');
    expect(reply.headers.vary).toBe('Authorization');
    expect(reply.headers['set-cookie']).toBeUndefined();
    if (method === 'HEAD') expect(reply.raw).toBe('');
    for (const value of [PRIVATE_DETAIL, TOKEN, SECRET, 'synthetic-user@example.invalid']) {
      expect(reply.raw).not.toContain(value);
    }
    expect(jwt.verifyAsync).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  }

  it.each(['GET', 'HEAD'] as const)('%s lookup failure is sanitized private 503 before any service read', async method => {
    prisma.user.findFirst.mockRejectedValueOnce(new Error(PRIVATE_DETAIL));
    const reply = await call(method);
    expectPrivate(reply, method, 503);
    if (method === 'GET') {
      expect(reply.body).toMatchObject({ success: false, error: {
        code: 'AUTH_LOOKUP_UNAVAILABLE', message: 'Authentication temporarily unavailable', statusCode: 503,
      } });
      expect(Object.keys(reply.body).sort()).toEqual(['error', 'success']);
      expect(reply.body.error.details).toBeUndefined();
    }
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(requests[0].user).toBeUndefined();
  });

  it('GET/HEAD invalid JWT stays private 401 with no lookup, retry or service read', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      resetState();
      jwt.verifyAsync.mockRejectedValueOnce(new Error(PRIVATE_DETAIL));
      const reply = await call(method);
      expectPrivate(reply, method, 401);
      if (method === 'GET') expect(reply.body).toMatchObject({ success: false, error: {
        code: 'UNAUTHORIZED', message: 'Invalid or expired access token', statusCode: 401,
      } });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(inspect).not.toHaveBeenCalled();
      expect(requests[0].user).toBeUndefined();
    }
  });

  it('GET/HEAD active user reaches the original read handler once with unchanged identity', async () => {
    for (const method of ['GET', 'HEAD'] as const) {
      resetState();
      const reply = await call(method);
      expectPrivate(reply, method, 200);
      expect(reply.headers['access-control-expose-headers']).toBe('Vary');
      if (method === 'GET') expect(reply.body).toEqual(PACKET);
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: OWNER, status: 'active', deletedAt: null }, select: { id: true, email: true },
      });
      expect(requests[0].user).toEqual({ id: OWNER, email: 'synthetic-user@example.invalid' });
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(inspect).toHaveBeenCalledWith(OWNER, WORK, expect.objectContaining({ measurement: 'json-utf8-v1' }));
      expect(inspect.mock.calls[0][2]).toBeInstanceOf(StoryAuthorApprovedSectionBytesQueryDto);
    }
  });
});

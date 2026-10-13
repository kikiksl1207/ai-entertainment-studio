import 'reflect-metadata';
import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { IncomingHttpHeaders, request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import { StoryAuthorApprovedSectionBytesController } from './story-author-approved-section-bytes.controller';
import { StoryAuthorApprovedSectionBytesService } from './story-author-approved-section-bytes.service';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const authorization = 'Bearer synthetic-section-bytes-cors';
const origin = 'https://owner-catalog.example.invalid';
const pathFor = (id: string) => `/api/v1/me/creator-studio/stories/${id}/generation-profile/approved-section-bytes?measurement=json-utf8-v1`;
// Deliberately inert payload, not an approval/profile/metric fixture.
const syntheticPacket = { contract: 'story-author-approved-section-bytes-v1', readOnly: true,
  providerCalls: 0, operatingWrites: 0, diagnostic: { wholeCandidateViewBytes: 64 } };
type AuthRequest = { headers: IncomingHttpHeaders; user?: { id: string } };
type Reply = { status: number; headers: IncomingHttpHeaders; raw: string; body: unknown };

describe('approved section bytes original route CORS exposure (synthetic HTTP)', () => {
  let app: INestApplication;
  let port: number;
  const inspect = jest.fn(async (_owner: string, _work: string, _query: unknown) => syntheticPacket);
  const auth = jest.fn((context: ExecutionContext) => {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (req.headers.authorization !== authorization) throw new UnauthorizedException('Synthetic authorization required');
    req.user = { id: ownerId };
    return true;
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryAuthorApprovedSectionBytesController],
      providers: [{ provide: StoryAuthorApprovedSectionBytesService, useValue: { inspect } }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: auth }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.enableCors({ origin: [origin], credentials: true });
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
      exceptionFactory: createValidationException,
    }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { inspect.mockClear(); auth.mockClear(); });
  afterAll(async () => { await app?.close(); });

  function call(path: string, method: string, authenticated = true): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Origin: origin };
      if (authenticated) headers.Authorization = authorization;
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
    // Preserve this controller's existing exact Vary behavior; do not widen the fix.
    expect(reply.headers.vary).toBe('Authorization');
    expect(reply.headers['access-control-allow-origin']).toBe(origin);
  }

  it.each(['GET', 'HEAD'])('%s exposes only Vary on the original numeric route and preserves synthetic bytes', async method => {
    const reply = await call(pathFor(workId), method);
    expect(reply.status).toBe(200);
    expectPrivatePolicy(reply);
    expect(reply.headers['access-control-expose-headers']).toBe('Vary');
    expect(reply.headers['access-control-allow-credentials']).toBe('true');
    expect(reply.raw).toBe(method === 'HEAD' ? '' : JSON.stringify(syntheticPacket));
    expect(reply.body).toEqual(method === 'HEAD' ? undefined : syntheticPacket);
    expect(inspect.mock.calls).toEqual([[ownerId, workId, expect.objectContaining({ measurement: 'json-utf8-v1' })]]);
    expect(auth).toHaveBeenCalledTimes(1);
    expect(Reflect.getMetadata(HEADERS_METADATA, StoryAuthorApprovedSectionBytesController.prototype.inspect))
      .toContainEqual({ name: 'Access-Control-Expose-Headers', value: 'Vary' });
  });

  it.each(['GET', 'HEAD'])('anonymous %s is private before the guard rejects, with no service read', async method => {
    const reply = await call(pathFor(workId), method, false);
    expect(reply.status).toBe(401);
    expectPrivatePolicy(reply);
    expect(reply.headers['access-control-expose-headers']).toBeUndefined();
    if (method === 'HEAD') expect(reply.raw).toBe('');
    else {
      expect(reply.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED', statusCode: 401 } });
      expect(reply.body).not.toHaveProperty('diagnostic');
    }
    expect(reply.raw).not.toContain(syntheticPacket.contract);
    expect(reply.raw).not.toContain('wholeCandidateViewBytes');
    expect(inspect).not.toHaveBeenCalled();
    expect(auth).toHaveBeenCalledTimes(1);
  });

  it.each(['GET', 'HEAD'])('%s malformed work UUID remains a private 400 with no synthetic metric leak', async method => {
    const reply = await call(pathFor('not-a-work-uuid'), method);
    expect(reply.status).toBe(400);
    expectPrivatePolicy(reply);
    if (method === 'HEAD') expect(reply.raw).toBe('');
    else {
      expect(reply.body).toMatchObject({ success: false, error: { code: 'BAD_REQUEST', statusCode: 400 } });
      expect(reply.body).not.toHaveProperty('diagnostic');
    }
    expect(reply.raw).not.toContain(syntheticPacket.contract);
    expect(reply.raw).not.toContain('wholeCandidateViewBytes');
    expect(inspect).not.toHaveBeenCalled();
    expect(auth).toHaveBeenCalledTimes(1);
  });
});

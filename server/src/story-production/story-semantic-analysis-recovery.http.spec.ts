import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';

describe('Profile recovery HTTP boundary (real JWT and DTO, mocked persistence)', () => {
  let app: INestApplication, port: number, token: string;
  const owner = randomUUID(), jobId = randomUUID(), sourceHash = 'a'.repeat(64);
  const recoverAnalysisProfile = jest.fn().mockResolvedValue({ id: jobId, status: 'completed', approval: 'not_approved' });
  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
      { provide: StoryProductionService, useValue: { recoverAnalysisProfile } },
      { provide: StoryProgressControlService, useValue: {} },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) } } },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => recoverAnalysisProfile.mockClear());
  afterAll(async () => { await app?.close(); });

  function call(body: unknown, authorization: string | null = token, id: string = jobId) {
    return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = request({ hostname: '127.0.0.1', port, method: 'POST',
        path: `/api/v1/me/creator-studio/analyses/${id}/recover-profile`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data),
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end(data);
    });
  }

  it('requires authentication and passes only the authenticated actor to recovery', async () => {
    expect((await call({ expectedSourceContentHash: sourceHash }, null)).status).toBe(401);
    expect((await call({ expectedSourceContentHash: sourceHash }, 'invalid')).status).toBe(401);
    expect(recoverAnalysisProfile).not.toHaveBeenCalled();
    const result = await call({ expectedSourceContentHash: sourceHash });
    expect(result.status).toBe(201); expect(result.cache).toBe('private, no-store');
    expect(result.body).toMatchObject({ id: jobId, status: 'completed', approval: 'not_approved' });
    expect(recoverAnalysisProfile).toHaveBeenCalledWith(owner, jobId, sourceHash);
  });

  it('rejects malformed source, UUID and caller-controlled actor or provider fields', async () => {
    for (const body of [{}, { expectedSourceContentHash: 5 }, { expectedSourceContentHash: 'wrong' },
      { expectedSourceContentHash: sourceHash, actorUserId: randomUUID() },
      { expectedSourceContentHash: sourceHash, apiKey: 'synthetic-only' }]) expect((await call(body)).status).toBe(400);
    expect((await call({ expectedSourceContentHash: sourceHash }, token, 'bad-id')).status).toBe(400);
    expect(recoverAnalysisProfile).not.toHaveBeenCalled();
  });
});

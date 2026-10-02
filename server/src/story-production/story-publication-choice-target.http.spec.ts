import 'reflect-metadata';
import { ConflictException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryUploadService } from '../story-upload/story-upload.service';
import { StoryPublicBetaAiActivationService } from './story-public-beta-ai-activation.service';
import { StoryPublicationIntakeController } from './story-publication-intake.controller';
import { StoryPublicationIntakeService } from './story-publication-intake.service';
import { StoryVisualGenerationAdminController } from './story-visual-generation.controller';
import { StoryVisualGenerationService } from './story-visual-generation.service';

describe('Published choice target HTTP (real JWT, admin guards and DTO)', () => {
  let app: INestApplication, port: number;
  const actor = randomUUID(), reader = randomUUID(), limited = randomUUID();
  const target = { workId: randomUUID(), releaseId: randomUUID() };
  const confirmations = { aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true,
    generatedResultReuseConfirmed: true, imageTransformationConfirmed: true };
  const status = jest.fn(), prepare = jest.fn(), aiStatus = jest.fn(), coverage = jest.fn(), activate = jest.fn();
  const visualStatus = jest.fn(), replaceVisual = jest.fn();
  const visualInput = { releaseId: target.releaseId, releaseChecksum: 'a'.repeat(64), sourceSceneKey: 'part-1-main' };
  const visualPath = `/admin/api/v1/story-visuals/${target.workId}`;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    for (const id of [actor, reader, limited]) {
      tokens[id] = await jwt.signAsync({ sub: id, tokenType: 'access' }, { secret, expiresIn: '5m' });
    }
    const module = await Test.createTestingModule({ controllers: [StoryPublicationIntakeController, StoryVisualGenerationAdminController], providers: [
      { provide: StoryPublicationIntakeService, useValue: {
        publishedInheritorChoiceStatus: status, preparePublishedInheritorChoices: prepare,
      } },
      { provide: StoryUploadService, useValue: {} },
      { provide: StoryPublicBetaAiActivationService, useValue: { status: aiStatus, choiceCoverage: coverage, activate } },
      { provide: StoryVisualGenerationService, useValue: { replacementStatus: visualStatus, replaceStale: replaceVisual } },
      { provide: PrismaService, useValue: {
        user: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) },
        adminUser: {
          findUnique: jest.fn(async ({ where }) => where.userId === reader ? null : {
            id: randomUUID(), status: 'active', role: { name: 'synthetic-admin',
              permissions: where.userId === actor ? ['*'] : ['users:read'] },
          }),
          update: jest.fn(),
        },
      } },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      JwtAuthGuard, AdminAuthGuard, AdminPermissionGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    for (const fn of [status, prepare, aiStatus, coverage, activate, visualStatus, replaceVisual]) fn.mockReset();
    status.mockResolvedValue({ ...target, status: 'preparing_choices' });
    prepare.mockResolvedValue({ ...target, status: 'ready' });
    aiStatus.mockResolvedValue({ ...target, active: false });
    coverage.mockResolvedValue({ ...target, status: 'ready' });
    activate.mockResolvedValue({ ...target, active: true });
    visualStatus.mockResolvedValue({ ...target, releaseChecksum: visualInput.releaseChecksum, items: [] });
    replaceVisual.mockResolvedValue({ ...target, ...visualInput, status: 'ready' });
  });

  function call(action: string, method = 'GET', data?: unknown, token: string | null = tokens[actor]) {
    return new Promise<{ status: number; body: any }>((resolve, reject) => {
      const payload = data === undefined ? '' : JSON.stringify(data);
      const req = request({ hostname: '127.0.0.1', port, method,
        path: action.startsWith('/') ? action : `/admin/api/v1/backstage/story-publication/published/inheritor/${action}`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
          ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end(payload);
    });
  }

  it('requires both authenticated admin membership and wildcard permissions', async () => {
    for (const [token, expected] of [[null, 401], ['invalid', 401], [tokens[reader], 403], [tokens[limited], 403]] as const) {
      expect((await call('choice-status', 'GET', undefined, token)).status).toBe(expected);
      expect((await call('prepare-choices', 'POST', target, token)).status).toBe(expected);
      expect((await call('activate-ai', 'POST', { ...target, ...confirmations }, token)).status).toBe(expected);
    }
    expect(status).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  });

  it('forwards one exact source pair for status, coverage, preparation and explicit activation', async () => {
    const query = new URLSearchParams(target).toString();
    expect((await call(`choice-status?${query}`)).status).toBe(200);
    expect(status).toHaveBeenCalledWith(target);
    expect(prepare).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
    expect((await call(`ai-status?${query}`)).status).toBe(200);
    expect(aiStatus).toHaveBeenCalledWith('inheritor', target);
    expect((await call(`choice-coverage?${query}`)).status).toBe(200);
    expect(coverage).toHaveBeenCalledWith('inheritor', target);
    expect((await call('prepare-choices', 'POST', target)).status).toBe(201);
    expect(prepare).toHaveBeenCalledWith(actor, target);
    const body = { ...target, ...confirmations };
    expect((await call('activate-ai', 'POST', body)).status).toBe(201);
    expect(activate).toHaveBeenCalledWith(actor, 'inheritor', body);
  });

  it.each([
    { workId: target.workId }, { releaseId: target.releaseId }, { ...target, workId: null },
    { ...target, releaseId: '' }, { ...target, workId: 'bad' }, { ...target, releaseId: ['bad'] },
    { ...target, actorUserId: randomUUID() }, { ...target, apiKey: 'synthetic-secret' },
  ])('rejects an incomplete, malformed or caller-expanded body %#', async input => {
    expect((await call('prepare-choices', 'POST', input)).status).toBe(400);
    expect((await call('activate-ai', 'POST', { ...confirmations, ...input })).status).toBe(400);
    expect(prepare).not.toHaveBeenCalled(); expect(activate).not.toHaveBeenCalled();
  });

  it.each([
    `workId=${target.workId}`, `releaseId=${target.releaseId}`, `workId=&releaseId=${target.releaseId}`,
    `workId=${target.workId}&releaseId=bad`, `workId=${target.workId}&workId=${target.workId}&releaseId=${target.releaseId}`,
    `${new URLSearchParams(target)}&actorUserId=${actor}`,
  ])('rejects malformed or repeated query pins %#', async query => {
    for (const action of ['choice-status', 'ai-status', 'choice-coverage']) {
      expect((await call(`${action}?${query}`)).status).toBe(400);
    }
    expect(status).not.toHaveBeenCalled(); expect(aiStatus).not.toHaveBeenCalled(); expect(coverage).not.toHaveBeenCalled();
  });

  it('preserves the old single-source request but reports ambiguity without automatic generation', async () => {
    await call('choice-status'); expect(status).toHaveBeenCalledWith(undefined);
    await call('prepare-choices', 'POST', {}); expect(prepare).toHaveBeenCalledWith(actor, undefined);
    prepare.mockReset().mockRejectedValue(new ConflictException({ code: 'STORY_PUBLICATION_SOURCE_SELECTION_REQUIRED' }));
    expect((await call('prepare-choices', 'POST', {})).status).toBe(409);
    expect(prepare).toHaveBeenCalledTimes(1); expect(activate).not.toHaveBeenCalled();
  });

  it('passes a stale release conflict through without resubmitting against a different source', async () => {
    prepare.mockRejectedValue(new ConflictException({ code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' }));
    const result = await call('prepare-choices', 'POST', target);
    expect(result.status).toBe(409); expect(result.body).toMatchObject({ error: { code: 'STORY_PUBLICATION_CHOICE_SOURCE_CHANGED' } });
    expect(prepare).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledWith(actor, target);
    expect(activate).not.toHaveBeenCalled();
  });

  it('uses the exact selected work URL and validated release/checksum/scene for admin image replacement', async () => {
    for (const [token, expected] of [[null, 401], ['invalid', 401], [tokens[reader], 403], [tokens[limited], 403]] as const) {
      expect((await call(`${visualPath}/replacement-status`, 'GET', undefined, token)).status).toBe(expected);
      expect((await call(`${visualPath}/replace-stale`, 'POST', visualInput, token)).status).toBe(expected);
    }
    expect(visualStatus).not.toHaveBeenCalled(); expect(replaceVisual).not.toHaveBeenCalled();
    const read = await call(`${visualPath}/replacement-status`);
    expect(read.status).toBe(200); expect(visualStatus).toHaveBeenCalledWith(target.workId);
    expect(replaceVisual).not.toHaveBeenCalled();
    const result = await call(`${visualPath}/replace-stale`, 'POST', visualInput);
    expect(result.status).toBe(201); expect(result.body).toMatchObject({ ...target, ...visualInput });
    expect(replaceVisual).toHaveBeenCalledWith(target.workId, visualInput);
  });

  it.each([
    {}, { ...visualInput, releaseId: '' }, { ...visualInput, releaseChecksum: 'wrong' },
    { ...visualInput, sourceSceneKey: '../different-scene' }, { ...visualInput, workId: target.workId },
    { ...visualInput, actorUserId: actor }, { ...visualInput, releaseId: [target.releaseId] },
  ])('rejects invalid or expanded image replacement input %# before dispatch', async input => {
    expect((await call(`${visualPath}/replace-stale`, 'POST', input)).status).toBe(400);
    expect(replaceVisual).not.toHaveBeenCalled();
  });
});

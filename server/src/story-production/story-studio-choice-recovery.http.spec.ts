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
import { StoryStudioLinearController } from './story-studio-linear.controller';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoiceRecoveryService } from './story-studio-choice-recovery.service';

describe('Choice reset HTTP (real JWT and DTO, synthetic persistence)', () => {
  let app: INestApplication, port: number, token: string;
  const owner = randomUUID(), workId = randomUUID(), releaseId = randomUUID();
  const body = { expectedManuscriptHash: 'a'.repeat(64), expectedApprovedFingerprint: 'b'.repeat(64),
    expectedProfilePinHash: 'd'.repeat(64),
    expectedReleaseChecksum: 'c'.repeat(64), resetConfirmed: true };
  const review = jest.fn(), reset = jest.fn(), retry = jest.fn(), preview = jest.fn(), reapprove = jest.fn();
  const consentBody = { expectedManuscriptHash: 'a'.repeat(64), expectedApprovedFingerprint: 'b'.repeat(64),
    expectedProfilePinHash: 'd'.repeat(64), expectedReleaseChecksum: 'c'.repeat(64), expectedBatchHash: 'e'.repeat(64),
    expectedConsentId: randomUUID(), expectedConsentRevision: 2, choicesReviewed: true, currentConsentConfirmed: true };
  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryStudioLinearController], providers: [
      { provide: StoryStudioLinearService, useValue: { preview } },
      { provide: StoryStudioChoiceJobService, useValue: { retry } },
      { provide: StoryStudioChoiceRecoveryService, useValue: { review, reset, reapprove } },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) => ({ id: where.id })) } } },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    review.mockReset().mockResolvedValue({ releaseId, status: 'settings_changed', canReset: true, generationStarted: false });
    reset.mockReset().mockResolvedValue({ releaseId, status: 'reset_ready', generationStarted: false, nextAction: 'explicit_retry_required' });
    retry.mockReset().mockResolvedValue({ releaseId, status: 'queued' });
    reapprove.mockReset().mockResolvedValue({ releaseId, status: 'current', generationStarted: false });
    preview.mockReset().mockResolvedValue({ importedVisualReferences: {
      approvalState: 'reference_only', requiresSceneReview: true, mappingState: 'unmapped_legacy' } });
  });
  afterAll(async () => { await app?.close(); });

  function call(action: string, data?: unknown, authorization: string | null = token, id: string = releaseId) {
    return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
      const payload = data === undefined ? '' : JSON.stringify(data);
      const req = request({ hostname: '127.0.0.1', port, method: ['choice-review', 'preview'].includes(action) ? 'GET' : 'POST',
        path: action === 'preview' ? `/api/v1/me/creator-studio/stories/${workId}/linear-draft/${id}`
          : `/api/v1/me/creator-studio/stories/${workId}/linear-draft/releases/${id}/${action}`,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
          ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end(payload);
    });
  }

  it('keeps imported image reference previews authenticated, actor-scoped and uncached without starting work', async () => {
    const manuscriptId = randomUUID();
    expect((await call('preview', undefined, null, manuscriptId)).status).toBe(401);
    expect(preview).not.toHaveBeenCalled();
    const response = await call('preview', undefined, token, manuscriptId);
    expect(response.status).toBe(200); expect(response.cache).toBe('private, no-store');
    expect(response.body.importedVisualReferences).toMatchObject({ approvalState: 'reference_only', requiresSceneReview: true });
    expect(preview).toHaveBeenCalledWith(owner, workId, manuscriptId);
    expect(review).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });

  it('requires authentication, routes only the authenticated actor, and prevents caching', async () => {
    expect((await call('choice-review', undefined, null)).status).toBe(401);
    expect((await call('reset-choices', body, 'invalid')).status).toBe(401);
    expect(review).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
    const readonly = await call('choice-review');
    expect(readonly.status).toBe(200); expect(readonly.cache).toBe('private, no-store');
    expect(review).toHaveBeenCalledWith(owner, workId, releaseId);
    expect(reset).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
    const result = await call('reset-choices', body);
    expect(result.status).toBe(201); expect(result.cache).toBe('private, no-store');
    expect(result.body).toMatchObject({ generationStarted: false, nextAction: 'explicit_retry_required' });
    expect(reset).toHaveBeenCalledWith(owner, workId, releaseId, body);
    expect(retry).not.toHaveBeenCalled();
  });

  it('rejects invalid confirmations, source bindings, UUIDs, double-encoded bodies and caller actor/provider fields', async () => {
    for (const input of [{}, { ...body, resetConfirmed: false }, { ...body, resetConfirmed: 'true' },
      { ...body, expectedApprovedFingerprint: 5 }, { ...body, expectedReleaseChecksum: 'wrong' },
      { ...body, expectedProfilePinHash: 'wrong' },
      { ...body, actorUserId: randomUUID() }, { ...body, apiKey: 'synthetic' }, JSON.stringify(body)]) {
      expect((await call('reset-choices', input)).status).toBe(400);
    }
    expect((await call('choice-review', undefined, token, 'wrong-id')).status).toBe(400);
    expect((await call('reset-choices', body, token, 'wrong-id')).status).toBe(400);
    expect(reset).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled();
  });

  it.each(['settings_changed', 'approval_required', 'blocked', 'consent_changed'])('does not allow a paid retry to bypass %s', async status => {
    review.mockResolvedValue({ status, code: 'STUDIO_CHOICES_RESET_REVIEW_REQUIRED' });
    expect((await call('retry-choices', {})).status).toBe(409);
    expect(retry).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  });

  it('keeps consent reapproval authenticated, actor-scoped and uncached without retry or publication', async () => {
    expect((await call('reapprove-choices', consentBody, null)).status).toBe(401);
    expect(reapprove).not.toHaveBeenCalled();
    const result = await call('reapprove-choices', consentBody);
    expect(result.status).toBe(201); expect(result.cache).toBe('private, no-store');
    expect(reapprove).toHaveBeenCalledWith(owner, workId, releaseId, consentBody);
    expect(reset).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
  });

  it('rejects malformed consent approvals and actor/provider/labels overrides at the HTTP boundary', async () => {
    for (const input of [{}, { ...consentBody, choicesReviewed: false }, { ...consentBody, currentConsentConfirmed: 'true' },
      { ...consentBody, expectedConsentId: 'wrong' }, { ...consentBody, expectedConsentRevision: '2' },
      { ...consentBody, expectedConsentRevision: 0 }, { ...consentBody, expectedConsentRevision: 1.2 },
      { ...consentBody, expectedConsentRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...consentBody, expectedBatchHash: 'wrong' },
      { ...consentBody, actorUserId: randomUUID() }, { ...consentBody, apiKey: 'synthetic' }, { ...consentBody, labels: [] },
      JSON.stringify(consentBody)]) expect((await call('reapprove-choices', input)).status).toBe(400);
    expect((await call('reapprove-choices', consentBody, token, 'wrong-id')).status).toBe(400);
    expect(reapprove).not.toHaveBeenCalled();
  });

  it('accepts a complete mixed-consent reset binding and rejects partial/null/string/extra confirmations', async () => {
    const mixedBody = { ...body, expectedConsentId: randomUUID(), expectedConsentRevision: 2,
      expectedBatchHash: 'e'.repeat(64), consentChangeConfirmed: true };
    const result = await call('reset-choices', mixedBody);
    expect(result.status).toBe(201); expect(result.cache).toBe('private, no-store');
    expect(reset).toHaveBeenCalledWith(owner, workId, releaseId, mixedBody);
    reset.mockClear();
    for (const key of ['expectedConsentId', 'expectedConsentRevision', 'expectedBatchHash', 'consentChangeConfirmed']) {
      const missing: any = { ...mixedBody }; delete missing[key];
      expect((await call('reset-choices', missing)).status).toBe(400);
      expect((await call('reset-choices', { ...mixedBody, [key]: null })).status).toBe(400);
    }
    for (const input of [{ ...mixedBody, expectedConsentRevision: '2' }, { ...mixedBody, expectedConsentRevision: 0 },
      { ...mixedBody, expectedConsentRevision: 1.2 }, { ...mixedBody, consentChangeConfirmed: 'true' },
      { ...mixedBody, consentChangeConfirmed: false }, { ...mixedBody, actorUserId: randomUUID() },
      { ...mixedBody, apiKey: 'synthetic' }, { ...mixedBody, expectedBatchHash: 'wrong' }]) {
      expect((await call('reset-choices', input)).status).toBe(400);
    }
    expect(reset).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled(); expect(reapprove).not.toHaveBeenCalled();
  });

  it('starts a retry only with a separate request after verified reset/current settings', async () => {
    await call('reset-choices', body); expect(retry).not.toHaveBeenCalled();
    review.mockResolvedValue({ status: 'reset_ready' });
    const result = await call('retry-choices', {});
    expect(result.status).toBe(201); expect(retry).toHaveBeenCalledWith(owner, workId, releaseId);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

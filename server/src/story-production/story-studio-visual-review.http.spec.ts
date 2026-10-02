import 'reflect-metadata';
import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
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
import { StoryStudioVisualReviewController } from './story-studio-visual-review.controller';
import { StoryStudioVisualReviewService } from './story-studio-visual-review.service';

type CallOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  authorization?: string | null;
  work?: string;
  manuscript?: string;
};

describe('Scene visual review HTTP (real JWT/DTO, synthetic service only)', () => {
  let app: INestApplication, port: number, token: string, otherToken: string;
  let rejectedTokens: Array<string | null>;
  const owner = randomUUID(), otherOwner = randomUUID(), workId = randomUUID(), manuscriptId = randomUUID();
  const batchId = randomUUID(), idempotencyKey = randomUUID();
  const review = jest.fn(), save = jest.fn(), approve = jest.fn(), approvedForReference = jest.fn(), selectRepresentative = jest.fn();
  const hashes = { expectedManuscriptHash: 'a'.repeat(64), expectedSourceChecksum: 'b'.repeat(64) };
  const identity = { ...hashes, expectedProfilePinHash: 'c'.repeat(64) };
  const savePath = 'visual-review-batches', approvePath = `${savePath}/${batchId}/approve`;

  function entry(referenceIndex = 3) {
    return { referenceIndex, sourceSceneKey: `scene-${referenceIndex}`, originalPromptSha256: 'd'.repeat(64),
      promptText: 'PRIVATE AUTHOR SCENE GUIDANCE' };
  }

  function saveBody() {
    return { ...identity, idempotencyKey, entries: [entry()] };
  }

  function approveBody() {
    return { ...identity, expectedBatchChecksum: 'e'.repeat(64), expectedRevision: 1, scenesReviewed: true };
  }

  function selectionBody() {
    return { ...identity, mode: 'select', idempotencyKey, expectedSelectionVersion: 0,
      batchId, expectedBatchChecksum: 'e'.repeat(64), representativeReviewed: true };
  }
  const selectionPath = 'visual-review/3/representative';

  const draft = { contract: 'story-visual-review-batch-v1', batchId, status: 'draft', revision: 1,
    entries: [entry()], generationStarted: false, published: false };
  const context = { contract: 'story-visual-review-context-v1', workId, manuscriptVersionId: manuscriptId,
    referenceIndex: 3, profilePinHash: identity.expectedProfilePinHash, batch: draft };

  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, ownerUserId: otherOwner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: otherOwner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    rejectedTokens = [null, 'invalid',
      await jwt.signAsync({ sub: owner, tokenType: 'refresh' }, { secret, expiresIn: '5m' }),
      await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: -1 }),
      await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret: randomUUID(), expiresIn: '5m' }),
      await jwt.signAsync({ sub: randomUUID(), tokenType: 'access' }, { secret, expiresIn: '5m' })];
    const module = await Test.createTestingModule({ controllers: [StoryStudioVisualReviewController], providers: [
      { provide: StoryStudioVisualReviewService, useValue: { review, save, approve, approvedForReference, selectRepresentative } },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) =>
        [owner, otherOwner].includes(where.id) ? { id: where.id } : null) } } },
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

  beforeEach(() => {
    review.mockReset().mockResolvedValue(context);
    save.mockReset().mockResolvedValue(draft);
    approve.mockReset().mockResolvedValue({ ...draft, status: 'approved', revision: 2 });
    approvedForReference.mockReset();
    selectRepresentative.mockReset().mockResolvedValue({ contract: 'story-part-visual-selection-context-v1',
      partKey: 'part-3', targetSceneKey: 'part-3-main', selectionVersion: 1 });
  });
  afterEach(() => { expect(approvedForReference).not.toHaveBeenCalled(); });
  afterAll(async () => { await app?.close(); });

  function call(route: string, options: CallOptions = {}) {
    const { method = 'GET', body, query = {}, authorization = token, work = workId, manuscript = manuscriptId } = options;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const search = new URLSearchParams(query).toString();
    return new Promise<{ status: number; cache: string | undefined; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/linear-draft/${manuscript}/${route}${search ? `?${search}` : ''}`,
        headers: { ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
          ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
              body: JSON.parse(Buffer.concat(chunks).toString()) });
          } catch (error) { reject(error); }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  function expectNoServiceCalls() {
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
    expect(approvedForReference).not.toHaveBeenCalled();
    expect(selectRepresentative).not.toHaveBeenCalled();
  }

  it('authenticates every route before any service call, including access-token type and active-user checks', async () => {
    for (const authorization of rejectedTokens) {
      expect((await call('visual-review/3', { query: hashes, authorization })).status).toBe(401);
      expect((await call(savePath, { method: 'POST', body: saveBody(), authorization })).status).toBe(401);
      expect((await call(approvePath, { method: 'POST', body: approveBody(), authorization })).status).toBe(401);
      expect((await call(selectionPath, { method: 'POST', body: selectionBody(), authorization })).status).toBe(401);
    }
    expectNoServiceCalls();
  });

  it('passes representative selection only after authenticated explicit validation and does not save, approve or generate', async () => {
    const body = selectionBody();
    const response = await call(selectionPath, { method: 'POST', body });
    expect(response.status).toBe(201); expect(response.cache).toBe('private, no-store');
    expect(selectRepresentative).toHaveBeenCalledWith(owner, workId, manuscriptId, 3, body);
    expect(review).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
  });

  it('accepts explicit clear without selection-only approval fields', async () => {
    const body = { ...identity, mode: 'clear', idempotencyKey, expectedSelectionVersion: 1 };
    expect((await call(selectionPath, { method: 'POST', body })).status).toBe(201);
    expect(selectRepresentative).toHaveBeenCalledWith(owner, workId, manuscriptId, 3, body);
    expect(save).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
  });

  it('rejects malformed representative identities, versions and absent explicit confirmation before service execution', async () => {
    for (const [field, values] of Object.entries({ mode: [undefined, 'auto'], idempotencyKey: [undefined, 'bad'],
      expectedSelectionVersion: [undefined, -1, 0.5, '0', 2147483647], representativeReviewed: [undefined, false, 'true', 1],
      batchId: [undefined, 'bad'], expectedBatchChecksum: [undefined, 'A'.repeat(64)], expectedProfilePinHash: [undefined, 'bad'] })) {
      for (const value of values) expect((await call(selectionPath, { method: 'POST', body: { ...selectionBody(), [field]: value } })).status).toBe(400);
    }
    expect((await call(selectionPath, { method: 'POST', body: { ...selectionBody(), ownerUserId: otherOwner } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it('rejects noncanonical reference routes for representative selection before service execution', async () => {
    for (const index of ['1e2', '01', '-1', '2000']) {
      expect((await call(`visual-review/${index}/representative`, { method: 'POST', body: selectionBody() })).status).toBe(400);
    }
    expectNoServiceCalls();
  });

  it('preserves representative ownership and stale-version denials without retrying or leaking private guidance', async () => {
    selectRepresentative.mockRejectedValueOnce(new NotFoundException('Story work not found'));
    const response = await call(selectionPath, { method: 'POST', body: selectionBody(), authorization: otherToken });
    expect(response.status).toBe(404);
    expect(selectRepresentative).toHaveBeenCalledWith(otherOwner, workId, manuscriptId, 3, selectionBody());
    selectRepresentative.mockRejectedValueOnce(new ConflictException({ code: 'STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED' }));
    const conflict = await call(selectionPath, { method: 'POST', body: selectionBody() });
    expect(conflict.status).toBe(409); expect(conflict.body.error.code).toBe('STUDIO_VISUAL_REVIEW_REPRESENTATIVE_CHANGED');
    expect(selectRepresentative).toHaveBeenCalledTimes(2); expect(save).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
    expect(JSON.stringify([response.body, conflict.body])).not.toContain(entry().promptText);
  });

  it('GET forwards the JWT subject and numeric reference exactly, is private/no-store, and never invokes writes', async () => {
    const response = await call('visual-review/3', { query: hashes });
    expect(response.status).toBe(200);
    expect(response.cache).toBe('private, no-store');
    expect(response.body).toEqual(context);
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(owner, workId, manuscriptId, 3, hashes);
    expect(save).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('save forwards only the exact validated batch, remains a draft, and never invokes approve or reads', async () => {
    const body = saveBody();
    const response = await call(savePath, { method: 'POST', body });
    expect(response.status).toBe(201);
    expect(response.cache).toBe('private, no-store');
    expect(response.body).toEqual(draft);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(owner, workId, manuscriptId, body);
    expect(review).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([1, 2])('explicit approval forwards batch ID and revision %s exactly without saving again', async expectedRevision => {
    const body = { ...approveBody(), expectedRevision };
    const response = await call(approvePath, { method: 'POST', body });
    expect(response.status).toBe(201);
    expect(response.cache).toBe('private, no-store');
    expect(response.body).toEqual({ ...draft, status: 'approved', revision: 2 });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(owner, workId, manuscriptId, batchId, body);
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('forwards a different authenticated actor to each service and preserves its ownership denial without leaking guidance', async () => {
    for (const method of [review, save, approve]) method.mockRejectedValue(new NotFoundException('Story work not found'));
    const responses = [await call('visual-review/3', { query: hashes, authorization: otherToken }),
      await call(savePath, { method: 'POST', body: saveBody(), authorization: otherToken }),
      await call(approvePath, { method: 'POST', body: approveBody(), authorization: otherToken })];
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain(entry().promptText);
    }
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(otherOwner, workId, manuscriptId, 3, hashes);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(otherOwner, workId, manuscriptId, saveBody());
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(otherOwner, workId, manuscriptId, batchId, approveBody());
  });

  it('preserves an approval conflict without retrying, saving, or falling back to an approved-reference read', async () => {
    approve.mockRejectedValue(new ConflictException({ code: 'STUDIO_VISUAL_REVIEW_BATCH_SUPERSEDED' }));
    const response = await call(approvePath, { method: 'POST', body: approveBody() });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('STUDIO_VISUAL_REVIEW_BATCH_SUPERSEDED');
    expect(approve).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts exactly eight entries without silently trimming or auto-approving them', async () => {
    const body = { ...saveBody(), entries: Array.from({ length: 8 }, (_, index) => entry(index)) };
    expect((await call(savePath, { method: 'POST', body })).status).toBe(201);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(owner, workId, manuscriptId, body);
    expect(review).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('rejects missing or malformed identity hashes on reads and both writes before reaching services', async () => {
    for (const field of Object.keys(hashes)) {
      for (const value of [undefined, 'bad', 'g'.repeat(64), 'a'.repeat(65)]) {
        const query: Record<string, string> = { ...hashes };
        if (value === undefined) delete query[field]; else query[field] = value;
        expect((await call('visual-review/3', { query })).status).toBe(400);
      }
    }
    for (const [route, body] of [[savePath, saveBody()], [approvePath, approveBody()]] as const) {
      const fields = [...Object.keys(identity), ...(route === approvePath ? ['expectedBatchChecksum'] : [])];
      for (const field of fields) {
        for (const value of [undefined, 'A'.repeat(64), 'a'.repeat(63), 123]) {
          expect((await call(route, { method: 'POST', body: { ...body, [field]: value } })).status).toBe(400);
        }
      }
    }
    expectNoServiceCalls();
  });

  it('rejects forged owners, caller identities, and unknown fields instead of silently stripping them', async () => {
    for (const field of ['ownerUserId', 'actorUserId', 'approvedByUserId', 'apiKey', 'extra']) {
      expect((await call('visual-review/3', { query: { ...hashes, [field]: otherOwner } })).status).toBe(400);
      expect((await call(savePath, { method: 'POST', body: { ...saveBody(), [field]: otherOwner } })).status).toBe(400);
      expect((await call(approvePath, { method: 'POST', body: { ...approveBody(), [field]: otherOwner } })).status).toBe(400);
    }
    expectNoServiceCalls();
  });

  it.each(['extra', 'ownerUserId', 'approvedByUserId', 'promptSha256', 'bindingSha256', 'status'])(
    'rejects nested entry field %s before saving', async field => {
      const body = { ...saveBody(), entries: [{ ...entry(), [field]: { forged: true } }] };
      expect((await call(savePath, { method: 'POST', body })).status).toBe(400);
      expectNoServiceCalls();
    });

  it.each([undefined, false, null, 'true', 1])('requires literal scenesReviewed=true, rejecting %s', async scenesReviewed => {
    expect((await call(approvePath, { method: 'POST', body: { ...approveBody(), scenesReviewed } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it.each([undefined, 0, 3, 1.5, '1'])('rejects invalid approval revision %s without coercion', async expectedRevision => {
    expect((await call(approvePath, { method: 'POST', body: { ...approveBody(), expectedRevision } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it('rejects invalid work, manuscript, batch and idempotency UUIDs before service calls', async () => {
    for (const invalid of [{ work: 'invalid' }, { manuscript: 'invalid' }]) {
      expect((await call('visual-review/3', { ...invalid, query: hashes })).status).toBe(400);
      expect((await call(savePath, { ...invalid, method: 'POST', body: saveBody() })).status).toBe(400);
      expect((await call(approvePath, { ...invalid, method: 'POST', body: approveBody() })).status).toBe(400);
    }
    expect((await call(`${savePath}/invalid/approve`, { method: 'POST', body: approveBody() })).status).toBe(400);
    for (const invalid of [undefined, 'invalid', 123]) {
      expect((await call(savePath, { method: 'POST', body: { ...saveBody(), idempotencyKey: invalid } })).status).toBe(400);
    }
    expectNoServiceCalls();
  });

  it.each(['bad', 'NaN', '3.5', '1e2'])('rejects noninteger reference path %s', async index => {
    expect((await call(`visual-review/${index}`, { query: hashes })).status).toBe(400);
    expectNoServiceCalls();
  });

  it.each([
    ['missing', undefined], ['null', null], ['empty', []], ['nonarray', {}],
    ['more than eight', Array.from({ length: 9 }, (_, index) => entry(index))], ['primitive row', ['invalid']],
  ])('rejects %s entries before saving', async (_label, entries) => {
    expect((await call(savePath, { method: 'POST', body: { ...saveBody(), entries } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it.each([
    ['referenceIndex', undefined], ['referenceIndex', -1], ['referenceIndex', 2000],
    ['referenceIndex', 0.5], ['referenceIndex', '3'],
    ['sourceSceneKey', undefined], ['sourceSceneKey', 'invalid scene'], ['sourceSceneKey', 'a'.repeat(161)],
    ['originalPromptSha256', undefined], ['originalPromptSha256', 'bad'], ['originalPromptSha256', 123],
    ['promptText', undefined], ['promptText', 123], ['promptText', 'x'.repeat(32001)],
  ])('rejects invalid entry field %s (case %#) before saving', async (field, value) => {
    expect((await call(savePath, { method: 'POST', body: { ...saveBody(), entries: [{ ...entry(), [field as string]: value }] } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it.each(['', ' \t\r\n '])('rejects empty/whitespace-only prompts at the DTO boundary (case %#)', async promptText => {
    expect((await call(savePath, { method: 'POST', body: { ...saveBody(), entries: [{ ...entry(), promptText }] } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it('keeps read, save and approval DTOs separate and rejects approval flags on save', async () => {
    for (const extra of [{ scenesReviewed: true }, { expectedRevision: 1 }, { expectedBatchChecksum: 'e'.repeat(64) }, { status: 'approved' }]) {
      expect((await call(savePath, { method: 'POST', body: { ...saveBody(), ...extra } })).status).toBe(400);
    }
    expect((await call(approvePath, { method: 'POST', body: { ...approveBody(), entries: [entry()] } })).status).toBe(400);
    expect((await call('visual-review/3', { query: { ...hashes, expectedProfilePinHash: identity.expectedProfilePinHash } })).status).toBe(400);
    expect((await call('visual-review/3', { query: { ...hashes, offset: '0' } })).status).toBe(400);
    expectNoServiceCalls();
  });

  it('does not expose write methods on review or GET aliases for either write endpoint', async () => {
    expect((await call('visual-review/3', { method: 'POST', body: saveBody() })).status).toBe(404);
    expect((await call(savePath, { query: hashes })).status).toBe(404);
    expect((await call(approvePath, { query: hashes })).status).toBe(404);
    expectNoServiceCalls();
  });
});

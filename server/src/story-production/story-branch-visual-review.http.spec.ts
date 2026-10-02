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
import { StoryBranchVisualReviewController, StoryBranchVisualReviewListController } from './story-branch-visual-review.controller';
import { StoryBranchVisualReviewService } from './story-branch-visual-review.service';

type CallOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  authorization?: string | null;
  work?: string;
  result?: string;
  list?: boolean;
};

type HttpResponse = { status: number; cache: string | undefined; body: any };

describe('AUTHOR branch visual review HTTP (real JWT/DTO, synthetic service only)', () => {
  let app: INestApplication, port: number, token: string, otherToken: string;
  let rejectedTokens: Array<string | null>;
  const owner = randomUUID(), otherOwner = randomUUID(), workId = randomUUID(), sharedResultId = randomUUID();
  const batchId = randomUUID(), idempotencyKey = randomUUID();
  const review = jest.fn(), save = jest.fn(), approve = jest.fn(), list = jest.fn();
  const identity = { expectedSourceChecksum: 'a'.repeat(64), expectedProfilePinHash: 'b'.repeat(64) };
  const savePath = 'drafts', approvePath = `${savePath}/${batchId}/approve`;
  const promptText = 'PRIVATE AUTHOR BRANCH SCENE GUIDANCE';
  const draft = { batchId, status: 'draft', revision: 1, promptText, generationStarted: false, published: false };
  const context = { workId, sharedResultId, profilePinHash: identity.expectedProfilePinHash, batch: draft };

  function saveBody() {
    return { ...identity, idempotencyKey, promptText };
  }

  function approveBody() {
    return { ...identity, expectedBatchChecksum: 'c'.repeat(64), expectedRevision: 1, sceneReviewed: true };
  }

  beforeAll(async () => {
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, ownerUserId: otherOwner, userId: otherOwner,
      tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: otherOwner, tokenType: 'access' }, { secret, expiresIn: '5m' });
    rejectedTokens = [null, 'invalid',
      await jwt.signAsync({ sub: owner, tokenType: 'refresh' }, { secret, expiresIn: '5m' }),
      await jwt.signAsync({ sub: owner }, { secret, expiresIn: '5m' }),
      await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: -1 }),
      await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret: randomUUID(), expiresIn: '5m' }),
      await jwt.signAsync({ sub: randomUUID(), tokenType: 'access' }, { secret, expiresIn: '5m' })];
    const module = await Test.createTestingModule({ controllers: [StoryBranchVisualReviewController, StoryBranchVisualReviewListController], providers: [
      { provide: StoryBranchVisualReviewService, useValue: { review, save, approve, list } },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) =>
        [owner, otherOwner].includes(where.id) && where.status === 'active' && where.deletedAt === null
          ? { id: where.id } : null) } } },
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
    list.mockReset().mockResolvedValue({ contract: 'story-shared-branch-visual-list-v1', workId, items: [], nextCursor: null });
    review.mockReset().mockResolvedValue(context);
    save.mockReset().mockResolvedValue(draft);
    approve.mockReset().mockResolvedValue({ ...draft, status: 'approved', revision: 2 });
  });
  afterAll(async () => { await app?.close(); });

  function call(route = '', options: CallOptions = {}) {
    const { method = 'GET', body, query = {}, authorization = token, work = workId, result = sharedResultId } = options;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const search = new URLSearchParams(query).toString();
    return new Promise<HttpResponse>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/shared-branches${options.list ? '' : `/${result}/visual-review${route ? `/${route}` : ''}`}${search ? `?${search}` : ''}`,
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

  function expectPrivate(response: HttpResponse, status: number) {
    expect(response.status).toBe(status);
    expect(response.cache).toBe('private, no-store');
  }

  function expectNoServiceCalls() {
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  }

  it('requires an active user and a valid access JWT for every route, with private/no-store denials', async () => {
    for (const authorization of rejectedTokens) {
      expectPrivate(await call('', { authorization }), 401);
      expectPrivate(await call(savePath, { method: 'POST', body: saveBody(), authorization }), 401);
      expectPrivate(await call(approvePath, { method: 'POST', body: approveBody(), authorization }), 401);
    }
    expectNoServiceCalls();
  });

  it('authenticates before validating malformed paths, bodies or caller-supplied queries', async () => {
    expectPrivate(await call('', { authorization: null, work: 'bad', query: { ownerUserId: otherOwner } }), 401);
    expectPrivate(await call(savePath, { method: 'POST', authorization: null, result: 'bad', body: {} }), 401);
    expectPrivate(await call('drafts/bad/approve', { method: 'POST', authorization: null, body: {} }), 401);
    expectNoServiceCalls();
  });

  it('GET passes only the verified JWT subject and path scope, without approval or other writes', async () => {
    const response = await call();
    expectPrivate(response, 200);
    expect(response.body).toEqual(context);
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(owner, workId, sharedResultId);
    expect(save).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('POST drafts forwards the exact validated draft and does not automatically approve or read it', async () => {
    const body = saveBody();
    const response = await call(savePath, { method: 'POST', body });
    expectPrivate(response, 201);
    expect(response.body).toEqual(draft);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(owner, workId, sharedResultId, body);
    expect(review).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([1, 2])('explicit approval forwards batch and revision %s without saving or reading', async expectedRevision => {
    const body = { ...approveBody(), expectedRevision };
    const response = await call(approvePath, { method: 'POST', body });
    expectPrivate(response, 201);
    expect(response.body).toEqual({ ...draft, status: 'approved', revision: 2 });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(owner, workId, sharedResultId, batchId, body);
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves scoped ownership denials for another authenticated user without leaking private guidance', async () => {
    for (const method of [review, save, approve]) method.mockRejectedValue(new NotFoundException('Story work not found'));
    const responses = [await call('', { authorization: otherToken }),
      await call(savePath, { method: 'POST', body: saveBody(), authorization: otherToken }),
      await call(approvePath, { method: 'POST', body: approveBody(), authorization: otherToken })];
    for (const response of responses) {
      expectPrivate(response, 404);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain(promptText);
    }
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(otherOwner, workId, sharedResultId);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(otherOwner, workId, sharedResultId, saveBody());
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(otherOwner, workId, sharedResultId, batchId, approveBody());
  });

  it('preserves a valid-UUID work/result/batch scope denial without retrying in another scope', async () => {
    const wrongWork = randomUUID(), wrongResult = randomUUID(), wrongBatch = randomUUID();
    for (const method of [review, save, approve]) method.mockRejectedValue(new NotFoundException('Branch visual review not found'));
    expectPrivate(await call('', { work: wrongWork, result: wrongResult }), 404);
    expectPrivate(await call(savePath, { method: 'POST', body: saveBody(), work: wrongWork, result: wrongResult }), 404);
    expectPrivate(await call(`drafts/${wrongBatch}/approve`, {
      method: 'POST', body: approveBody(), work: wrongWork, result: wrongResult,
    }), 404);
    expect(review).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledWith(owner, wrongWork, wrongResult);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(owner, wrongWork, wrongResult, saveBody());
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith(owner, wrongWork, wrongResult, wrongBatch, approveBody());
  });

  it.each(['source', 'profile', 'batch'])('preserves a stale %s approval conflict without retrying or side effects', async scope => {
    const code = `STORY_BRANCH_VISUAL_REVIEW_${scope.toUpperCase()}_CHANGED`;
    approve.mockRejectedValue(new ConflictException({ code }));
    const response = await call(approvePath, { method: 'POST', body: approveBody() });
    expectPrivate(response, 409);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain(promptText);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves a stale-source save conflict without trying approval or a fallback read', async () => {
    save.mockRejectedValue(new ConflictException({ code: 'STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED' }));
    const response = await call(savePath, { method: 'POST', body: saveBody() });
    expectPrivate(response, 409);
    expect(response.body.error.code).toBe('STORY_BRANCH_VISUAL_REVIEW_SOURCE_CHANGED');
    expect(save).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it('rejects all query fields on reads and writes instead of accepting caller-controlled scope', async () => {
    for (const field of ['ownerUserId', 'userId', 'workId', 'sharedResultId', 'batchId',
      'expectedSourceChecksum', 'expectedProfilePinHash', 'sceneReviewed', 'offset', 'extra']) {
      const query = { [field]: otherOwner };
      expectPrivate(await call('', { query }), 400);
      expectPrivate(await call(savePath, { method: 'POST', body: saveBody(), query }), 400);
      expectPrivate(await call(approvePath, { method: 'POST', body: approveBody(), query }), 400);
    }
    expectNoServiceCalls();
  });

  it('rejects missing, nonstring and noncanonical checksum/profile hashes before either write', async () => {
    for (const [route, body] of [[savePath, saveBody()], [approvePath, approveBody()]] as const) {
      const fields = [...Object.keys(identity), ...(route === approvePath ? ['expectedBatchChecksum'] : [])];
      for (const field of fields) {
        for (const value of [undefined, null, 123, {}, '', 'bad', 'A'.repeat(64), 'g'.repeat(64),
          'a'.repeat(63), 'a'.repeat(65), `${'a'.repeat(64)}\n`, ` ${'a'.repeat(64)}`]) {
          expectPrivate(await call(route, { method: 'POST', body: { ...body, [field]: value } }), 400);
        }
      }
    }
    expectNoServiceCalls();
  });

  it('rejects forged owner/scope/provider fields rather than stripping them before writes', async () => {
    for (const field of ['ownerUserId', 'actorUserId', 'userId', 'approvedByUserId', 'workId', 'sharedResultId',
      'batchId', 'sourceSceneKey', 'apiKey', 'provider', 'extra']) {
      expectPrivate(await call(savePath, { method: 'POST', body: { ...saveBody(), [field]: otherOwner } }), 400);
      expectPrivate(await call(approvePath, { method: 'POST', body: { ...approveBody(), [field]: otherOwner } }), 400);
    }
    expectNoServiceCalls();
  });

  it.each([undefined, null, false, 'true', 'false', 0, 1, {}])(
    'requires literal sceneReviewed=true, rejecting case %#', async sceneReviewed => {
      expectPrivate(await call(approvePath, { method: 'POST', body: { ...approveBody(), sceneReviewed } }), 400);
      expectNoServiceCalls();
    });

  it.each([undefined, null, 0, -1, 3, 1.5, '1', '2', true])(
    'rejects invalid approval revision without coercion (case %#)', async expectedRevision => {
      expectPrivate(await call(approvePath, { method: 'POST', body: { ...approveBody(), expectedRevision } }), 400);
      expectNoServiceCalls();
    });

  it('rejects invalid work/result/batch path UUIDs before any service invocation', async () => {
    for (const value of ['invalid', '123', 'null']) {
      for (const scope of [{ work: value }, { result: value }]) {
        expectPrivate(await call('', scope), 400);
        expectPrivate(await call(savePath, { ...scope, method: 'POST', body: saveBody() }), 400);
        expectPrivate(await call(approvePath, { ...scope, method: 'POST', body: approveBody() }), 400);
      }
      expectPrivate(await call(`drafts/${value}/approve`, { method: 'POST', body: approveBody() }), 400);
    }
    expectNoServiceCalls();
  });

  it.each([undefined, null, 123, '', 'invalid', 'a'.repeat(64)])(
    'rejects missing or malformed idempotency UUID (case %#)', async value => {
      expectPrivate(await call(savePath, { method: 'POST', body: { ...saveBody(), idempotencyKey: value } }), 400);
      expectNoServiceCalls();
    });

  it.each([undefined, null, 123, {}, [], '', ' \t\r\n ', '\u00a0\u2003',
    'private\0text', '\0', '\ud800', '\udc00', 'text\ud800', '\udc00text',
    '\ud800\ud800', '\udc00\ud800', 'x'.repeat(32001)])(
    'rejects missing, blank, NUL, malformed Unicode or oversized prompts (case %#)', async value => {
      expectPrivate(await call(savePath, { method: 'POST', body: { ...saveBody(), promptText: value } }), 400);
      expectNoServiceCalls();
    });

  it.each(['x'.repeat(32000), ' \tAUTHOR\r\n ', '\ud83d\ude00', '\ud800\udc00', '\uD55C\uAE00 \ud83d\ude00'])(
    'forwards valid boundary-length and well-formed Unicode prompts unchanged (case %#)', async value => {
      const body = { ...saveBody(), promptText: value };
      expectPrivate(await call(savePath, { method: 'POST', body }), 201);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(owner, workId, sharedResultId, body);
      expect(review).not.toHaveBeenCalled();
      expect(approve).not.toHaveBeenCalled();
    });

  it('rejects missing or nonobject write bodies before calling any service', async () => {
    for (const body of [undefined, null, {}, [], [saveBody()], [approveBody()], 'invalid', 123]) {
      for (const route of [savePath, approvePath]) {
        expect((await call(route, { method: 'POST', body })).status).toBe(400);
      }
    }
    expectNoServiceCalls();
  });

  it('keeps draft saving and explicit approval DTOs separate', async () => {
    for (const extra of [{ sceneReviewed: true }, { scenesReviewed: true }, { expectedRevision: 1 },
      { expectedBatchChecksum: 'c'.repeat(64) }, { status: 'approved' }, { approved: true }]) {
      expectPrivate(await call(savePath, { method: 'POST', body: { ...saveBody(), ...extra } }), 400);
    }
    for (const extra of [{ promptText }, { idempotencyKey }, { entries: [] }, { scenesReviewed: true }]) {
      expectPrivate(await call(approvePath, { method: 'POST', body: { ...approveBody(), ...extra } }), 400);
    }
    expectNoServiceCalls();
  });

  it('does not expose write methods on review, GET aliases for writes, or a missing batch scope', async () => {
    expect((await call('', { method: 'POST', body: saveBody() })).status).toBe(404);
    expect((await call(savePath)).status).toBe(404);
    expect((await call(approvePath)).status).toBe(404);
    expect((await call('drafts/approve', { method: 'POST', body: approveBody() })).status).toBe(404);
    expect((await call('', { result: '' })).status).toBe(404);
    expect((await call('', { work: '' })).status).toBe(404);
    expectNoServiceCalls();
  });

  it('lists only the JWT owner scope with bounded numeric query and no write effects', async () => {
    expectPrivate(await call('', { list: true, query: { limit: '8', cursor: sharedResultId } }), 200);
    expect(list).toHaveBeenCalledWith(owner, workId, { limit: 8, cursor: sharedResultId });
    expectNoServiceCalls();
  });

  it.each(['0', '9', '-1', '1.5', 'NaN', 'Infinity', 'x', ''])('rejects invalid list limit %s', async limit => {
    expectPrivate(await call('', { list: true, query: { limit } }), 400);
    expect(list).not.toHaveBeenCalled(); expectNoServiceCalls();
  });

  it.each(['ownerUserId', 'userId', 'releaseId', 'sharedResultId', 'status', 'extra'])('rejects list scope injection %s', async key => {
    expectPrivate(await call('', { list: true, query: { [key]: otherOwner } }), 400);
    expect(list).not.toHaveBeenCalled(); expectNoServiceCalls();
  });

  it('keeps list JWT rejection private and rejects malformed cursor/path', async () => {
    for (const authorization of rejectedTokens) expectPrivate(await call('', { list: true, authorization }), 401);
    expectPrivate(await call('', { list: true, query: { cursor: 'invalid' } }), 400);
    expectPrivate(await call('', { list: true, work: 'invalid' }), 400);
    expect(list).not.toHaveBeenCalled(); expectNoServiceCalls();
  });
});

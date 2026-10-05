import 'reflect-metadata';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyReviewController } from './story-author-body-review.controller';
import { StoryAuthorBodyReviewService } from './story-author-body-review.service';
import { bodyReviewHash, bodyReviewKey, normalizeBodyReviewInput } from './story-author-body-review.policy';
import { STORY_LOCALES } from './story-production.policy';
import { authorBodyReviewPrivacyMiddleware } from './story-author-body-review.privacy';

const user = randomUUID(), work = randomUUID(), reviewId = randomUUID();
const valid = { locale: 'ko', sourceBindingHash: 'a'.repeat(64), expectedProgressRevision: 39,
  expectedReviewId: null, decision: 'approve' as const, styleReviewed: true, charactersReviewed: true, timelineReviewed: true };

describe('private author body review strict input', () => {
  it('rejects client-supplied company delegation instead of manufacturing human review', () => {
    for (const fields of [{ approvalBasis: 'company_delegation' }, { delegationSnapshot: {} },
      { styleReviewed: false, charactersReviewed: false, timelineReviewed: false }]) {
      expect(() => normalizeBodyReviewInput({ ...valid, ...fields } as never)).toThrow(BadRequestException);
    }
  });
  it.each(['/API/V1/ME/CREATOR-STUDIO/STORIES/id/BODY-REVIEW', '/api/me/creator-studio/stories/id/body-review/id/withdraw'])('marks parser errors private for routed case variants %s', url => {
    const response = { setHeader: jest.fn() }, next = jest.fn();
    authorBodyReviewPrivacyMiddleware({ url }, response, next);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
  it.each(STORY_LOCALES)('supports %s without locale fallback', locale => {
    expect(normalizeBodyReviewInput({ ...valid, locale })).toEqual({ ...valid, locale });
  });
  it.each(['locale', 'sourceBindingHash', 'expectedProgressRevision', 'expectedReviewId', 'decision',
    'styleReviewed', 'charactersReviewed', 'timelineReviewed'])('requires explicit %s', field => {
    const body: any = { ...valid }; delete body[field];
    expect(() => normalizeBodyReviewInput(body)).toThrow(BadRequestException);
  });
  it.each([
    { locale: 'fr' }, { sourceBindingHash: null }, { sourceBindingHash: 'A'.repeat(64) },
    { expectedProgressRevision: '39' }, { expectedProgressRevision: 0 }, { expectedProgressRevision: 1.1 },
    { expectedReviewId: 'bad' }, { decision: 'allow' }, { styleReviewed: 'true' },
    { charactersReviewed: false }, { timelineReviewed: false }, { imageGenerationStarted: true },
    { ownerUserId: user }, { sharedReuseAuthorized: true },
  ])('rejects malformed or unauthorized %p', change => {
    expect(() => normalizeBodyReviewInput({ ...valid, ...change } as never)).toThrow(BadRequestException);
  });
  it('rejects unknown/prototype JSON keys, partial approval and unreviewed rejection', () => {
    expect(() => normalizeBodyReviewInput(JSON.parse(JSON.stringify(valid).slice(0, -1) + ',"__proto__":{}}'))).toThrow(BadRequestException);
    expect(() => normalizeBodyReviewInput({ ...valid, decision: 'reject', styleReviewed: false,
      charactersReviewed: false, timelineReviewed: false })).toThrow(BadRequestException);
    expect(normalizeBodyReviewInput({ ...valid, decision: 'reject', charactersReviewed: false, timelineReviewed: false }).decision).toBe('reject');
  });
  it.each(['', 'short', 'a'.repeat(121), 'invalid key', null, ['valid-key']])('rejects unsafe key %p', key => {
    expect(() => bodyReviewKey(key)).toThrow(BadRequestException);
  });
  it('hashes exact decision, attestations, expected head and deterministic object order', () => {
    expect(bodyReviewHash(valid)).toBe(bodyReviewHash(Object.fromEntries(Object.entries(valid).reverse())));
    for (const change of [{ decision: 'reject' }, { expectedReviewId: reviewId }, { expectedProgressRevision: 40 }]) {
      expect(bodyReviewHash({ ...valid, ...change })).not.toBe(bodyReviewHash(valid));
    }
  });
});

describe('private author body review HTTP (isolated JWT, no operating auth)', () => {
  let app: INestApplication, port: number, token: string;
  const service = { current: jest.fn().mockResolvedValue({ readOnly: true }),
    review: jest.fn().mockResolvedValue({ recorded: true }), withdraw: jest.fn().mockResolvedValue({ withdrawn: true }) };
  beforeAll(async () => {
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: user, userId: randomUUID(), tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyReviewController], providers: [
      { provide: StoryAuthorBodyReviewService, useValue: service },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) => where.id === user ? { id: user } : null) } } },
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false }); configureHttpRouting(app);
    app.use(authorBodyReviewPrivacyMiddleware);
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { for (const method of Object.values(service)) method.mockClear(); });
  afterAll(async () => { await app?.close(); });
  function call(method: string, suffix = '', body?: unknown, authenticated = true, key: string | null = 'review-http-key') {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; cache: unknown }>((resolve, reject) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (authenticated) headers.authorization = `Bearer ${token}`;
      if (key !== null) headers['idempotency-key'] = key;
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/body-review${suffix}`, headers }, res => {
        res.resume(); res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'] }));
      }); req.on('error', reject); req.end(payload);
    });
  }
  it('routes GET, decision and withdrawal to authenticated sub, not caller actor', async () => {
    expect((await call('GET', '?locale=ko')).status).toBe(200);
    expect(service.current).toHaveBeenCalledWith(user, work, 'ko');
    expect((await call('POST', '', valid)).status).toBe(201);
    expect(service.review).toHaveBeenCalledWith(user, work, valid, 'review-http-key');
    expect((await call('POST', `/${reviewId}/withdraw`, {})).status).toBe(201);
    expect(service.withdraw).toHaveBeenCalledWith(user, work, reviewId, 'review-http-key');
  });
  it('rejects client-supplied company delegation over the authenticated manual POST', async () => {
    expect(await call('POST', '', { ...valid, approvalBasis: 'company_delegation' }))
      .toEqual({ status: 400, cache: 'private, no-store' });
    expect(service.review).not.toHaveBeenCalled();
  });
  it.each(['GET', 'POST'])('keeps unauthenticated %s private', async method => {
    expect(await call(method, method === 'GET' ? '?locale=ko' : '', method === 'GET' ? undefined : valid, false)).toEqual({ status: 401, cache: 'private, no-store' });
    expect(service.current).not.toHaveBeenCalled(); expect(service.review).not.toHaveBeenCalled();
  });
  it.each(['', '?locale=ko&locale=en', '?locale=ko&ownerUserId=other'])('rejects ambiguous GET %s', async suffix => {
    expect(await call('GET', suffix)).toEqual({ status: 400, cache: 'private, no-store' });
    expect(service.current).not.toHaveBeenCalled();
  });
  it.each([{ ...valid, sharedReuseAuthorized: true }, { ...valid, styleReviewed: false }, [], null])('rejects POST without silently stripping %p', async body => {
    expect(await call('POST', '', body)).toEqual({ status: 400, cache: 'private, no-store' });
    expect(service.review).not.toHaveBeenCalled();
  });
  it('rejects missing key, query-bearing writes and withdrawal with payload', async () => {
    expect((await call('POST', '', valid, true, null)).status).toBe(400);
    expect((await call('POST', '?locale=ko', valid)).status).toBe(400);
    expect((await call('POST', `/${reviewId}/withdraw`, { sharedReuseAuthorized: true })).status).toBe(400);
    expect(service.review).not.toHaveBeenCalled(); expect(service.withdraw).not.toHaveBeenCalled();
  });
});

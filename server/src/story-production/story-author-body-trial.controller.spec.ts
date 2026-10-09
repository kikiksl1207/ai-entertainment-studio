import 'reflect-metadata';
import { BadRequestException, ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
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
import { SelectAuthorBodyTrialChoiceDto, StoryAuthorBodyTrialController } from './story-author-body-trial.controller';
import { STORY_LOCALES } from './story-production.policy';
import { StoryProductionService } from './story-production.service';

const accountId = randomUUID(), unverifiedUserId = randomUUID();
const workId = randomUUID(), choiceId = randomUUID(), approvalId = randomUUID(), progressId = randomUUID();
const validBody = { approvalId, progressId, expectedRevision: 1, locale: 'ko' };
const validKey = 'trial:choice_01.test-key';
const forbiddenFields = [
  'money', 'amount', 'budgetKrw', 'estimatedCostKrw', 'hardBudgetKrw', 'actualCostKrw',
  'owner', 'ownerUserId', 'userId', 'maxAttempts', 'imageGenerationStarted', 'generateImages',
  'imageGenerationEnabled', 'imageUnits', 'unknown',
];
const invalidBodyFields: Array<[string, unknown]> = [
  ['approvalId', undefined], ['approvalId', null], ['approvalId', ''], ['approvalId', 'invalid'],
  ['progressId', undefined], ['progressId', null], ['progressId', ''], ['progressId', 'invalid'],
  ['expectedRevision', undefined], ['expectedRevision', null], ['expectedRevision', 0],
  ['expectedRevision', -1], ['expectedRevision', 1.5], ['expectedRevision', '1'],
  ['expectedRevision', true], ['expectedRevision', {}], ['expectedRevision', []],
  ['locale', undefined], ['locale', null], ['locale', ''], ['locale', 'fr'],
  ['locale', 'KO'], ['locale', ' ko '], ['locale', ['ko']],
];

describe('author body trial choice DTO', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SelectAuthorBodyTrialChoiceDto });

  it.each(STORY_LOCALES)('accepts exactly the four fields and supported locale %s', async locale => {
    const body = { ...validBody, locale };
    const dto = await transform(body);
    expect(dto).toBeInstanceOf(SelectAuthorBodyTrialChoiceDto);
    expect(dto).toEqual(body);
    expect(Object.keys(dto).sort()).toEqual(['approvalId', 'expectedRevision', 'locale', 'progressId']);
  });

  it('accepts uppercase UUIDs and revisions greater than one without coercing fields', async () => {
    const body = { ...validBody, approvalId: approvalId.toUpperCase(), progressId: progressId.toUpperCase(), expectedRevision: 2 };
    expect(await transform(body)).toEqual(body);
  });

  it.each(invalidBodyFields)('rejects invalid or missing %s: %p', async (field, value) => {
    await expect(transform({ ...validBody, [field]: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(forbiddenFields)('rejects caller-controlled or unknown property %s instead of stripping it', async field => {
    await expect(transform({ ...validBody, [field]: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([undefined, null, {}, [], 'not-an-object', 1, false])('rejects an absent or non-DTO body: %p', async body => {
    await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe.each([false, true])('author body trial HTTP (real JWT, synthetic account, global validation=%s)', globalValidation => {
  let app: INestApplication, port: number, token: string;
  let invalidTokens: Record<string, string>;
  const selection = { workId, choiceId, progressId, status: 'queued' };
  const stories = {
    recordAuthorBodyTrialRead: jest.fn(async () => ({})),
    selectAuthorBodyTrialChoice: jest.fn(async (
      _userId: string, _workId: string, _choiceId: string, _body: SelectAuthorBodyTrialChoiceDto, _idempotencyKey: string,
    ) => selection),
  } satisfies ConstructorParameters<typeof StoryAuthorBodyTrialController>[0];
  const findAccount = jest.fn(async ({ where }: { where: { id: string; status: string; deletedAt: unknown } }) =>
    where.id === accountId && where.status === 'active' && where.deletedAt === null
      ? { id: accountId, email: 'synthetic-author@example.invalid' } : null);

  beforeAll(async () => {
    const secret = randomUUID(), jwt = new JwtService();
    const payload = { sub: accountId, userId: unverifiedUserId, tokenType: 'access' };
    token = await jwt.signAsync(payload, { secret, expiresIn: '5m' });
    invalidTokens = {
      malformed: 'invalid',
      expired: await jwt.signAsync(payload, { secret, expiresIn: -60 }),
      wrongSignature: await jwt.signAsync(payload, { secret: randomUUID(), expiresIn: '5m' }),
      refresh: await jwt.signAsync({ ...payload, tokenType: 'refresh' }, { secret, expiresIn: '5m' }),
      inactiveAccount: await jwt.signAsync({ ...payload, sub: unverifiedUserId }, { secret, expiresIn: '5m' }),
    };
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyTrialController], providers: [
      { provide: StoryProductionService, useValue: stories },
      { provide: PrismaService, useValue: { user: { findFirst: findAccount } } },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    if (globalValidation) {
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    }
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => {
    stories.selectAuthorBodyTrialChoice.mockReset().mockResolvedValue(selection);
    findAccount.mockClear();
  });
  afterAll(async () => { await app?.close(); });

  type CallOptions = {
    body?: unknown;
    omitBody?: boolean;
    authorization?: string | null;
    key?: string | string[] | null;
    work?: string;
    choice?: string;
    query?: string;
    method?: string;
  };
  function call(options: CallOptions = {}) {
    const { body = validBody, omitBody = false, authorization = token, key = validKey,
      work = workId, choice = choiceId, query = '', method = 'POST' } = options;
    const payload = omitBody ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; cache?: string; body: unknown }>((resolve, reject) => {
      const headers: Record<string, string | string[]> = { 'content-type': 'application/json' };
      if (authorization !== null) headers.authorization = `Bearer ${authorization}`;
      if (key !== null) headers['idempotency-key'] = key;
      if (payload !== undefined) headers['content-length'] = String(Buffer.byteLength(payload));
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/body-trial/choices/${choice}${query ? `?${query}` : ''}`,
        headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'],
          body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }

  function expectRejected(response: Awaited<ReturnType<typeof call>>, status = 400) {
    expect(response.status).toBe(status);
    expect(response.cache).toBe('private, no-store');
    expect(stories.selectAuthorBodyTrialChoice).not.toHaveBeenCalled();
  }

  it('delegates only verified account identity, route UUIDs, exact DTO and unchanged idempotency key', async () => {
    const response = await call();
    expect(response.status).toBe(201);
    expect(response.cache).toBe('private, no-store');
    expect(response.body).toEqual(selection);
    expect(stories.selectAuthorBodyTrialChoice).toHaveBeenCalledTimes(1);
    expect(stories.selectAuthorBodyTrialChoice).toHaveBeenCalledWith(accountId, workId, choiceId, validBody, validKey);
    expect(stories.selectAuthorBodyTrialChoice.mock.calls[0][3]).toBeInstanceOf(SelectAuthorBodyTrialChoiceDto);
    expect(findAccount).toHaveBeenCalledWith({ where: { id: accountId, status: 'active', deletedAt: null },
      select: { id: true, email: true } });
  });

  it.each(STORY_LOCALES)('accepts supported locale %s over HTTP', async locale => {
    expect((await call({ body: { ...validBody, locale, expectedRevision: 2 } })).status).toBe(201);
    expect(stories.selectAuthorBodyTrialChoice.mock.calls[0][3]).toEqual({ ...validBody, locale, expectedRevision: 2 });
  });

  it.each(['a'.repeat(8), 'A'.repeat(120), validKey])('accepts valid key boundary/alphabet %s', async key => {
    expect((await call({ key })).status).toBe(201);
    expect(stories.selectAuthorBodyTrialChoice.mock.calls[0][4]).toBe(key);
  });

  it('sets no-store before a missing-token error, even when inputs are invalid', async () => {
    expectRejected(await call({ authorization: null, work: 'invalid', body: {}, key: null }), 401);
    expect(findAccount).not.toHaveBeenCalled();
  });

  it.each(['malformed', 'expired', 'wrongSignature', 'refresh', 'inactiveAccount'])('keeps JWT failure private: %s', async kind => {
    expectRejected(await call({ authorization: invalidTokens[kind] }), 401);
  });

  it.each(['owner=other', 'userId=other', 'approvalId=other', 'progressId=other', 'locale=ko',
    'money=1', 'maxAttempts=1', 'generateImages=true', 'x=1&x=2', 'unknown',
    '__proto__[owner]=other', 'constructor[prototype][owner]=other'])('rejects every query parameter: %s', async query => {
    expectRejected(await call({ query }));
  });

  it.each([...forbiddenFields, 'constructor', '__proto__'])('rejects unknown body property %s over HTTP', async field => {
    expectRejected(await call({ body: { ...validBody, [field]: true } }));
  });

  it.each(invalidBodyFields)('rejects invalid or missing DTO field %s: %p over HTTP', async (field, value) => {
    expectRejected(await call({ body: { ...validBody, [field]: value } }));
  });

  it('rejects a missing body', async () => { expectRejected(await call({ omitBody: true })); });

  it.each([{}, [], [validBody]])('rejects an empty or non-object body: %p over HTTP', async body => {
    expectRejected(await call({ body }));
  });

  it.each(['work', 'choice'] as const)('rejects invalid route UUID %s', async field => {
    expectRejected(await call({ [field]: 'invalid' }));
  });

  it.each([null, '', 'a'.repeat(7), 'a'.repeat(121), 'trial key', 'trial/key', 'trial,key',
    'trial+key', 'trial=key', 'trial\u00e9key', ['trial-key-1', 'trial-key-2']])('rejects missing, empty or malformed key: %p', async key => {
    expectRejected(await call({ key }));
  });

  it.each(['GET', 'PUT', 'PATCH', 'DELETE'])('has no write route for %s', async method => {
    const response = await call({ method });
    expect(response.status).toBe(404);
    expect(stories.selectAuthorBodyTrialChoice).not.toHaveBeenCalled();
  });

  it.each([
    new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_NOT_FOUND' }),
    new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_REVISION_CONFLICT' }),
    new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_PROFILE_CONTEXT_TOO_LARGE', generationStarted: false }),
  ])('preserves private service errors without retrying or changing inputs: %p', async error => {
    stories.selectAuthorBodyTrialChoice.mockRejectedValueOnce(error);
    const response = await call();
    expect(response.status).toBe(error.getStatus());
    expect(response.cache).toBe('private, no-store');
    // HTTP exposes the safe error code, not the service's internal admission flags.
    expect(response.body).toMatchObject({ error: { code: (error.getResponse() as { code: string }).code } });
    expect(JSON.stringify(response.body)).not.toContain('generationStarted');
    expect(stories.selectAuthorBodyTrialChoice).toHaveBeenCalledTimes(1);
    expect(stories.selectAuthorBodyTrialChoice).toHaveBeenCalledWith(accountId, workId, choiceId, validBody, validKey);
  });
});

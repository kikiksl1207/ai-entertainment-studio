import 'reflect-metadata';
import { BadRequestException, ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { request } from 'http';
import { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyTrialCostController } from './story-author-body-trial-cost.controller';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';

const owner = randomUUID(), outsider = randomUUID(), workId = randomUUID();
const decimal = (value: string) => new Prisma.Decimal(value);

function fixture() {
  const state = { work: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false },
    continuations: [] as any[], ledger: [] as any[], customRequests: [] as any[], sharedResults: [] as any[], reusedScenes: [] as any[] };
  const writes = Object.fromEntries(['create', 'update', 'updateMany', 'delete', 'upsert'].map(name =>
    [name, jest.fn(() => { throw new Error('Unexpected write'); })]));
  const db = {
    storyWork: { ...writes, findFirst: jest.fn(async ({ where }) => state.work &&
      Object.entries(where).every(([key, value]) => state.work[key as keyof typeof state.work] === value) ? state.work : null) },
    storyAiContinuation: { ...writes, findMany: jest.fn(async (query: { where: any }) =>
      query.where.requestKind === 'custom_choice' ? state.customRequests : state.continuations) },
    storyAiUsageLedger: { ...writes, findMany: jest.fn(async (_query: { where: any }) => state.ledger) },
    storyAiReusableResult: { ...writes, findMany: jest.fn(async (_query: { where: any }) => state.sharedResults) },
    storyAiGeneratedScene: { ...writes, findMany: jest.fn(async (_query: { where: any }) => state.reusedScenes) },
    $executeRaw: jest.fn(async (sql: { strings: string[] }) => {
      if (sql.strings.join('') !== 'SET TRANSACTION READ ONLY') throw new Error('Unexpected SQL');
      return 0;
    }),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => callback(db)) };
  const service = new StoryAuthorBodyTrialCostService(prisma as never);
  const complete = () => {
    const row = { id: randomUUID(), userId: owner, workId, requestKind: 'recommended_choice', status: 'completed',
      attemptCount: 1, maxAttempts: 3, dispatchStartedAt: new Date('2026-10-02T00:00:00Z'),
      estimatedCostKrw: decimal('0.125'), hardBudgetKrw: decimal('1'), actualCostKrw: decimal('0.1'),
      contextReferences: { privatePayload: 'NOT FOR RESPONSE' }, sharedResultId: null, resultGeneratedSceneId: randomUUID(),
      releaseId: randomUUID(), progressId: randomUUID() };
    state.continuations.push(row);
    const reserved = { id: randomUUID(), continuationId: row.id, userId: owner, workId,
      eventKind: 'recommended_route_request', status: 'reserved', provenance: 'ai_generated',
      estimatedCostKrw: row.estimatedCostKrw, actualCostKrw: null, inputTokens: 20, outputTokens: 10,
      cachedInputTokens: 0, imageUnits: 0 };
    state.ledger.push(reserved, { ...reserved, id: randomUUID(), eventKind: 'new_route_completed',
      status: 'completed', actualCostKrw: row.actualCostKrw });
    return row;
  };
  return { state, db, prisma, service, writes, complete };
}

describe('author body trial cost service (synthetic records, no providers)', () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { for (const write of Object.values(f.writes)) expect(write).not.toHaveBeenCalled(); });

  it('reads exact decimals without granting generation or exposing private record details', async () => {
    f.complete();
    const before = JSON.stringify(f.state);
    const response = await f.service.current(owner, workId);
    expect(response).toMatchObject({ contract: 'story-author-body-trial-cost-v1', workId,
      readOnly: true, generationAuthorized: false, imageGenerationStarted: false,
      knownActualCostKrw: '0.100000', reservedMaximumCostKrw: '0.000000',
      requestCount: 1, unknownCostCount: 0, evidenceReadyForBudgetCheck: true });
    expect(JSON.stringify(response)).not.toMatch(/NOT FOR RESPONSE|contextReferences|releaseId|progressId|continuationId|userId/);
    expect(JSON.stringify(f.state)).toBe(before);
    expect(await f.service.current(owner, workId)).toEqual(response);
    expect(f.db.$executeRaw).toHaveBeenCalledTimes(2);
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('does not scope cost to a current release, route, language or a caller-provided start time', async () => {
    f.complete(); f.complete();
    const response = await f.service.current(owner, workId);
    expect(response.knownActualCostKrw).toBe('0.200000');
    expect(f.db.storyAiContinuation.findMany.mock.calls[0][0]).toMatchObject({
      where: { userId: owner, workId, requestKind: 'recommended_choice' }, take: 1001,
    });
    expect(Object.keys(f.db.storyAiContinuation.findMany.mock.calls[0][0].where)).toEqual(['userId', 'workId', 'requestKind']);
    expect(f.db.storyAiUsageLedger.findMany.mock.calls[0][0].where).toEqual({ userId: owner, workId });
  });

  it('supports PostgreSQL-equivalent uppercase UUIDs', async () => {
    expect(await f.service.current(owner.toUpperCase(), workId.toUpperCase())).toEqual(await f.service.current(owner, workId));
  });

  it.each([[owner, 'invalid'], ['invalid', workId]])('rejects invalid scope before DB access', async (user, work) => {
    await expect(f.service.current(user, work)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'unpublished', 'fixture'])('never reads another author or unavailable work: %s', async mode => {
    if (mode === 'foreign') f.state.work.ownerUserId = outsider;
    if (mode === 'unpublished') f.state.work.status = 'draft';
    if (mode === 'fixture') f.state.work.fixtureSource = true;
    await expect(f.service.current(owner, workId)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.db.storyAiContinuation.findMany).not.toHaveBeenCalled();
    expect(f.db.storyAiUsageLedger.findMany).not.toHaveBeenCalled();
  });

  it('keeps a failed null-cost record visibly unknown instead of certifying zero cost', async () => {
    const row = f.complete(); row.status = 'failed'; row.actualCostKrw = null as any;
    f.state.ledger[1].status = 'failed'; f.state.ledger[1].eventKind = 'new_route_failed';
    f.state.ledger[1].actualCostKrw = null;
    expect(await f.service.current(owner, workId)).toMatchObject({ unknownCostCount: 1,
      knownActualCostKrw: '0.000000', evidenceReadyForBudgetCheck: false, generationAuthorized: false });
  });

  it.each(['valid', 'wrong-code', 'wrong-id', 'later-attempt', 'fenced', 'nonzero-usage', 'missing-proof'])
    ('recognizes only internally confirmed, uncharged first-attempt preflight rejection: %s', async mode => {
      const row = f.complete() as any;
      row.status = 'failed'; row.actualCostKrw = decimal('0'); row.dispatchStartedAt = null;
      row.failureCode = 'provider_input_bound_exceeded';
      row.contextReferences = { noProviderDispatchEvidence: {
        kind: 'provider_preflight_rejected_before_dispatch_v1', continuationId: row.id,
        attemptCount: 1, failureCode: row.failureCode } };
      const ledger = f.state.ledger[1];
      Object.assign(ledger, { status: 'failed', eventKind: 'new_route_failed', actualCostKrw: decimal('0'),
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0 });
      if (mode === 'wrong-code') row.contextReferences.noProviderDispatchEvidence.failureCode = 'other';
      if (mode === 'wrong-id') row.contextReferences.noProviderDispatchEvidence.continuationId = randomUUID();
      if (mode === 'later-attempt') row.attemptCount = 2;
      if (mode === 'fenced') row.dispatchStartedAt = new Date();
      if (mode === 'nonzero-usage') ledger.outputTokens = 1;
      if (mode === 'missing-proof') row.contextReferences = {};
      const response = await f.service.current(owner, workId);
      // A fenced, measured zero-cost outcome is classified normally, not by this proof.
      expect(response.unknownCostCount).toBe(mode === 'valid' || mode === 'fenced' ? 0 : 1);
      const snapshot = await f.service.snapshotTx(f.db as never, owner, workId);
      expect(snapshot.continuations[0].confirmedNoProviderDispatch).toBe(
        !['wrong-code', 'wrong-id', 'missing-proof'].includes(mode));
    });

  it.each(['continuations', 'ledger', 'orphan', 'foreign-row', 'contradiction'])('rejects incomplete or contradictory evidence: %s', async mode => {
    const row = f.complete();
    if (mode === 'continuations') f.state.continuations = Array.from({ length: 1001 }, () => row);
    if (mode === 'ledger') f.state.ledger = Array.from({ length: 6001 }, () => f.state.ledger[0]);
    if (mode === 'orphan') f.state.ledger[0].continuationId = randomUUID();
    if (mode === 'foreign-row') row.userId = outsider;
    if (mode === 'contradiction') f.state.ledger[1].actualCostKrw = decimal('0.2');
    await expect(f.service.current(owner, workId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not fall back to sample or empty totals after a DB failure', async () => {
    f.db.storyAiContinuation.findMany.mockRejectedValueOnce(new Error('Synthetic database failure'));
    await expect(f.service.current(owner, workId)).rejects.toThrow('Synthetic database failure');
    expect(f.db.storyAiUsageLedger.findMany).not.toHaveBeenCalled();
  });

  it('rejects an orphan terminal ledger even if both its request and reservation are missing', async () => {
    f.complete();
    f.state.continuations = []; f.state.ledger = [f.state.ledger[1]];
    await expect(f.service.current(owner, workId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('excludes a confirmed separate custom request, but never a guessed custom or foreign request', async () => {
    f.complete();
    const customId = randomUUID();
    f.state.customRequests.push({ id: customId, userId: owner, workId, requestKind: 'custom_choice' });
    f.state.ledger.push({ ...f.state.ledger[1], id: randomUUID(), continuationId: customId });
    expect(await f.service.current(owner, workId)).toMatchObject({ requestCount: 1, knownActualCostKrw: '0.100000' });
    f.state.customRequests[0].userId = outsider;
    await expect(f.service.current(owner, workId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires existing same-scope checksum-matched scene and result records for zero-cost reuse', async () => {
    const row = f.complete();
    row.attemptCount = 0; row.dispatchStartedAt = null as any;
    row.actualCostKrw = decimal('0'); row.estimatedCostKrw = decimal('0');
    row.contextReferences = { sharedResultReused: true } as any; row.sharedResultId = randomUUID() as any;
    f.state.ledger = [{ ...f.state.ledger[1], eventKind: 'shared_route_reused', provenance: 'ai_reused',
      estimatedCostKrw: decimal('0'), actualCostKrw: decimal('0'), inputTokens: 0, outputTokens: 0 }];
    expect(await f.service.current(owner, workId)).toMatchObject({ verifiedSharedReuseCount: 0, unknownCostCount: 1 });
    const shared = { id: row.sharedResultId, workId, releaseId: row.releaseId, resultChecksum: 'a'.repeat(64) };
    const scene = { id: row.resultGeneratedSceneId, continuationId: row.id, userId: owner, workId,
      releaseId: row.releaseId, progressId: row.progressId, sharedResultId: shared.id,
      resultChecksum: shared.resultChecksum, status: 'ready', provenance: 'ai_reused' };
    f.state.sharedResults.push(shared); f.state.reusedScenes.push(scene);
    expect(await f.service.current(owner, workId)).toMatchObject({ verifiedSharedReuseCount: 1, unknownCostCount: 0 });
    for (const [key, invalid] of [['userId', outsider], ['progressId', randomUUID()], ['releaseId', randomUUID()],
      ['continuationId', randomUUID()], ['resultChecksum', 'b'.repeat(64)], ['status', 'hidden']] as const) {
      const before = (scene as any)[key]; (scene as any)[key] = invalid;
      expect(await f.service.current(owner, workId)).toMatchObject({ verifiedSharedReuseCount: 0, unknownCostCount: 1 });
      (scene as any)[key] = before;
    }
  });
});

describe('author body trial cost HTTP (real JWT and service, synthetic DB)', () => {
  let app: INestApplication, port: number, token: string, otherToken: string;
  let f: ReturnType<typeof fixture>;
  beforeAll(async () => {
    f = fixture(); f.complete();
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyTrialCostController], providers: [
      { provide: StoryAuthorBodyTrialCostService, useValue: f.service },
      { provide: PrismaService, useValue: { user: { findFirst: jest.fn(async ({ where }) =>
        [owner, outsider].includes(where.id) && where.status === 'active' && where.deletedAt === null ? { id: where.id } : null) } } },
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) }, JwtAuthGuard,
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); });

  function call(query = '', authorization: string | null = token, work: string = workId, method = 'GET') {
    return new Promise<{ status: number; cache?: string; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${work}/body-trial-cost${query ? `?${query}` : ''}`,
        headers: authorization ? { authorization: `Bearer ${authorization}` } : {} }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'], body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  it('returns costs only, using verified JWT subject, with no-store and no writes', async () => {
    const response = await call();
    expect(response.status).toBe(200); expect(response.cache).toBe('private, no-store');
    expect(response.body).toMatchObject({ knownActualCostKrw: '0.100000', generationAuthorized: false });
    for (const write of Object.values(f.writes)) expect(write).not.toHaveBeenCalled();
  });

  it.each([null, 'invalid'])('keeps authentication failures private: %s', async authorization => {
    const response = await call('', authorization);
    expect(response.status).toBe(401); expect(response.cache).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('knownActualCostKrw');
  });

  it('rejects another author even with a valid token', async () => {
    const response = await call('', otherToken);
    expect(response.status).toBe(404); expect(response.cache).toBe('private, no-store');
  });

  it.each(['userId=other', 'releaseId=other', 'budgetKrw=999999', 'startAt=now', 'locale=ko', 'x=1&x=2'])('rejects caller-expanded cost scope: %s', async query => {
    const response = await call(query);
    expect(response.status).toBe(400); expect(response.cache).toBe('private, no-store');
  });

  it('validates IDs and has no selection or generation POST route', async () => {
    expect((await call('', token, 'invalid')).status).toBe(400);
    expect((await call('', token, workId, 'POST')).status).toBe(404);
  });
});

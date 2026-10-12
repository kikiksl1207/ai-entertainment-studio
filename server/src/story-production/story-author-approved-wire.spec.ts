import 'reflect-metadata';
import { BadRequestException, ConflictException, INestApplication, NotFoundException, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { request } from 'http';
import type { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { StoryAuthorApprovedWireQueryDto } from './dto/story-author-approved-wire.dto';
import { StoryAuthorApprovedWireController } from './story-author-approved-wire.controller';
import { StoryAuthorApprovedWireService } from './story-author-approved-wire.service';
import * as wirePolicy from './story-approved-profile-wire-metric.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1), outsider = uuid(2), workId = 'abcdefab-0000-4000-8000-000000000003';
const manuscriptId = uuid(4), analysisId = uuid(5), profileId = uuid(6);
const PRIVATE = 'SYNTHETIC_PRIVATE_WIRE_SOURCE';
const input = { measurement: 'gzip-base64-v1' as const };
type Row = Record<string, any>;
const clone = (value: any): any => value instanceof Date ? new Date(value.getTime())
  : Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;

function fixture(big = false) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [],
      value: key === 'writing_style' ? { summary: PRIVATE, unknown: { nullable: null, flag: false, number: 0 },
        observations: big ? Array.from({ length: 5 }, (_, i) => ({ title: `Rule ${i}`, detail: PRIVATE.repeat(150) }))
          : [{ title: 'Rule', detail: '  Entire rule\nTAIL  ' }] } : { summary: PRIVATE } }))
  });
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, version: 1, locale: 'ko', contentHash: 'a'.repeat(64) };
  const analysis = { id: analysisId, workId, manuscriptVersionId: manuscriptId, status: 'completed', pipeline: SEMANTIC_PIPELINE,
    analysisVersion: 2, sourceContentHash: manuscript.contentHash, configHash: 'b'.repeat(64) };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId, manuscriptVersionId: manuscriptId,
    contentHash: manuscript.contentHash, analysisJobId: analysisId, analysisVersion: analysis.analysisVersion,
    analysisConfigHash: analysis.configHash })).digest('hex');
  const profile = { id: profileId, workId, ownerUserId: owner, manuscriptVersionId: manuscriptId, analysisJobId: analysisId,
    status: 'approved', profileVersion: 1, reviewRevision: 1, sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: owner,
    approvedAt: new Date('2026-10-12T00:00:00Z') };
  const state = { works: [{ id: workId, ownerUserId: owner, fixtureSource: false }], manuscripts: [manuscript], analyses: [analysis], profiles: [profile] };
  let active = false, readOnly = false, transactionSettled = false;
  const traces: string[] = [], writes: jest.Mock[] = [];
  let snapshot: typeof state | null = null;
  const read = (name: string, rows: () => Row[], unique = false) => jest.fn(async (query: Row) => {
    if (!active || !readOnly || !snapshot) throw new Error('Synthetic read outside the completed snapshot');
    traces.push(name);
    const matched = rows().filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
    for (const [key, value] of Object.entries(query.orderBy || {})) matched.sort((a, b) => (a[key] - b[key]) * (value === 'desc' ? -1 : 1));
    if (unique && matched.length > 1) throw new Error('Synthetic duplicate unique row');
    const row = matched[0];
    return row ? clone(query.select ? Object.fromEntries(Object.keys(query.select).filter(key => query.select[key]).map(key => [key, row[key]])) : row) : null;
  });
  const model = (methods: Row) => ({ ...methods, ...Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert'].map(name => {
    const blocked = jest.fn(() => { throw new Error('Synthetic write forbidden'); }); writes.push(blocked); return [name, blocked];
  })) });
  const tx = {
    $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
      expect(active).toBe(true); expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY'); readOnly = true; traces.push('READ ONLY'); return 0;
    }),
    storyWork: model({ findFirst: read('work', () => snapshot!.works) }),
    storyManuscriptVersion: model({ findFirst: read('manuscript', () => snapshot!.manuscripts) }),
    storyAnalysisJob: model({ findFirst: read('analysis', () => snapshot!.analyses) }),
    storyWorkGenerationProfile: model({ findFirst: read('profile', () => snapshot!.profiles), findUnique: read('profile-by-pin', () => snapshot!.profiles, true) })
  };
  const hooks: { afterCommit?: () => void } = {};
  const prisma = {
    $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, options: Row) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      snapshot = clone(state); active = true; readOnly = false; transactionSettled = false;
      try { const result = await callback(tx); active = false; transactionSettled = true; traces.push('COMMIT'); hooks.afterCommit?.(); return result; }
      catch (error) { active = false; traces.push('ROLLBACK'); throw error; }
    }),
    user: { findFirst: jest.fn(async (query: Row) => query.where.status === 'active' && query.where.deletedAt === null
      && [owner, outsider].includes(query.where.id) ? { id: query.where.id, email: 'synthetic@fixture.invalid' } : null) }
  };
  return { state, tx, prisma, traces, writes, hooks, service: new StoryAuthorApprovedWireService(prisma as never),
    transactionSettled: () => transactionSettled, active: () => active,
    unchanged(before: string) { expect(JSON.stringify(state)).toBe(before); for (const write of writes) expect(write).not.toHaveBeenCalled(); } };
}

afterEach(() => jest.restoreAllMocks());

describe('owner approved wire numeric snapshot (synthetic DB fixture)', () => {
  it('measures the verified snapshot only after transaction success without reads or outputting private values', async () => {
    const f = fixture(), before = JSON.stringify(f.state), measure = wirePolicy.measureStoryApprovedProfileWireMetric;
    const spy = jest.spyOn(wirePolicy, 'measureStoryApprovedProfileWireMetric').mockImplementation((...args) => {
      expect(f.active()).toBe(false); expect(f.transactionSettled()).toBe(true); expect(f.traces.at(-1)).toBe('COMMIT'); return measure(...args);
    });
    const result = await f.service.inspect(owner, workId.toUpperCase(), input);
    expect(spy).toHaveBeenCalledTimes(1); expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ contract: 'story-author-approved-wire-v1', sourceScope: 'latest_owner_approved_profile_transport_only',
      locale: 'ko', manuscriptVersion: 1, analysisVersion: 2, profileVersion: 1, reviewRevision: 1,
      readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
      legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated', fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192 });
    expect(result.diagnostic).toMatchObject({ byteCap: 16384, normalizedApprovalPreserved: true, byteExactRoundTrip: true,
      modelInputFit: 'unmeasured', semanticQualityVerified: false, dispatchAuthorized: false });
    const json = JSON.stringify(result);
    for (const privateValue of [PRIVATE, owner, workId, profileId, f.state.profiles[0].sourceFingerprint, f.state.profiles[0].approvedFingerprint]) expect(json).not.toContain(privateValue);
    expect(Object.isFrozen(result)).toBe(true); f.unchanged(before);
  });

  it('a compact wire candidate does not grant raw view fit, model readiness or generation', async () => {
    const f = fixture(true), before = JSON.stringify(f.state), result = await f.service.inspect(owner, workId, input);
    expect(result.diagnostic.wholeCandidateViewBytes).toBeGreaterThan(16384);
    expect(result.diagnostic.candidateViewFits).toBe(false);
    expect(result.diagnostic.wholeWireEnvelopeBytes).toBeLessThan(16384);
    expect(result.diagnostic.modelInputFit).toBe('unmeasured'); expect(result.dispatchAuthorized).toBe(false); f.unchanged(before);
  });

  it.each([
    ['bad-user', { ...input }], [owner, { measurement: 'other' }], [owner, {}], [owner, { ...input, locale: 'ko' }],
  ])('invalid input is rejected before reading data (%s)', async (userId, query) => {
    const f = fixture(); await expect(f.service.inspect(userId, workId, query as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['outsider', 'fixture', 'missing'])('does not reveal another, fixture or absent work (%s)', async kind => {
    const f = fixture(), before = JSON.stringify(f.state);
    if (kind === 'fixture') f.state.works[0].fixtureSource = true;
    if (kind === 'missing') f.state.works.length = 0;
    await expect(f.service.inspect(kind === 'outsider' ? outsider : owner, workId, input)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.traces).not.toContain('manuscript'); expect(f.traces).not.toContain('profile');
    for (const write of f.writes) expect(write).not.toHaveBeenCalled();
    if (kind === 'outsider') f.unchanged(before);
  });

  it.each(['needs_review', 'rejected', 'withdrawn', 'superseded'])('does not override external approval status %s', async status => {
    const f = fixture(); f.state.profiles[0].status = status; const before = JSON.stringify(f.state);
    await expect(f.service.inspect(owner, workId, input)).rejects.toBeInstanceOf(ConflictException); f.unchanged(before);
  });

  it.each(['manuscript', 'analysis', 'fingerprint', 'reviewer', 'settings'])('stale or changed source fails closed (%s)', async kind => {
    const f = fixture();
    if (kind === 'manuscript') f.state.manuscripts.push({ ...f.state.manuscripts[0], id: uuid(10), version: 2 });
    if (kind === 'analysis') f.state.analyses[0].sourceContentHash = 'c'.repeat(64);
    if (kind === 'fingerprint') f.state.profiles[0].sourceFingerprint = 'c'.repeat(64);
    if (kind === 'reviewer') f.state.profiles[0].approvedByUserId = outsider;
    if (kind === 'settings') (f.state.profiles[0] as Row).approvedSettings = { ...f.state.profiles[0].approvedSettings, sections: [] };
    const before = JSON.stringify(f.state);
    await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({ status: expect.any(Number) }); f.unchanged(before);
  });

  it('later changes cannot make CPU reread or mix snapshot versions', async () => {
    const f = fixture(); f.hooks.afterCommit = () => { f.state.profiles[0].reviewRevision = 2; f.state.profiles[0].status = 'withdrawn'; };
    const result = await f.service.inspect(owner, workId, input);
    expect(result.reviewRevision).toBe(1); expect(result.diagnostic.byteExactRoundTrip).toBe(true);
    expect(f.traces.at(-1)).toBe('COMMIT'); for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  });

  it('normalizes foreign errors without private message/cause leakage', async () => {
    const f = fixture(); f.tx.storyWork.findFirst.mockRejectedValueOnce(new Error(PRIVATE));
    try { await f.service.inspect(owner, workId, input); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(ServiceUnavailableException); expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(PRIVATE); }
  });

  it('requires explicit measurement version with no extra query fields', async () => {
    expect(await validate(plainToInstance(StoryAuthorApprovedWireQueryDto, input))).toHaveLength(0);
    for (const measurement of [undefined, null, 'gzip', '', ['gzip-base64-v1']]) {
      expect((await validate(plainToInstance(StoryAuthorApprovedWireQueryDto, { measurement }))).length).toBeGreaterThan(0);
    }
  });
});

describe('approved wire private read HTTP boundary (mock JWT verification, no token mint)', () => {
  let app: INestApplication, port: number, f: ReturnType<typeof fixture>;
  beforeAll(async () => {
    f = fixture();
    const module = await Test.createTestingModule({ controllers: [StoryAuthorApprovedWireController], providers: [JwtAuthGuard,
      { provide: StoryAuthorApprovedWireService, useValue: f.service }, { provide: PrismaService, useValue: f.prisma },
      { provide: ConfigService, useValue: { getOrThrow: () => 'synthetic-mock-only' } },
      { provide: JwtService, useValue: { verifyAsync: async (token: string) => {
        if (!['synthetic-owner', 'synthetic-outsider'].includes(token)) throw new Error('Synthetic invalid bearer');
        return { sub: token === 'synthetic-owner' ? owner : outsider, tokenType: 'access' };
      } } }
    ] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); });
  const call = (query = 'measurement=gzip-base64-v1', token?: string, method = 'GET') => new Promise<{ status: number; cache?: string; vary?: string; cookie?: string | string[]; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: `/api/v1/me/creator-studio/stories/${workId}/generation-profile/approved-wire?${query}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {} }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', part => { body += part; });
      response.on('end', () => resolve({ status: response.statusCode!, cache: response.headers['cache-control'], vary: response.headers.vary, cookie: response.headers['set-cookie'], body }));
    }); req.on('error', reject); req.end();
  });
  it.each(['GET', 'HEAD'])('anonymous and malformed bearer %s stay private/no-store', async method => {
    for (const token of [undefined, 'invalid']) {
      const result = await call(undefined, token, method);
      expect(result.status).toBe(401); expect(result.cache).toBe('private, no-store'); expect(result.vary).toContain('Authorization'); expect(result.cookie).toBeUndefined();
      if (method === 'HEAD') expect(result.body).toBe(''); expect(result.body).not.toContain(PRIVATE);
    }
  });
  it('authenticated owner receives only numeric metrics and outsider stays hidden', async () => {
    const result = await call(undefined, 'synthetic-owner'); expect(result.status).toBe(200); expect(result.cache).toBe('private, no-store');
    expect(JSON.parse(result.body).semanticQualityVerified).toBe(false); expect(result.body).not.toContain(PRIVATE);
    const denied = await call(undefined, 'synthetic-outsider'); expect(denied.status).toBe(404); expect(denied.cache).toBe('private, no-store');
  });
  it.each(['', 'measurement=other', 'measurement=gzip-base64-v1&locale=ko'])('invalid authenticated query %s performs no measurement', async query => {
    const before = f.prisma.$transaction.mock.calls.length, result = await call(query, 'synthetic-owner');
    expect(result.status).toBe(400); expect(result.cache).toBe('private, no-store'); expect(f.prisma.$transaction.mock.calls.length).toBe(before);
  });
});

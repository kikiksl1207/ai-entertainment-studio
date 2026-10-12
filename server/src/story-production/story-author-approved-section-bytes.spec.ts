import 'reflect-metadata';
import { BadRequestException, INestApplication, ValidationPipe } from '@nestjs/common';
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
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryAuthorApprovedSectionBytesQueryDto } from './dto/story-author-approved-section-bytes.dto';
import { StoryAuthorApprovedSectionBytesController } from './story-author-approved-section-bytes.controller';
import { StoryAuthorApprovedSectionBytesService } from './story-author-approved-section-bytes.service';
import { profileObservationSource } from './story-continuation-context.policy';
import * as deliveryPolicy from './story-approved-profile-delivery.policy';
import * as sectionPolicy from './story-approved-profile-section-byte-metric.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1), outsider = uuid(2), inactive = uuid(20);
const workId = 'abcdefab-0000-4000-8000-000000000003';
const manuscriptId = uuid(4), analysisId = uuid(5), profileId = uuid(6);
const PRIVATE = 'SYNTHETIC_PRIVATE_SECTION_SOURCE';
const input = { measurement: 'json-utf8-v1' as const };
type Row = Record<string, any>;
const clone = (value: any): any => value instanceof Date ? new Date(value.getTime())
  : Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;

function fixture(big = false) {
  const sourceRef = 'analysis:' + analysisId;
  const observation = { title: 'Synthetic rule.', detail: '  Complete rule\nTAIL  ', sourceRef };
  const proof = { sourceType: 'manuscript', sourceRef: sourceRef + ':part-a:4', summary: PRIVATE };
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'narrative_devices' ? 'unknown' : key === 'visual_cast' ? 'removed' : 'accepted',
      evidence: [proof, proof],
      value: key === 'writing_style'
        ? { summary: PRIVATE, unknown: [null, false, 0, '  kept  '], observations: [observation, observation],
            active: false, scope: 'reader_history' }
        : { summary: PRIVATE, unknownPadding: big ? 'x'.repeat(4000) : '' },
    })).reverse(),
  });
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, version: 1, locale: 'ko', contentHash: 'a'.repeat(64) };
  const analysis = { id: analysisId, workId, manuscriptVersionId: manuscriptId, status: 'completed', pipeline: SEMANTIC_PIPELINE,
    analysisVersion: 2, sourceContentHash: manuscript.contentHash, configHash: 'b'.repeat(64) };
  const sourceFingerprint = createHash('sha256').update(stableJson({
    workId, manuscriptVersionId: manuscriptId, contentHash: manuscript.contentHash, analysisJobId: analysisId,
    analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
  })).digest('hex');
  const profile = { id: profileId, workId, ownerUserId: owner, manuscriptVersionId: manuscriptId, analysisJobId: analysisId,
    status: 'approved', profileVersion: 1, reviewRevision: 1, sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: owner,
    approvedAt: new Date('2026-10-13T00:00:00Z'), createdAt: new Date('2026-10-12T00:00:00Z') };
  const state = { works: [{ id: workId, ownerUserId: owner, fixtureSource: false }], manuscripts: [manuscript], analyses: [analysis], profiles: [profile] };
  let active = false, readOnly = false, transactionSettled = false;
  let snapshot: typeof state | null = null;
  const traces: string[] = [], writes: jest.Mock[] = [];
  const read = (name: string, rows: () => Row[], unique = false) => jest.fn(async (query: Row) => {
    if (!active || !readOnly || !snapshot) throw new Error('Synthetic read outside RO snapshot');
    traces.push(name);
    const matched = rows().filter(row => Object.entries(query.where || {}).every(([key, value]) => row[key] === value));
    for (const [key, value] of Object.entries(query.orderBy || {})) {
      matched.sort((a, b) => (a[key] - b[key]) * (value === 'desc' ? -1 : 1));
    }
    if (unique && matched.length > 1) throw new Error('Synthetic duplicate unique row');
    const row = matched[0];
    return row ? clone(query.select
      ? Object.fromEntries(Object.keys(query.select).filter(key => query.select[key]).map(key => [key, row[key]])) : row) : null;
  });
  const model = (methods: Row) => ({ ...methods, ...Object.fromEntries([
    'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
  ].map(name => {
    const blocked = jest.fn(() => { throw new Error('Synthetic write forbidden'); });
    writes.push(blocked); return [name, blocked];
  })) });
  const tx = {
    $executeRaw: jest.fn(async (sql: Prisma.Sql) => {
      expect(active).toBe(true); expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY');
      readOnly = true; traces.push('READ ONLY'); return 0;
    }),
    storyWork: model({ findFirst: read('work', () => snapshot!.works) }),
    storyManuscriptVersion: model({ findFirst: read('manuscript', () => snapshot!.manuscripts) }),
    storyAnalysisJob: model({ findFirst: read('analysis', () => snapshot!.analyses) }),
    storyWorkGenerationProfile: model({
      findFirst: read('profile', () => snapshot!.profiles), findUnique: read('profile-by-pin', () => snapshot!.profiles, true),
    }),
  };
  const hooks: { afterCommit?: () => void } = {};
  const prisma = {
    $transaction: jest.fn(async (callback: (db: typeof tx) => Promise<unknown>, options: Row) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      snapshot = clone(state); active = true; readOnly = false; transactionSettled = false;
      try {
        const result = await callback(tx); active = false; transactionSettled = true; traces.push('COMMIT');
        hooks.afterCommit?.(); return result;
      } catch (error) { active = false; traces.push('ROLLBACK'); throw error; }
    }),
    user: { findFirst: jest.fn(async (query: Row) => query.where.status === 'active' && query.where.deletedAt === null
      && [owner, outsider].includes(query.where.id) ? { id: query.where.id, email: 'synthetic@fixture.invalid' } : null) },
  };
  return { state, tx, prisma, traces, writes, hooks,
    service: new StoryAuthorApprovedSectionBytesService(prisma as never),
    transactionSettled: () => transactionSettled, active: () => active,
    unchanged(before: string) {
      expect(JSON.stringify(state)).toBe(before);
      for (const write of writes) expect(write).not.toHaveBeenCalled();
    },
  };
}

afterEach(() => jest.restoreAllMocks());

describe('owner section bytes snapshot (synthetic DB, not native SQL)', () => {
  it('runs factory and exact metric only after successful RO/RR with the selected JSON row', async () => {
    const f = fixture(), before = JSON.stringify(f.state);
    const build = deliveryPolicy.buildStoryApprovedProfileDelivery, measure = sectionPolicy.measureStoryApprovedProfileSectionByteMetric;
    const factory = jest.spyOn(deliveryPolicy, 'buildStoryApprovedProfileDelivery').mockImplementation((...args) => {
      expect(f.active()).toBe(false); expect(f.transactionSettled()).toBe(true); expect(f.traces.at(-1)).toBe('COMMIT');
      expect(Object.keys(args[0]).sort()).toEqual(['id', 'workId', 'ownerUserId', 'status', 'profileVersion',
        'reviewRevision', 'sourceFingerprint', 'approvedSettings', 'approvedFingerprint'].sort());
      expect(Object.values(args[0]).some(value => value instanceof Date)).toBe(false);
      return build(...args);
    });
    const numeric = jest.spyOn(sectionPolicy, 'measureStoryApprovedProfileSectionByteMetric').mockImplementation((...args) => {
      expect(f.active()).toBe(false); expect(f.transactionSettled()).toBe(true); expect(f.traces.at(-1)).toBe('COMMIT');
      const result = measure(...args); expect(f.traces.at(-1)).toBe('COMMIT'); return result;
    });
    const result = await f.service.inspect(owner, workId.toUpperCase(), input);
    expect(factory).toHaveBeenCalledTimes(1); expect(numeric).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    const [row, pin, resolver] = factory.mock.calls[0];
    expect(resolver).toBe(profileObservationSource);
    const packet = build(row, pin, resolver);
    expect(result.diagnostic).toEqual(measure(packet, row, resolver));
    expect(numeric.mock.calls[0][1]).toBe(row);
    expect(numeric.mock.calls[0][0].authorData.sections).toHaveLength(8);
    expect(result).toMatchObject({
      contract: 'story-author-approved-section-bytes-v1', sourceScope: 'latest_owner_approved_profile_section_bytes_only',
      locale: 'ko', manuscriptVersion: 1, analysisVersion: 2, profileVersion: 1, reviewRevision: 1,
      readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
      legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated', fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192,
    });
    expect(Object.keys(result)).toHaveLength(17); expect(Object.keys(result.diagnostic)).toHaveLength(19);
    const json = JSON.stringify(result);
    for (const value of [PRIVATE, owner, workId, manuscriptId, analysisId, profileId, row.sourceFingerprint, row.approvedFingerprint!]) {
      expect(json).not.toContain(value);
    }
    expect(Object.isFrozen(result)).toBe(true); f.unchanged(before);
  });

  it('retains all inactive values and evidence counts without granting reader history or model fit', async () => {
    const f = fixture(), before = JSON.stringify(f.state), result = await f.service.inspect(owner, workId, input);
    const counted = result.diagnostic.sections;
    expect(counted.map(section => section.key)).toEqual(f.state.profiles[0].approvedSettings.sections.map(section => section.key));
    for (const key of ['narrative_devices', 'visual_cast']) {
      expect(counted.find(section => section.key === key)!.authorValueBytes).toBeGreaterThan(0);
      expect(counted.find(section => section.key === key)!.approvalEvidenceEntryBytes).toBeGreaterThan(0);
    }
    expect(result.diagnostic.modelInputFit).toBe('unmeasured');
    expect(Object.prototype.hasOwnProperty.call(result, 'currentSourceState')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'approvalReferenceVerified')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.diagnostic, 'candidateViewFits')).toBe(false);
    f.unchanged(before);
  });

  it('reports raw aggregate overflow while a small style alone never grants partial fit', async () => {
    const f = fixture(true), before = JSON.stringify(f.state), result = await f.service.inspect(owner, workId, input);
    expect(result.diagnostic.wholeCandidateViewBytes).toBeGreaterThan(16384);
    expect(result.diagnostic.authorDataBytes).toBeGreaterThan(16384);
    expect(result.diagnostic.writingStyleSectionBytes).toBeLessThan(16384);
    expect(result.diagnostic.byteCap).toBe(16384);
    expect(result.diagnostic.modelInputFit).toBe('unmeasured');
    expect(result.dispatchAuthorized || result.semanticQualityVerified).toBe(false); f.unchanged(before);
  });

  it('rejects invalid UUIDs and missing, wrong or extra measurement fields before transaction', async () => {
    const cases = [
      ['bad-user', workId, input], [owner, 'bad-work', input], [owner, workId, undefined], [owner, workId, {}],
      [owner, workId, { measurement: 'gzip-base64-v1' }], [owner, workId, { ...input, locale: 'en' }],
      [owner, workId, { ...input, choiceId: uuid(9) }], [owner, workId, { ...input, expectedProgressRevision: 0 }],
    ] as const;
    for (const [userId, id, query] of cases) {
      const f = fixture();
      await expect(f.service.inspect(userId, id, query as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
    }
  });

  it('hides outsider, fixture and absent work with the same closed 404', async () => {
    for (const kind of ['outsider', 'fixture', 'missing']) {
      const f = fixture();
      if (kind === 'fixture') f.state.works[0].fixtureSource = true;
      if (kind === 'missing') f.state.works.length = 0;
      const before = JSON.stringify(f.state);
      await expect(f.service.inspect(kind === 'outsider' ? outsider : owner, workId, input)).rejects.toMatchObject({
        status: 404, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_NOT_FOUND' },
      });
      expect(f.traces).not.toContain('manuscript'); expect(f.traces).not.toContain('profile'); f.unchanged(before);
    }
  });

  it('rejects current draft, rejected, withdrawn or superseded status before CPU', async () => {
    const metric = jest.spyOn(sectionPolicy, 'measureStoryApprovedProfileSectionByteMetric');
    for (const status of ['needs_review', 'draft', 'rejected', 'withdrawn', 'superseded']) {
      const f = fixture(); f.state.profiles[0].status = status; const before = JSON.stringify(f.state);
      await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
        status: 409, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_SOURCE_UNAVAILABLE' },
      }); f.unchanged(before);
    }
    expect(metric).not.toHaveBeenCalled();
  });

  it('fails closed for new manuscript, analysis mismatch, source mismatch, wrong reviewer and incomplete FULL', async () => {
    for (const kind of ['manuscript', 'analysis', 'fingerprint', 'reviewer', 'settings']) {
      const f = fixture();
      if (kind === 'manuscript') f.state.manuscripts.push({ ...f.state.manuscripts[0], id: uuid(10), version: 2 });
      if (kind === 'analysis') f.state.analyses[0].sourceContentHash = 'c'.repeat(64);
      if (kind === 'fingerprint') f.state.profiles[0].sourceFingerprint = 'c'.repeat(64);
      if (kind === 'reviewer') f.state.profiles[0].approvedByUserId = outsider;
      if (kind === 'settings') f.state.profiles[0].approvedSettings.sections.pop();
      const before = JSON.stringify(f.state);
      await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject(kind === 'manuscript' || kind === 'analysis'
        ? { status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'source_unavailable' } }
        : { status: 409, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_SOURCE_UNAVAILABLE' } });
      f.unchanged(before);
    }
  });

  it('checks all selected pin dimensions plus owner, work and status against the same snapshot', async () => {
    const metric = jest.spyOn(sectionPolicy, 'measureStoryApprovedProfileSectionByteMetric');
    for (const field of ['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint', 'ownerUserId', 'workId', 'status']) {
      const f = fixture(), readPinned = f.tx.storyWorkGenerationProfile.findUnique.getMockImplementation()!;
      f.tx.storyWorkGenerationProfile.findUnique.mockImplementationOnce(async (query: Row) => {
        const row = await readPinned(query);
        row[field] = typeof row[field] === 'number' ? row[field] + 1 : field === 'status' ? 'withdrawn' : 'synthetic-mismatch';
        return row;
      });
      const before = JSON.stringify(f.state);
      await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
        status: 409, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_SOURCE_UNAVAILABLE' },
      }); f.unchanged(before);
    }
    expect(metric).not.toHaveBeenCalled();
  });

  it('does not strip a non-JSON ORM Date accidentally returned by the selected-row adapter', async () => {
    const f = fixture(), readPinned = f.tx.storyWorkGenerationProfile.findUnique.getMockImplementation()!;
    f.tx.storyWorkGenerationProfile.findUnique.mockImplementationOnce(async (query: Row) => ({
      ...await readPinned(query), createdAt: new Date('2026-10-13T00:00:00Z'),
    }));
    await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
      status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'approval_unavailable' },
    });
  });

  it('runs no factory or metric if transaction completion fails', async () => {
    const f = fixture();
    f.prisma.$transaction.mockRejectedValueOnce(new Error(PRIVATE));
    const factory = jest.spyOn(deliveryPolicy, 'buildStoryApprovedProfileDelivery');
    const metric = jest.spyOn(sectionPolicy, 'measureStoryApprovedProfileSectionByteMetric');
    await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
      status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'source_unavailable' },
    }); expect(factory).not.toHaveBeenCalled(); expect(metric).not.toHaveBeenCalled();
  });

  it('maps each closed metric failure without rereading or returning partial numbers', async () => {
    for (const [code, reason] of [
      ['approval_invalid', 'approval_unavailable'], ['work_limit_exceeded', 'work_limit_exceeded'],
      ['measurement_failed', 'measurement_unavailable'],
    ] as const) {
      const f = fixture(), before = JSON.stringify(f.state);
      const metric = jest.spyOn(sectionPolicy, 'measureStoryApprovedProfileSectionByteMetric').mockImplementation(() => {
        expect(f.transactionSettled()).toBe(true); throw new sectionPolicy.StoryApprovedProfileSectionByteMetricError(code);
      });
      try {
        await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
          status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason },
        }); expect(f.traces.at(-1)).toBe('COMMIT'); f.unchanged(before);
      } finally { metric.mockRestore(); }
    }
  });

  it('maps factory approval failure and foreign source errors to opaque safe reasons', async () => {
    const f = fixture();
    const factory = jest.spyOn(deliveryPolicy, 'buildStoryApprovedProfileDelivery').mockImplementation(() => {
      throw new deliveryPolicy.StoryApprovedProfileDeliveryError('profile_fingerprint_changed');
    });
    await expect(f.service.inspect(owner, workId, input)).rejects.toMatchObject({
      status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'approval_unavailable' },
    }); factory.mockRestore();
    const other = fixture(); other.tx.storyWork.findFirst.mockRejectedValueOnce(new Error(PRIVATE));
    await expect(other.service.inspect(owner, workId, input)).rejects.toMatchObject({
      status: 503, response: { code: 'STORY_AUTHOR_APPROVED_SECTION_BYTES_UNAVAILABLE', reason: 'source_unavailable' },
    });
  });

  it('preserves completed snapshot numbers after later local withdrawal without live-authority claims', async () => {
    const f = fixture();
    f.hooks.afterCommit = () => { f.state.profiles[0].reviewRevision = 2; f.state.profiles[0].status = 'withdrawn'; };
    const result = await f.service.inspect(owner, workId, input);
    expect(result.reviewRevision).toBe(1); expect(result.diagnostic.sections).toHaveLength(8);
    expect(result.dispatchAuthorized || result.semanticQualityVerified).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'liveApprovalAuthorityVerified')).toBe(false);
    expect(f.traces.at(-1)).toBe('COMMIT'); for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  });

  it('requires exactly the dedicated measurement value in the new DTO', async () => {
    expect(await validate(plainToInstance(StoryAuthorApprovedSectionBytesQueryDto, input))).toHaveLength(0);
    for (const measurement of [undefined, null, '', 'gzip-base64-v1', 'json-utf8-v2', ['json-utf8-v1']]) {
      expect((await validate(plainToInstance(StoryAuthorApprovedSectionBytesQueryDto, { measurement }))).length).toBeGreaterThan(0);
    }
  });
});

describe('section bytes scoped HTTP (mock JWT verification, no token mint or AppModule)', () => {
  let app: INestApplication, port: number, f: ReturnType<typeof fixture>;
  beforeAll(async () => {
    f = fixture();
    const module = await Test.createTestingModule({ controllers: [StoryAuthorApprovedSectionBytesController], providers: [JwtAuthGuard,
      { provide: StoryAuthorApprovedSectionBytesService, useValue: f.service }, { provide: PrismaService, useValue: f.prisma },
      { provide: ConfigService, useValue: { getOrThrow: () => 'synthetic-mock-only' } },
      { provide: JwtService, useValue: { verifyAsync: async (token: string) => {
        if (!['synthetic-owner', 'synthetic-outsider', 'synthetic-inactive'].includes(token)) throw new Error('Synthetic invalid bearer');
        return { sub: token === 'synthetic-owner' ? owner : token === 'synthetic-outsider' ? outsider : inactive, tokenType: 'access' };
      } } },
    ] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  afterAll(async () => { await app?.close(); });
  const call = (query = 'measurement=json-utf8-v1', token?: string, method = 'GET', id = workId) =>
    new Promise<{ status: number; cache?: string; vary?: string; cookie?: string | string[]; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method,
        path: `/api/v1/me/creator-studio/stories/${id}/generation-profile/approved-section-bytes?${query}`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }, response => {
        let body = ''; response.setEncoding('utf8');
        response.on('data', part => {
          body += part;
          if (Buffer.byteLength(body, 'utf8') > 8192) { response.destroy(); reject(new Error('Synthetic response budget exceeded')); }
        });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode!, cache: response.headers['cache-control'],
          vary: response.headers.vary, cookie: response.headers['set-cookie'], body }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Synthetic HTTP deadline')));
      req.on('error', reject); req.end();
    });

  it('keeps anonymous, malformed, expired-like and inactive GET/HEAD private without service reads', async () => {
    for (const method of ['GET', 'HEAD']) for (const token of [undefined, 'invalid', 'expired', 'synthetic-inactive']) {
      const before = f.prisma.$transaction.mock.calls.length, result = await call(undefined, token, method);
      expect(result.status).toBe(401); expect(result.cache).toBe('private, no-store');
      expect(result.vary).toContain('Authorization'); expect(result.cookie).toBeUndefined();
      if (method === 'HEAD') expect(result.body).toBe(''); expect(result.body).not.toContain(PRIVATE);
      expect(f.prisma.$transaction.mock.calls.length).toBe(before);
    }
  });

  it('returns only the new numeric contract to an owner and hides an outsider with private 404', async () => {
    const before = JSON.stringify(f.state), result = await call(undefined, 'synthetic-owner');
    expect(result.status).toBe(200); expect(result.cache).toBe('private, no-store');
    expect(result.vary).toContain('Authorization'); expect(result.cookie).toBeUndefined();
    const body = JSON.parse(result.body);
    expect(body.contract).toBe('story-author-approved-section-bytes-v1');
    expect(body.diagnostic.contract).toBe('story-approved-profile-section-byte-metric-v1');
    expect(body.diagnostic.sections).toHaveLength(8);
    expect(body.dispatchAuthorized || body.semanticQualityVerified).toBe(false);
    for (const value of [PRIVATE, owner, workId, profileId]) expect(result.body).not.toContain(value);
    const denied = await call(undefined, 'synthetic-outsider');
    expect(denied.status).toBe(404); expect(denied.cache).toBe('private, no-store');
    expect(denied.vary).toContain('Authorization'); expect(denied.body).not.toContain(PRIVATE); f.unchanged(before);
  });

  it('rejects missing, wrong, duplicate and extra query keys before service transaction', async () => {
    for (const query of ['', 'measurement=gzip-base64-v1', 'measurement=json-utf8-v1&locale=ko',
      'measurement=json-utf8-v1&choiceId=' + uuid(9), 'measurement=json-utf8-v1&measurement=json-utf8-v1']) {
      const before = f.prisma.$transaction.mock.calls.length, result = await call(query, 'synthetic-owner');
      expect(result.status).toBe(400); expect(result.cache).toBe('private, no-store');
      expect(result.vary).toContain('Authorization'); expect(result.body).not.toContain(PRIVATE);
      expect(f.prisma.$transaction.mock.calls.length).toBe(before);
    }
  });

  it('rejects invalid path UUIDs and has no POST handler or profile mutation', async () => {
    const before = f.prisma.$transaction.mock.calls.length;
    const invalid = await call(undefined, 'synthetic-owner', 'GET', 'bad-work');
    expect(invalid.status).toBe(400); expect(invalid.cache).toBe('private, no-store');
    const post = await call(undefined, 'synthetic-owner', 'POST'); expect(post.status).toBe(404);
    expect(f.prisma.$transaction.mock.calls.length).toBe(before);
    for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  });
});

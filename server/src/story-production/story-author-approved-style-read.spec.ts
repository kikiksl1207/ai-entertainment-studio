import 'reflect-metadata';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { IncomingHttpHeaders, request, ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { createValidationException } from '../common/validation-exception.factory';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

type Row = Record<string, any>;
type Query = { where: Row; orderBy?: Record<string, 'asc' | 'desc'>; select?: Record<string, boolean> };
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1), outsider = uuid(2), workId = 'abcdefab-0000-4000-8000-000000000003';
const manuscriptId = uuid(4), analysisId = uuid(5);
const profileId = uuid(6), contentHash = createHash('sha256').update('synthetic manuscript binding').digest('hex');
const configHash = createHash('sha256').update('synthetic semantic configuration').digest('hex');
const PRIVATE = 'UNRELATED_PRIVATE_SECTION_AND_DRAFT_SENTINEL';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const requiredCode = 'GENERATION_PROFILE_APPROVED_STYLE_REQUIRED';
const staleCode = 'GENERATION_PROFILE_APPROVED_STYLE_STALE';
const invalidCode = 'GENERATION_PROFILE_APPROVED_STYLE_INVALID';

function sourceFingerprint(state: Row) {
  const manuscript = state.manuscripts.find((row: Row) => row.id === manuscriptId);
  const analysis = state.analyses.find((row: Row) => row.id === analysisId);
  return createHash('sha256').update(stableJson({
    workId, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
    analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
  })).digest('hex');
}

function settings() {
  return normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? 'edited' : 'accepted',
      value: key === 'writing_style' ? {
        summary: '  Approved complete summary. '.repeat(50) + 'SUMMARY_TAIL  ',
        imitationBoundary: 'approved_work_only',
        observations: [
          ...Array.from({ length: 25 }, (_, index) => ({
            title: `Rule ${index} ` + 'full title '.repeat(20),
            detail: `Rule ${index}: ` + 'Keep this approved exception and rhythm. '.repeat(24) + `DETAIL_TAIL_${index}`,
            ...(index % 2 ? {} : { sourceRef: `analysis:${uuid(100 + index)}` }),
          })),
          { title: 'Approved blank detail row', detail: '' },
        ],
        categories: Array.from({ length: 9 }, (_, index) => ({
          category: `Category ${index} ` + 'full category '.repeat(6),
          observations: Array.from({ length: 10 }, (_, part) =>
            `Exception ${index}/${part} ` + 'Keep the complete category observation. '.repeat(16) + `CATEGORY_TAIL_${index}_${part}`),
        })),
      } : { summary: PRIVATE },
      evidence: key === 'writing_style'
        ? [{ sourceType: 'manuscript', sourceRef: `analysis:${uuid(100)}:synthetic-part:1`,
          summary: 'Approved evidence summary, not an original manuscript.' }] : [],
    })),
  });
}

function fixture() {
  const approved = settings();
  const state: Row = {
    works: [{ id: workId, ownerUserId: owner }],
    manuscripts: [
      { id: uuid(8), workId, ownerUserId: owner, version: 2, locale: 'en', contentHash },
      { id: manuscriptId, workId, ownerUserId: owner, version: 3, locale: 'en', contentHash },
    ],
    analyses: [
      { id: uuid(9), workId, manuscriptVersionId: manuscriptId, status: 'completed',
        pipeline: SEMANTIC_PIPELINE, analysisVersion: 3, sourceContentHash: contentHash, configHash },
      { id: analysisId, workId, manuscriptVersionId: manuscriptId, status: 'completed',
        pipeline: SEMANTIC_PIPELINE, analysisVersion: 4, sourceContentHash: contentHash, configHash },
      { id: uuid(10), workId, manuscriptVersionId: manuscriptId, status: 'pending',
        pipeline: SEMANTIC_PIPELINE, analysisVersion: 5, sourceContentHash: contentHash, configHash },
    ],
    profiles: [] as Row[],
  };
  const fingerprint = sourceFingerprint(state);
  const profile: Row = {
    id: profileId, workId, ownerUserId: owner, manuscriptVersionId: manuscriptId, analysisJobId: analysisId,
    sourceFingerprint: fingerprint, profileVersion: 4, reviewRevision: 3, status: 'approved',
    approvedSettings: approved, approvedFingerprint: creatorGenerationProfileFingerprint(fingerprint, approved),
    approvedByUserId: owner, approvedAt: new Date('2026-10-01T00:00:00.000Z'),
    draftSettings: { secret: PRIVATE }, draftFingerprint: PRIVATE, analysisErrorCode: PRIVATE,
  };
  state.profiles.push({ ...profile, id: uuid(7), profileVersion: 3 }, profile);
  const trace: string[] = [], blocked: ReturnType<typeof jest.fn>[] = [];
  const forbid = () => {
    const fn = jest.fn(() => { throw new Error('Forbidden synthetic write or outer read'); });
    blocked.push(fn); return fn;
  };
  const writes = () => Object.fromEntries(
    ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].map(name => [name, forbid()]));
  const delegate = (name: string, rows: () => Row[]) => ({
    ...writes(),
    findFirst: jest.fn(async (query: Query) => {
      trace.push(name);
      const uuidKeys = ['id', 'workId', 'ownerUserId', 'manuscriptVersionId', 'analysisJobId'];
      let found = rows().filter(row => Object.entries(query.where).every(([key, value]) =>
        uuidKeys.includes(key) && typeof row[key] === 'string' && typeof value === 'string'
          ? row[key].toLowerCase() === value.toLowerCase() : row[key] === value));
      if (query.orderBy) {
        const entries = Object.entries(query.orderBy);
        if (entries.length !== 1) throw new Error('Unsupported synthetic ordering');
        const [key, direction] = entries[0];
        found = [...found].sort((a, b) => (a[key] - b[key]) * (direction === 'desc' ? -1 : 1));
      }
      const row = found[0];
      return row ? query.select
        ? Object.fromEntries(Object.keys(query.select).filter(key => query.select![key]).map(key => [key, row[key]]))
        : row : null;
    }),
  });
  const db = {
    storyWork: delegate('work', () => state.works),
    storyManuscriptVersion: delegate('manuscript', () => state.manuscripts),
    storyAnalysisJob: delegate('analysis', () => state.analyses),
    storyWorkGenerationProfile: delegate('profile', () => state.profiles),
    $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
      expect(sql.strings.join('')).toBe('SET TRANSACTION READ ONLY');
      expect(sql.values).toEqual([]); trace.push('read-only'); return 0;
    }),
    $queryRaw: forbid(),
  };
  const prisma = {
    storyWork: { ...writes(), findFirst: forbid() },
    storyManuscriptVersion: { ...writes(), findFirst: forbid() },
    storyAnalysisJob: { ...writes(), findFirst: forbid() },
    storyWorkGenerationProfile: { ...writes(), findFirst: forbid() },
    $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
      trace.push('begin');
      try { return await callback(db); } finally { trace.push('end'); }
    }),
  };
  const service = new StoryGenerationProfileService(prisma as unknown as PrismaService);
  const mutationEntrypoints = ['getOrCreate', 'autoApproveCompany', 'approve', 'update',
    'createDraftAtCompletion', 'onApplicationBootstrap'] as const;
  const entrypoints = mutationEntrypoints.map(name => jest.spyOn(service, name));
  const reseal = () => {
    const normalized = normalizeCreatorGenerationProfile('story', profile.approvedSettings);
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, normalized);
  };
  return { state, profile, service, db, prisma, trace, blocked, entrypoints, reseal };
}

function assertReadOnly(f: ReturnType<typeof fixture>) {
  for (const fn of [...f.blocked, ...f.entrypoints]) expect(fn).not.toHaveBeenCalled();
  expect(f.prisma.$transaction.mock.calls.length).toBeLessThanOrEqual(1);
  expect(f.db.$executeRaw.mock.calls.length).toBe(f.prisma.$transaction.mock.calls.length);
  if (f.prisma.$transaction.mock.calls.length) {
    expect(f.trace[0]).toBe('begin'); expect(f.trace[1]).toBe('read-only');
    expect(f.trace[f.trace.length - 1]).toBe('end');
  }
}

// Preserve Date timestamps (including NaN) without Jest's invalid-Date equality.
function snapshotReadState(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const date = value instanceof Date;
  const prototype = Object.getPrototypeOf(value);
  return {
    kind: date ? 'date' : Array.isArray(value) ? 'array' : prototype === null ? 'null-prototype-object' : 'object',
    ...(date ? { timestamp: Date.prototype.getTime.call(value) } : {}),
    fields: Reflect.ownKeys(value).map(key => [key, snapshotReadState(Reflect.get(value, key))]),
  };
}

async function expectFailure(f: ReturnType<typeof fixture>, code: string, status: number, subject = owner) {
  const before = snapshotReadState(f.state);
  let caught: unknown;
  try { await f.service.readCurrentApprovedStyle(subject, workId); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getStatus()).toBe(status);
  expect((caught as HttpException).getResponse()).toMatchObject({ code });
  expect(JSON.stringify((caught as HttpException).getResponse())).not.toContain(PRIVATE);
  expect(snapshotReadState(f.state)).toEqual(before); assertReadOnly(f);
}

describe('author approved style service (real policy, synthetic read-only DB)', () => {
  it('AUTHOR-APPROVED-STYLE: no-write snapshot preserves invalid Date and detects timestamp or field mutation', () => {
    const value = { approvedAt: new Date('2026-10-01T00:00:00.000Z'),
      invalidAt: new Date(NaN), ordered: [1, undefined, null], custom: {} };
    Object.defineProperty(value.custom, '__proto__', { value: { rule: 'Own JSON key' }, enumerable: true });
    const before = snapshotReadState(value), timestamp = value.approvedAt.getTime();
    expect(snapshotReadState(value)).toEqual(before);
    value.approvedAt.setTime(timestamp + 1);
    expect(snapshotReadState(value)).not.toEqual(before);
    value.approvedAt.setTime(timestamp);
    value.invalidAt.setTime(0);
    expect(snapshotReadState(value)).not.toEqual(before);
    value.invalidAt.setTime(NaN);
    expect(snapshotReadState(value)).toEqual(before);
    value.ordered.reverse();
    expect(snapshotReadState(value)).not.toEqual(before);
    value.ordered.reverse();
    expect(snapshotReadState(value)).toEqual(before);
    expect(snapshotReadState({ ...value, custom: {} })).not.toEqual(before);
    expect(snapshotReadState({ ...value, invalidAt: null })).not.toEqual(before);
  });

  it('AUTHOR-APPROVED-STYLE: preserves the entire current approved section and separates private source from body', async () => {
    for (const locale of locales) {
      const f = fixture();
      f.state.manuscripts.find((row: Row) => row.id === manuscriptId).locale = locale;
      const before = snapshotReadState(f.state);
      const style = f.profile.approvedSettings.sections.find((section: Row) => section.key === 'writing_style');
      const freeze = (value: any) => {
        if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      };
      freeze(f.profile.approvedSettings);
      const result = await f.service.readCurrentApprovedStyle(owner, workId);
      expect(result).toEqual({
        version: 'story-author-approved-style-v1', sourceScope: 'latest_private_manuscript_completed_analysis',
        locale, manuscriptVersion: 3, analysisVersion: 4, profileVersion: 4, reviewRevision: 3,
        section: style, readOnly: true, providerCalls: 0, operatingWrites: 0,
        bodySourceAligned: false, semanticQualityVerified: false,
      });
      expect(result.section).not.toBe(style);
      expect(result.section.value.observations).toHaveLength(26);
      expect(result.section.value.categories).toHaveLength(9);
      expect(Buffer.byteLength(JSON.stringify(result.section), 'utf8')).toBeGreaterThan(16 * 1024);
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(192 * 1024);
      expect(JSON.stringify(result)).not.toContain(PRIVATE);
      for (const key of ['id', 'workId', 'ownerUserId', 'sourceFingerprint', 'approvedFingerprint', 'draftSettings']) {
        expect(result).not.toHaveProperty(key);
      }
      expect(snapshotReadState(f.state)).toEqual(before); assertReadOnly(f);
    }
  });

  it('AUTHOR-APPROVED-STYLE: current source and latest unfiltered profile fail closed without older approval fallback', async () => {
    const cases: Array<[string, (f: ReturnType<typeof fixture>) => void, string, number, string?]> = [
      ['nonowner', () => {}, 'NOT_FOUND', 404, outsider],
      ['missing manuscript', f => { f.state.manuscripts = []; }, 'GENERATION_PROFILE_MANUSCRIPT_REQUIRED', 409],
      ['missing completed analysis', f => { f.state.analyses = []; }, 'GENERATION_PROFILE_ANALYSIS_REQUIRED', 503],
      ['wrong pipeline', f => { f.state.analyses.forEach((row: Row) => { row.pipeline = 'other'; }); },
        'GENERATION_PROFILE_ANALYSIS_REQUIRED', 503],
      ['analysis hash changed', f => { f.state.analyses.find((row: Row) => row.id === analysisId).sourceContentHash = '0'.repeat(64); },
        'GENERATION_PROFILE_ANALYSIS_REQUIRED', 503],
      ['latest manuscript changed', f => { f.state.manuscripts.push({ ...f.state.manuscripts[1], id: uuid(30), version: 4 }); },
        'GENERATION_PROFILE_ANALYSIS_REQUIRED', 503],
      ['new completed analysis', f => { f.state.analyses.push({ ...f.state.analyses[1], id: uuid(31), analysisVersion: 6 }); }, staleCode, 409],
      ['missing profiles', f => { f.state.profiles = []; }, requiredCode, 409],
      ['newer needs-review row', f => { f.state.profiles.push({ ...f.profile, id: uuid(32), profileVersion: 5, status: 'needs_review' }); }, requiredCode, 409],
      ['latest superseded row', f => { f.profile.status = 'superseded'; }, requiredCode, 409],
      ['profile owner changed', f => { f.profile.ownerUserId = outsider; }, staleCode, 409],
      ['profile manuscript changed', f => { f.profile.manuscriptVersionId = uuid(8); }, staleCode, 409],
      ['profile analysis changed', f => { f.profile.analysisJobId = uuid(9); }, staleCode, 409],
      ['profile source fingerprint changed', f => { f.profile.sourceFingerprint = '0'.repeat(64); }, staleCode, 409],
      ['analysis config changed', f => { f.state.analyses.find((row: Row) => row.id === analysisId).configHash = '0'.repeat(64); }, staleCode, 409],
    ];
    for (const [_label, mutate, code, status, subject] of cases) {
      const f = fixture(); mutate(f);
      // The generic owner-not-found response is deliberately unchanged.
      if (code === 'NOT_FOUND') {
        await expect(f.service.readCurrentApprovedStyle(subject!, workId)).rejects.toMatchObject({ status: 404 });
        assertReadOnly(f);
      } else await expectFailure(f, code, status, subject);
    }
  });

  it('AUTHOR-APPROVED-STYLE: approval pin and existing generic policy invalidity reject without repair or secret echo', async () => {
    const cases: Array<[string, (f: ReturnType<typeof fixture>) => void, boolean?, string?]> = [
      ['missing settings', f => { f.profile.approvedSettings = null; }],
      ['missing fingerprint', f => { f.profile.approvedFingerprint = null; }],
      ['changed fingerprint', f => { f.profile.approvedFingerprint = '0'.repeat(64); }],
      ['changed approval author', f => { f.profile.approvedByUserId = outsider; }],
      ['missing approval time', f => { f.profile.approvedAt = null; }],
      ['invalid approval time', f => { f.profile.approvedAt = new Date(NaN); }],
      ['invalid review revision', f => { f.profile.reviewRevision = 0; }],
      ['invalid profile version', f => { f.state.profiles = [f.profile]; f.profile.profileVersion = 0; }],
      ['invalid locale', f => { f.state.manuscripts[1].locale = 'fr'; }],
      ['nonpositive manuscript version', f => { f.state.manuscripts = [f.state.manuscripts[1]]; f.state.manuscripts[0].version = 0; }],
      ['altered setting with old pin', f => { f.profile.approvedSettings.sections[0].value.summary = 'Changed'; }],
      ['not fully reviewed', f => { f.profile.approvedSettings.sections[0].decision = 'proposed'; }, true],
      ['missing style', f => { f.profile.approvedSettings.sections =
        f.profile.approvedSettings.sections.filter((row: Row) => row.key !== 'writing_style'); }, true],
      ['generic depth above eight', f => {
        styleValue(f).custom = Array.from({ length: 9 }).reduce<unknown>(value => ({ child: value }), PRIVATE);
      }, false, 'GENERATION_PROFILE_VALUE_INVALID'],
      ['generic prohibited prototype key', f => {
        Object.defineProperty(styleValue(f), '__proto__', { value: PRIVATE, enumerable: true });
      }, false, 'GENERATION_PROFILE_VALUE_INVALID'],
      ['generic infinite number', f => { styleValue(f).custom = Infinity; }, false, 'GENERATION_PROFILE_VALUE_INVALID'],
      ['unknown section secret', f => { f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').secret = PRIVATE; }, true],
      ['unknown evidence secret', f => { f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').evidence[0].secret = PRIVATE; }, true],
      ['unnormalized evidence tail', f => { f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').evidence[0].summary += ' '; }, true],
    ];
    for (const [_label, mutate, reseal, policyCode] of cases) {
      const f = fixture(); mutate(f); if (reseal) f.reseal();
      if (policyCode) {
        let rejected: unknown;
        try { normalizeCreatorGenerationProfile('story', f.profile.approvedSettings); } catch (error) { rejected = error; }
        expect(rejected).toBeInstanceOf(HttpException);
        expect((rejected as HttpException).getResponse()).toMatchObject({ code: policyCode });
      }
      await expectFailure(f, invalidCode, 409);
    }
  });

  it('AUTHOR-APPROVED-STYLE-F1: preserves every lawful generic style value and absence under the exact approved fingerprint', async () => {
    const values: Row[] = [
      { summary: 'Existing summary-only approved style' },
      { observations: [{ title: 'Existing observation', detail: 'Full existing rule tail' }] },
      { categories: [{ category: 'Existing category', observations: ['Full existing exception tail'] }] },
      { imitationBoundary: 'approved_work_only' },
      {}, { summary: '' }, { summary: '  ' }, { summary: null }, { summary: false }, { summary: 12 },
      { summary: ['Full summary one', 'Full summary tail'] },
      { summary: { primary: 'Full summary rule', exception: 'Full summary tail' } },
      { customRule: { priority: 0, enabled: false, exception: 'Complete custom rule tail' } },
      { observations: {} },
      { observations: [null, 'Complete plain observation', 12, false, ['Nested observation'],
        { title: false, detail: 12, sourceRef: 'custom-approved-reference', extra: { tail: 'Full row tail' } },
        { detail: 'Existing title-free observation tail' }] },
      { categories: {} },
      { categories: [null, { category: ' ', observations: [12, ' ', null, { rule: 'Full category tail' }], extra: true }] },
      { imitationBoundary: null }, { imitationBoundary: 12 }, { imitationBoundary: false },
      { imitationBoundary: '' }, { imitationBoundary: ' ' },
      { ' ': ['Complete owner-approved custom text'], 'custom.rule': { tail: 'Complete punctuation-key tail' } },
      { observations: null, categories: false, imitationBoundary: { mode: 'Custom approved JSON' }, custom: [0, null] },
    ];
    for (const value of values) {
      const f = fixture();
      f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').value = value;
      f.reseal();
      const before = snapshotReadState(f.state), fingerprint = f.profile.approvedFingerprint;
      const approvedSection = f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style');
      const result = await f.service.readCurrentApprovedStyle(owner, workId);
      expect(result.section).toEqual(approvedSection);
      expect(stableJson(result.section)).toBe(stableJson(approvedSection));
      expect(result.section.value).toEqual(value);
      expect(Object.keys(result.section.value).sort()).toEqual(Object.keys(value).sort());
      expect(creatorGenerationProfileFingerprint(f.profile.sourceFingerprint,
        normalizeCreatorGenerationProfile('story', f.profile.approvedSettings))).toBe(fingerprint);
      expect(f.profile.approvedFingerprint).toBe(fingerprint);
      expect(snapshotReadState(f.state)).toEqual(before); assertReadOnly(f);
    }
  });

  it('AUTHOR-APPROVED-STYLE-F2: uppercase UUID ownership uses canonical work scope for every later query', async () => {
    const f = fixture(), before = snapshotReadState(f.state), uppercase = workId.toUpperCase();
    expect(uppercase).not.toBe(workId);
    const result = await f.service.readCurrentApprovedStyle(owner, uppercase);
    expect(result).toMatchObject({ manuscriptVersion: 3, analysisVersion: 4, profileVersion: 4 });
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: uppercase, ownerUserId: owner }, select: { id: true } });
    for (const delegate of [f.db.storyManuscriptVersion, f.db.storyAnalysisJob, f.db.storyWorkGenerationProfile]) {
      expect(delegate.findFirst.mock.calls[0][0].where.workId).toBe(workId);
    }
    expect(snapshotReadState(f.state)).toEqual(before); assertReadOnly(f);
  });

  it('AUTHOR-APPROVED-STYLE: reads only one repeatable read-only snapshot with the exact current query boundaries', async () => {
    const f = fixture(), before = snapshotReadState(f.state);
    await f.service.readCurrentApprovedStyle(owner, workId);
    expect(f.trace).toEqual(['begin', 'read-only', 'work', 'manuscript', 'analysis', 'profile', 'end']);
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith({ where: { id: workId, ownerUserId: owner }, select: { id: true } });
    expect(f.db.storyManuscriptVersion.findFirst).toHaveBeenCalledWith({
      where: { workId, ownerUserId: owner }, orderBy: { version: 'desc' },
      select: { id: true, version: true, locale: true, contentHash: true },
    });
    expect(f.db.storyAnalysisJob.findFirst).toHaveBeenCalledWith({
      where: { workId, manuscriptVersionId: manuscriptId, status: 'completed', pipeline: SEMANTIC_PIPELINE },
      orderBy: { analysisVersion: 'desc' },
      select: { id: true, analysisVersion: true, sourceContentHash: true, configHash: true },
    });
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith({
      where: { workId }, orderBy: { profileVersion: 'desc' }, select: {
        id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, analysisJobId: true,
        sourceFingerprint: true, profileVersion: true, reviewRevision: true, status: true,
        approvedSettings: true, approvedFingerprint: true, approvedByUserId: true, approvedAt: true,
      },
    });
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledTimes(1);
    expect(snapshotReadState(f.state)).toEqual(before); assertReadOnly(f);
    const edited = fixture();
    styleValue(edited).observations = []; styleValue(edited).categories = [];
    edited.reseal();
    const result = await edited.service.readCurrentApprovedStyle(owner, workId);
    expect(result.section.value.observations).toEqual([]);
    expect(result.section.value.categories).toEqual([]);
    assertReadOnly(edited);
  });
});

function styleValue(f: ReturnType<typeof fixture>): Row {
  return f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').value;
}

// Real Nest/controller/JWT/filter/HTTP; DB delegates are deterministic and synthetic.
// Bind the real read method without service bootstrap hooks; no approval or recovery is started.
describe('author approved style HTTP (real Nest/JWT/service, synthetic DB)', () => {
  let f: ReturnType<typeof fixture>, app: INestApplication, port: number;
  let token: string, otherToken: string, expiredToken: string, refreshToken: string;
  const path = `/api/v1/me/creator-studio/stories/${workId}/generation-profile/approved-style`;
  beforeAll(async () => {
    f = fixture();
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    expiredToken = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: -1 });
    refreshToken = await jwt.signAsync({ sub: owner, tokenType: 'refresh' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryProductionController], providers: [
      JwtAuthGuard,
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: PrismaService, useValue: {
        user: { findFirst: jest.fn(async ({ where }: { where: Row }) =>
          [owner, outsider].includes(where.id) && where.status === 'active' && where.deletedAt === null
            ? { id: where.id, email: 'synthetic-author@example.invalid' } : null) },
      } },
      { provide: StoryProductionService, useValue: {} },
      { provide: StoryProgressControlService, useValue: {} },
      { provide: StoryGenerationProfileService, useValue: {
        readCurrentApprovedStyle: (id: string, work: string) => f.service.readCurrentApprovedStyle(id, work),
      } },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.use((_req: unknown, res: ServerResponse, next: () => void) => {
      res.setHeader('Vary', 'Origin, Accept-Encoding'); next();
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({
      transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true,
      exceptionFactory: createValidationException,
    }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { f = fixture(); });
  afterEach(() => { assertReadOnly(f); });
  afterAll(async () => { await app?.close(); });

  function call(method = 'GET', authorization: string | null = token, target = path) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; bytes: number; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, agent: false, path: target,
        headers: { connection: 'close', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          try { resolve({ status: res.statusCode!, headers: res.headers, bytes: raw.length,
            body: raw.length ? JSON.parse(raw.toString('utf8')) : null }); }
          catch { reject(new Error('Synthetic loopback HTTP response was not JSON')); }
        });
      });
      req.setTimeout(10_000, () => req.destroy(new Error('Synthetic loopback HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  function privateHeaders(response: Awaited<ReturnType<typeof call>>) {
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers.expires).toBe('0');
    const vary = String(response.headers.vary).toLowerCase().split(',').map(value => value.trim());
    expect(vary).toEqual(expect.arrayContaining(['origin', 'accept-encoding', 'authorization']));
    expect(vary.filter(value => value === 'authorization')).toHaveLength(1);
    expect(response.headers['set-cookie']).toBeUndefined();
  }

  it.each(['GET', 'HEAD'])('AUTHOR-APPROVED-STYLE-HTTP: anonymous %s fails before any private source read', async method => {
    const response = await call(method, null);
    expect(response.status).toBe(401); privateHeaders(response);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('SUMMARY_TAIL');
    if (method === 'HEAD') expect(response.bytes).toBe(0);
  });

  it.each(['expired', 'refresh'])('AUTHOR-APPROVED-STYLE-HTTP: %s token cannot read or grant approval', async kind => {
    const response = await call('GET', kind === 'expired' ? expiredToken : refreshToken);
    expect(response.status).toBe(401); privateHeaders(response);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('AUTHOR-APPROVED-STYLE-HTTP: current owner %s uses the real service and preserves full approved style', async method => {
    const before = snapshotReadState(f.state), response = await call(method);
    expect(response.status).toBe(200); privateHeaders(response);
    if (method === 'HEAD') { expect(response.bytes).toBe(0); expect(response.body).toBeNull(); }
    else {
      expect(response.body.section).toEqual(f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style'));
      expect(response.body).toMatchObject({ version: 'story-author-approved-style-v1',
        sourceScope: 'latest_private_manuscript_completed_analysis', bodySourceAligned: false,
        readOnly: true, operatingWrites: 0, providerCalls: 0, semanticQualityVerified: false });
      expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
    }
    expect(snapshotReadState(f.state)).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-APPROVED-STYLE-HTTP-F1-F2: uppercase work UUID reads summary-only approval without invented fields', async () => {
    f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').value =
      { summary: 'Existing summary-only approved style' };
    f.reseal();
    const before = snapshotReadState(f.state);
    const response = await call('GET', token, path.replace(workId, workId.toUpperCase()));
    expect(response.status).toBe(200); privateHeaders(response);
    expect(response.body.section.value).toEqual({ summary: 'Existing summary-only approved style' });
    expect(response.body.bodySourceAligned).toBe(false);
    expect(snapshotReadState(f.state)).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: nonowner remains private 404 without profile reads', async () => {
    const response = await call('GET', otherToken);
    expect(response.status).toBe(404); privateHeaders(response);
    expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
    expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: malformed work ID is private 400 before the service', async () => {
    const response = await call('GET', token, path.replace(workId, 'not-a-uuid'));
    expect(response.status).toBe(400); privateHeaders(response);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('AUTHOR-APPROVED-STYLE-HTTP: newer unapproved profile is private %s 409, not an older fallback', async method => {
    f.state.profiles.push({ ...f.profile, id: uuid(42), profileVersion: 5, status: 'needs_review' });
    const response = await call(method);
    expect(response.status).toBe(409); privateHeaders(response);
    if (method === 'HEAD') expect(response.bytes).toBe(0);
    else expect(response.body.error.code).toBe(requiredCode);
    expect(JSON.stringify(response.body)).not.toContain('SUMMARY_TAIL');
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: existing generic policy invalidity produces a safe private 409', async () => {
    styleValue(f).observations[1].detail = PRIVATE;
    styleValue(f).custom = Infinity;
    expect(() => normalizeCreatorGenerationProfile('story', f.profile.approvedSettings)).toThrow(HttpException);
    const response = await call();
    expect(response.status).toBe(409); privateHeaders(response);
    expect(response.body.error.code).toBe(invalidCode);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
  });

  it('AUTHOR-APPROVED-STYLE-HTTP-F1: lawful custom keys and nonstandard rows return the whole approved section privately', async () => {
    const value = { summary: 12, customRule: { tail: 'Complete approved custom rule tail' },
      observations: [null, { detail: 12, extra: ['Complete nonstandard row tail'] }],
      categories: { ordered: ['Complete category tail', false] }, imitationBoundary: '' };
    f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style').value = value;
    f.reseal();
    const before = snapshotReadState(f.state), fingerprint = f.profile.approvedFingerprint;
    const response = await call();
    expect(response.status).toBe(200); privateHeaders(response);
    expect(response.body.section).toEqual(f.profile.approvedSettings.sections.find((row: Row) => row.key === 'writing_style'));
    expect(response.body.section.value).toEqual(value);
    expect(f.profile.approvedFingerprint).toBe(fingerprint);
    expect(snapshotReadState(f.state)).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: missing completed current analysis is private 503', async () => {
    f.state.analyses = [];
    const response = await call();
    expect(response.status).toBe(503); privateHeaders(response);
    expect(response.body.error.code).toBe('GENERATION_PROFILE_ANALYSIS_REQUIRED');
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: repeated explicit reads report fresh snapshot numbers without writes', async () => {
    const first = await call();
    expect(first.status).toBe(200); privateHeaders(first);
    const old = f; assertReadOnly(old);
    f = fixture(); f.profile.reviewRevision = 4;
    const second = await call();
    expect(second.status).toBe(200); privateHeaders(second);
    expect(first.body.reviewRevision).toBe(3); expect(second.body.reviewRevision).toBe(4);
    expect(second.body.section).toEqual(first.body.section);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-APPROVED-STYLE-HTTP: no POST approved-style mutation route is introduced', async () => {
    const response = await call('POST');
    expect(response.status).toBe(404);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

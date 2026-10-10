import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { request } from 'http';
import type { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import {
  CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
} from '../generation-profile/creator-generation-profile.policy';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyPreviewController } from './story-author-body-preview.controller';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import * as currentStyle from './story-author-approved-style.snapshot';
import * as referencePolicy from './story-author-body-style-reference.policy';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

type Row = Record<string, any>;
type Query = { where?: Row; select?: Record<string, boolean>; orderBy?: Row | Row[]; take?: number };
type Result = Awaited<ReturnType<StoryAuthorBodyPreviewService['styleReference']>>;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const uuid = (n: number) => '00000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const owner = uuid(1), outsider = uuid(2), workId = 'abcdefab-0000-4000-8000-000000000003';
const releaseId = uuid(4), progressId = uuid(5), partId = uuid(6), sceneId = uuid(7);
const originId = uuid(8), manuscriptId = uuid(9), analysisId = uuid(10), profileId = uuid(11);
const sourceSceneId = uuid(12), PRIVATE = 'PRIVATE_STYLE_REFERENCE_BODY_PROFILE_PATH_SENTINEL';
const localized = (value: string) => Object.fromEntries(locales.map(locale => [locale, value]));
const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex');

// Preserve every field and array order, including valid/invalid Date timestamps.
function snapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  const date = value instanceof Date;
  return {
    kind: date ? 'date' : Array.isArray(value) ? 'array'
      : Object.getPrototypeOf(value) === null ? 'null-prototype-object' : 'object',
    ...(date ? { timestamp: Date.prototype.getTime.call(value) } : {}),
    fields: Reflect.ownKeys(value).map(key => [key, snapshot(Reflect.get(value, key))]),
  };
}
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  }
  return value;
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      throw new Error('Unsupported synthetic predicate');
    }
    return row[key] === value;
  });
}
function fixture() {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: 'accepted', evidence: [],
      value: key === 'writing_style' ? {
        summary: PRIVATE, custom: { completeTail: PRIVATE },
        observations: Array.from({ length: 5 }, (_, i) => ({
          title: 'Whole rule ' + i, detail: PRIVATE.repeat(10) + 'TAIL_' + i,
        })),
        categories: Array.from({ length: 7 }, (_, i) => ({
          category: 'Whole category ' + i, observations: [PRIVATE, 'CATEGORY_TAIL_' + i],
        })),
      } : { summary: PRIVATE },
    })),
  });
  const manuscript = { id: manuscriptId, workId, ownerUserId: owner, version: 3,
    locale: 'en', contentHash: hash('synthetic private manuscript'), structuredBody: { secret: PRIVATE } };
  const analysis = { id: analysisId, workId, manuscriptVersionId: manuscriptId,
    status: 'completed', pipeline: SEMANTIC_PIPELINE, analysisVersion: 4,
    sourceContentHash: manuscript.contentHash, configHash: hash('synthetic config') };
  const sourceFingerprint = hash({ workId, manuscriptVersionId: manuscriptId, contentHash: manuscript.contentHash,
    analysisJobId: analysisId, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash });
  const profile: Row = { id: profileId, workId, ownerUserId: owner, manuscriptVersionId: manuscriptId,
    analysisJobId: analysisId, sourceFingerprint, profileVersion: 4, reviewRevision: 3, status: 'approved',
    approvedSettings: settings, approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
    approvedByUserId: owner, approvedAt: new Date('2026-10-01T00:00:00.000Z'), draftSettings: { secret: PRIVATE } };
  const pin = () => Object.fromEntries(['id', 'profileVersion', 'reviewRevision', 'sourceFingerprint', 'approvedFingerprint']
    .map(key => [key, profile[key]]));
  const state: Row = {
    work: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false,
      activeReleaseId: releaseId, publishedVersion: 1 },
    progress: { id: progressId, userId: owner, workId, activeReleaseId: releaseId,
      storyVersion: 1, progressRevision: 7, currentBeatPosition: 1, status: 'active',
      currentSceneId: null, currentGeneratedSceneId: sceneId, routeNodeId: null, pathSummary: [{ secret: PRIVATE }] },
    release: { id: releaseId, workId, status: 'active', version: 1 },
    part: { id: partId, workId, status: 'published', fixtureSource: false },
    generated: { id: sceneId, userId: owner, workId, releaseId, progressId, status: 'ready',
      continuationId: originId, sourcePartId: partId, title: localized(PRIVATE), endingType: null },
    origin: { id: originId, userId: owner, workId, releaseId, progressId, status: 'completed',
      resultGeneratedSceneId: sceneId, contextReferences: { generationProfilePin: pin(), privateContext: PRIVATE } },
    beats: [{ id: uuid(20), sceneId, position: 1, beatType: 'paragraph', content: localized('a'.repeat(100)) }],
    choices: [{ id: uuid(21), sceneId, position: 1, label: localized(PRIVATE), routeKind: 'generation_required' }],
    sourceScenes: [{ id: sourceSceneId, partId, position: 1, status: 'published', fixtureSource: false,
      title: localized(PRIVATE), endingType: null }],
    sourceBeats: [{ id: uuid(22), sceneId: sourceSceneId, position: 1,
      beatType: 'paragraph', content: localized('a'.repeat(100)) }],
    manuscripts: [manuscript], analyses: [analysis],
    profiles: [{ ...clone(profile), id: uuid(13), profileVersion: 3 }, profile],
  };
  let activeTrace: string[] | null = null, readOnly = false;
  const traces: string[][] = [], blocked: jest.Mock[] = [];
  const forbid = () => {
    const fn = jest.fn(() => { throw new Error('Synthetic write or outer read prohibited'); });
    blocked.push(fn); return fn;
  };
  const writeMethods = () => Object.fromEntries(
    ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].map(name => [name, forbid()]));
  const read = (name: string) => {
    if (!activeTrace || !readOnly) throw new Error('Read outside READ ONLY snapshot');
    activeTrace.push(name);
  };
  function queryRows(rows: Row[], query: Query) {
    const values = rows.filter(row => matches(row, query.where));
    const ordering = query.orderBy ? Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy] : [];
    values.sort((a, b) => {
      for (const order of ordering) for (const [key, direction] of Object.entries(order)) {
        if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
    return values.slice(0, query.take).map(row => clone(query.select
      ? Object.fromEntries(Object.entries(query.select).filter(([, enabled]) => enabled).map(([key]) => [key, row[key]]))
      : row));
  }
  const first = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name); return queryRows(rows(), query)[0] ?? null;
  });
  const many = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name); return queryRows(rows(), query);
  });
  const db = {
    storyWork: { ...writeMethods(), findFirst: first('work', () => [state.work]) },
    storyReaderProgress: { ...writeMethods(), findUnique: jest.fn(async (query: Query) => {
      read('progress');
      const scope = query.where!.userId_workId;
      return state.progress && matches(state.progress, scope) ? queryRows([state.progress], { select: query.select })[0] : null;
    }) },
    storyRelease: { ...writeMethods(), findFirst: first('release', () => [state.release]) },
    storyPart: { ...writeMethods(), findFirst: first('part', () => [state.part]) },
    storyAiGeneratedScene: { ...writeMethods(), findFirst: first('generated', () => [state.generated]) },
    storyAiContinuation: { ...writeMethods(), findFirst: first('origin', () => [state.origin]) },
    storyAiGeneratedBeat: { ...writeMethods(), findMany: many('generated-beats', () => state.beats) },
    storyAiGeneratedChoice: { ...writeMethods(), findMany: many('generated-choices', () => state.choices) },
    storyScene: { ...writeMethods(), findFirst: first('scene', () => state.sourceScenes),
      findMany: many('source-scenes', () => state.sourceScenes) },
    storyBeat: { ...writeMethods(), findMany: many('source-beats', () => state.sourceBeats) },
    storyChoice: { ...writeMethods(), findMany: many('source-choices', () => []) },
    storyManuscriptVersion: { ...writeMethods(), findFirst: first('manuscript', () => state.manuscripts) },
    storyAnalysisJob: { ...writeMethods(), findFirst: first('analysis', () => state.analyses) },
    storyWorkGenerationProfile: { ...writeMethods(), findFirst: first('profile', () => state.profiles) },
    $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
      if (!activeTrace || readOnly || sql.strings.join('') !== 'SET TRANSACTION READ ONLY' || sql.values.length) {
        throw new Error('Unexpected transaction SQL');
      }
      readOnly = true; activeTrace.push('READ ONLY'); return 0;
    }),
    $queryRaw: forbid(), $executeRawUnsafe: forbid(),
  };
  const prisma = {
    ...Object.fromEntries(Object.keys(db).filter(key => !key.startsWith('$')).map(key => [key, { findFirst: forbid() }])),
    $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => {
      if (activeTrace) throw new Error('Nested transaction prohibited');
      const trace: string[] = []; traces.push(trace); activeTrace = trace; readOnly = false;
      try { return await callback(db); } finally { trace.push('closed'); activeTrace = null; readOnly = false; }
    }),
  };
  return { state, profile, manuscript, analysis, pin, db, prisma, blocked, traces,
    service: new StoryAuthorBodyPreviewService(prisma as never) };
}
const mutationMethods = ['getOrCreate', 'autoApproveCompany', 'approve', 'update',
  'createDraftAtCompletion', 'onApplicationBootstrap'] as const;
function forbidApproval() {
  return mutationMethods.map(name => jest.spyOn(StoryGenerationProfileService.prototype, name));
}
function assertReadOnly(f: ReturnType<typeof fixture>, approvals: jest.SpyInstance[]) {
  for (const mock of [...f.blocked, ...approvals]) expect(mock).not.toHaveBeenCalled();
  expect(f.db.$executeRaw).toHaveBeenCalledTimes(f.prisma.$transaction.mock.calls.length);
  for (const call of f.prisma.$transaction.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'RepeatableRead' });
  for (const trace of f.traces) {
    expect(trace[0]).toBe('READ ONLY'); expect(trace[trace.length - 1]).toBe('closed');
  }
}
function noCurrentSource(f: ReturnType<typeof fixture>) {
  expect(f.db.storyManuscriptVersion.findFirst).not.toHaveBeenCalled();
  expect(f.db.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
  expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
}
function safe(result: Result, state: Result['currentSourceState'], comparison: Result['diagnostic']['comparison'],
  reason: Result['diagnostic']['reason'], revision: number | null = 7) {
  expect(result).toEqual({
    contract: 'story-author-body-style-reference-read-v1', locale: result.locale,
    sourceScope: 'current_saved_body_and_latest_private_approval', progressRevision: revision,
    readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false,
    semanticQualityVerified: false, dispatchAuthorized: false, currentSourceState: state,
    currentProfileVersion: state === 'validated' ? 4 : null, currentReviewRevision: state === 'validated' ? 3 : null,
    diagnostic: {
      version: 'story-author-body-style-reference-v1', referenceScope: 'stored_completed_origin_request_pin',
      contextSource: 'caller_supplied_metadata', comparison, reason, readOnly: true,
      currentApprovalVerified: false, originalGenerationApprovalVerified: false,
      semanticQualityVerified: false, generatedBodyQualityVerified: false, bodySourceAligned: false,
      dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
    },
  });
  const wire = JSON.stringify(result);
  expect(wire).not.toContain(PRIVATE);
  expect(wire).not.toMatch(/"(?:id|workId|userId|sceneId|progressId|releaseId|path|title|beats|choices|content|section|fingerprint|hash)"/);
  expect(wire).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  expect(wire).not.toMatch(/\b[a-f0-9]{64}\b/i);
  expect(Buffer.byteLength(wire, 'utf8')).toBeLessThan(2048);
}

describe('author stored-body style reference (real snapshot and policy, synthetic read delegates)', () => {
  let f: ReturnType<typeof fixture>, approvals: jest.SpyInstance[];
  beforeEach(() => { f = fixture(); approvals = forbidApproval(); });
  afterEach(() => { try { assertReadOnly(f, approvals); } finally { jest.restoreAllMocks(); } });
  const inspect = async (locale: string = 'en') => {
    const before = snapshot(f.state);
    try { return await f.service.styleReference(owner, workId, { locale }); }
    finally { expect(snapshot(f.state)).toEqual(before); }
  };

  it.each(locales)('AUTHOR-BODY-STYLE-READ: %s compares the completed own body with the validated current approval pin', async locale => {
    f.manuscript.locale = locale;
    const result = await inspect(locale);
    expect(result.locale).toBe(locale);
    safe(result, 'validated', 'same_approval_pin', 'body_style_reference_same_approval_pin');
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-BODY-STYLE-READ: origin and current source use the same tx with exact owner, release and latest unfiltered queries', async () => {
    const readStyle = jest.spyOn(currentStyle, 'readCurrentApprovedStoryStyleSnapshot');
    const policy = jest.spyOn(referencePolicy, 'inspectStoryAuthorBodyStyleReference');
    await inspect();
    expect(readStyle).toHaveBeenCalledTimes(1);
    expect(readStyle).toHaveBeenCalledWith(f.db, owner, workId);
    expect(policy).toHaveBeenLastCalledWith({ bodyKind: 'generated',
      origin: { status: 'completed', contextReferences: f.state.origin.contextReferences }, currentApprovedPin: f.pin() });
    expect(f.db.storyAiContinuation.findFirst).toHaveBeenCalledWith({
      where: { id: originId, userId: owner, workId, progressId, releaseId, status: 'completed', resultGeneratedSceneId: sceneId },
      select: { id: true, status: true, contextReferences: true },
    });
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workId }, orderBy: { profileVersion: 'desc' },
    }));
    expect(f.db.storyManuscriptVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workId, ownerUserId: owner }, orderBy: { version: 'desc' },
    }));
    expect(f.db.storyAnalysisJob.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workId, manuscriptVersionId: manuscriptId, status: 'completed', pipeline: SEMANTIC_PIPELINE },
      orderBy: { analysisVersion: 'desc' },
    }));
    expect(f.traces[0].indexOf('profile')).toBeGreaterThan(f.traces[0].indexOf('origin'));
  });

  it('AUTHOR-BODY-STYLE-READ: a differing stored review revision is metadata difference, never a quality or approval claim', async () => {
    f.state.origin.contextReferences.generationProfilePin.reviewRevision--;
    safe(await inspect(), 'validated', 'different_approval_pin', 'body_style_reference_different_approval_pin');
  });

  it.each(['no progress', 'no scene', 'canonical', 'reused', 'invalid marker', 'null references'])(
    'AUTHOR-BODY-STYLE-READ: %s does not query the current manuscript, analysis or profile', async kind => {
      let reason: Result['diagnostic']['reason'] = 'body_style_reference_no_saved_body';
      let revision: number | null = 7;
      if (kind === 'no progress') { f.state.progress = null; revision = null; }
      if (kind === 'no scene') f.state.progress.currentGeneratedSceneId = null;
      if (kind === 'canonical') {
        f.state.progress.currentGeneratedSceneId = null; f.state.progress.currentSceneId = sourceSceneId;
        reason = 'body_style_reference_canonical_body';
      }
      if (kind === 'reused') {
        f.state.origin.contextReferences.sharedResultReused = true;
        reason = 'body_style_reference_reused_origin_unavailable';
      }
      if (kind === 'invalid marker') {
        f.state.origin.contextReferences.sharedResultReused = 'true';
        reason = 'body_style_reference_origin_unavailable';
      }
      if (kind === 'null references') {
        f.state.origin.contextReferences = null; reason = 'body_style_reference_origin_unavailable';
      }
      safe(await inspect(), 'not_checked', 'unavailable', reason, revision);
      noCurrentSource(f);
    });

  it.each(['legacy missing pin', 'malformed pin'])(
    'AUTHOR-BODY-STYLE-READ: %s can validate current source but cannot invent an origin pin match', async kind => {
      if (kind === 'legacy missing pin') delete f.state.origin.contextReferences.generationProfilePin;
      else f.state.origin.contextReferences.generationProfilePin.profileVersion = 0;
      safe(await inspect(), 'validated', 'unavailable', 'body_style_reference_pin_unavailable');
      expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledTimes(1);
    });

  it.each(['missing manuscript', 'missing analysis', 'new manuscript', 'new needs-review profile', 'invalid approval'])(
    'AUTHOR-BODY-STYLE-READ: %s makes current reference unavailable without hiding or repairing saved body', async kind => {
      if (kind === 'missing manuscript') f.state.manuscripts = [];
      if (kind === 'missing analysis') f.state.analyses = [];
      if (kind === 'new manuscript') f.state.manuscripts.push({ ...f.manuscript, id: uuid(30), version: 4 });
      if (kind === 'new needs-review profile') f.state.profiles.push({
        ...clone(f.profile), id: uuid(31), profileVersion: 5, status: 'needs_review',
      });
      if (kind === 'invalid approval') f.profile.approvedFingerprint = '0'.repeat(64);
      safe(await inspect(), 'unavailable', 'unavailable', 'body_style_reference_pin_unavailable');
      const before = snapshot(f.state);
      const preview = await f.service.preview(owner, workId, { locale: 'en' });
      expect(preview.progress?.scene?.title).toBe(PRIVATE);
      expect(preview.progress?.scene?.beats[0].content).toBe('a'.repeat(100));
      expect(snapshot(f.state)).toEqual(before);
      expect(f.db.storyWorkGenerationProfile.findFirst.mock.calls.length).toBeLessThanOrEqual(1);
    });

  it('AUTHOR-BODY-STYLE-READ: an unknown DB failure propagates instead of being mislabeled current-source unavailable', async () => {
    const error = new Error('Synthetic database failure');
    f.db.storyManuscriptVersion.findFirst.mockRejectedValueOnce(error);
    await expect(inspect()).rejects.toBe(error);
    expect(f.db.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
  });

  const changed: Array<[string, (state: Row) => void]> = [
    ['progress release', s => { s.progress.activeReleaseId = uuid(90); }],
    ['published version', s => { s.work.publishedVersion = 2; }],
    ['generated progress', s => { s.generated.progressId = uuid(90); }],
    ['generated owner', s => { s.generated.userId = outsider; }],
    ['generated invalidated', s => { s.generated.status = 'invalidated'; }],
    ['source part work', s => { s.part.workId = uuid(90); }],
    ['origin owner', s => { s.origin.userId = outsider; }],
    ['origin progress', s => { s.origin.progressId = uuid(90); }],
    ['origin release', s => { s.origin.releaseId = uuid(90); }],
    ['origin not completed', s => { s.origin.status = 'failed'; }],
    ['origin wrong result scene', s => { s.origin.resultGeneratedSceneId = uuid(90); }],
  ];
  it.each(changed)('AUTHOR-BODY-STYLE-READ: %s isolation fails before querying private current style', async (_name, mutate) => {
    mutate(f.state);
    await expect(inspect()).rejects.toMatchObject({ status: 409, response: { code: 'STORY_AUTHOR_BODY_PREVIEW_CHANGED' } });
    noCurrentSource(f);
  });

  it('AUTHOR-BODY-STYLE-READ: invalid progress revision is not converted to a numeric diagnostic', async () => {
    f.state.progress.progressRevision = NaN;
    await expect(inspect()).rejects.toMatchObject({ status: 409 });
    noCurrentSource(f);
  });

  it('AUTHOR-BODY-STYLE-READ: preview and length golden responses remain unchanged and keep id-only origin reads', async () => {
    const before = snapshot(f.state);
    expect(await f.service.preview(owner, workId, { locale: 'en' })).toEqual({
      contract: 'story-author-body-preview-v1', workId, locale: 'en', readOnly: true, imageGenerationStarted: false,
      progress: { progressId, revision: 7, status: 'active', storyVersion: 1, currentBeatPosition: 1,
        scene: { id: sceneId, isGenerated: true, title: PRIVATE, endingType: null,
          beats: [{ id: uuid(20), position: 1, type: 'paragraph', content: 'a'.repeat(100) }] },
        choices: [{ id: uuid(21), label: PRIVATE, routeKind: 'generation_required' }] },
    });
    expect(await f.service.lengthDiagnostic(owner, workId, { locale: 'en' })).toMatchObject({
      contract: 'story-author-body-length-v1', locale: 'en', progressRevision: 7,
      referenceScope: 'current_published_original_part', outcome: 'generated_body_checked',
      diagnostic: { narrativeFit: 'within_original_bounds', measuredUnits: 100,
        expectedBounds: { referenceUnits: 100, minUnits: 80, targetUnits: 100, maxUnits: 120 } },
    });
    expect(f.db.storyAiContinuation.findFirst).toHaveBeenCalledTimes(2);
    for (const [query] of f.db.storyAiContinuation.findFirst.mock.calls) expect(query.select).toEqual({ id: true });
    noCurrentSource(f); expect(snapshot(f.state)).toEqual(before);
  });

  it('AUTHOR-BODY-STYLE-READ: canonical IDs and each explicit fresh revision are used without automatic re-read', async () => {
    safe(await inspect(), 'validated', 'same_approval_pin', 'body_style_reference_same_approval_pin');
    f.state.progress.progressRevision = 8;
    const result = await f.service.styleReference(owner.toUpperCase(), workId.toUpperCase(), { locale: 'en' });
    safe(result, 'validated', 'same_approval_pin', 'body_style_reference_same_approval_pin', 8);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(f.db.storyWorkGenerationProfile.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe('author body style reference HTTP (real Nest/JWT/service, synthetic DB)', () => {
  let f: ReturnType<typeof fixture>, approvals: jest.SpyInstance[], app: INestApplication, port: number;
  let token: string, otherToken: string, expiredToken: string, refreshToken: string;
  beforeAll(async () => {
    f = fixture();
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    expiredToken = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: -1 });
    refreshToken = await jwt.signAsync({ sub: owner, tokenType: 'refresh' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyPreviewController], providers: [
      StoryAuthorBodyPreviewService, JwtAuthGuard,
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: PrismaService, useValue: {
        $transaction: (callback: (tx: ReturnType<typeof fixture>['db']) => Promise<unknown>, options: unknown) =>
          f.prisma.$transaction(callback, options),
        user: { findFirst: jest.fn(async ({ where }: { where: Row }) =>
          [owner, outsider].includes(where.id) && where.status === 'active' && where.deletedAt === null ? { id: where.id } : null) },
      } },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app);
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { f = fixture(); approvals = forbidApproval(); });
  afterEach(() => { try { assertReadOnly(f, approvals); } finally { jest.restoreAllMocks(); } });
  afterAll(async () => { await app?.close(); });

  function call(method = 'GET', query = 'locale=en', authorization: string | null = token) {
    return new Promise<{ status: number; cache?: string; cookies: string[]; bytes: number; body: any }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, agent: false,
        path: '/api/v1/me/creator-studio/stories/' + workId + '/body-preview/style-reference' + (query ? '?' + query : ''),
        headers: { connection: 'close', ...(authorization ? { authorization: 'Bearer ' + authorization } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'], cookies: res.headers['set-cookie'] ?? [],
            bytes: raw.length, body: raw.length ? JSON.parse(raw.toString('utf8')) : null }); }
          catch { reject(new Error('Synthetic loopback response was not JSON')); }
        });
      });
      req.setTimeout(10_000, () => req.destroy(new Error('Synthetic loopback timeout')));
      req.on('error', reject); req.end();
    });
  }
  function privateResponse(response: Awaited<ReturnType<typeof call>>) {
    expect(response.cache).toBe('private, no-store'); expect(response.cookies).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
  }
  it.each(['GET', 'HEAD'])('AUTHOR-BODY-STYLE-READ-HTTP: anonymous %s is private 401 before source reads', async method => {
    const response = await call(method, 'locale=en', null);
    expect(response.status).toBe(401); privateResponse(response);
    if (method === 'HEAD') expect(response.bytes).toBe(0);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['GET', 'HEAD'])('AUTHOR-BODY-STYLE-READ-HTTP: owner %s reaches one real read-only snapshot', async method => {
    const before = snapshot(f.state), response = await call(method);
    expect(response.status).toBe(200); privateResponse(response);
    if (method === 'HEAD') { expect(response.bytes).toBe(0); expect(response.body).toBeNull(); }
    else safe(response.body, 'validated', 'same_approval_pin', 'body_style_reference_same_approval_pin');
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1); expect(snapshot(f.state)).toEqual(before);
  });
  it('AUTHOR-BODY-STYLE-READ-HTTP: valid nonowner remains private 404', async () => {
    const response = await call('GET', 'locale=en', otherToken);
    expect(response.status).toBe(404); privateResponse(response); noCurrentSource(f);
  });
  it.each(['expired', 'refresh'])('AUTHOR-BODY-STYLE-READ-HTTP: %s token cannot read a style reference', async kind => {
    const response = await call('GET', 'locale=en', kind === 'expired' ? expiredToken : refreshToken);
    expect(response.status).toBe(401); privateResponse(response);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['locale=fr', 'locale=en&locale=ko', 'unknown=true'])(
    'AUTHOR-BODY-STYLE-READ-HTTP: invalid query %s is private 400 before service', async query => {
      const response = await call('GET', query);
      expect(response.status).toBe(400); privateResponse(response);
      expect(f.prisma.$transaction).not.toHaveBeenCalled();
    });
  it('AUTHOR-BODY-STYLE-READ-HTTP: POST is not a new mutation endpoint', async () => {
    expect((await call('POST')).status).toBe(404); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('AUTHOR-BODY-STYLE-READ-HTTP: changed current release remains private 409', async () => {
    f.state.work.publishedVersion++;
    const response = await call();
    expect(response.status).toBe(409); privateResponse(response); noCurrentSource(f);
    expect(response.body.error.code).toBe('STORY_AUTHOR_BODY_PREVIEW_CHANGED');
  });
  it('AUTHOR-BODY-STYLE-READ-HTTP: latest needs-review profile yields unavailable 200, not older approval or body', async () => {
    f.state.profiles.push({ ...clone(f.profile), id: uuid(30), profileVersion: 5, status: 'needs_review' });
    const before = snapshot(f.state), response = await call();
    expect(response.status).toBe(200); privateResponse(response);
    safe(response.body, 'unavailable', 'unavailable', 'body_style_reference_pin_unavailable');
    expect(snapshot(f.state)).toEqual(before);
  });
  it('AUTHOR-BODY-STYLE-READ-HTTP: unrecognized DB error is private 500, not a successful diagnostic', async () => {
    f.db.storyManuscriptVersion.findFirst.mockRejectedValueOnce(new Error('Synthetic database unavailable'));
    const response = await call();
    expect(response.status).toBe(500); privateResponse(response);
    expect(response.body).not.toHaveProperty('diagnostic');
  });
});

import 'reflect-metadata';
import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { request } from 'http';
import type { AddressInfo } from 'net';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../common/http-exception.filter';
import { configureHttpRouting } from '../common/http-routing';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyPreviewController } from './story-author-body-preview.controller';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import * as narrative from './story-continuation-fixed-cap-narrative-check';
import * as referenceStore from './story-continuation-author-length.store';
import { sourceStoryContinuationLengthBounds } from './story-continuation-length.policy';

const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
type Locale = (typeof locales)[number];
type Row = Record<string, any>;
type Query = { where?: Row; select?: Record<string, boolean>; orderBy?: Row[]; take?: number };
type Result = Awaited<ReturnType<StoryAuthorBodyPreviewService['lengthDiagnostic']>>;
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const owner = uuid(1), outsider = uuid(2), workId = uuid(3), releaseId = uuid(4), progressId = uuid(5);
const partId = uuid(6), sceneId = uuid(7), continuationId = uuid(8), sourceA = uuid(9), sourceB = uuid(10);
const PRIVATE = 'PRIVATE_LENGTH_DIAGNOSTIC_SENTINEL';
const localized = (text: string): Record<string, string> => Object.fromEntries(locales.map(locale => [locale, text]));
const unitByLocale: Record<Locale, string> = {
  ko: '\uac00', en: 'a', ja: '\u3042', 'zh-Hans': '\u95e8', 'zh-Hant': '\u9580',
};

function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      throw new Error('Unsupported synthetic read predicate');
    }
    return row[key] === value;
  });
}

function selected(row: Row, select?: Record<string, boolean>) {
  return structuredClone(select
    ? Object.fromEntries(Object.entries(select).filter(([, enabled]) => enabled).map(([key]) => [key, row[key]]))
    : row);
}

function fixture() {
  const initialProgress = {
    id: progressId, userId: owner, workId, activeReleaseId: releaseId,
    storyVersion: 1, progressRevision: 7, currentBeatPosition: 1, status: 'active',
    currentSceneId: null as string | null, currentGeneratedSceneId: sceneId as string | null,
    routeNodeId: null as string | null, pathSummary: [{ privatePath: PRIVATE }],
  };
  const state = {
    work: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false,
      activeReleaseId: releaseId as string | null, publishedVersion: 1 },
    progress: initialProgress as typeof initialProgress | null,
    release: { id: releaseId, workId, status: 'active', version: 1 },
    generated: { id: sceneId, userId: owner, workId, progressId, releaseId, status: 'ready', sourcePartId: partId,
      continuationId, title: localized(PRIVATE), endingType: null as string | null },
    part: { id: partId, workId, status: 'published', fixtureSource: false },
    origin: { id: continuationId, userId: owner, workId, progressId, releaseId,
      status: 'completed', resultGeneratedSceneId: sceneId },
    generatedBeats: [{ id: uuid(20), sceneId, position: 1, beatType: 'paragraph', content: localized('a'.repeat(100)) }],
    generatedChoices: [{ id: uuid(21), sceneId, position: 1, label: localized(PRIVATE), routeKind: 'generation_required' }],
    sourceScenes: [
      { id: sourceB, partId, position: 2, status: 'published', fixtureSource: false, title: localized(PRIVATE), endingType: null },
      { id: sourceA, partId, position: 1, status: 'published', fixtureSource: false, title: localized(PRIVATE), endingType: null },
      { id: uuid(30), partId, position: 3, status: 'draft', fixtureSource: false, title: localized(PRIVATE), endingType: null },
      { id: uuid(31), partId, position: 4, status: 'published', fixtureSource: true, title: localized(PRIVATE), endingType: null },
      { id: uuid(32), partId: uuid(99), position: 5, status: 'published', fixtureSource: false, title: localized(PRIVATE), endingType: null },
    ],
    sourceBeats: [
      { id: uuid(40), sceneId: sourceA, position: 1, beatType: 'paragraph', content: localized('a'.repeat(40)) },
      { id: uuid(41), sceneId: sourceA, position: 2, beatType: 'scene_break', content: localized(PRIVATE) },
      { id: uuid(42), sceneId: sourceB, position: 1, beatType: 'dialogue', content: localized('b'.repeat(60)) },
      ...[30, 31, 32].map((id, index) => ({ id: uuid(50 + index), sceneId: uuid(id), position: 1,
        beatType: 'paragraph', content: localized(PRIVATE.repeat(100)) })),
    ],
  };
  const writes: jest.Mock[] = [];
  const traces: string[][] = [];
  let activeTrace: string[] | null = null;
  let readOnly = false;
  function read(name: string) {
    if (!activeTrace || !readOnly) throw new Error('Domain read outside READ ONLY transaction');
    activeTrace.push(name);
  }
  function model(name: string, methods: Record<string, jest.Mock>) {
    return { ...methods, ...Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']
      .map(method => {
        const blocked = jest.fn(() => { throw new Error(`${name}.${method} prohibited`); });
        writes.push(blocked);
        return [method, blocked];
      })) };
  }
  const first = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name);
    const row = rows().find(value => matches(value, query.where));
    return row ? selected(row, query.select) : null;
  });
  const many = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name);
    const values = rows().filter(row => matches(row, query.where));
    if (query.orderBy) values.sort((left, right) => {
      for (const order of query.orderBy!) {
        for (const [key, direction] of Object.entries(order)) {
          if (left[key] === right[key]) continue;
          return (left[key] < right[key] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
        }
      }
      return 0;
    });
    return values.slice(0, query.take).map(row => selected(row, query.select));
  });
  const db = {
    storyWork: model('storyWork', { findFirst: first('storyWork.findFirst', () => [state.work]) }),
    storyReaderProgress: model('storyReaderProgress', { findUnique: jest.fn(async (query: Query) => {
      read('storyReaderProgress.findUnique');
      const scope = query.where!.userId_workId;
      return state.progress && state.progress.userId === scope.userId && state.progress.workId === scope.workId
        ? selected(state.progress, query.select) : null;
    }) }),
    storyRelease: model('storyRelease', { findFirst: first('storyRelease.findFirst', () => [state.release]) }),
    storyAiGeneratedScene: model('storyAiGeneratedScene', { findFirst: first('storyAiGeneratedScene.findFirst', () => [state.generated]) }),
    storyPart: model('storyPart', { findFirst: first('storyPart.findFirst', () => [state.part]) }),
    storyAiContinuation: model('storyAiContinuation', { findFirst: first('storyAiContinuation.findFirst', () => [state.origin]) }),
    storyScene: model('storyScene', {
      findFirst: first('storyScene.findFirst', () => state.sourceScenes),
      findMany: many('storyScene.findMany', () => state.sourceScenes),
    }),
    storyBeat: model('storyBeat', { findMany: many('storyBeat.findMany', () => state.sourceBeats) }),
    storyAiGeneratedBeat: model('storyAiGeneratedBeat', { findMany: many('storyAiGeneratedBeat.findMany', () => state.generatedBeats) }),
    storyAiGeneratedChoice: model('storyAiGeneratedChoice', { findMany: many('storyAiGeneratedChoice.findMany', () => state.generatedChoices) }),
    storyChoice: model('storyChoice', { findMany: many('storyChoice.findMany', () => []) }),
    $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
      if (!activeTrace || readOnly || sql.strings.join('') !== 'SET TRANSACTION READ ONLY' || sql.values.length) {
        throw new Error('Unexpected transaction SQL');
      }
      readOnly = true;
      activeTrace.push('READ ONLY');
      return 0;
    }),
    $executeRawUnsafe: jest.fn(() => { throw new Error('Unsafe SQL prohibited'); }),
    $queryRaw: jest.fn(() => { throw new Error('Unexpected raw query'); }),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => {
    if (activeTrace) throw new Error('Nested transaction prohibited');
    const trace: string[] = [];
    traces.push(trace);
    activeTrace = trace;
    readOnly = false;
    try { return await callback(db); } finally { trace.push('closed'); activeTrace = null; readOnly = false; }
  }) };
  return { state, db, prisma, writes, traces, service: new StoryAuthorBodyPreviewService(prisma as never) };
}

function assertReadOnly(f: ReturnType<typeof fixture>) {
  for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  expect(f.db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(f.db.$queryRaw).not.toHaveBeenCalled();
  expect(f.db.$executeRaw).toHaveBeenCalledTimes(f.prisma.$transaction.mock.calls.length);
  for (const call of f.prisma.$transaction.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'RepeatableRead' });
  for (const trace of f.traces) {
    expect(trace[0]).toBe('READ ONLY');
    expect(trace[trace.length - 1]).toBe('closed');
  }
}

function assertEnvelope(result: Result, locale: string, outcome: Result['outcome'], revision: number | null = 7) {
  expect(result).toMatchObject({ contract: 'story-author-body-length-v1', locale, readOnly: true,
    referenceScope: 'current_published_original_part', progressRevision: revision, outcome,
    currentApprovalVerified: false, semanticQualityVerified: false, dispatchAuthorized: false,
    providerCalls: 0, operatingWrites: 0 });
  expect(Object.keys(result).sort()).toEqual(['contract', 'locale', 'readOnly', 'referenceScope', 'progressRevision',
    'outcome', 'currentApprovalVerified', 'semanticQualityVerified', 'dispatchAuthorized', 'providerCalls',
    'operatingWrites', 'diagnostic'].sort());
  expect(result.progressRevision === null || Number.isSafeInteger(result.progressRevision)).toBe(true);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(PRIVATE);
  expect(serialized).not.toMatch(/"(?:title|content|beats|workId|userId|sceneId|partId|progressId|releaseId|continuationId|path|pathSummary|choices|fingerprint|hash|error|stack)"/);
  expect(serialized).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  expect(serialized).not.toMatch(/\b[a-f0-9]{40}(?:[a-f0-9]{24})?\b/i);
  if (result.diagnostic) expect(result.diagnostic).toMatchObject({ version: 'story-fixed-cap-narrative-v1',
    currentApprovalVerified: false, providerReceiptVerified: false, semanticQualityVerified: false,
    dispatchAuthorized: false, providerCalls: 0 });
}

describe('author saved body length service (synthetic read delegates, real length policy)', () => {
  let f: ReturnType<typeof fixture>;
  const diagnose = async (locale: string = 'en') => {
    const before = structuredClone(f.state);
    try { return await f.service.lengthDiagnostic(owner, workId, { locale }); }
    finally { expect(f.state).toEqual(before); }
  };
  beforeEach(() => { f = fixture(); });
  afterEach(() => { try { assertReadOnly(f); } finally { jest.restoreAllMocks(); } });

  it.each(locales)('AUTHOR-BODY-LENGTH: checks the exact %s saved projection against the full published part', async locale => {
    f.state.generatedBeats[0].content[locale] = `${unitByLocale[locale]} \n`.repeat(100);
    const result = await diagnose(locale);
    assertEnvelope(result, locale, 'generated_body_checked');
    expect(result.diagnostic).toEqual(narrative.inspectStoryContinuationFixedCapNarrative({ locale,
      beats: [{ beatType: 'paragraph', content: { [locale]: f.state.generatedBeats[0].content[locale] } }],
    }, sourceStoryContinuationLengthBounds(locale, [{ beatType: 'paragraph', content: 'a'.repeat(100) }])));
    expect(result.diagnostic).toMatchObject({ narrativeFit: 'within_original_bounds', measuredUnits: 100,
      expectedBounds: { referenceUnits: 100, minUnits: 80, targetUnits: 100, maxUnits: 120 } });
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-BODY-LENGTH: uses exact published-part filters and sentinel takes inside the same READ ONLY snapshot', async () => {
    const inspect = jest.spyOn(narrative, 'inspectStoryContinuationFixedCapNarrative');
    const original = jest.spyOn(referenceStore, 'authoredPartContinuationLengthBounds');
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(original).toHaveBeenCalledWith(f.db, partId, 'en');
    expect(original).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(f.db.storyWork.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false },
    }));
    expect(f.db.storyReaderProgress.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_workId: { userId: owner, workId } },
      select: expect.objectContaining({ progressRevision: true }),
    }));
    expect(f.db.storyAiGeneratedScene.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: sceneId, userId: owner, workId, progressId, releaseId, status: 'ready' },
    }));
    expect(f.db.storyAiContinuation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: continuationId, userId: owner, workId, progressId, releaseId,
        status: 'completed', resultGeneratedSceneId: sceneId },
    }));
    expect(f.db.storyScene.findMany).toHaveBeenCalledWith({ where: { partId, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true }, take: 101 });
    expect(f.db.storyBeat.findMany).toHaveBeenCalledWith({ where: { sceneId: { in: [sourceA, sourceB] } },
      select: { beatType: true, content: true }, take: 1_001 });
    expect(result.diagnostic?.expectedBounds?.referenceUnits).toBe(100);
    expect(f.traces).toHaveLength(1);
    expect(f.traces[0].indexOf('storyScene.findMany')).toBeGreaterThan(f.traces[0].indexOf('storyAiGeneratedBeat.findMany'));
  });

  it('AUTHOR-BODY-LENGTH: never substitutes the generated body or the first source scene for the whole original floor', async () => {
    f.state.generatedBeats[0].content.en = 'a'.repeat(40);
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(result.diagnostic).toMatchObject({ narrativeFit: 'underlength', reason: 'continuation_output_underlength',
      measuredUnits: null, expectedBounds: { referenceUnits: 100, minUnits: 80 } });
  });

  it.each([80, 120])('AUTHOR-BODY-LENGTH: retains the inclusive original bound at %i units', async units => {
    f.state.generatedBeats[0].content.en = 'a'.repeat(units);
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(result.diagnostic).toMatchObject({ narrativeFit: 'within_original_bounds', measuredUnits: units });
  });

  it.each([
    { units: 79, fit: 'underlength', reason: 'continuation_output_underlength' },
    { units: 121, fit: 'overlength', reason: 'continuation_output_overlength' },
  ])('AUTHOR-BODY-LENGTH: $fit is a checked saved body, not a measured or successful generation claim', async ({ units, fit, reason }) => {
    f.state.generatedBeats[0].content.en = 'a'.repeat(units);
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(result.diagnostic).toMatchObject({ narrativeFit: fit, reason, measuredUnits: null, utf8Bytes: null, beatCount: null });
  });

  it.each([
    { name: 'beat kind', type: 'narration', text: 'a'.repeat(100), reason: 'author_length_beat_type_invalid' },
    { name: 'long string', type: 'paragraph', text: 'a'.repeat(16_001), reason: 'author_length_text_invalid' },
    { name: 'multibyte byte limit', type: 'paragraph', text: '\u{1f642}'.repeat(4_001), reason: 'author_length_byte_limit' },
  ])('AUTHOR-BODY-LENGTH: projection-valid $name reaches the existing typed narrative diagnostic', async ({ type, text, reason }) => {
    f.state.generatedBeats[0].beatType = type;
    f.state.generatedBeats[0].content.en = text;
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(result.diagnostic).toMatchObject({ narrativeFit: 'unmeasured', reason, measuredUnits: null, utf8Bytes: null, beatCount: null });
  });

  it('AUTHOR-BODY-LENGTH: diagnostic byte overflow is not hidden by the larger existing preview response bound', async () => {
    f.state.generatedBeats = Array.from({ length: 7 }, (_, index) => ({ ...f.state.generatedBeats[0],
      id: uuid(100 + index), position: index + 1, content: localized('a'.repeat(15_000)) }));
    const result = await diagnose();
    assertEnvelope(result, 'en', 'generated_body_checked');
    expect(result.diagnostic).toMatchObject({ narrativeFit: 'unmeasured', reason: 'author_length_byte_limit', measuredUnits: null });
  });

  it.each(['no progress', 'no current scene'])('AUTHOR-BODY-LENGTH: %s returns null without any original-bound reads', async kind => {
    if (kind === 'no progress') f.state.progress = null;
    else f.state.progress!.currentGeneratedSceneId = null;
    const result = await diagnose();
    assertEnvelope(result, 'en', 'no_saved_body', kind === 'no progress' ? null : 7);
    expect(result.diagnostic).toBeNull();
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
    expect(f.db.storyBeat.findMany).not.toHaveBeenCalled();
  });

  it.each(['active', 'completed'])('AUTHOR-BODY-LENGTH: %s canonical body stays readable but is not diagnosed as generated', async status => {
    f.state.progress!.currentGeneratedSceneId = null;
    f.state.progress!.currentSceneId = sourceA;
    f.state.progress!.status = status;
    const result = await diagnose();
    assertEnvelope(result, 'en', 'canonical_body_only');
    expect(result.diagnostic).toBeNull();
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
    expect(f.db.storyBeat.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { sceneId: sourceA }, take: 41 }));
    expect(f.db.storyAiGeneratedScene.findFirst).not.toHaveBeenCalled();
  });

  it.each(['other owner', 'draft', 'fixture'])('AUTHOR-BODY-LENGTH: work %s cannot expand private read ownership', async kind => {
    if (kind === 'other owner') f.state.work.ownerUserId = outsider;
    if (kind === 'draft') f.state.work.status = 'draft';
    if (kind === 'fixture') f.state.work.fixtureSource = true;
    await expect(diagnose()).rejects.toBeInstanceOf(NotFoundException);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['wrong work', 'draft', 'fixture'])('AUTHOR-BODY-LENGTH: source part %s fails before original-bound reads', async kind => {
    if (kind === 'wrong work') f.state.part.workId = uuid(99);
    if (kind === 'draft') f.state.part.status = 'draft';
    if (kind === 'fixture') f.state.part.fixtureSource = true;
    await expect(diagnose()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['owner', 'progress', 'ready'])('AUTHOR-BODY-LENGTH: generated %s must match the current snapshot', async kind => {
    if (kind === 'owner') f.state.generated.userId = outsider;
    if (kind === 'progress') f.state.generated.progressId = uuid(99);
    if (kind === 'ready') f.state.generated.status = 'failed';
    await expect(diagnose()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled();
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['completed', 'result scene', 'release'])('AUTHOR-BODY-LENGTH: origin %s cannot be substituted with another receipt', async kind => {
    if (kind === 'completed') f.state.origin.status = 'queued';
    if (kind === 'result scene') f.state.origin.resultGeneratedSceneId = uuid(99);
    if (kind === 'release') f.state.origin.releaseId = uuid(99);
    await expect(diagnose()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['missing work release', 'changed progress release', 'retired release', 'changed version'])('AUTHOR-BODY-LENGTH: %s is a private conflict, not fallback reference evidence', async kind => {
    if (kind === 'missing work release') f.state.work.activeReleaseId = null;
    if (kind === 'changed progress release') f.state.progress!.activeReleaseId = uuid(99);
    if (kind === 'retired release') f.state.release.status = 'retired';
    if (kind === 'changed version') f.state.work.publishedVersion++;
    await expect(diagnose()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['id', 'position'])('AUTHOR-BODY-LENGTH: duplicate generated beat %s retains the existing preview conflict', async field => {
    f.state.generatedBeats.push({ ...f.state.generatedBeats[0], id: field === 'id' ? uuid(20) : uuid(22),
      position: field === 'position' ? 1 : 2 });
    await expect(diagnose()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['title', 'beat'])('AUTHOR-BODY-LENGTH: missing requested %s translation cannot use a different locale', async kind => {
    delete (kind === 'title' ? f.state.generated.title : f.state.generatedBeats[0].content).en;
    await expect(diagnose()).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_PREVIEW_TRANSLATION_UNAVAILABLE' } });
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-LENGTH: explicit original-reader failure is private unavailable, never a default anchor', async () => {
    jest.spyOn(referenceStore, 'authoredPartContinuationLengthBounds').mockRejectedValue(new Error(PRIVATE));
    const inspect = jest.spyOn(narrative, 'inspectStoryContinuationFixedCapNarrative');
    const result = await diagnose();
    assertEnvelope(result, 'en', 'original_reference_unavailable');
    expect(result.diagnostic).toBeNull();
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['missing locale', 'per-text overflow', 'total overflow'])('AUTHOR-BODY-LENGTH: original %s is unavailable without clipping or selecting another locale', async kind => {
    if (kind === 'missing locale') delete f.state.sourceBeats[0].content.en;
    if (kind === 'per-text overflow') f.state.sourceBeats[0].content.en = 'a'.repeat(32_001);
    if (kind === 'total overflow') f.state.sourceBeats = Array.from({ length: 9 }, (_, index) => ({
      id: uuid(300 + index), sceneId: sourceA, position: index + 1, beatType: 'paragraph', content: localized('a'.repeat(30_000)),
    }));
    const result = await diagnose();
    assertEnvelope(result, 'en', 'original_reference_unavailable');
    expect(result.diagnostic).toBeNull();
  });

  it.each(['scenes', 'beats'])('AUTHOR-BODY-LENGTH: original %s sentinel overflow cannot silently use the first valid subset', async kind => {
    if (kind === 'scenes') f.state.sourceScenes = Array.from({ length: 101 }, (_, index) => ({
      ...f.state.sourceScenes[0], id: uuid(500 + index), position: index + 1,
    }));
    else f.state.sourceBeats = Array.from({ length: 1_001 }, (_, index) => ({
      ...f.state.sourceBeats[0], id: uuid(1_000 + index), position: index + 1,
    }));
    const result = await diagnose();
    assertEnvelope(result, 'en', 'original_reference_unavailable');
    expect(result.diagnostic).toBeNull();
  });

  it('AUTHOR-BODY-LENGTH: no published original scenes cannot be replaced by the generated result', async () => {
    f.state.sourceScenes = [];
    const result = await diagnose();
    assertEnvelope(result, 'en', 'original_reference_unavailable');
    expect(result.diagnostic).toBeNull();
    expect(f.db.storyBeat.findMany).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-LENGTH: empty original narrative is unavailable rather than a zero or invented target', async () => {
    for (const beat of f.state.sourceBeats) if (beat.sceneId === sourceA || beat.sceneId === sourceB) beat.content.en = ' \n\t';
    const result = await diagnose();
    assertEnvelope(result, 'en', 'original_reference_unavailable');
    expect(result.diagnostic).toBeNull();
  });

  it('AUTHOR-BODY-LENGTH: each explicit read reports its fresh revision snapshot and accepts validated uppercase IDs', async () => {
    assertEnvelope(await diagnose(), 'en', 'generated_body_checked', 7);
    f.state.progress!.progressRevision = 8;
    const before = structuredClone(f.state);
    const result = await f.service.lengthDiagnostic(owner.toUpperCase(), workId.toUpperCase(), { locale: 'en' });
    assertEnvelope(result, 'en', 'generated_body_checked', 8);
    expect(f.state).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('AUTHOR-BODY-LENGTH: existing preview retains its complete golden response and no original-bound read', async () => {
    const before = structuredClone(f.state);
    expect(await f.service.preview(owner, workId, { locale: 'en' })).toEqual({
      contract: 'story-author-body-preview-v1', workId, locale: 'en', readOnly: true, imageGenerationStarted: false,
      progress: { progressId, revision: 7, status: 'active', storyVersion: 1, currentBeatPosition: 1,
        scene: { id: sceneId, isGenerated: true, title: PRIVATE, endingType: null,
          beats: [{ id: uuid(20), position: 1, type: 'paragraph', content: 'a'.repeat(100) }] },
        choices: [{ id: uuid(21), label: PRIVATE, routeKind: 'generation_required' }] },
    });
    expect(f.state).toEqual(before);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
    expect(f.db.storyBeat.findMany).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('author body length HTTP (real Nest/JWT and service, synthetic DB)', () => {
  let f: ReturnType<typeof fixture>;
  let app: INestApplication, port: number, token: string, otherToken: string;
  beforeAll(async () => {
    f = fixture();
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyPreviewController], providers: [
      StoryAuthorBodyPreviewService, JwtAuthGuard,
      { provide: JwtService, useValue: jwt }, { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: PrismaService, useValue: {
        $transaction: (callback: (tx: ReturnType<typeof fixture>['db']) => Promise<unknown>, options: unknown) => f.prisma.$transaction(callback, options),
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
  beforeEach(() => { f = fixture(); });
  afterEach(() => { assertReadOnly(f); });
  afterAll(async () => { await app?.close(); });

  function call(method = 'GET', query = 'locale=en', authorization: string | null = token) {
    return new Promise<{ status: number; cache?: string; bytes: number; body: any; cookies: string[] }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, agent: false,
        path: `/api/v1/me/creator-studio/stories/${workId}/body-preview/length-diagnostic${query ? `?${query}` : ''}`,
        headers: { connection: 'close', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'], bytes: raw.length,
            body: raw.length ? JSON.parse(raw.toString('utf8')) : null, cookies: res.headers['set-cookie'] ?? [] }); }
          catch { reject(new Error('Synthetic local HTTP response was not JSON')); }
        });
      });
      req.setTimeout(10_000, () => req.destroy(new Error('Synthetic local HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  it.each(['GET', 'HEAD'])('AUTHOR-BODY-LENGTH-HTTP: anonymous %s is 401 with private no-store and no source', async method => {
    const response = await call(method, 'locale=en', null);
    expect(response.status).toBe(401);
    expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
    if (method === 'HEAD') expect(response.bytes).toBe(0);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD'])('AUTHOR-BODY-LENGTH-HTTP: real owner JWT %s reaches the real read-only service', async method => {
    const before = structuredClone(f.state);
    const response = await call(method);
    expect(response.status).toBe(200);
    expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    if (method === 'HEAD') { expect(response.bytes).toBe(0); expect(response.body).toBeNull(); }
    else { assertEnvelope(response.body, 'en', 'generated_body_checked'); expect(response.body.diagnostic.measuredUnits).toBe(100); }
    expect(f.state).toEqual(before);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AUTHOR-BODY-LENGTH-HTTP: a valid nonowner JWT remains 404 with no private source or cookies', async () => {
    const response = await call('GET', 'locale=en', otherToken);
    expect(response.status).toBe(404);
    expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });

  it.each(['locale=fr', 'locale=en&locale=ko', 'unknown=true'])('AUTHOR-BODY-LENGTH-HTTP: invalid or expanded query %s is uncached 400 before service reads', async query => {
    const response = await call('GET', query);
    expect(response.status).toBe(400);
    expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-LENGTH-HTTP: no POST mutation route is introduced', async () => {
    expect((await call('POST')).status).toBe(404);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('AUTHOR-BODY-LENGTH-HTTP: changed current release is a private 409 without a fallback diagnostic', async () => {
    f.state.work.publishedVersion++;
    const response = await call();
    expect(response.status).toBe(409);
    expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain(PRIVATE);
    expect(response.body.error.code).toBe('STORY_AUTHOR_BODY_PREVIEW_CHANGED');
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });
});

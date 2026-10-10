import 'reflect-metadata';
import { ForbiddenException, HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
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

const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
type Locale = (typeof locales)[number];
type Row = Record<string, any>;
type Query = { where?: Row; select?: Record<string, boolean>; orderBy?: Row[]; take?: number };
type Result = Awaited<ReturnType<StoryAuthorBodyPreviewService['originalReference']>>;
const uuid = (n: number) => `aa000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const owner = uuid(1), outsider = uuid(2), workId = uuid(3), releaseId = uuid(4), progressId = uuid(5);
const partId = uuid(6), generatedId = uuid(7), originId = uuid(8), sourceA = uuid(9), sourceB = uuid(10);
const PRIVATE = 'UNPROJECTED_METADATA_SENTINEL', EXCLUDED = 'EXCLUDED_SOURCE_SENTINEL';
const words: Record<Locale, string> = { ko: '\uc6d0\ubb38', en: 'Original', ja: '\u539f\u6587',
  'zh-Hans': '\u539f\u6587\u95e8', 'zh-Hant': '\u539f\u6587\u9580' };
const localized = (suffix: string): Row => Object.fromEntries(locales.map(locale => [locale, `${words[locale]}${suffix}`]));
const rawText = (text: string): Row => Object.fromEntries(locales.map(locale => [locale, text]));
function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
      throw new Error('Unsupported synthetic query predicate');
    }
    return row[key] === value;
  });
}
function project(row: Row, select?: Record<string, boolean>) {
  return structuredClone(select ? Object.fromEntries(Object.entries(select)
    .filter(([, enabled]) => enabled).map(([key]) => [key, row[key]])) : row);
}
function snapshot(value: unknown): string {
  // Preserve every JSON-data key/order and malformed scalar without comparing realm prototypes.
  const encode = (item: unknown): unknown => {
    if (item === null) return ['null'];
    if (item === undefined) return ['undefined'];
    if (typeof item === 'number') return ['number', Object.is(item, -0) ? '-0' : String(item)];
    if (typeof item === 'string' || typeof item === 'boolean') return [typeof item, item];
    if (typeof item !== 'object') throw new Error('Unsupported fixture snapshot value');
    const entries = Object.entries(item).map(([key, entry]) => [key, encode(entry)]);
    return Array.isArray(item) ? ['array', item.length, entries] : ['object', entries];
  };
  return JSON.stringify(encode(value));
}
function fixture() {
  const state: Record<string, Row[]> = {
    users: [owner, outsider].map(id => ({ id, status: 'active', deletedAt: null })),
    works: [{ id: workId, ownerUserId: owner, status: 'published', fixtureSource: false,
      activeReleaseId: releaseId, publishedVersion: 1, privateMetadata: PRIVATE }],
    progress: [{ id: progressId, userId: owner, workId, activeReleaseId: releaseId, storyVersion: 1,
      progressRevision: 7, status: 'active', currentBeatPosition: 1, currentSceneId: null,
      currentGeneratedSceneId: generatedId, routeNodeId: null, pathSummary: [{ secret: PRIVATE }] }],
    releases: [{ id: releaseId, workId, status: 'active', version: 1 }],
    parts: [{ id: partId, workId, status: 'published', fixtureSource: false }],
    generated: [{ id: generatedId, userId: owner, workId, progressId, releaseId, status: 'ready',
      sourcePartId: partId, continuationId: originId, title: localized(' saved'), endingType: null }],
    origins: [{ id: originId, userId: owner, workId, progressId, releaseId, status: 'completed',
      resultGeneratedSceneId: generatedId, contextReferences: { private: PRIVATE } }],
    generatedBeats: [{ id: uuid(20), sceneId: generatedId, position: 1, beatType: 'paragraph',
      content: localized(' saved body\nEXACT TAIL') }],
    generatedChoices: [{ id: uuid(21), sceneId: generatedId, position: 1,
      label: rawText(PRIVATE), routeKind: 'generation_required' }],
    scenes: [
      { id: sourceB, partId, position: 2, status: 'published', fixtureSource: false, title: localized(' B'), endingType: null },
      { id: sourceA, partId, position: 1, status: 'published', fixtureSource: false, title: localized(' A'), endingType: null },
      ...[30, 31, 32].map((n, i) => ({ id: uuid(n), partId: i === 2 ? uuid(99) : partId, position: i + 3,
        status: i === 0 ? 'draft' : 'published', fixtureSource: i === 1, title: rawText(EXCLUDED), endingType: null })),
    ],
    beats: [
      { id: uuid(42), sceneId: sourceB, position: 1, beatType: 'dialogue', content: localized(' tail '.repeat(80) + 'END') },
      { id: uuid(41), sceneId: sourceA, position: 2, beatType: 'scene_break', content: localized('\n---\n') },
      { id: uuid(40), sceneId: sourceA, position: 1, beatType: 'paragraph', content: localized(' first \n  exact spacing') },
      ...[30, 31, 32].map((n, i) => ({ id: uuid(50 + i), sceneId: uuid(n), position: 1,
        beatType: 'paragraph', content: rawText(EXCLUDED) })),
    ],
    choices: [],
  };
  const writes: jest.Mock[] = [], traces: string[][] = [];
  let trace: string[] | null = null, readOnly = false;
  const read = (name: string) => {
    if (!trace || !readOnly) throw new Error('Read outside READ ONLY snapshot');
    trace.push(name);
  };
  const first = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name);
    const row = rows().find(item => matches(item, query.where));
    return row ? project(row, query.select) : null;
  });
  const many = (name: string, rows: () => Row[]) => jest.fn(async (query: Query) => {
    read(name);
    const rowsToReturn = rows().filter(row => matches(row, query.where));
    rowsToReturn.sort((a, b) => {
      for (const order of query.orderBy ?? []) for (const [key, direction] of Object.entries(order)) {
        if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
    return rowsToReturn.slice(0, query.take).map(row => project(row, query.select));
  });
  const model = (name: string, methods: Record<string, jest.Mock>) => ({
    ...methods, ...Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']
      .map(method => {
        const write = jest.fn(() => { throw new Error(`${name}.${method} forbidden`); });
        writes.push(write); return [method, write];
      })),
  });
  const db = {
    storyWork: model('storyWork', { findFirst: first('work', () => state.works) }),
    storyReaderProgress: model('storyReaderProgress', { findUnique: jest.fn(async (query: Query) => {
      read('progress');
      const row = state.progress.find(item => matches(item, query.where!.userId_workId));
      return row ? project(row, query.select) : null;
    }) }),
    storyRelease: model('storyRelease', { findFirst: first('release', () => state.releases) }),
    storyPart: model('storyPart', { findFirst: first('part', () => state.parts) }),
    storyAiGeneratedScene: model('storyAiGeneratedScene', { findFirst: first('generated', () => state.generated) }),
    storyAiContinuation: model('storyAiContinuation', { findFirst: first('origin', () => state.origins) }),
    storyScene: model('storyScene', { findFirst: first('scene', () => state.scenes), findMany: many('scenes', () => state.scenes) }),
    storyBeat: model('storyBeat', { findMany: many('beats', () => state.beats) }),
    storyAiGeneratedBeat: model('storyAiGeneratedBeat', { findMany: many('savedBeats', () => state.generatedBeats) }),
    storyAiGeneratedChoice: model('storyAiGeneratedChoice', { findMany: many('savedChoices', () => state.generatedChoices) }),
    storyChoice: model('storyChoice', { findMany: many('choices', () => state.choices) }),
    $executeRaw: jest.fn(async (sql: { strings: readonly string[]; values: unknown[] }) => {
      if (!trace || readOnly || sql.strings.join('') !== 'SET TRANSACTION READ ONLY' || sql.values.length) {
        throw new Error('Unexpected transaction SQL');
      }
      readOnly = true; trace.push('READ ONLY'); return 0;
    }),
    $executeRawUnsafe: jest.fn(() => { throw new Error('Unsafe SQL forbidden'); }),
    $queryRaw: jest.fn(() => { throw new Error('Raw query forbidden'); }),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => {
    if (trace) throw new Error('Nested transaction forbidden');
    trace = []; traces.push(trace); readOnly = false;
    try { return await callback(db); } finally { trace.push('closed'); trace = null; readOnly = false; }
  }) };
  const service = new StoryAuthorBodyPreviewService(prisma as never);
  const checked = async <T>(operation: () => Promise<T>) => {
    const before = snapshot(state);
    try { return await operation(); } finally { expect(snapshot(state)).toBe(before); }
  };
  return { state, db, prisma, service, writes, traces, checked,
    call: (locale = 'en', user = owner, work = workId) => checked(() => service.originalReference(user, work, { locale })) };
}
type Fixture = ReturnType<typeof fixture>;
function assertReadOnly(f: Fixture) {
  for (const write of f.writes) expect(write).not.toHaveBeenCalled();
  expect(f.db.$executeRawUnsafe).not.toHaveBeenCalled();
  expect(f.db.$queryRaw).not.toHaveBeenCalled();
  expect(f.db.$executeRaw).toHaveBeenCalledTimes(f.prisma.$transaction.mock.calls.length);
  for (const call of f.prisma.$transaction.mock.calls) expect(call[1]).toEqual({ isolationLevel: 'RepeatableRead' });
  for (const trace of f.traces) { expect(trace[0]).toBe('READ ONLY'); expect(trace[trace.length - 1]).toBe('closed'); }
}
function envelope(locale: string, outcome: Result['outcome'] = 'reference_ready', revision: number | null = 7) {
  return { contract: 'story-author-body-original-reference-v1', workId, locale, readOnly: true,
    referenceScope: 'current_published_original_part', progressRevision: revision, semanticQualityVerified: false,
    bodySourceAligned: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0, outcome };
}
function expectedReference(f: Fixture, locale: string) {
  const scenes = f.state.scenes.filter(row => row.partId === partId && row.status === 'published' && row.fixtureSource === false);
  return { ...envelope(locale), original: { scenes: [...scenes].sort((a, b) => a.position - b.position).map(scene => ({
    position: scene.position, title: scene.title[locale], beats: f.state.beats.filter(row => row.sceneId === scene.id)
      .sort((a, b) => a.position - b.position).map(beat => ({ position: beat.position, type: beat.beatType, content: beat.content[locale] })),
  })) }, savedBody: { isGenerated: true, title: f.state.generated[0].title[locale],
    beats: f.state.generatedBeats.map(row => ({ position: row.position, type: row.beatType, content: row.content[locale] })) } };
}
function assertEnvelope(result: Result, locale = 'en') {
  expect(result).toMatchObject(envelope(locale, result.outcome, result.progressRevision));
  expect(Object.keys(result).sort()).toEqual([...Object.keys(envelope(locale)), 'original', 'savedBody'].sort());
  const serialized = JSON.stringify(result);
  expect(serialized.includes(PRIVATE) || serialized.includes(EXCLUDED)).toBe(false);
  expect(serialized).not.toMatch(/"(?:id|userId|partId|sceneId|progressId|releaseId|contextReferences|pathSummary|choices|fingerprint|hash)":/);
  expect(result.workId).toBe(workId);
}
async function rejectRead(f: Fixture, status = 409, code = 'STORY_AUTHOR_BODY_PREVIEW_CHANGED') {
  const error: unknown = await f.call().then(() => null, failure => failure);
  expect(error).toBeInstanceOf(HttpException);
  if (!(error instanceof HttpException)) throw new Error('Expected safe rejection');
  expect(error.getStatus()).toBe(status); expect(error.getResponse()).toEqual({ code });
}

describe('AUTHOR-ORIGINAL-REFERENCE service: real projection, synthetic read delegates', () => {
  let f: Fixture;
  beforeEach(() => { f = fixture(); });
  afterEach(() => { assertReadOnly(f); });
  it.each(locales)('preserves the complete %s original part and saved text without alignment claims', async locale => {
    const result = await f.call(locale);
    assertEnvelope(result, locale); expect(result).toEqual(expectedReference(f, locale));
    expect(result.original!.scenes.map(scene => scene.position)).toEqual([1, 2]);
    expect(result.original!.scenes[0].beats[1].type).toBe('scene_break');
    expect(result.original!.scenes[1].beats[0].content.endsWith('END')).toBe(true);
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it('uses exact published-part filters, sentinel takes, selects and complete origin scope', async () => {
    await f.call();
    expect(f.db.storyScene.findMany).toHaveBeenCalledWith({ where: { partId, status: 'published', fixtureSource: false },
      orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 101, select: { id: true, position: true, title: true } });
    expect(f.db.storyBeat.findMany).toHaveBeenCalledWith({ where: { sceneId: { in: [sourceA, sourceB] } },
      orderBy: [{ sceneId: 'asc' }, { position: 'asc' }, { id: 'asc' }], take: 1001,
      select: { id: true, position: true, beatType: true, content: true, sceneId: true } });
    expect(f.db.storyAiContinuation.findFirst).toHaveBeenCalledWith({
      where: { id: originId, userId: owner, workId, progressId, releaseId, status: 'completed', resultGeneratedSceneId: generatedId },
      select: { id: true } });
    expect(f.traces).toHaveLength(1);
    expect(f.traces[0].indexOf('scenes')).toBeGreaterThan(f.traces[0].indexOf('savedBeats'));
  });
  it.each(['no progress', 'no scene'])('%s returns null references without original reads', async state => {
    if (state === 'no progress') f.state.progress = []; else f.state.progress[0].currentGeneratedSceneId = null;
    const result = await f.call(); assertEnvelope(result);
    expect(result).toEqual({ ...envelope('en', 'no_saved_body', state === 'no progress' ? null : 7), original: null, savedBody: null });
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled(); expect(f.db.storyBeat.findMany).not.toHaveBeenCalled();
  });
  it('checks the owner even when no saved body exists', async () => {
    f.state.progress = [];
    await expect(f.call('en', outsider)).rejects.toMatchObject({ status: 404 });
    expect(f.db.storyReaderProgress.findUnique).not.toHaveBeenCalled();
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });
  it('allows the current canonical body without querying a generated origin', async () => {
    Object.assign(f.state.progress[0], { currentGeneratedSceneId: null, currentSceneId: sourceA });
    const result = await f.call(); assertEnvelope(result);
    expect(result.savedBody).toEqual({ isGenerated: false, title: f.state.scenes[1].title.en,
      beats: expectedReference(f, 'en').original.scenes[0].beats });
    expect(f.db.storyAiContinuation.findFirst).not.toHaveBeenCalled();
  });
  it('canonicalizes valid uppercase UUID input without changing the response identity', async () => {
    const result = await f.call('en', owner.toUpperCase(), workId.toUpperCase());
    expect(result.workId).toBe(workId); assertEnvelope(result);
  });
  it('accepts unusual ordered gaps and positions beyond count caps without truncating them', async () => {
    f.state.scenes[1].position = 101; f.state.scenes[0].position = 10001;
    f.state.beats.find(row => row.id === uuid(40))!.position = 1001;
    f.state.beats.find(row => row.id === uuid(41))!.position = 90001;
    const result = await f.call();
    expect(result.original!.scenes.map(scene => scene.position)).toEqual([101, 10001]);
    expect(result.original!.scenes[0].beats.map(beat => beat.position)).toEqual([1001, 90001]);
  });
  it('preserves valid surrogate pairs, newlines and spacing rather than normalizing text', async () => {
    f.state.beats[0].content.en = ' \u{1f642}\n\u{10ffff}\t END ';
    expect((await f.call()).original!.scenes[1].beats[0].content).toBe(f.state.beats[0].content.en);
  });
  it('accepts exactly 100 scenes and 1000 beats as full arrays', async () => {
    f.state.scenes = Array.from({ length: 100 }, (_, i) => ({ id: uuid(100 + i), partId, position: i * 3 + 1,
      status: 'published', fixtureSource: false, title: rawText('Scene'), endingType: null })).reverse();
    f.state.beats = Array.from({ length: 1000 }, (_, i) => ({ id: uuid(1000 + i), sceneId: uuid(100 + Math.floor(i / 10)),
      position: (i % 10) * 11 + 1, beatType: 'paragraph', content: rawText('Full') })).reverse();
    const result = await f.call();
    expect(result.original!.scenes).toHaveLength(100);
    expect(result.original!.scenes.reduce((n, scene) => n + scene.beats.length, 0)).toBe(1000);
    expect(result.original!.scenes[99].beats[9].position).toBe(100);
  });
  it('enforces the complete response 256KiB limit, not only individual strings', async () => {
    f.state.scenes = [f.state.scenes[1]];
    f.state.beats = Array.from({ length: 5 }, (_, i) => ({ id: uuid(200 + i), sceneId: sourceA, position: i + 1,
      beatType: 'paragraph', content: rawText(i < 4 ? 'a'.repeat(64000) : 'x') }));
    const initialBytes = Buffer.byteLength(JSON.stringify(expectedReference(f, 'en')), 'utf8');
    expect(initialBytes).toBeLessThan(256 * 1024);
    f.state.beats[4].content.en += 'a'.repeat(256 * 1024 - initialBytes);
    expect(Buffer.byteLength(JSON.stringify(expectedReference(f, 'en')), 'utf8')).toBe(256 * 1024);
    const result = await f.call();
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBe(256 * 1024);
    f.state.beats[4].content.en += 'a';
    expect(Buffer.byteLength(JSON.stringify(expectedReference(f, 'en')), 'utf8')).toBeGreaterThan(256 * 1024);
    await rejectRead(f);
  });
  it('counts UTF8 bytes for the entire response instead of JavaScript string length', async () => {
    f.state.scenes = [f.state.scenes[1]];
    f.state.beats = Array.from({ length: 4 }, (_, i) => ({ id: uuid(200 + i), sceneId: sourceA, position: i + 1,
      beatType: 'paragraph', content: rawText('\uac00'.repeat(24000)) }));
    const serialized = JSON.stringify(expectedReference(f, 'en'));
    expect(serialized.length).toBeLessThan(256 * 1024);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeGreaterThan(256 * 1024);
    await rejectRead(f);
  });
  it.each([
    ['user UUID', 'en', 'invalid', workId], ['work UUID', 'en', owner, 'invalid'], ['locale', 'fr', owner, workId],
  ])('rejects invalid %s before opening a transaction', async (_name, locale, user, work) => {
    await expect(f.call(locale, user, work)).rejects.toMatchObject({ status: 400 });
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  const stale: Array<[string, (state: Fixture['state']) => void]> = [
    ['active release', s => { s.works[0].activeReleaseId = uuid(99); }],
    ['published version', s => { s.works[0].publishedVersion = 2; }],
    ['inactive release', s => { s.releases[0].status = 'superseded'; }],
    ['release version', s => { s.releases[0].version = 2; }],
    ['obsolete progress', s => { s.progress[0].status = 'reset'; }],
    ['two scene pointers', s => { s.progress[0].currentSceneId = sourceA; }],
    ['part work', s => { s.parts[0].workId = uuid(99); }],
    ['generated owner', s => { s.generated[0].userId = outsider; }],
    ['generated release', s => { s.generated[0].releaseId = uuid(99); }],
    ['origin status', s => { s.origins[0].status = 'processing'; }],
    ['origin progress', s => { s.origins[0].progressId = uuid(99); }],
    ['origin result', s => { s.origins[0].resultGeneratedSceneId = uuid(99); }],
  ];
  it.each(stale)('rejects %s without a reference fallback', async (_name, mutate) => {
    mutate(f.state); await rejectRead(f); expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });
  it.each([undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe or missing revision %s', async revision => {
    f.state.progress[0].progressRevision = revision; await rejectRead(f);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });
  const invalid: Array<[string, (state: Fixture['state']) => void]> = [
    ['empty scenes', s => { s.scenes = []; }],
    ['101 scenes', s => { s.scenes = Array.from({ length: 101 }, (_, i) => ({ ...s.scenes[1], id: uuid(100 + i), position: i + 1 })); }],
    ['duplicate scene ID', s => { s.scenes[0].id = sourceA; }],
    ['duplicate scene position', s => { s.scenes[0].position = 1; }],
    ['invalid scene UUID', s => { s.scenes[0].id = 'not-a-uuid'; }],
    ['unsafe scene position', s => { s.scenes[0].position = Number.MAX_SAFE_INTEGER + 1; }],
    ['empty beats', s => { s.beats = []; }],
    ['scene without beats', s => { s.beats = s.beats.filter(row => row.sceneId !== sourceB); }],
    ['1001 beats', s => { s.beats = Array.from({ length: 1001 }, (_, i) => ({ ...s.beats[0], id: uuid(1000 + i), position: i + 1 })); }],
    ['duplicate beat ID', s => { s.beats[1].id = s.beats[2].id; }],
    ['duplicate beat position', s => { s.beats[1].position = 1; }],
    ['unsafe beat position', s => { s.beats[1].position = Number.MAX_SAFE_INTEGER + 1; }],
    ['non-string beat type', s => { s.beats[0].beatType = 1; }],
    ['empty beat type', s => { s.beats[0].beatType = ''; }],
    ['long beat type', s => { s.beats[0].beatType = 'x'.repeat(65); }],
    ['non-string title', s => { s.scenes[0].title.en = 7; }],
    ['long title', s => { s.scenes[0].title.en = 'x'.repeat(1001); }],
    ['blank content', s => { s.beats[0].content.en = ' \n\t'; }],
    ['non-string content', s => { s.beats[0].content.en = false; }],
    ['NUL content', s => { s.beats[0].content.en = 'before\0after'; }],
    ['lone high surrogate', s => { s.beats[0].content.en = '\ud800'; }],
    ['lone low surrogate', s => { s.beats[0].content.en = '\udfff'; }],
    ['long content', s => { s.beats[0].content.en = 'x'.repeat(64001); }],
  ];
  it.each(invalid)('rejects original %s without partial output or mutation', async (_name, mutate) => {
    mutate(f.state); await rejectRead(f);
  });
  it.each(['scene title', 'beat content'])('rejects missing %s locale without using Korean fallback', async field => {
    delete (field === 'scene title' ? f.state.scenes[0].title : f.state.beats[0].content).en;
    await rejectRead(f, 409, 'STORY_AUTHOR_BODY_PREVIEW_TRANSLATION_UNAVAILABLE');
  });
});

describe('AUTHOR-ORIGINAL-REFERENCE HTTP: real Nest/JWT, synthetic database only', () => {
  let f: Fixture, app: INestApplication, port: number, token: string, outsiderToken: string;
  let expiredToken: string, refreshToken: string;
  beforeAll(async () => {
    f = fixture();
    const jwt = new JwtService(), secret = randomUUID();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    outsiderToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    expiredToken = await jwt.signAsync({ sub: owner, tokenType: 'access' }, { secret, expiresIn: -1 });
    refreshToken = await jwt.signAsync({ sub: owner, tokenType: 'refresh' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyPreviewController], providers: [
      StoryAuthorBodyPreviewService, JwtAuthGuard, { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret }) },
      { provide: PrismaService, useValue: {
        $transaction: (callback: (tx: Fixture['db']) => Promise<unknown>, options: unknown) => f.prisma.$transaction(callback, options),
        user: { findFirst: jest.fn(async (query: Query) => {
          const user = f.state.users.find(row => matches(row, query.where));
          return user ? project(user, query.select) : null;
        }) },
      } },
    ] }).compile();
    app = module.createNestApplication({ logger: false });
    configureHttpRouting(app); app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); port = (app.getHttpServer().address() as AddressInfo).port;
  });
  beforeEach(() => { f = fixture(); });
  afterEach(() => { try { assertReadOnly(f); } finally { jest.restoreAllMocks(); } });
  afterAll(async () => { await app?.close(); });
  const call = (method = 'GET', query = 'locale=en', authorization: string | null = token, work = workId) => f.checked(() =>
    new Promise<{ status: number; cache?: string; bytes: number; body: any; cookies: string[] }>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, method, agent: false,
        path: `/api/v1/me/creator-studio/stories/${work}/body-preview/original-reference${query ? `?${query}` : ''}`,
        headers: { connection: 'close', ...(authorization ? { authorization: `Bearer ${authorization}` } : {}) } }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          try { resolve({ status: res.statusCode!, cache: res.headers['cache-control'], bytes: bytes.length,
            body: bytes.length ? JSON.parse(bytes.toString('utf8')) : null, cookies: res.headers['set-cookie'] ?? [] }); }
          catch { reject(new Error('Synthetic loopback response is not JSON')); }
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('Synthetic loopback timeout')));
      req.on('error', reject); req.end();
    }));
  const privateResponse = (response: Awaited<ReturnType<typeof call>>, status: number) => {
    expect(response.status).toBe(status); expect(response.cache).toBe('private, no-store');
    expect(response.cookies).toEqual([]);
    expect(JSON.stringify(response.body).includes(PRIVATE)).toBe(false);
  };
  it.each(['GET', 'HEAD'])('anonymous %s receives 401 and private no-store before any snapshot', async method => {
    const response = await call(method, 'locale=en', null); privateResponse(response, 401);
    if (method === 'HEAD') expect(response.bytes).toBe(0);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(['GET', 'HEAD'])('owner JWT %s uses the real service and HEAD has no body', async method => {
    const response = await call(method); privateResponse(response, 200);
    if (method === 'HEAD') { expect(response.bytes).toBe(0); expect(response.body).toBeNull(); }
    else { assertEnvelope(response.body); expect(response.body).toEqual(expectedReference(f, 'en')); }
    expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
  it.each(['expired', 'refresh'])('%s token is rejected without source reads', async kind => {
    privateResponse(await call('GET', 'locale=en', kind === 'expired' ? expiredToken : refreshToken), 401);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('nonowner JWT is 404 even without a saved body', async () => {
    f.state.progress = []; privateResponse(await call('GET', 'locale=en', outsiderToken), 404);
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
    expect(f.db.storyReaderProgress.findUnique).not.toHaveBeenCalled();
  });
  it.each(['locale=fr', 'locale=en&locale=ko', 'locale[]=en', 'locale=en&unknown=true'])('invalid query %s fails 400 before service reads', async query => {
    privateResponse(await call('GET', query), 400); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('invalid UUID fails the actual route pipe with private 400', async () => {
    privateResponse(await call('GET', 'locale=en', token, 'invalid'), 400);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('changed current release yields 409, not a historical-reference fallback', async () => {
    f.state.works[0].publishedVersion++;
    const response = await call(); privateResponse(response, 409);
    expect(response.body.error.code).toBe('STORY_AUTHOR_BODY_PREVIEW_CHANGED');
    expect(f.db.storyScene.findMany).not.toHaveBeenCalled();
  });
  it('synthetic service 403 tests only header/filter propagation, not an authorization grant', async () => {
    jest.spyOn(app.get(StoryAuthorBodyPreviewService), 'originalReference')
      .mockRejectedValueOnce(new ForbiddenException({ code: 'SYNTHETIC_REFERENCE_FORBIDDEN' }));
    const response = await call(); privateResponse(response, 403);
    expect(response.body.error.code).toBe('SYNTHETIC_REFERENCE_FORBIDDEN');
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('has no POST mutation route', async () => {
    expect((await call('POST')).status).toBe(404); expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

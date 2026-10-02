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
import { StoryAuthorBodyPreviewController } from './story-author-body-preview.controller';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';
import { STORY_LOCALES } from './story-production.policy';

const owner = randomUUID(), outsider = randomUUID(), workId = randomUUID(), releaseId = randomUUID();
const progressId = randomUUID(), sceneId = randomUUID(), partId = randomUUID(), continuationId = randomUUID();
const localized = (text: string) => Object.fromEntries(STORY_LOCALES.map(locale => [locale, `${locale}: ${text}`]));

function fixture() {
  const state = {
    work: { id: workId, ownerUserId: owner, status: 'published', fixtureSource: false, activeReleaseId: releaseId, publishedVersion: 1 },
    progress: { id: progressId, userId: owner, workId, activeReleaseId: releaseId, storyVersion: 1,
      progressRevision: 7, status: 'active', currentSceneId: null as string | null, currentGeneratedSceneId: sceneId as string | null },
    release: { id: releaseId, workId, status: 'active', version: 1 },
    scene: { id: sceneId, userId: owner, workId, progressId, releaseId, status: 'ready',
      sourcePartId: partId, continuationId, title: localized('PRIVATE BODY'), endingType: null as string | null },
    canonical: { id: sceneId, partId, status: 'published', fixtureSource: false, title: localized('ORIGINAL BODY'), endingType: null },
    part: { id: partId, workId, status: 'published', fixtureSource: false },
    origin: { id: continuationId, userId: owner, workId, progressId, releaseId, status: 'completed', resultGeneratedSceneId: sceneId },
    beats: [{ id: randomUUID(), sceneId, position: 1, beatType: 'paragraph', content: localized('Exact text.\nAnother line.') }],
    choices: [{ id: randomUUID(), sceneId, position: 1, label: localized('Stay'), routeKind: 'generation_required' }],
  };
  const mutations: jest.Mock[] = [];
  function model(reads: Record<string, jest.Mock>) {
    const writes = Object.fromEntries(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'].map(name => {
      const fn = jest.fn(() => { throw new Error('Unexpected domain write'); });
      mutations.push(fn);
      return [name, fn];
    }));
    return { ...reads, ...writes };
  }
  const first = (row: () => any) => jest.fn(async ({ where }) => {
    const value = row();
    return value && Object.entries(where).every(([key, expected]) => value[key] === expected) ? value : null;
  });
  const many = (rows: () => any[]) => jest.fn(async ({ where, take }) =>
    rows().filter(row => row.sceneId === where.sceneId && (!where.position || row.position > where.position.gt)).slice(0, take));
  const db = {
    storyWork: model({ findFirst: first(() => state.work) }),
    storyReaderProgress: model({ findUnique: jest.fn(async ({ where }) => state.progress &&
      state.progress.userId === where.userId_workId.userId && state.progress.workId === where.userId_workId.workId ? state.progress : null) }),
    storyRelease: model({ findFirst: first(() => state.release) }),
    storyAiGeneratedScene: model({ findFirst: first(() => state.scene) }),
    storyScene: model({ findFirst: first(() => state.canonical) }),
    storyPart: model({ findFirst: first(() => state.part) }),
    storyAiContinuation: model({ findFirst: first(() => state.origin) }),
    storyAiGeneratedBeat: model({ findMany: many(() => state.beats) }),
    storyBeat: model({ findMany: many(() => state.beats) }),
    storyAiGeneratedChoice: model({ findMany: many(() => state.choices) }),
    storyChoice: model({ findMany: many(() => state.choices) }),
    $executeRaw: jest.fn(async (sql: { strings: string[] }) => {
      if (sql.strings.join('') !== 'SET TRANSACTION READ ONLY') throw new Error('Unexpected SQL');
      return 0;
    }),
  };
  const prisma = { $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>, _options: unknown) => callback(db)) };
  return { state, db, prisma, mutations, service: new StoryAuthorBodyPreviewService(prisma as never) };
}

describe('author own-current-body preview (synthetic database)', () => {
  let f: ReturnType<typeof fixture>;
  const preview = (locale = 'ko') => f.service.preview(owner, workId, { locale });
  beforeEach(() => { f = fixture(); });
  afterEach(() => { for (const mutation of f.mutations) expect(mutation).not.toHaveBeenCalled(); });

  it.each(STORY_LOCALES)('reads exact %s text, with no visual repair, AI, approval or progress mutation', async locale => {
    const response = await preview(locale);
    expect(response).toMatchObject({ contract: 'story-author-body-preview-v1', workId, locale,
      readOnly: true, imageGenerationStarted: false, progress: { progressId, revision: 7, status: 'active', storyVersion: 1,
        scene: { id: sceneId, isGenerated: true, title: `${locale}: PRIVATE BODY`, endingType: null,
          beats: [{ content: `${locale}: Exact text.\nAnother line.` }] },
        choices: [{ label: `${locale}: Stay`, routeKind: 'generation_required' }] } });
    expect(f.db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(f.prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(JSON.stringify(response)).not.toMatch(/visualManifest|pathSummary|sharedResultId|continuationId|userId/);
  });

  it('is repeatable and does not require public image readiness or shared-result approval', async () => {
    const before = structuredClone(f.state);
    expect(await preview()).toEqual(await preview());
    expect(f.state).toEqual(before);
    expect(Object.keys(f.db)).not.toContain('storyVisualGenerationJob');
    expect(Object.keys(f.db)).not.toContain('storyAiReusableResult');
  });

  it('normalizes validated UUIDs like PostgreSQL, including uppercase route IDs', async () => {
    expect(await f.service.preview(owner.toUpperCase(), workId.toUpperCase(), { locale: 'ko' })).toEqual(await preview());
  });

  it('accepts the full 40-beat and 3-choice boundaries without truncation', async () => {
    f.state.beats = Array.from({ length: 40 }, (_, index) => ({ ...f.state.beats[0], id: randomUUID(), position: index + 1 }));
    f.state.choices = Array.from({ length: 3 }, (_, index) => ({ ...f.state.choices[0], id: randomUUID(), position: index + 1 }));
    const response = await preview();
    expect(response.progress?.scene?.beats).toHaveLength(40);
    expect(response.progress?.choices).toHaveLength(3);
  });

  it('bounds UTF-8 bytes, not just characters, for multibyte source text', async () => {
    f.state.beats = Array.from({ length: 3 }, (_, index) => ({ ...f.state.beats[0], id: randomUUID(), position: index + 1,
      content: localized('\uD55C'.repeat(28000)) }));
    expect(Buffer.byteLength(JSON.stringify(await preview()), 'utf8')).toBeLessThan(256 * 1024);
    f.state.beats[2].content.ko += '\uD55C'.repeat(5000);
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('hides nonowned, unpublished and fixture works with the same response', async () => {
    await expect(f.service.preview(outsider, workId, { locale: 'ko' })).rejects.toBeInstanceOf(NotFoundException);
    f.state.work.status = 'draft';
    await expect(preview()).rejects.toBeInstanceOf(NotFoundException);
    f.state.work.status = 'published'; f.state.work.fixtureSource = true;
    await expect(preview()).rejects.toBeInstanceOf(NotFoundException);
    expect(f.db.storyReaderProgress.findUnique).not.toHaveBeenCalled();
  });

  it('returns no progress rather than starting or borrowing another reader session', async () => {
    f.state.progress.userId = outsider;
    expect(await preview()).toMatchObject({ progress: null });
    expect(f.db.storyReaderProgress.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_workId: { userId: owner, workId } } }));
    expect(f.db.storyAiGeneratedScene.findFirst).not.toHaveBeenCalled();
  });

  it.each(['userId', 'workId', 'progressId', 'releaseId', 'status'])('rejects a generated scene with wrong %s', async key => {
    (f.state.scene as any)[key] = key === 'status' ? 'failed' : randomUUID();
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
    expect(f.db.storyAiGeneratedBeat.findMany).not.toHaveBeenCalled();
  });

  it.each(['userId', 'workId', 'progressId', 'releaseId', 'resultGeneratedSceneId', 'status'])('requires a matching completed origin: %s', async key => {
    (f.state.origin as any)[key] = key === 'status' ? 'failed' : randomUUID();
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['work-release-null', 'progress-release-null', 'release-changed', 'version-changed', 'retired-release', 'release-version', 'dual-pointers', 'bad-status'])('fails closed for %s', async kind => {
    if (kind === 'work-release-null') (f.state.work as any).activeReleaseId = null;
    if (kind === 'progress-release-null') (f.state.progress as any).activeReleaseId = null;
    if (kind === 'release-changed') f.state.work.activeReleaseId = randomUUID();
    if (kind === 'version-changed') f.state.work.publishedVersion++;
    if (kind === 'retired-release') f.state.release.status = 'retired';
    if (kind === 'release-version') f.state.release.version++;
    if (kind === 'dual-pointers') f.state.progress.currentSceneId = sceneId;
    if (kind === 'bad-status') f.state.progress.status = 'resetting';
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires the scene source part in the same published work', async () => {
    f.state.part.workId = randomUUID();
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('reads canonical source without involving a generated scene or recording a read receipt', async () => {
    f.state.progress.currentGeneratedSceneId = null; f.state.progress.currentSceneId = sceneId;
    expect(await preview()).toMatchObject({ progress: { scene: { isGenerated: false, title: 'ko: ORIGINAL BODY' } } });
    expect(f.db.storyAiGeneratedScene.findFirst).not.toHaveBeenCalled();
    f.state.canonical.partId = randomUUID();
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it('shows the existing source during pending generation; completed endings have no next choices', async () => {
    f.state.progress.status = 'ai_pending';
    expect(await preview()).toMatchObject({ progress: { status: 'ai_pending' } });
    f.state.progress.status = 'completed'; f.state.scene.endingType = 'ai_generated';
    expect(await preview()).toMatchObject({ progress: { status: 'completed', scene: { endingType: 'ai_generated' }, choices: [] } });
  });

  it('represents an empty current scene without repairing it', async () => {
    f.state.progress.currentGeneratedSceneId = null;
    expect(await preview()).toMatchObject({ progress: { scene: null, choices: [] } });
  });

  it.each(['title', 'beat', 'choice'])('never substitutes another language when %s translation is missing', async target => {
    const record = target === 'title' ? f.state.scene.title : target === 'beat' ? f.state.beats[0].content : f.state.choices[0].label;
    delete record.en;
    await expect(preview('en')).rejects.toMatchObject({ response: { code: 'STORY_AUTHOR_BODY_PREVIEW_TRANSLATION_UNAVAILABLE' } });
  });

  it.each(['empty', 'nul', 'surrogate', 'oversized'])('rejects malformed %s text without truncation', async kind => {
    f.state.beats[0].content.ko = kind === 'empty' ? '  ' : kind === 'nul' ? 'bad\0text' : kind === 'surrogate' ? '\uD800bad' : 'x'.repeat(64001);
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['beats', 'choices', 'duplicate-position', 'duplicate-id', 'response-bytes'])('rejects unbounded or ambiguous %s', async kind => {
    if (kind === 'beats') f.state.beats = Array.from({ length: 41 }, (_, index) => ({ ...f.state.beats[0], id: randomUUID(), position: index + 1 }));
    if (kind === 'choices') f.state.choices = Array.from({ length: 4 }, (_, index) => ({ ...f.state.choices[0], id: randomUUID(), position: index + 1 }));
    if (kind === 'duplicate-position') f.state.beats.push({ ...f.state.beats[0], id: randomUUID() });
    if (kind === 'duplicate-id') f.state.beats.push({ ...f.state.beats[0], position: 2 });
    if (kind === 'response-bytes') f.state.beats = Array.from({ length: 6 }, (_, index) => ({ ...f.state.beats[0], id: randomUUID(), position: index + 1, content: localized('x'.repeat(50000)) }));
    await expect(preview()).rejects.toBeInstanceOf(ConflictException);
  });

  it.each(['', 'fr', 'KO', null])('rejects unsupported locale %s before touching the database', async locale => {
    await expect(preview(locale as string)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('author body preview HTTP (real JWT, validation and service; synthetic DB)', () => {
  let app: INestApplication, port: number, token: string, otherToken: string;
  let f: ReturnType<typeof fixture>;
  beforeAll(async () => {
    f = fixture();
    const secret = randomUUID(), jwt = new JwtService();
    token = await jwt.signAsync({ sub: owner, userId: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    otherToken = await jwt.signAsync({ sub: outsider, tokenType: 'access' }, { secret, expiresIn: '5m' });
    const module = await Test.createTestingModule({ controllers: [StoryAuthorBodyPreviewController], providers: [
      { provide: StoryAuthorBodyPreviewService, useValue: f.service },
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
        path: `/api/v1/me/creator-studio/stories/${work}/body-preview${query ? `?${query}` : ''}`,
        headers: authorization ? { authorization: `Bearer ${authorization}` } : {} }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode!, cache: res.headers['cache-control'], body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTP timeout')));
      req.on('error', reject); req.end();
    });
  }

  it('returns exact source through verified JWT identity with private, no-store', async () => {
    const response = await call();
    expect(response.status).toBe(200); expect(response.cache).toBe('private, no-store');
    expect(response.body.progress.scene.title).toBe('ko: PRIVATE BODY');
  });

  it.each([null, 'invalid'])('keeps authentication denials uncached: %s', async authorization => {
    const response = await call('', authorization);
    expect(response.status).toBe(401); expect(response.cache).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE BODY');
  });

  it('cannot inspect another owner, even with a valid token', async () => {
    const response = await call('', otherToken);
    expect(response.status).toBe(404); expect(response.cache).toBe('private, no-store');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE BODY');
  });

  it.each(['locale=fr', 'locale=ko&locale=en', 'locale=', `progressId=${progressId}`, `userId=${outsider}`, 'unknown=true'])('rejects bad or caller-expanded scope: %s', async query => {
    const response = await call(query);
    expect(response.status).toBe(400); expect(response.cache).toBe('private, no-store');
  });

  it('validates the work ID and exposes no write route', async () => {
    expect((await call('', token, 'invalid')).status).toBe(400);
    expect((await call('', token, workId, 'POST')).status).toBe(404);
    for (const mutation of f.mutations) expect(mutation).not.toHaveBeenCalled();
  });

  it('keeps changed-source failures private and omits source text', async () => {
    const version = f.state.work.publishedVersion;
    try {
      f.state.work.publishedVersion++;
      const response = await call();
      expect(response.status).toBe(409); expect(response.cache).toBe('private, no-store');
      expect(JSON.stringify(response.body)).not.toContain('PRIVATE BODY');
    } finally { f.state.work.publishedVersion = version; }
  });
});

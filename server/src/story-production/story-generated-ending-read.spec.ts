import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryGeneratedEndingReadService } from './story-generated-ending-read.service';
import { generatedEndingReadPrivacyMiddleware, StoryGeneratedEndingReadController } from './story-generated-ending-read.controller';
import { ConfirmStoryGeneratedEndingReadDto, StoryGeneratedEndingReadQueryDto } from './dto/story-generated-ending-read.dto';
import { STORY_LOCALES } from './story-production.policy';

function fixture() {
  const userId = randomUUID(), progressId = randomUUID(), workId = randomUUID(), sceneId = randomUUID();
  const releaseId = randomUUID(), manuscriptId = randomUUID(), ownerUserId = randomUUID(), partId = randomUUID();
  const routeId = randomUUID(), parentId = randomUUID(), originId = randomUUID(), sourceSceneId = randomUUID();
  const progress = { id: progressId, userId, workId, currentSceneId: null as string | null,
    currentGeneratedSceneId: sceneId as string | null, activeReleaseId: releaseId, routeNodeId: routeId,
    status: 'completed', storyVersion: 1, currentAct: 1, progressRevision: 3, currentBeatPosition: 2,
    pathSummary: [{ generatedSceneId: sceneId }] };
  const work = { id: workId, ownerUserId, activeReleaseId: releaseId, publishedVersion: 1, status: 'published',
    fixtureSource: false, slug: 'ending-read', coverManifest: {}, priceLumina: new Prisma.Decimal(0) };
  const release = { id: releaseId, workId, manuscriptVersionId: manuscriptId, status: 'active', checksum: 'a'.repeat(64), version: 1 };
  const manuscript = { id: manuscriptId, workId, ownerUserId, contentHash: 'b'.repeat(64) };
  const scene = { id: sceneId, userId, progressId, workId, releaseId, sourcePartId: partId, continuationId: originId,
    status: 'ready', endingType: 'ai_generated', provenance: 'ai_generated', resultChecksum: 'c'.repeat(64) };
  const part = { id: partId, workId, status: 'published', fixtureSource: false, actNumber: 1, priceLumina: new Prisma.Decimal(0) };
  const origin = { id: originId, userId, progressId, workId, releaseId, status: 'completed', resultGeneratedSceneId: sceneId,
    releaseChecksum: release.checksum, manuscriptVersionId: manuscriptId, sourceRouteNodeId: parentId,
    sourceSceneId, sourceGeneratedSceneId: null, sourcePartId: partId };
  const route = { id: routeId, parentId, progressId, workId, releaseId, routeHash: null,
    narrativeStep: { generatedSceneId: sceneId, sourceSceneId, sourceGeneratedSceneId: null, provenance: 'ai_generated' } };
  const beats = [1, 2].map(position => ({ id: randomUUID(), sceneId, position, beatType: 'paragraph',
    content: Object.fromEntries(STORY_LOCALES.map(locale => [locale, `${locale} page ${position}\\nExact ending.`])) }));
  const find = (row: object) => jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value) ? row : null);
  const rows: Array<Record<string, unknown>> = [];
  const tx = { $executeRaw: jest.fn(async (_sql: Prisma.Sql) => 0), $queryRaw: jest.fn(async (_sql: Prisma.Sql) => []),
    storyReaderProgress: { findFirst: find(progress), updateMany: jest.fn() }, storyWork: { findFirst: find(work) },
    storyRelease: { findFirst: find(release) }, storyManuscriptVersion: { findFirst: find(manuscript) },
    storyAiGeneratedScene: { findFirst: find(scene) }, storyPart: { findFirst: find(part) },
    storyAiContinuation: { findFirst: find(origin), create: jest.fn() }, storyProgressRouteNode: { findFirst: find(route) },
    storyAiGeneratedBeat: { findMany: jest.fn(async () => beats) }, storyAiGeneratedChoice: { count: jest.fn(async () => 0) },
    userEntitlement: { findFirst: jest.fn(async () => null) },
    auditEvent: { findMany: jest.fn(async ({ where }: { where: { actorType: string; actorUserId: string; action: string;
      targetId?: string; metadata: { path: string[]; equals: string } } }) => rows.filter(row =>
      row.actorType === where.actorType && row.actorUserId === where.actorUserId && row.action === where.action &&
      (!where.targetId || row.targetId === where.targetId) &&
      (row.metadata as Record<string, unknown>)[where.metadata.path[0]] === where.metadata.equals)),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: randomUUID(), createdAt: new Date() }; rows.push(row); return row;
      }) } };
  const prisma = { $transaction: jest.fn(async (run: (db: typeof tx) => Promise<unknown>, _options: unknown) => {
    const before = rows.length;
    try { return await run(tx); } catch (error) { rows.splice(before); throw error; }
  }) };
  const page = (locale = 'ko') => ({ progressId, workId, status: progress.status, revision: progress.progressRevision,
    storyVersion: progress.storyVersion, choices: [], scene: { id: sceneId, isGenerated: true,
      deliveryState: 'ready', endingType: 'ai_generated', visualManifest: { ready: true },
      beats: beats.map(beat => ({ id: beat.id, position: beat.position, content: { value: beat.content[locale] } })) } });
  const stories = { currentProgress: jest.fn(async (_user: string, _progress: string, locale: string) => page(locale)) };
  const service = new StoryGeneratedEndingReadService(prisma as never, stories as never);
  const preview = (locale = 'ko', fromPosition = 1) => service.preview(userId, progressId, { locale, fromPosition });
  const input = async (locale = 'ko'): Promise<ConfirmStoryGeneratedEndingReadDto> => { const p = await preview(locale); return { locale, fromPosition: 1,
    expectedRevision: p.expectedRevision, expectedScopeChecksum: p.scopeChecksum, expectedSourceTextHash: p.sourceTextHash,
    idempotencyKey: randomUUID(), displayedAndRead: true }; };
  const confirm = (body: ConfirmStoryGeneratedEndingReadDto) => service.confirm(userId, progressId, body);
  return { userId, progressId, progress, work, release, manuscript, scene, part, origin, route, beats, rows, tx,
    prisma, stories, page, service, preview, input, confirm };
}

describe('generated ending explicit read confirmation', () => {
  it.each(STORY_LOCALES)('queries %s last-page metadata without treating a cursor as a receipt', async locale => {
    const f = fixture(), p = await f.preview(locale);
    const hash = createHash('sha256').update(JSON.stringify(f.beats.map(beat => [beat.id, beat.position,
      beat.content[locale].replace(/\\r\\n|\\n|\\r/gu, '\n')]))).digest('hex');
    expect(p).toMatchObject({ contract: 'story-generated-ending-read-review-v1', confirmation: null,
      sourceTextHash: hash, expectedRevision: 3 });
    expect(f.tx.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
    expect(f.stories.currentProgress).toHaveBeenCalledWith(f.userId, f.progressId, locale, false);
    expect(f.rows).toHaveLength(0); expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(p)).not.toContain('Exact ending');
  });
  it.each(STORY_LOCALES)('records %s explicit confirmation, same-key replay, and independently retrieves it', async locale => {
    const f = fixture(), body = await f.input(locale), receipt = await f.confirm(body);
    expect(receipt).toMatchObject({ progressRevision: 3, progressMutated: false, meaningApproved: false,
      qualityApproved: false, publicationStarted: false, generationStarted: false, imageGenerationStarted: false,
      idempotentReplay: false });
    expect(await f.confirm(body)).toMatchObject({ receiptId: receipt.receiptId, idempotentReplay: true });
    expect((await f.preview(locale)).confirmation).toMatchObject({ receiptId: receipt.receiptId });
    expect(f.rows).toHaveLength(1); expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
    expect(f.tx.storyAiContinuation.create).not.toHaveBeenCalled();
    await expect(f.confirm({ ...body, idempotencyKey: randomUUID() })).rejects.toMatchObject({
      response: { code: 'STORY_GENERATED_ENDING_READ_ALREADY_RECORDED' } });
    expect(f.rows).toHaveLength(1);
  });
  it('keeps a current receipt across ordinary navigation revisions without rewriting it', async () => {
    const f = fixture(), body = await f.input(), receipt = await f.confirm(body);
    f.progress.progressRevision++; f.progress.currentBeatPosition = 1;
    expect((await f.preview()).confirmation).toMatchObject({ receiptId: receipt.receiptId, progressRevision: 3 });
    expect(f.rows).toHaveLength(1);
    await expect(f.confirm(body)).rejects.toBeInstanceOf(ConflictException);
  });
  it('permits the initial zero cursor for a one-page ending without writing the cursor', async () => {
    const f = fixture(); f.progress.currentBeatPosition = 0;
    await f.confirm(await f.input()); expect(f.progress.currentBeatPosition).toBe(0);
    expect(f.rows).toHaveLength(1);
  });
  it.each(['owner', 'status', 'canonical', 'release', 'version', 'origin', 'manuscript', 'source-part', 'route', 'arrival', 'choices',
    'text', 'missing-locale', 'duplicate', 'position', 'count', 'projection', 'artwork', 'cursor', 'access'])('rejects changed %s with no receipt writes', async kind => {
    const f = fixture();
    if (kind === 'owner') f.progress.userId = randomUUID();
    if (kind === 'status') f.progress.status = 'active';
    if (kind === 'canonical') f.progress.currentSceneId = randomUUID();
    if (kind === 'release') f.work.activeReleaseId = randomUUID();
    if (kind === 'version') f.work.publishedVersion++;
    if (kind === 'origin') f.origin.resultGeneratedSceneId = randomUUID();
    if (kind === 'manuscript') f.origin.manuscriptVersionId = randomUUID();
    if (kind === 'source-part') f.origin.sourcePartId = randomUUID();
    if (kind === 'route') f.route.parentId = randomUUID();
    if (kind === 'arrival') f.route.narrativeStep.generatedSceneId = randomUUID();
    if (kind === 'choices') f.tx.storyAiGeneratedChoice.count.mockResolvedValue(1);
    if (kind === 'text') f.beats[0].content.ko = 'broken\0text';
    if (kind === 'missing-locale') delete f.beats[0].content.ko;
    if (kind === 'duplicate') f.beats[1].id = f.beats[0].id;
    if (kind === 'position') f.beats[1].position = f.beats[0].position;
    if (kind === 'count') f.tx.storyAiGeneratedBeat.findMany.mockResolvedValue(Array.from({ length: 41 }, () => f.beats[0]));
    if (kind === 'projection') f.stories.currentProgress.mockImplementation(async () => ({ ...f.page(), scene: {
      ...f.page().scene, beats: [] } }));
    if (kind === 'artwork') f.stories.currentProgress.mockImplementation(async () => ({ ...f.page(), scene: {
      ...f.page().scene, deliveryState: 'artwork_pending' } }));
    if (kind === 'cursor') f.progress.currentBeatPosition = 3;
    if (kind === 'access') f.work.priceLumina = new Prisma.Decimal(1);
    await expect(f.preview()).rejects.toBeDefined(); expect(f.rows).toHaveLength(0);
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });
  it.each(['revision', 'scope', 'hash', 'ack', 'key', 'locale', 'from'])('rejects malformed or stale %s', async kind => {
    const f = fixture(), body = await f.input();
    if (kind === 'revision') body.expectedRevision--;
    if (kind === 'scope') body.expectedScopeChecksum = 'd'.repeat(64);
    if (kind === 'hash') body.expectedSourceTextHash = 'e'.repeat(64);
    if (kind === 'ack') body.displayedAndRead = false;
    if (kind === 'key') body.idempotencyKey = 'invalid';
    if (kind === 'locale') body.locale = 'unknown';
    if (kind === 'from') body.fromPosition = 0;
    await expect(f.confirm(body)).rejects.toBeDefined(); expect(f.rows).toHaveLength(0);
  });
  it.each(['body', 'route', 'release', 'locale', 'visual', 'part'])('does not apply an old receipt to a changed %s scope', async kind => {
    const f = fixture(); await f.confirm(await f.input());
    if (kind === 'body') f.beats[0].content.ko += ' Changed.';
    if (kind === 'route') f.route.routeHash = 'f'.repeat(64) as never;
    if (kind === 'release') f.release.checksum = 'd'.repeat(64), f.origin.releaseChecksum = f.release.checksum;
    if (kind === 'visual') f.stories.currentProgress.mockImplementation(async (_u, _p, locale) => ({ ...f.page(locale),
      scene: { ...f.page(locale).scene, visualManifest: { ready: false } } }));
    if (kind === 'part') {
      const partId = randomUUID(); f.part.id = partId; f.scene.sourcePartId = partId; f.origin.sourcePartId = partId;
    }
    expect((await f.preview(kind === 'locale' ? 'en' : 'ko')).confirmation).toBeNull();
    expect(f.rows).toHaveLength(1);
  });
  it('rejects altered receipt evidence and duplicate scope evidence', async () => {
    const f = fixture(); await f.confirm(await f.input());
    const metadata = f.rows[0].metadata as Record<string, unknown>; metadata.meaningApproved = true;
    await expect(f.preview()).rejects.toBeInstanceOf(ConflictException); metadata.meaningApproved = false;
    f.rows.push({ ...f.rows[0], id: randomUUID() });
    await expect(f.preview()).rejects.toBeInstanceOf(ConflictException);
  });
  it('does not swallow audit persistence failure or create a cursor/provider write', async () => {
    const f = fixture(), body = await f.input(), failure = new Error('audit unavailable');
    f.tx.auditEvent.create.mockRejectedValue(failure);
    await expect(f.confirm(body)).rejects.toBe(failure);
    expect(f.rows).toHaveLength(0); expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });
  it('does not accept missing payment entitlement', async () => {
    const f = fixture(); f.part.priceLumina = new Prisma.Decimal(1);
    await expect(f.preview()).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('generated ending read HTTP boundary metadata', () => {
  it('protects GET and POST with original JWT and private no-store', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StoryGeneratedEndingReadController)).toBe('me/story-progress/:progressId/generated-ending-read');
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryGeneratedEndingReadController)).toContain(JwtAuthGuard);
    const guards = Reflect.getMetadata(GUARDS_METADATA, StoryGeneratedEndingReadController);
    expect(guards[1]).toBe(JwtAuthGuard);
    const setHeader = jest.fn();
    expect(new guards[0]().canActivate({ switchToHttp: () => ({ getResponse: () => ({ setHeader }) }) })).toBe(true);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    for (const method of ['preview', 'confirm'] as const) expect(Reflect.getMetadata(HEADERS_METADATA,
      StoryGeneratedEndingReadController.prototype[method])).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });
  it.each(['/api/v1/me/story-progress/p/generated-ending-read', '/api/me/story-progress/p/generated-ending-read?locale=ko',
    '/api/v1/me/story-progress/p/generated-ending-read/confirm'])('protects %s before authentication or JSON parsing', url => {
    const setHeader = jest.fn(), next = jest.fn(); generatedEndingReadPrivacyMiddleware({ url }, { setHeader }, next);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(next).toHaveBeenCalledTimes(1);
  });
  it.each(['/api/v1/me/story-progress/p/generated-ending-read-other', '/api/v1/health',
    '/api/v1/story-works', '/me/story-progress/p/generated-ending-read'])('does not change unrelated public caching %s', url => {
    const setHeader = jest.fn(), next = jest.fn(); generatedEndingReadPrivacyMiddleware({ url }, { setHeader }, next);
    expect(setHeader).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledTimes(1);
  });
  it('accepts numeric query conversion while rejecting extra fields and false acknowledgment', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    expect(await pipe.transform({ locale: 'ko', fromPosition: '1' }, { type: 'query', metatype: StoryGeneratedEndingReadQueryDto }))
      .toMatchObject({ locale: 'ko', fromPosition: 1 });
    const f = fixture(), body = await f.input();
    for (const bad of [{ ...body, displayedAndRead: false }, { ...body, publication: true }, { ...body, fromPosition: 41 }]) {
      await expect(pipe.transform(bad, { type: 'body', metatype: ConfirmStoryGeneratedEndingReadDto })).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

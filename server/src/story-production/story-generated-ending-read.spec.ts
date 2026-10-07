import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { fixture } from '../../test/fixtures/story-generated-ending-read.fixture';
import { generatedEndingReadPrivacyMiddleware, StoryGeneratedEndingReadController } from './story-generated-ending-read.controller';
import { ConfirmStoryGeneratedEndingReadDto, StoryGeneratedEndingReadQueryDto } from './dto/story-generated-ending-read.dto';
import { STORY_LOCALES } from './story-production.policy';


describe('ending artwork asset transactional boundary', () => {
  it.each(['missing', 'private', 'type', 'mime', 'checksum', 'path', 'pending'])('rejects %s artwork before receipt persistence', async kind => {
    const f = fixture(), body = await f.input();
    if (kind === 'missing') f.tx.asset.findFirst.mockResolvedValue(null);
    if (kind === 'private') f.asset.visibility = 'private';
    if (kind === 'type') f.asset.assetType = 'video';
    if (kind === 'mime') f.asset.mimeType = 'image/png';
    if (kind === 'checksum') f.asset.checksum = 'invalid';
    if (kind === 'path' || kind === 'pending') f.stories.currentProgress.mockImplementation(async (_u, _p, locale) => ({ ...f.page(locale),
      scene: { ...f.page(locale).scene, visualManifest: { background: { state: kind === 'pending' ? 'pending' : 'ready',
        publicAssetPath: kind === 'path' ? '/assets/story/unbound.webp' : `/api/v1/story-visual-assets/${f.asset.id}` } } } }));
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } });
    expect(f.rows).toHaveLength(0);
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });
  it.each(['checksum', 'metadata', 'storage'])('binds changed %s to a new scope rather than accepting the old page', async kind => {
    const f = fixture(), body = await f.input();
    if (kind === 'checksum') f.asset.checksum = '2'.repeat(64);
    if (kind === 'metadata') f.asset.metadata.identity = 'changed';
    if (kind === 'storage') f.asset.storageKey = 'replacement.webp';
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_SCOPE_CHANGED' } });
    expect(f.rows).toHaveLength(0);
  });
  it('rejects withdrawal after a ready preflight but before its receipt transaction', async () => {
    const f = fixture(), body = await f.input();
    f.stories.currentProgress.mockImplementation(async (_u, _p, locale) => {
      const projected = f.page(locale); f.asset.visibility = 'private'; return projected;
    });
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } });
    expect(f.rows).toHaveLength(0);
  });
  it('locks the matching asset before validating it and writing the audit', async () => {
    const f = fixture(), body = await f.input(); f.tx.$queryRaw.mockClear(); f.tx.asset.findFirst.mockClear();
    await f.confirm(body);
    const lockIndex = f.tx.$queryRaw.mock.calls.findIndex(([query]) => /FROM assets[\s\S]*FOR SHARE/u.test(query.sql));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    const callOrder = f.tx.$queryRaw.mock.invocationCallOrder[lockIndex];
    expect(callOrder).toBeLessThan(f.tx.asset.findFirst.mock.invocationCallOrder[0]);
    expect(f.tx.asset.findFirst.mock.invocationCallOrder[0]).toBeLessThan(f.tx.auditEvent.create.mock.invocationCallOrder[0]);
  });
  it('keeps GET read-only without acquiring a write-transaction row lock', async () => {
    const f = fixture(); await f.preview();
    expect(f.tx.asset.findFirst).toHaveBeenCalledTimes(1);
    expect(f.tx.$queryRaw.mock.calls.some(([query]) => /FROM assets/u.test(query.sql))).toBe(false);
    expect(f.rows).toHaveLength(0);
  });
  it('does not expose asset metadata or storage details in the receipt', async () => {
    const f = fixture(), value = await f.confirm(await f.input()), encoded = JSON.stringify(value);
    expect(encoded).not.toContain(f.asset.id); expect(encoded).not.toContain(f.asset.storageKey);
    expect(encoded).not.toContain('synthetic'); expect(encoded).not.toContain('metadata');
    expect(value).toMatchObject({ meaningApproved: false, qualityApproved: false });
  });
});

describe('ending artwork supplementary compatibility', () => {
  it.each(['?download=1', '#fragment', '/', '%2f', ' ', '/../replacement', '/extra'])('rejects asset URI suffix %s without a receipt', async suffix => {
    const f = fixture(), body = await f.input();
    f.stories.currentProgress.mockImplementation(async (_u, _p, locale) => ({ ...f.page(locale), scene: { ...f.page(locale).scene,
      visualManifest: { background: { state: 'ready', publicAssetPath: `/api/v1/story-visual-assets/${f.asset.id}${suffix}` } } } }));
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } });
    expect(f.rows).toHaveLength(0);
  });
  it('withholds the old scope after a storage-provider-only replacement', async () => {
    const f = fixture(), body = await f.input(); f.asset.storageProvider = 'replacement';
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_SCOPE_CHANGED' } });
    expect(f.rows).toHaveLength(0);
  });
  it('preserves a synthetic pre-guard audit without promoting it to a current receipt', async () => {
    const f = fixture(), preview = await f.preview(), oldScope = '0'.repeat(64);
    const old = { id: randomUUID(), actorType: 'user', actorUserId: f.userId, action: 'story.generated_ending_read.confirmed',
      targetType: 'story_reader_progress', targetId: f.progressId, metadata: { scopeChecksum: oldScope, explicitRead: true,
        meaningApproved: false, qualityApproved: false, publicationStarted: false, receipt: { ...preview, scopeChecksum: oldScope } } };
    f.rows.push(old); const unchanged = JSON.stringify(old);
    expect((await f.preview()).confirmation).toBeNull(); expect(f.rows).toHaveLength(1); expect(JSON.stringify(old)).toBe(unchanged);
    await f.confirm(await f.input()); expect(f.rows).toHaveLength(2); expect(JSON.stringify(old)).toBe(unchanged);
  });
  it('does not reuse an old command key for a different guarded scope', async () => {
    const f = fixture(), body = await f.input();
    const commandHash = createHash('sha256').update(JSON.stringify(['story.generated_ending_read.confirmed', f.userId, body.idempotencyKey])).digest('hex');
    f.rows.push({ id: randomUUID(), actorType: 'user', actorUserId: f.userId, action: 'story.generated_ending_read.confirmed',
      targetType: 'story_reader_progress', targetId: f.progressId, metadata: { scopeChecksum: '0'.repeat(64), commandHash, fingerprint: '4'.repeat(64) } });
    const before = JSON.stringify(f.rows);
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_IDEMPOTENCY_CONFLICT' } });
    expect(JSON.stringify(f.rows)).toBe(before);
  });
  it('does not show a post-confirmation replaced asset as the same current read receipt', async () => {
    const f = fixture(); await f.confirm(await f.input()); f.asset.metadata.identity = 'replacement-after-read';
    expect((await f.preview()).confirmation).toBeNull(); expect(f.rows).toHaveLength(1);
  });
});

describe('newline artwork URI hardening', () => {
  it.each(['\n', '\r\n'])('rejects a trailing line ending before reading the asset', async suffix => {
    const f = fixture(); f.tx.asset.findFirst.mockResolvedValue(f.asset);
    f.stories.currentProgress.mockImplementation(async (_u, _p, locale) => ({ ...f.page(locale), scene: { ...f.page(locale).scene,
      visualManifest: { background: { state: 'ready', publicAssetPath: `/api/v1/story-visual-assets/${f.asset.id}${suffix}` } } } }));
    await expect(f.preview()).rejects.toMatchObject({ response: { code: 'STORY_GENERATED_ENDING_READ_ARTWORK_CHANGED' } });
    expect(f.tx.asset.findFirst).not.toHaveBeenCalled(); expect(f.rows).toHaveLength(0);
  });
});

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
      scene: { ...f.page(locale).scene, visualManifest: { background: { ...f.page(locale).scene.visualManifest.background,
        altKey: 'changed' } } } }));
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

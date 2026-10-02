import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmStoryCanonicalReadDto, StoryCanonicalReadQueryDto } from './dto/story-canonical-read.dto';
import { StoryCanonicalReadController } from './story-canonical-read.controller';
import { canonicalReadScopeChecksum, canonicalReadTextHash } from './story-canonical-read.policy';
import { StoryCanonicalReadService } from './story-canonical-read.service';
import { canonicalStorySourceChecksum, validCanonicalStoryText } from './story-canonical-source.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { STORY_LOCALES } from './story-production.policy';

function fixture() {
  const userId = randomUUID(), progressId = randomUUID(), workId = randomUUID(), sceneId = randomUUID();
  const releaseId = randomUUID(), manuscriptId = randomUUID(), ownerUserId = randomUUID(), partId = randomUUID();
  const routeId = randomUUID(), beatId = randomUUID();
  const progress = { id: progressId, userId, workId, currentSceneId: sceneId as string | null,
    currentGeneratedSceneId: null as string | null, activeReleaseId: releaseId as string | null, routeNodeId: routeId as string | null,
    status: 'active', storyVersion: 1, currentAct: 1, progressRevision: 3, currentBeatPosition: 0 };
  const work = { id: workId, ownerUserId, activeReleaseId: releaseId, publishedVersion: 1, status: 'published',
    fixtureSource: false, slug: 'canonical-source', coverManifest: {}, priceLumina: new Prisma.Decimal(0) };
  const release = { id: releaseId, workId, manuscriptVersionId: manuscriptId, status: 'active', checksum: 'a'.repeat(64), version: 1 };
  const manuscript = { id: manuscriptId, workId, ownerUserId, contentHash: 'b'.repeat(64) };
  const scene = { id: sceneId, partId, status: 'published', fixtureSource: false, sceneKey: 'source', position: 1, visualManifest: {} };
  const part = { id: partId, workId, status: 'published', fixtureSource: false, position: 1, actNumber: 1, priceLumina: new Prisma.Decimal(0) };
  const beat = { id: beatId, sceneId, position: 1, beatType: 'paragraph', sourceSceneKey: null,
    content: Object.fromEntries(STORY_LOCALES.map(locale => [locale, ` ${locale} exact\nsource. `])) as Record<string, unknown> };
  const route = { id: routeId, progressId, workId, releaseId, targetSceneId: sceneId, routeHash: 'c'.repeat(64) };
  const find = (row: object) => jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
    Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value) ? row : null);
  const state = { existing: null as Record<string, unknown> | null };
  const tx = { $executeRaw: jest.fn(async (_sql: Prisma.Sql) => 0), $queryRaw: jest.fn(async (_sql: Prisma.Sql) => []),
    storyReaderProgress: { findFirst: find(progress), updateMany: jest.fn() }, storyWork: { findFirst: find(work) },
    storyRelease: { findFirst: find(release) }, storyManuscriptVersion: { findFirst: find(manuscript) },
    storyScene: { findFirst: find(scene) }, storyPart: { findFirst: find(part) }, storyBeat: { findFirst: find(beat) },
    storyProgressRouteNode: { findFirst: find(route) }, userEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
    storyCanonicalReadReceipt: { findUnique: jest.fn(async (_query: unknown) => state.existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, id: randomUUID(),
        confirmedAt: new Date(), invalidatedAt: null, resetCommandId: null })) },
    auditEvent: { create: jest.fn() }, storyReaderActorMemory: { upsert: jest.fn() },
    storyAiContinuation: { create: jest.fn() } };
  const prisma = { $transaction: jest.fn(async (run: (db: typeof tx) => Promise<unknown>, _options: unknown) => run(tx)) };
  const service = new StoryCanonicalReadService(prisma as never);
  const preview = (locale = 'ko') => service.preview(userId, progressId, beatId, { locale });
  const input = async (locale = 'ko') => {
    const p = await preview(locale);
    return { locale, expectedRevision: p.expectedRevision, expectedScopeChecksum: p.scopeChecksum,
      expectedSourceTextHash: p.sourceTextHash, idempotencyKey: randomUUID(), displayedAndRead: true };
  };
  const confirm = (body: ConfirmStoryCanonicalReadDto) => service.confirm(userId, progressId, beatId, body);
  return { userId, progressId, workId, sceneId, beatId, progress, work, release, manuscript,
    scene, part, beat, route, state, tx, prisma, service, preview, input, confirm };
}

describe('canonical read exact-source policy', () => {
  it.each([null, {}, ['nested'], 23, '', ' ', 'a', '\uD800', '\uDC00', 'a\0b', 'x'.repeat(64001)])('rejects invalid source %s', value => {
    expect(validCanonicalStoryText(value)).toBe(false);
  });
  it('keeps whitespace, emoji and combining forms exact without normalization', () => {
    for (const value of [' a b ', 'a\n b', '\ud83d\ude00\ud83d\ude00', 'x'.repeat(64000)]) expect(validCanonicalStoryText(value)).toBe(true);
    expect(canonicalReadTextHash(' a ')).not.toBe(canonicalReadTextHash('a'));
    expect(canonicalReadTextHash('e\u0301')).not.toBe(canonicalReadTextHash('\u00e9'));
  });
  it('preserves the existing author source checksum contract byte for byte', () => {
    const source = { workId: randomUUID(), ownerUserId: randomUUID(), releaseId: randomUUID(), releaseChecksum: 'a'.repeat(64),
      manuscriptVersionId: randomUUID(), manuscriptHash: 'b'.repeat(64), partId: randomUUID(), partPosition: 1,
      sceneId: randomUUID(), sceneKey: 's', scenePosition: 2, beatId: randomUUID(), beatPosition: 3,
      beatType: 'dialogue', sourceSceneKey: null, locale: 'ko', sourceText: ' Exact source. ' };
    expect(canonicalStorySourceChecksum(source)).toBe(releaseChecksum({ contract: 'story-canonical-interaction-source-v1', ...source }));
  });
});

describe('canonical reader confirmation service', () => {
  it.each(STORY_LOCALES)('previews exact %s metadata read-only without recording a read', async locale => {
    const f = fixture(), p = await f.preview(locale);
    expect(p).toMatchObject({ confirmationRecorded: false, readerMemoryApplied: false,
      identity: { userId: f.userId, progressId: f.progressId, beatId: f.beatId, locale, progressRevision: 3 } });
    expect(p.sourceTextHash).toBe(canonicalReadTextHash(f.beat.content[locale] as string));
    expect(p.scopeChecksum).toBe(canonicalReadScopeChecksum(p.identity));
    expect(JSON.stringify(p)).not.toContain('exact\nsource');
    expect(f.tx.$executeRaw.mock.calls[0][0].sql).toBe('SET TRANSACTION READ ONLY');
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    expect(f.tx.storyCanonicalReadReceipt.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });
  it('records one explicit confirmation and returns the same receipt on exact retry without another audit', async () => {
    const f = fixture(), body = await f.input();
    const result = await f.confirm(body);
    expect(result).toMatchObject({ readerMemoryApplied: false, idempotentReplay: false, invalidatedAt: null, beatId: f.beatId });
    f.state.existing = f.tx.storyCanonicalReadReceipt.create.mock.results[0].value && await f.tx.storyCanonicalReadReceipt.create.mock.results[0].value;
    const retry = await f.confirm(body);
    expect(retry).toMatchObject({ receiptId: result.receiptId, idempotentReplay: true });
    expect(f.tx.storyCanonicalReadReceipt.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'user', actorUserId: f.userId }) });
    expect(f.tx.storyReaderActorMemory.upsert).not.toHaveBeenCalled();
    expect(f.tx.storyAiContinuation.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
    expect(f.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { timeout: 15000, isolationLevel: 'Serializable' });
    expect(f.tx.$queryRaw.mock.calls.map(([sql]) => sql.sql).join(' ')).toContain('FOR UPDATE');
  });
  it.each(['progressRevision', 'sourceTextHash', 'scopeChecksum', 'invalidatedAt', 'resetCommandId', 'locale', 'routeNodeId'])('rejects mismatched/revoked replay field %s', async field => {
    const f = fixture(), body = await f.input();
    await f.confirm(body);
    f.state.existing = { ...await f.tx.storyCanonicalReadReceipt.create.mock.results[0].value,
      [field]: field === 'progressRevision' ? 4 : field === 'invalidatedAt' ? new Date() : 'changed' };
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_CANONICAL_READ_IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.storyCanonicalReadReceipt.create).toHaveBeenCalledTimes(1);
  });
  it.each(['foreign-user', 'foreign-beat', 'pending', 'generated', 'missing-route', 'fixture', 'release-changed',
    'version-changed', 'manuscript-changed', 'route-changed', 'act-changed', 'source-changed', 'translation-missing', 'nested-source'])('rejects stale or unavailable scope %s before writing', async kind => {
    const f = fixture(), body = await f.input();
    if (kind === 'foreign-user') f.progress.userId = randomUUID();
    if (kind === 'foreign-beat') f.beat.sceneId = randomUUID();
    if (kind === 'pending') f.progress.status = 'ai_pending';
    if (kind === 'generated') f.progress.currentGeneratedSceneId = randomUUID();
    if (kind === 'missing-route') f.progress.routeNodeId = null;
    if (kind === 'fixture') f.work.fixtureSource = true;
    if (kind === 'release-changed') f.work.activeReleaseId = randomUUID();
    if (kind === 'version-changed') f.work.publishedVersion = 2;
    if (kind === 'manuscript-changed') f.manuscript.contentHash = 'd'.repeat(64);
    if (kind === 'route-changed') f.route.routeHash = 'd'.repeat(64);
    if (kind === 'act-changed') f.part.actNumber = 2;
    if (kind === 'source-changed') f.beat.content.ko = 'New exact source.';
    if (kind === 'translation-missing') delete f.beat.content.ko;
    if (kind === 'nested-source') f.beat.content.ko = { text: 'Exact' };
    await expect(f.confirm(body)).rejects.toBeDefined();
    expect(f.tx.storyCanonicalReadReceipt.create).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it.each([false, 'true', 1, null, undefined])('requires boolean explicit confirmation %s', async ack => {
    const f = fixture(), body = await f.input();
    await expect(f.confirm({ ...body, displayedAndRead: ack } as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.tx.storyCanonicalReadReceipt.create).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '3'])('rejects invalid revision %s', async revision => {
    const f = fixture(), body = await f.input();
    await expect(f.confirm({ ...body, expectedRevision: revision } as never)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('requires access for a paid part even when the work is free', async () => {
    const f = fixture(); f.part.priceLumina = new Prisma.Decimal(100);
    await expect(f.preview()).rejects.toMatchObject({ response: { code: 'STORY_CANONICAL_READ_ACCESS_REQUIRED' } });
    f.tx.userEntitlement.findFirst.mockResolvedValue({ id: randomUUID() });
    const body = await f.input();
    await expect(f.confirm(body)).resolves.toMatchObject({ idempotentReplay: false });
    expect(f.tx.userEntitlement.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      revokedAt: null, startsAt: { lte: expect.any(Date) }, OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    }) }));
  });
  it('propagates audit failure and maps transaction conflict without retry', async () => {
    const f = fixture(), body = await f.input();
    f.tx.auditEvent.create.mockRejectedValue(new Error('audit fault'));
    await expect(f.confirm(body)).rejects.toThrow('audit fault');
    f.prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6.19.3' }));
    await expect(f.confirm(body)).rejects.toMatchObject({ response: { code: 'STORY_CANONICAL_READ_SCOPE_CHANGED' } });
  });
});

describe('canonical reader controller and DTO boundary', () => {
  it('requires JWT and private/no-store for both routes', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StoryCanonicalReadController)).toBe('me/story-progress/:progressId/canonical-read/:beatId');
    expect(Reflect.getMetadata(GUARDS_METADATA, StoryCanonicalReadController)).toContain(JwtAuthGuard);
    for (const method of ['preview', 'confirm'] as const) expect(Reflect.getMetadata(HEADERS_METADATA,
      StoryCanonicalReadController.prototype[method])).toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
  });
  it('rejects coercion, missing locale and extra privilege flags under strict validation', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    const f = fixture(), valid = await f.input();
    await expect(pipe.transform(valid, { type: 'body', metatype: ConfirmStoryCanonicalReadDto })).resolves.toMatchObject(valid);
    for (const bad of [{ ...valid, displayedAndRead: 'true' }, { ...valid, expectedRevision: '3' },
      { ...valid, locale: 'fr' }, { ...valid, admin: true }, { ...valid, expectedScopeChecksum: 'a'.repeat(63) }]) {
      await expect(pipe.transform(bad, { type: 'body', metatype: ConfirmStoryCanonicalReadDto })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(pipe.transform({}, { type: 'query', metatype: StoryCanonicalReadQueryDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

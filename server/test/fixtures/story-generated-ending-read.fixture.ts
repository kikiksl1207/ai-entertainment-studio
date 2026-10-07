import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { StoryGeneratedEndingReadService } from '../../src/story-production/story-generated-ending-read.service';
import type { ConfirmStoryGeneratedEndingReadDto } from '../../src/story-production/dto/story-generated-ending-read.dto';
import { STORY_LOCALES } from '../../src/story-production/story-production.policy';

export function fixture() {
  const userId = randomUUID(), progressId = randomUUID(), workId = randomUUID(), sceneId = randomUUID();
  const releaseId = randomUUID(), manuscriptId = randomUUID(), ownerUserId = randomUUID(), partId = randomUUID();
  const routeId = randomUUID(), parentId = randomUUID(), originId = randomUUID(), sourceSceneId = randomUUID();
  const assetId = randomUUID();
  const asset = { id: assetId, assetType: 'image', visibility: 'public', mimeType: 'image/webp',
    checksum: '1'.repeat(64), storageProvider: 'local', storageKey: 'synthetic-ending.webp', metadata: { identity: 'synthetic' } };
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
    storyWorkGenerationProfile: { findFirst: jest.fn(async () => null) },
    storyAnalysisJob: { findFirst: jest.fn(async () => null) },
    storyStyleProfileConsent: { findUnique: jest.fn(async () => null) },
    storyReaderProgress: { findFirst: find(progress), updateMany: jest.fn() }, storyWork: { findFirst: find(work) },
    storyRelease: { findFirst: find(release) }, storyManuscriptVersion: { findFirst: find(manuscript) },
    storyAiGeneratedScene: { findFirst: find(scene) }, storyPart: { findFirst: find(part) },
    storyAiContinuation: { findFirst: find(origin), create: jest.fn() }, storyProgressRouteNode: { findFirst: find(route) },
    storyAiGeneratedBeat: { findMany: jest.fn(async () => beats) }, storyAiGeneratedChoice: { count: jest.fn(async () => 0) },
    userEntitlement: { findFirst: jest.fn(async () => null) },
    asset: { findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.id === asset.id && asset.visibility === 'public' && asset.assetType === 'image' &&
      asset.mimeType === 'image/webp' && asset.checksum !== null ? asset : null) },
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
      deliveryState: 'ready', endingType: 'ai_generated', visualManifest: { background: { state: 'ready',
        publicAssetPath: `/api/v1/story-visual-assets/${assetId}` } },
      beats: beats.map(beat => ({ id: beat.id, position: beat.position, content: { value: beat.content[locale] } })) } });
  const stories = { currentProgress: jest.fn(async (_user: string, _progress: string, locale: string) => page(locale)) };
  const service = new StoryGeneratedEndingReadService(prisma as never, stories as never);
  const preview = (locale = 'ko', fromPosition = 1) => service.preview(userId, progressId, { locale, fromPosition });
  const input = async (locale = 'ko'): Promise<ConfirmStoryGeneratedEndingReadDto> => { const p = await preview(locale); return { locale, fromPosition: 1,
    expectedRevision: p.expectedRevision, expectedScopeChecksum: p.scopeChecksum, expectedSourceTextHash: p.sourceTextHash,
    idempotencyKey: randomUUID(), displayedAndRead: true }; };
  const confirm = (body: ConfirmStoryGeneratedEndingReadDto) => service.confirm(userId, progressId, body);
  return { userId, progressId, progress, work, release, manuscript, scene, part, origin, route, beats, rows, tx,
    prisma, stories, page, service, preview, input, confirm, asset };
}

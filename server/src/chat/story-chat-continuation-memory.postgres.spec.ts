import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { activationFixture } from '../story-production/story-ai-activation.postgres-fixture';
import { StoryArtistParticipantService } from '../story-production/story-artist-participant.service';
import { PersistedStoryContinuationLegalActivationGate } from '../story-production/story-continuation-legal-activation.gate';
import { StoryEconomicsService } from '../story-production/story-economics.service';
import { StoryProductionService } from '../story-production/story-production.service';
import { loadStoryChatMemoryContext, unverifiedStoryMemoryContext } from './story-chat-memory';

const url = process.env.STORY_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const artistName = 'Continuation Memory Artist';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

postgres('Continuation settlement/review/reuse to memory (actual services, isolated PostgreSQL)', () => {
  let base: PrismaClient, db: PrismaClient;
  const tracked = new Map<string, Set<string>>();
  const previousRegion = process.env.STORY_AI_REGION;

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (process.env.NODE_ENV !== 'test' || parsed.protocol !== 'postgresql:' || parsed.hostname !== '127.0.0.1' ||
        parsed.port !== '55432' || parsed.username !== 'lumina_qa' || parsed.pathname !== '/lumina_story_qa' ||
        parsed.search || parsed.hash) throw new Error('Dedicated story QA database required');
    process.env.STORY_AI_REGION = 'KR';
    base = new PrismaClient({ datasources: { db: { url } } }); await base.$connect();
    // Track partial fixture creation as well, so a setup failure cannot leave orphan users.
    db = base.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      const result = await query(args);
      if (operation === 'create' || operation === 'upsert') {
        const id = (result as { id?: unknown }).id;
        if (typeof id === 'string' && uuid.test(id)) {
          const ids = tracked.get(model) ?? new Set<string>(); ids.add(id); tracked.set(model, ids);
        }
      }
      return result;
    } } } }) as unknown as PrismaClient;
  });
  beforeEach(() => { jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Provider calls forbidden')); });
  afterEach(async () => {
    try {
      const workIds = [...(tracked.get('StoryWork') ?? [])];
      await base.$transaction(async tx => {
        const continuations = await tx.storyAiContinuation.findMany({ where: { workId: { in: workIds } }, select: { siblingContextKey: true } });
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.storyAiSiblingNarrativeClaim.deleteMany({ where: {
          siblingContextKey: { in: continuations.flatMap(row => row.siblingContextKey ? [row.siblingContextKey] : []) },
        } });
        for (const [model, ids] of [...tracked].reverse()) {
          const key = model[0].toLowerCase() + model.slice(1);
          const delegate = (tx as unknown as Record<string, { deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown> }>)[key];
          await delegate.deleteMany({ where: { id: { in: [...ids] } } });
        }
      }, { timeout: 15000 });
      for (const [model, ids] of tracked) {
        const key = model[0].toLowerCase() + model.slice(1);
        const delegate = (base as unknown as Record<string, { count: (args: { where: { id: { in: string[] } } }) => Promise<number> }>)[key];
        expect(await delegate.count({ where: { id: { in: [...ids] } } })).toBe(0);
      }
      expect(global.fetch).not.toHaveBeenCalled(); tracked.clear();
    } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    if (previousRegion === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = previousRegion;
    await base?.$disconnect();
  });

  async function fixture(differentSecondArtist = false) {
    const f = await activationFixture(db);
    await db.storyWork.update({ where: { id: f.work.id }, data: { coverManifest: { url: '/public/story/memory/cover.webp' }, publishedAt: new Date(0) } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: { sceneKey: f.scene.sceneKey,
      background: { state: 'ready', publicAssetPath: '/public/story/memory/source.webp', altKey: 'scene' }, characters: [],
      fallback: { publicAssetPath: '/public/story/memory/source.webp', altKey: 'scene' } } } });
    await db.storyBeat.update({ where: { sceneId_position: { sceneId: f.scene.id, position: 1 } },
      data: { beatType: 'dialogue', content: { ko: `${artistName}: A read source promise.` } } });
    await db.storyBeat.create({ data: { sceneId: f.scene.id, position: 2, beatType: 'dialogue',
      content: { ko: `${artistName}: An unread source future.` } } });
    const artist = await db.artist.create({ data: { slug: `continuation-memory-${randomUUID()}`, displayName: artistName, status: 'active' } });
    const asset = await db.asset.create({ data: { assetType: 'image', storageKey: `/memory/${randomUUID()}.webp`,
      mimeType: 'image/webp', checksum: 'c'.repeat(64), fileSizeBytes: BigInt(100) } });
    await db.artistAsset.create({ data: { artistId: artist.id, assetId: asset.id, usageType: 'thumb', isPrimary: true } });
    const settings = normalizeCreatorGenerationProfile('artist', { kind: 'artist', schemaVersion: 'creator-generation-profile-v1', sections: [
      { key: 'fixed_identity', decision: 'accepted', value: { summary: 'Synthetic adult identity' }, evidence: [] },
      { key: 'adaptable_presentation', decision: 'accepted', value: { summary: 'Story wardrobe' }, evidence: [] },
    ] });
    const sourceFingerprint = 'd'.repeat(64);
    const profile = await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id, status: 'approved',
      sourceFingerprint, referenceAssetIds: [asset.id], profileVersion: 1, reviewRevision: 1,
      draftSettings: settings as unknown as Prisma.InputJsonValue, approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings), approvedByUserId: f.owner.id } });
    const participants = new StoryArtistParticipantService(db as never, new ConfigService());
    for (const [index, progress] of f.progresses.entries()) {
      let participantArtistId = artist.id;
      if (index === 1 && differentSecondArtist) {
        const other = await db.artist.create({ data: { slug: `continuation-memory-${randomUUID()}`,
          displayName: 'Another Memory Artist', status: 'active' } });
        await db.artistAsset.create({ data: { artistId: other.id, assetId: asset.id, usageType: 'thumb', isPrimary: true } });
        await db.artistStoryIdentityProfile.create({ data: { artistId: other.id, status: 'approved', sourceFingerprint,
          referenceAssetIds: [asset.id], profileVersion: 1, reviewRevision: 1,
          draftSettings: settings as unknown as Prisma.InputJsonValue, approvedSettings: settings as unknown as Prisma.InputJsonValue,
          approvedFingerprint: profile.approvedFingerprint, approvedByUserId: f.owner.id } });
        participantArtistId = other.id;
      }
      await db.$transaction(tx => participants.bind(tx, {
        progressId: progress.id, workId: progress.workId, userId: progress.userId, artistId: participantArtistId,
      }));
    }
    const provider = { readiness: jest.fn().mockResolvedValue({ enabled: true }), generate: jest.fn().mockRejectedValue(new Error('Generation forbidden')) };
    const economics = new StoryEconomicsService(db as never, new PersistedStoryContinuationLegalActivationGate(f.activation),
      provider as never, f.approval, participants);
    const stories = new StoryProductionService(db as never);
    const progressAt = (index = 0) => db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[index].id } });
    const memoryInput = (index = 0) => ({ userId: f.progresses[index].userId, progressId: f.progresses[index].id,
      artistId: artist.id, artistDisplayName: artistName });
    async function read(position: number, index = 0) {
      const progress = await progressAt(index);
      return stories.updateBeatProgress(progress.userId, progress.id, { position, expectedRevision: progress.progressRevision });
    }
    async function recordReadWithoutVisualProjection(position: number, index = 0) {
      // This integration tests the read write and memory boundary, not scene-image approval/delivery.
      const projection = jest.spyOn(stories, 'currentProgress').mockImplementation(async () => {
        const progress = await progressAt(index);
        return { progressId: progress.id, status: progress.status, revision: progress.progressRevision,
          currentBeatPosition: progress.currentBeatPosition } as never;
      });
      try { return await read(position, index); } finally { projection.mockRestore(); }
    }
    async function request(index = 0) {
      const progress = await progressAt(index);
      const work = await db.storyWork.findUniqueOrThrow({ where: { id: f.work.id } });
      return db.$transaction(tx => economics.requestRecommendedChoiceTx(tx, { userId: progress.userId, progress,
        work, part: f.part, scene: f.scene, release: f.release, choice: f.choice,
        sourceKind: 'canonical', locale: 'ko', idempotencyKey: `memory-request-${progress.id}` }));
    }
    async function settle(ending = false, failed = false) {
      const first = await request();
      await db.storyAiContinuation.update({ where: { id: first.continuationId }, data: {
        status: 'processing', leaseToken: 'memory-lease', leaseOwner: 'isolated-test',
        leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1,
      } });
      const result = await economics.settleContinuation(null, first.continuationId, failed ? {
        status: 'failed', moderationDecision: 'reject', inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
        imageUnits: 0, failureCode: 'synthetic_failure',
      } : {
        status: 'completed', moderationDecision: 'allow', actualCostKrw: 0, inputTokens: 10, outputTokens: 10,
        cachedInputTokens: 0, imageUnits: 0, resultTitle: { ko: 'Synthetic continuation' },
        resultBeats: [
          { beatType: 'dialogue', content: { ko: `${artistName}: A generated promise.` } },
          { beatType: 'dialogue', content: { ko: `${artistName}: An unread generated future.` } },
        ], resultVisualManifest: { sceneKey: `ai-${first.continuationId}`,
          background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
          fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } },
        nextChoices: ending ? [] : [{ choiceKey: 'next', label: { ko: 'Continue' } }],
        ...(ending ? { ending: { endingKey: 'ai-memory-ending' } } : {}),
      }, `memory-settle-${first.continuationId}`, 'memory-lease');
      expect(provider.generate).not.toHaveBeenCalled();
      return { first, result, continuation: await db.storyAiContinuation.findUniqueOrThrow({ where: { id: first.continuationId } }) };
    }
    return { ...f, artist, profile, provider, economics, stories, progressAt, memoryInput, read,
      recordReadWithoutVisualProjection, request, settle };
  }

  it('loads the source cursor actually saved by settlement and then adds only read generated dialogue', async () => {
    const f = await fixture(); await f.read(1); const settled = await f.settle();
    const progress = await f.progressAt();
    expect(progress.pathSummary).toEqual([expect.objectContaining({ sourceSceneId: f.scene.id, readBeatPosition: 1 })]);
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } }))
      .toMatchObject({ narrativeStep: { sourceSceneId: f.scene.id, readBeatPosition: 1 } });
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput())).items.map(item => item.artistDialogue)).toEqual(['A read source promise.']);
    await f.read(1);
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput())).items.map(item => item.artistDialogue))
      .toEqual(['A generated promise.', 'A read source promise.']);
    expect(await db.storyAiGeneratedScene.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyScene.count({ where: { partId: f.part.id } })).toBe(1);
    expect(await f.economics.settleContinuation(null, settled.continuation.id, { status: 'failed', moderationDecision: 'reject',
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0 }, `memory-settle-${settled.continuation.id}`, 'memory-lease'))
      .toMatchObject({ status: 'completed', idempotentReplay: true });
    expect(await db.storyAiGeneratedScene.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('reuses reviewed content without inheriting the originating reader cursor or spending another use', async () => {
    const f = await fixture(); await f.read(1); await f.settle();
    const pins = await db.storyProgressArtistParticipant.findMany({ where: { workId: f.work.id } });
    expect(new Set(pins.map(pin => pin.id)).size).toBe(2);
    expect(new Set(pins.map(pin => pin.participantFingerprint)).size).toBe(1);
    const shared = await db.storyAiReusableResult.findFirstOrThrow({ where: { workId: f.work.id } });
    await f.approve(shared);
    const reuse = await f.request(1), progress = await f.progressAt(1);
    expect(reuse).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
    expect(progress.pathSummary).toEqual([expect.objectContaining({ sourceSceneId: f.scene.id, readBeatPosition: 0 })]);
    expect(await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } }))
      .toMatchObject({ narrativeStep: { readBeatPosition: 0, provenance: 'ai_reused' } });
    expect(await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).toEqual(unverifiedStoryMemoryContext());
    await f.recordReadWithoutVisualProjection(1, 1);
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).items.map(item => item.artistDialogue)).toEqual(['A generated promise.']);
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput())).items.map(item => item.artistDialogue)).toEqual(['A read source promise.']);
    expect(await db.storyAiAllowanceBucket.findUnique({ where: { userId_releaseId: { userId: f.second.id, releaseId: f.release.id } } }))
      .toBeNull();
    expect(await db.storyAiUsageLedger.findFirstOrThrow({ where: { continuationId: reuse.continuationId, eventKind: 'shared_route_reused' } }))
      .toMatchObject({ allowanceDelta: 0, actualCostKrw: new Prisma.Decimal(0) });
  });

  it('does not share content when the second reader selected a different approved character', async () => {
    const f = await fixture(true); await f.read(1); await f.settle();
    await f.approve(await db.storyAiReusableResult.findFirstOrThrow({ where: { workId: f.work.id } }));
    const next = await f.request(1);
    expect(next).toMatchObject({ status: 'queued', provenance: 'ai_generated' });
    expect(await db.storyAiGeneratedScene.count({ where: { progressId: f.progresses[1].id } })).toBe(0);
    expect(await db.storyAiAllowanceBucket.findUniqueOrThrow({ where: {
      userId_releaseId: { userId: f.second.id, releaseId: f.release.id },
    } })).toMatchObject({ reservedCount: 1, consumedCount: 0 });
    expect(await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).toEqual(unverifiedStoryMemoryContext());
  });

  it('records a reused ending without copying another reader history or reopening the completed story', async () => {
    const f = await fixture(); await f.read(1); await f.settle(true);
    await f.approve(await db.storyAiReusableResult.findFirstOrThrow({ where: { workId: f.work.id } }));
    expect(await f.request(1)).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
    expect(await f.progressAt(1)).toMatchObject({ status: 'completed', currentBeatPosition: 0 });
    expect(await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).toEqual(unverifiedStoryMemoryContext());
    await f.recordReadWithoutVisualProjection(1, 1);
    expect(await f.progressAt(1)).toMatchObject({ status: 'completed', currentBeatPosition: 1 });
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).items.map(item => item.artistDialogue))
      .toEqual(['A generated promise.']);
    expect(await db.storyEndingDiscovery.count({ where: { workId: f.work.id } })).toBe(2);
  });

  it('does not advance the second reader or create phantom memories before review approval', async () => {
    const f = await fixture(); await f.read(1); await f.settle();
    const before = await f.progressAt(1);
    await expect(f.request(1)).rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING' } });
    expect(await f.progressAt(1)).toEqual(before);
    expect(await loadStoryChatMemoryContext(db as never, f.memoryInput(1))).toEqual(unverifiedStoryMemoryContext());
    expect(await db.storyAiContinuation.count({ where: { userId: f.second.id, workId: f.work.id } })).toBe(0);
  });

  it('records reading an actual generated ending and keeps completion while adding its shared dialogue', async () => {
    const f = await fixture(); await f.read(1); await f.settle(true);
    expect(await f.progressAt()).toMatchObject({ status: 'completed', currentBeatPosition: 0 });
    await f.read(1);
    expect(await f.progressAt()).toMatchObject({ status: 'completed', currentBeatPosition: 1 });
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput())).items.map(item => item.artistDialogue))
      .toEqual(['A generated promise.', 'A read source promise.']);
    expect(await db.storyEndingDiscovery.count({ where: { workId: f.work.id } })).toBe(1);
  });

  it('keeps the original read position after a failed settlement without storing a generated memory', async () => {
    const f = await fixture(); await f.read(1); const { result } = await f.settle(false, true);
    expect(result).toMatchObject({ status: 'failed' });
    expect(await f.progressAt()).toMatchObject({ status: 'active', currentSceneId: f.scene.id, currentBeatPosition: 1, pathSummary: [] });
    expect(await db.storyAiGeneratedScene.count({ where: { workId: f.work.id } })).toBe(0);
    expect((await loadStoryChatMemoryContext(db as never, f.memoryInput())).items.map(item => item.artistDialogue)).toEqual(['A read source promise.']);
  });
});

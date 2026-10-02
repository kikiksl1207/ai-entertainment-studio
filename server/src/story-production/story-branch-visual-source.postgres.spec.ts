import { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { StoryContinuationProviderResult } from './story-continuation.provider';
import { StoryProductionService } from './story-production.service';
import { StoryVisualGenerationService } from './story-visual-generation.service';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('Stored branch image direction source (isolated PostgreSQL, no provider)', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(async () => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
        url.username !== 'lumina_qa' || url.pathname !== '/lumina_story_qa' || url.search || url.hash || process.env.NODE_ENV !== 'test') {
      throw new Error('Dedicated story QA database required');
    }
    process.env.STORY_AI_REGION = 'KR';
    db = postgresClient();
    await db.$connect();
  });
  beforeEach(() => jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Provider calls are forbidden in this QA')));
  afterEach(() => {
    try { expect(globalThis.fetch).not.toHaveBeenCalled(); } finally { jest.restoreAllMocks(); }
  });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  async function fixture(reuse = false) {
    const f = await activationFixture(db, true, reuse);
    const continuation = await f.generatePersonal();
    const result = await storedResult(continuation.resultGeneratedSceneId!);
    const config = { get: () => undefined };
    const participants = new StoryArtistParticipantService(db as never, config as never);
    const visuals = new StoryVisualGenerationService(db as never, config as never, undefined, participants);
    jest.spyOn((visuals as any).logger, 'warn').mockImplementation();
    return { ...f, continuation, result, participants, visuals };
  }

  async function storedResult(sceneId: string): Promise<Pick<StoryContinuationProviderResult, 'title' | 'beats'>> {
    const scene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: sceneId } });
    const beats = await db.storyAiGeneratedBeat.findMany({ where: { sceneId }, orderBy: { position: 'asc' } });
    return { title: scene.title as Record<string, string>, beats: beats.map(beat => ({
      beatType: beat.beatType as 'paragraph', content: beat.content as Record<string, string>,
    })) };
  }

  async function bindArtist(f: Awaited<ReturnType<typeof fixture>>) {
    const artist = await db.artist.create({ data: { slug: `branch-source-qa-${randomUUID()}`, displayName: 'Synthetic fixed artist', status: 'active' } });
    const asset = await db.asset.create({ data: { assetType: 'image', visibility: 'public', storageProvider: 'local',
      storageKey: `/qa/${randomUUID()}.webp`, mimeType: 'image/webp', fileSizeBytes: 100, checksum: 'e'.repeat(64) } });
    await db.artistAsset.create({ data: { artistId: artist.id, assetId: asset.id, usageType: 'profile' } });
    const settings = normalizeCreatorGenerationProfile('artist', { schemaVersion: 'creator-generation-profile-v1', kind: 'artist',
      sections: [{ key: 'fixed_identity', decision: 'accepted', evidence: [], value: { hair: 'black', proportions: 'adult' } },
        { key: 'adaptable_presentation', decision: 'accepted', evidence: [], value: { wardrobe: true } }] });
    const fingerprint = 'f'.repeat(64);
    await db.artistStoryIdentityProfile.create({ data: { artistId: artist.id, sourceFingerprint: fingerprint,
      referenceAssetIds: [asset.id], profileVersion: 1, reviewRevision: 1, status: 'approved',
      approvedSettings: settings as unknown as Prisma.InputJsonValue,
      approvedFingerprint: creatorGenerationProfileFingerprint(fingerprint, settings), approvedByUserId: f.owner.id, approvedAt: new Date() } });
    await db.$transaction(tx => f.participants.bind(tx, { artistId: artist.id, progressId: f.continuation.progressId,
      userId: f.reader.id, workId: f.work.id }));
    const context = await f.participants.pinnedContext(db as never, f.continuation.progressId);
    return { artist, context: context! };
  }

  it('registers only stored private prose and retries without another prompt or provider call', async () => {
    const f = await fixture();
    const source = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: f.continuation.resultGeneratedSceneId! } });
    const first = await f.visuals.registerGeneratedContinuationPrompt(f.continuation.id, f.result);
    expect(first).toMatchObject({ created: true, sourceSceneKey: `ai-${f.continuation.id}` });
    await expect(f.visuals.registerGeneratedContinuationPrompt(f.continuation.id, f.result)).resolves.toMatchObject({ created: false });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: source.id } })).toEqual(source);
  });

  it.each(['title', 'prose', 'release', 'unready'])('rejects %s mismatch without writing a prompt', async change => {
    const f = await fixture();
    const result = structuredClone(f.result);
    if (change === 'title') result.title.ko = 'Another branch title';
    if (change === 'prose') result.beats[0].content.ko = 'Another branch outcome';
    if (change === 'release') await db.storyAiContinuation.update({ where: { id: f.continuation.id }, data: { releaseChecksum: 'c'.repeat(64) } });
    if (change === 'unready') await db.storyAiGeneratedScene.update({ where: { id: f.continuation.resultGeneratedSceneId! }, data: { status: 'invalidated' } });
    await expect(f.visuals.registerGeneratedContinuationPrompt(f.continuation.id, result))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' } });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('does not attach an artist selected after the no-artist branch was generated', async () => {
    const f = await fixture();
    await bindArtist(f);
    await expect(f.visuals.variantKeyForProgress(f.continuation.progressId)).resolves.toBe('default');
    await f.visuals.registerGeneratedContinuationPrompt(f.continuation.id, f.result);
    const prompt = await db.storyVisualPrompt.findFirstOrThrow({ where: { workId: f.work.id } });
    expect(prompt.promptText).not.toContain('Synthetic fixed artist');
    expect(prompt.promptText).not.toContain('selected participating artist identity');
  });

  it('recovers a stored reused scene direction on first read and retries without another prompt', async () => {
    const f = await fixture(true);
    const reusable = await db.storyAiReusableResult.findFirstOrThrow({ where: { workId: f.work.id } });
    // Synthetic QA evidence exercises reuse authorization, not real AI quality.
    await f.approve(reusable);
    const second = await f.request(1);
    const continuation = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: second.continuationId } });
    expect(continuation.status).toBe('completed');
    const result = await storedResult(continuation.resultGeneratedSceneId!);
    await expect(f.visuals.promptKeys(f.work.id, f.release.id, [`ai-reuse-${continuation.id}`]))
      .resolves.toEqual(new Set([`ai-reuse-${continuation.id}`]));
    await expect(f.visuals.registerGeneratedContinuationPrompt(continuation.id, result))
      .resolves.toMatchObject({ created: false });
    await expect(f.visuals.registerGeneratedContinuationPrompt(continuation.id, result))
      .resolves.toMatchObject({ created: false });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(1);
    expect(await db.storyVisualGeneration.count({ where: { workId: f.work.id } })).toBe(0);
  });

  it('rejects a renamed artist against the original synthetic branch pin, including legacy approval checks', async () => {
    const f = await fixture();
    const { artist, context } = await bindArtist(f);
    await db.storyAiContinuation.update({ where: { id: f.continuation.id }, data: {
      contextReferences: { ...(f.continuation.contextReferences as object), participantPin: context.pin } as unknown as Prisma.InputJsonValue,
    } });
    await expect(f.visuals.variantKeyForProgress(f.continuation.progressId)).resolves.toBe(`artist:${context.pin.participantFingerprint}`);
    await db.artist.update({ where: { id: artist.id }, data: { displayName: 'Renamed synthetic artist' } });
    await expect(f.visuals.variantKeyForProgress(f.continuation.progressId)).resolves.toBeNull();
    const progressBefore = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.continuation.progressId } });
    const reader = new StoryProductionService(db as never, f.economics, f.provider as never,
      undefined, undefined, f.visuals, undefined, f.participants);
    await expect(reader.currentProgress(f.reader.id, f.continuation.progressId, 'ko')).resolves.toMatchObject({
      scene: { id: f.continuation.resultGeneratedSceneId, deliveryState: 'artwork_unavailable',
        visualGenerationAvailable: false, beats: [] }, choices: [],
    });
    expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: progressBefore.id } })).toEqual(progressBefore);
    await expect(f.visuals.registerGeneratedContinuationPrompt(f.continuation.id, f.result))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    await expect((f.visuals as any).assertPromptApprovalCurrent(db, f.work.id, f.release.id,
      { sourceKind: 'ai_branch', sourceSceneKey: `ai-${f.continuation.id}` }, {}))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
    expect(await db.storyVisualPrompt.count({ where: { workId: f.work.id } })).toBe(0);
  });
});

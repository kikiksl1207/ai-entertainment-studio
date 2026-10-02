import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryProductionService } from './story-production.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { StoryContinuationContextAssembler, type StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import { STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('approved manuscript source boundaries (dedicated loopback PostgreSQL, offline AI)', () => {
  let db: PrismaClient;
  const originalRegion = process.env.STORY_AI_REGION;

  beforeAll(() => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
        url.username !== 'lumina_qa' || url.pathname !== '/lumina_story_qa' || url.search || url.hash) {
      throw new Error('Dedicated loopback lumina_story_qa database required');
    }
    process.env.STORY_AI_REGION = 'KR';
    db = postgresClient();
  });

  afterAll(async () => {
    if (originalRegion === undefined) delete process.env.STORY_AI_REGION;
    else process.env.STORY_AI_REGION = originalRegion;
    await db?.$disconnect();
  });

  it('pins source-tagged author plans separately from reader history and rejects a changed approval', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      const f = await activationFixture(db);
      await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date() } });
      await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: {
        sceneKey: 'source', background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      } } });
      await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { aiInputTokenLimit: 8192 } });
      const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
      const sourceRef = `analysis:${randomUUID()}`;
      const settings = normalizeCreatorGenerationProfile('story', {
        schemaVersion: 'creator-generation-profile-v1', kind: 'story',
        sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
          key, decision: 'accepted', value: key === 'timeline'
            ? { summary: 'The mother dies on the original route in part 32.', observations: [
                { title: 'Original ending', detail: 'ORIGINAL_FUTURE_DEATH', sourceRef },
              ] }
            : { summary: `${key} approved constraint` },
          evidence: key === 'timeline' ? [{ sourceType: 'manuscript',
            sourceRef: `${sourceRef}:PART-32:17`, summary: 'Synthetic future source' }] : [],
        })),
      });
      const sourceFingerprint = 'c'.repeat(64);
      const profile = await db.storyWorkGenerationProfile.create({ data: {
        workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
        analysisJobId: analysis.id, sourceFingerprint, reviewRevision: 1, status: 'approved',
        draftSettings: settings as never, approvedSettings: settings as never,
        approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
        approvedByUserId: f.owner.id, approvedAt: new Date(),
      } });
      const contexts: StoryContinuationApprovedContext[] = [];
      Object.assign(f.provider, { preflight: jest.fn(async (request: { approvedContext: StoryContinuationApprovedContext }) => {
        contexts.push(request.approvedContext);
        return { supported: true, inputTokenUpperBound: 100 };
      }) });
      const production = new StoryProductionService(db as never, f.economics, f.provider as never,
        new PersistedStoryContinuationLegalActivationGate(f.activation));
      const start = await production.startProgress(f.reader.id, f.work.id, { mode: 'continue', locale: 'ko' });
      const queued = await production.selectChoice(f.reader.id, start.progressId,
        f.choice.id, start.revision, 'ko', randomUUID()) as { continuationId: string; status: string };
      expect(queued.status).toBe('queued');
      expect(contexts).toHaveLength(1);
      const timeline = contexts[0].generationProfile?.sections.find(section => section.key === 'timeline')?.value;
      expect(timeline).toMatchObject({ referenceScope: 'author_plan_not_route_history', observations: [{
        detail: 'ORIGINAL_FUTURE_DEATH', sourceRef, sourcePartKey: 'PART-32', sourceParagraphIndex: 17,
        referenceScope: 'author_plan_not_route_history',
      }] });
      expect(JSON.stringify({ scene: contexts[0].sourceScene, path: contexts[0].path,
        memories: contexts[0].memories, route: contexts[0].routeContinuity })).not.toContain('ORIGINAL_FUTURE_DEATH');
      const leaseToken = randomUUID();
      const persisted = await db.storyAiContinuation.update({ where: { id: queued.continuationId }, data: {
        status: 'processing', leaseToken, leaseOwner: 'offline-source-boundary-test',
        leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
      } });
      expect(persisted.contextReferences).toMatchObject({ generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
        generationProfilePin: { id: profile.id, reviewRevision: 1 } });
      const assembler = new StoryContinuationContextAssembler(db as never);
      const claim = { continuationId: queued.continuationId, leaseToken, attemptCount: 1, maxAttempts: 3, request: {} as never };
      await expect(assembler.assemble(claim)).resolves.toMatchObject({ generationProfile: contexts[0].generationProfile });
      await db.storyWorkGenerationProfile.update({ where: { id: profile.id }, data: { reviewRevision: 2 } });
      await expect(assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
      expect(f.provider.generate).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  }, 90_000);
});

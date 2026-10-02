import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryProductionService } from './story-production.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('deep generated branch context (dedicated loopback PostgreSQL, offline AI)', () => {
  let db: PrismaClient;
  const originalRegion = process.env.STORY_AI_REGION;

  beforeAll(() => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
        url.port !== '55432' || url.username !== 'lumina_qa' ||
        url.pathname !== '/lumina_story_qa' || url.search || url.hash) {
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

  it('pins only the reader path and read beats across a divergent generated choice', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      const f = await activationFixture(db);
      await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date() } });
      await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: visual('source') } });
      const future = await db.storyScene.create({ data: {
        partId: f.part.id, sceneKey: 'other-reader-future', position: 2,
        title: { ko: 'UNVISITED_AUTHORED_FUTURE' }, status: 'published',
        visualManifest: visual('other-reader-future'),
      } });
      await db.storyBeat.create({ data: {
        sceneId: future.id, position: 1, beatType: 'paragraph',
        content: { ko: 'UNVISITED_AUTHORED_FUTURE_BEAT' },
      } });
      const authored = await db.storyChoice.create({ data: {
        sceneId: f.scene.id, choiceKey: 'authored-future', position: 2,
        label: { ko: 'OTHER_READER_AUTHORED_ACTION' }, routeKind: 'writer_original',
        targetSceneId: future.id,
      } });
      const contexts: StoryContinuationApprovedContext[] = [];
      const preflight = jest.fn(async (request: { approvedContext: StoryContinuationApprovedContext }) => {
        contexts.push(request.approvedContext);
        return { supported: true, inputTokenUpperBound: 100 };
      });
      Object.assign(f.provider, { preflight });
      const production = new StoryProductionService(db as never, f.economics, f.provider as never,
        new PersistedStoryContinuationLegalActivationGate(f.activation));

      const otherStart = await production.startProgress(f.second.id, f.work.id, { mode: 'continue', locale: 'ko' });
      const otherRoute = await production.selectChoice(f.second.id, otherStart.progressId,
        authored.id, otherStart.revision, 'ko');
      expect(otherRoute).toMatchObject({ scene: { id: future.id }, status: 'active' });
      const start = await production.startProgress(f.reader.id, f.work.id, { mode: 'continue', locale: 'ko' });
      const first = await production.selectChoice(f.reader.id, start.progressId,
        f.choice.id, start.revision, 'ko', randomUUID()) as { continuationId: string; status: string };
      expect(first.status).toBe('queued');

      async function settle(continuationId: string, title: string, beats: string[],
        nextChoices: Array<{ choiceKey: string; label: { ko: string } }>, endingKey?: string) {
        const leaseToken = randomUUID();
        await db.storyAiContinuation.update({ where: { id: continuationId }, data: {
          status: 'processing', leaseToken, leaseOwner: 'offline-deep-branch-test',
          leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
        } });
        await f.economics.settleContinuation(null, continuationId, {
          status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
          inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
          resultTitle: { ko: title },
          resultBeats: beats.map((content) => ({ beatType: 'paragraph', content: { ko: content } })),
          resultVisualManifest: visual(`ai-${continuationId}`),
          nextChoices, ...(endingKey ? { ending: { endingKey } } : {}),
        }, `settle-${continuationId}`, leaseToken);
        return db.storyAiContinuation.findUniqueOrThrow({ where: { id: continuationId } });
      }

      const generated = await settle(first.continuationId, 'FIRST_GENERATED_SCENE',
        ['FIRST_READ_BEAT', 'FIRST_UNREAD_BEAT'], [
          { choiceKey: 'sibling-a', label: { ko: 'SIBLING_A_ACTION' } },
          { choiceKey: 'divergent', label: { ko: 'DIVERGENT_ACTION' } },
          { choiceKey: 'sibling-c', label: { ko: 'SIBLING_C_ACTION' } },
        ]);
      const choices = await db.storyAiGeneratedChoice.findMany({
        where: { sceneId: generated.resultGeneratedSceneId! }, orderBy: { position: 'asc' },
      });
      expect(choices.map((choice) => choice.choiceKey)).toEqual(['sibling-a', 'divergent', 'sibling-c']);
      const atGenerated = await production.currentProgress(f.reader.id, start.progressId, 'ko');
      expect(atGenerated).toMatchObject({
        status: 'active', currentBeatPosition: 0, scene: { id: generated.resultGeneratedSceneId },
      });
      const readFirst = await production.updateBeatProgress(f.reader.id, start.progressId,
        { position: 1, expectedRevision: atGenerated.revision }, 'ko');
      const second = await production.selectChoice(f.reader.id, start.progressId,
        choices[1].id, readFirst.revision, 'ko', randomUUID()) as { continuationId: string; status: string };
      expect(second.status).toBe('queued');
      expect(contexts).toHaveLength(2);
      expect(contexts[1]).toMatchObject({
        sourceScene: { title: 'FIRST_GENERATED_SCENE', beats: [
          { beatType: 'paragraph', content: 'FIRST_READ_BEAT' },
        ] },
        selectedChoice: { label: 'DIVERGENT_ACTION' },
      });
      expect(contexts[1].path.map((step) => step.choiceLabel)).toEqual(['Explore another path']);
      expect(contexts[1].routeContinuity?.actions.map((action) => action.choiceLabel))
        .toEqual(['Explore another path']);
      for (const marker of ['FIRST_UNREAD_BEAT', 'SIBLING_A_ACTION', 'SIBLING_C_ACTION',
        'OTHER_READER_AUTHORED_ACTION', 'UNVISITED_AUTHORED_FUTURE', 'UNVISITED_AUTHORED_FUTURE_BEAT']) {
        expect(JSON.stringify(contexts[1])).not.toContain(marker);
      }

      const ending = await settle(second.continuationId, 'PRIVATE_ENDING',
        ['The selected route concludes.'], [], 'ai-deep-divergent-ending');
      const current = await production.currentProgress(f.reader.id, start.progressId, 'ko');
      expect(current).toMatchObject({ status: 'completed', scene: { id: ending.resultGeneratedSceneId } });
      const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: start.progressId } });
      expect(progress.visitedEndingKeys).toContain('ai-deep-divergent-ending');
      expect((progress.pathSummary as Array<{ choiceId: string }>).map((step) => step.choiceId))
        .toEqual([f.choice.id, choices[1].id]);
      expect((progress.pathSummary as Array<{ readBeatPosition?: number }>)[1].readBeatPosition).toBe(1);
      const routeNode = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: progress.routeNodeId! } });
      expect(routeNode.narrativeStep).toMatchObject({
        sourceGeneratedSceneId: generated.resultGeneratedSceneId,
        choiceId: choices[1].id, readBeatPosition: 1,
        generatedSceneId: ending.resultGeneratedSceneId,
      });
      expect(await db.storyEndingDiscovery.count({ where: {
        userId: f.reader.id, workId: f.work.id, releaseId: f.release.id,
        endingKey: 'ai-deep-divergent-ending', endingKind: 'ai_generated',
      } })).toBe(1);
      expect(f.provider.generate).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  }, 90_000);
});

function visual(sceneKey: string) {
  return {
    sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
    characters: [],
    fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
  };
}

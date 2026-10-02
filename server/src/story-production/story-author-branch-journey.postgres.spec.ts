import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryProductionService } from './story-production.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('author branch journey (dedicated loopback PostgreSQL, offline AI)', () => {
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

  it('publishes three choices, distinguishes branches, approves reuse, and records the shared ending', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      const f = await activationFixture(db);
      const visual = (sceneKey: string) => ({
        sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      });
      await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date() } });
      await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: visual('source') } });
      const branchScene = await db.storyScene.create({ data: {
        partId: f.part.id, sceneKey: 'branch-main', position: 2,
        title: { ko: '시계탑의 기록' }, status: 'published', visualManifest: visual('branch-main'),
      } });
      await db.storyBeat.create({ data: {
        sceneId: branchScene.id, position: 1, beatType: 'paragraph',
        content: { ko: '오후 아홉 시 십 분, 해원은 시계탑의 봉인된 기록을 펼쳤다.' },
      } });
      await db.storyChoice.update({ where: { id: f.choice.id }, data: { position: 2 } });
      const authoredRoute = await db.storyChoice.create({ data: {
        sceneId: f.scene.id, choiceKey: 'author-route', position: 1,
        label: { ko: '작가의 기록을 따라 시계탑으로 간다' },
        routeKind: 'writer_original', targetSceneId: branchScene.id,
      } });
      await db.storyChoice.create({ data: {
        sceneId: f.scene.id, choiceKey: 'third-route', position: 3,
        label: { ko: '다른 길에서 기록을 찾는다' }, routeKind: 'generation_required',
      } });
      await db.storyChoice.create({ data: {
        sceneId: branchScene.id, choiceKey: 'author-ending', position: 1,
        label: { ko: '원고의 결말대로 기록을 보존한다' },
        routeKind: 'writer_original', targetEndingKey: 'author_main',
      } });
      const branchA = await db.storyChoice.create({ data: {
        sceneId: branchScene.id, choiceKey: 'branch-a', position: 2,
        label: { ko: '봉인된 기록을 숨긴다' }, routeKind: 'generation_required',
      } });
      const branchB = await db.storyChoice.create({ data: {
        sceneId: branchScene.id, choiceKey: 'branch-b', position: 3,
        label: { ko: '봉인된 기록을 공개한다' }, routeKind: 'generation_required',
      } });
      const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: { workId: f.work.id } });
      const style = await db.storyMemoryRecord.create({ data: {
        workId: f.work.id, analysisJobId: analysis.id, manuscriptVersionId: f.manuscript.id,
        memoryType: 'style', memoryKey: 'author-voice',
        content: { ko: '짧고 절제된 문장으로 해원의 관찰을 쓴다.' },
      } });
      const time = await db.storyMemoryRecord.create({ data: {
        workId: f.work.id, analysisJobId: analysis.id, manuscriptVersionId: f.manuscript.id,
        memoryType: 'event', memoryKey: 'tower-clock',
        content: { ko: '시계탑의 기록은 오후 아홉 시 십 분에 열린다.' },
      } });
      const contexts: StoryContinuationApprovedContext[] = [];
      const preflight = jest.fn(async (request: { approvedContext: StoryContinuationApprovedContext }) => {
        contexts.push(request.approvedContext);
        return { supported: true, inputTokenUpperBound: 100 };
      });
      Object.assign(f.provider, { preflight });
      const production = new StoryProductionService(db as never, f.economics, f.provider as never,
        new PersistedStoryContinuationLegalActivationGate(f.activation));
      const thirdReader = await db.user.create({ data: {} });
      const readers = [f.reader, f.second, thirdReader];
      const atBranch: Array<{
        progressId: string; revision: number; status: string;
        scene: { id: string } | null;
        choices: Array<{ label: { value: string }; routeKind: string }>;
      }> = [];
      for (const reader of readers) {
        const start = await production.startProgress(reader.id, f.work.id, { mode: 'continue', locale: 'ko' });
        expect(start.scene?.id).toBe(f.scene.id);
        expect(start.choices).toHaveLength(3);
        const next = await production.selectChoice(reader.id, start.progressId,
          authoredRoute.id, start.revision, 'ko') as typeof atBranch[number];
        expect(next).toMatchObject({ scene: { id: branchScene.id }, status: 'active' });
        expect(next.choices.map((choice) => choice.label.value)).toEqual([
          '원고의 결말대로 기록을 보존한다',
          '봉인된 기록을 숨긴다',
          '봉인된 기록을 공개한다',
        ]);
        expect(next.choices.map((choice) => choice.routeKind))
          .toEqual(['writer_original', 'generation_required', 'generation_required']);
        atBranch.push(next);
      }

      async function settle(readerIndex: number, choiceId: string, endingKey: string, prose: string) {
        const receipt = await production.selectChoice(readers[readerIndex].id,
          atBranch[readerIndex].progressId, choiceId, atBranch[readerIndex].revision,
          'ko', randomUUID()) as { continuationId: string; status: string };
        expect(receipt).toMatchObject({ status: 'queued' });
        const leaseToken = randomUUID();
        await db.storyAiContinuation.update({ where: { id: receipt.continuationId }, data: {
          status: 'processing', leaseToken, leaseOwner: 'offline-journey-test',
          leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
        } });
        await f.economics.settleContinuation(null, receipt.continuationId, {
          status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
          inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
          resultTitle: { ko: endingKey },
          resultBeats: [{ beatType: 'paragraph', content: { ko: prose } }],
          resultVisualManifest: {
            sceneKey: `ai-${receipt.continuationId}`,
            background: { state: 'fallback', altKey: 'story.visual.fallback' },
            characters: [],
            fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
          },
          nextChoices: [], ending: { endingKey },
        }, `settle-${receipt.continuationId}`, leaseToken);
        return db.storyAiContinuation.findUniqueOrThrow({ where: { id: receipt.continuationId } });
      }

      const hidden = await settle(0, branchA.id, 'ai-hidden-record', '해원은 기록을 숨기고 문을 잠갔다.');
      const disclosed = await settle(2, branchB.id, 'ai-public-record', '해원은 기록을 공개하고 종을 울렸다.');
      expect(hidden.siblingContextKey).toBe(disclosed.siblingContextKey);
      expect(hidden.siblingChoiceKey).not.toBe(disclosed.siblingChoiceKey);
      expect(hidden.resultGeneratedSceneId).not.toBe(disclosed.resultGeneratedSceneId);
      const beats = await db.storyAiGeneratedBeat.findMany({
        where: { sceneId: { in: [hidden.resultGeneratedSceneId!, disclosed.resultGeneratedSceneId!] } },
      });
      expect(beats.map((beat) => (beat.content as { ko: string }).ko).sort()).toEqual([
        '해원은 기록을 공개하고 종을 울렸다.', '해원은 기록을 숨기고 문을 잠갔다.',
      ].sort());
      expect(contexts).toHaveLength(2);
      expect(contexts.map((context) => context.selectedChoice.label)).toEqual([
        '봉인된 기록을 숨긴다', '봉인된 기록을 공개한다',
      ]);
      for (const context of contexts) {
        expect(context.memories).toEqual(expect.arrayContaining([
          { memoryType: 'style', content: '짧고 절제된 문장으로 해원의 관찰을 쓴다.' },
          { memoryType: 'author_plan_event', content: '시계탑의 기록은 오후 아홉 시 십 분에 열린다.' },
        ]));
        expect(context.path).toEqual(expect.arrayContaining([
          expect.objectContaining({ choiceLabel: '작가의 기록을 따라 시계탑으로 간다', targetTitle: '시계탑의 기록' }),
        ]));
        expect(context.routeContinuity?.actions).toEqual(expect.arrayContaining([
          expect.objectContaining({ choiceLabel: '작가의 기록을 따라 시계탑으로 간다' }),
        ]));
        expect(context.sourceScene.beats[0].content).toContain('오후 아홉 시 십 분');
      }
      const memoryPins = (hidden.contextReferences as { memoryPins: Array<{ id: string }> }).memoryPins;
      expect(memoryPins.map((pin) => pin.id)).toEqual(expect.arrayContaining([style.id, time.id]));

      const shared = await db.storyAiReusableResult.findUniqueOrThrow({ where: { id: hidden.sharedResultId! } });
      expect(shared.status).toBe('pending');
      await expect(production.selectChoice(f.second.id, atBranch[1].progressId,
        branchA.id, atBranch[1].revision, 'ko', randomUUID()))
        .rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING' } });
      await f.approve(shared);
      const callsBeforeReuse = preflight.mock.calls.length;
      f.provider.readiness.mockResolvedValue({ enabled: false });
      const reused = await production.selectChoice(f.second.id, atBranch[1].progressId,
        branchA.id, atBranch[1].revision, 'ko', randomUUID()) as {
          continuationId: string; status: string; provenance: string;
        };
      expect(reused).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
      expect(preflight).toHaveBeenCalledTimes(callsBeforeReuse);
      expect(f.provider.generate).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
      const reusedContinuation = await db.storyAiContinuation.findUniqueOrThrow({
        where: { id: reused.continuationId },
      });
      expect(reusedContinuation.sharedResultId).toBe(shared.id);
      expect(reusedContinuation.resultGeneratedSceneId).not.toBe(hidden.resultGeneratedSceneId);
      const reusedScene = await db.storyAiGeneratedScene.findUniqueOrThrow({
        where: { id: reusedContinuation.resultGeneratedSceneId! },
      });
      expect(reusedScene).toMatchObject({ userId: f.second.id, provenance: 'ai_reused', sharedResultId: shared.id });
      expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: atBranch[1].progressId } }))
        .toMatchObject({ status: 'completed', visitedEndingKeys: ['ai-hidden-record'] });
      expect(await db.storyEndingDiscovery.count({ where: {
        userId: f.second.id, workId: f.work.id, releaseId: f.release.id,
        endingKey: 'ai-hidden-record', endingKind: 'ai_generated',
      } })).toBe(1);
      const ledger = await db.storyAiUsageLedger.findFirstOrThrow({
        where: { continuationId: reusedContinuation.id },
      });
      expect(ledger).toMatchObject({ inputTokens: 0, outputTokens: 0, allowanceDelta: 0 });
      expect(ledger.actualCostKrw?.isZero()).toBe(true);
    } finally {
      network.mockRestore();
    }
  }, 60_000);
});

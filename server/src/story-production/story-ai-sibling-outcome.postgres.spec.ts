import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryEconomicsService } from './story-economics.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';

const describePostgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('sibling narrative claims in isolated PostgreSQL transactions', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(() => { process.env.STORY_AI_REGION = 'KR'; db = postgresClient(); });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  async function processing(id: string) {
    const leaseToken = randomUUID();
    await db.storyAiContinuation.update({ where: { id }, data: {
      status: 'processing', leaseToken, leaseOwner: 'sibling-test',
      leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
    } });
    return leaseToken;
  }

  function result(id: string) {
    return {
      status: 'completed' as const, moderationDecision: 'allow' as const, actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '같은 장면' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: '같은 사건이 일어났다.' } }],
      resultVisualManifest: {
        sceneKey: `ai-${id}`, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: '계속' } }],
    };
  }

  it('allows one of two concurrent choices with identical bodies despite different titles', async () => {
    const f = await activationFixture(db, true, false);
    const secondChoice = await db.storyChoice.create({ data: {
      sceneId: f.scene.id, choiceKey: 'branch-c', position: 2,
      label: { ko: 'Choose the other path' }, routeKind: 'generation_required',
    } });
    const first = await f.request(0);
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[1].id } });
    const second = await db.$transaction((tx) => f.economics.requestRecommendedChoiceTx(tx, {
      userId: progress.userId, progress, work: f.work, part: f.part, scene: f.scene,
      release: f.release, choice: secondChoice, sourceKind: 'canonical', locale: 'ko',
      idempotencyKey: randomUUID(),
    }));
    const [a, b] = await Promise.all([first, second].map((item) =>
      db.storyAiContinuation.findUniqueOrThrow({ where: { id: item.continuationId } })));
    expect(a.siblingContextKey).toBe(b.siblingContextKey);
    expect(a.siblingChoiceKey).not.toBe(b.siblingChoiceKey);
    const [leaseA, leaseB] = await Promise.all([processing(a.id), processing(b.id)]);
    const secondResult = { ...result(b.id), resultTitle: { ko: '다르게 붙인 제목' } };
    const outcomes = await Promise.allSettled([
      f.economics.settleContinuation(null, a.id, result(a.id), randomUUID(), leaseA),
      f.economics.settleContinuation(null, b.id, secondResult, randomUUID(), leaseB),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'continuation_sibling_narrative_duplicate' } });
    expect(await db.storyAiSiblingNarrativeClaim.count({ where: { siblingContextKey: a.siblingContextKey! } })).toBe(1);
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: { in: [a.id, b.id] } } })).toBe(1);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('allows the same choice to be reused by another reader without a second paid call', async () => {
    const f = await activationFixture(db);
    const shared = await f.generate();
    await f.approve(shared);
    const originScene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: shared.originGeneratedSceneId! } });
    const original = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: originScene.continuationId } });
    const reused = await f.request(1);
    const copied = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: reused.continuationId } });
    expect(copied.status).toBe('completed');
    expect(copied.sharedResultId).toBe(shared.id);
    expect(copied.siblingContextKey).toBe(original.siblingContextKey);
    expect(copied.siblingChoiceKey).toBe(original.siblingChoiceKey);
    expect(await db.storyAiSiblingNarrativeClaim.count({ where: { siblingContextKey: original.siblingContextKey! } })).toBe(1);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('does not conflate two readers with different pinned participants', async () => {
    const f = await activationFixture(db, true, false);
    const secondChoice = await db.storyChoice.create({ data: {
      sceneId: f.scene.id, choiceKey: 'branch-c', position: 2,
      label: { ko: 'Choose the other path' }, routeKind: 'generation_required',
    } });
    const participants = { pinnedContext: jest.fn(async (_tx, progressId: string) => {
      const artistId = progressId === f.progresses[0].id ? 'artist-a' : 'artist-b';
      return {
        pin: { id: progressId, artistId, participantFingerprint: artistId,
          identityProfileId: null, identityProfileVersion: null, identityReviewRevision: null,
          identitySourceFingerprint: null, identityApprovedFingerprint: null,
          referenceAssetIds: [], referenceChecksums: [] },
        approved: { artistId, slug: artistId, displayName: artistId, visualIdentityReady: false },
      };
    }) };
    const economics = new StoryEconomicsService(db as never,
      new PersistedStoryContinuationLegalActivationGate(f.activation),
      f.provider as never, f.approval, participants as never);
    const request = async (index: number, choice: typeof f.choice) => {
      const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[index].id } });
      return db.$transaction((tx) => economics.requestRecommendedChoiceTx(tx, {
        userId: progress.userId, progress, work: f.work, part: f.part, scene: f.scene,
        release: f.release, choice, sourceKind: 'canonical', locale: 'ko', idempotencyKey: randomUUID(),
      }));
    };
    const [first, second] = await Promise.all([request(0, f.choice), request(1, secondChoice)]);
    const [a, b] = await Promise.all([first, second].map((item) =>
      db.storyAiContinuation.findUniqueOrThrow({ where: { id: item.continuationId } })));
    expect(a.siblingContextKey).not.toBe(b.siblingContextKey);
    const [leaseA, leaseB] = await Promise.all([processing(a.id), processing(b.id)]);
    await expect(Promise.all([
      economics.settleContinuation(null, a.id, result(a.id), randomUUID(), leaseA),
      economics.settleContinuation(null, b.id, result(b.id), randomUUID(), leaseB),
    ])).resolves.toHaveLength(2);
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: { in: [a.id, b.id] } } })).toBe(2);
    expect(f.provider.generate).not.toHaveBeenCalled();
  });
});

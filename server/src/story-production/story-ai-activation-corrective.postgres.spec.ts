import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryProductionController } from './story-production.controller';
import { StoryProductionService } from './story-production.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';

const describePostgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;
describePostgres('independent QA #1895 corrective public choose and ancestor withdrawal', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(() => { process.env.STORY_AI_REGION = 'KR'; db = postgresClient(); });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  it.each([false, true])('real public controller choose reaches private generation/shared hit (shared=%s)', async (shared) => {
    const f = await activationFixture(db, true, shared);
    await db.storyPart.update({ where: { id: f.part.id }, data: { status: 'published' } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'published' } });
    if (shared) { const result = await f.generate(); await f.approve(result); }
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[shared ? 1 : 0].id } });
    const legal = new PersistedStoryContinuationLegalActivationGate(f.activation);
    const authorize = jest.spyOn(legal, 'authorize');
    const production = new StoryProductionService(db as never, f.economics, f.provider as never, legal);
    const controller = new StoryProductionController(production, undefined as never);
    const providerCalls = f.provider.readiness.mock.calls.length;
    const receipt = await controller.choose({ id: progress.userId } as never, progress.id, f.choice.id,
      { expectedRevision: progress.progressRevision }, { locale: 'KO' } as never, randomUUID());
    expect(receipt).toMatchObject({ status: shared ? 'completed' : 'queued', provenance: shared ? 'ai_reused' : 'ai_generated' });
    expect(authorize).toHaveBeenCalledWith({ workId: f.work.id, releaseId: f.release.id,
      manuscriptVersionId: f.manuscript.id, rightsContractVersionId: f.rights.id, locale: 'ko' }, expect.anything());
    if (shared) {
      expect(f.provider.readiness).toHaveBeenCalledTimes(providerCalls);
      expect(await db.storyAiAllowanceBucket.count({ where: { userId: progress.userId } })).toBe(0);
    }
  });

  async function generateChild(f: Awaited<ReturnType<typeof activationFixture>>, parent: Awaited<ReturnType<typeof f.generate>>) {
    const progress = await db.storyReaderProgress.findUniqueOrThrow({ where: { id: f.progresses[0].id } });
    const scene = await db.storyAiGeneratedScene.findUniqueOrThrow({ where: { id: parent.originGeneratedSceneId! } });
    const choice = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: scene.id } });
    const requested = await db.$transaction((tx) => f.economics.requestRecommendedChoiceTx(tx, {
      userId: f.reader.id, progress, work: f.work, part: f.part, scene, release: f.release,
      choice, sourceKind: 'generated', locale: 'ko', idempotencyKey: randomUUID(),
    }));
    await db.storyAiContinuation.update({ where: { id: requested.continuationId }, data: {
      status: 'processing', leaseToken: 'corrective-test', leaseOwner: 'corrective-test',
      leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1,
    } });
    await f.economics.settleContinuation(null, requested.continuationId, {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0, inputTokens: 10, outputTokens: 10,
      cachedInputTokens: 0, imageUnits: 0, resultTitle: { ko: 'Synthetic child' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: 'Synthetic child output.' } }],
      resultVisualManifest: { sceneKey: `ai-${requested.continuationId}`,
        background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } },
      nextChoices: [{ choiceKey: 'next', label: { ko: 'Next' } }],
    }, randomUUID(), 'corrective-test');
    return db.storyAiReusableResult.findFirstOrThrow({ where: { sourceSharedResultId: parent.id } });
  }

  it.each(['direct-revoke', 'reject-evidence'])('revoked parent denies child authorization and permits %s', async (mode) => {
    const f = await activationFixture(db);
    await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'published' } });
    const parent = await f.generate(); await f.approve(parent);
    const child = await generateChild(f, parent); await f.approve(child);
    const context = { ...f.context, resultId: child.id, resultChecksum: child.resultChecksum! };
    expect(await f.activation.authorizeResult(context)).toBe(true);
    await f.activation.revokeResult(f.owner.id, parent.id, 'e'.repeat(64));
    expect(await f.activation.authorizeResult(context)).toBe(false);
    const [check] = await db.$queryRaw<{ valid: boolean }[]>`SELECT story_ai_shared_ancestry_valid(${child.id}::uuid) AS valid`;
    expect(check.valid).toBe(false);
    if (mode === 'direct-revoke') await f.activation.revokeResult(f.owner.id, child.id, 'e'.repeat(64));
    else {
      const prior = await db.storyAiResultEvidence.findFirstOrThrow({ where: { sharedResultId: child.id, kind: 'moderation' } });
      await f.addEvidence(child, 'moderation', { decision: 'reject', revision: 2, supersedesId: prior.id });
      expect(await db.storyAiResultEvidence.count({ where: { sharedResultId: child.id } })).toBe(3);
    }
    expect(await db.storyAiReusableResult.findUnique({ where: { id: child.id } })).toMatchObject({ status: 'revoked' });
  });

  it('authorizes a 216-result lineage and denies its leaf after root withdrawal', async () => {
    const f = await activationFixture(db);
    await db.storyReleaseCapability.update({ where: { releaseId: f.release.id }, data: { includedAiRouteCount: 216 } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'published' } });
    const root = await f.generate(); await f.approve(root);
    let leaf = root;
    for (let depth = 2; depth <= 216; depth++) {
      leaf = await generateChild(f, leaf);
      await f.approve(leaf);
    }
    const context = { ...f.context, resultId: leaf.id, resultChecksum: leaf.resultChecksum! };
    expect(await f.activation.authorizeResult(context)).toBe(true);
    const [before] = await db.$queryRaw<{ valid: boolean }[]>`SELECT story_ai_shared_ancestry_valid(${leaf.id}::uuid) AS valid`;
    expect(before.valid).toBe(true);
    await f.activation.revokeResult(f.owner.id, root.id, 'e'.repeat(64));
    expect(await f.activation.authorizeResult(context)).toBe(false);
    const [after] = await db.$queryRaw<{ valid: boolean }[]>`SELECT story_ai_shared_ancestry_valid(${leaf.id}::uuid) AS valid`;
    expect(after.valid).toBe(false);
    await f.activation.revokeResult(f.owner.id, leaf.id, 'e'.repeat(64));
    expect(await db.storyAiReusableResult.findUnique({ where: { id: leaf.id } })).toMatchObject({ status: 'revoked' });
  }, 180000);
});

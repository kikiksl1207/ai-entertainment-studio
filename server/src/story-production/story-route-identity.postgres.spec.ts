import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { StoryProductionService } from './story-production.service';
import { StoryProgressControlService } from './story-progress-control.service';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import { appendStoryRoute, storyRouteSharingHash, storyRouteSnapshot } from './story-route-identity.store';

const describePostgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof activationFixture>>;
const visual = (sceneKey: string) => ({ sceneKey, background: { state: 'fallback', altKey: 'story.visual.fallback' },
  characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } });

describePostgres('complete route identity through real PostgreSQL service transactions', () => {
  let db: PrismaClient;
  const region = process.env.STORY_AI_REGION;
  beforeAll(() => { process.env.STORY_AI_REGION = 'KR'; db = postgresClient(); });
  afterAll(async () => {
    if (region === undefined) delete process.env.STORY_AI_REGION; else process.env.STORY_AI_REGION = region;
    await db?.$disconnect();
  });

  async function fixture() {
    const f = await activationFixture(db);
    await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date(0) } });
    await db.storyPart.update({ where: { id: f.part.id }, data: { status: 'published' } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { status: 'published', visualManifest: visual(f.scene.sceneKey) } });
    const production = new StoryProductionService(db as never, f.economics, f.provider as never,
      new PersistedStoryContinuationLegalActivationGate(f.activation));
    const controls = new StoryProgressControlService(db as never, undefined as never, f.economics);
    return { ...f, production, controls };
  }

  const progress = (id: string) => db.storyReaderProgress.findUniqueOrThrow({ where: { id } });
  async function choose(f: Awaited<ReturnType<typeof fixture>>, id: string, choiceId: string, key = randomUUID()) {
    const p = await progress(id);
    return f.production.selectChoice(p.userId, p.id, choiceId, p.progressRevision, 'ko', key);
  }
  async function scene(partId: string, position: number) {
    const row = await db.storyScene.create({ data: {
      partId, position, sceneKey: `route-${position}`, title: { ko: 'Same title' }, status: 'published',
      visualManifest: visual(`route-${position}`),
    } });
    await db.storyBeat.create({ data: { sceneId: row.id, position: 1, beatType: 'paragraph', content: { ko: 'Synthetic source.' } } });
    return row;
  }
  async function branch(sceneId: string, targetSceneId: string, position = 1) {
    return db.storyChoice.create({ data: { sceneId, targetSceneId, position, choiceKey: `route-${position}`,
      routeKind: 'branch', label: { ko: 'Same label' } } });
  }
  async function settle(f: Fixture, id: string) {
    await db.storyAiContinuation.update({ where: { id }, data: { status: 'processing', leaseToken: 'route-test',
      leaseOwner: 'route-test', leaseExpiresAt: new Date(Date.now() + 60000), attemptCount: 1 } });
    await f.economics.settleContinuation(null, id, {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0, inputTokens: 10, outputTokens: 10,
      cachedInputTokens: 0, imageUnits: 0, resultTitle: { ko: 'Synthetic result' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: 'Synthetic output.' } }],
      resultVisualManifest: { sceneKey: `ai-${id}`, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } },
      nextChoices: [{ choiceKey: 'next', label: { ko: 'Next' } }],
    }, randomUUID(), 'route-test');
    return db.storyAiContinuation.findUniqueOrThrow({ where: { id } });
  }

  it('keeps an early same-label choice divergence after 25 identical choices; only the exact third reader gets a hit', async () => {
    const f = await fixture();
    const tail = [];
    for (let i = 0; i < 26; i++) tail.push(await scene(f.part.id, i + 2));
    const first = await db.storyChoice.update({ where: { id: f.choice.id }, data: {
      routeKind: 'branch', targetSceneId: tail[0].id, label: { ko: 'Same label' },
    } });
    const alternate = await branch(f.scene.id, tail[0].id, 2);
    const suffix = [];
    for (let i = 0; i < 25; i++) suffix.push(await branch(tail[i].id, tail[i + 1].id));
    const generate = await db.storyChoice.create({ data: { sceneId: tail[25].id, position: 1,
      choiceKey: 'generate', routeKind: 'generation_required', label: { ko: 'Continue' } } });
    const thirdUser = await db.user.create({ data: {} });
    await f.production.startProgress(thirdUser.id, f.work.id, { mode: 'continue', locale: 'ko' });
    const third = await db.storyReaderProgress.findUniqueOrThrow({ where: { userId_workId: { userId: thirdUser.id, workId: f.work.id } } });
    for (const [p, initial] of [[f.progresses[0], first], [f.progresses[1], alternate], [third, first]] as const) {
      await choose(f, p.id, initial.id);
      for (const choice of suffix) await choose(f, p.id, choice.id);
    }
    const [a, b, c] = await Promise.all([progress(f.progresses[0].id), progress(f.progresses[1].id), progress(third.id)]);
    expect(a.pathSummary).toEqual(b.pathSummary);
    expect((a.pathSummary as unknown[]).length).toBe(24);
    const [ra, rb, rc] = await Promise.all([storyRouteSnapshot(db, a), storyRouteSnapshot(db, b), storyRouteSnapshot(db, c)]);
    expect(ra.hash).not.toBe(rb.hash); expect(ra.hash).toBe(rc.hash); expect(ra.nodeId).not.toBe(rc.nodeId);
    const queued = await choose(f, a.id, generate.id) as { continuationId: string };
    const completed = await settle(f, queued.continuationId);
    const result = await db.storyAiReusableResult.findUniqueOrThrow({ where: { id: completed.sharedResultId! } });
    await f.approve(result);
    const calls = f.provider.readiness.mock.calls.length;
    const key = randomUUID();
    const hit = await choose(f, c.id, generate.id, key) as { continuationId: string; provenance: string };
    expect(hit.provenance).toBe('ai_reused');
    expect(f.provider.readiness).toHaveBeenCalledTimes(calls);
    expect(await db.storyAiAllowanceBucket.count({ where: { userId: thirdUser.id } })).toBe(0);
    const afterHit = await progress(c.id);
    expect((await storyRouteSnapshot(db, afterHit)).hash).toBe((await storyRouteSnapshot(db, await progress(a.id))).hash);
    const nodes = await db.storyProgressRouteNode.count({ where: { progressId: c.id } });
    await f.production.selectChoice(c.userId, c.id, generate.id, c.progressRevision, 'ko', key);
    expect(await db.storyProgressRouteNode.count({ where: { progressId: c.id } })).toBe(nodes);
    const different = await choose(f, b.id, generate.id) as { continuationId: string; provenance: string };
    expect(different.provenance).toBe('ai_generated');
    const pending = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: different.continuationId } });
    expect(pending.reuseKey).not.toBe(completed.reuseKey);
  }, 120000);

  it.each([false, true])('preserves checkpoints/resume and act prefixes, then full resets (new release=%s)', async (changeRelease) => {
    const f = await fixture();
    const part2 = await db.storyPart.create({ data: { workId: f.work.id, position: 2, actNumber: 2, title: {}, status: 'published' } });
    const entry = await scene(part2.id, 1); const later = await scene(part2.id, 2);
    await db.storyChoice.update({ where: { id: f.choice.id }, data: { routeKind: 'branch', targetSceneId: entry.id } });
    const next = await branch(entry.id, later.id);
    const choices = [next];
    let previous = later;
    for (let i = 3; i <= 28; i++) {
      const target = await scene(part2.id, i);
      choices.push(await branch(previous.id, target.id));
      previous = target;
    }
    const p = f.progresses[0]; const root = await storyRouteSnapshot(db, p);
    await choose(f, p.id, f.choice.id);
    const atEntry = await progress(p.id);
    await f.controls.confirmCheckpoint(p.userId, p.id, { expectedRevision: atEntry.progressRevision, sceneId: entry.id, beatPosition: 1, locale: 'ko' });
    const checkpoint = await db.storyProgressCheckpoint.findFirstOrThrow({ where: { progressId: p.id } });
    expect(checkpoint.routeNodeId).toBe(atEntry.routeNodeId);
    await f.production.startProgress(p.userId, f.work.id, { mode: 'continue', locale: 'ko' });
    expect((await progress(p.id)).routeNodeId).toBe(atEntry.routeNodeId);
    for (const choice of choices) await choose(f, p.id, choice.id);
    const beforeReset = await progress(p.id); const resetKey = randomUUID();
    expect(beforeReset.pathSummary).not.toContainEqual((atEntry.pathSummary as unknown[])[0]);
    const command = { target: 'act' as const, actNumber: 2, expectedRevision: beforeReset.progressRevision, locale: 'ko' };
    await f.controls.executeReset(p.userId, p.id, command, resetKey);
    expect((await progress(p.id)).routeNodeId).toBe(atEntry.routeNodeId);
    expect((await progress(p.id)).pathSummary).toEqual(atEntry.pathSummary);
    const count = await db.storyProgressRouteNode.count({ where: { progressId: p.id } });
    await f.controls.executeReset(p.userId, p.id, command, resetKey);
    expect(await db.storyProgressRouteNode.count({ where: { progressId: p.id } })).toBe(count);
    for (const choice of choices) await choose(f, p.id, choice.id);
    expect((await storyRouteSnapshot(db, await progress(p.id))).hash).toBe((await storyRouteSnapshot(db, beforeReset)).hash);
    const beforeFull = await progress(p.id);
    if (changeRelease) {
      const release = await db.storyRelease.create({ data: { workId: f.work.id, version: 2, status: 'active',
        manuscriptVersionId: f.manuscript.id, checksum: 'new-release-checksum', branchGraphSnapshot: {},
        endingSetSnapshot: {}, sceneAssetManifest: {}, localizedDisplaySnapshot: {}, createdByUserId: f.owner.id } });
      await db.storyReleaseCapability.create({ data: { workId: f.work.id, releaseId: release.id, rateCardId: f.rate.id,
        status: 'active', updatedByUserId: f.owner.id } });
      await db.storyWork.update({ where: { id: f.work.id }, data: { activeReleaseId: release.id, publishedVersion: 2 } });
    }
    await f.controls.executeReset(p.userId, p.id, { target: 'full', expectedRevision: beforeFull.progressRevision, locale: 'ko' }, randomUUID());
    const reset = await storyRouteSnapshot(db, await progress(p.id));
    if (changeRelease) expect(reset.hash).not.toBe(root.hash); else expect(reset.hash).toBe(root.hash);
    expect(reset.nodeId).not.toBe(root.nodeId);
    expect(await db.storyProgressRouteNode.findUnique({ where: { id: beforeReset.routeNodeId! } })).not.toBeNull();
  }, 30000);

  it('keeps unknown legacy and unapproved generated paths personal without synthesizing shared evidence', async () => {
    const f = await fixture();
    await db.storyReaderProgress.update({ where: { id: f.progresses[0].id }, data: { routeNodeId: null } });
    const first = await f.generatePersonal();
    expect(first.sharedResultId).toBeNull();
    expect(await db.storyAiReusableResult.count({ where: { workId: f.work.id } })).toBe(0);
    expect(await db.storyAiResultEvidence.count({ where: { originGeneratedSceneId: first.resultGeneratedSceneId! } })).toBe(0);
    const choice = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: first.resultGeneratedSceneId! } });
    const second = await choose(f, f.progresses[0].id, choice.id) as { continuationId: string };
    const completed = await settle(f, second.continuationId);
    expect(completed.sharedResultId).toBeNull();
    expect((await progress(f.progresses[0].id)).routeNodeId).toBeNull();
  });

  it('pins full identity at enqueue and rejects a different early route before provider execution or settlement', async () => {
    const f = await fixture();
    const first = await f.request();
    const continuation = await db.storyAiContinuation.update({ where: { id: first.continuationId }, data: {
      status: 'processing', leaseToken: 'route-test', leaseOwner: 'route-test', leaseExpiresAt: new Date(Date.now() + 60000),
    } });
    const p = await progress(f.progresses[0].id);
    const changed = await appendStoryRoute(db, p, { kind: 'private' }, 1);
    await db.storyReaderProgress.update({ where: { id: p.id }, data: { routeNodeId: changed } });
    const assembler = new StoryContinuationContextAssembler(db as never);
    await expect(assembler.assemble({ continuationId: continuation.id, leaseToken: 'route-test', attemptCount: 1, maxAttempts: 3, request: {} as never }))
      .rejects.toThrow('pinned_route_changed');
    await expect(settle(f, continuation.id)).rejects.toThrow('Pending story progress changed concurrently');
    expect(await db.storyAiGeneratedScene.count({ where: { continuationId: continuation.id } })).toBe(0);
  });

  it('matches approved generated routes across personal scene IDs and rejects historical ancestor reuse after withdrawal', async () => {
    const f = await fixture();
    const root = await f.generate(); await f.approve(root); await f.request(1);
    const [a, b] = await Promise.all(f.progresses.map((p) => progress(p.id)));
    expect(a.currentGeneratedSceneId).not.toBe(b.currentGeneratedSceneId);
    const choiceA = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: a.currentGeneratedSceneId! } });
    const choiceB = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: b.currentGeneratedSceneId! } });
    expect(choiceA.id).not.toBe(choiceB.id); expect(choiceA.choiceKey).toBe(choiceB.choiceKey);
    const next = await choose(f, a.id, choiceA.id) as { continuationId: string };
    const completed = await settle(f, next.continuationId);
    const child = await db.storyAiReusableResult.findUniqueOrThrow({ where: { id: completed.sharedResultId! } });
    await f.approve(child);
    const hit = await choose(f, b.id, choiceB.id) as { provenance: string };
    expect(hit.provenance).toBe('ai_reused');
    const [afterA, afterB] = await Promise.all([progress(a.id), progress(b.id)]);
    expect((await storyRouteSnapshot(db, afterA)).hash).toBe((await storyRouteSnapshot(db, afterB)).hash);
    const node = await db.storyProgressRouteNode.findUniqueOrThrow({ where: { id: afterB.routeNodeId! } });
    expect(node).toMatchObject({ stepKind: 'shared', sourceSharedResultId: root.id, sourceSharedChoiceKey: choiceB.choiceKey });
    expect(node.sourceSharedChoiceKey).not.toBe(choiceB.id);
    expect(node.narrativeStep).toMatchObject({ choiceId: choiceB.id });
    expect(await storyRouteSharingHash(db, afterB)).not.toBeNull();
    await f.activation.revokeResult(f.owner.id, root.id, 'f'.repeat(64));
    expect(await storyRouteSharingHash(db, afterB)).toBeNull();
    const personalChoice = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: afterB.currentGeneratedSceneId! } });
    const personal = await choose(f, afterB.id, personalChoice.id) as { continuationId: string; provenance: string };
    expect(personal.provenance).toBe('ai_generated');
    expect(await db.storyAiContinuation.findUnique({ where: { id: personal.continuationId } })).toMatchObject({ sharedResultId: null });
  });

  it('turns a known route private when continuing an unapproved personal result', async () => {
    const f = await fixture();
    const root = await f.generate();
    const choice = await db.storyAiGeneratedChoice.findFirstOrThrow({ where: { sceneId: root.originGeneratedSceneId! } });
    const next = await choose(f, f.progresses[0].id, choice.id) as { continuationId: string };
    const completed = await settle(f, next.continuationId);
    expect(completed.sharedResultId).toBeNull();
    const p = await progress(f.progresses[0].id);
    expect(await storyRouteSnapshot(db, p)).toEqual({ nodeId: p.routeNodeId, hash: null });
    expect(await db.storyProgressRouteNode.findUnique({ where: { id: p.routeNodeId! } })).toMatchObject({ stepKind: 'private' });
  });

  it('rolls back the losing concurrent canonical choice node with its progress mutation', async () => {
    const f = await fixture(); const next = await scene(f.part.id, 2);
    await db.storyChoice.update({ where: { id: f.choice.id }, data: { routeKind: 'branch', targetSceneId: next.id } });
    const alternate = await branch(f.scene.id, next.id, 2);
    const p = f.progresses[0];
    const outcomes = await Promise.allSettled([f.choice.id, alternate.id].map((choiceId) =>
      f.production.selectChoice(p.userId, p.id, choiceId, p.progressRevision, 'ko', randomUUID())));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await db.storyProgressRouteNode.count({ where: { progressId: p.id } })).toBe(2);
    expect(await db.storyChoiceEvent.count({ where: { progressId: p.id } })).toBe(1);
    expect((await progress(p.id)).progressRevision).toBe(p.progressRevision + 1);
  });

  it('enforces private node ownership, append-only ancestry, and immutable exact continuation pins', async () => {
    const f = await fixture(); const [a, b] = f.progresses;
    await expect(db.storyReaderProgress.update({ where: { id: b.id }, data: { routeNodeId: a.routeNodeId } })).rejects.toThrow(/Foreign key/);
    await expect(db.storyProgressRouteNode.update({ where: { id: a.routeNodeId! }, data: { routeHash: 'f'.repeat(64) } }))
      .rejects.toThrow(/append-only/);
    await expect(db.storyProgressRouteNode.delete({ where: { id: a.routeNodeId! } })).rejects.toThrow(/append-only/);
    const first = await f.request();
    await expect(db.storyAiContinuation.update({ where: { id: first.continuationId }, data: { sourceRouteHash: 'f'.repeat(64) } }))
      .rejects.toThrow(/route pin is immutable/);
    const privateId = await appendStoryRoute(db, b, { kind: 'private' }, 1);
    await db.storyReaderProgress.update({ where: { id: b.id }, data: { routeNodeId: privateId } });
    expect(await storyRouteSharingHash(db, await progress(b.id))).toBeNull();
  });
});

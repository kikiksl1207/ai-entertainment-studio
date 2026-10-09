import { PrismaClient } from '@prisma/client';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { assertStoryContinuationQuality } from './story-continuation-quality.policy';
import { storyAiResultChecksum } from './story-ai-result-checksum';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import type { StoryContinuationProviderRequest, StoryContinuationProviderResult } from './story-continuation.provider';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof activationFixture>>;
const sourceSentences = [
  'Mira crossed the quiet courtyard and paused beside the sealed workshop.',
  'A caretaker placed a copper key on the bench while the shutters rattled.',
  'The ledger listed a blue crate that had arrived before the market opened.',
  'She folded the map and asked which wagon would take the crate inland.',
];
const sourceParagraph = sourceSentences.join(' ');
const copiedBeats = sourceSentences.map((sentence, index) =>
  (index === 0 ? 'A bell rang. ' : '') + sentence +
  (index === sourceSentences.length - 1 ? ' They turned back.' : ''));
const newBeats = [
  'Mira found a broken hinge behind the greenhouse and laid the loose screws on a dry shelf.',
  'The gardener fetched a repair kit while a neighbor moved young plants away from the dripping window.',
  'They fitted a new bracket, checked the latch twice, and carried the empty buckets back to the tool shed.',
];
const normalized = (text: string) => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

postgres('reviewed reusable quality boundary (owned PostgreSQL, synthetic history)', () => {
  let db: PrismaClient;
  let network: jest.SpyInstance;
  const originalRegion = process.env.STORY_AI_REGION;

  beforeAll(() => {
    const url = new URL(process.env.STORY_TEST_DATABASE_URL!);
    if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '55432' ||
        url.username !== 'lumina_qa' ||
        !(url.pathname === '/lumina_story_qa' || /^\/lumina_guidance_qa_20261007_[a-f0-9]{12}$/.test(url.pathname)) ||
        url.search || url.hash) {
      throw new Error('Dedicated loopback lumina_story_qa database required');
    }
    process.env.STORY_AI_REGION = 'KR';
    db = postgresClient();
  });

  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network prohibited'));
  });

  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
  });

  afterAll(async () => {
    if (originalRegion === undefined) delete process.env.STORY_AI_REGION;
    else process.env.STORY_AI_REGION = originalRegion;
    await db?.$disconnect();
  });

  async function historicalReviewedBody(texts: string[]) {
    const f = await activationFixture(db);
    const source = await db.storyBeat.findFirstOrThrow({ where: { sceneId: f.scene.id } });
    await db.storyBeat.update({ where: { id: source.id }, data: { content: { ko: sourceParagraph } } });
    const contexts: StoryContinuationApprovedContext[] = [];
    // Synthetic admission uses the fixture's full input ceiling, not model tokenization.
    const provider = Object.assign(f.provider, { preflight: jest.fn(async (request: StoryContinuationProviderRequest) => {
      expect(request.inputTokenLimit).toBe(1000);
      expect(request.outputTokenLimit).toBe(300);
      expect(request.approvedContext).toBeDefined();
      contexts.push(request.approvedContext!);
      return { supported: true, inputTokenUpperBound: 1000 };
    }) });
    expect(await f.activation.prepare(f.context)).toMatchObject({ id: f.active!.id });
    expect(await f.approval.prepare(f.context)).toMatchObject({ eligible: true,
      snapshot: { rightsActivationKey: f.active!.id } });
    const first = await f.request();
    const pending = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: first.continuationId } });
    expect(pending).toMatchObject({ inputTokenLimit: 1000, outputTokenLimit: 300, locale: 'ko' });
    expect(pending.sharedResultId).not.toBeNull();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].sourceScene.beats).toEqual([{ beatType: 'paragraph', content: sourceParagraph }]);
    const leaseToken = `synthetic-history-${pending.id}`;
    await db.storyAiContinuation.update({ where: { id: pending.id }, data: {
      status: 'processing', leaseToken, leaseOwner: 'synthetic-history',
      leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
    } });
    const body: StoryContinuationProviderResult = {
      title: { ko: 'Synthetic reviewed continuation' },
      beats: texts.map(text => ({ beatType: 'paragraph' as const, content: { ko: text } })),
      visualManifest: { sceneKey: `ai-${pending.id}`, background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' } },
      nextChoices: [{ choiceKey: 'next', label: { ko: 'Continue the synthetic route' } }],
      usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0 },
    };
    // Model an existing historical result; do not claim it passed the current executor.
    await expect(f.economics.settleContinuation(null, pending.id, {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0, ...body.usage,
      resultTitle: body.title, resultBeats: body.beats, resultVisualManifest: body.visualManifest,
      nextChoices: body.nextChoices,
    }, `synthetic-history-settle-${pending.id}`, leaseToken)).resolves.toMatchObject({ status: 'completed' });
    const shared = await db.storyAiReusableResult.findUniqueOrThrow({ where: { id: pending.sharedResultId! } });
    expect(shared).toMatchObject({ status: 'pending', resultChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    // These are explicit synthetic review records, never claims of real human approval.
    await f.addEvidence(shared, 'moderation');
    await f.addEvidence(shared, 'quality');
    await f.activation.promote(f.owner.id, shared.id, shared.resultChecksum!);
    expect(await f.approval.authorizeResult({ ...f.context, resultId: shared.id,
      resultChecksum: shared.resultChecksum! })).toBe(true);
    return { f, provider, context: contexts[0], sharedId: shared.id, originId: shared.originGeneratedSceneId!, usage: body.usage };
  }

  async function snapshot(f: Fixture, sharedId: string, originId: string) {
    const where = { workId: f.work.id };
    const orderBy = { id: 'asc' as const };
    const [continuations, scenes, progress, routes, usage, allowances, approvals, canonical, shared, evidence, capability, rate] =
      await Promise.all([
        db.storyAiContinuation.findMany({ where, orderBy }), db.storyAiGeneratedScene.findMany({ where, orderBy }),
        db.storyReaderProgress.findMany({ where, orderBy }), db.storyProgressRouteNode.findMany({ where, orderBy }),
        db.storyAiUsageLedger.findMany({ where, orderBy }), db.storyAiAllowanceBucket.findMany({ where, orderBy }),
        db.storyAuthorBodyTrialApproval.findMany({ where, orderBy }),
        db.storyBeat.findMany({ where: { sceneId: f.scene.id }, orderBy: { position: 'asc' } }),
        db.storyAiReusableResult.findUniqueOrThrow({ where: { id: sharedId } }),
        db.storyAiResultEvidence.findMany({ where: { sharedResultId: sharedId }, orderBy }),
        db.storyReleaseCapability.findMany({ where, orderBy }), db.storyAiRateCard.findUniqueOrThrow({ where: { id: f.rate.id } }),
      ]);
    const sceneIds = scenes.map(scene => scene.id);
    const siblingKeys = continuations.flatMap(row => row.siblingContextKey ? [row.siblingContextKey] : []);
    const [beats, choices, sharedBeats, sharedChoices, claims] = await Promise.all([
      db.storyAiGeneratedBeat.findMany({ where: { sceneId: { in: sceneIds } }, orderBy }),
      db.storyAiGeneratedChoice.findMany({ where: { sceneId: { in: sceneIds } }, orderBy }),
      db.storyAiReusableBeat.findMany({ where: { sharedResultId: sharedId }, orderBy: { position: 'asc' } }),
      db.storyAiReusableChoice.findMany({ where: { sharedResultId: sharedId }, orderBy: { position: 'asc' } }),
      db.storyAiSiblingNarrativeClaim.findMany({ where: { siblingContextKey: { in: siblingKeys } },
        orderBy: [{ siblingContextKey: 'asc' }, { narrativeChecksum: 'asc' }] }),
    ]);
    const origin = scenes.find(scene => scene.id === originId)!;
    const originBeats = beats.filter(beat => beat.sceneId === originId).sort((a, b) => a.position - b.position);
    const originChoices = choices.filter(choice => choice.sceneId === originId).sort((a, b) => a.position - b.position);
    return { counts: { continuations: continuations.length, scenes: scenes.length, beats: beats.length, choices: choices.length,
      routes: routes.length, usage: usage.length, claims: claims.length, allowances: allowances.length, approvals: approvals.length },
      continuations, scenes, beats, choices, progress, routes, usage, allowances, approvals, claims,
      immutable: { canonical, shared, sharedBeats, sharedChoices, evidence, origin, originBeats, originChoices, capability, rate } };
  }

  function reviewedResult(state: Awaited<ReturnType<typeof snapshot>>, usage: StoryContinuationProviderResult['usage']) {
    const { shared, sharedBeats, sharedChoices } = state.immutable;
    return { title: shared.title as Record<string, string>,
      beats: sharedBeats.map(beat => ({ beatType: beat.beatType as StoryContinuationProviderResult['beats'][number]['beatType'],
        content: beat.content as Record<string, string> })),
      visualManifest: shared.visualManifest as Record<string, unknown>,
      nextChoices: sharedChoices.map(choice => ({ choiceKey: choice.choiceKey, label: choice.label as Record<string, string> })),
      usage };
  }

  function assertExactReviewedBytes(state: Awaited<ReturnType<typeof snapshot>>) {
    const value = state.immutable;
    const checksum = storyAiResultChecksum({ title: value.shared.title, beats: value.sharedBeats,
      visualManifest: value.shared.visualManifest, nextChoices: value.sharedChoices, ending: null });
    expect(checksum).toBe(value.shared.resultChecksum);
    expect(checksum).toBe(value.origin.resultChecksum);
    expect(value.sharedBeats.map(({ position, beatType, content }) => ({ position, beatType, content })))
      .toEqual(value.originBeats.map(({ position, beatType, content }) => ({ position, beatType, content })));
    expect(value.sharedChoices.map(({ position, choiceKey, label }) => ({ position, choiceKey, label })))
      .toEqual(value.originChoices.map(({ position, choiceKey, label }) => ({ position, choiceKey, label })));
  }

  function siblingClaimSpy(f: Fixture) {
    return jest.spyOn(f.economics as unknown as { claimSiblingNarrative: (...args: unknown[]) => Promise<void> },
      'claimSiblingNarrative');
  }

  it('reviewed reuse cannot bypass the current full-source copy guard', async () => {
    expect(Array.from(normalized(sourceParagraph)).length).toBeGreaterThanOrEqual(240);
    for (const text of copiedBeats) {
      expect(Array.from(normalized(text)).length).toBeLessThan(240);
      expect(text).toMatch(/\.$/u);
    }
    expect(normalized(copiedBeats.join(' '))).toContain(normalized(sourceParagraph));
    const h = await historicalReviewedBody(copiedBeats);
    const before = await snapshot(h.f, h.sharedId, h.originId);
    assertExactReviewedBytes(before);
    expect(() => assertStoryContinuationQuality(reviewedResult(before, h.usage), h.context, 'ko'))
      .toThrow('continuation_source_prose_repeated');
    const claim = siblingClaimSpy(h.f);
    const readinessCalls = h.provider.readiness.mock.calls.length;
    const preflightCalls = h.provider.preflight.mock.calls.length;
    try {
      let failure: unknown;
      let completed: unknown;
      try { completed = await h.f.request(1); } catch (error) { failure = error; }
      const after = await snapshot(h.f, h.sharedId, h.originId);
      expect(failure).toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_UNAVAILABLE', retryable: false } });
      expect(completed).toBeUndefined();
      expect(claim).not.toHaveBeenCalled();
      expect(after.counts).toEqual(before.counts);
      expect(after).toEqual(before);
      assertExactReviewedBytes(after);
      expect(h.provider.readiness).toHaveBeenCalledTimes(readinessCalls);
      expect(h.provider.preflight).toHaveBeenCalledTimes(preflightCalls);
      expect(h.provider.generate).not.toHaveBeenCalled();
    } finally { claim.mockRestore(); }
  }, 60_000);

  it('current reviewed new prose remains an exact zero-cost reusable body', async () => {
    const h = await historicalReviewedBody(newBeats);
    const before = await snapshot(h.f, h.sharedId, h.originId);
    assertExactReviewedBytes(before);
    expect(() => assertStoryContinuationQuality(reviewedResult(before, h.usage), h.context, 'ko')).not.toThrow();
    const claim = siblingClaimSpy(h.f);
    const readinessCalls = h.provider.readiness.mock.calls.length;
    const preflightCalls = h.provider.preflight.mock.calls.length;
    try {
      const hit = await h.f.request(1);
      expect(hit).toMatchObject({ status: 'completed', provenance: 'ai_reused' });
      const after = await snapshot(h.f, h.sharedId, h.originId);
      expect(after.counts).toEqual({ ...before.counts, continuations: before.counts.continuations + 1,
        scenes: before.counts.scenes + 1, beats: before.counts.beats + newBeats.length,
        choices: before.counts.choices + 1, routes: before.counts.routes + 1, usage: before.counts.usage + 1 });
      expect(claim).toHaveBeenCalledTimes(1);
      expect(after.immutable).toEqual(before.immutable);
      expect(after.allowances).toEqual(before.allowances);
      expect(after.approvals).toEqual(before.approvals);
      expect(after.claims).toEqual(before.claims);
      assertExactReviewedBytes(after);
      const scene = after.scenes.find(row => row.id === hit.resultGeneratedSceneId)!;
      expect(scene).toMatchObject({ userId: h.f.second.id, progressId: h.f.progresses[1].id,
        provenance: 'ai_reused', sharedResultId: h.sharedId, resultChecksum: before.immutable.shared.resultChecksum });
      expect(after.beats.filter(beat => beat.sceneId === scene.id).sort((a, b) => a.position - b.position)
        .map(({ position, beatType, content }) => ({ position, beatType, content })))
        .toEqual(before.immutable.sharedBeats.map(({ position, beatType, content }) => ({ position, beatType, content })));
      const ledger = after.usage.filter(row => row.continuationId === hit.continuationId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]).toMatchObject({ eventKind: 'shared_route_reused', status: 'completed', provenance: 'ai_reused',
        inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0, allowanceDelta: 0, progressApplied: true });
      expect(ledger[0].estimatedCostKrw.isZero() && ledger[0].actualCostKrw!.isZero()).toBe(true);
      const continuation = after.continuations.find(row => row.id === hit.continuationId)!;
      expect(continuation.estimatedCostKrw.isZero() && continuation.actualCostKrw!.isZero()).toBe(true);
      const priorProgress = before.progress.find(row => row.id === h.f.progresses[1].id)!;
      expect(after.progress.find(row => row.id === priorProgress.id)).toMatchObject({ currentGeneratedSceneId: scene.id,
        currentSceneId: null, progressRevision: priorProgress.progressRevision + 1, status: 'active' });
      expect(after.progress.find(row => row.id === h.f.progresses[0].id))
        .toEqual(before.progress.find(row => row.id === h.f.progresses[0].id));
      expect(h.provider.readiness).toHaveBeenCalledTimes(readinessCalls);
      expect(h.provider.preflight).toHaveBeenCalledTimes(preflightCalls);
      expect(h.provider.generate).not.toHaveBeenCalled();
    } finally { claim.mockRestore(); }
  }, 60_000);
});

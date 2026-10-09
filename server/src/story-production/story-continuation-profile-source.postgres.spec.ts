import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { activationFixture, postgresClient } from './story-ai-activation.postgres-fixture';
import { StoryProductionService } from './story-production.service';
import { PersistedStoryContinuationLegalActivationGate } from './story-continuation-legal-activation.gate';
import { StoryContinuationContextAssembler, StoryContinuationContextError,
  type StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import { STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { StoryContinuationExecutor } from './story-continuation.executor';
import type { StoryContinuationClaim, StoryContinuationQueueRepository } from './story-continuation.repository';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';

const postgres = process.env.STORY_TEST_DATABASE_URL ? describe : describe.skip;

postgres('approved manuscript source boundaries (dedicated loopback PostgreSQL, offline AI)', () => {
  let db: PrismaClient;
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

  afterAll(async () => {
    if (originalRegion === undefined) delete process.env.STORY_AI_REGION;
    else process.env.STORY_AI_REGION = originalRegion;
    await db?.$disconnect();
  });

  it('persists full style fields, branch guidance and source-tagged plans separately, then rejects stale view or approval', async () => {
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
      const branchSummary = `${'Keep the consequences of the selected branch. '.repeat(12)}Resolve only conflicts actually established on this route; do not assume the original ending happened.`;
      const writingSummary = `${'Preserve close viewpoint and natural sentence rhythm. '.repeat(8)}STYLE_TAIL: Keep dialogue restrained; do not replace the author voice with an explanatory synopsis.`;
      const writingObservations = Array.from({ length: 5 }, (_, index) => ({
        title: index === 2 ? `${'Approved close viewpoint rule. '.repeat(6)}STYLE_TITLE_TAIL` : `Style rule ${index + 1}`,
        detail: index === 2
          ? `${'Keep viewpoint fixed during testimony. '.repeat(6)}STYLE_MIDDLE_RULE: Never change first person. STYLE_DETAIL_TAIL: Retain every word in witness quotations.`
          : `Keep the approved rhythm for rule ${index + 1}.`,
      }));
      const writingCategories = Array.from({ length: 7 }, (_, index) => ({
        category: `edited-style-${index + 1}`,
        observations: [
          `Keep the approved rhythm for category ${index + 1}.`,
          `STYLE_CATEGORY_EXCEPTION_${index + 1}: Use full sentences during testimony.`,
          `STYLE_CATEGORY_LAST_${index + 1}: Never clip quotations.`,
        ],
      }));
      const expectedWritingStyle = { summary: writingSummary, referenceScope: 'production_constraint',
        observations: writingObservations.map(row => ({ ...row, referenceScope: 'writing_pattern' })),
        categories: writingCategories };
      expect(writingObservations[2].title.length).toBeGreaterThan(160);
      expect(writingObservations[2].detail.length).toBeGreaterThan(160);
      const settings = normalizeCreatorGenerationProfile('story', {
        schemaVersion: 'creator-generation-profile-v1', kind: 'story',
        sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
          key, decision: key === 'writing_style' ? 'edited' : 'accepted', value: key === 'timeline'
            ? { summary: 'The mother dies on the original route in part 32.', observations: [
                { title: 'Original ending', detail: 'ORIGINAL_FUTURE_DEATH', sourceRef },
              ] }
            : key === 'writing_style' ? { summary: writingSummary,
                observations: writingObservations, categories: writingCategories }
            : { summary: key === 'branch_behavior' ? branchSummary : `${key} approved constraint` },
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
      const requests: StoryContinuationProviderRequest[] = [];
      // This is synthetic admission preflight, not model tokenization or a provider runtime.
      const provider = Object.assign(f.provider, { preflight: jest.fn(async (request: StoryContinuationProviderRequest) => {
        requests.push(request);
        contexts.push(request.approvedContext!);
        return { supported: true, inputTokenUpperBound: 100 };
      }) });
      const production = new StoryProductionService(db as never, f.economics, f.provider as never,
        new PersistedStoryContinuationLegalActivationGate(f.activation));
      const start = await production.startProgress(f.reader.id, f.work.id, { mode: 'continue', locale: 'ko' });
      const queued = await production.selectChoice(f.reader.id, start.progressId,
        f.choice.id, start.revision, 'ko', randomUUID()) as { continuationId: string; status: string };
      expect(queued.status).toBe('queued');
      expect(contexts).toHaveLength(1);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ operationId: queued.continuationId, locale: 'ko', inputTokenLimit: 8192,
        provider: f.rate.provider, model: f.rate.model, rateCardId: f.rate.id, rateCardVersion: f.rate.version });
      expect(contexts[0].generationProfile?.sections.find(section => section.key === 'writing_style')?.value)
        .toEqual(expectedWritingStyle);
      expect(Buffer.byteLength(JSON.stringify(contexts[0].generationProfile), 'utf8')).toBeLessThanOrEqual(16_384);
      expect(contexts[0].generationProfile?.sections.find(section => section.key === 'branch_behavior')?.value)
        .toMatchObject({ summary: branchSummary, referenceScope: 'production_constraint' });
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
      expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
      expect(persisted.contextReferences).toMatchObject({ generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
        generationProfilePin: { id: profile.id, profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision,
          sourceFingerprint: profile.sourceFingerprint, approvedFingerprint: profile.approvedFingerprint } });
      expect(requests[0].contextFingerprint).toBe(persisted.contextFingerprint);
      expect(requests[0].inputTokenLimit).toBe(persisted.inputTokenLimit);
      expect(requests[0].outputTokenLimit).toBe(persisted.outputTokenLimit);
      const assembler = new StoryContinuationContextAssembler(db as never);
      const claim = { continuationId: queued.continuationId, leaseToken, attemptCount: 1, maxAttempts: 3, request: {} as never };
      const reassembled = await assembler.assemble(claim);
      expect(reassembled.generationProfile).toEqual(contexts[0].generationProfile);
      expect(reassembled.generationProfile?.sections.find(section => section.key === 'writing_style')?.value)
        .toEqual(expectedWritingStyle);
      expect(reassembled.generationProfile?.sections.find(section => section.key === 'timeline')?.value).toEqual(timeline);
      expect(JSON.stringify({ scene: reassembled.sourceScene, path: reassembled.path,
        memories: reassembled.memories, route: reassembled.routeContinuity })).not.toContain('ORIGINAL_FUTURE_DEATH');
      const currentReferences = persisted.contextReferences as Record<string, any>;
      for (const viewVersion of ['story-profile-prompt-v4', 'story-profile-prompt-v5']) {
        const staleReferences = { ...currentReferences, generationProfileViewVersion: viewVersion };
        await db.storyAiContinuation.update({ where: { id: queued.continuationId }, data: {
          contextReferences: staleReferences,
        } });
        await expect(assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
        const unchanged = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: queued.continuationId },
          select: { contextReferences: true, contextFingerprint: true, status: true, leaseToken: true } });
        expect(unchanged).toEqual({ contextReferences: staleReferences, contextFingerprint: persisted.contextFingerprint,
          status: 'processing', leaseToken });
        expect(provider.preflight).toHaveBeenCalledTimes(1);
        expect(f.provider.generate).not.toHaveBeenCalled();
      }
      await db.storyAiContinuation.update({ where: { id: queued.continuationId }, data: {
        contextReferences: currentReferences,
      } });
      await expect(assembler.assemble(claim)).resolves.toMatchObject({ generationProfile: contexts[0].generationProfile });
      const currentProfile = await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(currentProfile.reviewRevision).toBe(profile.reviewRevision);
      expect(currentProfile.approvedFingerprint).toBe(profile.approvedFingerprint);
      expect(currentProfile.approvedSettings).toEqual(settings);
      await db.storyWorkGenerationProfile.update({ where: { id: profile.id }, data: { reviewRevision: 2 } });
      await expect(assembler.assemble(claim)).rejects.toThrow('pinned_context_changed');
      expect(f.provider.generate).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  }, 90_000);

  async function ownedStaleProfileClaim(variant: 'unsent_first_attempt' | 'already_dispatched' | 'second_attempt') {
    const f = await activationFixture(db);
    await db.storyWork.update({ where: { id: f.work.id }, data: { publishedAt: new Date() } });
    await db.storyScene.update({ where: { id: f.scene.id }, data: { visualManifest: {
      sceneKey: 'source', background: { state: 'fallback', altKey: 'story.visual.fallback' }, characters: [],
      fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
    } } });
    const analysis = await db.storyAnalysisJob.findFirstOrThrow({ where: {
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, status: 'completed',
    } });
    const settings = normalizeCreatorGenerationProfile('story', {
      schemaVersion: 'creator-generation-profile-v1', kind: 'story',
      sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', evidence: [],
        value: { summary: `${key} current approved constraint`, ...(key === 'writing_style' ? {
          observations: [{ title: 'Approved viewpoint', detail: 'Keep first-person testimony intact.' }],
          categories: [{ category: 'narrative_voice', observations: ['Keep the approved voice.', 'Retain testimony exceptions.'] }],
        } : {}) } })),
    });
    const sourceFingerprint = createHash('sha256').update(stableJson({
      workId: f.work.id, manuscriptVersionId: f.manuscript.id, contentHash: f.manuscript.contentHash,
      analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
    })).digest('hex');
    const profile = await db.storyWorkGenerationProfile.create({ data: {
      workId: f.work.id, ownerUserId: f.owner.id, manuscriptVersionId: f.manuscript.id,
      analysisJobId: analysis.id, sourceFingerprint, reviewRevision: 1, status: 'approved',
      draftSettings: settings as never, approvedSettings: settings as never,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
      approvedByUserId: f.owner.id, approvedAt: new Date(),
    } });
    const requests: StoryContinuationProviderRequest[] = [];
    const provider = Object.assign(f.provider, { preflight: jest.fn(async (request: StoryContinuationProviderRequest) => {
      requests.push(request);
      return { supported: true, inputTokenUpperBound: 100 };
    }) });
    const production = new StoryProductionService(db as never, f.economics, provider as never,
      new PersistedStoryContinuationLegalActivationGate(f.activation));
    const start = await production.startProgress(f.reader.id, f.work.id, { mode: 'continue', locale: 'ko' });
    const queued = await production.selectChoice(f.reader.id, start.progressId,
      f.choice.id, start.revision, 'ko', randomUUID()) as { continuationId: string; status: string };
    expect(queued.status).toBe('queued');
    expect(requests).toHaveLength(1);
    const saved = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: queued.continuationId } });
    expect(saved).toMatchObject({ workId: f.work.id, userId: f.reader.id, requestKind: 'recommended_choice',
      status: 'queued', attemptCount: 0, dispatchStartedAt: null, actualCostKrw: null });
    expect(saved.contextReferences).toMatchObject({ generationProfileViewVersion: 'story-profile-prompt-v6',
      generationProfilePin: { id: profile.id, profileVersion: profile.profileVersion, reviewRevision: 1,
        sourceFingerprint, approvedFingerprint: profile.approvedFingerprint } });
    const leaseToken = randomUUID();
    const attemptCount = variant === 'second_attempt' ? 2 : 1;
    const dispatchStartedAt = variant === 'already_dispatched' ? new Date() : null;
    const leased = await db.storyAiContinuation.update({ where: { id: saved.id }, data: {
      status: 'processing', leaseToken, leaseOwner: 'owned-profile-context-worker',
      leaseExpiresAt: new Date(Date.now() + 120_000), startedAt: new Date(), attemptCount, dispatchStartedAt,
    } });
    const claim: StoryContinuationClaim = {
      continuationId: leased.id, leaseToken, attemptCount, maxAttempts: leased.maxAttempts, dispatchStartedAt,
      request: { operationId: leased.id, locale: leased.locale!, contextFingerprint: leased.contextFingerprint!,
        promptVersion: leased.promptVersion!, outputSchemaVersion: leased.outputSchemaVersion!,
        inputTokenLimit: leased.inputTokenLimit!, outputTokenLimit: leased.outputTokenLimit!,
        provider: f.rate.provider, model: f.rate.model, rateCardId: f.rate.id, rateCardVersion: f.rate.version },
    };
    const assembler = new StoryContinuationContextAssembler(db as never);
    const current = await assembler.assemble(claim);
    expect(current.generationProfile).toEqual(requests[0].approvedContext!.generationProfile);
    const staleReferences = { ...(leased.contextReferences as Record<string, any>),
      generationProfileViewVersion: 'story-profile-prompt-v5' };
    await db.storyAiContinuation.update({ where: { id: leased.id }, data: { contextReferences: staleReferences } });
    return { ...f, provider, profile, settings, assembler, claim, staleReferences };
  }

  it.each(['unsent_first_attempt', 'already_dispatched', 'second_attempt'] as const)
  ('settles an owned stale v5 assembler failure without dispatch, preserving cost certainty: %s', async variant => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      // Every variant creates a new owned work; no global queue can claim another case's row.
      const f = await ownedStaleProfileClaim(variant);
      const forbidden = jest.fn(async () => { throw new Error('Dispatch, retry, or moderation is forbidden'); });
      const queue: StoryContinuationQueueRepository = {
        claimExpiredTerminal: jest.fn(async () => null),
        claimNext: jest.fn<Promise<StoryContinuationClaim | null>, [string, number]>()
          .mockResolvedValueOnce(f.claim).mockResolvedValue(null),
        markDispatched: forbidden, releaseForRetry: forbidden, releaseNotAcceptedForRetry: forbidden,
      };
      const authorization = jest.spyOn(f.economics, 'continuationExecutionAuthorization');
      const assemble = jest.spyOn(f.assembler, 'assemble');
      const failure = jest.spyOn(f.economics, 'failClaimedContinuation');
      try {
        f.provider.readiness.mockClear();
        const executor = new StoryContinuationExecutor(queue, f.provider as never, f.economics,
          f.assembler, { preview: forbidden } as never);
        await expect(executor.executeOne('owned-profile-context-worker')).resolves.toEqual({
          status: 'failed', continuationId: f.claim.continuationId,
        });
        expect(queue.claimExpiredTerminal).toHaveBeenCalledTimes(1);
        expect(queue.claimNext).toHaveBeenCalledTimes(1);
        expect(authorization).toHaveBeenCalledTimes(1);
        await expect(authorization.mock.results[0].value).resolves.toEqual({ allowed: true });
        expect(assemble).toHaveBeenCalledTimes(1);
        expect(assemble).toHaveBeenCalledWith(f.claim);
        await expect(assemble.mock.results[0].value).rejects.toBeInstanceOf(StoryContinuationContextError);
        await expect(assemble.mock.results[0].value).rejects.toMatchObject({ code: 'pinned_context_changed' });
        expect(failure).toHaveBeenCalledTimes(1);
        expect(failure).toHaveBeenCalledWith(f.claim, 'pinned_context_changed', 'failed', undefined, true);
        await expect(failure.mock.results[0].value).resolves.toMatchObject({ continuationId: f.claim.continuationId,
          status: 'failed', failureCode: 'pinned_context_changed', progressApplied: false, allowanceConsumed: false,
          idempotentReplay: false });
        const settled = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: f.claim.continuationId } });
        expect(settled).toMatchObject({ status: 'failed', failureCode: 'pinned_context_changed',
          attemptCount: f.claim.attemptCount, dispatchStartedAt: f.claim.dispatchStartedAt,
          resultGeneratedSceneId: null, leaseToken: null, leaseOwner: null, leaseExpiresAt: null });
        const ledgers = await db.storyAiUsageLedger.findMany({ where: {
          continuationId: settled.id, eventKind: 'new_route_failed',
        } });
        expect(ledgers).toHaveLength(1);
        expect(ledgers[0]).toMatchObject({ status: 'failed', inputTokens: 0, outputTokens: 0,
          cachedInputTokens: 0, imageUnits: 0, allowanceDelta: 0, progressApplied: false });
        if (variant === 'unsent_first_attempt') {
          expect(settled.actualCostKrw).toEqual(new Prisma.Decimal(0));
          expect(ledgers[0].actualCostKrw).toEqual(new Prisma.Decimal(0));
          expect(settled.contextReferences).toEqual({ ...f.staleReferences, noProviderDispatchEvidence: {
            kind: 'provider_preflight_rejected_before_dispatch_v1', continuationId: settled.id,
            attemptCount: 1, failureCode: 'pinned_context_changed',
          } });
        } else {
          expect(settled.actualCostKrw).toBeNull();
          expect(ledgers[0].actualCostKrw).toBeNull();
          expect(settled.contextReferences).toEqual(f.staleReferences);
        }
        expect(await db.storyReaderProgress.findUniqueOrThrow({ where: { id: settled.progressId } }))
          .toMatchObject({ status: 'active', currentSceneId: f.scene.id, currentGeneratedSceneId: null });
        expect(await db.storyAiAllowanceBucket.findUniqueOrThrow({ where: { userId_releaseId: {
          userId: f.reader.id, releaseId: f.release.id,
        } } })).toMatchObject({ reservedCount: 0, consumedCount: 0 });
        expect(await db.storyAiGeneratedScene.count({ where: { continuationId: settled.id } })).toBe(0);
        expect(await db.storyWorkGenerationProfile.findUniqueOrThrow({ where: { id: f.profile.id } }))
          .toMatchObject({ status: 'approved', reviewRevision: 1, approvedFingerprint: f.profile.approvedFingerprint,
            approvedSettings: f.settings });
        expect(f.provider.readiness).toHaveBeenCalledTimes(1);
        expect(f.provider.preflight).toHaveBeenCalledTimes(1);
        expect(f.provider.generate).not.toHaveBeenCalled();
        expect(forbidden).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
      } finally {
        authorization.mockRestore();
        assemble.mockRestore();
        failure.mockRestore();
      }
    } finally {
      network.mockRestore();
    }
  }, 90_000);

  it('rejects an owned stale lease without ledger writes or zero-cost evidence, even with the no-dispatch flag', async () => {
    const network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    try {
      const f = await ownedStaleProfileClaim('unsent_first_attempt');
      const claim = { ...f.claim, leaseToken: randomUUID() };
      const before = await db.storyAiContinuation.findUniqueOrThrow({ where: { id: claim.continuationId } });
      const ledgerCount = await db.storyAiUsageLedger.count({ where: { continuationId: claim.continuationId } });
      expect(before).toMatchObject({ status: 'processing', leaseToken: f.claim.leaseToken,
        attemptCount: 1, dispatchStartedAt: null, actualCostKrw: null });
      expect(claim.leaseToken).not.toBe(before.leaseToken);
      // A caller's flag cannot override the real locked-transaction lease check.
      await expect(f.economics.failClaimedContinuation(claim, 'pinned_context_changed', 'failed', undefined, true))
        .rejects.toThrow('lease is stale');
      const forbidden = jest.fn(async () => { throw new Error('Dispatch, retry, or moderation is forbidden'); });
      const queue: StoryContinuationQueueRepository = {
        claimExpiredTerminal: jest.fn(async () => null),
        claimNext: jest.fn<Promise<StoryContinuationClaim | null>, [string, number]>()
          .mockResolvedValueOnce(claim).mockResolvedValue(null),
        markDispatched: forbidden, releaseForRetry: forbidden, releaseNotAcceptedForRetry: forbidden,
      };
      const authorization = jest.spyOn(f.economics, 'continuationExecutionAuthorization');
      const assemble = jest.spyOn(f.assembler, 'assemble');
      const failure = jest.spyOn(f.economics, 'failClaimedContinuation');
      try {
        const executor = new StoryContinuationExecutor(queue, f.provider as never, f.economics,
          f.assembler, { preview: forbidden } as never);
        await expect(executor.executeOne('owned-profile-context-worker')).rejects.toThrow('lease is stale');
        expect(authorization).toHaveBeenCalledWith(claim);
        await expect(authorization.mock.results[0].value).resolves.toEqual({ allowed: false, code: 'stale_worker_lease' });
        expect(assemble).not.toHaveBeenCalled();
        expect(failure).toHaveBeenCalledWith(claim, 'stale_worker_lease', 'failed');
        expect(await db.storyAiContinuation.findUniqueOrThrow({ where: { id: claim.continuationId } })).toEqual(before);
        expect(await db.storyAiUsageLedger.count({ where: { continuationId: claim.continuationId } })).toBe(ledgerCount);
        expect(await db.storyAiUsageLedger.count({ where: { continuationId: claim.continuationId,
          eventKind: 'new_route_failed' } })).toBe(0);
        expect(f.provider.preflight).toHaveBeenCalledTimes(1);
        expect(f.provider.generate).not.toHaveBeenCalled();
        expect(forbidden).not.toHaveBeenCalled();
        expect(network).not.toHaveBeenCalled();
      } finally {
        authorization.mockRestore();
        assemble.mockRestore();
        failure.mockRestore();
      }
    } finally {
      network.mockRestore();
    }
  }, 90_000);
});

import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';

function fixture(includedAiRouteCount = 2) {
  const now = new Date();
  const capability = {
    releaseId: 'release-id', status: 'active', revision: 4,
    rateCardId: 'rate-card-id', includedAiRouteCount,
    aiInputTokenLimit: 1000, aiOutputTokenLimit: 300,
    warningBudgetKrw: new Decimal(10), hardBudgetKrw: new Decimal(20),
  };
  const rateCard = {
    id: 'rate-card-id', version: 'rate-v1', provider: 'test-double', model: 'none',
    status: 'active', inputCostPerMillion: new Decimal(1),
    outputCostPerMillion: new Decimal(1), cachedInputCostPerMillion: new Decimal(0),
    imageUnitCost: new Decimal(0),
  };
  const consent = {
    id: 'consent-id', workId: 'work-id', manuscriptVersionId: 'manuscript-id',
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true,
    allowedLocales: ['ko'], startsAt: new Date(now.getTime() - 1000),
    expiresAt: null, revision: 3,
  };
  const rights = {
    id: 'rights-version-id', contractId: 'rights-contract-id', revision: 2,
    contentVersionId: 'manuscript-id', approvalState: 'approved_configuration',
    aiTransformationAllowed: true, generatedResultReuseAllowed: false,
    media: ['story_publication'], effectiveFrom: new Date(now.getTime() - 1000),
    startsAt: new Date(now.getTime() - 1000), endsAt: null,
  };
  const allowance = {
    id: 'allowance-id', revision: 1, includedLimit: includedAiRouteCount,
    purchasedLimit: 0, reservedCount: 0, consumedCount: 0, compensatedCount: 0,
  };
  const createContinuation = jest.fn(async ({ data }) => ({
    ...data, id: 'continuation-id', status: 'queued', createdAt: now, completedAt: null,
  }));
  const tx = {
    storyAiContinuation: { findUnique: jest.fn().mockResolvedValue(null), create: createContinuation },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue(capability) },
    storyAiRateCard: { findUnique: jest.fn().mockResolvedValue(rateCard) },
    storyStyleProfileConsent: { findFirst: jest.fn().mockResolvedValue(consent) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: 'analysis-id', analysisVersion: 7 }) },
    contentRightsContract: { findFirst: jest.fn().mockResolvedValue({ id: 'rights-contract-id', versions: [rights] }) },
    storyMemoryRecord: { findMany: jest.fn().mockResolvedValue([{ id: 'memory-id', memoryType: 'event', revision: 1, content: { summary: 'bounded' } }]) },
    storyChoiceEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'event-id', sceneId: 'prior', choiceId: 'prior-choice', targetSceneId: 'scene-id' }]) },
    storyScene: { findMany: jest.fn().mockResolvedValue([{ id: 'opening', title: { ko: '이전 장면' }, endingType: null }]) },
    storyChoice: { findMany: jest.fn().mockResolvedValue([{
      id: 'choice-a', sceneId: 'opening', label: { ko: '이전 선택' }, targetEndingKey: null, declaredRejoinSceneId: null,
    }]) },
    storyAiGeneratedScene: { findMany: jest.fn().mockResolvedValue([]) },
    storyAiGeneratedChoice: { findMany: jest.fn().mockResolvedValue([]) },
    storyBeat: { findMany: jest.fn().mockResolvedValue([
      { position: 1, beatType: 'paragraph', content: { ko: '현재 장면 본문' } },
    ]) },
    storyAiGeneratedBeat: { findMany: jest.fn() },
    storyAiAllowanceBucket: {
      findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue(allowance),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    storyAiUsageLedger: { create: jest.fn() },
    storyReaderProgress: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const provider: { readiness: jest.Mock; preflight?: jest.Mock } = {
    readiness: jest.fn().mockResolvedValue({ enabled: true }),
  };
  const service = new StoryEconomicsService(
    {} as never,
    { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) } as never,
    provider as never,
  );
  const input = {
    userId: 'reader-id',
    progress: {
      id: 'progress-id', workId: 'work-id', aiRateCardId: 'rate-card-id',
      capabilityRevision: 4, progressRevision: 9, checkpointSceneId: 'scene-id',
      pathSummary: [{ sceneId: 'opening', choiceId: 'choice-a' }],
    },
    work: { id: 'work-id' }, part: { id: 'part-id' },
    scene: { id: 'scene-id', title: { ko: '장면' } },
    release: {
      id: 'release-id', workId: 'work-id', version: 1,
      manuscriptVersionId: 'manuscript-id', checksum: 'release-checksum', status: 'active',
    },
    choice: {
      id: 'choice-b', sceneId: 'scene-id', label: { ko: '다른 길' },
      routeKind: 'generation_required', targetSceneId: null,
    },
    sourceKind: 'canonical' as const,
    locale: 'ko', idempotencyKey: 'recommended-idempotency-key',
  };
  return { service, tx, input, createContinuation, provider };
}

describe('recommended choice enqueue transaction', () => {
  const approvedProfile = () => {
    const approvedSettings = {
      schemaVersion: 'creator-generation-profile-v1' as const,
      kind: 'story' as const,
      sections: [
        'writing_style', 'scene_scale', 'canon', 'timeline', 'narrative_devices',
        'branch_behavior', 'visual_direction', 'visual_cast',
      ].map((key) => ({ key, decision: 'accepted' as const, value: { summary: `${key} approved` }, evidence: [] })),
    };
    const normalizedSettings = normalizeCreatorGenerationProfile('story', approvedSettings);
    const sourceFingerprint = 'a'.repeat(64);
    return {
      id: 'profile-id', status: 'approved', manuscriptVersionId: 'manuscript-id',
      analysisJobId: 'analysis-id', profileVersion: 2, reviewRevision: 4,
      sourceFingerprint, approvedSettings: normalizedSettings,
      approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, normalizedSettings),
    };
  };

  it('preflights the pinned complete request before reservation and uses its token budget', async () => {
    const f = fixture();
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });
    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);
    expect(f.provider.preflight).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'test-double', model: 'none', rateCardId: 'rate-card-id', rateCardVersion: 'rate-v1',
      inputTokenLimit: 1000, outputTokenLimit: 300, locale: 'ko',
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      approvedContext: expect.objectContaining({ selectedChoice: { label: '다른 길' } }),
    }));
    expect(f.provider.preflight.mock.invocationCallOrder[0])
      .toBeLessThan(f.tx.storyAiAllowanceBucket.upsert.mock.invocationCallOrder[0]);
    expect(f.tx.storyAiUsageLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inputTokens: 900 }),
    }));
    expect(f.provider.preflight.mock.calls[0][0].operationId)
      .toBe(f.createContinuation.mock.calls[0][0].data.id);
  });

  it('keeps caller idempotency data out of the provider operation identifier', async () => {
    const f = fixture();
    f.input.idempotencyKey = `reader:operation:${'x'.repeat(150)}`;
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });
    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);
    const request = f.provider.preflight.mock.calls[0][0];
    expect(request.operationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(request.operationId).not.toBe(f.input.idempotencyKey);
    expect(f.createContinuation.mock.calls[0][0].data.idempotencyKey)
      .toBe(`recommended-choice:${f.input.idempotencyKey}`);
  });

  it.each([
    { supported: false, reason: 'model_configuration_mismatch' },
    { supported: true },
    { supported: true, inputTokenUpperBound: Number.NaN },
    { supported: true, inputTokenUpperBound: 0 },
    { supported: true, inputTokenUpperBound: 1001 },
  ])('rejects an unsupported or invalid preflight before any personal mutation: %j', async (result) => {
    const f = fixture();
    f.provider.preflight = jest.fn().mockResolvedValue(result);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toMatchObject({
      response: { progressMutated: false, generationStarted: false },
    });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.updateMany).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('checks the cost of the full preflight budget, not the old character estimate', async () => {
    const f = fixture();
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });
    const card = await f.tx.storyAiRateCard.findUnique({});
    card.inputCostPerMillion = new Decimal(100000);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_HARD_BUDGET_EXCEEDED' } });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
  });

  it('pins context and reserves one included route without creating custom input', async () => {
    const f = fixture();
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .resolves.toMatchObject({
        continuationId: 'continuation-id', status: 'queued', allowanceRemaining: 1,
        privateInputReturned: false, providerPayloadReturned: false,
      });
    const data = f.createContinuation.mock.calls[0][0].data;
    expect(data).toMatchObject({
      requestKind: 'recommended_choice', customChoiceId: null,
      recommendedChoiceId: 'choice-b', sourcePartId: 'part-id', sourceSceneId: 'scene-id',
      manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id', analysisVersion: 7,
      rightsContractId: 'rights-contract-id', rightsContractVersionId: 'rights-version-id',
      styleConsentRevision: 3, promptVersion: 'story-continuation-v4',
      outputSchemaVersion: 'story-continuation-output-v1',
    });
    expect(data.contextFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain('raw manuscript');
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledTimes(1);
    expect(f.tx.storyAiUsageLedger.create).toHaveBeenCalledTimes(1);
    expect(f.tx.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'ai_pending', progressRevision: { increment: 1 } }),
    }));
  });

  it('pins an approved creator profile into generation, cache identity, and provider context', async () => {
    const f = fixture();
    const profile = approvedProfile();
    Object.assign(f.tx, {
      storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    });
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });
    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);
    const data = f.createContinuation.mock.calls[0][0].data;
    expect(data.contextReferences.generationProfilePin).toMatchObject({
      id: 'profile-id', profileVersion: 2, reviewRevision: 4,
      approvedFingerprint: profile.approvedFingerprint,
    });
    expect(f.provider.preflight).toHaveBeenCalledWith(expect.objectContaining({
      approvedContext: expect.objectContaining({
        generationProfile: expect.objectContaining({
          sections: expect.arrayContaining([
            { key: 'writing_style', value: { summary: 'writing_style approved' } },
          ]),
        }),
      }),
    }));
  });

  it('blocks a new-profile work until its latest profile is approved', async () => {
    const f = fixture();
    Object.assign(f.tx, {
      storyWorkGenerationProfile: {
        findFirst: jest.fn().mockResolvedValue({
          ...approvedProfile(), status: 'needs_review', approvedFingerprint: null, approvedSettings: null,
        }),
      },
    });
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toMatchObject({ response: { code: 'STORY_GENERATION_PROFILE_APPROVAL_REQUIRED' } });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('returns the winning replay when the same idempotency key wins the allowance race', async () => {
    const f = fixture();
    const winner = {
      id: 'winning-continuation', requestKind: 'recommended_choice',
      userId: f.input.userId, progressId: f.input.progress.id,
      recommendedChoiceId: f.input.choice.id, generatedChoiceId: null,
      releaseId: f.input.release.id, status: 'queued',
      sourceProgressRevision: f.input.progress.progressRevision,
      locale: f.input.locale,
      createdAt: new Date(), completedAt: null,
    };
    f.tx.storyAiContinuation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    f.tx.storyAiAllowanceBucket.updateMany.mockResolvedValue({ count: 0 });
    f.tx.storyAiAllowanceBucket.findUnique.mockResolvedValue({
      id: 'allowance-id', revision: 2, includedLimit: 2, purchasedLimit: 0,
      reservedCount: 1, consumedCount: 0, compensatedCount: 0,
    });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .resolves.toMatchObject({
        continuationId: winner.id,
        idempotentReplay: true,
        allowanceRemaining: 1,
      });
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledTimes(1);
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the allowance concurrency conflict when a different key won the race', async () => {
    const f = fixture();
    f.tx.storyAiContinuation.findUnique.mockResolvedValue(null);
    f.tx.storyAiAllowanceBucket.updateMany.mockResolvedValue({ count: 0 });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toThrow('Story AI allowance changed concurrently');
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a same-key allowance race when the winning payload scope differs', async () => {
    const f = fixture();
    f.tx.storyAiContinuation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'conflicting-continuation', requestKind: 'recommended_choice',
        userId: f.input.userId, progressId: f.input.progress.id,
        recommendedChoiceId: 'different-choice', generatedChoiceId: null,
        releaseId: f.input.release.id,
        sourceProgressRevision: f.input.progress.progressRevision,
        locale: f.input.locale,
      });
    f.tx.storyAiAllowanceBucket.updateMany.mockResolvedValue({ count: 0 });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toThrow('Recommended choice idempotency conflict');
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['revision', { sourceProgressRevision: 8, locale: 'ko' }],
    ['locale', { sourceProgressRevision: 9, locale: 'en' }],
  ])('rejects a same-key allowance race when the winning %s differs', async (_field, scope) => {
    const f = fixture();
    f.tx.storyAiContinuation.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'conflicting-continuation', requestKind: 'recommended_choice',
        userId: f.input.userId, progressId: f.input.progress.id,
        recommendedChoiceId: f.input.choice.id, generatedChoiceId: null,
        releaseId: f.input.release.id,
        ...scope,
      });
    f.tx.storyAiAllowanceBucket.updateMany.mockResolvedValue({ count: 0 });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toThrow('Recommended choice idempotency conflict');
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('normalizes locale while enforcing revision and locale on initial replay', async () => {
    const f = fixture();
    const continuation = {
      id: 'existing-continuation', requestKind: 'recommended_choice',
      userId: f.input.userId, progressId: f.input.progress.id,
      recommendedChoiceId: f.input.choice.id, generatedChoiceId: null,
      releaseId: f.input.release.id, status: 'queued',
      sourceProgressRevision: f.input.progress.progressRevision,
      locale: 'zh-Hans', createdAt: new Date(), completedAt: null,
    };
    f.tx.storyAiContinuation.findUnique.mockResolvedValue(continuation);
    f.tx.storyAiAllowanceBucket.findUnique.mockResolvedValue({
      id: 'allowance-id', revision: 2, includedLimit: 2, purchasedLimit: 0,
      reservedCount: 1, consumedCount: 0, compensatedCount: 0,
    });
    const service = new StoryEconomicsService(f.tx as never);

    await expect(service.recommendedChoiceReplay(
      f.input.userId,
      f.input.progress.id,
      f.input.choice.id,
      f.input.progress.progressRevision,
      ' zh-hans ',
      f.input.idempotencyKey,
    )).resolves.toMatchObject({ continuationId: continuation.id, idempotentReplay: true });
    await expect(service.recommendedChoiceReplay(
      f.input.userId,
      f.input.progress.id,
      f.input.choice.id,
      f.input.progress.progressRevision + 1,
      'zh-Hans',
      f.input.idempotencyKey,
    )).rejects.toThrow('Recommended choice idempotency conflict');
    await expect(service.recommendedChoiceReplay(
      f.input.userId,
      f.input.progress.id,
      f.input.choice.id,
      f.input.progress.progressRevision,
      'zh-Hant',
      f.input.idempotencyKey,
    )).rejects.toThrow('Recommended choice idempotency conflict');
  });

  it('rejects an explicitly zero included allowance before any reservation or continuation write', async () => {
    const f = fixture(0);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_ALLOWANCE_NOT_CONFIGURED' } });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('rejects a hard budget breach before quota mutation', async () => {
    const f = fixture();
    const card = await f.tx.storyAiRateCard.findUnique({});
    card.outputCostPerMillion = new Decimal(100000);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('rejects oversized approved context instead of clamping the estimate before enqueue', async () => {
    const f = fixture();
    f.tx.storyMemoryRecord.findMany.mockResolvedValue([{
      id: 'memory-id', memoryType: 'event', revision: 1, content: { summary: '다'.repeat(5000) },
    }]);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_CONTEXT_BUDGET_EXCEEDED' } });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('changes the provider fingerprint when the semantic choice path changes', async () => {
    const first = fixture();
    const second = fixture();
    second.tx.storyChoice.findMany.mockResolvedValue([{
      id: 'choice-a', sceneId: 'opening', label: { ko: '다른 과거 선택' }, targetEndingKey: null, declaredRejoinSceneId: null,
    }]);
    await first.service.requestRecommendedChoiceTx(first.tx as never, first.input);
    await second.service.requestRecommendedChoiceTx(second.tx as never, second.input);
    const firstData = first.createContinuation.mock.calls[0][0].data;
    const secondData = second.createContinuation.mock.calls[0][0].data;
    expect(firstData.contextFingerprint).not.toBe(secondData.contextFingerprint);
    expect(firstData.contextReferences.pathHash).not.toBe(secondData.contextReferences.pathHash);
    expect(JSON.stringify(firstData.contextReferences)).not.toContain('event-id');
  });

  it('excludes progress revision and history event ids from reusable context identity', async () => {
    const first = fixture();
    const second = fixture();
    second.input.progress.progressRevision = 77;
    second.input.progress.checkpointSceneId = 'another-checkpoint';
    await first.service.requestRecommendedChoiceTx(first.tx as never, first.input);
    await second.service.requestRecommendedChoiceTx(second.tx as never, second.input);
    const firstData = first.createContinuation.mock.calls[0][0].data;
    const secondData = second.createContinuation.mock.calls[0][0].data;
    expect(firstData.contextFingerprint).toBe(secondData.contextFingerprint);
    expect(JSON.stringify(firstData.contextReferences)).not.toContain('event-id');
  });
});

describe('recommended continuation execution pins', () => {
  it('fails closed before provider execution when nullable analysis, rights, or manuscript pins are absent', async () => {
    const now = new Date();
    const continuation = {
      id: 'continuation-id', requestKind: 'recommended_choice', status: 'processing',
      leaseToken: 'lease-token', userId: 'reader-id', workId: 'work-id',
      releaseId: 'release-id', rateCardId: 'rate-id', styleConsentId: 'consent-id',
      capabilityRevision: 2, styleConsentRevision: 3, locale: 'ko',
      manuscriptVersionId: null, analysisJobId: null, analysisVersion: null,
      rightsContractId: null, rightsContractVersionId: null, releaseChecksum: 'checksum',
    };
    const prisma = {
      storyAiContinuation: { findUnique: jest.fn().mockResolvedValue(continuation) },
      storyWork: { findUnique: jest.fn().mockResolvedValue({ status: 'published', activeReleaseId: 'release-id' }) },
      storyRelease: { findUnique: jest.fn().mockResolvedValue({ workId: 'work-id', status: 'active', manuscriptVersionId: 'manuscript-id', checksum: 'checksum' }) },
      storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue({ status: 'active', revision: 2, rateCardId: 'rate-id' }) },
      storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue({
        status: 'active', rightsConfirmed: true, aiBranchAllowed: true, revision: 3,
        manuscriptVersionId: 'manuscript-id', startsAt: new Date(now.getTime() - 1000),
        expiresAt: null, allowedLocales: ['ko'],
      }) },
      contentRightsContractVersion: { findUnique: jest.fn() },
      storyAnalysisJob: { findFirst: jest.fn() },
      storyReaderProgress: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new StoryEconomicsService(
      prisma as never,
      { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) } as never,
    );
    await expect(service.continuationExecutionAuthorization({
      continuationId: 'continuation-id', leaseToken: 'lease-token',
      attemptCount: 1, maxAttempts: 3, request: {} as never,
    })).resolves.toEqual({ allowed: false, code: 'generation_authorization_changed' });
    expect(prisma.contentRightsContractVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.storyAnalysisJob.findFirst).not.toHaveBeenCalled();
  });
});

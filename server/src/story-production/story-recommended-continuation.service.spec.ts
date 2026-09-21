import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';

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
  const service = new StoryEconomicsService(
    {} as never,
    { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) } as never,
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
  return { service, tx, input, createContinuation };
}

describe('recommended choice enqueue transaction', () => {
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
      styleConsentRevision: 3, promptVersion: 'story-continuation-v1',
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

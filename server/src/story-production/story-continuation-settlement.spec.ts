import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';

function fixture() {
  const now = new Date();
  const continuation = {
    id: 'continuation-id', userId: 'reader-id', workId: 'work-id', releaseId: 'release-id',
    progressId: 'progress-id', requestKind: 'recommended_choice', customChoiceId: null,
    recommendedChoiceId: 'choice-id', generatedChoiceId: null,
    rateCardId: 'rate-id', styleConsentId: 'consent-id', styleConsentRevision: 2,
    capabilityRevision: 3, sourcePartId: 'part-id', sourceSceneId: 'scene-id',
    sourceGeneratedSceneId: null, sourceProgressRevision: 9, checkpointSceneId: 'scene-id',
    manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id', analysisVersion: 4,
    rightsContractId: 'contract-id', rightsContractVersionId: 'rights-version-id',
    releaseChecksum: 'checksum', locale: 'ko', status: 'processing', leaseToken: 'lease-token',
    leaseExpiresAt: new Date(now.getTime() + 60_000), inputTokenLimit: 1000,
    outputTokenLimit: 500, hardBudgetKrw: new Decimal(10), estimatedCostKrw: new Decimal(0),
  };
  const progress = {
    id: 'progress-id', userId: 'reader-id', workId: 'work-id', activeReleaseId: 'release-id',
    currentSceneId: 'scene-id', currentGeneratedSceneId: null, progressRevision: 10,
    currentAct: 1, status: 'ai_pending', pathSummary: [], seenSceneIds: ['scene-id'],
    visitedEndingKeys: [],
  };
  const rateCard = {
    id: 'rate-id', version: 'test-v1', provider: 'test-double', model: 'none',
    inputCostPerMillion: new Decimal(0), outputCostPerMillion: new Decimal(0),
    cachedInputCostPerMillion: new Decimal(0), imageUnitCost: new Decimal(0),
  };
  const generatedSceneCreate = jest.fn().mockResolvedValue({ id: 'generated-scene-id' });
  const canonicalCreate = jest.fn(() => { throw new Error('canonical graph write'); });
  const tx = {
    storyAiContinuation: {
      findUnique: jest.fn().mockResolvedValue(continuation),
      update: jest.fn(async ({ data }) => ({ ...continuation, ...data })),
    },
    storyAiRateCard: { findUnique: jest.fn().mockResolvedValue(rateCard) },
    storyAiAllowanceBucket: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'allowance-id', revision: 1, workId: 'work-id', reservedCount: 1,
        includedLimit: 2, purchasedLimit: 0, consumedCount: 0, compensatedCount: 0,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    storyReaderProgress: {
      findUnique: jest.fn().mockResolvedValue(progress),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    storyScene: { findUnique: jest.fn().mockResolvedValue({ id: 'scene-id', partId: 'part-id' }), create: canonicalCreate },
    storyBeat: { create: canonicalCreate },
    storyChoice: { create: canonicalCreate },
    storyStyleProfileConsent: { findUnique: jest.fn().mockResolvedValue({
      id: 'consent-id', status: 'active', rightsConfirmed: true, aiBranchAllowed: true,
      revision: 2, manuscriptVersionId: 'manuscript-id', startsAt: new Date(0), expiresAt: null,
    }) },
    storyRelease: { findUnique: jest.fn().mockResolvedValue({
      id: 'release-id', workId: 'work-id', status: 'active', manuscriptVersionId: 'manuscript-id', checksum: 'checksum',
    }) },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue({
      status: 'active', revision: 3, rateCardId: 'rate-id', includedAiRouteCount: 2,
    }) },
    contentRightsContractVersion: { findUnique: jest.fn().mockResolvedValue({
      id: 'rights-version-id', contractId: 'contract-id', approvalState: 'approved_configuration',
      aiTransformationAllowed: true, contentVersionId: 'manuscript-id', effectiveFrom: new Date(0),
      startsAt: new Date(0), endsAt: null, media: ['story_publication'],
    }) },
    storyWork: { findUnique: jest.fn().mockResolvedValue({ status: 'published', activeReleaseId: 'release-id' }) },
    storyAnalysisJob: { findFirst: jest.fn().mockResolvedValue({ id: 'analysis-id', analysisVersion: 4 }) },
    storyAiGeneratedScene: { create: generatedSceneCreate, findFirst: jest.fn() },
    storyAiGeneratedBeat: { create: jest.fn() },
    storyAiGeneratedChoice: { create: jest.fn() },
    storyChoiceEvent: { create: jest.fn() },
    storyEndingDiscovery: { upsert: jest.fn() },
    storyAiUsageLedger: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    storyCustomChoice: { update: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (run) => run(tx)),
  };
  const service = new StoryEconomicsService(
    prisma as never,
    { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) } as never,
  );
  return { service, tx, generatedSceneCreate, canonicalCreate };
}

describe('recommended continuation overlay settlement', () => {
  it('atomically settles into the reader overlay and never publishes canonical graph rows', async () => {
    const f = fixture();
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '생성 장면' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: '독자 전용 본문' } }],
      resultVisualManifest: {
        sceneKey: 'ai-continuation-id',
        background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: '계속' } }],
    }, 'settlement-key', 'lease-token')).resolves.toMatchObject({ status: 'completed' });
    expect(f.generatedSceneCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      userId: 'reader-id', workId: 'work-id', releaseId: 'release-id', progressId: 'progress-id',
      status: 'ready', provenance: 'ai_generated', resultChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) });
    expect(f.canonicalCreate).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currentSceneId: null, currentGeneratedSceneId: 'generated-scene-id' }),
    }));
    expect(f.tx.storyAiContinuation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resultSceneId: null, resultGeneratedSceneId: 'generated-scene-id' }),
    }));
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledTimes(1);
  });
});

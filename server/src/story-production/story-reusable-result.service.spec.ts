import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';
import { StoryAiActivationService } from './story-ai-activation.service';
import { storyRouteRootHash } from './story-route-identity.policy';

const evidence = {
  rightsActivationKey: 'legal-activation-v1',
  moderationPolicyVersion: 'moderation-policy-v1',
  moderationEvidenceVersion: 'moderation-evidence-v1',
  qualityPolicyVersion: 'quality-policy-v1',
};

function integrationFixture() {
  const now = new Date();
  const progresses: Record<string, any> = {
    'progress-1': {
      id: 'progress-1', userId: 'reader-1', workId: 'work-id', activeReleaseId: 'release-id',
      currentSceneId: 'scene-id', currentGeneratedSceneId: null, progressRevision: 9,
      currentAct: 1, currentBeatPosition: 0, status: 'active', checkpointSceneId: 'scene-id',
      aiRateCardId: 'rate-id', capabilityRevision: 3, pathSummary: [],
      seenSceneIds: ['scene-id'], visitedEndingKeys: [],
    },
    'progress-2': {
      id: 'progress-2', userId: 'reader-2', workId: 'work-id', activeReleaseId: 'release-id',
      currentSceneId: 'scene-id', currentGeneratedSceneId: null, progressRevision: 9,
      currentAct: 1, currentBeatPosition: 0, status: 'active', checkpointSceneId: 'scene-id',
      aiRateCardId: 'rate-id', capabilityRevision: 3, pathSummary: [],
      seenSceneIds: ['scene-id'], visitedEndingKeys: [],
    },
  };
  const allowances: Record<string, any> = {};
  const continuations = new Map<string, any>();
  const generatedScenes: any[] = [];
  const ledgers: any[] = [];
  const reusableBeats: any[] = [];
  const reusableChoices: any[] = [];
  const generatedBeats: any[] = [];
  const generatedChoices: any[] = [];
  let sharedResult: any = null;
  let continuationSequence = 0;
  let generatedSequence = 0;
  const capability = {
    releaseId: 'release-id', status: 'active', revision: 3, rateCardId: 'rate-id',
    includedAiRouteCount: 2, aiInputTokenLimit: 1000, aiOutputTokenLimit: 300,
    warningBudgetKrw: new Decimal(10), hardBudgetKrw: new Decimal(20),
  };
  const rateCard = {
    id: 'rate-id', version: 'rate-v1', provider: 'test-double', model: 'model-v1',
    status: 'active', inputCostPerMillion: new Decimal(0), outputCostPerMillion: new Decimal(0),
    cachedInputCostPerMillion: new Decimal(0), imageUnitCost: new Decimal(0),
  };
  const consent = {
    id: 'consent-id', workId: 'work-id', manuscriptVersionId: 'manuscript-id',
    status: 'active', rightsConfirmed: true, aiBranchAllowed: true, allowedLocales: ['ko'],
    startsAt: new Date(now.getTime() - 1000), expiresAt: null, revision: 2,
  };
  const rights = {
    id: 'rights-version-id', contractId: 'contract-id', revision: 4,
    contentVersionId: 'manuscript-id', approvalState: 'approved_configuration',
    aiTransformationAllowed: true, generatedResultReuseAllowed: true,
    media: ['story_publication'], effectiveFrom: new Date(0), startsAt: new Date(0), endsAt: null,
  };
  const release = {
    id: 'release-id', workId: 'work-id', version: 1, status: 'active',
    manuscriptVersionId: 'manuscript-id', checksum: 'release-checksum',
  };
  const work = { id: 'work-id', status: 'published', activeReleaseId: 'release-id' };
  const routeNodes = new Map<string, any>();
  for (const progress of Object.values(progresses)) {
    progress.routeNodeId = `root-${progress.id}`;
    routeNodes.set(progress.routeNodeId, { id: progress.routeNodeId, depth: 0, routeHash: storyRouteRootHash({
      workId: work.id, releaseId: release.id, releaseChecksum: release.checksum,
      manuscriptVersionId: release.manuscriptVersionId, entrySceneId: 'scene-id',
    }) });
  }
  const createContinuation = jest.fn(async ({ data }) => {
    const row = {
      ...data, id: `continuation-${++continuationSequence}`,
      status: data.status ?? 'queued', failureCode: null,
      leaseToken: null, leaseExpiresAt: null, createdAt: now, completedAt: data.completedAt ?? null,
    };
    continuations.set(row.id, row);
    return row;
  });
  const tx: any = {
    storyProgressRouteNode: {
      findFirst: jest.fn(async ({ where }) => routeNodes.get(where.id)),
      create: jest.fn(async ({ data }) => {
        const row = { ...data, id: `node-${routeNodes.size}` };
        routeNodes.set(row.id, row);
        return row;
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ parent_id: null, source_shared_result_id: null }]),
    storyAiContinuation: {
      findUnique: jest.fn(async ({ where }) => {
        if (where.idempotencyKey) {
          return [...continuations.values()].find((row) => row.idempotencyKey === where.idempotencyKey) ?? null;
        }
        return continuations.get(where.id) ?? null;
      }),
      create: createContinuation,
      update: jest.fn(async ({ where, data }) => {
        const row = { ...continuations.get(where.id), ...data };
        continuations.set(where.id, row);
        return row;
      }),
    },
    storyReleaseCapability: { findUnique: jest.fn().mockResolvedValue(capability) },
    storyAiRateCard: { findUnique: jest.fn().mockResolvedValue(rateCard) },
    storyStyleProfileConsent: {
      findFirst: jest.fn().mockResolvedValue(consent),
      findUnique: jest.fn().mockResolvedValue(consent),
    },
    storyAnalysisJob: {
      findFirst: jest.fn().mockResolvedValue({ id: 'analysis-id', analysisVersion: 6 }),
    },
    contentRightsContract: {
      findFirst: jest.fn().mockResolvedValue({ id: 'contract-id', versions: [rights] }),
    },
    contentRightsContractVersion: { findUnique: jest.fn().mockResolvedValue(rights) },
    storyMemoryRecord: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'memory-id', memoryType: 'event', revision: 1, content: { ko: '승인된 기억' },
      }]),
    },
    storyChoiceEvent: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    storyScene: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'scene-id', partId: 'part-id' }),
      create: jest.fn(() => { throw new Error('canonical graph write'); }),
    },
    storyChoice: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(() => { throw new Error('canonical graph write'); }) },
    storyBeat: {
      findMany: jest.fn().mockResolvedValue([{
        position: 1, beatType: 'paragraph', content: { ko: '현재 공개 장면 본문' },
      }]),
      create: jest.fn(() => { throw new Error('canonical graph write'); }),
    },
    storyAiGeneratedScene: {
      findUnique: jest.fn(async ({ where }) => generatedScenes.find((scene) => scene.id === where.id)),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(async ({ data }) => {
        const row = { ...data, status: 'ready', id: `generated-${++generatedSequence}` };
        generatedScenes.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }) => {
        const row = generatedScenes.find((scene) => scene.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    storyAiGeneratedBeat: { findMany: jest.fn(async () => generatedBeats), create: jest.fn(async ({ data }) => generatedBeats.push(data)) },
    storyAiGeneratedChoice: { findFirst: jest.fn(async ({ where }) => generatedChoices.find((choice) => choice.id === where.id)),
      findMany: jest.fn(async () => generatedChoices), create: jest.fn(async ({ data }) => generatedChoices.push(data)) },
    storyAiAllowanceBucket: {
      findUnique: jest.fn(async ({ where }) => allowances[where.userId_releaseId.userId] ?? null),
      upsert: jest.fn(async ({ where, create }) => {
        const userId = where.userId_releaseId.userId;
        allowances[userId] ??= {
          ...create, id: `allowance-${userId}`, revision: 1,
          purchasedLimit: 0, reservedCount: 0, consumedCount: 0, compensatedCount: 0,
        };
        return { ...allowances[userId] };
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const bucket = Object.values(allowances).find((row: any) => row.id === where.id) as any;
        if (!bucket || (where.revision !== undefined && bucket.revision !== where.revision)) return { count: 0 };
        if (data.reservedCount?.increment) bucket.reservedCount += data.reservedCount.increment;
        if (data.reservedCount?.decrement) bucket.reservedCount -= data.reservedCount.decrement;
        if (data.consumedCount?.increment) bucket.consumedCount += data.consumedCount.increment;
        if (data.revision?.increment) bucket.revision += data.revision.increment;
        return { count: 1 };
      }),
    },
    storyReaderProgress: {
      findUnique: jest.fn(async ({ where }) => progresses[where.id]),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = progresses[where.id];
        if (!row || row.progressRevision !== where.progressRevision || row.status !== where.status) return { count: 0 };
        if (where.currentSceneId !== undefined && row.currentSceneId !== where.currentSceneId) return { count: 0 };
        if (where.currentGeneratedSceneId !== undefined && row.currentGeneratedSceneId !== where.currentGeneratedSceneId) return { count: 0 };
        Object.assign(row, data, {
          progressRevision: row.progressRevision + (data.progressRevision?.increment ?? 0),
        });
        return { count: 1 };
      }),
    },
    storyAiUsageLedger: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(async ({ data }) => { ledgers.push(data); return data; }),
    },
    storyAiReusableResult: {
      findFirst: jest.fn(async ({ where }) => sharedResult &&
        sharedResult.id === where.id &&
        sharedResult.workId === where.workId &&
        sharedResult.releaseId === where.releaseId &&
        sharedResult.status === where.status
        ? { id: sharedResult.id }
        : null),
      upsert: jest.fn(async ({ create }) => {
        sharedResult ??= { ...create, id: 'shared-id', status: 'pending', createdAt: now, updatedAt: now };
        return { ...sharedResult };
      }),
      findUnique: jest.fn(async () => sharedResult ? { ...sharedResult } : null),
      updateMany: jest.fn(async ({ where, data }) => {
        if (!sharedResult || sharedResult.id !== where.id || sharedResult.status !== where.status) return { count: 0 };
        if (where.claimToken !== undefined && sharedResult.claimToken !== where.claimToken) return { count: 0 };
        Object.assign(sharedResult, data);
        return { count: 1 };
      }),
    },
    storyAiReusableBeat: {
      create: jest.fn(async ({ data }) => { reusableBeats.push(data); return data; }),
      findMany: jest.fn(async () => reusableBeats),
    },
    storyAiReusableChoice: {
      create: jest.fn(async ({ data }) => { reusableChoices.push(data); return data; }),
      findMany: jest.fn(async () => reusableChoices),
    },
    storyRelease: { findUnique: jest.fn().mockResolvedValue(release) },
    storyWork: { findUnique: jest.fn().mockResolvedValue(work) },
    storyEndingDiscovery: { upsert: jest.fn() },
    storyCustomChoice: { update: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn(async (run) => run(tx)) };
  const provider = {
    readiness: jest.fn().mockResolvedValue({ enabled: true }),
    preflight: jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 500 }),
  };
  const legal = { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) };
  const approval = {
    prepare: jest.fn().mockResolvedValue({ eligible: true, reason: 'test_only', snapshot: evidence }),
    authorizeResult: jest.fn().mockResolvedValue(true),
  };
  const service = new StoryEconomicsService(prisma as never, legal as never, provider as never, approval as never);
  const input = (reader: 'reader-1' | 'reader-2') => ({
    userId: reader,
    progress: progresses[reader === 'reader-1' ? 'progress-1' : 'progress-2'],
    work: { id: 'work-id' }, part: { id: 'part-id' },
    scene: { id: 'scene-id', title: { ko: '공개 장면' } }, release,
    choice: {
      id: 'choice-id', sceneId: 'scene-id', label: { ko: '추천 B' },
      routeKind: 'generation_required', targetSceneId: null,
    },
    sourceKind: 'canonical' as const, locale: 'ko',
    idempotencyKey: `shared-result-${reader}`,
  });
  return {
    service, prisma, tx, provider, approval, input, continuations, progresses, allowances,
    generatedScenes, ledgers, reusableBeats, reusableChoices, capability, rights,
    getShared: () => sharedResult,
  };
}

describe('shared story result cache integration', () => {
  it('settles one paid generation, then reuses it for another reader with zero provider, allowance, or cost', async () => {
    const f = integrationFixture();
    const first = await f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-1'));
    const continuation = f.continuations.get(first.continuationId)!;
    Object.assign(continuation, {
      status: 'processing', leaseToken: 'lease-token',
      leaseExpiresAt: new Date(Date.now() + 60_000), attemptCount: 1,
    });
    await expect(f.service.settleContinuation(null, continuation.id, {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '검수된 공용 장면' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: '검수된 공용 본문' } }],
      resultVisualManifest: {
        sceneKey: `ai-${continuation.id}`,
        background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: '계속' } }],
    }, 'settle-shared-result', 'lease-token')).resolves.toMatchObject({ status: 'completed' });

    expect(f.getShared()).toMatchObject({
      status: 'pending', resultChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      originGeneratedSceneId: 'generated-1', reviewPendingAt: expect.any(Date),
      claimToken: null,
    });
    expect(f.reusableBeats).toHaveLength(0);
    expect(f.reusableChoices).toHaveLength(0);
    await expect(f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-2')))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING' } });
    // Explicit promotion has its own gate; settlement never fabricates evidence.
    f.tx.$queryRaw = jest.fn().mockResolvedValue([{ valid: true }]);
    f.tx.storyAiLegalActivation = { findUnique: jest.fn().mockResolvedValue({
      id: evidence.rightsActivationKey, rightsContractVersionId: 'rights-version-id',
    }) };
    f.tx.storyAiReusableResult.update = jest.fn(async ({ data }) => Object.assign(f.getShared(), data));
    const activation = new StoryAiActivationService(f.prisma as never);
    jest.spyOn(activation, 'prepare').mockResolvedValue({ id: evidence.rightsActivationKey } as never);
    await activation.promote('admin-id', f.getShared().id, f.getShared().resultChecksum);
    f.tx.$queryRaw = jest.fn().mockResolvedValue([{ parent_id: null, source_shared_result_id: null }]);
    expect(f.getShared().status).toBe('approved');
    const providerChecksAfterFirst = f.provider.readiness.mock.calls.length;
    const preflightChecksAfterFirst = f.provider.preflight.mock.calls.length;
    const allowanceWritesAfterFirst = f.tx.storyAiAllowanceBucket.updateMany.mock.calls.length;
    f.capability.includedAiRouteCount = 0;
    f.provider.readiness.mockResolvedValue({ enabled: false, reason: 'temporary_outage' });
    f.provider.preflight.mockRejectedValue(new Error('must not preflight an approved cache hit'));
    await expect(f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-2')))
      .resolves.toMatchObject({
        status: 'completed', provenance: 'ai_reused', allowanceRemaining: 0,
        resultGeneratedSceneId: 'generated-2',
      });

    expect(f.provider.readiness).toHaveBeenCalledTimes(providerChecksAfterFirst);
    expect(f.provider.preflight).toHaveBeenCalledTimes(preflightChecksAfterFirst);
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledTimes(allowanceWritesAfterFirst);
    expect(f.generatedScenes).toEqual([
      expect.objectContaining({ userId: 'reader-1', progressId: 'progress-1', provenance: 'ai_generated' }),
      expect.objectContaining({ userId: 'reader-2', progressId: 'progress-2', provenance: 'ai_reused', sharedResultId: 'shared-id' }),
    ]);
    expect(f.ledgers.at(-1)).toMatchObject({
      userId: 'reader-2', eventKind: 'shared_route_reused', provenance: 'ai_reused',
      inputTokens: 0, outputTokens: 0, estimatedCostKrw: 0, actualCostKrw: 0, allowanceDelta: 0,
    });
    expect(f.tx.storyScene.create).not.toHaveBeenCalled();
    expect(f.tx.storyBeat.create).not.toHaveBeenCalled();
    expect(f.tx.storyChoice.create).not.toHaveBeenCalled();
    await expect(f.service.recommendedChoiceReplay(
      'reader-2', 'progress-2', 'choice-id', 9, 'ko', 'shared-result-reader-2',
    )).resolves.toMatchObject({ provenance: 'ai_reused', idempotentReplay: true });
    await expect(f.service.recommendedChoiceReplay(
      'reader-2', 'progress-2', 'choice-id', 10, 'ko', 'shared-result-reader-2',
    )).rejects.toThrow('Recommended choice idempotency conflict');
    await expect(f.service.recommendedChoiceReplay(
      'reader-2', 'progress-2', 'choice-id', 9, 'en', 'shared-result-reader-2',
    )).rejects.toThrow('Recommended choice idempotency conflict');
  });

  it('holds a concurrent identical miss before provider readiness or allowance reservation', async () => {
    const f = integrationFixture();
    await f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-1'));
    const providerChecks = f.provider.readiness.mock.calls.length;
    const allowanceWrites = f.tx.storyAiAllowanceBucket.updateMany.mock.calls.length;
    await expect(f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-2')))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_PENDING', retryable: true } });
    expect(f.provider.readiness).toHaveBeenCalledTimes(providerChecks);
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledTimes(allowanceWrites);
  });

  it.each([
    ['private', null],
    ['revoked shared', 'revoked-shared-id'],
  ])('never publishes or hits shared storage from a %s generated source', async (_kind, sharedResultId) => {
    const f = integrationFixture();
    const input = f.input('reader-1') as any;
    Object.assign(input.progress, {
      currentSceneId: null,
      currentGeneratedSceneId: 'private-generated-scene',
    });
    input.sourceKind = 'generated';
    input.scene = {
      id: 'private-generated-scene', title: { ko: '개인 장면' }, sharedResultId,
    };
    input.choice = {
      id: 'private-generated-choice', sceneId: input.scene.id, choiceKey: 'private-next',
      label: { ko: '개인 경로 계속' }, routeKind: 'generation_required', targetSceneId: null,
    };
    f.tx.storyAiGeneratedBeat.findMany.mockResolvedValue([{
      position: 1, beatType: 'paragraph', content: { ko: '개인별 생성 본문' },
    }]);
    f.tx.storyScene.findMany.mockResolvedValue([{ id: 'scene-id' }]);
    await expect(f.service.requestRecommendedChoiceTx(f.tx, input))
      .resolves.toMatchObject({ status: 'queued', provenance: 'ai_generated' });
    expect(f.tx.storyAiReusableResult.upsert).not.toHaveBeenCalled();
    expect(f.provider.readiness).toHaveBeenCalledTimes(1);
  });

  it('blocks a revoked exact result before provider readiness and allowance reservation', async () => {
    const f = integrationFixture();
    f.tx.storyAiReusableResult.upsert.mockImplementationOnce(async ({ create }: any) => ({
      ...create, id: 'revoked-shared', status: 'revoked', claimToken: null,
      revokedAt: new Date(), revokeReason: 'rights_revoked',
    }));
    await expect(f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-1')))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_SHARED_RESULT_REVOKED' } });
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
  });

  it('does not hit or publish shared storage when generated-result reuse rights are off', async () => {
    const f = integrationFixture();
    f.rights.generatedResultReuseAllowed = false;
    await expect(f.service.requestRecommendedChoiceTx(f.tx, f.input('reader-1')))
      .resolves.toMatchObject({ status: 'queued', provenance: 'ai_generated' });
    expect(f.tx.storyAiReusableResult.upsert).not.toHaveBeenCalled();
    expect(f.provider.readiness).toHaveBeenCalledTimes(1);
  });
});

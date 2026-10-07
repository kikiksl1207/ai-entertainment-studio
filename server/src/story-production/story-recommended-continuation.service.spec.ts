import { ForbiddenException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';
import { STORY_CONTINUATION_PROMPT_VERSION } from './story-continuation-openai.schema';
import { STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import {
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';

function memoryQuery(rows: Array<{ id: string; memoryType: string; partKey: string | null; revision: number; content: unknown }>) {
  return async ({ where, take }: { where: {
    memoryType: string | { in: string[] };
    partKey?: { in: string[] };
    OR?: Array<{ partKey: null | { notIn: string[] } }>;
  }; take: number }) => rows.filter((row) => {
    const types = typeof where.memoryType === 'string' ? [where.memoryType] : where.memoryType.in;
    if (!types.includes(row.memoryType)) return false;
    if (where.partKey?.in && !where.partKey.in.includes(row.partKey ?? '')) return false;
    const excluded = where.OR?.find((entry) => entry.partKey && typeof entry.partKey === 'object')?.partKey;
    return !excluded || typeof excluded !== 'object' || row.partKey === null ||
      !excluded.notIn.includes(row.partKey);
  }).slice(0, take);
}

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
    storyMemoryRecord: { findMany: jest.fn(memoryQuery([
      { id: 'memory-id', memoryType: 'event', partKey: 'part-1', revision: 1, content: { summary: 'bounded' } },
    ])) },
    storyPart: { findMany: jest.fn().mockResolvedValue([{ id: 'part-id' }]) },
    storyChoiceEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'event-id', sceneId: 'prior', choiceId: 'prior-choice', targetSceneId: 'scene-id' }]) },
    storyScene: { findMany: jest.fn().mockImplementation(async (query) => query.where?.sceneKey
      ? [{ sceneKey: 'part-1-main' }]
      : [{ id: 'opening', title: { ko: '이전 장면' }, endingType: null }]) },
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
    work: { id: 'work-id' }, part: { id: 'part-id', position: 1 },
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
  it.each([
    ['missing previous scene', 'STORY_AI_CONTEXT_PART_UNAVAILABLE'],
    ['missing previous choice', 'STORY_AI_CONTEXT_PART_UNAVAILABLE'],
    ['unrelated previous choice', 'STORY_AI_CONTEXT_PART_UNAVAILABLE'],
    ['missing previous title locale', 'STORY_AI_CONTEXT_LOCALE_UNAVAILABLE'],
    ['missing previous choice locale', 'STORY_AI_CONTEXT_LOCALE_UNAVAILABLE'],
  ])('rejects unavailable prior route context: %s before reservation', async (kind, code) => {
    const f = fixture();
    if (kind === 'missing previous scene') f.tx.storyScene.findMany.mockResolvedValue([]);
    if (kind === 'missing previous choice') f.tx.storyChoice.findMany.mockResolvedValue([]);
    if (kind === 'unrelated previous choice') f.tx.storyChoice.findMany.mockResolvedValue([
      { id: 'choice-a', sceneId: 'unrelated', label: { ko: 'Synthetic' } },
    ]);
    if (kind === 'missing previous title locale') f.tx.storyScene.findMany.mockResolvedValue([
      { id: 'opening', sceneKey: 'part-1-main', title: { en: 'Synthetic' }, endingType: null },
    ]);
    if (kind === 'missing previous choice locale') f.tx.storyChoice.findMany.mockResolvedValue([
      { id: 'choice-a', sceneId: 'opening', label: { en: 'Synthetic' } },
    ]);
    const result = f.service.requestRecommendedChoiceTx(f.tx as never, f.input);
    await expect(result).rejects.toMatchObject({
      response: { code, retryable: false, progressMutated: false, generationStarted: false },
    });
    await expect(result).rejects.toBeInstanceOf(ForbiddenException);
    try { await result; } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        messageKey: 'story.progress.aiGeneration.contextUnavailable',
      });
    }
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('keeps unexpected prior-route database failures distinct from domain rejections', async () => {
    const f = fixture(), failure = new Error('synthetic_database_unavailable');
    f.tx.storyChoice.findMany.mockRejectedValue(failure);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toBe(failure);
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiUsageLedger.create).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it.each(['missing generated source', 'missing generated arrival'])('rejects unavailable generated prior route context: %s', async kind => {
    const f = fixture();
    Object.assign(f.input.progress, { pathSummary: [{ sourceGeneratedSceneId: 'prior-generated',
      generatedSceneId: 'missing-arrival', choiceId: 'generated-choice' }] });
    if (kind === 'missing generated arrival') {
      f.tx.storyAiGeneratedScene.findMany.mockResolvedValue([{ id: 'prior-generated', title: { ko: 'Synthetic' }, endingType: null }]);
      f.tx.storyAiGeneratedChoice.findMany.mockResolvedValue([{ id: 'generated-choice', sceneId: 'prior-generated', label: { ko: 'Synthetic' } }]);
    }
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toMatchObject({
      response: { code: 'STORY_AI_CONTEXT_PART_UNAVAILABLE', generationStarted: false, progressMutated: false },
    });
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

  it('keeps non-Error prior-route failures distinct from domain rejections', async () => {
    const f = fixture(), failure = 'synthetic_non_error_failure';
    f.tx.storyChoice.findMany.mockRejectedValue(failure);
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toBe(failure);
    expect(f.createContinuation).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.tx.storyReaderProgress.updateMany).not.toHaveBeenCalled();
  });

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

  it('does not treat an authored rejoin declaration as permission for generated alternatives', async () => {
    const f = fixture();
    Object.assign(f.input.choice, { declaredRejoinSceneId: 'authored-rejoin-scene' });
    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input))
      .rejects.toThrow('Choice is not eligible for generated continuation');
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('treats skipped author-route parts as plans, not reached facts', async () => {
    const f = fixture();
    f.input.part.position = 3;
    f.tx.storyChoiceEvent.findMany.mockResolvedValue([{ sceneId: 'opening', targetSceneId: 'scene-id' }]);
    f.tx.storyPart.findMany.mockResolvedValue([{ id: 'part-1-id' }, { id: 'part-2-id' }, { id: 'part-id' }]);
    f.tx.storyScene.findMany.mockImplementation(async (query) => query.where?.sceneKey
      ? [{ id: 'opening', sceneKey: 'part-1-main' }, { id: 'scene-id', sceneKey: 'part-3-main' }]
      : [{ id: 'opening', title: { ko: '이전 장면' }, endingType: null }]);
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery([
      { id: 'past', memoryType: 'event', partKey: 'part-1', revision: 1, content: { ko: '지난 사건' } },
      { id: 'skipped', memoryType: 'event', partKey: 'part-2', revision: 1, content: { ko: '가지 않은 길의 사건' } },
      { id: 'current', memoryType: 'event', partKey: 'part-3', revision: 1, content: { ko: '현재 사건' } },
      { id: 'future', memoryType: 'foreshadow', partKey: 'part-4', revision: 1, content: { ko: '아직 모를 비밀' } },
      { id: 'style', memoryType: 'style', partKey: 'part-4', revision: 1, content: { ko: '절제된 문장' } },
    ]));
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });
    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);
    const request = f.provider.preflight.mock.calls[0][0];
    expect(request.approvedContext.memories).toEqual([
      { memoryType: 'style', content: '절제된 문장' },
      { memoryType: 'event', content: '지난 사건' },
      { memoryType: 'event', content: '현재 사건' },
      { memoryType: 'author_plan_event', content: '가지 않은 길의 사건' },
      { memoryType: 'author_plan_foreshadow', content: '아직 모를 비밀' },
    ]);
    expect(f.tx.storyPart.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ position: { lte: 3 } }),
    }));
    expect(f.tx.storyScene.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['scene-id', 'opening'] } }),
    }));
    expect(f.tx.storyMemoryRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ memoryType: 'style' }),
    }));
    expect(f.createContinuation.mock.calls[0][0].data.contextReferences.memoryPins)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'past' }),
        expect.objectContaining({ id: 'skipped' }), expect.objectContaining({ id: 'future' }),
        expect.objectContaining({ id: 'style' })]));
    expect(f.createContinuation.mock.calls[0][0].data.contextReferences.planningMemoryIds).toEqual(['skipped', 'future']);
  });

  it('keeps a future payoff hinted in a reached part out of established route facts', async () => {
    const f = fixture();
    f.tx.storyScene.findMany.mockImplementation(async (query) => query.where?.sceneKey
      ? [{ id: 'scene-id', sceneKey: 'part-1-main' }]
      : [{ id: 'opening', title: { ko: '이전 장면' }, endingType: null }]);
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery([
      { id: 'alive', memoryType: 'event', partKey: 'part-1', revision: 1,
        content: { ko: '어머니는 살아 있으며 딸을 배웅한다.' } },
      { id: 'hint', memoryType: 'foreshadow', partKey: 'part-1', revision: 1,
        content: { ko: '원작 32부에서 어머니가 죽는다. 1부에 복선을 둔다.' } },
      { id: 'style', memoryType: 'style', partKey: 'part-1', revision: 1,
        content: { ko: '윤해원의 1인칭 감각 서술' } },
    ]));
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });

    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);

    expect(f.provider.preflight.mock.calls[0][0].approvedContext.memories).toEqual([
      { memoryType: 'style', content: '윤해원의 1인칭 감각 서술' },
      { memoryType: 'event', content: '어머니는 살아 있으며 딸을 배웅한다.' },
      { memoryType: 'author_plan_foreshadow', content: '원작 32부에서 어머니가 죽는다. 1부에 복선을 둔다.' },
    ]);
    expect(f.createContinuation.mock.calls[0][0].data.contextReferences.planningMemoryIds).toEqual(['hint']);
  });

  it('uses active choice events to retain reached facts beyond the bounded path summary', async () => {
    const f = fixture();
    f.input.part.position = 3;
    f.input.progress.pathSummary = [];
    f.tx.storyChoiceEvent.findMany.mockResolvedValue([{ sceneId: 'old-scene', targetSceneId: null }]);
    f.tx.storyPart.findMany.mockResolvedValue([{ id: 'part-1-id' }, { id: 'part-2-id' }, { id: 'part-id' }]);
    f.tx.storyScene.findMany.mockImplementation(async (query) => query.where?.sceneKey
      ? [{ id: 'old-scene', sceneKey: 'part-1-main' }, { id: 'scene-id', sceneKey: 'part-3-main' }]
      : []);
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery([
      { id: 'old', memoryType: 'event', partKey: 'part-1', revision: 1, content: { ko: '오래전에 겪은 사건' } },
      { id: 'skipped', memoryType: 'event', partKey: 'part-2', revision: 1, content: { ko: '건너뛴 사건' } },
    ]));
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });

    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);

    expect(f.tx.storyChoiceEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { progressId: 'progress-id', invalidatedAt: null },
    }));
    expect(f.provider.preflight.mock.calls[0][0].approvedContext.memories).toEqual([
      { memoryType: 'event', content: '오래전에 겪은 사건' },
      { memoryType: 'author_plan_event', content: '건너뛴 사건' },
    ]);
  });

  it('prioritizes recently visited part memories on a long reader route', async () => {
    const f = fixture();
    f.input.part.position = 20;
    f.tx.storyPart.findMany.mockResolvedValue(Array.from({ length: 20 }, (_, index) => ({
      id: index === 19 ? 'part-id' : `part-${index + 1}-id`,
    })));
    f.tx.storyChoiceEvent.findMany.mockResolvedValue(Array.from({ length: 19 }, (_, index) => ({
      sceneId: `scene-${19 - index}`,
      targetSceneId: null,
    })));
    f.tx.storyScene.findMany.mockImplementation(async (query) => query.where?.sceneKey
      ? [
          { id: 'scene-id', sceneKey: 'part-20-main' },
          ...Array.from({ length: 19 }, (_, index) => ({
            id: `scene-${index + 1}`, sceneKey: `part-${index + 1}-main`,
          })),
        ]
      : [{ id: 'opening', title: { ko: '이전 장면' }, endingType: null }]);
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery(Array.from({ length: 20 }, (_, index) => ({
      id: `event-${index + 1}`, memoryType: 'event', partKey: `part-${index + 1}`,
      revision: 1, content: { ko: `지난 사건 ${index + 1}` },
    }))));
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });

    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);

    const reachedQuery = f.tx.storyMemoryRecord.findMany.mock.calls.find(([query]) => query.where?.partKey?.in);
    const queriedKeys = reachedQuery?.[0].where.partKey?.in ?? [];
    expect(queriedKeys).toContain('part-20');
    expect(queriedKeys).not.toContain('part-1');
    const memories = f.provider.preflight.mock.calls[0][0].approvedContext.memories;
    expect(memories).toContainEqual({ memoryType: 'event', content: '지난 사건 20' });
    expect(memories).not.toContainEqual({ memoryType: 'author_plan_event', content: '지난 사건 1' });
  });

  it('reserves author-style samples even when a long work has many event memories', async () => {
    const f = fixture();
    const styles = Array.from({ length: 8 }, (_, index) => ({
      id: `style-${index + 1}`, memoryType: 'style', partKey: `part-${index + 1}`,
      revision: 1, content: { ko: `문체 표본 ${index + 1}` },
    }));
    const events = Array.from({ length: 60 }, (_, index) => ({
      id: `event-${index + 1}`, memoryType: 'event', partKey: `part-${index + 2}`,
      revision: 1, content: { ko: `원작 사건 ${index + 1}` },
    }));
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery([...events, ...styles]));
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: true, inputTokenUpperBound: 900 });

    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);

    const memories = f.provider.preflight.mock.calls[0][0].approvedContext.memories;
    expect(memories.filter((memory: { memoryType: string }) => memory.memoryType === 'style'))
      .toEqual([
        { memoryType: 'style', content: '문체 표본 1' },
        { memoryType: 'style', content: '문체 표본 4' },
        { memoryType: 'style', content: '문체 표본 8' },
      ]);
    expect(memories.length).toBeLessThanOrEqual(50);
  });

  it('fails closed before reservation when the source part order cannot be verified', async () => {
    const missingPosition = fixture();
    (missingPosition.input.part as { position?: number }).position = undefined;
    await expect(missingPosition.service.requestRecommendedChoiceTx(missingPosition.tx as never, missingPosition.input))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_CONTEXT_PART_UNAVAILABLE' } });
    expect(missingPosition.tx.storyPart.findMany).not.toHaveBeenCalled();
    expect(missingPosition.createContinuation).not.toHaveBeenCalled();

    const missingCurrentPart = fixture();
    missingCurrentPart.tx.storyPart.findMany.mockResolvedValue([{ id: 'different-part' }]);
    await expect(missingCurrentPart.service.requestRecommendedChoiceTx(missingCurrentPart.tx as never, missingCurrentPart.input))
      .rejects.toMatchObject({ response: { code: 'STORY_AI_CONTEXT_PART_UNAVAILABLE' } });
    expect(missingCurrentPart.createContinuation).not.toHaveBeenCalled();
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
      styleConsentRevision: 3, promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
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
    expect(data.contextReferences.generationProfileViewVersion).toBe(STORY_CONTINUATION_PROFILE_VIEW_VERSION);
    expect(f.provider.preflight).toHaveBeenCalledWith(expect.objectContaining({
      approvedContext: expect.objectContaining({
        generationProfile: expect.objectContaining({
          sections: expect.arrayContaining([
            { key: 'writing_style', value: { summary: 'writing_style approved', referenceScope: 'production_constraint' } },
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

  it('blocks a completed semantic analysis when its creator profile is missing', async () => {
    const f = fixture();
    Object.assign(f.tx, {
      storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    f.tx.storyAnalysisJob.findFirst.mockResolvedValue({
      id: 'semantic-id', pipeline: 'semantic_extraction_v1', analysisVersion: 8,
    });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toMatchObject({
      response: { code: 'STORY_GENERATION_PROFILE_APPROVAL_REQUIRED' },
    });
    expect(f.tx.storyAiAllowanceBucket.upsert).not.toHaveBeenCalled();
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('keeps a published legacy route available while a completed semantic profile awaits review', async () => {
    const f = fixture();
    const pending = {
      ...approvedProfile(), analysisJobId: 'semantic-id', status: 'needs_review',
      approvedFingerprint: null, approvedSettings: null,
    };
    Object.assign(f.tx, {
      storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(null) },
    });
    f.tx.storyAnalysisJob.findFirst
      .mockResolvedValueOnce({ id: 'semantic-id', pipeline: 'semantic_extraction_v1', analysisVersion: 8 })
      .mockResolvedValueOnce({ id: 'analysis-id', pipeline: 'publication_style_snapshot_v1', analysisVersion: 7 });

    await f.service.requestRecommendedChoiceTx(f.tx as never, f.input);

    expect(f.tx.storyAnalysisJob.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({
        status: 'completed', pipeline: { not: 'semantic_extraction_v1' },
        analysisVersion: { lt: 8 },
      }),
    }));
    expect(f.createContinuation.mock.calls[0][0].data).toMatchObject({
      analysisJobId: 'analysis-id', analysisVersion: 7,
    });
    expect(f.createContinuation.mock.calls[0][0].data.contextReferences).not.toHaveProperty('generationProfilePin');
  });

  it('fails closed when an unapproved semantic profile has no previous published analysis', async () => {
    const f = fixture();
    Object.assign(f.tx, {
      storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValueOnce({
        ...approvedProfile(), analysisJobId: 'semantic-id', status: 'needs_review',
        approvedFingerprint: null, approvedSettings: null,
      }).mockResolvedValueOnce(null) },
    });
    f.tx.storyAnalysisJob.findFirst
      .mockResolvedValueOnce({ id: 'semantic-id', pipeline: 'semantic_extraction_v1', analysisVersion: 1 })
      .mockResolvedValueOnce(null);

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toMatchObject({
      response: { code: 'STORY_AI_GENERATION_NOT_AUTHORIZED' },
    });
    expect(f.createContinuation).not.toHaveBeenCalled();
  });

  it('does not downgrade a revised semantic profile that was previously approved', async () => {
    const f = fixture();
    Object.assign(f.tx, {
      storyWorkGenerationProfile: { findFirst: jest.fn()
        .mockResolvedValueOnce({
          ...approvedProfile(), analysisJobId: 'semantic-id', status: 'needs_review',
          approvedFingerprint: null, approvedSettings: null,
        })
        .mockResolvedValueOnce({ id: 'earlier-approved-semantic-profile' }) },
    });
    f.tx.storyAnalysisJob.findFirst.mockResolvedValueOnce({
      id: 'semantic-id', pipeline: 'semantic_extraction_v1', analysisVersion: 8,
    });

    await expect(f.service.requestRecommendedChoiceTx(f.tx as never, f.input)).rejects.toMatchObject({
      response: { code: 'STORY_GENERATION_PROFILE_APPROVAL_REQUIRED' },
    });
    expect(f.tx.storyAnalysisJob.findFirst).toHaveBeenCalledTimes(1);
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
    f.tx.storyMemoryRecord.findMany.mockImplementation(memoryQuery([{
      id: 'memory-id', memoryType: 'event', partKey: 'part-1', revision: 1, content: { summary: '다'.repeat(5000) },
    }]));
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
  it('rejects an unversioned sibling context before any paid provider call', async () => {
    const prisma = { storyAiContinuation: { findUnique: jest.fn().mockResolvedValue({
      status: 'processing', leaseToken: 'lease-token', requestKind: 'recommended_choice',
      siblingContextKey: null, siblingChoiceKey: null,
    }) } };
    const service = new StoryEconomicsService(prisma as never);
    await expect(service.continuationExecutionAuthorization({
      continuationId: 'continuation-id', leaseToken: 'lease-token',
      attemptCount: 1, maxAttempts: 3, request: {} as never,
    })).resolves.toEqual({ allowed: false, code: 'continuation_sibling_context_unavailable' });
  });

  it('fails closed before provider execution when nullable analysis, rights, or manuscript pins are absent', async () => {
    const now = new Date();
    const continuation = {
      id: 'continuation-id', requestKind: 'recommended_choice', status: 'processing',
      leaseToken: 'lease-token', userId: 'reader-id', workId: 'work-id',
      releaseId: 'release-id', rateCardId: 'rate-id', styleConsentId: 'consent-id',
      capabilityRevision: 2, styleConsentRevision: 3, locale: 'ko',
      manuscriptVersionId: null, analysisJobId: null, analysisVersion: null,
      rightsContractId: null, rightsContractVersionId: null, releaseChecksum: 'checksum',
      siblingContextKey: 'a'.repeat(64), siblingChoiceKey: 'b'.repeat(64),
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

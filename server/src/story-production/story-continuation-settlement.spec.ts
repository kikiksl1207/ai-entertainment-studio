import { Decimal } from '@prisma/client/runtime/library';
import { StoryEconomicsService } from './story-economics.service';
import {
  continuationGenerationProfileSnapshot,
  continuationMemoryPins,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
} from './story-continuation-context.policy';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';

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
    siblingContextKey: 'a'.repeat(64), siblingChoiceKey: 'b'.repeat(64),
    leaseExpiresAt: new Date(now.getTime() + 60_000), inputTokenLimit: 1000,
    outputTokenLimit: 500, hardBudgetKrw: new Decimal(10), estimatedCostKrw: new Decimal(0),
    contextReferences: { memoryPins: [] } as Record<string, unknown>,
  };
  const progress = {
    id: 'progress-id', userId: 'reader-id', workId: 'work-id', activeReleaseId: 'release-id',
    currentSceneId: 'scene-id', currentGeneratedSceneId: null, progressRevision: 10,
    currentBeatPosition: 3,
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
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    storyMemoryRecord: { findMany: jest.fn().mockResolvedValue([]) },
    storyAiGeneratedScene: { create: generatedSceneCreate, findFirst: jest.fn() },
    storyAiGeneratedBeat: { create: jest.fn() },
    storyAiGeneratedChoice: { create: jest.fn() },
    storyChoiceEvent: { create: jest.fn() },
    storyEndingDiscovery: { upsert: jest.fn() },
    storyAiUsageLedger: { create: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    storyCustomChoice: { update: jest.fn() },
    auditEvent: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ sibling_choice_key: 'b'.repeat(64) }]),
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (run) => run(tx)),
  };
  const service = new StoryEconomicsService(
    prisma as never,
    { authorize: jest.fn().mockResolvedValue({ active: true, reason: 'test_only' }) } as never,
  );
  return { service, tx, generatedSceneCreate, canonicalCreate, continuation, progress };
}

function approveAuthorContext(f: ReturnType<typeof fixture>) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: 'accepted', value: { summary: `${key} author constraint` }, evidence: [],
    })),
  });
  const profile = {
    id: 'profile-id', status: 'approved', profileVersion: 1, reviewRevision: 1,
    manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id',
    sourceFingerprint: 'c'.repeat(64), approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint('c'.repeat(64), settings),
  };
  const memories = [{ id: '00000000-0000-4000-8000-000000000001', revision: 1, content: { ko: 'Author style reference.' } }];
  f.continuation.contextReferences = {
    generationProfilePin: continuationGenerationProfileSnapshot(profile as never).pin,
    generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
    memoryPins: continuationMemoryPins(memories),
  };
  f.tx.storyWorkGenerationProfile.findFirst.mockResolvedValue(profile);
  f.tx.storyMemoryRecord.findMany.mockResolvedValue(memories);
  return { profile, memories };
}

function completedResult() {
  return {
    status: 'completed' as const, moderationDecision: 'allow' as const, actualCostKrw: 0,
    inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
    resultTitle: { ko: 'Author-bound scene' },
    resultBeats: [{ beatType: 'paragraph', content: { ko: 'Offline result.' } }],
    resultVisualManifest: {
      sceneKey: 'ai-continuation-id', background: { state: 'fallback', altKey: 'story.visual.fallback' },
      characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
    },
    nextChoices: [{ choiceKey: 'next', label: { ko: 'Continue' } }],
  };
}

describe('recommended continuation overlay settlement', () => {
  it.each(['approved', 'needs_review'])
  ('rejects an unpinned legacy result once its new semantic profile has been approved: %s', async status => {
    const f = fixture();
    const { profile } = approveAuthorContext(f);
    delete f.continuation.contextReferences.generationProfilePin;
    Object.assign(profile, { analysisJobId: 'semantic-analysis', status });
    f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(async ({ where }) =>
      where.status === 'approved' ? { id: 'previous-approved-semantic-profile' } as never : profile);
    f.tx.storyAnalysisJob.findFirst.mockImplementation(async query => query.orderBy
      ? { id: 'semantic-analysis', analysisVersion: 5, pipeline: 'semantic_extraction_v1' } as never
      : { id: 'analysis-id', analysisVersion: 4, pipeline: 'structural_legacy' } as never);
    await expect(f.service.settleContinuation(null, 'continuation-id', completedResult(),
      `unpinned-after-approval-${status}`, 'lease-token')).resolves.toMatchObject({ status: 'failed' });
    expect(f.generatedSceneCreate).not.toHaveBeenCalled();
  });

  it('preserves an unpinned legacy route while its first newer semantic profile is still awaiting review', async () => {
    const f = fixture();
    const { profile } = approveAuthorContext(f);
    delete f.continuation.contextReferences.generationProfilePin;
    Object.assign(profile, { analysisJobId: 'semantic-analysis', status: 'needs_review' });
    f.tx.storyWorkGenerationProfile.findFirst.mockImplementation(async ({ where }) =>
      where.status === 'approved' ? null : profile);
    f.tx.storyAnalysisJob.findFirst.mockImplementation(async query => query.orderBy
      ? { id: 'semantic-analysis', analysisVersion: 5, pipeline: 'semantic_extraction_v1' } as never
      : { id: 'analysis-id', analysisVersion: 4, pipeline: 'structural_legacy' } as never);
    await expect(f.service.settleContinuation(null, 'continuation-id', completedResult(),
      'unpinned-first-review', 'lease-token')).resolves.toMatchObject({ status: 'completed' });
  });

  it.each(['revision', 'new_draft', 'withdrawn', 'settings', 'missing_memory', 'memory_revision',
    'memory_content', 'malformed_memory', 'duplicate_memory', 'malformed_profile', 'view_version',
    'analysis', 'semantic_missing_profile', 'missing_memory_pins', 'invalid_memory_id'])
  ('rejects a stale or malformed author context after provider completion: %s', async (change) => {
    const f = fixture();
    const { profile, memories } = approveAuthorContext(f);
    if (change === 'revision') profile.reviewRevision = 2;
    if (change === 'new_draft') Object.assign(profile, { id: 'new-profile', profileVersion: 2, status: 'needs_review' });
    if (change === 'withdrawn') profile.status = 'needs_review';
    if (change === 'settings') profile.approvedSettings.sections[0].value.summary = 'Unapproved rewrite';
    if (change === 'missing_memory') f.tx.storyMemoryRecord.findMany.mockResolvedValue([]);
    if (change === 'memory_revision') memories[0].revision = 2;
    if (change === 'memory_content') memories[0].content.ko = 'Changed author reference';
    if (change === 'malformed_memory') f.continuation.contextReferences.memoryPins = [{ id: 'memory-id' }];
    if (change === 'duplicate_memory') {
      const pins = f.continuation.contextReferences.memoryPins as unknown[];
      pins.push(pins[0]);
    }
    if (change === 'malformed_profile') f.continuation.contextReferences.generationProfilePin = {};
    if (change === 'view_version') f.continuation.contextReferences.generationProfileViewVersion = 'old-view';
    if (change === 'analysis') profile.analysisJobId = 'other-analysis';
    if (change === 'semantic_missing_profile') {
      delete f.continuation.contextReferences.generationProfilePin;
      f.tx.storyAnalysisJob.findFirst.mockResolvedValue({ id: 'analysis-id', analysisVersion: 4,
        pipeline: 'semantic_extraction_v1' } as never);
    }
    if (change === 'missing_memory_pins') delete f.continuation.contextReferences.memoryPins;
    if (change === 'invalid_memory_id') {
      (f.continuation.contextReferences.memoryPins as Array<{ id: string }>)[0].id = 'not-a-uuid';
    }
    await expect(f.service.settleContinuation(null, 'continuation-id', completedResult(),
      `stale-author-${change}`, 'lease-token')).resolves.toMatchObject({ status: 'failed' });
    expect(f.generatedSceneCreate).not.toHaveBeenCalled();
    expect(f.tx.storyAiContinuation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'failed', failureCode: 'generation_authorization_changed' }),
    }));
    expect(f.tx.storyAiUsageLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'failed', inputTokens: 10, outputTokens: 10, allowanceDelta: 0, progressApplied: false,
    }) });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ failureCode: 'generation_authorization_changed' }),
    }) });
  });

  it('still accepts the unchanged approved author context', async () => {
    const f = fixture();
    approveAuthorContext(f);
    await expect(f.service.settleContinuation(null, 'continuation-id', completedResult(),
      'unchanged-author', 'lease-token')).resolves.toMatchObject({ status: 'completed' });
  });

  it('keeps measured cost but returns the reader use when author approval changed', async () => {
    const f = fixture();
    approveAuthorContext(f).profile.reviewRevision = 2;
    f.tx.storyAiRateCard.findUnique.mockResolvedValue({
      id: 'rate-id', version: 'test-v1', provider: 'test-double', model: 'none',
      inputCostPerMillion: new Decimal(100_000), outputCostPerMillion: new Decimal(100_000),
      cachedInputCostPerMillion: new Decimal(100_000), imageUnitCost: new Decimal(0),
    });
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      ...completedResult(), actualCostKrw: 2,
    }, 'changed-author-cost', 'lease-token')).resolves.toMatchObject({ status: 'failed' });
    expect(f.tx.storyAiUsageLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      actualCostKrw: 2, allowanceDelta: 0, progressApplied: false,
    }) });
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reservedCount: { decrement: 1 }, consumedCount: undefined }),
    }));
  });

  it('allows failed work to release its reservation even when its author pins are invalid', async () => {
    const f = fixture();
    f.continuation.contextReferences = { memoryPins: 'invalid' };
    await expect(f.service.failClaimedContinuation({ continuationId: 'continuation-id',
      leaseToken: 'lease-token' } as never, 'provider_outcome_unknown', 'failed', {
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
    })).resolves.toMatchObject({ status: 'failed' });
    expect(f.tx.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    expect(f.tx.storyMemoryRecord.findMany).not.toHaveBeenCalled();
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      metadata: expect.objectContaining({ failureCode: 'provider_outcome_unknown' }),
    }) });
  });

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
    expect(f.tx.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('persists the source generated scene read cursor before entering the new scene', async () => {
    const f = fixture();
    Object.assign(f.continuation, {
      sourceSceneId: null, recommendedChoiceId: null,
      sourceGeneratedSceneId: 'prior-generated-scene', generatedChoiceId: 'generated-choice-id',
    });
    Object.assign(f.progress, {
      currentSceneId: null, currentGeneratedSceneId: 'prior-generated-scene',
      currentBeatPosition: 2, pathSummary: [{ generatedSceneId: 'prior-generated-scene' }],
    });
    f.tx.storyAiGeneratedScene.findFirst.mockResolvedValue({ id: 'prior-generated-scene', sourcePartId: 'part-id' });
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '다음 장면' },
      resultBeats: [{ beatType: 'dialogue', content: { ko: '윤세린: 다음 장면의 대사.' } }],
      resultVisualManifest: {
        sceneKey: 'ai-continuation-id',
        background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: '계속' } }],
    }, 'generated-source-settlement', 'lease-token')).resolves.toMatchObject({ status: 'completed' });
    expect(f.tx.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ currentBeatPosition: 0, pathSummary: [
        { generatedSceneId: 'prior-generated-scene' },
        expect.objectContaining({ sourceGeneratedSceneId: 'prior-generated-scene',
          readBeatPosition: 2, generatedSceneId: 'generated-scene-id' }),
      ] }),
    }));
  });

  it('fails before scene creation when another sibling owns the exact narrative claim', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockResolvedValue([]);
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '같은 장면' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: '같은 사건.' } }],
      resultVisualManifest: {
        sceneKey: 'ai-continuation-id', background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [{ choiceKey: 'next', label: { ko: '계속' } }],
    }, 'duplicate-settlement-key', 'lease-token')).rejects.toMatchObject({
      code: 'continuation_sibling_narrative_duplicate',
    });
    expect(f.generatedSceneCreate).not.toHaveBeenCalled();
    expect(f.tx.storyAiAllowanceBucket.updateMany).not.toHaveBeenCalled();
  });

  it('restores the source reading position when generation fails', async () => {
    const f = fixture();
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      status: 'failed', moderationDecision: 'reject',
      inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, imageUnits: 0,
      failureCode: 'provider_incomplete_output',
    }, 'failed-settlement-key', 'lease-token')).resolves.toMatchObject({ status: 'failed' });
    expect(f.tx.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currentSceneId: 'scene-id', currentBeatPosition: 3, status: 'active',
      }),
    }));
    expect(f.generatedSceneCreate).not.toHaveBeenCalled();
  });

  it('records measured provider cost for a rejected scene without consuming a reader use', async () => {
    const f = fixture();
    f.tx.storyAiRateCard.findUnique.mockResolvedValue({
      id: 'rate-id', version: 'test-v1', provider: 'test-double', model: 'none',
      inputCostPerMillion: new Decimal(1_000_000),
      outputCostPerMillion: new Decimal(1_000_000),
      cachedInputCostPerMillion: new Decimal(1_000_000),
      imageUnitCost: new Decimal(0),
    });
    await expect(f.service.failClaimedContinuation({
      continuationId: 'continuation-id', leaseToken: 'lease-token',
    } as never, 'continuation_invalid_calendar_date', 'failed', {
      inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, imageUnits: 0,
    })).resolves.toMatchObject({ status: 'failed' });
    expect(f.tx.storyAiUsageLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'failed', inputTokens: 10, outputTokens: 20, actualCostKrw: 30,
      allowanceDelta: 0, progressApplied: false,
    }) });
    expect(f.tx.storyAiAllowanceBucket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reservedCount: { decrement: 1 }, consumedCount: undefined }),
    }));
    expect(f.generatedSceneCreate).not.toHaveBeenCalled();
  });

  it('keeps a generated ending scene readable after completion', async () => {
    const f = fixture();
    await expect(f.service.settleContinuation(null, 'continuation-id', {
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: { ko: '독자 엔딩' },
      resultBeats: [{ beatType: 'paragraph', content: { ko: '마침내 이야기가 끝났다.' } }],
      resultVisualManifest: {
        sceneKey: 'ai-continuation-id',
        background: { state: 'fallback', altKey: 'story.visual.fallback' },
        characters: [],
        fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.visual.fallback' },
      },
      nextChoices: [], ending: { endingKey: 'ai-reader-ending' },
    }, 'ending-settlement-key', 'lease-token')).resolves.toMatchObject({ status: 'completed' });
    expect(f.tx.storyReaderProgress.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        currentSceneId: null,
        currentGeneratedSceneId: 'generated-scene-id',
        currentBeatPosition: 0,
        status: 'completed',
      }),
    }));
  });
});

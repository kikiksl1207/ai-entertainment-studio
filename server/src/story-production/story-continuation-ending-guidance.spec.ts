import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import {
  continuationExecutionFingerprint,
  continuationGenerationProfileSnapshot,
  continuationHash,
  continuationMemoryPins,
  continuationPathHash,
  continuationSourceHash,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
} from './story-continuation-context.policy';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { buildStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';
import type { StoryContinuationClaim, StoryContinuationQueueRepository } from './story-continuation.repository';
import { STORY_CONTINUATION_ROUTE_VIEW_VERSION } from './story-continuation-route-continuity';

const config: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'guidance-fixture-card', rateCardVersion: 'fixture-v1', apiKey: 'fake-test-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};
const endingTail = 'APPROVED_ENDING_TAIL: Resolve this branch only after its selected promise is paid off; never force the canonical ending.';
const fullSummary = `  ${'Retain the chosen consequences and adapt future plans to the active branch. '.repeat(9)}\n\n${endingTail}  `;
const futureEnding = 'AUTHOR_FUTURE_ENDING: In the planned final chapter, the unopened observatory is destroyed.';
const unpaidStop = 'unpaid_guidance_probe_stop';

function approvedProfile(summary = fullSummary) {
  const approvedSettings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
      key, decision: key === 'branch_behavior' ? 'edited' : 'accepted', evidence: [],
      value: {
        summary: key === 'branch_behavior' ? summary : `${key} fixture constraint`,
        ...(key === 'branch_behavior' ? {
          observations: Array.from({ length: 5 }, (_, index) => ({
            title: `Branch example ${index}`, detail: `Representative branch example ${index}.`,
          })),
        } : {}),
        ...(key === 'timeline' ? {
          observations: [
            { title: 'Opening plan', detail: 'An unopened observatory is only an author plan.' },
            { title: 'Middle plan', detail: 'The possible journey reaches a bridge.' },
            { title: 'Final plan', detail: futureEnding },
          ],
        } : {}),
      },
    })),
  });
  const sourceFingerprint = 'a'.repeat(64);
  return {
    id: 'guidance-profile-id', status: 'approved', profileVersion: 2, reviewRevision: 3,
    sourceFingerprint, approvedSettings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, approvedSettings),
  };
}

// Reuse the assembler spec's pinned canonical-source fixture shape, with invented data only.
function fixture(summary = fullSummary) {
  const scene = { id: 'scene-id', title: { en: 'Crossroads' } };
  const beats = [{ position: 1, beatType: 'paragraph', content: { en: 'The reader has just reached a quiet crossroads.' } }];
  const choice = { id: 'choice-b', label: { en: 'Follow the river' } };
  const memories = [{ id: 'memory-id', memoryType: 'event', revision: 1,
    content: { en: 'The reader kept the letter.' } }];
  const semanticPath = [{ sourceTitle: 'Prior scene', choiceLabel: 'Keep the letter',
    targetTitle: null, explicitRejoin: false, endingType: null }];
  const routeContinuity = { version: STORY_CONTINUATION_ROUTE_VIEW_VERSION, actions: [], readEvidence: [] };
  const routeContinuityHash = continuationHash(routeContinuity);
  const profile = approvedProfile(summary);
  const snapshot = continuationGenerationProfileSnapshot(profile as never);
  const sourceHash = continuationSourceHash({
    kind: 'canonical', locale: 'en', title: scene.title, beats, choiceLabel: choice.label,
  });
  const pathHash = continuationPathHash(semanticPath);
  const memoryPins = continuationMemoryPins(memories);
  const contextFingerprint = 'guidance-context-fingerprint';
  const request: StoryContinuationProviderRequest = {
    operationId: 'continuation-id', locale: 'en', contextFingerprint,
    provider: config.provider, model: config.model,
    rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768, outputTokenLimit: 500,
  };
  const continuation = {
    id: 'continuation-id', leaseToken: 'lease-token', userId: 'reader-id',
    workId: 'work-id', releaseId: 'release-id', progressId: 'progress-id',
    sourcePartId: 'part-id', sourceSceneId: 'scene-id', sourceGeneratedSceneId: null,
    recommendedChoiceId: 'choice-b', generatedChoiceId: null,
    sourceProgressRevision: 9, manuscriptVersionId: 'manuscript-id', analysisJobId: 'analysis-id',
    locale: request.locale, promptVersion: request.promptVersion, inputTokenLimit: request.inputTokenLimit,
    contextFingerprint,
    // Persisted references contain pins, not a copied/truncated prompt view.
    contextReferences: JSON.parse(JSON.stringify({
      memoryPins, choiceEventIds: ['event-id'], sourceHash, pathHash,
      routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION, routeContinuityHash,
      generationProfilePin: snapshot.pin, generationProfileViewVersion: STORY_CONTINUATION_PROFILE_VIEW_VERSION,
      executionFingerprint: continuationExecutionFingerprint({
        contextFingerprint, sourceHash, pathHash, memoryPins,
        routeContinuityHash, routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION,
        generationProfilePin: snapshot.pin,
      }),
    })),
  };
  const prisma = {
    storyAiContinuation: { findUnique: jest.fn().mockResolvedValue(continuation) },
    storyReaderProgress: { findFirst: jest.fn().mockResolvedValue({
      pathSummary: [{ sceneId: 'prior', choiceId: 'choice-a' }],
    }) },
    storyPart: { findFirst: jest.fn().mockResolvedValue({ id: 'part-id' }),
      findMany: jest.fn().mockResolvedValue([{ id: 'part-id' }]) },
    storyScene: {
      findFirst: jest.fn().mockResolvedValue(scene),
      findMany: jest.fn().mockResolvedValue([{ id: 'prior', title: { en: 'Prior scene' }, endingType: null }]),
    },
    storyBeat: { findMany: jest.fn().mockResolvedValue(beats) },
    storyChoice: {
      findFirst: jest.fn().mockResolvedValue(choice),
      findMany: jest.fn().mockResolvedValue([{ id: 'choice-a', sceneId: 'prior',
        label: { en: 'Keep the letter' }, targetEndingKey: null, declaredRejoinSceneId: null }]),
    },
    storyAiGeneratedScene: { findMany: jest.fn().mockResolvedValue([]) },
    storyAiGeneratedChoice: { findMany: jest.fn().mockResolvedValue([]) },
    storyMemoryRecord: { findMany: jest.fn().mockResolvedValue(memories) },
    storyWorkGenerationProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
  };
  const claim: StoryContinuationClaim = {
    continuationId: continuation.id, leaseToken: continuation.leaseToken,
    attemptCount: 1, maxAttempts: 3, request,
  };
  const assembler = new StoryContinuationContextAssembler(prisma as never);
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockRejectedValue(new Error('transport prohibited'));
  const provider = new OpenAiStoryContinuationProvider(config, transport);
  const preflight = jest.spyOn(provider, 'preflight');
  // Exercise the real executor up to generation, then stop without any model/transport call.
  const generate = jest.spyOn(provider, 'generate')
    .mockRejectedValue(new StoryContinuationProviderError(unpaidStop, false));
  const queue = {
    claimExpiredTerminal: jest.fn().mockResolvedValue(null),
    claimNext: jest.fn().mockResolvedValue(claim),
    markDispatched: jest.fn().mockResolvedValue(undefined),
    releaseForRetry: jest.fn(), releaseNotAcceptedForRetry: jest.fn(),
  };
  const economics = {
    continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
    continuationDispatchAuthorization: jest.fn().mockResolvedValue(true),
    failClaimedContinuation: jest.fn().mockResolvedValue(undefined),
    settleClaimedContinuation: jest.fn(),
  };
  const executor = new StoryContinuationExecutor(
    queue as unknown as StoryContinuationQueueRepository, provider, economics as never, assembler,
    { preview: jest.fn() } as never,
  );
  return { profile, snapshot, continuation, claim, prisma, assembler, provider,
    preflight, generate, transport, queue, economics, executor };
}

function payload(request: StoryContinuationProviderRequest) {
  const body = buildStoryContinuationOpenAiRequest(request, config);
  const context = JSON.parse(body.input[0].content[0].text);
  return { body, context };
}

function expectRejectedBeforeBodyAndPreflight(f: ReturnType<typeof fixture>) {
  expect(f.prisma.storyBeat.findMany).not.toHaveBeenCalled();
  expect(f.prisma.storyChoice.findFirst).not.toHaveBeenCalled();
  expect(f.preflight).not.toHaveBeenCalled();
  expect(f.queue.markDispatched).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
  expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
  expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(f.claim, 'pinned_context_changed', 'failed');
}

describe('approved branch summary: queued pin -> dispatch reconstruction -> unpaid provider preflight', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it.each(['accepted', 'edited'] as const)('preserves the entire %s summary including its tail in the actual provider payload', async (decision) => {
    const f = fixture();
    f.profile.approvedSettings.sections.find((section) => section.key === 'branch_behavior')!.decision = decision;
    f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, f.profile.approvedSettings);
    const snapshot = continuationGenerationProfileSnapshot(f.profile as never);
    f.continuation.contextReferences.generationProfilePin = snapshot.pin;
    f.continuation.contextReferences.executionFingerprint = continuationExecutionFingerprint({
      contextFingerprint: f.continuation.contextFingerprint,
      sourceHash: f.continuation.contextReferences.sourceHash, pathHash: f.continuation.contextReferences.pathHash,
      memoryPins: f.continuation.contextReferences.memoryPins,
      routeContinuityHash: f.continuation.contextReferences.routeContinuityHash,
      routeContinuityVersion: STORY_CONTINUATION_ROUTE_VIEW_VERSION, generationProfilePin: snapshot.pin,
    });
    expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v5');
    expect(f.claim.request).not.toHaveProperty('approvedContext');
    expect(JSON.stringify(f.continuation.contextReferences)).not.toContain(endingTail);

    await expect(f.executor.executeOne('unpaid-guidance-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.preflight).toHaveBeenCalledTimes(1);
    const dispatchRequest = f.preflight.mock.calls[0][0];
    await expect(f.preflight.mock.results[0].value).resolves.toMatchObject({
      supported: true, reason: 'provider_preflight_ready', budgetMethod: 'js_tiktoken_o200k_base_v1',
    });
    const rebuiltBranch = dispatchRequest.approvedContext!.generationProfile!.sections
      .find((section) => section.key === 'branch_behavior')!.value;
    expect(rebuiltBranch.summary).toBe(fullSummary);
    const { body, context } = payload(dispatchRequest);
    const branch = context.generationProfile.sections.find((section: { key: string }) => section.key === 'branch_behavior');
    expect(branch.value.summary).toBe(fullSummary);
    expect(branch.value.summary.trimEnd().endsWith(endingTail)).toBe(true);
    expect(branch.value.referenceScope).toBe('production_constraint');
    expect(body.truncation).toBe('disabled');
    expect(f.prisma.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ...snapshot.pin, status: 'approved' }),
    }));
    expect(f.queue.markDispatched).toHaveBeenCalledWith(f.claim, expect.any(Function), 110_000);
    expect(f.generate).toHaveBeenCalledWith(dispatchRequest, expect.any(AbortSignal));
    expect(f.preflight.mock.invocationCallOrder[0]).toBeLessThan(f.queue.markDispatched.mock.invocationCallOrder[0]);
    expect(f.queue.markDispatched.mock.invocationCallOrder[0]).toBeLessThan(f.generate.mock.invocationCallOrder[0]);
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(f.claim, unpaidStop, 'failed');
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('preserves a normalized 8000-unit summary, without promising all observations', async () => {
    const summary = `${'x'.repeat(8_000 - endingTail.length)}${endingTail}`;
    const f = fixture(summary);
    const approvedContext = await f.assembler.assemble(f.claim);
    const branch = approvedContext.generationProfile!.sections.find((section) => section.key === 'branch_behavior')!.value;
    expect(summary).toHaveLength(8_000);
    expect(branch.summary).toBe(summary);
    expect(branch.observations).toEqual([{
      title: 'Branch example 2', detail: 'Representative branch example 2.',
      referenceScope: 'author_plan_not_route_history',
    }]);
    const request = { ...f.claim.request, approvedContext };
    await expect(f.provider.preflight(request)).resolves.toMatchObject({ supported: true });
    expect(payload(request).context.generationProfile.sections
      .find((section: { key: string }) => section.key === 'branch_behavior').value.summary).toBe(summary);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['story-profile-prompt-v3', 'story-profile-prompt-v4'])('rejects a %s queued profile before profile/body lookup, preflight or generation', async (viewVersion) => {
    const f = fixture();
    f.continuation.contextReferences.generationProfileViewVersion = viewVersion;
    const referencesBefore = JSON.stringify(f.continuation.contextReferences);
    await expect(f.executor.executeOne('unpaid-guidance-worker')).resolves.toMatchObject({ status: 'failed' });
    expectRejectedBeforeBodyAndPreflight(f);
    expect(f.prisma.storyWorkGenerationProfile.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.storyReaderProgress.findFirst).not.toHaveBeenCalled();
    expect(f.prisma.storyScene.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(f.continuation.contextReferences)).toBe(referencesBefore);
  });

  it.each(['source', 'approved_fingerprint', 'settings_without_reapproval', 'settings_with_reapproval'] as const)(
    'fails closed for changed approved %s even when the fixture returns a row despite the old lookup pin', async (change) => {
      const f = fixture();
      if (change === 'source') {
        f.profile.sourceFingerprint = 'c'.repeat(64);
        f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, f.profile.approvedSettings);
      } else if (change === 'approved_fingerprint') {
        f.profile.approvedFingerprint = 'b'.repeat(64);
      } else {
        f.profile.approvedSettings.sections.find((section) => section.key === 'branch_behavior')!.value.summary =
          `${fullSummary} CHANGED_APPROVED_ENDING_TAIL`;
        if (change === 'settings_with_reapproval') {
          f.profile.approvedFingerprint = creatorGenerationProfileFingerprint(f.profile.sourceFingerprint, f.profile.approvedSettings);
        }
      }
      await expect(f.executor.executeOne('unpaid-guidance-worker')).resolves.toMatchObject({ status: 'failed' });
      expectRejectedBeforeBodyAndPreflight(f);
      expect(f.prisma.storyWorkGenerationProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ ...f.snapshot.pin, status: 'approved' }),
      }));
    },
  );

  it('keeps a planned final event outside reader history and adds no absent ending criterion to the payload', async () => {
    const summary = 'Preserve the selected branch consequences.';
    const f = fixture(summary);
    const approvedContext = await f.assembler.assemble(f.claim);
    const request = { ...f.claim.request, approvedContext };
    await expect(f.provider.preflight(request)).resolves.toMatchObject({ supported: true });
    const { body, context } = payload(request);
    const timeline = context.generationProfile.sections.find((section: { key: string }) => section.key === 'timeline');
    expect(timeline.value.referenceScope).toBe('author_plan_not_route_history');
    expect(timeline.value.observations).toEqual([
      { title: 'Opening plan', detail: 'An unopened observatory is only an author plan.', referenceScope: 'author_plan_not_route_history' },
      { title: 'Final plan', detail: futureEnding, referenceScope: 'author_plan_not_route_history' },
    ]);
    expect(JSON.stringify({ sourceScene: context.sourceScene, path: context.path,
      memories: context.memories, routeContinuity: context.routeContinuity })).not.toContain(futureEnding);
    const branch = context.generationProfile.sections.find((section: { key: string }) => section.key === 'branch_behavior');
    expect(branch.value).toEqual({ summary, referenceScope: 'production_constraint', observations: [{
      title: 'Branch example 2', detail: 'Representative branch example 2.', referenceScope: 'author_plan_not_route_history',
    }] });
    expect(body.instructions).toContain('Missing or ambiguous source locations must never be guessed or promoted to history.');
    expect(f.transport).not.toHaveBeenCalled();
  });

  it('fails provider preflight on a tight token budget rather than silently fitting a clipped branch summary', async () => {
    const f = fixture();
    const approvedContext = await f.assembler.assemble(f.claim);
    const fullRequest = { ...f.claim.request, approvedContext };
    const fullPreflight = await f.provider.preflight(fullRequest);
    expect(fullPreflight.supported).toBe(true);
    const inputTokenLimit = fullPreflight.inputTokenUpperBound! - 1;
    const clippedContext = JSON.parse(JSON.stringify(approvedContext));
    clippedContext.generationProfile.sections.find((section: { key: string }) => section.key === 'branch_behavior')
      .value.summary = fullSummary.trim().slice(0, 240);
    await expect(f.provider.preflight({ ...fullRequest, inputTokenLimit, approvedContext: clippedContext }))
      .resolves.toMatchObject({ supported: true });
    const tightRequest = { ...fullRequest, inputTokenLimit };
    await expect(f.provider.preflight(tightRequest)).resolves.toMatchObject({
      supported: false, reason: 'provider_input_bound_exceeded',
      inputTokenLimit, inputTokenUpperBound: fullPreflight.inputTokenUpperBound,
    });
    expect(() => buildStoryContinuationOpenAiRequest(tightRequest, config)).toThrow('provider_input_bound_exceeded');
    expect(approvedContext.generationProfile!.sections.find((section) => section.key === 'branch_behavior')!.value.summary).toBe(fullSummary);

    f.claim.request.inputTokenLimit = inputTokenLimit;
    f.continuation.inputTokenLimit = inputTokenLimit;
    f.preflight.mockClear();
    await expect(f.executor.executeOne('unpaid-guidance-worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.preflight).toHaveBeenCalledTimes(1);
    await expect(f.preflight.mock.results[0].value).resolves.toMatchObject({ supported: false, reason: 'provider_input_bound_exceeded' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(f.claim, 'provider_input_bound_exceeded', 'failed', undefined, true);
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
  });

  it('rejects a valid normalized multibyte summary above the total 16 KiB view cap instead of clipping', () => {
    const summary = `${'\uAC00'.repeat(8_000 - endingTail.length)}${endingTail}`;
    const profile = approvedProfile(summary);
    expect(summary).toHaveLength(8_000);
    expect(Buffer.byteLength(summary, 'utf8')).toBeGreaterThan(16_384);
    expect(() => continuationGenerationProfileSnapshot(profile as never)).toThrow('generation_profile_context_too_large');
  });
});

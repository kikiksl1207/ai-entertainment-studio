import { BadRequestException } from '@nestjs/common';
import {
  runWithAbortTimeout,
  StoryContinuationExecutor,
} from './story-continuation.executor';
import {
  StoryContinuationProvider,
  StoryContinuationProviderError,
} from './story-continuation.provider';
import {
  StoryContinuationClaim,
  StoryContinuationQueueRepository,
} from './story-continuation.repository';
import {
  assertRecommendedContinuationOutput,
  sanitizeRecommendedVisualManifest,
  StoryEconomicsService,
} from './story-economics.service';
import { StoryEconomicsAdminController } from './story-economics.controller';
import { StoryContinuationContextError } from './story-continuation-context.assembler';

const claim: StoryContinuationClaim = {
  continuationId: 'continuation-id',
  leaseToken: 'lease-token',
  attemptCount: 1,
  maxAttempts: 3,
  request: {
    operationId: 'continuation-id',
    locale: 'ko',
    contextFingerprint: 'fingerprint',
    promptVersion: 'story-continuation-v1',
    outputSchemaVersion: 'story-continuation-output-v1',
    inputTokenLimit: 1000,
    outputTokenLimit: 500,
  },
};

const result = {
  title: { ko: '생성 장면' },
  beats: [{ beatType: 'paragraph' as const, content: { ko: '검증용 본문' } }],
  visualManifest: {
    sceneKey: 'ai-continuation-id',
    background: { state: 'fallback', altKey: 'story.visual.generated' },
    characters: [],
    fallback: {
      publicAssetPath: '/assets/story/fallback.webp',
      altKey: 'story.visual.fallback',
    },
  },
  nextChoices: [
    { choiceKey: 'route-1', label: { ko: '첫 선택' } },
    { choiceKey: 'route-2', label: { ko: '둘째 선택' } },
  ],
  usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, imageUnits: 0 },
};

function fixture() {
  const queue = {
    claimExpiredTerminal: jest.fn().mockResolvedValue(null),
    claimNext: jest.fn().mockResolvedValue(claim),
    releaseForRetry: jest.fn(),
    markDispatched: jest.fn(),
    releaseNotAcceptedForRetry: jest.fn(),
  } as unknown as StoryContinuationQueueRepository;
  const provider = {
    readiness: jest.fn().mockResolvedValue({ enabled: true }),
    generate: jest.fn().mockResolvedValue(result),
  } as unknown as StoryContinuationProvider;
  const economics = {
    continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
    settleClaimedContinuation: jest.fn(),
    failClaimedContinuation: jest.fn(),
  };
  const approvedContext = {
    sourceScene: { title: '장면', beats: [{ beatType: 'paragraph', content: '본문' }] },
    selectedChoice: { label: '다른 길' },
    path: [{
      sourceTitle: '이전 장면', choiceLabel: '이전 선택', targetTitle: '장면',
      explicitRejoin: false, endingType: null,
    }],
    memories: [],
  };
  const contextAssembler = { assemble: jest.fn().mockResolvedValue(approvedContext) };
  const moderation = { preview: jest.fn().mockReturnValue({ decision: 'allow' }) };
  const visuals = { registerGeneratedContinuationPrompt: jest.fn() };
  const executor = new StoryContinuationExecutor(
    queue, provider, economics as never, contextAssembler as never,
    moderation as never, visuals as never,
  );
  return { queue, provider, economics, contextAssembler, moderation, visuals, approvedContext, executor };
}

describe('StoryContinuationExecutor', () => {
  it('has an explicit admin runner entry point for a bounded single tick', async () => {
    const executeOne = jest.fn().mockResolvedValue({ status: 'idle' });
    const controller = new StoryEconomicsAdminController(
      {} as never,
      { executeOne } as never,
    );
    await expect(controller.runContinuationOnce({ id: 'admin-id' } as never))
      .resolves.toEqual({ status: 'idle' });
    expect(executeOne).toHaveBeenCalledWith('admin:admin-id');
  });

  it('does not claim work when the provider is disabled', async () => {
    const f = fixture();
    jest.mocked(f.provider.readiness).mockResolvedValue({ enabled: false, reason: 'provider_not_configured' });
    await expect(f.executor.executeOne('worker')).resolves.toEqual({
      status: 'disabled', reason: 'provider_not_configured',
    });
    expect(f.queue.claimNext).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('commits the dispatch fence before invoking the provider', async () => {
    const f = fixture();
    let commit!: () => void;
    jest.mocked(f.queue.markDispatched).mockImplementation(() => new Promise((resolve) => { commit = resolve; }));
    const pending = f.executor.executeOne('worker');
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(f.queue.markDispatched).toHaveBeenCalledWith(claim);
    expect(f.provider.generate).not.toHaveBeenCalled();
    commit();
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(f.provider.generate).toHaveBeenCalledTimes(1);
    expect(f.visuals.registerGeneratedContinuationPrompt).toHaveBeenCalledWith(
      claim.continuationId,
      expect.objectContaining({
        title: result.title,
        beats: result.beats,
        nextChoices: result.nextChoices,
        visualManifest: expect.objectContaining({
          sceneKey: 'ai-continuation-id',
          background: expect.objectContaining({
            publicAssetPath: '/assets/story/fallback.webp',
            state: 'fallback',
          }),
        }),
      }),
    );
  });

  it('does not fail a completed continuation when visual prompt registration fails', async () => {
    const f = fixture();
    f.visuals.registerGeneratedContinuationPrompt.mockRejectedValue(new Error('private visual failure'));
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'completed' });
    expect(f.economics.settleClaimedContinuation).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        title: result.title,
        beats: result.beats,
        nextChoices: result.nextChoices,
      }),
    );
    expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
  });

  it('never generates when dispatch commit acknowledgement fails', async () => {
    const f = fixture();
    jest.mocked(f.queue.markDispatched).mockRejectedValue({ code: 'P1001' });
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(claim, 'provider_outcome_unknown', 'failed');
  });

  it('preflights before marking a dispatch fence', async () => {
    const f = fixture();
    f.provider.preflight = jest.fn().mockResolvedValue({ supported: false, reason: 'provider_input_bound_exceeded' });
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('preflight cancellation can retry without dispatch or fence', async () => {
    const f = fixture();
    const controller = new AbortController();
    f.provider.preflight = jest.fn().mockImplementation(async () => { controller.abort(); return { supported: true }; });
    await expect(f.executor.executeOne('worker', controller.signal)).resolves.toMatchObject({ status: 'retry_wait' });
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).toHaveBeenCalledWith(claim, 'provider_cancelled', expect.any(Date));
  });

  it('recovers a fenced expired attempt without probing or invoking the provider', async () => {
    const f = fixture();
    const fenced = { ...claim, dispatchStartedAt: new Date() };
    jest.mocked(f.queue.claimExpiredTerminal).mockResolvedValue(fenced);
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'recovered_outcome_unknown' });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(fenced, 'provider_outcome_unknown', 'failed');
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('terminally recovers an expired final attempt before provider readiness', async () => {
    const f = fixture();
    jest.mocked(f.queue.claimExpiredTerminal).mockResolvedValue(claim);
    await expect(f.executor.executeOne('worker')).resolves.toEqual({
      status: 'recovered_timeout', continuationId: claim.continuationId,
    });
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'provider_timeout', 'timeout',
    );
    expect(f.provider.readiness).not.toHaveBeenCalled();
    expect(f.provider.generate).not.toHaveBeenCalled();
  });

  it('settles a test-double result exactly once through the claimed lease', async () => {
    const f = fixture();
    await expect(f.executor.executeOne('worker')).resolves.toEqual({
      status: 'completed', continuationId: claim.continuationId,
    });
    expect(f.economics.continuationExecutionAuthorization).toHaveBeenCalledWith(claim);
    expect(f.contextAssembler.assemble).toHaveBeenCalledWith(claim);
    expect(f.provider.generate).toHaveBeenCalledWith(
      { ...claim.request, approvedContext: f.approvedContext },
      expect.objectContaining({ aborted: false }),
    );
    expect(f.economics.settleClaimedContinuation).toHaveBeenCalledWith(
      claim,
      expect.objectContaining({
        title: result.title,
        beats: result.beats,
        nextChoices: result.nextChoices,
        visualManifest: expect.objectContaining({
          fallback: result.visualManifest.fallback,
        }),
      }),
    );
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
  });

  it('uses server moderation and rejects provider output before settlement', async () => {
    const f = fixture();
    f.moderation.preview.mockReturnValue({ decision: 'block' });
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'server_moderation_rejected', 'failed',
    );
  });

  it('rejects malformed locale output before moderation or settlement', async () => {
    const f = fixture();
    jest.mocked(f.provider.generate).mockResolvedValue({
      ...result,
      title: { en: 'Wrong locale' },
    });
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.moderation.preview).not.toHaveBeenCalled();
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'continuation_execution_failed', 'failed',
    );
  });

  it('fails before provider transmission when pinned authorization was withdrawn', async () => {
    const f = fixture();
    f.economics.continuationExecutionAuthorization.mockResolvedValue({
      allowed: false, code: 'generation_authorization_changed',
    });
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.contextAssembler.assemble).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'generation_authorization_changed', 'failed',
    );
  });

  it('does not retry a provider timeout with unknown paid outcome', async () => {
    const f = fixture();
    jest.mocked(f.provider.generate).mockRejectedValue(
      new StoryContinuationProviderError('provider_timeout', true),
    );
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(claim, 'provider_outcome_unknown', 'failed');
  });

  it('preserves provider retryability for a non-timeout transient failure', async () => {
    const f = fixture();
    jest.mocked(f.provider.generate).mockRejectedValue(
      new StoryContinuationProviderError('provider_rate_limited', true),
    );
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'retry_wait' });
    expect(f.queue.releaseNotAcceptedForRetry).toHaveBeenCalledWith(claim, expect.any(Date));
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
  });

  it('keeps a provider-declared permanent failure fail-closed', async () => {
    const f = fixture();
    jest.mocked(f.provider.generate).mockRejectedValue(
      new StoryContinuationProviderError('provider_request_rejected', false),
    );
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'provider_request_rejected', 'failed',
    );
  });

  it('settles a permanent context mismatch without provider call or retry consumption', async () => {
    const f = fixture();
    f.contextAssembler.assemble.mockRejectedValue(
      new StoryContinuationContextError('pinned_context_changed'),
    );
    await expect(f.executor.executeOne('worker')).resolves.toMatchObject({ status: 'failed' });
    expect(f.provider.generate).not.toHaveBeenCalled();
    expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
    expect(f.economics.failClaimedContinuation).toHaveBeenCalledWith(
      claim, 'pinned_context_changed', 'failed',
    );
  });

  it('aborts the provider signal when the executor timeout wins', async () => {
    let observedSignal: AbortSignal | undefined;
    await expect(runWithAbortTimeout((signal) => {
      observedSignal = signal;
      return new Promise(() => undefined);
    }, 5)).rejects.toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('does not assert zero actual cost when a timed-out provider may still reconcile usage', async () => {
    const economics = new StoryEconomicsService({} as never);
    const settle = jest.spyOn(economics, 'settleContinuation').mockResolvedValue({} as never);
    await economics.failClaimedContinuation(claim, 'provider_timeout', 'timeout');
    expect(settle).toHaveBeenCalledWith(
      null,
      claim.continuationId,
      expect.not.objectContaining({ actualCostKrw: expect.anything() }),
      expect.any(String),
      claim.leaseToken,
    );
  });
});

describe('recommended continuation output contract', () => {
  it('accepts a complete fallback visual and distinct next choices', () => {
    expect(() => assertRecommendedContinuationOutput({
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: result.title, resultBeats: result.beats,
      resultVisualManifest: result.visualManifest, nextChoices: result.nextChoices,
    }, 'ai-continuation-id')).not.toThrow();
  });

  it('strips provider-only visual fields before persistence or public projection', () => {
    const sanitized = sanitizeRecommendedVisualManifest({
      ...result.visualManifest,
      rawProviderPayload: 'must-not-persist',
      background: {
        ...(result.visualManifest.background as Record<string, unknown>),
        internalStorageKey: 'private/object/key',
      },
    }, 'ai-continuation-id');
    expect(JSON.stringify(sanitized)).not.toContain('rawProviderPayload');
    expect(JSON.stringify(sanitized)).not.toContain('internalStorageKey');
    expect(sanitized).toMatchObject({
      fallback: { publicAssetPath: '/assets/story/fallback.webp' },
    });
  });

  it.each([
    { nextChoices: result.nextChoices, ending: { endingKey: 'ai-end' } },
    { nextChoices: undefined, ending: undefined },
    { nextChoices: [result.nextChoices[0], result.nextChoices[0]], ending: undefined },
  ])('rejects ambiguous, empty, or duplicate routing %#', (route) => {
    expect(() => assertRecommendedContinuationOutput({
      status: 'completed', moderationDecision: 'allow', actualCostKrw: 0,
      inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, imageUnits: 0,
      resultTitle: result.title, resultBeats: result.beats,
      resultVisualManifest: result.visualManifest, ...route,
    }, 'ai-continuation-id')).toThrow(BadRequestException);
  });
});

import { CREATOR_GENERATION_PROFILE_SCHEMA } from '../generation-profile/creator-generation-profile.policy';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import { StoryContinuationExecutor } from './story-continuation.executor';
import {
  assertStoryContinuationLengthBounds,
  authorPartStoryContinuationLengthBounds,
} from './story-continuation-length.policy';
import {
  OpenAiStoryContinuationProvider,
  type StoryContinuationFetch,
} from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
} from './story-continuation-openai.schema';
import {
  StoryContinuationProviderError,
  type StoryContinuationProviderRequest,
} from './story-continuation.provider';
import type {
  StoryContinuationClaim,
  StoryContinuationQueueRepository,
} from './story-continuation.repository';
import { STORY_CONTINUATION_TOKEN_BUDGET_METHOD } from './story-continuation-tokenizer';
import { STORY_LOCALES, type StoryLocale } from './story-production.policy';

const config: StoryContinuationOpenAiConfig = Object.freeze({
  enabled: true,
  provider: 'openai',
  model: 'gpt-4.1-2025-04-14',
  rateCardId: 'schema-execution-synthetic-card',
  rateCardVersion: 'synthetic-v1',
  apiKey: 'synthetic-not-a-real-key',
  timeoutMs: 100,
  maxInputTokens: 32_768,
  maxOutputTokens: 8_192,
  maxResponseBytes: 200_000,
  visualAssetPath: '/assets/story/neutral-placeholder.webp',
});

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(child => freeze(child));
    Object.freeze(value);
  }
  return value;
}

function originalBounds(locale: StoryLocale, units: 125_000 | 125_001) {
  const texts = Array.from({ length: 4 }, () => 'x'.repeat(31_250));
  if (units === 125_001) texts.push('x');
  const bounds = authorPartStoryContinuationLengthBounds(locale, Object.freeze(texts));
  assertStoryContinuationLengthBounds(bounds);
  return bounds;
}

function fixture(locale: StoryLocale) {
  // Caller-projected synthetic profile/context is not an actual approval or owner proof.
  const context: Omit<StoryContinuationApprovedContext, 'narrativeLength'> = {
    sourceScene: {
      title: 'Synthetic source scene',
      beats: [{ beatType: 'paragraph', content: 'A synthetic reader takes a new path.' }],
    },
    selectedChoice: { label: 'Follow the synthetic path' },
    path: [],
    memories: [],
    generationProfile: {
      schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
      sections: [{
        key: 'writing_style',
        value: {
          summary: 'Keep the synthetic narrative voice and original scene scale.',
          referenceScope: 'writing_pattern',
          observations: [{
            title: 'Synthetic voice',
            detail: 'Use concrete actions and dialogue without treating future notes as route history.',
          }],
          categories: { viewpoint: ['Synthetic first-person voice'] },
        },
      }],
    },
  };
  const queuedRequest: StoryContinuationProviderRequest = freeze({
    operationId: 'schema-execution-synthetic-' + locale,
    locale,
    contextFingerprint: 'synthetic-caller-context-not-approval-proof',
    provider: config.provider,
    model: config.model,
    rateCardId: config.rateCardId,
    rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
    outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768,
    outputTokenLimit: 8_192,
  });
  const input: StoryContinuationProviderRequest = freeze({
    ...queuedRequest,
    approvedContext: { ...context, narrativeLength: originalBounds(locale, 125_001) },
  });
  const control: StoryContinuationProviderRequest = freeze({
    ...queuedRequest,
    approvedContext: { ...context, narrativeLength: originalBounds(locale, 125_000) },
  });
  const claim: StoryContinuationClaim = freeze({
    continuationId: queuedRequest.operationId,
    leaseToken: 'synthetic-first-unsent-lease',
    attemptCount: 1,
    maxAttempts: 3,
    dispatchStartedAt: null,
    request: queuedRequest,
  });
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockRejectedValue(new Error('Synthetic transport must not be called'));
  const provider = new OpenAiStoryContinuationProvider(config, transport);
  const generate = jest.spyOn(provider, 'generate');
  const preflight = jest.spyOn(provider, 'preflight');
  const queue = {
    claimExpiredTerminal: jest.fn().mockResolvedValue(null),
    claimNext: jest.fn().mockResolvedValue(claim),
    markDispatched: jest.fn().mockResolvedValue(undefined),
    releaseForRetry: jest.fn().mockResolvedValue(undefined),
    releaseNotAcceptedForRetry: jest.fn().mockResolvedValue(undefined),
  };
  const economics = {
    continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
    continuationDispatchAuthorization: jest.fn().mockResolvedValue(true),
    settleClaimedContinuation: jest.fn().mockResolvedValue({ status: 'completed' }),
    failClaimedContinuation: jest.fn().mockResolvedValue(undefined),
  };
  const assembler = { assemble: jest.fn().mockResolvedValue(input.approvedContext) };
  const moderation = { preview: jest.fn().mockReturnValue({ decision: 'allow' }) };
  const visuals = { registerGeneratedContinuationPrompt: jest.fn() };
  const bodyReviews = {
    autoApproveCompanyContinuation: jest.fn(),
    deferCompanyContinuationApproval: jest.fn(),
  };
  const executor = new StoryContinuationExecutor(
    queue as unknown as StoryContinuationQueueRepository,
    provider,
    economics as never,
    assembler as never,
    moderation as never,
    visuals as never,
    bodyReviews as never,
  );
  return {
    input, control, claim, provider, preflight, generate, transport,
    queue, economics, assembler, moderation, visuals, bodyReviews, executor,
  };
}

type Fixture = ReturnType<typeof fixture>;

function snapshot(f: Fixture) {
  return JSON.stringify({ input: f.input, control: f.control, claim: f.claim, config });
}

async function assertBoundaryControl(f: Fixture) {
  expect(f.input.approvedContext!.narrativeLength).toMatchObject({
    locale: f.input.locale, referenceUnits: 125_001,
    minUnits: 100_001, targetUnits: 125_001, maxUnits: 150_001,
  });
  expect(f.control.approvedContext!.narrativeLength).toMatchObject({
    locale: f.input.locale, referenceUnits: 125_000,
    minUnits: 100_000, targetUnits: 125_000, maxUnits: 150_000,
  });
  expect({
    ...f.control,
    approvedContext: {
      ...f.control.approvedContext!,
      narrativeLength: f.input.approvedContext!.narrativeLength,
    },
  }).toStrictEqual(f.input);
  await expect(f.provider.readiness()).resolves.toEqual({ enabled: true });
  const admitted = await f.provider.preflight(f.control);
  expect(admitted).toMatchObject({
    supported: true,
    reason: 'provider_preflight_ready',
    budgetMethod: STORY_CONTINUATION_TOKEN_BUDGET_METHOD,
    inputTokenLimit: 32_768,
  });
  expect(admitted.inputTokenUpperBound).toEqual(expect.any(Number));
  expect(admitted.inputTokenUpperBound).toBeLessThanOrEqual(32_768);
  expect(f.control.outputTokenLimit).toBe(8_192);
  expect(f.input.outputTokenLimit).toBe(8_192);
  expect(config.maxInputTokens).toBe(32_768);
  expect(config.maxOutputTokens).toBe(8_192);
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.transport).not.toHaveBeenCalled();
}

describe('schema preflight execution at unchanged fixed limits, synthetic seams only', () => {
  let network: jest.SpyInstance;

  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network prohibited'));
  });

  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { jest.restoreAllMocks(); }
  });

  it.each(STORY_LOCALES)(
    'SCHEMA-EXECUTION: real preflight rejects impossible %s bounds before executor dispatch',
    async locale => {
      const f = fixture(locale);
      const before = snapshot(f);
      await assertBoundaryControl(f);

      await expect(f.executor.executeOne('schema-execution-synthetic-worker')).resolves.toEqual({
        status: 'failed', continuationId: f.claim.continuationId,
      });
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledTimes(1);
      expect(f.queue.claimNext).toHaveBeenCalledTimes(1);
      expect(f.economics.continuationExecutionAuthorization.mock.calls).toEqual([[f.claim]]);
      expect(f.assembler.assemble.mock.calls).toEqual([[f.claim]]);
      expect(f.preflight).toHaveBeenCalledTimes(2);
      expect(f.preflight).toHaveBeenNthCalledWith(1, f.control);
      expect(f.preflight).toHaveBeenNthCalledWith(2, f.input);
      await expect(f.preflight.mock.results[1].value).resolves.toEqual({
        supported: false,
        reason: 'provider_context_invalid',
        budgetMethod: STORY_CONTINUATION_TOKEN_BUDGET_METHOD,
        inputTokenLimit: 32_768,
      });
      expect(f.economics.failClaimedContinuation.mock.calls).toEqual([[
        f.claim, 'provider_context_invalid', 'failed', undefined, true,
      ]]);
      expect(f.queue.markDispatched).not.toHaveBeenCalled();
      expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
      expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
      expect(f.economics.continuationDispatchAuthorization).not.toHaveBeenCalled();
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
      expect(f.moderation.preview).not.toHaveBeenCalled();
      expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
      expect(f.visuals.registerGeneratedContinuationPrompt).not.toHaveBeenCalled();
      expect(f.bodyReviews.autoApproveCompanyContinuation).not.toHaveBeenCalled();
      expect(f.bodyReviews.deferCompanyContinuationApproval).not.toHaveBeenCalled();
      expect(snapshot(f)).toBe(before);
    },
  );

  it.each(STORY_LOCALES)(
    'SCHEMA-EXECUTION: direct real adapter rejects impossible %s bounds without usage or transport',
    async locale => {
      const f = fixture(locale);
      const before = snapshot(f);
      await assertBoundaryControl(f);
      const signal = new AbortController().signal;
      let error: unknown;
      try { await f.provider.generate(f.input, signal); }
      catch (caught) { error = caught; }

      expect(error).toBeInstanceOf(StoryContinuationProviderError);
      expect(error).toMatchObject({ code: 'provider_context_invalid', retryable: false });
      expect((error as StoryContinuationProviderError).usage).toBeUndefined();
      expect(f.generate.mock.calls).toEqual([[f.input, signal]]);
      expect(f.preflight).toHaveBeenCalledTimes(1);
      expect(f.transport).not.toHaveBeenCalled();
      expect(signal.aborted).toBe(false);
      expect(snapshot(f)).toBe(before);
    },
  );
});

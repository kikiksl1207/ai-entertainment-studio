import type { Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ModerationService } from '../moderation/moderation.service';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import { StoryContinuationExecutor } from './story-continuation.executor';
import { OpenAiStoryContinuationProvider } from './story-continuation-openai.adapter';
import { readStoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import { StoryContinuationProvider, type StoryContinuationProviderRequest } from './story-continuation.provider';
import { StoryContinuationQueueRepository, type StoryContinuationClaim } from './story-continuation.repository';
import {
  STORY_CONTINUATION_OPENAI_PROVIDER,
  STORY_CONTINUATION_TIMING_PROVIDER,
  STORY_CONTINUATION_WORKER_PROVIDER,
} from './story-continuation-runtime.providers';
import { STORY_CONTINUATION_TIMING_POLICY } from './story-continuation-timing.config';
import { createStoryContinuationTimingPolicy, type StoryContinuationTimingPolicy } from './story-continuation-timing.policy';
import { StoryContinuationWorker } from './story-continuation.worker';
import { StoryEconomicsService } from './story-economics.service';
import { StoryProductionModule } from './story-production.module';

type Settings = Readonly<Record<string, string | undefined>>;
const EXTENDED: Settings = { STORY_CONTINUATION_TIMING_PRESET: 'extended-180s' };
const ENABLED: Settings = {
  STORY_CONTINUATION_PROVIDER_ENABLED: 'true',
  STORY_CONTINUATION_PROVIDER: 'openai',
  STORY_CONTINUATION_OPENAI_MODEL: 'gpt-4.1-2025-04-14',
  STORY_CONTINUATION_RATE_CARD_ID: 'synthetic-timing-card',
  STORY_CONTINUATION_RATE_CARD_VERSION: 'synthetic-v1',
  STORY_CONTINUATION_OPENAI_API_KEY: 'synthetic-not-a-real-key',
  STORY_CONTINUATION_VISUAL_ASSET_PATH: '/assets/story/synthetic-timing.webp',
};
const CONTEXT = {
  sourceScene: {
    title: 'Synthetic timing scene',
    beats: [{ beatType: 'paragraph', content: 'A synthetic character waits beside a closed gate.' }],
  },
  selectedChoice: { label: 'Wait beside the gate' },
  path: [], memories: [],
};
const REQUEST: StoryContinuationProviderRequest = {
  operationId: 'synthetic-timing-id', locale: 'en', contextFingerprint: 'synthetic-fingerprint',
  promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
  outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
  provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'synthetic-timing-card', rateCardVersion: 'synthetic-v1',
  inputTokenLimit: 32_768, outputTokenLimit: 500, approvedContext: CONTEXT,
};

function fixture(settings: Settings = {}, includeTiming = true) {
  const config = { get: jest.fn(<T = string>(key: string) => settings[key] as T | undefined) };
  const claim: StoryContinuationClaim = {
    continuationId: REQUEST.operationId, leaseToken: 'synthetic-lease-token',
    attemptCount: 1, maxAttempts: 3, request: REQUEST,
  };
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
  const contextAssembler = { assemble: jest.fn().mockResolvedValue(CONTEXT) };
  const moderation = { preview: jest.fn() };
  // Use exported factories and the actual injectable executor, not an App/DB module.
  const providers: Provider[] = [
    { provide: ConfigService, useValue: config },
    { provide: StoryContinuationQueueRepository, useValue: queue },
    { provide: StoryEconomicsService, useValue: economics },
    { provide: StoryContinuationContextAssembler, useValue: contextAssembler },
    { provide: ModerationService, useValue: moderation },
    StoryContinuationExecutor,
    STORY_CONTINUATION_OPENAI_PROVIDER,
    STORY_CONTINUATION_WORKER_PROVIDER,
  ];
  if (includeTiming) providers.push(STORY_CONTINUATION_TIMING_PROVIDER);
  return { builder: Test.createTestingModule({ providers }), config, queue, economics, contextAssembler, moderation };
}

async function runtime(settings: Settings = {}, includeTiming = true) {
  const f = fixture({ ...ENABLED, ...settings }, includeTiming);
  const module = await f.builder.compile();
  return { ...f, module, provider: module.get(StoryContinuationProvider),
    executor: module.get(StoryContinuationExecutor), worker: module.get(StoryContinuationWorker) };
}

function assertNoRetry(f: ReturnType<typeof fixture>) {
  expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
  expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
  expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
  expect(f.moderation.preview).not.toHaveBeenCalled();
}

describe('real continuation timing factory and Nest DI integration (synthetic dependencies only)', () => {
  let transport: jest.SpyInstance;
  let allowedSyntheticRequests: number;
  beforeEach(() => {
    jest.useFakeTimers();
    allowedSyntheticRequests = 0;
    transport = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
  });
  afterEach(() => {
    try {
      expect(transport).toHaveBeenCalledTimes(allowedSyntheticRequests);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.restoreAllMocks();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  function holdSyntheticTransport() {
    allowedSyntheticRequests = 1;
    let signal: AbortSignal | undefined;
    transport.mockImplementation((url: string, init: RequestInit) => {
      if (url !== 'https://api.openai.com/v1/responses') throw new Error('unexpected synthetic endpoint');
      signal = init.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    });
    return () => signal;
  }

  it('registers the real factories and one timing singleton in the production module metadata', async () => {
    const providers: Provider[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StoryProductionModule);
    expect(providers).toContain(STORY_CONTINUATION_TIMING_PROVIDER);
    expect(providers).toContain(STORY_CONTINUATION_OPENAI_PROVIDER);
    expect(providers).toContain(STORY_CONTINUATION_WORKER_PROVIDER);
    expect(providers).toContain(StoryContinuationExecutor);
    expect(providers.filter(entry => typeof entry === 'object' && entry !== null &&
      'provide' in entry && entry.provide === STORY_CONTINUATION_TIMING_POLICY)).toHaveLength(1);
    const f = await runtime();
    try {
      const timing = f.module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY);
      expect(await f.module.resolve(STORY_CONTINUATION_TIMING_POLICY)).toBe(timing);
      expect(Object.isFrozen(timing)).toBe(true);
      expect(timing).toMatchObject({ providerDeadlineMs: 90_000, executorDeadlineMs: 95_000,
        leaseMs: 125_000, drainMs: 35_000 });
      expect(f.provider).toBeInstanceOf(OpenAiStoryContinuationProvider);
      expect(f.executor).toBeInstanceOf(StoryContinuationExecutor);
      expect(f.worker).toBeInstanceOf(StoryContinuationWorker);
    } finally { await f.module.close(); }
  });

  it('keeps absent provider and worker enablement OFF with the shared default policy', async () => {
    const f = fixture();
    const module = await f.builder.compile();
    try {
      await module.init();
      expect(module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY))
        .toMatchObject({ providerDeadlineMs: 90_000, executorDeadlineMs: 95_000,
          leaseMs: 125_000, drainMs: 35_000 });
      await expect(module.get(StoryContinuationProvider).readiness())
        .resolves.toEqual({ enabled: false, reason: 'provider_disabled' });
      expect(module.get(StoryContinuationWorker).readiness()).toMatchObject({ enabled: false });
      expect(f.config.get).not.toHaveBeenCalledWith('OPENAI_API_KEY');
      expect(f.queue.claimExpiredTerminal).not.toHaveBeenCalled();
      expect(f.queue.claimNext).not.toHaveBeenCalled();
    } finally { await module.close(); }
  });

  it.each([
    { name: 'absent preset', settings: {}, deadlineMs: 90_000, includeTiming: true },
    { name: 'explicit default', settings: { STORY_CONTINUATION_TIMING_PRESET: 'default' }, deadlineMs: 90_000, includeTiming: true },
    { name: 'explicit extended preset', settings: EXTENDED, deadlineMs: 180_000, includeTiming: true },
    { name: 'extended preset with matching timeout', settings: { ...EXTENDED, STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000' }, deadlineMs: 180_000, includeTiming: true },
    { name: 'legacy missing timing token', settings: {}, deadlineMs: 90_000, includeTiming: false },
  ])('enforces the real adapter timeout from $name DI', async ({ settings, deadlineMs, includeTiming }) => {
    const f = await runtime(settings, includeTiming);
    const signal = holdSyntheticTransport();
    try {
      await expect(f.provider.readiness()).resolves.toEqual({ enabled: true });
      const observed = f.provider.generate(REQUEST, new AbortController().signal)
        .then(() => ({ code: 'unexpected_success', retryable: true }), error => ({ code: error.code, retryable: error.retryable }));
      await jest.advanceTimersByTimeAsync(0);
      expect(transport).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(deadlineMs - 1);
      expect(signal()?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(observed).resolves.toEqual({ code: 'provider_outcome_unknown', retryable: false });
      expect(signal()?.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(240_000);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(f.queue.markDispatched).not.toHaveBeenCalled();
    } finally { await f.module.close(); }
  });

  it.each([
    { settings: {}, providerMs: 90_000, leaseMs: 125_000 },
    { settings: EXTENDED, providerMs: 180_000, leaseMs: 215_000 },
  ])('uses the real adapter/executor together with provider $providerMs and lease $leaseMs', async ({ settings, providerMs, leaseMs }) => {
    const f = await runtime(settings);
    const signal = holdSyntheticTransport();
    try {
      const observed = f.executor.executeOne('synthetic-worker');
      await jest.advanceTimersByTimeAsync(0);
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('synthetic-worker', leaseMs);
      expect(f.queue.claimNext).toHaveBeenCalledWith('synthetic-worker', leaseMs);
      expect(f.queue.markDispatched).toHaveBeenCalledTimes(1);
      expect(transport).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(providerMs - 1);
      expect(signal()?.aborted).toBe(false);
      expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(observed).resolves.toMatchObject({ status: 'failed' });
      expect(signal()?.aborted).toBe(true);
      expect(f.economics.failClaimedContinuation)
        .toHaveBeenCalledWith(expect.any(Object), 'provider_outcome_unknown', 'failed');
      assertNoRetry(f);
      await jest.advanceTimersByTimeAsync(240_000);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(f.queue.claimNext).toHaveBeenCalledTimes(1);
    } finally { await f.module.close(); }
  });

  it.each([
    { settings: {}, executorMs: 95_000, leaseMs: 125_000 },
    { settings: EXTENDED, executorMs: 185_000, leaseMs: 215_000 },
  ])('keeps the actual executor outer bound at $executorMs despite a non-cooperative generation stub', async ({ settings, executorMs, leaseMs }) => {
    const f = await runtime(settings);
    let signal: AbortSignal | undefined;
    // Only generation is replaced to isolate the outer executor timer from the adapter timer.
    const generation = jest.spyOn(f.provider, 'generate').mockImplementation((_request, providerSignal) => {
      signal = providerSignal;
      return new Promise(() => undefined);
    });
    try {
      const observed = f.executor.executeOne('synthetic-worker');
      await jest.advanceTimersByTimeAsync(0);
      expect(generation).toHaveBeenCalledTimes(1);
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('synthetic-worker', leaseMs);
      expect(f.queue.claimNext).toHaveBeenCalledWith('synthetic-worker', leaseMs);
      await jest.advanceTimersByTimeAsync(executorMs - 1);
      expect(signal?.aborted).toBe(false);
      expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(observed).resolves.toMatchObject({ status: 'failed' });
      expect(signal?.aborted).toBe(true);
      expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
      expect(f.economics.failClaimedContinuation)
        .toHaveBeenCalledWith(expect.any(Object), 'provider_outcome_unknown', 'failed');
      assertNoRetry(f);
      await jest.advanceTimersByTimeAsync(240_000);
      expect(generation).toHaveBeenCalledTimes(1);
    } finally { await f.module.close(); }
  });

  it.each([
    { name: 'default', settings: {}, drainMs: 35_000, leaseMs: 125_000 },
    { name: 'extended', settings: EXTENDED, drainMs: 35_000, leaseMs: 215_000 },
    { name: 'extended custom bounded drain', settings: { ...EXTENDED, STORY_CONTINUATION_WORKER_DRAIN_MS: '60000' }, drainMs: 60_000, leaseMs: 215_000 },
    { name: 'default drain ceiling', settings: { STORY_CONTINUATION_WORKER_DRAIN_MS: '120000' }, drainMs: 120_000, leaseMs: 125_000 },
  ])('enforces the real worker drain from $name DI at $drainMs', async ({ settings, drainMs, leaseMs }) => {
    const f = await runtime({ ...settings, STORY_CONTINUATION_WORKER_ENABLED: 'true' });
    let release: ((value: { status: 'idle' }) => void) | undefined;
    let workerSignal: AbortSignal | undefined;
    let expectedDrainFailure = false;
    // A controlled executor job isolates worker shutdown without a provider or DB dispatch.
    const execution = jest.spyOn(f.executor, 'executeOne').mockImplementation((_worker, signal) => {
      workerSignal = signal;
      return new Promise(resolve => { release = resolve; });
    });
    try {
      const timing = f.module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY);
      expect(timing).toMatchObject({ drainMs, leaseMs });
      expect(Object.isFrozen(timing)).toBe(true);
      await f.module.init();
      await jest.advanceTimersByTimeAsync(0);
      expect(execution).toHaveBeenCalledTimes(1);
      expect(f.worker.readiness().active).toBe(true);
      let drained = false;
      const observed = f.worker.beforeApplicationShutdown().then(
        () => { drained = true; return 'unexpected_success'; },
        error => { drained = true; return error.message; },
      );
      expect(workerSignal?.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(drainMs - 1);
      expect(drained).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(observed).resolves.toBe('story_worker_drain_timeout');
      expectedDrainFailure = true;
      release?.({ status: 'idle' });
      await jest.advanceTimersByTimeAsync(0);
      expect(execution).toHaveBeenCalledTimes(1);
      expect(f.queue.claimNext).not.toHaveBeenCalled();
    } finally {
      release?.({ status: 'idle' });
      await jest.advanceTimersByTimeAsync(0);
      await f.module.close().catch(error => {
        if (!expectedDrainFailure || error.message !== 'story_worker_drain_timeout') throw error;
      });
    }
  });

  it('does not opt into 180 seconds from REQUEST_TIMEOUT alone', async () => {
    const f = await runtime({ STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000' });
    const generation = jest.spyOn(f.provider, 'generate');
    try {
      expect(f.module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY))
        .toMatchObject({ providerDeadlineMs: 90_000, executorDeadlineMs: 95_000, leaseMs: 125_000 });
      await expect(f.provider.readiness()).resolves.toEqual({ enabled: false, reason: 'provider_limits_invalid' });
      await expect(f.executor.executeOne('synthetic-worker'))
        .resolves.toEqual({ status: 'disabled', reason: 'provider_limits_invalid' });
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('synthetic-worker', 125_000);
      expect(f.queue.claimNext).not.toHaveBeenCalled();
      expect(f.queue.markDispatched).not.toHaveBeenCalled();
      expect(generation).not.toHaveBeenCalled();
      assertNoRetry(f);
    } finally { await f.module.close(); }
  });

  it.each([
    { name: 'unknown preset', settings: { STORY_CONTINUATION_TIMING_PRESET: 'unsupported' } },
    { name: 'empty preset', settings: { STORY_CONTINUATION_TIMING_PRESET: '' } },
    { name: 'explicit default long timeout', settings: { STORY_CONTINUATION_TIMING_PRESET: 'default', STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000' } },
    { name: 'extended stale short timeout', settings: { ...EXTENDED, STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '90000' } },
    { name: 'extended oversized timeout', settings: { ...EXTENDED, STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180001' } },
    { name: 'extended unbounded timeout', settings: { ...EXTENDED, STORY_CONTINUATION_REQUEST_TIMEOUT_MS: 'Infinity' } },
    { name: 'default undersized drain', settings: { STORY_CONTINUATION_WORKER_DRAIN_MS: '34999' } },
    { name: 'extended undersized drain', settings: { ...EXTENDED, STORY_CONTINUATION_WORKER_DRAIN_MS: '34999' } },
    { name: 'oversized drain', settings: { ...EXTENDED, STORY_CONTINUATION_WORKER_DRAIN_MS: '120001' } },
    { name: 'malformed drain', settings: { STORY_CONTINUATION_WORKER_DRAIN_MS: '35000ms' } },
  ])('rejects $name in real timing factory construction before dispatch', async ({ settings }) => {
    const f = fixture({ ...ENABLED, ...settings, STORY_CONTINUATION_WORKER_ENABLED: 'true' });
    await expect(f.builder.compile()).rejects.toThrow('continuation_timing_policy_invalid');
    expect(f.queue.claimExpiredTerminal).not.toHaveBeenCalled();
    expect(f.queue.claimNext).not.toHaveBeenCalled();
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    expect(f.contextAssembler.assemble).not.toHaveBeenCalled();
    expect(f.economics.continuationExecutionAuthorization).not.toHaveBeenCalled();
    assertNoRetry(f);
  });

  it.each([
    { name: 'stale lease', override: { leaseMs: 125_000 } },
    { name: 'stale executor cutoff', override: { executorDeadlineMs: 95_000 } },
    { name: 'undersized shared drain', override: { drainMs: 34_999 } },
  ])('rejects an injected $name before constructing runnable DI consumers', async ({ override }) => {
    const f = fixture({ ...ENABLED, ...EXTENDED });
    const invalid = { ...createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 }), ...override };
    f.builder.overrideProvider(STORY_CONTINUATION_TIMING_POLICY).useValue(invalid);
    await expect(f.builder.compile()).rejects.toThrow('continuation_timing_policy_invalid');
    expect(f.queue.claimExpiredTerminal).not.toHaveBeenCalled();
    expect(f.queue.claimNext).not.toHaveBeenCalled();
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    assertNoRetry(f);
  });

  it.each([
    { name: 'provider timeout', key: 'STORY_CONTINUATION_REQUEST_TIMEOUT_MS', first: '180000', later: '90000' },
    { name: 'worker drain', key: 'STORY_CONTINUATION_WORKER_DRAIN_MS', first: '35000', later: '34999' },
  ])('rejects a changed $name between timing selection and consumer construction', async ({ key, first, later }) => {
    const settings: Settings = { ...ENABLED, ...EXTENDED };
    const f = fixture(settings);
    let reads = 0;
    f.config.get.mockImplementation(<T = string>(name: string) => {
      const value = name === key ? (++reads === 1 ? first : later) : settings[name];
      return value as T | undefined;
    });
    // Catch construction failure without serializing a Nest container or config payload.
    const outcome = await f.builder.compile().then(async module => {
      await module.close();
      return 'inconsistent_consumers_constructed';
    }, error => error.message);
    expect(outcome).toBe('continuation_timing_policy_invalid');
    expect(f.queue.claimExpiredTerminal).not.toHaveBeenCalled();
    expect(f.queue.claimNext).not.toHaveBeenCalled();
    expect(f.queue.markDispatched).not.toHaveBeenCalled();
    assertNoRetry(f);
  });

  it('snapshots a valid injected policy before later mutation of a caller-owned fixture', async () => {
    const mutable = { ...createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 }) };
    const f = fixture({ ...ENABLED, ...EXTENDED });
    f.builder.overrideProvider(STORY_CONTINUATION_TIMING_POLICY).useValue(mutable);
    const module = await f.builder.compile();
    const signal = holdSyntheticTransport();
    try {
      Object.assign(mutable, createStoryContinuationTimingPolicy());
      const observed = module.get(StoryContinuationExecutor).executeOne('synthetic-worker');
      await jest.advanceTimersByTimeAsync(0);
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('synthetic-worker', 215_000);
      expect(f.queue.claimNext).toHaveBeenCalledWith('synthetic-worker', 215_000);
      await jest.advanceTimersByTimeAsync(179_999);
      expect(signal()?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(observed).resolves.toMatchObject({ status: 'failed' });
      expect(signal()?.aborted).toBe(true);
      assertNoRetry(f);
    } finally { await module.close(); }
  });

  it('does not authorize a direct adapter fixture with an invalid coupled timing policy', async () => {
    const f = fixture(ENABLED);
    const config = readStoryContinuationOpenAiConfig({
      get: <T = string>(key: string) => f.config.get(key) as T | undefined,
    });
    const provider = new OpenAiStoryContinuationProvider({ ...config, timeoutMs: 180_000,
      timing: { ...createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 }), leaseMs: 125_000 } });
    await expect(provider.readiness())
      .resolves.toEqual({ enabled: false, reason: 'provider_timing_configuration_invalid' });
    await expect(provider.generate(REQUEST, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider_timing_configuration_invalid', retryable: false });
  });

  it('does not leak an extended singleton into a separate default Nest container', async () => {
    const extended = await runtime(EXTENDED);
    const defaults = await runtime();
    try {
      const selected = extended.module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY);
      const unselected = defaults.module.get<StoryContinuationTimingPolicy>(STORY_CONTINUATION_TIMING_POLICY);
      expect(selected.providerDeadlineMs).toBe(180_000);
      expect(unselected).toMatchObject({ providerDeadlineMs: 90_000, executorDeadlineMs: 95_000,
        leaseMs: 125_000, drainMs: 35_000 });
      expect(selected).not.toBe(unselected);
    } finally {
      await extended.module.close();
      await defaults.module.close();
    }
  });
});

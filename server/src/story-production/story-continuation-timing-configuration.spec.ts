import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ModerationService } from '../moderation/moderation.service';
import { StoryContinuationContextAssembler } from './story-continuation-context.assembler';
import { StoryContinuationExecutor } from './story-continuation.executor';
import {
  configInteger,
  type StoryContinuationConfigReader,
  readStoryContinuationOpenAiConfig,
} from './story-continuation-openai.config';
import { StoryContinuationProvider } from './story-continuation.provider';
import { StoryContinuationQueueRepository } from './story-continuation.repository';
import { STORY_CONTINUATION_OPENAI_PROVIDER, STORY_CONTINUATION_TIMING_PROVIDER } from './story-continuation-runtime.providers';
import {
  assertStoryContinuationTimingPolicy,
  createStoryContinuationTimingPolicy,
  storyContinuationDispatchFitsLease,
  StoryContinuationTimingPolicyError,
  type StoryContinuationTimingPolicy,
} from './story-continuation-timing.policy';
import { StoryEconomicsService } from './story-economics.service';

function reader(values: Readonly<Record<string, string | undefined>> = {}): StoryContinuationConfigReader {
  return { get: <T = string>(key: string) => values[key] as T | undefined };
}

// Test-only proposal fixture, not product support or runtime policy injection.
function prepareStoryContinuationTimingConfiguration(
  timing: StoryContinuationTimingPolicy = createStoryContinuationTimingPolicy(),
  reader: StoryContinuationConfigReader = { get: () => undefined },
) {
  assertStoryContinuationTimingPolicy(timing);
  if (configInteger(reader, 'STORY_CONTINUATION_REQUEST_TIMEOUT_MS', timing.providerDeadlineMs) !== timing.providerDeadlineMs ||
      configInteger(reader, 'STORY_CONTINUATION_WORKER_DRAIN_MS', timing.drainMs) !== timing.drainMs) {
    throw new StoryContinuationTimingPolicyError();
  }
  return Object.freeze({
    timing: Object.freeze({ ...timing }),
    environment: Object.freeze({
      STORY_CONTINUATION_REQUEST_TIMEOUT_MS: String(timing.providerDeadlineMs),
      STORY_CONTINUATION_WORKER_DRAIN_MS: String(timing.drainMs),
    }),
  });
}

const enabledFixture = {
  STORY_CONTINUATION_PROVIDER_ENABLED: 'true',
  STORY_CONTINUATION_PROVIDER: 'openai',
  STORY_CONTINUATION_OPENAI_MODEL: 'gpt-4.1-2025-04-14',
  STORY_CONTINUATION_RATE_CARD_ID: 'local-fixture-card',
  STORY_CONTINUATION_RATE_CARD_VERSION: 'local-fixture-v1',
  STORY_CONTINUATION_OPENAI_API_KEY: 'fake-local-fixture-key',
  STORY_CONTINUATION_VISUAL_ASSET_PATH: '/assets/story/local-fixture.webp',
};

describe('test-only continuation timing proposal fixture', () => {
  it('keeps the default provider, executor, lease and drain unchanged', () => {
    const prepared = prepareStoryContinuationTimingConfiguration();
    expect(prepared.timing).toMatchObject({
      providerDeadlineMs: 90_000, executorDeadlineMs: 95_000, leaseMs: 125_000, drainMs: 35_000,
    });
    expect(prepared.environment).toEqual({
      STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '90000',
      STORY_CONTINUATION_WORKER_DRAIN_MS: '35000',
    });
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.timing)).toBe(true);
    expect(Object.isFrozen(prepared.environment)).toBe(true);
  });

  it('prepares 180 seconds only from an explicitly selected coupled policy', () => {
    const timing = createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 });
    const prepared = prepareStoryContinuationTimingConfiguration(timing, reader({
      STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000',
      STORY_CONTINUATION_WORKER_DRAIN_MS: '35000',
    }));
    expect(prepared.timing).toMatchObject({
      providerDeadlineMs: 180_000, executorDeadlineMs: 185_000, leaseMs: 215_000, drainMs: 35_000,
    });
    expect(prepared.environment).toEqual({
      STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000',
      STORY_CONTINUATION_WORKER_DRAIN_MS: '35000',
    });
    const now = 1_000_000;
    expect(storyContinuationDispatchFitsLease(timing, now + 200_000, now)).toBe(true);
    expect(storyContinuationDispatchFitsLease(timing, now + 199_999, now)).toBe(false);
    expect(storyContinuationDispatchFitsLease(timing, now + 125_000, now)).toBe(false);
    expect(prepareStoryContinuationTimingConfiguration().timing.providerDeadlineMs).toBe(90_000);
  });

  it('supplies proposed environment entries without enabling or reading a provider', () => {
    const get = jest.fn().mockReturnValue(undefined);
    const timing = createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 });
    expect(prepareStoryContinuationTimingConfiguration(timing, { get }).environment)
      .toMatchObject({ STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000' });
    expect(get.mock.calls).toEqual([
      ['STORY_CONTINUATION_REQUEST_TIMEOUT_MS'], ['STORY_CONTINUATION_WORKER_DRAIN_MS'],
    ]);
  });

  it('does not let an environment value silently select a longer policy', () => {
    expect(() => prepareStoryContinuationTimingConfiguration(undefined, reader({
      STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000',
    }))).toThrow('continuation_timing_policy_invalid');
  });

  it.each([
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '90000' },
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180001' },
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '0' },
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '' },
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: 'Infinity' },
    { STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000.5' },
    { STORY_CONTINUATION_WORKER_DRAIN_MS: '34999' },
    { STORY_CONTINUATION_WORKER_DRAIN_MS: '35001' },
  ])('rejects inconsistent or unbounded environment durations %#', values => {
    const timing = createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 });
    expect(() => prepareStoryContinuationTimingConfiguration(timing, reader(values)))
      .toThrow('continuation_timing_policy_invalid');
  });

  it('rejects stale executor or lease values even with a matching environment', () => {
    const timing = createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 });
    for (const stale of [{ executorDeadlineMs: 95_000 }, { leaseMs: 125_000 }]) {
      expect(() => prepareStoryContinuationTimingConfiguration({ ...timing, ...stale }, reader({
        STORY_CONTINUATION_REQUEST_TIMEOUT_MS: '180000',
      }))).toThrow('continuation_timing_policy_invalid');
    }
  });

  it('snapshots validated timing so later caller mutations cannot desynchronize the proposal', () => {
    const timing = { ...createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 }) };
    const prepared = prepareStoryContinuationTimingConfiguration(timing);
    timing.providerDeadlineMs = 90_000;
    expect(prepared.timing.providerDeadlineMs).toBe(180_000);
    expect(prepared.environment.STORY_CONTINUATION_REQUEST_TIMEOUT_MS).toBe('180000');
  });
});

describe('actual runtime policy remains default-only', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
    jest.useRealTimers();
  });

  async function runtime(values: Readonly<Record<string, string>> = {}, hangingProvider = false) {
    const queue = {
      claimExpiredTerminal: jest.fn().mockResolvedValue(null),
      claimNext: jest.fn().mockResolvedValue(hangingProvider ? {
        continuationId: 'local-fixture-id', attemptCount: 1, maxAttempts: 3,
        request: { locale: 'en', inputTokenLimit: 1_000, outputTokenLimit: 500 },
      } : null),
      markDispatched: jest.fn().mockResolvedValue(undefined),
      releaseForRetry: jest.fn(), releaseNotAcceptedForRetry: jest.fn(),
    };
    const economics = {
      continuationExecutionAuthorization: jest.fn().mockResolvedValue({ allowed: true }),
      failClaimedContinuation: jest.fn().mockResolvedValue(undefined),
      settleClaimedContinuation: jest.fn(),
    };
    const contextAssembler = { assemble: jest.fn().mockResolvedValue({
      sourceScene: { beats: [{ beatType: 'paragraph', content: 'Synthetic local fixture.' }] },
    }) };
    const provider = {
      readiness: jest.fn().mockResolvedValue({ enabled: true }),
      preflight: jest.fn().mockResolvedValue({ supported: true }),
      generate: jest.fn().mockImplementation((_request: unknown, signal: AbortSignal) => {
        providerSignal = signal;
        return new Promise(() => undefined);
      }),
    };
    let providerSignal: AbortSignal | undefined;
    const builder = Test.createTestingModule({ providers: [
      { provide: ConfigService, useValue: reader({ ...enabledFixture, ...values }) },
      { provide: StoryContinuationQueueRepository, useValue: queue },
      { provide: StoryEconomicsService, useValue: economics },
      { provide: StoryContinuationContextAssembler, useValue: contextAssembler },
      { provide: ModerationService, useValue: { preview: jest.fn() } },
      StoryContinuationExecutor,
      STORY_CONTINUATION_OPENAI_PROVIDER,
      STORY_CONTINUATION_TIMING_PROVIDER,
    ] });
    if (hangingProvider) builder.overrideProvider(StoryContinuationProvider).useValue(provider);
    const module = await builder.compile();
    return { module, queue, economics, provider, signal: () => providerSignal };
  }

  it('injects an enabled provider at the unchanged 90-second default without network I/O', async () => {
    const f = await runtime();
    try {
      await expect(f.module.get(StoryContinuationProvider).readiness()).resolves.toEqual({ enabled: true });
      expect(readStoryContinuationOpenAiConfig(reader(enabledFixture)).timeoutMs).toBe(90_000);
      await expect(f.module.get(StoryContinuationExecutor).executeOne('local-fixture-worker'))
        .resolves.toEqual({ status: 'idle' });
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('local-fixture-worker', 125_000);
      expect(f.queue.claimNext).toHaveBeenCalledWith('local-fixture-worker', 125_000);
    } finally { await f.module.close(); }
  });

  it('does not activate a 180-second deadline without an explicit timing preset', async () => {
    const proposed = prepareStoryContinuationTimingConfiguration(
      createStoryContinuationTimingPolicy({ providerDeadlineMs: 180_000 }),
    );
    const f = await runtime(proposed.environment);
    try {
      await expect(f.module.get(StoryContinuationProvider).readiness())
        .resolves.toEqual({ enabled: false, reason: 'provider_limits_invalid' });
      await expect(f.module.get(StoryContinuationExecutor).executeOne('local-fixture-worker'))
        .resolves.toEqual({ status: 'disabled', reason: 'provider_limits_invalid' });
      expect(f.queue.claimExpiredTerminal).toHaveBeenCalledWith('local-fixture-worker', 125_000);
      expect(f.queue.claimNext).not.toHaveBeenCalled();
      expect(f.queue.markDispatched).not.toHaveBeenCalled();
    } finally { await f.module.close(); }
  });

  it('keeps a 95-second executor bound, aborts once and never retries an unknown outcome', async () => {
    jest.useFakeTimers();
    const f = await runtime({}, true);
    try {
      const pending = f.module.get(StoryContinuationExecutor).executeOne('local-fixture-worker');
      await jest.advanceTimersByTimeAsync(0);
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(f.queue.claimNext).toHaveBeenCalledWith('local-fixture-worker', 125_000);
      await jest.advanceTimersByTimeAsync(94_999);
      expect(f.signal()?.aborted).toBe(false);
      expect(f.economics.failClaimedContinuation).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ status: 'failed' });
      expect(f.signal()?.aborted).toBe(true);
      expect(f.economics.failClaimedContinuation).toHaveBeenCalledTimes(1);
      expect(f.economics.failClaimedContinuation)
        .toHaveBeenCalledWith(expect.any(Object), 'provider_outcome_unknown', 'failed');
      expect(f.queue.releaseForRetry).not.toHaveBeenCalled();
      expect(f.queue.releaseNotAcceptedForRetry).not.toHaveBeenCalled();
      expect(f.economics.settleClaimedContinuation).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(180_000);
      expect(f.provider.generate).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally { await f.module.close(); }
  });
});

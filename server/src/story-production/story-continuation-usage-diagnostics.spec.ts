import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import {
  StoryContinuationProviderError,
  storyContinuationUsageDiagnostics,
  type StoryContinuationProviderRequest,
  type StoryContinuationUsageDiagnostics,
} from './story-continuation.provider';
import { calculateStoryUsageCost } from './story-economics.policy';

// QA-only: 22 cases using the actual adapter/normalizer and synthetic transport.
// No executor, settlement, DB, signed identity, paid request or model-quality claim.
const config: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'diagnostics-test-card', rateCardVersion: 'v1', apiKey: 'synthetic-diagnostics-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};
const measured = { inputTokens: 120, outputTokens: 100, cachedInputTokens: 30, imageUnits: 0 };

function request(): StoryContinuationProviderRequest {
  return {
    operationId: 'usage-diagnostics', locale: 'en', contextFingerprint: 'fingerprint',
    provider: config.provider, model: config.model,
    rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: 'story-continuation-v5', outputSchemaVersion: 'story-continuation-output-v1',
    inputTokenLimit: 8_192, outputTokenLimit: 500,
    approvedContext: {
      sourceScene: { title: 'Crossroads', beats: [{ beatType: 'paragraph', content: 'Two paths diverge.' }] },
      selectedChoice: { label: 'Take the left path' }, path: [], memories: [],
    },
  };
}

function wireUsage(reasoningTokens = 70): Record<string, unknown> {
  return {
    input_tokens: 120, input_tokens_details: { cached_tokens: 30 }, output_tokens: 100,
    output_tokens_details: { reasoning_tokens: reasoningTokens }, total_tokens: 220,
  };
}

function output() {
  return {
    title: { en: 'The Left Path' },
    beats: [{ beatType: 'paragraph', content: { en: 'The gate appears.' } }],
    nextChoices: [
      { choiceKey: 'open-gate', label: { en: 'Open the gate' } },
      { choiceKey: 'ask-guard', label: { en: 'Question the guard' } },
      { choiceKey: 'turn-back', label: { en: 'Turn back' } },
    ],
    ending: null,
  };
}

function envelope(change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: config.model, service_tier: 'default', status: 'completed',
    output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output()) }] }],
    usage: wireUsage(), ...change,
  };
}

function fixture(value: Record<string, unknown>) {
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockImplementation(async () => new Response(JSON.stringify(value)));
  return { transport, provider: new OpenAiStoryContinuationProvider(config, transport) };
}

async function completed(reasoningTokens: number) {
  const f = fixture(envelope({ usage: wireUsage(reasoningTokens) }));
  const result = await f.provider.generate(request(), new AbortController().signal);
  expect(f.transport).toHaveBeenCalledTimes(1);
  return result;
}

async function rejected(value: Record<string, unknown>, code: string) {
  const f = fixture(value);
  const error: unknown = await f.provider.generate(request(), new AbortController().signal)
    .then(() => undefined, (error: unknown) => error);
  expect(error).toBeInstanceOf(StoryContinuationProviderError);
  if (!(error instanceof StoryContinuationProviderError)) {
    throw new Error('Expected an actual provider rejection');
  }
  expect(error).toMatchObject({ code, message: code, retryable: false });
  expect(f.transport).toHaveBeenCalledTimes(1);
  const legacy = new StoryContinuationProviderError(code, false, error.usage);
  expect(JSON.stringify(error)).toBe(JSON.stringify(legacy));
  expect(JSON.stringify(error)).not.toMatch(/usageDiagnostics|reasoningTokens|reasoning_tokens|synthetic-diagnostics-key/);
  return error;
}

const rejectedOutputs: Array<{ name: string; change: Record<string, unknown>; code: string }> = [
  { name: 'failed', change: { status: 'failed' }, code: 'provider_response_failed' },
  { name: 'incomplete', change: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
    code: 'provider_output_token_limit' },
  { name: 'malformed prose', change: { output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'synthetic non-JSON prose' }] }] }, code: 'provider_malformed_output' },
];
const untrusted: Array<{ name: string; change: Record<string, unknown>; code: string }> = [
  { name: 'wrong model', change: { model: 'different-model' }, code: 'provider_response_model_mismatch' },
  { name: 'wrong tier', change: { service_tier: 'priority' }, code: 'provider_response_service_tier_mismatch' },
  { name: 'untrusted status', change: { status: 'in_progress' }, code: 'provider_incomplete_output' },
];
const invalidCounts = [
  { name: 'negative', count: -1 },
  { name: 'fractional', count: 0.5 },
  { name: 'above measured output', count: 101 },
  { name: 'unsafe integer', count: Number.MAX_SAFE_INTEGER + 1 },
];

describe('Story continuation internal usage diagnostics (synthetic, no provider calls)', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
  });
  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
  });

  it.each([0, 70, 100])('keeps verified reasoning %i separate from the four success usage counters', async count => {
    const result = await completed(count);
    expect(result.usageDiagnostics).toStrictEqual({ reasoningTokens: count });
    expect(Object.isFrozen(result.usageDiagnostics)).toBe(true);
    expect(result.usage).toStrictEqual(measured);
    expect(JSON.stringify(result.usage)).toBe(JSON.stringify(measured));
    expect(result.title).toStrictEqual(output().title);
    expect(result.beats).toStrictEqual(output().beats);
    expect(result.nextChoices).toStrictEqual(output().nextChoices);
  });

  it.each(rejectedOutputs)('retains verified diagnostics on $name without exposing them in error JSON',
    async ({ change, code }) => {
      const error = await rejected(envelope(change), code);
      expect(error.usage).toStrictEqual(measured);
      expect(Object.isFrozen(error.usage)).toBe(true);
      expect(error.usageDiagnostics).toStrictEqual({ reasoningTokens: 70 });
      expect(Object.isFrozen(error.usageDiagnostics)).toBe(true);
      expect(Object.getOwnPropertyDescriptor(error, 'usageDiagnostics'))
        .toMatchObject({ enumerable: false, writable: false });
    });

  it.each(untrusted)('does not promote plausible usage or diagnostics for $name', async ({ change, code }) => {
    const error = await rejected(envelope(change), code);
    expect(error.usage).toBeUndefined();
    expect(error.usageDiagnostics).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(error, 'usageDiagnostics')).toBe(false);
  });

  it('keeps missing reasoning details unknown while preserving verified base usage and the legacy code', async () => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), output_tokens_details: undefined } }),
      'provider_malformed_response');
    expect(error.usage).toStrictEqual(measured);
    expect(error.usageDiagnostics).toBeUndefined();
  });

  it('does not turn an absent reasoning count into a verified zero', async () => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), output_tokens_details: {} } }),
      'provider_usage_invalid');
    expect(error.usage).toStrictEqual(measured);
    expect(error.usageDiagnostics).toBeUndefined();
  });

  it('cannot preserve diagnostics when total tokens fail base-usage verification', async () => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), total_tokens: 221 } }),
      'provider_usage_invalid');
    expect(error.usage).toBeUndefined();
    expect(error.usageDiagnostics).toBeUndefined();
  });

  it.each(invalidCounts)('rejects $name diagnostics without changing known four-counter error usage',
    async ({ count }) => {
      expect(storyContinuationUsageDiagnostics({ reasoningTokens: count }, measured)).toBeUndefined();
      const error = await rejected(envelope({ usage: wireUsage(count) }), 'provider_usage_invalid');
      expect(error.usage).toStrictEqual(measured);
      expect(error.usageDiagnostics).toBeUndefined();
    });

  it('normalizes observed zero but omits unknown or nonfinite diagnostics without mutating inputs', () => {
    const zero = { reasoningTokens: 0 };
    const before = { ...measured };
    const known = storyContinuationUsageDiagnostics(zero, measured);
    expect(known).toStrictEqual({ reasoningTokens: 0 });
    expect(Object.isFrozen(known)).toBe(true);
    expect(known).not.toBe(zero);
    expect(storyContinuationUsageDiagnostics(undefined, measured)).toBeUndefined();
    expect(storyContinuationUsageDiagnostics({ reasoningTokens: 0 }, undefined)).toBeUndefined();
    expect(storyContinuationUsageDiagnostics({ reasoningTokens: NaN }, measured)).toBeUndefined();
    expect(storyContinuationUsageDiagnostics({ reasoningTokens: Infinity }, measured)).toBeUndefined();
    expect(zero).toStrictEqual({ reasoningTokens: 0 });
    expect(Object.isFrozen(zero)).toBe(false);
    expect(measured).toStrictEqual(before);
  });

  it('rejects a real reasoning getter without executing it in normalization or the error constructor', () => {
    const getter = jest.fn(() => { throw new Error('synthetic getter must not execute'); });
    const candidate = Object.defineProperty({}, 'reasoningTokens', { enumerable: true, get: getter });
    expect(storyContinuationUsageDiagnostics(candidate, measured)).toBeUndefined();
    const error = new StoryContinuationProviderError('provider_output_invalid', false, measured,
      candidate as StoryContinuationUsageDiagnostics);
    expect(error.usage).toStrictEqual(measured);
    expect(error.usageDiagnostics).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(candidate, 'reasoningTokens')?.get).toBe(getter);
  });

  it('does not accept inherited reasoning data as an observed own scalar', () => {
    const candidate: unknown = Object.create({ reasoningTokens: 70 });
    expect(storyContinuationUsageDiagnostics(candidate, measured)).toBeUndefined();
  });

  it('stores a sanitized frozen nonenumerable error diagnostic without changing legacy error serialization', () => {
    const candidate = { reasoningTokens: 70, extra: 'synthetic-private-diagnostic' };
    const error = new StoryContinuationProviderError('provider_output_invalid', false, measured, candidate);
    const legacy = new StoryContinuationProviderError('provider_output_invalid', false, measured);
    expect(error.usageDiagnostics).toStrictEqual({ reasoningTokens: 70 });
    expect(Object.isFrozen(error.usageDiagnostics)).toBe(true);
    expect(error.usage).toStrictEqual(measured);
    expect(Object.isFrozen(error.usage)).toBe(true);
    expect(Object.keys(error)).not.toContain('usageDiagnostics');
    expect(JSON.stringify(error)).toBe(JSON.stringify(legacy));
    expect(JSON.stringify(error)).not.toContain('synthetic-private-diagnostic');
    expect(candidate).toStrictEqual({ reasoningTokens: 70, extra: 'synthetic-private-diagnostic' });
    expect(Object.isFrozen(candidate)).toBe(false);
  });

  it('keeps actual four-counter cost identical without adding or subtracting reasoning twice', async () => {
    const rate = { inputCostPerMillion: 2, outputCostPerMillion: 10, cachedInputCostPerMillion: 1, imageUnitCost: 5 };
    const expectedCost = calculateStoryUsageCost(rate, measured);
    for (const count of [0, 70, 100]) {
      const result = await completed(count);
      expect(result.usage.outputTokens).toBe(100);
      expect(result.usageDiagnostics).toStrictEqual({ reasoningTokens: count });
      expect(calculateStoryUsageCost(rate, result.usage)).toBe(expectedCost);
      expect(JSON.stringify(result.usage)).toBe(JSON.stringify(measured));
    }
  });

  it('keeps earlier invalid-input rejection ahead of missing metadata without inventing observations', async () => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), input_tokens: -1,
      total_tokens: 99, output_tokens_details: undefined } }), 'provider_usage_invalid');
    expect(error.usage).toBeUndefined();
    expect(error.usageDiagnostics).toBeUndefined();
  });
});

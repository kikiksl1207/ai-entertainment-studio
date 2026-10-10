import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';

// Real adapter with synthetic Responses transport. No executor, settlement, DB or paid call.
const config: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'metadata-test-card', rateCardVersion: 'v1', apiKey: 'fake-test-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};
const measured = { inputTokens: 120, outputTokens: 100, cachedInputTokens: 30, imageUnits: 0 };

function request(): StoryContinuationProviderRequest {
  return {
    operationId: 'metadata-usage', locale: 'en', contextFingerprint: 'fingerprint',
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

function wireUsage(): Record<string, unknown> {
  return {
    input_tokens: 120, input_tokens_details: { cached_tokens: 30 }, output_tokens: 100,
    output_tokens_details: { reasoning_tokens: 70 }, total_tokens: 220,
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
    ], ending: null,
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

function fixture(value: Record<string, unknown> = envelope()) {
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockImplementation(async () => new Response(JSON.stringify(value)));
  return { transport, provider: new OpenAiStoryContinuationProvider(config, transport) };
}

const metadataRejections = [
  { name: 'null details', details: null, code: 'provider_malformed_response' },
  { name: 'array details', details: [], code: 'provider_malformed_response' },
  { name: 'missing reasoning count', details: {}, code: 'provider_usage_invalid' },
  { name: 'null reasoning count', details: { reasoning_tokens: null }, code: 'provider_usage_invalid' },
  { name: 'string reasoning count', details: { reasoning_tokens: 'PRIVATE_METADATA' }, code: 'provider_usage_invalid' },
  { name: 'negative reasoning count', details: { reasoning_tokens: -1 }, code: 'provider_usage_invalid' },
  { name: 'fractional reasoning count', details: { reasoning_tokens: 0.5 }, code: 'provider_usage_invalid' },
  { name: 'unsafe reasoning count', details: { reasoning_tokens: Number.MAX_SAFE_INTEGER + 1 }, code: 'provider_usage_invalid' },
  { name: 'reasoning above output', details: { reasoning_tokens: 101 }, code: 'provider_usage_invalid' },
];

const invalidBaseUsage = [
  { name: 'negative input', change: { input_tokens: -1 }, code: 'provider_usage_invalid' },
  { name: 'fractional input', change: { input_tokens: 0.5 }, code: 'provider_usage_invalid' },
  { name: 'null cached details', change: { input_tokens_details: null }, code: 'provider_malformed_response' },
  { name: 'cached above input', change: { input_tokens_details: { cached_tokens: 121 } }, code: 'provider_usage_invalid' },
  { name: 'total mismatch', change: { total_tokens: 221 }, code: 'provider_usage_invalid' },
  { name: 'missing total', change: { total_tokens: undefined }, code: 'provider_usage_invalid' },
  { name: 'input outside PostgreSQL INTEGER', change: { input_tokens: 2_147_483_648, total_tokens: 2_147_483_748 }, code: 'provider_usage_invalid' },
  { name: 'output outside PostgreSQL INTEGER', change: { output_tokens: 2_147_483_648, total_tokens: 2_147_483_768 }, code: 'provider_usage_invalid' },
];

// Legacy parser order: counts precede reasoning; cached/total relations and PG bounds follow it.
const overlappingRejections = [
  { name: 'negative input before missing details', change: { input_tokens: -1, output_tokens_details: undefined }, code: 'provider_usage_invalid' },
  { name: 'missing details before cached relation', change: { input_tokens_details: { cached_tokens: 121 }, output_tokens_details: undefined }, code: 'provider_malformed_response' },
  { name: 'null details before total relation', change: { total_tokens: 221, output_tokens_details: null }, code: 'provider_malformed_response' },
  { name: 'missing details before PG input bound', change: { input_tokens: 2_147_483_648, total_tokens: 2_147_483_748, output_tokens_details: undefined }, code: 'provider_malformed_response' },
];

const untrustedEnvelopes = [
  { name: 'wrong model', change: { model: 'different-model' }, code: 'provider_response_model_mismatch' },
  { name: 'missing tier', change: { service_tier: undefined }, code: 'provider_response_service_tier_mismatch' },
  { name: 'nondefault tier', change: { service_tier: 'priority' }, code: 'provider_response_service_tier_mismatch' },
  { name: 'nonterminal status', change: { status: 'in_progress' }, code: 'provider_incomplete_output' },
];

// 37 declared cases: one RED, then 9 + 3 + 3 + 8 + 4 + 4 + 5 related cases.
describe('OpenAi continuation metadata rejection usage (synthetic transport only)', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
  });
  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
  });

  async function rejected(value: Record<string, unknown>, code: string) {
    const f = fixture(value);
    const error = await f.provider.generate(request(), new AbortController().signal).catch(value => value);
    expect(error).toBeInstanceOf(StoryContinuationProviderError);
    expect(error).toMatchObject({ code, message: code, retryable: false });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_METADATA|PRIVATE_PROSE|fake-test-key|reasoning_tokens|reasoningTokens|diagnostics/);
    return error as StoryContinuationProviderError;
  }

  it('BODY-METADATA-USAGE-RED: missing reasoning details preserve verified four usage counters', async () => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), output_tokens_details: undefined } }),
      'provider_malformed_response');
    expect(error.usage).toEqual(measured);
    expect(Object.isFrozen(error.usage)).toBe(true);
  });

  it.each(metadataRejections)('BODY-METADATA-USAGE: $name preserves base usage without accepting output', async ({ details, code }) => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), output_tokens_details: details } }), code);
    expect(error.usage).toEqual(measured);
    expect(Object.isFrozen(error.usage)).toBe(true);
  });

  it.each(['incomplete', 'failed', 'cancelled'])('BODY-METADATA-USAGE: missing metadata in trusted %s retains its earlier rejection', async status => {
    const error = await rejected(envelope({ status, output: null,
      incomplete_details: { reason: 'max_output_tokens' },
      usage: { ...wireUsage(), output_tokens_details: undefined } }), 'provider_malformed_response');
    expect(error.usage).toEqual(measured);
  });

  it.each([0, 70, 100])('BODY-METADATA-USAGE: valid reasoning %s keeps the original four-field success contract', async reasoning => {
    const f = fixture(envelope({ usage: { ...wireUsage(), output_tokens_details: { reasoning_tokens: reasoning } } }));
    const result = await f.provider.generate(request(), new AbortController().signal);
    expect(result.usage).toEqual(measured);
    expect(result.title).toEqual(output().title);
    expect(result.beats).toEqual(output().beats);
    expect(result.nextChoices).toEqual(output().nextChoices);
    expect(result.ending).toBeUndefined();
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.usage)).not.toMatch(/reasoning|diagnostics/);
  });

  it.each(invalidBaseUsage)('BODY-METADATA-USAGE: $name stays unknown', async ({ change, code }) => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), ...change } }), code);
    expect(error.usage).toBeUndefined();
  });

  it.each(overlappingRejections)('BODY-METADATA-USAGE: $name preserves legacy code priority and unknown usage', async ({ change, code }) => {
    const error = await rejected(envelope({ usage: { ...wireUsage(), ...change } }), code);
    expect(error.usage).toBeUndefined();
  });

  it.each(untrustedEnvelopes)('BODY-METADATA-USAGE: $name cannot promote plausible base usage', async ({ change, code }) => {
    const error = await rejected(envelope({ ...change,
      usage: { ...wireUsage(), output_tokens_details: undefined } }), code);
    expect(error.usage).toBeUndefined();
  });

  it('BODY-METADATA-USAGE: malformed prose still retains only measured usage without transport retry', async () => {
    const error = await rejected(envelope({ output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{PRIVATE_PROSE' }] }] }), 'provider_malformed_output');
    expect(error.usage).toEqual(measured);
  });

  it('BODY-METADATA-USAGE: incomplete output keeps its token-limit rejection and measured usage', async () => {
    const error = await rejected(envelope({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', role: 'assistant', status: 'incomplete',
        content: [{ type: 'output_text', text: 'PRIVATE_PROSE' }] }] }), 'provider_output_token_limit');
    expect(error.usage).toEqual(measured);
  });

  it('BODY-METADATA-USAGE: INTEGER maximum base counters survive rejected metadata without accepting over-cap output', async () => {
    const maximum = 2_147_483_647;
    const error = await rejected(envelope({ usage: { input_tokens: maximum,
      input_tokens_details: { cached_tokens: maximum }, output_tokens: maximum,
      output_tokens_details: { reasoning_tokens: -1 }, total_tokens: maximum * 2 } }), 'provider_usage_invalid');
    expect(error.usage).toEqual({ inputTokens: maximum, outputTokens: maximum, cachedInputTokens: maximum, imageUnits: 0 });
  });

  it('BODY-METADATA-USAGE: timeout remains unknown even when transport ignores cancellation', async () => {
    jest.useFakeTimers();
    try {
      const f = fixture();
      f.transport.mockImplementation(() => new Promise<Response>(() => undefined));
      const pending = f.provider.generate(request(), new AbortController().signal).catch(value => value);
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(config.timeoutMs);
      const error = await pending;
      expect(error).toBeInstanceOf(StoryContinuationProviderError);
      expect(error).toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
      expect(error.usage).toBeUndefined();
      expect(f.transport).toHaveBeenCalledTimes(1);
      expect((f.transport.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });

  it('BODY-METADATA-USAGE: arbitrary transport error cannot attach fabricated measured usage', async () => {
    const f = fixture();
    f.transport.mockRejectedValue(Object.assign(new Error('PRIVATE_PROSE fake-test-key'), { usage: measured }));
    const error = await f.provider.generate(request(), new AbortController().signal).catch(value => value);
    expect(error).toBeInstanceOf(StoryContinuationProviderError);
    expect(error).toMatchObject({ code: 'provider_outcome_unknown', retryable: false });
    expect(error.usage).toBeUndefined();
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_PROSE|fake-test-key/);
    expect(f.transport).toHaveBeenCalledTimes(1);
  });
});

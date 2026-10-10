import { inspectStoryContinuationFixedCapFit } from './story-continuation-fixed-cap-fit';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import * as configuration from './story-continuation-openai.config';
import * as prompt from './story-continuation-openai.prompt';
import * as tokenizer from './story-continuation-tokenizer';
import {
  NARRATIVE_LENGTH_MEASUREMENT,
  sourceStoryContinuationLengthBounds,
} from './story-continuation-length.policy';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
} from './story-continuation-openai.schema';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';

const INPUT_LIMIT = 32_768;
const OUTPUT_LIMIT = 8_192;
const MODEL = 'gpt-4.1-2025-04-14';
const PRIVATE = 'PRIVATE_FIXED_FIT_SENTINEL';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const prose: Record<(typeof locales)[number], string> = {
  ko: '\ud569\uc131 \ubcf5\ub3c4\uc5d0\uc11c \ubc30\uc6b0\uac00 \ubb38\uc744 \uc5f4\uc5c8\ub2e4.',
  en: 'An actor opened the door in the synthetic corridor.',
  ja: '\u5408\u6210\u306e\u5eca\u4e0b\u3067\u4ff3\u512a\u304c\u6249\u3092\u958b\u3051\u305f\u3002',
  'zh-Hans': '\u6f14\u5458\u5728\u5408\u6210\u8d70\u5eca\u91cc\u6253\u5f00\u4e86\u95e8\u3002',
  'zh-Hant': '\u6f14\u54e1\u5728\u5408\u6210\u8d70\u5eca\u88e1\u6253\u958b\u4e86\u9580\u3002',
};

type Request = StoryContinuationProviderRequest;
type DiagnosticConfig = Parameters<typeof inspectStoryContinuationFixedCapFit>[1];
type Diagnostic = ReturnType<typeof inspectStoryContinuationFixedCapFit>;

// Already projected synthetic constraints, not proof of current source ownership or human approval.
function fixture(locale: (typeof locales)[number] = 'en', model = MODEL) {
  const config: StoryContinuationOpenAiConfig = {
    enabled: true, provider: 'openai', model,
    rateCardId: 'synthetic-fit-card', rateCardVersion: 'v1', apiKey: 'synthetic-not-a-key',
    timeoutMs: 100, maxInputTokens: INPUT_LIMIT, maxOutputTokens: OUTPUT_LIMIT,
    maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
  };
  const request: Request = {
    operationId: 'synthetic-fixed-fit', locale, contextFingerprint: 'synthetic-fit-context',
    provider: config.provider, model, rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: INPUT_LIMIT, outputTokenLimit: OUTPUT_LIMIT,
    approvedContext: {
      sourceScene: { title: 'Synthetic corridor', beats: [{ beatType: 'paragraph', content: prose[locale] }] },
      selectedChoice: { label: 'Open the door' }, path: [], memories: [],
      generationProfile: {
        schemaVersion: 'creator-generation-profile-v1',
        sections: [{ key: 'writing_style', value: {
          referenceScope: 'production_constraint', summary: 'Keep the approved measured voice.',
          observations: [{ title: 'Rhythm', detail: 'Keep complete dialogue sentences.', referenceScope: 'writing_pattern' }],
          categories: [{ category: 'voice', observations: ['Use concrete verbs.', 'Retain deliberate pauses.'] }],
        } }],
      },
    },
  };
  return { request, config };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function inspect(request: Request, config: DiagnosticConfig): Diagnostic {
  const result = inspectStoryContinuationFixedCapFit(request, config);
  expect(result).not.toBeInstanceOf(Error);
  expect(result).toMatchObject({
    version: 'story-fixed-cap-fit-v1', budgetMethod: tokenizer.STORY_CONTINUATION_TOKEN_BUDGET_METHOD,
    contextSource: 'caller_supplied_context', fixedInputTokenLimit: INPUT_LIMIT, fixedOutputTokenLimit: OUTPUT_LIMIT,
    outputFit: 'unmeasured', multiStageFit: 'unimplemented', currentApprovalVerified: false,
    dispatchAuthorized: false, semanticQualityVerified: false, providerCalls: 0,
  });
  expect(['within_policy_bound', 'exceeds_policy_bound', 'unmeasured']).toContain(result.inputFit);
  expect(result.reason).toMatch(/^[a-z][a-z0-9_]+$/);
  for (const [key, value] of Object.entries(result)) {
    if (key !== 'narrativeLength' && value !== null) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  }
  if (result.narrativeLength !== null) {
    expect(result.narrativeLength.measurement).toBe(NARRATIVE_LENGTH_MEASUREMENT);
    for (const key of ['referenceUnits', 'minUnits', 'targetUnits', 'maxUnits'] as const) {
      expect(Number.isSafeInteger(result.narrativeLength[key])).toBe(true);
      expect(result.narrativeLength[key]).toBeGreaterThan(0);
    }
  }
  for (const value of [result.inputTokenBudget, result.requestBytes]) {
    if (value !== null) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  }
  expect([true, false, null]).toContain(result.writingStylePresent);
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(PRIVATE);
  expect(serialized).not.toMatch(/"(?:apiKey|operationId|contextFingerprint|sourceHash|requestHash|rawRequest|approvedContext|sourceScene|generationProfile|request|config|model|rateCardId|error|stack)"/);
  expect(serialized).not.toMatch(/\b[a-f0-9]{40}(?:[a-f0-9]{24})?\b/i);
  return result;
}

function expectUnmeasured(result: Diagnostic, reason: string) {
  expect(result).toMatchObject({ inputFit: 'unmeasured', reason, inputTokenBudget: null });
  expect(result.inputTokenBudget).not.toBe(0);
}

type InvalidRequest = { name: string; reason: string; change: (request: Request) => void };
const invalidRequests: InvalidRequest[] = [
  { name: 'prompt version', reason: 'provider_version_mismatch', change: r => { r.promptVersion = PRIVATE; } },
  { name: 'schema version', reason: 'provider_version_mismatch', change: r => { r.outputSchemaVersion = PRIVATE; } },
  { name: 'unsupported locale', reason: 'provider_locale_invalid', change: r => { r.locale = 'fr'; } },
  { name: 'provider pin', reason: 'provider_pin_mismatch', change: r => { r.provider = PRIVATE; } },
  { name: 'model pin', reason: 'provider_pin_mismatch', change: r => { r.model = PRIVATE; } },
  { name: 'missing context', reason: 'provider_context_invalid', change: r => { r.approvedContext = undefined; } },
  { name: 'missing choice', reason: 'provider_context_invalid', change: r => {
    Object.assign(r.approvedContext!, { selectedChoice: undefined });
  } },
  { name: 'empty beats', reason: 'provider_context_invalid', change: r => { r.approvedContext!.sourceScene.beats = []; } },
];

const invalidStyles: Array<{ name: string; change: (request: Request) => void }> = [
  { name: 'profile schema', change: r => { Object.assign(r.approvedContext!.generationProfile!, { schemaVersion: PRIVATE }); } },
  { name: 'duplicate style sections', change: r => {
    const profile = r.approvedContext!.generationProfile!;
    profile.sections.push({ ...profile.sections[0] });
  } },
  { name: 'nonobject style', change: r => { Object.assign(r.approvedContext!.generationProfile!.sections[0], { value: [] }); } },
  { name: 'oversized style string', change: r => {
    r.approvedContext!.generationProfile!.sections[0].value.summary = 'x'.repeat(8_001);
  } },
];

describe('Fixed-cap one-request fit (offline synthetic context only)', () => {
  let network: jest.SpyInstance;
  let configRead: jest.SpyInstance;
  let loggers: jest.SpyInstance[];
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    configRead = jest.spyOn(configuration, 'readStoryContinuationOpenAiConfig').mockImplementation(() => {
      throw new Error('environment/config reader prohibited');
    });
    loggers = ['log', 'info', 'warn', 'error', 'debug'].map(method =>
      jest.spyOn(console, method as 'log').mockImplementation(() => undefined));
  });
  afterEach(() => {
    try {
      expect(network).not.toHaveBeenCalled();
      expect(configRead).not.toHaveBeenCalled();
      for (const logger of loggers) expect(logger).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  });

  it.each(locales)('FIXED-CAP-FIT: measures complete current %s request and existing narrative bounds', locale => {
    const f = fixture(locale);
    const body = prompt.buildStoryContinuationOpenAiRequest(f.request, f.config);
    const bounds = sourceStoryContinuationLengthBounds(locale, f.request.approvedContext!.sourceScene.beats);
    const result = inspect(f.request, f.config);
    expect(result).toMatchObject({ inputFit: 'within_policy_bound', reason: 'fixed_cap_input_policy_fit', writingStylePresent: true });
    expect(result.inputTokenBudget).toBe(tokenizer.storyContinuationInputTokenBudget(body));
    expect(result.requestBytes).toBe(Buffer.byteLength(JSON.stringify(body), 'utf8'));
    expect(result.narrativeLength).toEqual({ measurement: bounds.measurement, referenceUnits: bounds.referenceUnits,
      minUnits: bounds.minUnits, targetUnits: bounds.targetUnits, maxUnits: bounds.maxUnits });
  });

  it.each(['gpt-5-mini-2025-08-07', 'gpt-5.4-mini-2026-03-17'])('FIXED-CAP-FIT: uses the existing pinned model mapping for %s', model => {
    const f = fixture('en', model);
    expect(tokenizer.storyContinuationModelEncoding(model)).toBe('o200k_base');
    expect(inspect(f.request, f.config)).toMatchObject({ inputFit: 'within_policy_bound', reason: 'fixed_cap_input_policy_fit' });
  });

  it.each(['future-2099-01-01', 'gpt-4.1', 'gpt-4-turbo-2024-04-09'])('FIXED-CAP-FIT: leaves unknown encoding %s unmeasured', model => {
    const f = fixture('en', model);
    expectUnmeasured(inspect(f.request, f.config), 'provider_model_encoding_unknown');
  });

  it.each([
    { field: 'inputTokenLimit', value: INPUT_LIMIT - 1 },
    { field: 'inputTokenLimit', value: INPUT_LIMIT + 1 },
    { field: 'outputTokenLimit', value: OUTPUT_LIMIT - 1 },
    { field: 'outputTokenLimit', value: OUTPUT_LIMIT + 1 },
    { field: 'inputTokenLimit', value: undefined },
    { field: 'outputTokenLimit', value: undefined },
  ])('FIXED-CAP-FIT: rejects fixed $field mismatch $value without preparing a request', ({ field, value }) => {
    const f = fixture();
    f.config.maxInputTokens = 128_000;
    f.config.maxOutputTokens = 32_768;
    Object.assign(f.request, { [field]: value });
    const prepare = jest.spyOn(prompt, 'prepareStoryContinuationOpenAiRequestForDiagnostics');
    const result = inspect(f.request, f.config);
    expectUnmeasured(result, 'fixed_cap_request_limits_mismatch');
    expect(result).toMatchObject({ requestBytes: null, narrativeLength: null, writingStylePresent: null });
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each(invalidRequests)('FIXED-CAP-FIT: safely rejects invalid $name', ({ change, reason }) => {
    const f = fixture();
    change(f.request);
    const result = inspect(f.request, f.config);
    expectUnmeasured(result, reason);
    expect(result).toMatchObject({ requestBytes: null, narrativeLength: null, writingStylePresent: null });
  });

  it.each(invalidStyles)('FIXED-CAP-FIT: rejects invalid $name without clipping or exposing style', ({ change }) => {
    const f = fixture();
    change(f.request);
    expectUnmeasured(inspect(f.request, f.config), 'provider_context_invalid');
  });

  it.each([
    { name: 'version', change: { profileVersion: PRIVATE }, reason: 'author_length_profile_invalid' },
    { name: 'bounds', change: { minUnits: 0 }, reason: 'author_length_profile_invalid' },
    { name: 'locale', change: { locale: 'ko' }, reason: 'provider_context_invalid' },
  ])('FIXED-CAP-FIT: rejects invalid narrative $name', ({ change, reason }) => {
    const f = fixture();
    f.request.approvedContext!.narrativeLength = {
      ...sourceStoryContinuationLengthBounds('en', f.request.approvedContext!.sourceScene.beats),
    };
    Object.assign(f.request.approvedContext!.narrativeLength, change);
    expectUnmeasured(inspect(f.request, f.config), reason);
  });

  it('FIXED-CAP-FIT: blank narrative is unknown rather than a zero-length success', () => {
    const f = fixture();
    f.request.approvedContext!.sourceScene.beats[0].content = ' \n\t ';
    const result = inspect(f.request, f.config);
    expectUnmeasured(result, 'author_length_reference_empty');
    expect(result.narrativeLength).toBeNull();
  });

  it('FIXED-CAP-FIT: valid context without writing style reports presence false, not approval', () => {
    const f = fixture();
    f.request.approvedContext!.generationProfile = undefined;
    expect(inspect(f.request, f.config)).toMatchObject({ inputFit: 'within_policy_bound', writingStylePresent: false });
  });

  it('FIXED-CAP-FIT: preserves every projected style rule and tail with deeply frozen inputs', () => {
    const f = fixture();
    const style = f.request.approvedContext!.generationProfile!.sections[0].value;
    style.summary = 'Keep the approved voice and sentence rhythm. '.repeat(65) + 'STYLE_SUMMARY_TAIL';
    style.observations = Array.from({ length: 6 }, (_, index) => ({
      title: `Rule ${index + 1}: ${'Approved title. '.repeat(7)}TITLE_TAIL`,
      detail: 'Keep complete witness dialogue and measured pauses. '.repeat(5) + `DETAIL_TAIL_${index}`,
      referenceScope: 'writing_pattern',
    }));
    style.categories = Array.from({ length: 7 }, (_, index) => ({
      category: `approved_category_${index}`, observations: ['Retain the first rule.',
        'Use restrained narration. '.repeat(7), `Keep the last exception CATEGORY_TAIL_${index}.`],
    }));
    const profile = f.request.approvedContext!.generationProfile!;
    expect(Buffer.byteLength(JSON.stringify(profile), 'utf8')).toBeLessThanOrEqual(16_384);
    const beforeRequest = JSON.stringify(f.request), beforeConfig = JSON.stringify(f.config);
    freezeDeep(f.request);
    freezeDeep(f.config);
    const budget = jest.spyOn(tokenizer, 'storyContinuationInputTokenBudget');
    const prepare = jest.spyOn(prompt, 'prepareStoryContinuationOpenAiRequestForDiagnostics');
    const result = inspect(f.request, f.config);
    expect(result).toMatchObject({ inputFit: 'within_policy_bound', writingStylePresent: true });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(budget).toHaveBeenCalledTimes(1);
    const body = budget.mock.calls[0][0] as ReturnType<typeof prompt.prepareStoryContinuationOpenAiRequestForDiagnostics>;
    expect(JSON.parse(body.input[0].content[0].text).generationProfile).toEqual(profile);
    expect(JSON.stringify(f.request)).toBe(beforeRequest);
    expect(JSON.stringify(f.config)).toBe(beforeConfig);
    expect(Object.isFrozen(result.narrativeLength)).toBe(true);
  });

  it('FIXED-CAP-FIT: counts instructions, strict schema and all request fields rather than body-only tokens', () => {
    const f = fixture();
    const body = prompt.buildStoryContinuationOpenAiRequest(f.request, f.config);
    expect(body.instructions).toContain('mandatory bounds');
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    const bodyOnly = tokenizer.storyContinuationTextTokens(MODEL, body.input[0].content[0].text);
    const result = inspect(f.request, f.config);
    expect(result.inputTokenBudget).toBe(tokenizer.storyContinuationInputTokenBudget(body));
    expect(result.inputTokenBudget).toBeGreaterThan(Math.ceil(bodyOnly * 1.1) + 256);
    expect(result.requestBytes).toBeGreaterThan(Buffer.byteLength(body.input[0].content[0].text, 'utf8'));
  });

  it('FIXED-CAP-FIT: larger configuration allowances do not enlarge the fixed contract', () => {
    const f = fixture();
    const original = inspect(f.request, f.config);
    f.config.maxInputTokens = 128_000;
    f.config.maxOutputTokens = 32_768;
    expect(inspect(f.request, f.config)).toEqual(original);
  });

  it('FIXED-CAP-FIT: measures an actual serialized token overflow without truncating or authorizing dispatch', () => {
    const f = fixture();
    f.config.maxInputTokens = 128_000;
    f.config.maxOutputTokens = 32_768;
    f.request.approvedContext!.sourceScene.beats = Array.from({ length: 6 }, () => ({
      beatType: 'paragraph', content: '0 1 2 3 4 5 6 7 8 9 '.repeat(1_200),
    }));
    const before = JSON.stringify(f.request);
    const body = prompt.prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config);
    const expectedBudget = tokenizer.storyContinuationInputTokenBudget(body);
    expect(expectedBudget).toBeGreaterThan(INPUT_LIMIT);
    const result = inspect(f.request, f.config);
    expect(result).toMatchObject({ inputFit: 'exceeds_policy_bound', reason: 'provider_input_bound_exceeded',
      inputTokenBudget: expectedBudget, requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8') });
    expect(JSON.stringify(f.request)).toBe(before);
  });

  it('FIXED-CAP-FIT: byte overflow does not invent a measured token count or return raw context', () => {
    const f = fixture();
    f.request.approvedContext!.memories = Array.from({ length: 64 }, () => ({ memoryType: 'style', content: 'm'.repeat(5_000) }));
    const body = prompt.prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config);
    expect(Buffer.byteLength(JSON.stringify(body), 'utf8')).toBeGreaterThan(256_000);
    const result = inspect(f.request, f.config);
    expect(result.reason).toBe('provider_input_bound_exceeded');
    expect(result.inputFit).not.toBe('within_policy_bound');
    expect(result.inputTokenBudget).toBeNull();
    expect(result.requestBytes).not.toBe(0);
  });

  it('FIXED-CAP-FIT: offline preparation works with disabled dispatch and absent key', () => {
    const f = fixture();
    f.config.enabled = false;
    f.config.apiKey = '';
    expect(inspect(f.request, f.config)).toMatchObject({ inputFit: 'within_policy_bound', reason: 'fixed_cap_input_policy_fit' });
  });

  it('FIXED-CAP-FIT: accepts only the narrow noncredential configuration fields', () => {
    const f = fixture();
    const config: DiagnosticConfig = { provider: f.config.provider, model: f.config.model,
      rateCardId: f.config.rateCardId, rateCardVersion: f.config.rateCardVersion,
      maxInputTokens: INPUT_LIMIT, maxOutputTokens: OUTPUT_LIMIT };
    expect(inspect(f.request, config)).toMatchObject({ inputFit: 'within_policy_bound' });
  });

  it('FIXED-CAP-FIT: never accesses API key or enabled getters', () => {
    const f = fixture();
    const secretRead = jest.fn(() => { throw new Error(PRIVATE); });
    Object.defineProperty(f.config, 'apiKey', { get: secretRead });
    Object.defineProperty(f.config, 'enabled', { get: secretRead });
    const result = inspect(f.request, f.config);
    expect(result.inputFit).toBe('within_policy_bound');
    expect(secretRead).not.toHaveBeenCalled();
  });

  it('FIXED-CAP-FIT: exposes numeric diagnostics only, with no private text, identities or hashes', () => {
    const f = fixture();
    f.config.apiKey = PRIVATE;
    f.request.operationId = PRIVATE;
    f.request.contextFingerprint = 'a'.repeat(64);
    f.request.approvedContext!.sourceScene.title = PRIVATE;
    f.request.approvedContext!.sourceScene.beats[0].content = `${PRIVATE}: The synthetic actor opens the door.`;
    f.request.approvedContext!.memories.push({ memoryType: 'style', content: PRIVATE });
    f.request.approvedContext!.generationProfile!.sections[0].value.summary = PRIVATE;
    const result = inspect(f.request, f.config);
    expect(result.narrativeLength?.measurement).toBe(NARRATIVE_LENGTH_MEASUREMENT);
    f.request.promptVersion = PRIVATE;
    expectUnmeasured(inspect(f.request, f.config), 'provider_version_mismatch');
  });

  it.each([
    { name: 'plain error message', error: new Error(PRIVATE) },
    { name: 'forged error-shaped object', error: { code: 'provider_pin_mismatch', message: PRIVATE, rawRequest: PRIVATE } },
    { name: 'nonallowlisted typed code', error: new StoryContinuationProviderError(PRIVATE, false) },
  ])('FIXED-CAP-FIT: sanitizes untrusted $name', ({ error }) => {
    const f = fixture();
    jest.spyOn(prompt, 'prepareStoryContinuationOpenAiRequestForDiagnostics').mockImplementation(() => { throw error; });
    const result = inspect(f.request, f.config);
    expectUnmeasured(result, 'provider_context_invalid');
    expect(result).toMatchObject({ requestBytes: null, narrativeLength: null, writingStylePresent: null });
  });

  it('FIXED-CAP-FIT: preserves only the explicit plain schema-unavailable exception code', () => {
    const f = fixture();
    jest.spyOn(prompt, 'prepareStoryContinuationOpenAiRequestForDiagnostics').mockImplementation(() => {
      throw new Error('provider_narrative_schema_unavailable');
    });
    expectUnmeasured(inspect(f.request, f.config), 'provider_narrative_schema_unavailable');
  });

  it.each([
    { budget: INPUT_LIMIT, inputFit: 'within_policy_bound', reason: 'fixed_cap_input_policy_fit' },
    { budget: INPUT_LIMIT + 1, inputFit: 'exceeds_policy_bound', reason: 'provider_input_bound_exceeded' },
  ])('FIXED-CAP-FIT: applies the inclusive fixed input boundary at $budget', ({ budget, inputFit, reason }) => {
    const f = fixture();
    f.config.maxInputTokens = 128_000;
    jest.spyOn(tokenizer, 'storyContinuationInputTokenBudget').mockReturnValue(budget);
    expect(inspect(f.request, f.config)).toMatchObject({ inputTokenBudget: budget, inputFit, reason });
  });
});

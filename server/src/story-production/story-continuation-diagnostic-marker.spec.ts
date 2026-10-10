import { inspectStoryContinuationFixedCapFit } from './story-continuation-fixed-cap-fit';
import * as configuration from './story-continuation-openai.config';
import { prepareStoryContinuationOpenAiRequestForDiagnostics,
  type StoryContinuationRequestPreparationConfig } from './story-continuation-openai.prompt';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import { STORY_CONTINUATION_TOKEN_BUDGET_METHOD, storyContinuationInputTokenBudget } from './story-continuation-tokenizer';

const MARKERS = ['offline_current_fit', 'offline_second_fit'];
const PRIVATE = 'PRIVATE_DIAGNOSTIC_METADATA_SENTINEL';

// Projected synthetic context only; no operation, approval, receipt or owner record.
function fixture(operationId = MARKERS[0]) {
  const config: StoryContinuationRequestPreparationConfig = {
    provider: 'openai', model: 'gpt-4.1-2025-04-14',
    rateCardId: 'synthetic-diagnostic-card', rateCardVersion: 'v1',
    maxInputTokens: 32_768, maxOutputTokens: 8_192,
  };
  const request: StoryContinuationProviderRequest = {
    operationId, contextFingerprint: PRIVATE, locale: 'en',
    provider: config.provider, model: config.model,
    rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768, outputTokenLimit: 8_192,
    approvedContext: {
      sourceScene: { title: 'Synthetic corridor',
        beats: [{ beatType: 'paragraph', content: 'An actor opened the door in the synthetic corridor.' }] },
      selectedChoice: { label: 'Open the door' }, path: [], memories: [],
      generationProfile: { schemaVersion: 'creator-generation-profile-v1', sections: [
        { key: 'writing_style', value: { referenceScope: 'production_constraint',
          summary: 'Keep complete sentences and concrete verbs.',
          observations: [{ title: 'Rhythm', detail: 'Retain the final deliberate pause.',
            referenceScope: 'writing_pattern' }],
          categories: [{ category: 'voice', observations: ['Use concrete verbs.', 'Keep complete sentences.'] }],
        } },
      ] },
    },
  };
  return { request, config };
}

function noAuthority(result: ReturnType<typeof inspectStoryContinuationFixedCapFit>) {
  expect(result).toMatchObject({ version: 'story-fixed-cap-fit-v1', contextSource: 'caller_supplied_context',
    fixedInputTokenLimit: 32_768, fixedOutputTokenLimit: 8_192,
    currentApprovalVerified: false, dispatchAuthorized: false, semanticQualityVerified: false,
    providerCalls: 0, outputFit: 'unmeasured', multiStageFit: 'unimplemented' });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) deepFreeze(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}

describe('offline diagnostic marker contract', () => {
  it('two bounded non-UUID markers preserve the complete payload and token diagnostic bytes', () => {
    const first = fixture(MARKERS[0]);
    const second = fixture(MARKERS[1]);
    const body = prepareStoryContinuationOpenAiRequestForDiagnostics(first.request, first.config);
    const alternate = prepareStoryContinuationOpenAiRequestForDiagnostics(second.request, second.config);
    const serialized = JSON.stringify(body);
    expect(Buffer.from(serialized, 'utf8').equals(Buffer.from(JSON.stringify(alternate), 'utf8'))).toBe(true);
    expect(body).toMatchObject({ model: first.config.model, truncation: 'disabled', max_output_tokens: 8_192,
      text: { format: { type: 'json_schema', strict: true } } });
    expect(body.instructions.length).toBeGreaterThan(0);
    expect(JSON.parse(body.input[0].content[0].text).generationProfile)
      .toEqual(first.request.approvedContext!.generationProfile);
    const diagnostic = inspectStoryContinuationFixedCapFit(first.request, first.config);
    expect(JSON.stringify(diagnostic)).toBe(JSON.stringify(inspectStoryContinuationFixedCapFit(second.request, second.config)));
    expect(diagnostic.inputFit).not.toBe('unmeasured');
    expect(diagnostic.budgetMethod).toBe(STORY_CONTINUATION_TOKEN_BUDGET_METHOD);
    expect(diagnostic.inputTokenBudget).toBe(storyContinuationInputTokenBudget(body));
    expect(diagnostic.requestBytes).toBe(Buffer.byteLength(serialized, 'utf8'));
    noAuthority(diagnostic);
  });

  it('operation and fingerprint metadata never enter serialized payload or numeric diagnostics', () => {
    const f = fixture('offline_private_marker');
    const payload = JSON.stringify(prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config));
    const result = inspectStoryContinuationFixedCapFit(f.request, f.config);
    const diagnostic = JSON.stringify(result);
    for (const text of [payload, diagnostic]) {
      expect(text).not.toContain(f.request.operationId);
      expect(text).not.toContain(PRIVATE);
      expect(text).not.toMatch(/"(?:operationId|contextFingerprint|rawRequest|requestHash|sourceHash|apiKey)"/);
    }
    expect(Number.isSafeInteger(result.inputTokenBudget)).toBe(true);
    expect(result.inputTokenBudget!).toBeGreaterThan(0);
    expect(Number.isSafeInteger(result.requestBytes)).toBe(true);
    expect(result.requestBytes!).toBeGreaterThan(0);
    noAuthority(result);
  });

  it('empty, overlength and punctuated markers fail preparation without dispatch', () => {
    for (const marker of ['', 'x'.repeat(101), 'offline.invalid']) {
      const f = fixture(marker);
      expect(() => prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config))
        .toThrow('provider_request_limits_invalid');
      const result = inspectStoryContinuationFixedCapFit(f.request, f.config);
      expect(result).toMatchObject({ inputFit: 'unmeasured', reason: 'provider_request_limits_invalid',
        inputTokenBudget: null, requestBytes: null, narrativeLength: null, writingStylePresent: null });
      noAuthority(result);
    }
  });

  it('changing a marker cannot confer approval, dispatch, semantic, output or multistage success', () => {
    for (const marker of [...MARKERS, '']) {
      const f = fixture(marker);
      noAuthority(inspectStoryContinuationFixedCapFit(f.request, f.config));
    }
  });

  it('deeply frozen request and noncredential config stay unchanged without configuration or readiness reads', () => {
    const f = fixture();
    const before = JSON.stringify(f);
    let forbiddenReads = 0;
    for (const key of ['apiKey', 'enabled', 'readiness', 'env', 'get']) {
      Object.defineProperty(f.config, key, { enumerable: false, get() {
        forbiddenReads += 1;
        throw new Error('Forbidden diagnostic configuration read');
      } });
    }
    deepFreeze(f.request);
    deepFreeze(f.config);
    const configRead = jest.spyOn(configuration, 'readStoryContinuationOpenAiConfig');
    const configAdmission = jest.spyOn(configuration, 'storyContinuationConfigFailure');
    try {
      const body = prepareStoryContinuationOpenAiRequestForDiagnostics(f.request, f.config);
      const result = inspectStoryContinuationFixedCapFit(f.request, f.config);
      expect(result.inputFit).not.toBe('unmeasured');
      expect(result.inputTokenBudget).toBe(storyContinuationInputTokenBudget(body));
      expect(JSON.stringify(f)).toBe(before);
      expect(Object.isFrozen(f.request.approvedContext!.generationProfile!.sections[0].value)).toBe(true);
      expect(Object.isFrozen(f.config)).toBe(true);
      expect(forbiddenReads).toBe(0);
      expect(configRead).not.toHaveBeenCalled();
      expect(configAdmission).not.toHaveBeenCalled();
      noAuthority(result);
    } finally {
      configRead.mockRestore();
      configAdmission.mockRestore();
    }
  });
});

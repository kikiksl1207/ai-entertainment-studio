import { prepareStoryContinuationOpenAiRequestForDiagnostics,
  type StoryContinuationRequestPreparationConfig } from './story-continuation-openai.prompt';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';
import { STORY_CONTINUATION_TOKEN_BUDGET_METHOD, storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { StoryContinuationLengthPolicyError } from './story-continuation-length.policy';

export const STORY_FIXED_CAP_FIT_VERSION = 'story-fixed-cap-fit-v1';
export const STORY_FIXED_CAP_INPUT_TOKENS = 32_768;
export const STORY_FIXED_CAP_OUTPUT_TOKENS = 8_192;

export type StoryContinuationFixedCapFit = Readonly<{
  version: typeof STORY_FIXED_CAP_FIT_VERSION;
  budgetMethod: typeof STORY_CONTINUATION_TOKEN_BUDGET_METHOD;
  contextSource: 'caller_supplied_context';
  fixedInputTokenLimit: typeof STORY_FIXED_CAP_INPUT_TOKENS;
  fixedOutputTokenLimit: typeof STORY_FIXED_CAP_OUTPUT_TOKENS;
  inputFit: 'within_policy_bound' | 'exceeds_policy_bound' | 'unmeasured';
  reason: string;
  inputTokenBudget: number | null;
  requestBytes: number | null;
  narrativeLength: Readonly<{
    measurement: string;
    referenceUnits: number;
    minUnits: number;
    targetUnits: number;
    maxUnits: number;
  }> | null;
  writingStylePresent: boolean | null;
  outputFit: 'unmeasured';
  multiStageFit: 'unimplemented';
  currentApprovalVerified: false;
  dispatchAuthorized: false;
  semanticQualityVerified: false;
  providerCalls: 0;
}>;

const SAFE_FAILURE_CODES = new Set([
  'provider_pin_mismatch', 'provider_version_mismatch', 'provider_locale_invalid',
  'provider_request_limits_invalid', 'provider_context_invalid', 'provider_model_encoding_unknown',
  'provider_input_bound_exceeded', 'author_length_profile_invalid', 'author_length_locale_unsupported',
  'author_length_beats_invalid', 'author_length_beat_type_invalid', 'author_length_locale_mismatch',
  'author_length_text_invalid', 'author_length_byte_limit', 'author_length_unicode_invalid',
  'author_length_reference_empty',
]);

// This is a policy estimate of one prepared request, not a provider receipt or approval.
export function inspectStoryContinuationFixedCapFit(
  request: StoryContinuationProviderRequest,
  config: StoryContinuationRequestPreparationConfig,
): StoryContinuationFixedCapFit {
  const unknown: StoryContinuationFixedCapFit = {
    version: STORY_FIXED_CAP_FIT_VERSION,
    budgetMethod: STORY_CONTINUATION_TOKEN_BUDGET_METHOD,
    contextSource: 'caller_supplied_context',
    fixedInputTokenLimit: STORY_FIXED_CAP_INPUT_TOKENS,
    fixedOutputTokenLimit: STORY_FIXED_CAP_OUTPUT_TOKENS,
    inputFit: 'unmeasured', reason: 'provider_context_invalid',
    inputTokenBudget: null, requestBytes: null, narrativeLength: null, writingStylePresent: null,
    outputFit: 'unmeasured', multiStageFit: 'unimplemented', currentApprovalVerified: false,
    dispatchAuthorized: false, semanticQualityVerified: false, providerCalls: 0,
  };
  try {
    if (request.inputTokenLimit !== STORY_FIXED_CAP_INPUT_TOKENS ||
        request.outputTokenLimit !== STORY_FIXED_CAP_OUTPUT_TOKENS) {
      return Object.freeze({ ...unknown, reason: 'fixed_cap_request_limits_mismatch' });
    }
    const body = prepareStoryContinuationOpenAiRequestForDiagnostics(request, config);
    const inputTokenBudget = storyContinuationInputTokenBudget(body);
    const projected = JSON.parse(body.input[0].content[0].text);
    const length = projected.narrativeLength;
    const within = inputTokenBudget <= STORY_FIXED_CAP_INPUT_TOKENS;
    return Object.freeze({
      ...unknown,
      inputFit: within ? 'within_policy_bound' : 'exceeds_policy_bound',
      reason: within ? 'fixed_cap_input_policy_fit' : 'provider_input_bound_exceeded',
      inputTokenBudget,
      requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
      narrativeLength: Object.freeze({
        measurement: length.measurement,
        referenceUnits: length.sourceUnits,
        minUnits: length.minimumUnits,
        targetUnits: length.targetUnits,
        maxUnits: length.maximumUnits,
      }),
      writingStylePresent: !!projected.generationProfile?.sections.some(
        (section: { key: string }) => section.key === 'writing_style',
      ),
    });
  } catch (error) {
    const reason = (error instanceof StoryContinuationProviderError || error instanceof StoryContinuationLengthPolicyError) &&
      SAFE_FAILURE_CODES.has(error.code) ? error.code
      : error instanceof Error && error.message === 'provider_narrative_schema_unavailable'
        ? 'provider_narrative_schema_unavailable' : 'provider_context_invalid';
    return Object.freeze({ ...unknown, reason });
  }
}

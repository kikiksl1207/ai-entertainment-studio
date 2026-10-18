import {
  prepareStoryContinuationOpenAiRequestForRestoredProfileDiagnostics,
  type StoryContinuationRequestPreparationConfig,
  type StoryRestoredProfileDiagnosticInput,
} from './story-continuation-openai.prompt';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';
import { StoryProfileReferenceError } from './story-approved-profile-reference.policy';
import { StoryApprovedProfileDeliveryError } from './story-approved-profile-delivery.policy';
import { StoryContinuationLengthPolicyError } from './story-continuation-length.policy';
import { STORY_CONTINUATION_TOKEN_BUDGET_METHOD, storyContinuationInputTokenBudget } from './story-continuation-tokenizer';

const SAFE = new Set([
  'provider_pin_mismatch', 'provider_version_mismatch', 'provider_locale_invalid',
  'provider_request_limits_invalid', 'provider_context_invalid', 'provider_model_encoding_unknown',
  'provider_input_bound_exceeded', 'author_length_profile_invalid', 'author_length_locale_unsupported',
  'author_length_beats_invalid', 'author_length_beat_type_invalid', 'author_length_locale_mismatch',
  'author_length_text_invalid', 'author_length_byte_limit', 'author_length_unicode_invalid', 'author_length_reference_empty',
  'reference_input_invalid', 'reference_bounds_invalid', 'reference_scope_mismatch', 'reference_expired',
  'reference_changed', 'raw_approval_too_large', 'restored_profile_too_large', 'reference_too_large', 'reference_json_invalid',
  'profile_row_invalid', 'profile_not_approved', 'profile_settings_invalid', 'profile_review_incomplete',
  'profile_pin_invalid', 'profile_pin_stale', 'profile_fingerprint_changed', 'profile_source_resolver_required',
  'profile_source_resolution_failed', 'profile_structural_source_invalid', 'delivery_version_unconsumed',
  'profile_content_incomplete', 'profile_evidence_misaligned', 'profile_content_changed', 'delivery_contract_changed',
]);

export function inspectStoryRestoredProfileFixedCapFit(request: StoryContinuationProviderRequest,
  config: StoryContinuationRequestPreparationConfig, restoration: StoryRestoredProfileDiagnosticInput) {
  const base = {
    version: 'story-restored-profile-fixed-cap-fit-offline-v1' as const,
    budgetMethod: STORY_CONTINUATION_TOKEN_BUDGET_METHOD,
    contextSource: 'caller_supplied_snapshot_and_issue_record' as const,
    fixedInputTokenLimit: 32768 as const, fixedOutputTokenLimit: 8192 as const,
    inputFit: 'unmeasured' as 'unmeasured' | 'within_policy_bound' | 'exceeds_policy_bound',
    reason: 'provider_context_invalid', inputTokenBudget: null as number | null, requestBytes: null as number | null,
    narrativeLength: null as Readonly<{ measurement: string; referenceUnits: number; minUnits: number;
      targetUnits: number; maxUnits: number }> | null,
    writingStylePresent: null as boolean | null,
    outputFit: 'unmeasured' as const, multiStageFit: 'unimplemented' as const,
    currentApprovalVerified: false as const, actualOwnerAuthenticated: false as const,
    productionAdmissionVerified: false as const, dispatchAuthorized: false as const,
    semanticQualityVerified: false as const, providerCalls: 0 as const,
  };
  try {
    const body = prepareStoryContinuationOpenAiRequestForRestoredProfileDiagnostics(request, config, restoration);
    const inputTokenBudget = storyContinuationInputTokenBudget(body);
    const projected = JSON.parse(body.input[0].content[0].text);
    const length = projected.narrativeLength;
    const fits = inputTokenBudget <= base.fixedInputTokenLimit;
    return Object.freeze({ ...base,
      inputFit: fits ? 'within_policy_bound' as const : 'exceeds_policy_bound' as const,
      reason: fits ? 'fixed_cap_input_policy_fit' : 'provider_input_bound_exceeded',
      inputTokenBudget, requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
      narrativeLength: Object.freeze({ measurement: length.measurement, referenceUnits: length.sourceUnits,
        minUnits: length.minimumUnits, targetUnits: length.targetUnits, maxUnits: length.maximumUnits }),
      writingStylePresent: !!projected.generationProfile?.serverInterpretation.sections.some(
        (section: { key: string; active: boolean }) => section.key === 'writing_style' && section.active === true),
    });
  } catch (error) {
    const known = error instanceof StoryContinuationProviderError || error instanceof StoryProfileReferenceError
      || error instanceof StoryApprovedProfileDeliveryError || error instanceof StoryContinuationLengthPolicyError;
    const reason = known && SAFE.has(error.code) ? error.code
      : error instanceof Error && error.message === 'provider_narrative_schema_unavailable'
        ? 'provider_narrative_schema_unavailable' : 'provider_context_invalid';
    return Object.freeze({ ...base, reason });
  }
}

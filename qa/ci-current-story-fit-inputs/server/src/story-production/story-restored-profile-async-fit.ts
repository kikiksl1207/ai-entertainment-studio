import {
  prepareStoryContinuationOpenAiRequestForRestoredProfileDiagnostics,
  type StoryContinuationRequestPreparationConfig,
  type StoryRestoredProfileDiagnosticInput,
} from './story-continuation-openai.prompt';
import { StoryContinuationProviderError, type StoryContinuationProviderRequest } from './story-continuation.provider';
import { StoryProfileReferenceError } from './story-approved-profile-reference.policy';
import { StoryApprovedProfileDeliveryError } from './story-approved-profile-delivery.policy';
import { StoryContinuationLengthPolicyError } from './story-continuation-length.policy';
import { OfflineStoryTokenBudget, OFFLINE_TOKEN_BUDGET_METHOD,
  type OfflineTokenBudgetControls, type OfflineTokenBudgetResult } from './story-continuation-tokenizer.offline';

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

export type StoryRestoredProfileAsyncFitDiagnostic = Readonly<{
  version: 'story-restored-profile-async-fit-offline-v1';
  budgetMethod: typeof OFFLINE_TOKEN_BUDGET_METHOD;
  contextSource: 'caller_supplied_snapshot_and_issue_record';
  fixedInputTokenLimit: 32768;
  fixedOutputTokenLimit: 8192;
  inputFit: 'unmeasured' | 'within_policy_bound' | 'exceeds_policy_bound';
  reason: string;
  inputTokenBudget: number | null;
  requestBytes: number | null;
  narrativeLength: Readonly<{ measurement: string; referenceUnits: number; minUnits: number;
    targetUnits: number; maxUnits: number }> | null;
  writingStylePresent: boolean | null;
  requestPreparationValidated: boolean;
  calculation: OfflineTokenBudgetResult | null;
  deadlineScope: 'worker_calculation_only';
  lifetimeOwner: 'caller_retained_instance';
  outputFit: 'unmeasured';
  multiStageFit: 'unimplemented';
  currentApprovalVerified: false;
  actualOwnerAuthenticated: false;
  productionAdmissionVerified: false;
  dispatchAuthorized: false;
  semanticQualityVerified: false;
  providerCalls: 0;
}>;

function empty(reason: string): StoryRestoredProfileAsyncFitDiagnostic {
  return Object.freeze({ version: 'story-restored-profile-async-fit-offline-v1',
    budgetMethod: OFFLINE_TOKEN_BUDGET_METHOD, contextSource: 'caller_supplied_snapshot_and_issue_record',
    fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192, inputFit: 'unmeasured', reason,
    inputTokenBudget: null, requestBytes: null, narrativeLength: null, writingStylePresent: null,
    requestPreparationValidated: false, calculation: null, deadlineScope: 'worker_calculation_only',
    lifetimeOwner: 'caller_retained_instance', outputFit: 'unmeasured', multiStageFit: 'unimplemented',
    currentApprovalVerified: false, actualOwnerAuthenticated: false, productionAdmissionVerified: false,
    dispatchAuthorized: false, semanticQualityVerified: false, providerCalls: 0 });
}

function preparationReason(error: unknown): string {
  const known = error instanceof StoryContinuationProviderError || error instanceof StoryProfileReferenceError
    || error instanceof StoryApprovedProfileDeliveryError || error instanceof StoryContinuationLengthPolicyError;
  return known && SAFE.has(error.code) ? error.code
    : error instanceof Error && error.message === 'provider_narrative_schema_unavailable'
      ? 'provider_narrative_schema_unavailable' : 'provider_context_invalid';
}

/** Retain this owner after an unconfirmed join; drain never upgrades a returned diagnostic. */
export class OfflineStoryRestoredProfileFit {
  private readonly budget = new OfflineStoryTokenBudget();
  private inspecting = false;

  get busy(): boolean { return this.inspecting || this.budget.busy; }
  drain(): Promise<void> { return this.budget.drain(); }

  async inspect(request: StoryContinuationProviderRequest, config: StoryContinuationRequestPreparationConfig,
    restoration: StoryRestoredProfileDiagnosticInput,
    controls: OfflineTokenBudgetControls): Promise<StoryRestoredProfileAsyncFitDiagnostic> {
    if (this.busy) return empty('offline_busy');
    this.inspecting = true;
    try {
      let capturedJson: string, capturedModel: string;
      let metadata: Pick<StoryRestoredProfileAsyncFitDiagnostic,
        'requestBytes' | 'narrativeLength' | 'writingStylePresent'>;
      try {
        const body = prepareStoryContinuationOpenAiRequestForRestoredProfileDiagnostics(request, config, restoration);
        capturedJson = JSON.stringify(body);
        capturedModel = body.model;
        const projected = JSON.parse(body.input[0].content[0].text);
        const length = projected.narrativeLength;
        metadata = Object.freeze({ requestBytes: Buffer.byteLength(capturedJson, 'utf8'),
          narrativeLength: Object.freeze({ measurement: length.measurement, referenceUnits: length.sourceUnits,
            minUnits: length.minimumUnits, targetUnits: length.targetUnits, maxUnits: length.maximumUnits }),
          writingStylePresent: !!projected.generationProfile?.serverInterpretation.sections.some(
            (section: { key: string; active: boolean }) => section.key === 'writing_style' && section.active === true),
        });
      } catch (error) { return empty(preparationReason(error)); }

      // No request/config/reference object is read after this await.
      const calculation = await this.budget.calculate(capturedJson, capturedModel, controls);
      const measured = calculation.status === 'measured' && calculation.workerClosed
        && calculation.cleanupConfirmed && calculation.inputTokenUpperBound !== null;
      const fits = measured && calculation.inputTokenUpperBound! <= 32768;
      return Object.freeze({ ...empty(calculation.reason ?? 'offline_worker_failed'), ...metadata,
        requestPreparationValidated: true, calculation,
        inputFit: measured ? fits ? 'within_policy_bound' : 'exceeds_policy_bound' : 'unmeasured',
        inputTokenBudget: measured ? calculation.inputTokenUpperBound : null,
        reason: measured ? fits ? 'fixed_cap_input_policy_fit' : 'provider_input_bound_exceeded'
          : calculation.reason ?? 'offline_worker_failed',
      });
    } finally { this.inspecting = false; }
  }
}

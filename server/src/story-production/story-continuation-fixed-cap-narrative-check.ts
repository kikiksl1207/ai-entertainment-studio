import {
  assertStoryContinuationLengthBounds,
  StoryContinuationLengthPolicyError,
  validateStoryContinuationNarrativeLength,
  type StoryContinuationLengthBounds,
} from './story-continuation-length.policy';

type NarrativeFit = 'within_original_bounds' | 'underlength' | 'overlength' | 'unmeasured';
type NarrativeReason =
  | 'fixed_cap_narrative_within_original_bounds'
  | 'fixed_cap_narrative_unmeasured'
  | 'author_length_profile_invalid'
  | 'author_length_locale_mismatch'
  | 'author_length_locale_unsupported'
  | 'author_length_beats_invalid'
  | 'author_length_beat_type_invalid'
  | 'author_length_text_invalid'
  | 'author_length_byte_limit'
  | 'author_length_unicode_invalid'
  | 'continuation_output_underlength'
  | 'continuation_output_overlength';

export type StoryContinuationFixedCapNarrativeDiagnostic = Readonly<{
  version: 'story-fixed-cap-narrative-v1';
  narrativeFit: NarrativeFit;
  reason: NarrativeReason;
  measuredUnits: number | null;
  utf8Bytes: number | null;
  beatCount: number | null;
  expectedBounds: Readonly<{
    referenceUnits: number;
    minUnits: number;
    targetUnits: number;
    maxUnits: number;
  }> | null;
  currentApprovalVerified: false;
  providerReceiptVerified: false;
  semanticQualityVerified: false;
  dispatchAuthorized: false;
  providerCalls: 0;
}>;

const SAFE_FAILURE_CODES = new Set<NarrativeReason>([
  'author_length_profile_invalid', 'author_length_locale_mismatch',
  'author_length_locale_unsupported', 'author_length_beats_invalid',
  'author_length_beat_type_invalid', 'author_length_text_invalid',
  'author_length_byte_limit', 'author_length_unicode_invalid',
  'continuation_output_underlength', 'continuation_output_overlength',
]);

// Caller-provided narrative length only; neither approval nor output-token fit.
export function inspectStoryContinuationFixedCapNarrative(
  candidate: { locale: string; beats: unknown },
  bounds: StoryContinuationLengthBounds,
): StoryContinuationFixedCapNarrativeDiagnostic {
  const base = {
    version: 'story-fixed-cap-narrative-v1' as const,
    currentApprovalVerified: false as const,
    providerReceiptVerified: false as const,
    semanticQualityVerified: false as const,
    dispatchAuthorized: false as const,
    providerCalls: 0 as const,
  };
  let expectedBounds: StoryContinuationFixedCapNarrativeDiagnostic['expectedBounds'] = null;
  try {
    assertStoryContinuationLengthBounds(bounds);
    expectedBounds = Object.freeze({
      referenceUnits: bounds.referenceUnits,
      minUnits: bounds.minUnits,
      targetUnits: bounds.targetUnits,
      maxUnits: bounds.maxUnits,
    });
    const measured = validateStoryContinuationNarrativeLength(candidate, bounds);
    return Object.freeze({
      ...base, narrativeFit: 'within_original_bounds',
      reason: 'fixed_cap_narrative_within_original_bounds',
      measuredUnits: measured.units, utf8Bytes: measured.utf8Bytes,
      beatCount: measured.beatCount, expectedBounds,
    });
  } catch (error) {
    const reason: NarrativeReason = error instanceof StoryContinuationLengthPolicyError &&
      SAFE_FAILURE_CODES.has(error.code as NarrativeReason)
      ? error.code as NarrativeReason : 'fixed_cap_narrative_unmeasured';
    return Object.freeze({
      ...base,
      narrativeFit: reason === 'continuation_output_underlength' ? 'underlength'
        : reason === 'continuation_output_overlength' ? 'overlength' : 'unmeasured',
      reason, measuredUnits: null, utf8Bytes: null, beatCount: null, expectedBounds,
    });
  }
}

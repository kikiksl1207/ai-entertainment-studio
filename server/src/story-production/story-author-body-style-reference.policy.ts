import type { Prisma } from '@prisma/client';
import { parseContinuationGenerationProfilePin } from './story-continuation-context.policy';

export type StoryAuthorBodyStyleReferenceInput = Readonly<{
  bodyKind: 'none' | 'canonical' | 'generated';
  origin?: unknown;
  currentApprovedPin?: unknown;
}>;

type Comparison = 'same_approval_pin' | 'different_approval_pin' | 'unavailable';
type Reason =
  | 'body_style_reference_same_approval_pin'
  | 'body_style_reference_different_approval_pin'
  | 'body_style_reference_no_saved_body'
  | 'body_style_reference_canonical_body'
  | 'body_style_reference_origin_unavailable'
  | 'body_style_reference_reused_origin_unavailable'
  | 'body_style_reference_pin_unavailable'
  | 'body_style_reference_unavailable';

export type StoryAuthorBodyStyleReferenceDiagnostic = Readonly<{
  version: 'story-author-body-style-reference-v1';
  referenceScope: 'stored_completed_origin_request_pin';
  contextSource: 'caller_supplied_metadata';
  comparison: Comparison;
  reason: Reason;
  readOnly: true;
  currentApprovalVerified: false;
  originalGenerationApprovalVerified: false;
  semanticQualityVerified: false;
  generatedBodyQualityVerified: false;
  bodySourceAligned: false;
  dispatchAuthorized: false;
  providerCalls: 0;
  operatingWrites: 0;
}>;

function result(comparison: Comparison, reason: Reason): StoryAuthorBodyStyleReferenceDiagnostic {
  return Object.freeze({
    version: 'story-author-body-style-reference-v1',
    referenceScope: 'stored_completed_origin_request_pin',
    contextSource: 'caller_supplied_metadata',
    comparison, reason, readOnly: true,
    currentApprovalVerified: false, originalGenerationApprovalVerified: false,
    semanticQualityVerified: false, generatedBodyQualityVerified: false,
    bodySourceAligned: false, dispatchAuthorized: false,
    providerCalls: 0, operatingWrites: 0,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

// Pin metadata only; the caller must separately bind the owner, scene and source.
export function inspectStoryAuthorBodyStyleReference(
  input: StoryAuthorBodyStyleReferenceInput,
): StoryAuthorBodyStyleReferenceDiagnostic {
  try {
    const candidate = record(input);
    if (!candidate) return result('unavailable', 'body_style_reference_unavailable');
    if (candidate.bodyKind === 'none') return result('unavailable', 'body_style_reference_no_saved_body');
    if (candidate.bodyKind === 'canonical') return result('unavailable', 'body_style_reference_canonical_body');
    if (candidate.bodyKind !== 'generated') return result('unavailable', 'body_style_reference_unavailable');

    const origin = record(candidate.origin);
    if (!origin || origin.status !== 'completed') {
      return result('unavailable', 'body_style_reference_origin_unavailable');
    }
    const references = record(origin.contextReferences);
    if (!references) return result('unavailable', 'body_style_reference_origin_unavailable');
    const reused = references.sharedResultReused;
    if (reused === true) return result('unavailable', 'body_style_reference_reused_origin_unavailable');
    if (reused !== undefined && reused !== false) {
      return result('unavailable', 'body_style_reference_origin_unavailable');
    }

    let originPin: ReturnType<typeof parseContinuationGenerationProfilePin>;
    let currentPin: ReturnType<typeof parseContinuationGenerationProfilePin>;
    try {
      originPin = parseContinuationGenerationProfilePin(references.generationProfilePin as Prisma.JsonValue | undefined);
      currentPin = parseContinuationGenerationProfilePin(candidate.currentApprovedPin as Prisma.JsonValue | undefined);
    } catch {
      return result('unavailable', 'body_style_reference_pin_unavailable');
    }
    if (!originPin || !currentPin) return result('unavailable', 'body_style_reference_pin_unavailable');

    const same = originPin.id === currentPin.id
      && originPin.profileVersion === currentPin.profileVersion
      && originPin.reviewRevision === currentPin.reviewRevision
      && originPin.sourceFingerprint === currentPin.sourceFingerprint
      && originPin.approvedFingerprint === currentPin.approvedFingerprint;
    return same
      ? result('same_approval_pin', 'body_style_reference_same_approval_pin')
      : result('different_approval_pin', 'body_style_reference_different_approval_pin');
  } catch {
    return result('unavailable', 'body_style_reference_unavailable');
  }
}

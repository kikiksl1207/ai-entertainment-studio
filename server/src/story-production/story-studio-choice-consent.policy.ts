import { stableJson } from '../generation-profile/creator-generation-profile.policy';

export const CHOICE_CONSENT_REAPPROVED = 'story_studio_choices.consent_reapproved';
export const CHOICE_CONSENT_APPROVAL_TYPE = 'explicit_author_consent_review_v1';

export function olderConsentRevision(previous: unknown, current: number): boolean {
  return Number.isSafeInteger(previous) && (previous as number) > 0 &&
    Number.isSafeInteger(current) && current > (previous as number);
}

export function choiceConsentReceiptValid(proof: { id: string; metadata: unknown } | undefined,
  receipt: unknown, consent: { id: string; revision: number }): boolean {
  const source = record(proof?.metadata), approval = record(receipt);
  if (!proof?.id || source.consentId !== consent.id || !olderConsentRevision(source.consentRevision, consent.revision) ||
      approval.approvalType !== CHOICE_CONSENT_APPROVAL_TYPE || approval.sourceProofId !== proof.id ||
      approval.consentId !== consent.id || approval.consentRevision !== consent.revision ||
      approval.choicesReviewed !== true || approval.currentConsentConfirmed !== true ||
      typeof approval.batchHash !== 'string' || !/^[a-f0-9]{64}$/.test(approval.batchHash)) return false;
  return ['workId', 'releaseId', 'manuscriptHash', 'sceneDigest', 'choiceDigest',
    'generationProfilePin', 'generationProfileViewVersion', 'analysisJobId'].every(key =>
      source[key] !== undefined && stableJson(approval[key]) === stableJson(source[key]));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

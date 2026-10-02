import { BadRequestException, ConflictException } from '@nestjs/common';
import { releaseChecksum } from './story-lifecycle.policy';

export const STORY_INTERACTION_APPROVAL_CONTRACT = 'story-canonical-interaction-approval-v1';
export type StoryInteractionEvidence = {
  interactionKind: 'action' | 'dialogue'; evidenceStart: number; evidenceText: string;
  memoryText: string; interactionReviewed: boolean;
};

function validText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length <= max && Array.from(value.trim()).length >= min &&
    !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

export function validateStoryInteractionEvidence(source: string, input: StoryInteractionEvidence) {
  if (!input || input.interactionReviewed !== true || !['action', 'dialogue'].includes(input.interactionKind) ||
      !Number.isSafeInteger(input.evidenceStart) || input.evidenceStart < 0 || input.evidenceStart > 64000 ||
      !validText(input.evidenceText, 2, 2000) || !validText(input.memoryText, 2, 400) ||
      (input.interactionKind === 'dialogue' && input.memoryText !== input.evidenceText)) {
    throw new BadRequestException({ code: 'STORY_INTERACTION_EVIDENCE_INVALID' });
  }
  if (!validText(source, 2, 64000) || source.slice(input.evidenceStart, input.evidenceStart + input.evidenceText.length) !== input.evidenceText) {
    throw new ConflictException({ code: 'STORY_INTERACTION_EVIDENCE_SOURCE_CHANGED' });
  }
  // Exact offsets are UTF-16, as in the web editor; no normalization or language fallback is applied.
  return { interactionKind: input.interactionKind, evidenceStart: input.evidenceStart,
    evidenceText: input.evidenceText, memoryText: input.memoryText };
}

export function storyInteractionApprovalChecksum(identity: object, evidence: object) {
  return releaseChecksum({ contract: STORY_INTERACTION_APPROVAL_CONTRACT, ...identity, ...evidence });
}

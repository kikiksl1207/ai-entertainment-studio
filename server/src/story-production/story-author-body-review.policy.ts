import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { stableContinuationJson } from './story-continuation-context.policy';
import { STORY_LOCALES } from './story-production.policy';

export const AUTHOR_BODY_REVIEW_CONTRACT = 'story-author-body-review-v1';
export const COMPANY_BODY_DELEGATION_CONTRACT = 'story-company-body-delegation-v1';
export type BodyReviewApprovalBasis = 'human_review' | 'company_delegation';
export const privateBodyReviewFlags = {
  generationStarted: false, imageGenerationStarted: false,
  publicationStarted: false, sharedReuseAuthorized: false,
} as const;

export type AuthorBodyReviewInput = {
  locale: string; sourceBindingHash: string; expectedProgressRevision: number;
  expectedReviewId: string | null; decision: 'approve' | 'reject';
  styleReviewed: boolean; charactersReviewed: boolean; timelineReviewed: boolean;
};

export function bodyReviewHash(value: unknown) {
  return createHash('sha256').update(stableContinuationJson(value)).digest('hex');
}

export function bodyReviewScope(userId: string, workId: string, locale?: string) {
  if (!isUUID(userId) || !isUUID(workId) ||
      (locale !== undefined && !STORY_LOCALES.includes(locale as typeof STORY_LOCALES[number]))) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_REVIEW_INPUT_INVALID' });
  }
  return { userId: userId.toLowerCase(), workId: workId.toLowerCase() };
}

export function bodyReviewKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_REVIEW_IDEMPOTENCY_INVALID' });
  }
}

export function normalizeBodyReviewInput(value: AuthorBodyReviewInput): AuthorBodyReviewInput {
  const fields = ['locale', 'sourceBindingHash', 'expectedProgressRevision', 'expectedReviewId',
    'decision', 'styleReviewed', 'charactersReviewed', 'timelineReviewed'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key)) ||
      !STORY_LOCALES.includes(value.locale as typeof STORY_LOCALES[number]) ||
      !/^[a-f0-9]{64}$/.test(value.sourceBindingHash) ||
      !Number.isSafeInteger(value.expectedProgressRevision) || value.expectedProgressRevision < 1 ||
      !(value.expectedReviewId === null || isUUID(value.expectedReviewId)) ||
      !['approve', 'reject'].includes(value.decision) ||
      [value.styleReviewed, value.charactersReviewed, value.timelineReviewed].some(flag => typeof flag !== 'boolean') ||
      !(value.styleReviewed || value.charactersReviewed || value.timelineReviewed) ||
      (value.decision === 'approve' && !(value.styleReviewed && value.charactersReviewed && value.timelineReviewed))) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_REVIEW_INPUT_INVALID' });
  }
  return { ...value, expectedReviewId: value.expectedReviewId?.toLowerCase() ?? null };
}

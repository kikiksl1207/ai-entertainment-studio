import { Equals, IsDateString, IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Max } from 'class-validator';

export const STORY_AI_QUALITY_RUBRIC = 'story-ai-quality-admin-v1';
export const STORY_AI_QUALITY_EVALUATOR = 'explicit-admin-v1';
// The explicit reviewer attests continuity, distinct choice outcomes, locale,
// complete playable output and no private content. This is not an automated score.
export class CreateStoryAiActivationDto {
  @IsUUID() releaseId: string;
  @IsUUID() rightsContractVersionId: string;
  @IsUUID() consentId: string;
  @IsInt() @Min(1) consentRevision: number;
  @IsIn(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) locale: string;
  @Matches(/^[A-Z]{2}$/) region: string;
  @Matches(/^[A-Za-z0-9._-]{1,100}$/) moderationPolicyVersion: string;
  @Matches(/^[A-Za-z0-9._-]{1,100}$/) moderationEvidenceVersion: string;
  @Equals(STORY_AI_QUALITY_RUBRIC) qualityPolicyVersion: string;
  @Matches(/^[a-f0-9]{64}$/) evidenceHash: string;
  @IsDateString() startsAt: string;
  @IsDateString() expiresAt: string;
  @Equals(true) legalActivationConfirmed: boolean;
}

export class CreateStoryAiEvidenceDto {
  @IsUUID() originGeneratedSceneId: string;
  @Matches(/^[a-f0-9]{64}$/) resultChecksum: string;
  @IsIn(['moderation', 'quality']) kind: string;
  @IsIn(['allow', 'reject', 'revoke']) decision: string;
  @IsInt() @Min(1) revision: number;
  @IsOptional() @IsUUID() supersedesId?: string;
  @Matches(/^[A-Za-z0-9._-]{1,100}$/) policyVersion: string;
  @Matches(/^[A-Za-z0-9._-]{1,100}$/) evaluatorVersion: string;
  @Matches(/^[a-f0-9]{64}$/) evidenceHash: string;
  @IsDateString() expiresAt: string;
  @IsOptional() @Equals(true) qualityRubricConfirmed?: boolean;
}

export class RevokeStoryAiApprovalDto {
  @Matches(/^[a-f0-9]{64}$/) evidenceHash: string;
}

export class PromoteStoryAiResultDto {
  @Matches(/^[a-f0-9]{64}$/) resultChecksum: string;
}

export class StoryAiReviewQueueDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsUUID() cursor?: string;
}

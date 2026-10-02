import { Equals, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { STORY_LOCALES } from '../story-production.policy';

export class StoryInteractionCatalogQueryDto {
  @IsIn(STORY_LOCALES) locale!: string;

  @ValidateIf(input => input.afterBeatId !== undefined) @IsUUID()
  afterBeatId?: string;

  @ValidateIf(input => input.afterBeatId !== undefined || input.expectedReleaseId !== undefined) @IsUUID()
  expectedReleaseId?: string;

  @ValidateIf(input => input.afterBeatId !== undefined || input.expectedReleaseChecksum !== undefined)
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/)
  expectedReleaseChecksum?: string;
}

export class StoryInteractionReviewQueryDto {
  @IsUUID() artistId!: string;
  @IsIn(STORY_LOCALES) locale!: string;
}

export class ApproveStoryInteractionDto extends StoryInteractionReviewQueryDto {
  @IsUUID() idempotencyKey!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedSourceChecksum!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedIdentityPinHash!: string;
  @IsIn(['action', 'dialogue']) interactionKind!: 'action' | 'dialogue';
  @IsInt() @Min(0) @Max(64000) evidenceStart!: number;
  @IsString() @MaxLength(2000) evidenceText!: string;
  @IsString() @MaxLength(400) memoryText!: string;
  @Equals(true) interactionReviewed!: boolean;
}

export class RevokeStoryInteractionDto {
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedApprovalChecksum!: string;
  @IsInt() @Min(1) @Max(1) expectedRevision!: number;
}

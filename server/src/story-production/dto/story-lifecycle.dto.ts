import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { STORY_PUBLICATION_STATES, STORY_REVIEW_STATES } from '../story-lifecycle.policy';

export class CreateStoryReleaseDto {
  @IsUUID()
  manuscriptVersionId: string;
  @IsObject()
  branchGraphSnapshot: Record<string, unknown>;
  @IsObject()
  endingSetSnapshot: Record<string, unknown>;
  @IsObject()
  sceneAssetManifest: Record<string, unknown>;
  @IsObject()
  localizedDisplaySnapshot: Record<string, unknown>;
  @IsObject()
  validationSummary: Record<string, unknown>;
  @IsOptional()
  @IsObject()
  diffSummary?: Record<string, unknown>;
}

export class TransitionStoryPublicationDto {
  @IsIn(STORY_PUBLICATION_STATES)
  toStatus: string;
  @IsOptional()
  @IsUUID()
  releaseId?: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
  @IsOptional()
  @IsObject()
  publicSummary?: Record<string, unknown>;
}

export class SaveStorySlotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  slotNumber: number;
  @IsOptional()
  @IsUUID()
  checkpointId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision?: number;
  @IsOptional()
  @IsBoolean()
  overwriteConfirmed = false;
}

export class ClearStorySlotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
  @IsBoolean()
  clearConfirmed: boolean;
}

export class BuildStoryMemoryDto {
  @IsUUID()
  analysisJobId: string;
  @IsString()
  @MaxLength(80)
  currentPartKey: string;
  @IsArray()
  @IsIn(
    ['summary', 'scene', 'entity', 'event', 'foreshadow', 'branch', 'style'],
    { each: true },
  )
  retrievalTypes: string[];
}

export class StoryMemoryQueryDto {
  @IsString()
  @MaxLength(80)
  partKey: string;
  @IsOptional()
  @IsString()
  types?: string;
}

export class OpenWriterReviewDto {
  @IsUUID()
  manuscriptVersionId: string;
  @IsUUID()
  analysisJobId: string;
}

export class TransitionWriterReviewDto {
  @IsIn(STORY_REVIEW_STATES)
  toState: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
  @IsOptional()
  @IsObject()
  decisions?: Record<string, unknown>;
  @IsOptional()
  @IsObject()
  finalSummary?: Record<string, unknown>;
}

export class AggregateStoryQualityDto {
  @IsUUID()
  releaseId: string;
}

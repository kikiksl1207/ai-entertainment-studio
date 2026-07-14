import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { STORY_LOCALES } from '../story-production.policy';

export class CreateStoryAiRateCardDto {
  @IsString()
  @MaxLength(80)
  version: string;
  @IsString()
  @MaxLength(80)
  provider: string;
  @IsString()
  @MaxLength(120)
  model: string;
  @IsIn(['KRW'])
  currencyCode = 'KRW';
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputCostPerMillion: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outputCostPerMillion: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cachedInputCostPerMillion = 0;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  imageUnitCost = 0;
}

export class ActivateStoryAiRateCardDto {
  @IsDateString()
  effectiveAt: string;
}

export class UpsertStoryReleaseCapabilityDto {
  @IsUUID()
  rateCardId: string;
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(3)
  fixedChoiceCount = 3;
  @IsBoolean()
  customChoiceEnabled: boolean;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  customChoiceMaxLength = 200;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1)
  fullResetLimit = 1;
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(3)
  actResetLimit = 3;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  includedAiRouteCount = 0;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200000)
  aiInputTokenLimit = 12000;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  aiOutputTokenLimit = 2500;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  warningBudgetKrw = 3000;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  hardBudgetKrw = 4000;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

export class EstimateStoryPriceDto {
  @IsUUID()
  rateCardId: string;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  authorRightsCostKrw: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  expectedFreeReplayCount: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  includedNewAiRouteCount: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  averageAiInputTokens: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  averageAiOutputTokens: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.99)
  paymentFeeRate: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.99)
  vatRate: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  storageDeliveryCostKrw: number;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.99)
  operatingMarginRate: number;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  warningBudgetKrw = 3000;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  hardBudgetKrw = 4000;
}

export class EstimateStoryMemoryBudgetDto {
  @IsUUID()
  manuscriptVersionId: string;
  @IsOptional()
  @IsUUID()
  analysisJobId?: string;
  @IsUUID()
  rateCardId: string;
  @IsIn(['part', 'act', 'volume', 'work'])
  scopeType: 'part' | 'act' | 'volume' | 'work';
  @IsString()
  @MaxLength(80)
  scopeKey: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(150)
  partCount: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000000)
  relatedEvidenceCharacters: number;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  outputTokenLimit: number;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  warningBudgetKrw = 3000;
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  hardBudgetKrw = 4000;
}

export class UpsertStoryStyleConsentDto {
  @IsUUID()
  manuscriptVersionId: string;
  @IsBoolean()
  rightsConfirmed: boolean;
  @IsBoolean()
  aiBranchAllowed: boolean;
  @IsBoolean()
  translationAllowed: boolean;
  @IsBoolean()
  imageTransformationAllowed: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsIn(STORY_LOCALES, { each: true })
  allowedLocales: string[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  allowedRegions: string[];
  @IsDateString()
  startsAt: string;
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

export class TransitionStoryStyleConsentDto {
  @IsIn(['active', 'suspended', 'withdrawn', 'deletion_pending', 'deleted'])
  toStatus: 'active' | 'suspended' | 'withdrawn' | 'deletion_pending' | 'deleted';
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class StoryGeneratedBeatDto {
  @IsIn(['paragraph', 'dialogue', 'scene_break'])
  beatType: string;
  @IsObject()
  content: Record<string, string>;
}

export class SettleStoryAiContinuationDto {
  @IsIn(['completed', 'failed', 'timeout'])
  status: 'completed' | 'failed' | 'timeout';
  @IsIn(['allow', 'reject'])
  moderationDecision: 'allow' | 'reject';
  @Type(() => Number)
  @IsInt()
  @Min(0)
  inputTokens: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  outputTokens: number;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cachedInputTokens = 0;
  @Type(() => Number)
  @IsInt()
  @Min(0)
  imageUnits = 0;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualCostKrw: number;
  @IsOptional()
  @IsString()
  @MaxLength(80)
  failureCode?: string;
  @IsOptional()
  @IsObject()
  resultTitle?: Record<string, string>;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => StoryGeneratedBeatDto)
  resultBeats?: StoryGeneratedBeatDto[];
}

export class ApproveStoryAiCompensationDto {
  @IsIn(['progress_not_applied', 'quality_failure', 'operator_approved'])
  reason: 'progress_not_applied' | 'quality_failure' | 'operator_approved';
}

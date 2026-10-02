import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsIn, IsInt, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { StudioVisualReferenceIdentityDto } from './story-studio-linear.dto';

export class StudioVisualReviewIdentityDto extends StudioVisualReferenceIdentityDto {
  @Matches(/^[a-f0-9]{64}$/)
  expectedProfilePinHash!: string;
}

export class StudioVisualReviewEntryDto {
  @IsInt() @Min(0) @Max(1999)
  referenceIndex!: number;

  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/)
  sourceSceneKey!: string;

  @Matches(/^[a-f0-9]{64}$/)
  originalPromptSha256!: string;

  @IsString() @MaxLength(32000) @Matches(/\S/u) @Matches(/^[^\0]+$/u)
  promptText!: string;
}

export class SaveStudioVisualReviewBatchDto extends StudioVisualReviewIdentityDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => StudioVisualReviewEntryDto)
  entries!: StudioVisualReviewEntryDto[];
}

export class ApproveStudioVisualReviewBatchDto extends StudioVisualReviewIdentityDto {
  @Matches(/^[a-f0-9]{64}$/)
  expectedBatchChecksum!: string;

  @IsInt() @Min(1) @Max(2)
  expectedRevision!: number;

  @Equals(true)
  scenesReviewed!: boolean;
}

export class SelectStudioPartVisualDto extends StudioVisualReviewIdentityDto {
  @IsIn(['select', 'clear'])
  mode!: 'select' | 'clear';

  @IsUUID()
  idempotencyKey!: string;

  @IsInt() @Min(0) @Max(2147483646)
  expectedSelectionVersion!: number;

  @ValidateIf(input => input.mode === 'select') @IsUUID()
  batchId?: string;

  @ValidateIf(input => input.mode === 'select') @Matches(/^[a-f0-9]{64}$/)
  expectedBatchChecksum?: string;

  @ValidateIf(input => input.mode === 'select') @Equals(true)
  representativeReviewed?: boolean;
}

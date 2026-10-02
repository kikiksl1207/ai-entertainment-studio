import { Equals, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BranchVisualReviewListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8)
  limit?: number;

  @IsOptional() @IsUUID()
  cursor?: string;
}

export class BranchVisualReviewIdentityDto {
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/)
  expectedSourceChecksum!: string;

  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/)
  expectedProfilePinHash!: string;
}

export class SaveBranchVisualReviewBatchDto extends BranchVisualReviewIdentityDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsString() @MaxLength(32000) @Matches(/\S/u) @Matches(/^[^\0]+$/u)
  // JSON permits lone surrogates, which cannot be preserved as valid Unicode.
  @Matches(/^(?:[\u0000-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/)
  promptText!: string;
}

export class ApproveBranchVisualReviewBatchDto extends BranchVisualReviewIdentityDto {
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/)
  expectedBatchChecksum!: string;

  @IsInt() @Min(1) @Max(2)
  expectedRevision!: number;

  @Equals(true)
  sceneReviewed!: boolean;
}

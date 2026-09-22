import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';

export class AuthorReviewProposalDto {
  @IsUUID()
  releaseId: string;

  @IsInt() @Min(1)
  expectedRevision: number;

  @IsOptional() @IsBoolean()
  includeContinuationAnchor = false;

  @IsOptional() @IsInt() @Min(1) @Max(1000)
  minGeneratedSegments = 1;
}

export class AuthorReviewConfirmationDto extends AuthorReviewProposalDto {
  @Matches(/^[a-f0-9]{64}$/)
  proposalHash: string;

  @IsArray() @ArrayUnique() @ArrayMinSize(1) @ArrayMaxSize(2)
  @IsIn(['authored_publication', 'continuation_anchor'], { each: true })
  reviewedScopes: string[];
}

export class SubmitWriterReviewDto {
  @IsOptional() @ValidateNested() @Type(() => AuthorReviewConfirmationDto)
  authoredReview?: AuthorReviewConfirmationDto;
}

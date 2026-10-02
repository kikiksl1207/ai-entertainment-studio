import { Transform } from 'class-transformer';
import { Equals, IsIn, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

const multipartBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class PromoteStoryUploadDto {
  @IsIn(['imjin', 'norse', 'monster', 'rebellion', 'inheritor'])
  storyKey!: 'imjin' | 'norse' | 'monster' | 'rebellion' | 'inheritor';

  @Transform(multipartBoolean)
  @Equals(true)
  finalManuscriptConfirmed!: true;

  @Transform(multipartBoolean)
  @Equals(true)
  rightsConfirmed!: true;

  @Transform(multipartBoolean)
  @Equals(true)
  publicReleaseConfirmed!: true;
}

export class PublishedStoryChoiceTargetDto {
  // Legacy single-source clients may omit both, but never half of a source pin.
  @ValidateIf((target) => target.workId !== undefined || target.releaseId !== undefined)
  @IsUUID()
  workId?: string;

  @ValidateIf((target) => target.workId !== undefined || target.releaseId !== undefined)
  @IsUUID()
  releaseId?: string;
}

export class ActivatePublishedStoryAiDto extends PublishedStoryChoiceTargetDto {
  @Transform(multipartBoolean)
  @Equals(true)
  aiBranchGenerationConfirmed!: true;

  @Transform(multipartBoolean)
  @Equals(true)
  authorStyleReferenceConfirmed!: true;

  @Transform(multipartBoolean)
  @Equals(true)
  generatedResultReuseConfirmed!: true;

  @Transform(multipartBoolean)
  @Equals(true)
  imageTransformationConfirmed!: true;
}

export class ReviewPublishedChoiceBatchDto {
  @IsIn(['no_reusable_response_confirmed'])
  outcome!: 'no_reusable_response_confirmed';

  @IsString()
  @MinLength(12)
  @MaxLength(1000)
  reviewNote!: string;
}

import { Transform } from 'class-transformer';
import { Equals, IsIn } from 'class-validator';

const multipartBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class PromoteStoryUploadDto {
  @IsIn(['imjin', 'norse', 'monster', 'rebellion'])
  storyKey!: 'imjin' | 'norse' | 'monster' | 'rebellion';

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

export class ActivatePublishedStoryAiDto {
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

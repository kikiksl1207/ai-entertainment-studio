import { Transform } from 'class-transformer';
import { Equals, IsIn } from 'class-validator';

const multipartBoolean = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class PromoteStoryUploadDto {
  @IsIn(['imjin', 'norse'])
  storyKey!: 'imjin' | 'norse';

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

import { Equals, IsIn } from 'class-validator';

export class PromoteStoryUploadDto {
  @IsIn(['imjin', 'norse'])
  storyKey!: 'imjin' | 'norse';

  @Equals(true)
  finalManuscriptConfirmed!: true;

  @Equals(true)
  rightsConfirmed!: true;

  @Equals(true)
  publicReleaseConfirmed!: true;
}

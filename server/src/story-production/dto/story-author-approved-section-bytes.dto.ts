import { IsIn } from 'class-validator';

export class StoryAuthorApprovedSectionBytesQueryDto {
  @IsIn(['json-utf8-v1'])
  measurement: 'json-utf8-v1';
}

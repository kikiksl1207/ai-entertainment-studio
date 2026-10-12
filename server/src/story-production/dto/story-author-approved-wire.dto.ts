import { IsIn } from 'class-validator';

export class StoryAuthorApprovedWireQueryDto {
  @IsIn(['gzip-base64-v1'])
  measurement: 'gzip-base64-v1';
}

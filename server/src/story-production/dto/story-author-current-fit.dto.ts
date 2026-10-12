import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { StoryLocaleQueryDto } from './story-production.dto';

export class StoryAuthorCurrentFitQueryDto extends StoryLocaleQueryDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['v1'])
  profileByteBreakdown?: 'v1';

  @IsUUID()
  choiceId: string;

  @Transform(({ value }) => typeof value === 'string' && /^(0|[1-9]\d{0,9})$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedProgressRevision: number;
}

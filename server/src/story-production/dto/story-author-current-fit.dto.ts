import { Transform } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { StoryLocaleQueryDto } from './story-production.dto';

export class StoryAuthorCurrentFitQueryDto extends StoryLocaleQueryDto {
  @IsUUID()
  choiceId: string;

  @Transform(({ value }) => typeof value === 'string' && /^(0|[1-9]\d{0,9})$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  expectedProgressRevision: number;
}

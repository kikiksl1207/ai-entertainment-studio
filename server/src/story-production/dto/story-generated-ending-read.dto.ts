import { Type } from 'class-transformer';
import { Equals, IsIn, IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { STORY_LOCALES } from '../story-production.policy';

export class StoryGeneratedEndingReadQueryDto {
  @IsIn(STORY_LOCALES) locale!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(40) fromPosition!: number;
}

export class ConfirmStoryGeneratedEndingReadDto extends StoryGeneratedEndingReadQueryDto {
  @IsInt() @Min(1) @Max(2147483646) expectedRevision!: number;
  @IsUUID() idempotencyKey!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedScopeChecksum!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedSourceTextHash!: string;
  @Equals(true) displayedAndRead!: boolean;
}

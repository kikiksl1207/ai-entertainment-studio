import { Equals, IsIn, IsInt, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { STORY_LOCALES } from '../story-production.policy';

export class StoryCanonicalReadQueryDto {
  @IsIn(STORY_LOCALES) locale!: string;
}

export class ConfirmStoryCanonicalReadDto extends StoryCanonicalReadQueryDto {
  @IsInt() @Min(1) expectedRevision!: number;
  @IsUUID() idempotencyKey!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedScopeChecksum!: string;
  @IsString() @Length(64, 64) @Matches(/^[a-f0-9]{64}$/) expectedSourceTextHash!: string;
  @Equals(true) displayedAndRead!: boolean;
}

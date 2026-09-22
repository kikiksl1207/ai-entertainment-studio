import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  IsUUID,
  IsOptional,
} from 'class-validator';

const SOURCE_SCENE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;

export class RequestStoryVisualDto {
  @IsString()
  @Matches(SOURCE_SCENE_KEY)
  sourceSceneKey!: string;
}

export class ReplaceStaleStoryVisualDto {
  @IsUUID()
  releaseId!: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  releaseChecksum!: string;

  @IsString()
  @Matches(SOURCE_SCENE_KEY)
  sourceSceneKey!: string;
}

export class StoryVisualPromptItemDto {
  @IsString()
  @Matches(SOURCE_SCENE_KEY)
  sourceSceneKey!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(32_000)
  promptText!: string;
}

export class RegisterStoryVisualPromptsDto {
  @IsUUID()
  releaseId!: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  releaseChecksum!: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  sourceBindingSha256!: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  expectedPromptSetSha256!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StoryVisualPromptItemDto)
  prompts!: StoryVisualPromptItemDto[];
}

export class SyncStoryVisualQueueDto {
  @IsOptional()
  @IsUUID()
  workId?: string;
}

export class RegisterStoryVisualAiBranchPromptDto {
  @IsUUID()
  releaseId!: string;

  @IsString()
  @Length(64, 64)
  @Matches(/^[a-f0-9]{64}$/)
  releaseChecksum!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(32_000)
  promptText!: string;
}

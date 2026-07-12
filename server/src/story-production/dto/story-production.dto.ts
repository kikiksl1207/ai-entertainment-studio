import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { STORY_LOCALES } from '../story-production.policy';

export class StoryCatalogQueryDto {
  @IsOptional()
  @IsIn(STORY_LOCALES)
  locale = 'ko';

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit = 12;
}

export class StoryLocaleQueryDto {
  @IsOptional()
  @IsIn(STORY_LOCALES)
  locale = 'ko';
}

export class StoryGraphQueryDto {
  @IsOptional()
  @IsUUID()
  focusSceneId?: string;
}

export class StartStoryProgressDto {
  @IsIn(['continue', 'restart', 'checkpoint'])
  mode: 'continue' | 'restart' | 'checkpoint';

  @IsOptional()
  @IsUUID()
  checkpointSceneId?: string;

  @IsOptional()
  @IsIn(STORY_LOCALES)
  locale = 'ko';
}

export class UpdateBeatProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  position: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class SelectStoryChoiceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class StoryResetPreviewQueryDto {
  @IsIn(['full', 'act'])
  target: 'full' | 'act';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(150)
  actNumber?: number;

  @IsOptional()
  @IsIn(STORY_LOCALES)
  locale = 'ko';
}

export class ExecuteStoryResetDto extends StoryResetPreviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class ConfirmStoryCheckpointDto {
  @IsUUID()
  sceneId: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  beatPosition: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;

  @IsOptional()
  @IsIn(STORY_LOCALES)
  locale = 'ko';
}

export class SubmitCustomStoryChoiceDto {
  @IsString()
  @MaxLength(2000)
  input: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRevision: number;
}

export class AdjustStoryResetQuotaDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  workId: string;

  @IsIn(['full', 'act'])
  target: 'full' | 'act';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(150)
  actNumber?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  addedUses: number;

  @IsString()
  @MaxLength(500)
  reason: string;
}

export class ManuscriptParagraphDto {
  @IsIn(['title', 'scene_break', 'paragraph', 'dialogue'])
  kind: 'title' | 'scene_break' | 'paragraph' | 'dialogue';

  @IsString()
  @MaxLength(10000)
  text: string;
}

export class ManuscriptPartDto {
  @IsString()
  @MaxLength(80)
  partKey: string;

  @IsString()
  @MaxLength(240)
  title: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ManuscriptParagraphDto)
  paragraphs: ManuscriptParagraphDto[];
}

export class CreateManuscriptVersionDto {
  @IsIn(STORY_LOCALES)
  locale: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(150)
  @ValidateNested({ each: true })
  @Type(() => ManuscriptPartDto)
  parts: ManuscriptPartDto[];
}

export class DecideContinuityIssueDto {
  @IsIn(['accepted', 'resolved', 'dismissed'])
  status: 'accepted' | 'resolved' | 'dismissed';

  @IsString()
  @MaxLength(2000)
  decision: string;
}

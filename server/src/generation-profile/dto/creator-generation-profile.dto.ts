import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CREATOR_GENERATION_PROFILE_SCHEMA } from '../creator-generation-profile.policy';

export class CreatorGenerationProfileEvidenceDto {
  @IsIn(['manuscript', 'metadata', 'visual', 'profile'])
  sourceType!: string;

  @IsString()
  @MaxLength(300)
  sourceRef!: string;

  @IsString()
  @MaxLength(1000)
  summary!: string;
}

export class CreatorGenerationProfileSectionDto {
  @IsString()
  @MaxLength(80)
  key!: string;

  @IsIn(['proposed', 'accepted', 'edited', 'removed', 'unknown'])
  decision!: string;

  @IsObject()
  value!: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreatorGenerationProfileEvidenceDto)
  evidence: CreatorGenerationProfileEvidenceDto[] = [];
}

export class CreatorGenerationProfileSettingsDto {
  @IsIn([CREATOR_GENERATION_PROFILE_SCHEMA])
  schemaVersion!: string;

  @IsIn(['story', 'artist'])
  kind!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => CreatorGenerationProfileSectionDto)
  sections!: CreatorGenerationProfileSectionDto[];
}

export class UpdateStoryGenerationProfileDto {
  @ValidateNested()
  @Type(() => CreatorGenerationProfileSettingsDto)
  settings!: CreatorGenerationProfileSettingsDto;
}

export class ApproveCreatorGenerationProfileDto {
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedDraftFingerprint!: string;
}

export class UpdateArtistStoryIdentityProfileDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Matches(/^[0-9a-fA-F-]{36}$/, { each: true })
  referenceAssetIds!: string[];

  @ValidateNested()
  @Type(() => CreatorGenerationProfileSettingsDto)
  settings!: CreatorGenerationProfileSettingsDto;
}

export class CreateArtistStoryIdentityDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Matches(/^[0-9a-fA-F-]{36}$/, { each: true })
  referenceAssetIds!: string[];
}

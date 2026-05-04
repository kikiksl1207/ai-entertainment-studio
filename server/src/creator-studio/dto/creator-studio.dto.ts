import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const normalizeOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const normalizeStringArray = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
};

export class CreatorStudioPublicProfileDto {
  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(120)
  tagline?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(1000)
  summary?: string | null;

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  personalityKeywords?: string[];

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(4000)
  publicStory?: string | null;

  @IsOptional()
  @IsObject()
  publicMetadata?: Record<string, unknown>;
}

export class CreatorStudioVisualProfileDto {
  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  visualKeywords?: string[];

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(2000)
  styleNotes?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(40)
  primaryColor?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(40)
  secondaryColor?: string | null;
}

export class CreatorStudioContentProfileDto {
  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(2000)
  contentTone?: string | null;

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  allowedTopics?: string[];

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  blockedTopics?: string[];

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(3000)
  operatingNotes?: string | null;
}

export class UpdateCreatorStudioArtistProfileDto {
  @IsOptional()
  @IsObject()
  publicProfile?: CreatorStudioPublicProfileDto;

  @IsOptional()
  @IsObject()
  visualProfile?: CreatorStudioVisualProfileDto;

  @IsOptional()
  @IsObject()
  contentProfile?: CreatorStudioContentProfileDto;
}

export class CreatorStudioSettlementPreviewQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string;
}

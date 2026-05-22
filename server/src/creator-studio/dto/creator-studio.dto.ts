import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
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

const normalizeOptionalBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return value;
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

export class CreatorStudioSettlementConversionQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(requested|approved|rejected|credited|cancelled)$/)
  status?: string;
}

export class CreatorStudioKnowledgeUrlQueryDto {
  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  artistId?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^(pending|approved|rejected|archived)$/)
  status?: string | null;
}

export class CreateCreatorStudioKnowledgeUrlDto {
  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^[0-9a-fA-F-]{36}$/)
  artistId!: string;

  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^(youtube|instagram|tiktok|blog|notice|other)$/)
  type!: string;

  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\/\S+$/i)
  url!: string;

  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @Transform(normalizeOptionalBoolean)
  @IsBoolean()
  allowChatRef?: boolean;
}

export class UpdateCreatorStudioKnowledgeUrlDto {
  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^(youtube|instagram|tiktok|blog|notice|other)$/)
  type?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(2000)
  @Matches(/^https?:\/\/\S+$/i)
  url?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalBoolean)
  @IsBoolean()
  allowChatRef?: boolean;
}

export class CreateCreatorStudioSettlementConversionDto {
  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^(artist|partner):[0-9a-fA-F-]{36}:\d{4}-\d{2}$/)
  settlementKey!: string;

  @Transform(normalizeOptionalString)
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/)
  amountKrw!: string;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string | null;
}

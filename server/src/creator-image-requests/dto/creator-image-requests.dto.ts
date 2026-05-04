import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const CREATOR_IMAGE_REQUEST_TYPES = [
  'profile_image',
  'content_image',
  'feed_image',
  'shortform_thumbnail',
  'concept_reference',
] as const;

export const CREATOR_IMAGE_REQUEST_STATUSES = [
  'submitted',
  'reviewing',
  'generating',
  'needs_more_info',
  'delivered',
  'approved',
  'rejected',
  'archived',
] as const;

export const CREATOR_IMAGE_MODERATION_STATUSES = [
  'pending',
  'cleared',
  'blocked',
  'needs_review',
] as const;

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
};

const normalizeTake = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
};

export class CreateCreatorImageRequestDto {
  @Transform(normalizeString)
  @IsUUID()
  artistId!: string;

  @IsIn(CREATOR_IMAGE_REQUEST_TYPES)
  requestType!: (typeof CREATOR_IMAGE_REQUEST_TYPES)[number];

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(120)
  title?: string;

  @Transform(normalizeString)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  brief!: string;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(3000)
  prompt?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID(undefined, { each: true })
  referenceAssetIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreatorImageRequestListQueryDto {
  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsUUID()
  artistId?: string;

  @IsOptional()
  @IsIn(CREATOR_IMAGE_REQUEST_STATUSES)
  status?: (typeof CREATOR_IMAGE_REQUEST_STATUSES)[number];

  @IsOptional()
  @IsIn(CREATOR_IMAGE_REQUEST_TYPES)
  requestType?: (typeof CREATOR_IMAGE_REQUEST_TYPES)[number];

  @IsOptional()
  @Transform(normalizeTake)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(120)
  query?: string;
}

export class AdminUpdateCreatorImageRequestDto {
  @IsOptional()
  @IsIn(CREATOR_IMAGE_REQUEST_STATUSES)
  status?: (typeof CREATOR_IMAGE_REQUEST_STATUSES)[number];

  @IsOptional()
  @IsIn(CREATOR_IMAGE_MODERATION_STATUSES)
  moderationStatus?: (typeof CREATOR_IMAGE_MODERATION_STATUSES)[number];

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @IsOptional()
  @Transform(normalizeOptionalString)
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID(undefined, { each: true })
  resultAssetIds?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

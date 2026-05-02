import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const DEBUT_APPLICATION_STATUSES = [
  'submitted',
  'reviewing',
  'under_review',
  'needs_more_info',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export const DEBUT_PARTICIPATION_TYPES = [
  'appearance_only',
  'voice_or_song',
  'performance',
  'co_creator',
] as const;

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateDebutApplicationDto {
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  applicantName!: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail!: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsBoolean()
  isAdult!: boolean;

  @IsIn(DEBUT_PARTICIPATION_TYPES)
  participationType!: (typeof DEBUT_PARTICIPATION_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(70)
  shareTierRequested?: number;

  @Transform(normalizeString)
  @IsString()
  @MinLength(20)
  @MaxLength(4000)
  intro!: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(1000)
  portfolioUrl?: string;

  @IsBoolean()
  consentAppearance!: boolean;

  @IsBoolean()
  consentVoice!: boolean;

  @IsBoolean()
  consentRevenuePolicy!: boolean;

  @IsBoolean()
  consentPrivacy!: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AdminUpdateDebutApplicationDto {
  @IsOptional()
  @IsIn(DEBUT_APPLICATION_STATUSES)
  status?: (typeof DEBUT_APPLICATION_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(70)
  shareTierApproved?: number;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}

export class DebutApplicationListQueryDto {
  @IsOptional()
  @IsIn(DEBUT_APPLICATION_STATUSES)
  status?: (typeof DEBUT_APPLICATION_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}

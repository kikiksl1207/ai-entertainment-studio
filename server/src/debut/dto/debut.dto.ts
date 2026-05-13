import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsArray,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
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

export const DEBUT_APPLICATION_CHANNELS = [
  'phone_consultation',
  'online_review',
] as const;

export const DEBUT_APPLICANT_TYPES = [
  'personal_unaffiliated',
  'represented_artist',
  'ai_creator_partner',
  'partnership_other',
] as const;

export const DEBUT_CONSULTATION_STATUSES = [
  'pending',
  'scheduled',
  'contacted',
  'no_answer',
  'completed',
] as const;

export const DEBUT_REVIEW_STATUSES = [
  'not_required',
  'pending',
  'reviewing',
  'cleared',
  'blocked',
] as const;

export const DEBUT_PARTNER_REVIEW_STATUSES = [
  'not_applicable',
  'pending',
  'reviewing',
  'accepted',
  'declined',
] as const;

export const DEBUT_MATERIAL_CATEGORIES = [
  'face_photo',
  'body_motion_reference',
  'voice_sample',
  'dance_video_reference',
  'portfolio_attachment',
] as const;

export const DEBUT_ARTIST_DEBUT_MODES = [
  'own_appearance_public',
  'private_debut',
  'partial_materials',
  'creator_directed',
] as const;

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeStringArray = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

const booleanQuery = ({ value }: { value: unknown }) => {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
};

export class CreateDebutApplicationDto {
  @IsOptional()
  @IsIn(DEBUT_APPLICATION_CHANNELS)
  applicationChannel?: (typeof DEBUT_APPLICATION_CHANNELS)[number];

  @IsOptional()
  @IsIn(DEBUT_APPLICANT_TYPES)
  applicationType?: (typeof DEBUT_APPLICANT_TYPES)[number];

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(120)
  affiliatedOrgName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(1000)
  rightsRelationshipNote?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(1000)
  creatorExperienceNote?: string;

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

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  applicantEmail?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(40)
  contactPhone?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(40)
  applicantPhone?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(120)
  preferredContactTime?: string;

  @IsOptional()
  @IsBoolean()
  consultationConsent?: boolean;

  @IsBoolean()
  isAdult!: boolean;

  @IsOptional()
  @IsIn(DEBUT_PARTICIPATION_TYPES)
  participationType?: (typeof DEBUT_PARTICIPATION_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(70)
  shareTierRequested?: number;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  intro?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  selfIntroduction?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(1000)
  portfolioUrl?: string;

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  portfolioUrls?: string[];

  @IsOptional()
  @IsIn(DEBUT_ARTIST_DEBUT_MODES)
  artistDebutMode?: (typeof DEBUT_ARTIST_DEBUT_MODES)[number];

  @IsOptional()
  @IsBoolean()
  providesAppearance?: boolean;

  @IsOptional()
  @IsBoolean()
  providesBodyOrMotion?: boolean;

  @IsOptional()
  @IsBoolean()
  providesSinging?: boolean;

  @IsOptional()
  @IsBoolean()
  providesVoice?: boolean;

  @IsOptional()
  @IsBoolean()
  providesDance?: boolean;

  @IsOptional()
  @IsBoolean()
  providesWorldview?: boolean;

  @IsOptional()
  @IsBoolean()
  canCommunicateWithFans?: boolean;

  @IsOptional()
  @IsBoolean()
  canCreateContent?: boolean;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(1000)
  otherContributionText?: string;

  @IsOptional()
  @IsBoolean()
  genderSwapRequested?: boolean;

  @IsOptional()
  @IsBoolean()
  genderPolicyAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  revenueShareNoticeAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  portraitVoiceMotionRightsAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  privacyReviewNoticeAccepted?: boolean;

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID('4', { each: true })
  facePhotoAssetIds?: string[];

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(12)
  @IsUUID('4', { each: true })
  bodyMotionReferenceAssetIds?: string[];

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  voiceSampleAssetIds?: string[];

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  danceVideoReferenceAssetIds?: string[];

  @IsOptional()
  @Transform(normalizeStringArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  portfolioAttachmentAssetIds?: string[];

  @IsOptional()
  @IsBoolean()
  consentAppearance?: boolean;

  @IsOptional()
  @IsBoolean()
  consentVoice?: boolean;

  @IsOptional()
  @IsBoolean()
  consentRightsRelationship?: boolean;

  @IsOptional()
  @IsBoolean()
  consentNoGuarantee?: boolean;

  @IsOptional()
  @IsBoolean()
  consentRevenuePolicy?: boolean;

  @IsBoolean()
  consentPrivacy!: boolean;

  @IsOptional()
  @IsBoolean()
  consentMarketing?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateDebutMaterialUploadIntentDto {
  @IsIn(DEBUT_MATERIAL_CATEGORIES)
  category!: (typeof DEBUT_MATERIAL_CATEGORIES)[number];

  @Transform(normalizeString)
  @IsString()
  @MaxLength(160)
  fileName!: string;

  @Transform(normalizeString)
  @IsString()
  @MaxLength(120)
  mimeType!: string;

  @IsInt()
  @Min(1)
  fileSizeBytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20000)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20000)
  height?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSeconds?: number;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(128)
  checksum?: string;
}

export class ConfirmDebutMaterialUploadDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  fileSizeBytes?: number;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(128)
  checksum?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(256)
  objectETag?: string;
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

  @IsOptional()
  @IsIn(DEBUT_CONSULTATION_STATUSES)
  consultationStatus?: (typeof DEBUT_CONSULTATION_STATUSES)[number];

  @IsOptional()
  @Transform(normalizeString)
  @IsISO8601()
  consultationScheduledAt?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(2000)
  consultationNote?: string;

  @IsOptional()
  @IsIn(DEBUT_REVIEW_STATUSES)
  rightsReviewStatus?: (typeof DEBUT_REVIEW_STATUSES)[number];

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(2000)
  rightsReviewNote?: string;

  @IsOptional()
  @IsIn(DEBUT_PARTNER_REVIEW_STATUSES)
  partnerReviewStatus?: (typeof DEBUT_PARTNER_REVIEW_STATUSES)[number];

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(2000)
  partnerReviewNote?: string;
}

export class DebutApplicationListQueryDto {
  @IsOptional()
  @IsIn(DEBUT_APPLICATION_STATUSES)
  status?: (typeof DEBUT_APPLICATION_STATUSES)[number];

  @IsOptional()
  @IsIn(DEBUT_APPLICATION_CHANNELS)
  applicationChannel?: (typeof DEBUT_APPLICATION_CHANNELS)[number];

  @IsOptional()
  @IsIn(DEBUT_APPLICANT_TYPES)
  applicationType?: (typeof DEBUT_APPLICANT_TYPES)[number];

  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  rightsReviewRequired?: boolean;

  @IsOptional()
  @Transform(booleanQuery)
  @IsBoolean()
  partnerReviewRequired?: boolean;

  @IsOptional()
  @IsIn(DEBUT_CONSULTATION_STATUSES)
  consultationStatus?: (typeof DEBUT_CONSULTATION_STATUSES)[number];

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Transform(normalizeString)
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(120)
  query?: string;
}

import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsUUID,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const SUPPORTED_LOCALES = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN'] as const;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'password must include at least one letter and one number',
  })
  password!: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(6)
  @MaxLength(24)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'referralCode can include only uppercase letters, numbers, underscores, and hyphens',
  })
  referralCode?: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  password!: string;
}

export class ChangePasswordDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  currentPassword!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must include at least one letter and one number',
  })
  newPassword!: string;
}

export class SetPasswordDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must include at least one letter and one number',
  })
  newPassword!: string;
}

export class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  currentPassword?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsUUID('4')
  avatarAssetId?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsUUID('4')
  coverAssetId?: string | null;
}

export class DisplayNameAvailabilityQueryDto {
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName!: string;
}

export class UpdateSettingsNotificationsDto {
  @IsOptional()
  @IsBoolean()
  activityNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  feedNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  pushOptIn?: boolean;
}

export class UpdateSettingsDto {
  @IsOptional()
  @Transform(normalizeString)
  @IsIn(SUPPORTED_LOCALES)
  locale?: (typeof SUPPORTED_LOCALES)[number];

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  pushOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  activityNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  feedNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSettingsNotificationsDto)
  notifications?: UpdateSettingsNotificationsDto;
}

export class RequestEmailVerificationDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmEmailVerificationDto {
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}

export class RequestPasswordResetDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class ConfirmPasswordResetDto {
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must include at least one letter and one number',
  })
  newPassword!: string;
}

export class UpdateSettlementProfileDto {
  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(40)
  bankName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(80)
  accountHolderName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @Matches(/^\d{2,4}$/, {
    message: 'accountLast4 must contain 2 to 4 digits',
  })
  accountLast4?: string;

  @IsOptional()
  @IsBoolean()
  holderMatchesIdentity?: boolean;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MaxLength(500)
  payoutExceptionReason?: string;
}

export class RefreshDto {
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  refreshToken!: string;
}

export class SocialLoginDto {
  @IsIn(['google', 'kakao', 'naver'])
  provider!: 'google' | 'kakao' | 'naver';

  @ValidateIf((input: SocialLoginDto) => !input.accessToken && !input.code)
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  token?: string;

  @ValidateIf((input: SocialLoginDto) => !input.token && !input.code)
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  accessToken?: string;

  @ValidateIf((input: SocialLoginDto) => !input.token && !input.accessToken)
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(2048)
  code?: string;

  @ValidateIf((input: SocialLoginDto) => Boolean(input.code))
  @Transform(normalizeString)
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @MaxLength(2048)
  redirectUri?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  displayName?: string;

  @IsOptional()
  @Transform(normalizeString)
  @IsString()
  @MinLength(6)
  @MaxLength(24)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'referralCode can include only uppercase letters, numbers, underscores, and hyphens',
  })
  referralCode?: string;
}

import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const normalizeString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

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
  @MaxLength(50)
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
  @MaxLength(50)
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

import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class SocialLoginDto {
  @IsIn(['google', 'kakao', 'apple'])
  provider!: 'google' | 'kakao' | 'apple';

  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

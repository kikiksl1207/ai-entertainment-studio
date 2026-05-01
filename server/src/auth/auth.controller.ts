import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  ConfirmPasswordResetDto,
  DeleteAccountDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestEmailVerificationDto,
  RequestPasswordResetDto,
  SocialLoginDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthUser } from './auth.types';
import { AuthService } from './auth.service';

type RequestLike = {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  header: (name: string) => string | undefined;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() body: RegisterDto, @Req() request: RequestLike) {
    return this.authService.register(body, getSessionContext(request));
  }

  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: LoginDto, @Req() request: RequestLike) {
    return this.authService.login(body, getSessionContext(request));
  }

  @Post('social/login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  socialLogin(@Body() body: SocialLoginDto, @Req() request: RequestLike) {
    return this.authService.socialLogin(body, getSessionContext(request));
  }

  @Get('social/providers')
  getSocialProviders() {
    return this.authService.getSocialProviders();
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() body: RefreshDto, @Req() request: RequestLike) {
    return this.authService.refresh(body.refreshToken, getSessionContext(request));
  }

  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  logout(@Body() body: RefreshDto) {
    return this.authService.logout(body.refreshToken);
  }

  @Post('email-verifications')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestEmailVerification(@Body() body: RequestEmailVerificationDto) {
    return this.authService.requestEmailVerification(body);
  }

  @Post('email-verifications/confirm')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirmEmailVerification(@Body() body: ConfirmEmailVerificationDto) {
    return this.authService.confirmEmailVerification(body);
  }

  @Post('password-resets')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(@Body() body: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(body);
  }

  @Post('password-resets/confirm')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirmPasswordReset(@Body() body: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(body);
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.id);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(user.id, body);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  deleteAccount(@CurrentUser() user: AuthUser, @Body() body: DeleteAccountDto) {
    return this.authService.deleteAccount(user.id, body);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  sessions(@CurrentUser() user: AuthUser) {
    return this.authService.listActiveSessions(user.id);
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  revokeAllSessions(@CurrentUser() user: AuthUser) {
    return this.authService.revokeAllSessions(user.id);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ) {
    return this.authService.revokeSession(user.id, sessionId);
  }
}

function getSessionContext(request: RequestLike) {
  return {
    userAgent: request.header('user-agent') ?? null,
    ipAddress: getClientIp(request),
  };
}

function getClientIp(request: RequestLike) {
  const forwardedFor = request.header('x-forwarded-for');
  const firstForwardedIp = forwardedFor?.split(',')[0]?.trim();
  const realIp = request.header('x-real-ip')?.trim();

  return firstForwardedIp || realIp || request.ip || null;
}

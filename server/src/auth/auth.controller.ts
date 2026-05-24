import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from './decorators/current-user.decorator';
import {
  ChangePasswordDto,
  ConfirmEmailVerificationDto,
  ConfirmIdentityVerificationDto,
  ConfirmPasswordResetDto,
  DeleteAccountDto,
  DisplayNameAvailabilityQueryDto,
  InspectPasswordResetDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestEmailVerificationDto,
  RequestIdentityVerificationDto,
  RequestPasswordResetDto,
  SetPasswordDto,
  SocialLoginDto,
  UpdateProfileDto,
  UpdateSettlementProfileDto,
  UpdateSettingsDto,
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

  @Get('display-name-availability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  displayNameAvailability(@Query() query: DisplayNameAvailabilityQueryDto) {
    return this.authService.checkDisplayNameAvailability(query.displayName);
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

  @Post('password-resets/inspect')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  inspectPasswordReset(@Body() body: InspectPasswordResetDto) {
    return this.authService.inspectPasswordReset(body);
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

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  summary(@CurrentUser() user: AuthUser) {
    return this.authService.getMyPageSummary(user.id);
  }

  @Get('trust')
  @UseGuards(JwtAuthGuard)
  trust(@CurrentUser() user: AuthUser) {
    return this.authService.getMyTrust(user.id);
  }

  @Get('identity-verifications/policy')
  @UseGuards(JwtAuthGuard)
  identityVerificationPolicy() {
    return this.authService.getIdentityVerificationPolicy();
  }

  @Post('identity-verifications')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestIdentityVerification(
    @CurrentUser() user: AuthUser,
    @Body() body: RequestIdentityVerificationDto,
  ) {
    return this.authService.requestIdentityVerification(user.id, body);
  }

  @Post('identity-verifications/:verificationId/confirm')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  confirmIdentityVerification(
    @CurrentUser() user: AuthUser,
    @Param('verificationId') verificationId: string,
    @Body() body: ConfirmIdentityVerificationDto,
  ) {
    return this.authService.confirmIdentityVerification(user.id, verificationId, body);
  }

  @Get('settlement-profile')
  @UseGuards(JwtAuthGuard)
  settlementProfile(@CurrentUser() user: AuthUser) {
    return this.authService.getMySettlementProfile(user.id);
  }

  @Patch('settlement-profile')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateSettlementProfile(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateSettlementProfileDto,
  ) {
    return this.authService.updateMySettlementProfile(user.id, body);
  }

  @Get('activity-ledger')
  @UseGuards(JwtAuthGuard)
  activityLedger(
    @CurrentUser() user: AuthUser,
    @Query('type') type?: string,
    @Query('take') take?: string,
  ) {
    return this.authService.getMyActivityLedger(user.id, { type, take });
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateProfile(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileDto) {
    return this.authService.updateProfile(user.id, body);
  }

  @Get('profile/display-name-availability')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  myDisplayNameAvailability(
    @CurrentUser() user: AuthUser,
    @Query() query: DisplayNameAvailabilityQueryDto,
  ) {
    return this.authService.checkDisplayNameAvailability(query.displayName, user.id);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  settings(@CurrentUser() user: AuthUser) {
    return this.authService.getSettings(user.id);
  }

  @Patch('settings')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: UpdateSettingsDto) {
    return this.authService.updateSettings(user.id, body);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordDto) {
    return this.authService.changePassword(user.id, body);
  }

  @Patch('password/setup')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setPassword(@CurrentUser() user: AuthUser, @Body() body: SetPasswordDto) {
    return this.authService.setPassword(user.id, body);
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

@Controller('localization')
export class LocalizationController {
  constructor(private readonly authService: AuthService) {}

  @Get('policy')
  policy(@Req() req: RequestLike) {
    return this.authService.getLocalizationPolicy(req.header('accept-language'));
  }
}

@Controller('app')
export class AppBootstrapController {
  constructor(private readonly authService: AuthService) {}

  @Get('bootstrap')
  bootstrap(@Req() req: RequestLike) {
    return this.authService.getPublicBootstrap(req.header('accept-language'));
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

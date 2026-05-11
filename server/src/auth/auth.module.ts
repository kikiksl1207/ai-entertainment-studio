import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  AppBootstrapController,
  AuthController,
  LocalizationController,
  MeController,
} from './auth.controller';
import { AuthService } from './auth.service';
import { AuthEmailDeliveryService } from './auth-email-delivery.service';
import { AdminPermissionGuard } from './guards/admin-permission.guard';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { SocialAuthService } from './social-auth.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [
    AuthController,
    MeController,
    LocalizationController,
    AppBootstrapController,
  ],
  providers: [
    AuthService,
    AuthEmailDeliveryService,
    SocialAuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
  exports: [
    JwtModule,
    AuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
})
export class AuthModule {}

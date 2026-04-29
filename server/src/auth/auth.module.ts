import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminPermissionGuard } from './guards/admin-permission.guard';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SocialAuthService } from './social-auth.service';

@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    SocialAuthService,
    JwtAuthGuard,
    AdminAuthGuard,
    AdminPermissionGuard,
  ],
  exports: [JwtModule, AuthService, JwtAuthGuard, AdminAuthGuard, AdminPermissionGuard],
})
export class AuthModule {}

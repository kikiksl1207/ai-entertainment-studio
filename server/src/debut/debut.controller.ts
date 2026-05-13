import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AdminUpdateDebutApplicationDto,
  ConfirmDebutMaterialUploadDto,
  CreateDebutApplicationDto,
  CreateDebutMaterialUploadIntentDto,
  DebutApplicationListQueryDto,
} from './dto/debut.dto';
import { DebutService } from './debut.service';

@Controller()
export class DebutController {
  constructor(private readonly debutService: DebutService) {}

  @Get('debut/policy')
  getPolicy() {
    return this.debutService.getPolicy();
  }

  @Post('debut/applications')
  @UseGuards(JwtAuthGuard)
  createApplication(@CurrentUser() user: AuthUser, @Body() body: CreateDebutApplicationDto) {
    return this.debutService.createApplication(user.id, body);
  }

  @Post('debut/application-materials/upload-intents')
  @UseGuards(JwtAuthGuard)
  createMaterialUploadIntent(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateDebutMaterialUploadIntentDto,
  ) {
    return this.debutService.createMaterialUploadIntent(user.id, body);
  }

  @Post('debut/application-materials/:assetId/confirm-upload')
  @UseGuards(JwtAuthGuard)
  confirmMaterialUpload(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body() body: ConfirmDebutMaterialUploadDto,
  ) {
    return this.debutService.confirmMaterialUpload(user.id, assetId, body);
  }

  @Get('me/debut-applications')
  @UseGuards(JwtAuthGuard)
  getMyApplications(@CurrentUser() user: AuthUser) {
    return this.debutService.getMyApplications(user.id);
  }

  @Get('me/debut-applications/latest')
  @UseGuards(JwtAuthGuard)
  getMyLatestApplication(@CurrentUser() user: AuthUser) {
    return this.debutService.getMyLatestApplication(user.id);
  }

  @Post('me/debut-applications/:applicationId/withdraw')
  @UseGuards(JwtAuthGuard)
  withdrawMyApplication(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.debutService.withdrawMyApplication(user.id, applicationId);
  }
}

@Controller('/admin/api/v1/debut')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class DebutAdminController {
  constructor(private readonly debutService: DebutService) {}

  @Get('applications')
  @RequireAdminPermissions('*')
  getApplications(@Query() query: DebutApplicationListQueryDto) {
    return this.debutService.getApplications(query);
  }

  @Get('applications/:applicationId')
  @RequireAdminPermissions('*')
  getApplication(@Param('applicationId') applicationId: string) {
    return this.debutService.getApplication(applicationId);
  }

  @Patch('applications/:applicationId')
  @RequireAdminPermissions('*')
  updateApplication(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: AdminUpdateDebutApplicationDto,
  ) {
    return this.debutService.updateApplication(user, applicationId, body);
  }
}

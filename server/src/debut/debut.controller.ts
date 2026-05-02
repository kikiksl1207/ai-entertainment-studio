import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DebutService } from './debut.service';

type DebutPayload = Record<string, unknown>;
type DebutQuery = Record<string, string | undefined>;

@Controller()
export class DebutController {
  constructor(private readonly debutService: DebutService) {}

  @Post('debut/applications')
  @UseGuards(JwtAuthGuard)
  createApplication(@CurrentUser() user: AuthUser, @Body() body: DebutPayload) {
    return this.debutService.createApplication(user.id, body);
  }

  @Get('me/debut-applications')
  @UseGuards(JwtAuthGuard)
  getMyApplications(@CurrentUser() user: AuthUser) {
    return this.debutService.getMyApplications(user.id);
  }
}

@Controller('/admin/api/v1/debut')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class DebutAdminController {
  constructor(private readonly debutService: DebutService) {}

  @Get('applications')
  @RequireAdminPermissions('*')
  getApplications(@Query() query: DebutQuery) {
    return this.debutService.getApplications(query);
  }

  @Patch('applications/:applicationId')
  @RequireAdminPermissions('*')
  updateApplication(
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Body() body: DebutPayload,
  ) {
    return this.debutService.updateApplication(user, applicationId, body);
  }
}

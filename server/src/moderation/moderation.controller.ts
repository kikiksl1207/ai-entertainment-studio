import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModerationService } from './moderation.service';

type ModerationPreviewBody = {
  surface?: string;
  body?: string;
};

type ModerationReportBody = Record<string, unknown>;
type ModerationReportQuery = Record<string, string | undefined>;

@Controller('moderation')
@UseGuards(JwtAuthGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post('preview')
  preview(@Body() body: ModerationPreviewBody) {
    if (!body?.body || !body.body.trim()) {
      throw new BadRequestException('body is required');
    }

    return this.moderationService.preview({
      surface: body.surface,
      body: body.body,
    });
  }

  @Post('reports')
  createReport(@CurrentUser() user: AuthUser, @Body() body: ModerationReportBody) {
    return this.moderationService.createReport(user.id, body);
  }
}

@Controller('/admin/api/v1/moderation/reports')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class ModerationAdminController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get()
  @RequireAdminPermissions('community:read')
  listReports(@Query() query: ModerationReportQuery) {
    return this.moderationService.listReports(query);
  }

  @Get(':reportId')
  @RequireAdminPermissions('community:read')
  getReport(@Param('reportId') reportId: string) {
    return this.moderationService.getReport(reportId);
  }

  @Patch(':reportId')
  @RequireAdminPermissions('community:write')
  updateReport(
    @CurrentUser() user: AuthUser,
    @Param('reportId') reportId: string,
    @Body() body: ModerationReportBody,
  ) {
    return this.moderationService.updateReport(user, reportId, body);
  }
}

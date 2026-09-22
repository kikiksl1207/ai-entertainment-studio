import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { PromoteStoryUploadDto } from './dto/story-publication-intake.dto';
import { StoryPublicationIntakeService } from './story-publication-intake.service';

@Controller('/admin/api/v1/backstage/story-publication')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryPublicationIntakeController {
  constructor(private readonly publication: StoryPublicationIntakeService) {}

  @Get('submissions')
  @RequireAdminPermissions('*')
  submissions() {
    return this.publication.submissions();
  }

  @Post('submissions/:submissionId/promote')
  @RequireAdminPermissions('*')
  promote(
    @CurrentUser() user: AuthUser,
    @Param('submissionId') submissionId: string,
    @Body() body: PromoteStoryUploadDto,
  ) {
    return this.publication.promote(user.id, submissionId, body);
  }
}

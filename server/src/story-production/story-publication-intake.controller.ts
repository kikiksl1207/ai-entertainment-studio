import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { StoryUploadIntakeDto } from '../story-upload/dto/story-upload-intake.dto';
import { StoryUploadService } from '../story-upload/story-upload.service';
import { StoryUploadFileFields } from '../story-upload/story-upload.types';
import { PromoteStoryUploadDto } from './dto/story-publication-intake.dto';
import { StoryPublicationIntakeService } from './story-publication-intake.service';

@Controller('/admin/api/v1/backstage/story-publication')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryPublicationIntakeController {
  constructor(
    private readonly publication: StoryPublicationIntakeService,
    private readonly uploads: StoryUploadService,
  ) {}

  @Get('submissions')
  @RequireAdminPermissions('*')
  submissions() {
    return this.publication.submissions();
  }

  @Post('submissions/publish-approved')
  @RequireAdminPermissions('*')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'manuscripts', maxCount: 2 }], {
      limits: { files: 2, fields: 10, fileSize: 50 * 1024 * 1024 },
    }),
  )
  publishApproved(
    @CurrentUser() user: AuthUser,
    @Body() body: PromoteStoryUploadDto,
    @UploadedFiles() files: StoryUploadFileFields,
  ) {
    return this.publication.publishApproved(user.id, body, files ?? {});
  }

  @Post('submissions')
  @RequireAdminPermissions('*')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'manuscripts', maxCount: 10 },
        { name: 'metadata', maxCount: 10 },
        { name: 'visuals', maxCount: 20 },
      ],
      {
        limits: {
          files: 40,
          fields: 10,
          fileSize: 50 * 1024 * 1024,
        },
      },
    ),
  )
  intake(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: StoryUploadIntakeDto,
    @UploadedFiles() files: StoryUploadFileFields,
  ) {
    return this.uploads.intake(user.id, body, files ?? {}, idempotencyKey);
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

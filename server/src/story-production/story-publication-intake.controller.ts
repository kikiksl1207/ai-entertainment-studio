import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { StoryUploadIntakeDto } from '../story-upload/dto/story-upload-intake.dto';
import { StoryUploadService } from '../story-upload/story-upload.service';
import {
  StoryUploadFile,
  StoryUploadFileFields,
} from '../story-upload/story-upload.types';
import { ActivatePublishedStoryAiDto, PromoteStoryUploadDto } from './dto/story-publication-intake.dto';
import { StoryPublicBetaAiActivationService } from './story-public-beta-ai-activation.service';
import { StoryPublicationIntakeService } from './story-publication-intake.service';

@Controller('/admin/api/v1/backstage/story-publication')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryPublicationIntakeController {
  constructor(
    private readonly publication: StoryPublicationIntakeService,
    private readonly uploads: StoryUploadService,
    private readonly aiActivation: StoryPublicBetaAiActivationService,
  ) {}

  @Get('submissions')
  @RequireAdminPermissions('*')
  submissions() {
    return this.publication.submissions();
  }

  @Get('published/:storyKey/ai-status')
  @RequireAdminPermissions('*')
  aiStatus(@Param('storyKey') storyKey: string) {
    return this.aiActivation.status(storyKey);
  }

  @Post('published/:storyKey/activate-ai')
  @RequireAdminPermissions('*')
  activateAi(
    @CurrentUser() user: AuthUser,
    @Param('storyKey') storyKey: string,
    @Body() body: ActivatePublishedStoryAiDto,
  ) {
    return this.aiActivation.activate(user.id, storyKey, body);
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

  @Post('submissions/publish-approved/start')
  @RequireAdminPermissions('*')
  startApprovedUpload(
    @CurrentUser() user: AuthUser,
    @Body() body: PromoteStoryUploadDto,
  ) {
    return this.publication.startApprovedUpload(user.id, body);
  }

  @Post('submissions/jobs/:jobId/source-chunks/:position')
  @RequireAdminPermissions('*')
  @UseInterceptors(FileInterceptor('chunk', {
    limits: { files: 1, fields: 0, fileSize: 768 * 1024 },
  }))
  uploadApprovedSourceChunk(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
    @Param('position') position: string,
    @Headers('x-total-chunks') totalChunks: string | undefined,
    @UploadedFile() chunk: StoryUploadFile | undefined,
  ) {
    return this.publication.uploadApprovedSourceChunk(
      user.id,
      jobId,
      position,
      totalChunks,
      chunk,
    );
  }

  @Post('submissions/jobs/:jobId/prepare')
  @RequireAdminPermissions('*')
  prepareApprovedSourceChunks(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ) {
    return this.publication.prepareApprovedSourceChunks(user.id, jobId);
  }

  @Post('submissions/jobs/:jobId/process')
  @RequireAdminPermissions('*')
  processApprovedJob(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ) {
    return this.publication.processApprovedJob(user.id, jobId);
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

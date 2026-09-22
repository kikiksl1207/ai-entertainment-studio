import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApproveCreatorGenerationProfileDto,
  UpdateStoryGenerationProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { StoryUploadIntakeDto } from './dto/story-upload-intake.dto';
import { StoryUploadService } from './story-upload.service';
import { StoryUploadFileFields } from './story-upload.types';

@Controller('story-upload')
export class StoryUploadController {
  constructor(private readonly storyUploadService: StoryUploadService) {}

  @Post('intake')
  @UseGuards(JwtAuthGuard)
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
    return this.storyUploadService.intake(user.id, body, files ?? {}, idempotencyKey);
  }

  @Get('submissions/:submissionId/generation-profile')
  @UseGuards(JwtAuthGuard)
  getGenerationProfile(
    @CurrentUser() user: AuthUser,
    @Param('submissionId') submissionId: string,
  ) {
    return this.storyUploadService.getGenerationProfile(user.id, submissionId);
  }

  @Patch('submissions/:submissionId/generation-profile')
  @UseGuards(JwtAuthGuard)
  updateGenerationProfile(
    @CurrentUser() user: AuthUser,
    @Param('submissionId') submissionId: string,
    @Body() body: UpdateStoryGenerationProfileDto,
  ) {
    return this.storyUploadService.updateGenerationProfile(user.id, submissionId, body);
  }

  @Post('submissions/:submissionId/generation-profile/approve')
  @UseGuards(JwtAuthGuard)
  approveGenerationProfile(
    @CurrentUser() user: AuthUser,
    @Param('submissionId') submissionId: string,
    @Body() body: ApproveCreatorGenerationProfileDto,
  ) {
    return this.storyUploadService.approveGenerationProfile(user.id, submissionId, body);
  }
}

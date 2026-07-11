import {
  Body,
  Controller,
  Headers,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
}

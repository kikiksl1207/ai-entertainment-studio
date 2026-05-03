import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModerationService } from './moderation.service';

type ModerationPreviewBody = {
  surface?: string;
  body?: string;
};

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
}

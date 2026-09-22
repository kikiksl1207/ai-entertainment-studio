import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  RegisterStoryVisualPromptsDto,
  RequestStoryVisualDto,
} from './dto/story-visual-generation.dto';
import { StoryVisualGenerationService } from './story-visual-generation.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class StoryVisualGenerationController {
  constructor(private readonly visuals: StoryVisualGenerationService) {}

  @Post('me/story-progress/:progressId/scene-visual')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  requestSceneVisual(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Body() body: RequestStoryVisualDto,
  ) {
    return this.visuals.requestForProgress(user.id, progressId, body.sourceSceneKey);
  }
}

@Controller('/admin/api/v1/story-visuals')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryVisualGenerationAdminController {
  constructor(private readonly visuals: StoryVisualGenerationService) {}

  @Post(':workId/prompts')
  @RequireAdminPermissions('*')
  registerPrompts(
    @Param('workId') workId: string,
    @Body() body: RegisterStoryVisualPromptsDto,
  ) {
    return this.visuals.registerVerifiedPrompts(workId, body);
  }
}

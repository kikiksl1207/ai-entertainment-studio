import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ServerResponse } from 'http';
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

@Controller('story-visual-assets')
export class StoryVisualAssetController {
  constructor(private readonly visuals: StoryVisualGenerationService) {}

  @Get(':assetId')
  async deliver(@Param('assetId') assetId: string, @Res() response: ServerResponse) {
    const delivery = await this.visuals.publicVisualAsset(assetId);
    if (delivery.kind === 'redirect') {
      response.statusCode = 302;
      response.setHeader('location', delivery.url);
      response.end();
      return;
    }
    response.statusCode = 200;
    response.setHeader('content-type', delivery.mimeType);
    response.setHeader('content-length', String(delivery.image.length));
    response.setHeader('cache-control', 'public, max-age=31536000, immutable');
    response.end(delivery.image);
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

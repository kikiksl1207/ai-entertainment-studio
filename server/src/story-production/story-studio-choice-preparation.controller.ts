import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryStudioChoicePreparationService } from './story-studio-choice-preparation.service';

@Controller('me/creator-studio/stories/:workId/releases/:releaseId/scenes')
@UseGuards(JwtAuthGuard)
export class StoryStudioChoicePreparationController {
  constructor(private readonly choices: StoryStudioChoicePreparationService) {}

  @Post(':sceneId/prepare-choices')
  prepare(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Param('releaseId') releaseId: string, @Param('sceneId') sceneId: string) {
    return this.choices.prepare(user.id, workId, releaseId, sceneId);
  }
}

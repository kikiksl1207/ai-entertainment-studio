import { BadRequestException, CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';

class AuthorBodyTrialCostNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-trial-cost')
@UseGuards(AuthorBodyTrialCostNoStoreGuard, JwtAuthGuard)
export class StoryAuthorBodyTrialCostController {
  constructor(private readonly costs: StoryAuthorBodyTrialCostService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  current(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_INPUT_INVALID' });
    }
    return this.costs.current(user.id, workId);
  }
}

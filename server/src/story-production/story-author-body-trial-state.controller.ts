import {
  BadRequestException,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorBodyTrialStateService } from './story-author-body-trial-state.service';

class AuthorBodyTrialStateNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-trial-state')
@UseGuards(AuthorBodyTrialStateNoStoreGuard, JwtAuthGuard)
export class StoryAuthorBodyTrialStateController {
  constructor(private readonly states: StoryAuthorBodyTrialStateService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  current(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Req() request: { url: string },
  ) {
    // Reject raw queries, including keys omitted by the HTTP query parser.
    if (new URL(request.url, 'http://localhost').search) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_INPUT_INVALID' });
    }
    return this.states.current(user.id, workId);
  }
}

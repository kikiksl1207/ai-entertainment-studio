import { CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorCurrentFitQueryDto } from './dto/story-author-current-fit.dto';
import { StoryAuthorCurrentFitService } from './story-author-current-fit.service';

class CurrentFitNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-preview/current-fit')
@UseGuards(CurrentFitNoStoreGuard, JwtAuthGuard)
export class StoryAuthorCurrentFitController {
  constructor(private readonly currentFit: StoryAuthorCurrentFitService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  inspect(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryAuthorCurrentFitQueryDto) {
    return this.currentFit.inspect(user.id, workId, query);
  }
}

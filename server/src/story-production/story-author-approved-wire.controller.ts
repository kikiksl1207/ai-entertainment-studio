import { CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorApprovedWireQueryDto } from './dto/story-author-approved-wire.dto';
import { StoryAuthorApprovedWireService } from './story-author-approved-wire.service';

class ApprovedWireNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Authorization');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/generation-profile/approved-wire')
@UseGuards(ApprovedWireNoStoreGuard, JwtAuthGuard)
export class StoryAuthorApprovedWireController {
  constructor(private readonly wire: StoryAuthorApprovedWireService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  inspect(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryAuthorApprovedWireQueryDto) {
    return this.wire.inspect(user.id, workId, query);
  }
}

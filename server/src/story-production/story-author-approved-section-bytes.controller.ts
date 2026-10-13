import { CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryAuthorApprovedSectionBytesQueryDto } from './dto/story-author-approved-section-bytes.dto';
import { StoryAuthorApprovedSectionBytesService } from './story-author-approved-section-bytes.service';

class ApprovedSectionBytesNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Authorization');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/generation-profile/approved-section-bytes')
@UseGuards(ApprovedSectionBytesNoStoreGuard, JwtAuthGuard)
export class StoryAuthorApprovedSectionBytesController {
  constructor(private readonly sectionBytes: StoryAuthorApprovedSectionBytesService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Access-Control-Expose-Headers', 'Vary')
  inspect(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryAuthorApprovedSectionBytesQueryDto) {
    return this.sectionBytes.inspect(user.id, workId, query);
  }
}

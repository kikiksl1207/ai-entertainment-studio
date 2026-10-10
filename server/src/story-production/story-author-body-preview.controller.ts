import { CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StoryLocaleQueryDto } from './dto/story-production.dto';
import { StoryAuthorBodyPreviewService } from './story-author-body-preview.service';

class AuthorBodyPreviewNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/creator-studio/stories/:workId/body-preview')
@UseGuards(AuthorBodyPreviewNoStoreGuard, JwtAuthGuard)
export class StoryAuthorBodyPreviewController {
  constructor(private readonly previewService: StoryAuthorBodyPreviewService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  preview(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryLocaleQueryDto) {
    return this.previewService.preview(user.id, workId, query);
  }

  @Get('original-reference')
  @Header('Cache-Control', 'private, no-store')
  originalReference(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryLocaleQueryDto) {
    return this.previewService.originalReference(user.id, workId, query);
  }

  @Get('length-diagnostic')
  @Header('Cache-Control', 'private, no-store')
  lengthDiagnostic(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryLocaleQueryDto) {
    return this.previewService.lengthDiagnostic(user.id, workId, query);
  }

  @Get('style-reference')
  @Header('Cache-Control', 'private, no-store')
  styleReference(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryLocaleQueryDto) {
    return this.previewService.styleReference(user.id, workId, query);
  }
}

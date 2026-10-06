import { Body, CanActivate, Controller, ExecutionContext, Get, Header, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmStoryGeneratedEndingReadDto, StoryGeneratedEndingReadQueryDto } from './dto/story-generated-ending-read.dto';
import { StoryGeneratedEndingReadService } from './story-generated-ending-read.service';

export function generatedEndingReadPrivacyMiddleware(request: { url: string },
  response: { setHeader(name: string, value: string): void }, next: () => void) {
  if (/^\/api\/(?:v1\/)?me\/story-progress\/[^/?]+\/generated-ending-read(?:[/?]|$)/i.test(request.url)) {
    response.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}

class GeneratedEndingReadNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

@Controller('me/story-progress/:progressId/generated-ending-read')
@UseGuards(GeneratedEndingReadNoStoreGuard, JwtAuthGuard)
export class StoryGeneratedEndingReadController {
  constructor(private readonly reads: StoryGeneratedEndingReadService) {}

  @Get() @Header('Cache-Control', 'private, no-store')
  preview(@CurrentUser() user: AuthUser, @Param('progressId', ParseUUIDPipe) progressId: string,
    @Query() query: StoryGeneratedEndingReadQueryDto) {
    return this.reads.preview(user.id, progressId, query);
  }

  @Post('confirm') @Header('Cache-Control', 'private, no-store')
  confirm(@CurrentUser() user: AuthUser, @Param('progressId', ParseUUIDPipe) progressId: string,
    @Body() body: ConfirmStoryGeneratedEndingReadDto) {
    return this.reads.confirm(user.id, progressId, body);
  }
}

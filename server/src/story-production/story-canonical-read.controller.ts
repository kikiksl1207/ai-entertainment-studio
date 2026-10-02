import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConfirmStoryCanonicalReadDto, StoryCanonicalReadQueryDto } from './dto/story-canonical-read.dto';
import { StoryCanonicalReadService } from './story-canonical-read.service';

@Controller('me/story-progress/:progressId/canonical-read/:beatId')
@UseGuards(JwtAuthGuard)
export class StoryCanonicalReadController {
  constructor(private readonly reads: StoryCanonicalReadService) {}

  @Get() @Header('Cache-Control', 'private, no-store')
  preview(@CurrentUser() user: AuthUser, @Param('progressId', ParseUUIDPipe) progressId: string,
    @Param('beatId', ParseUUIDPipe) beatId: string, @Query() query: StoryCanonicalReadQueryDto) {
    return this.reads.preview(user.id, progressId, beatId, query);
  }

  @Post('confirm') @Header('Cache-Control', 'private, no-store')
  confirm(@CurrentUser() user: AuthUser, @Param('progressId', ParseUUIDPipe) progressId: string,
    @Param('beatId', ParseUUIDPipe) beatId: string, @Body() input: ConfirmStoryCanonicalReadDto) {
    return this.reads.confirm(user.id, progressId, beatId, input);
  }
}

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MaterializeStudioLinearDto } from './dto/story-studio-linear.dto';
import { StoryStudioLinearService } from './story-studio-linear.service';

@Controller('me/creator-studio/stories/:workId')
@UseGuards(JwtAuthGuard)
export class StoryStudioLinearController {
  constructor(private readonly linear: StoryStudioLinearService) {}

  @Get('linear-draft/:manuscriptVersionId')
  preview(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Param('manuscriptVersionId') manuscriptVersionId: string) {
    return this.linear.preview(user.id, workId, manuscriptVersionId);
  }

  @Post('linear-draft/materialize')
  materialize(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Body() body: MaterializeStudioLinearDto) {
    return this.linear.materialize(user.id, workId, body);
  }

  @Post('linear-draft/releases/:releaseId/finish')
  finish(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Param('releaseId') releaseId: string) {
    return this.linear.finish(user.id, workId, releaseId);
  }
}

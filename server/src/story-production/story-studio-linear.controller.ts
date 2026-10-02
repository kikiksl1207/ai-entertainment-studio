import { Body, ConflictException, Controller, Get, Header, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MaterializeStudioLinearDto, ReapproveStudioChoicesDto, ResetStudioChoicesDto, StudioVisualReferenceDetailDto, StudioVisualReferencePageDto } from './dto/story-studio-linear.dto';
import { StoryStudioLinearService } from './story-studio-linear.service';
import { StoryStudioChoiceJobService } from './story-studio-choice-job.service';
import { StoryStudioChoiceRecoveryService } from './story-studio-choice-recovery.service';

@Controller('me/creator-studio/stories/:workId')
@UseGuards(JwtAuthGuard)
export class StoryStudioLinearController {
  constructor(private readonly linear: StoryStudioLinearService,
    private readonly choiceJobs: StoryStudioChoiceJobService,
    private readonly recovery: StoryStudioChoiceRecoveryService) {}

  @Get('linear-draft/:manuscriptVersionId')
  @Header('Cache-Control', 'private, no-store')
  preview(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Param('manuscriptVersionId') manuscriptVersionId: string) {
    return this.linear.preview(user.id, workId, manuscriptVersionId);
  }

  @Get('linear-draft/:manuscriptVersionId/visual-references')
  @Header('Cache-Control', 'private, no-store')
  visualReferencePage(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string, @Query() query: StudioVisualReferencePageDto) {
    return this.linear.visualReferencePage(user.id, workId, manuscriptVersionId, query);
  }

  @Get('linear-draft/:manuscriptVersionId/visual-references/:referenceIndex')
  @Header('Cache-Control', 'private, no-store')
  visualReferenceDetail(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string,
    @Param('referenceIndex', ParseIntPipe) referenceIndex: number, @Query() query: StudioVisualReferenceDetailDto) {
    return this.linear.visualReferenceDetail(user.id, workId, manuscriptVersionId, referenceIndex, query);
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

  @Post('linear-draft/releases/:releaseId/retry-choices')
  async retryChoices(@CurrentUser() user: AuthUser, @Param('workId') workId: string,
    @Param('releaseId') releaseId: string) {
    const review = await this.recovery.review(user.id, workId, releaseId);
    if (!['current', 'reset_ready'].includes(review.status)) throw new ConflictException({
      code: review.code || 'STUDIO_CHOICES_RESET_REVIEW_REQUIRED',
    });
    return this.choiceJobs.retry(user.id, workId, releaseId);
  }

  @Get('linear-draft/releases/:releaseId/choice-review')
  @Header('Cache-Control', 'private, no-store')
  reviewChoices(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string) {
    return this.recovery.review(user.id, workId, releaseId);
  }

  @Post('linear-draft/releases/:releaseId/reset-choices')
  @Header('Cache-Control', 'private, no-store')
  resetChoices(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string, @Body() body: ResetStudioChoicesDto) {
    return this.recovery.reset(user.id, workId, releaseId, body);
  }

  @Post('linear-draft/releases/:releaseId/reapprove-choices')
  @Header('Cache-Control', 'private, no-store')
  reapproveChoices(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('releaseId', ParseUUIDPipe) releaseId: string, @Body() body: ReapproveStudioChoicesDto) {
    return this.recovery.reapprove(user.id, workId, releaseId, body);
  }
}

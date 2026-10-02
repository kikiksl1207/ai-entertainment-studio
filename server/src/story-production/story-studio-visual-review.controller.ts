import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, PipeTransform, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StudioVisualReferenceIdentityDto } from './dto/story-studio-linear.dto';
import { ApproveStudioVisualReviewBatchDto, SaveStudioVisualReviewBatchDto, SelectStudioPartVisualDto } from './dto/story-studio-visual-review.dto';
import { StoryStudioVisualReviewService } from './story-studio-visual-review.service';

class VisualReviewReferenceIndexPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,3})$/.test(value) || Number(value) > 1999) {
      throw new BadRequestException({ code: 'STUDIO_VISUAL_REVIEW_REFERENCE_INVALID' });
    }
    return value;
  }
}

@Controller('me/creator-studio/stories/:workId/linear-draft/:manuscriptVersionId')
@UseGuards(JwtAuthGuard)
export class StoryStudioVisualReviewController {
  constructor(private readonly reviewService: StoryStudioVisualReviewService) {}

  @Get('visual-review/:referenceIndex')
  @Header('Cache-Control', 'private, no-store')
  review(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string,
    @Param('referenceIndex', new VisualReviewReferenceIndexPipe()) referenceIndex: string, @Query() query: StudioVisualReferenceIdentityDto) {
    return this.reviewService.review(user.id, workId, manuscriptVersionId, Number(referenceIndex), query);
  }

  @Post('visual-review-batches')
  @Header('Cache-Control', 'private, no-store')
  save(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string, @Body() input: SaveStudioVisualReviewBatchDto) {
    return this.reviewService.save(user.id, workId, manuscriptVersionId, input);
  }

  @Post('visual-review/:referenceIndex/representative')
  @Header('Cache-Control', 'private, no-store')
  representative(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string,
    @Param('referenceIndex', new VisualReviewReferenceIndexPipe()) referenceIndex: string, @Body() input: SelectStudioPartVisualDto) {
    return this.reviewService.selectRepresentative(user.id, workId, manuscriptVersionId, Number(referenceIndex), input);
  }

  @Post('visual-review-batches/:batchId/approve')
  @Header('Cache-Control', 'private, no-store')
  approve(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('manuscriptVersionId', ParseUUIDPipe) manuscriptVersionId: string, @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() input: ApproveStudioVisualReviewBatchDto) {
    return this.reviewService.approve(user.id, workId, manuscriptVersionId, batchId, input);
  }
}

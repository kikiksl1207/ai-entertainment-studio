import {
  BadRequestException, Body, CanActivate, Controller, ExecutionContext, Get, Header, Param,
  ParseUUIDPipe, PipeTransform, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApproveBranchVisualReviewBatchDto, BranchVisualReviewListQueryDto, SaveBranchVisualReviewBatchDto } from './dto/story-branch-visual-review.dto';
import { StoryBranchVisualReviewService } from './story-branch-visual-review.service';

class BranchVisualReviewNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    // Set this before JWT validation so denials are also private and uncached.
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

class BranchVisualReviewNoQueryPipe implements PipeTransform<Record<string, unknown>, Record<string, unknown>> {
  transform(query: Record<string, unknown>) {
    if (Object.keys(query).length) {
      throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_QUERY_INVALID' });
    }
    return query;
  }
}

class BranchVisualReviewBodyPipe implements PipeTransform {
  transform(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException({ code: 'STORY_BRANCH_VISUAL_REVIEW_BODY_INVALID' });
    }
    return body;
  }
}

@Controller('me/creator-studio/stories/:workId/shared-branches')
@UseGuards(BranchVisualReviewNoStoreGuard, JwtAuthGuard)
export class StoryBranchVisualReviewListController {
  constructor(private readonly reviewService: StoryBranchVisualReviewService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string, @Query() query: BranchVisualReviewListQueryDto) {
    return this.reviewService.list(user.id, workId, query);
  }
}

@Controller('me/creator-studio/stories/:workId/shared-branches/:sharedResultId/visual-review')
@UseGuards(BranchVisualReviewNoStoreGuard, JwtAuthGuard)
export class StoryBranchVisualReviewController {
  constructor(private readonly reviewService: StoryBranchVisualReviewService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  review(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('sharedResultId', ParseUUIDPipe) sharedResultId: string,
    @Query(new BranchVisualReviewNoQueryPipe()) _query: Record<string, unknown>) {
    return this.reviewService.review(user.id, workId, sharedResultId);
  }

  @Post('drafts')
  @Header('Cache-Control', 'private, no-store')
  save(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('sharedResultId', ParseUUIDPipe) sharedResultId: string,
    @Query(new BranchVisualReviewNoQueryPipe()) _query: Record<string, unknown>,
    @Body(new BranchVisualReviewBodyPipe()) input: SaveBranchVisualReviewBatchDto) {
    return this.reviewService.save(user.id, workId, sharedResultId, input);
  }

  @Post('drafts/:batchId/approve')
  @Header('Cache-Control', 'private, no-store')
  approve(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('sharedResultId', ParseUUIDPipe) sharedResultId: string, @Param('batchId', ParseUUIDPipe) batchId: string,
    @Query(new BranchVisualReviewNoQueryPipe()) _query: Record<string, unknown>,
    @Body(new BranchVisualReviewBodyPipe()) input: ApproveBranchVisualReviewBatchDto) {
    return this.reviewService.approve(user.id, workId, sharedResultId, batchId, input);
  }
}

import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApproveStoryInteractionDto, RevokeStoryInteractionDto, StoryInteractionCatalogQueryDto, StoryInteractionReviewQueryDto } from './dto/story-interaction-approval.dto';
import { StoryInteractionApprovalService } from './story-interaction-approval.service';

@Controller('me/creator-studio/stories/:workId/interactions')
@UseGuards(JwtAuthGuard)
export class StoryInteractionApprovalController {
  constructor(private readonly approvals: StoryInteractionApprovalService) {}

  @Get('beats') @Header('Cache-Control', 'private, no-store')
  catalog(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryInteractionCatalogQueryDto) {
    return this.approvals.catalog(user.id, workId, query);
  }

  @Get('beats/:beatId') @Header('Cache-Control', 'private, no-store')
  review(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('beatId', ParseUUIDPipe) beatId: string, @Query() query: StoryInteractionReviewQueryDto) {
    return this.approvals.review(user.id, workId, beatId, query);
  }

  @Post('beats/:beatId/approve') @Header('Cache-Control', 'private, no-store')
  approve(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('beatId', ParseUUIDPipe) beatId: string, @Body() input: ApproveStoryInteractionDto) {
    return this.approvals.approve(user.id, workId, beatId, input);
  }

  @Post(':approvalId/revoke') @Header('Cache-Control', 'private, no-store')
  revoke(@CurrentUser() user: AuthUser, @Param('workId', ParseUUIDPipe) workId: string,
    @Param('approvalId', ParseUUIDPipe) approvalId: string, @Body() input: RevokeStoryInteractionDto) {
    return this.approvals.revoke(user.id, workId, approvalId, input);
  }
}

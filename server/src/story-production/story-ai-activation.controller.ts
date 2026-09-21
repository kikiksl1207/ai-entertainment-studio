import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { CreateStoryAiActivationDto, CreateStoryAiEvidenceDto, PromoteStoryAiResultDto, RevokeStoryAiApprovalDto, StoryAiReviewQueueDto } from './dto/story-ai-activation.dto';
import { StoryAiActivationService } from './story-ai-activation.service';

@Controller('/admin/api/v1/story-ai')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
@RequireAdminPermissions('*')
export class StoryAiActivationAdminController {
  constructor(private readonly activation: StoryAiActivationService) {}

  @Post('legal-activations')
  create(@CurrentUser() user: AuthUser, @Body() body: CreateStoryAiActivationDto) {
    return this.activation.createActivation(user.id, body);
  }

  @Post('legal-activations/:id/revoke')
  revokeActivation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeStoryAiApprovalDto) {
    return this.activation.revokeActivation(user.id, id, body.evidenceHash);
  }

  @Get('shared-results/:id/review')
  review(@Param('id', ParseUUIDPipe) id: string) { return this.activation.review(id); }

  @Get('shared-results/review-queue')
  queue(@Query() query: StoryAiReviewQueueDto) { return this.activation.reviewQueue(query); }

  @Post('shared-results/:id/evidence')
  evidence(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: CreateStoryAiEvidenceDto) {
    return this.activation.evidence(user.id, id, body);
  }

  @Post('shared-results/:id/promote')
  promote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: PromoteStoryAiResultDto) {
    return this.activation.promote(user.id, id, body.resultChecksum);
  }

  @Post('shared-results/:id/revoke')
  revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeStoryAiApprovalDto) {
    return this.activation.revokeResult(user.id, id, body.evidenceHash);
  }
}

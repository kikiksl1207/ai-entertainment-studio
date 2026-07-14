import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AggregateStoryQualityDto,
  BuildStoryMemoryDto,
  ClearStorySlotDto,
  CreateStoryReleaseDto,
  OpenWriterReviewDto,
  SaveStorySlotDto,
  StoryMemoryQueryDto,
  TransitionStoryPublicationDto,
  TransitionWriterReviewDto,
} from './dto/story-lifecycle.dto';
import { StoryLifecycleService } from './story-lifecycle.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class StoryLifecycleController {
  constructor(private readonly lifecycle: StoryLifecycleService) {}

  @Get('me/creator-studio/stories/:workId/lifecycle')
  lifecycleState(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.lifecycle.lifecycle(user.id, workId);
  }

  @Get('me/creator-studio/stories/:workId/releases')
  releases(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.lifecycle.releases(user.id, workId);
  }

  @Post('me/creator-studio/stories/:workId/releases')
  createRelease(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: CreateStoryReleaseDto,
  ) {
    return this.lifecycle.createRelease(user.id, workId, body);
  }

  @Get('me/stories/:workId/save-slots')
  saveSlots(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.lifecycle.saveSlots(user.id, workId);
  }

  @Put('me/stories/:workId/save-slots')
  saveSlot(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: SaveStorySlotDto,
  ) {
    return this.lifecycle.saveSlot(user.id, workId, body);
  }

  @Delete('me/stories/:workId/save-slots/:slotNumber')
  clearSlot(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Param('slotNumber') slotNumber: string,
    @Body() body: ClearStorySlotDto,
  ) {
    return this.lifecycle.clearSlot(user.id, workId, Number(slotNumber), body);
  }

  @Get('me/stories/:workId/endings')
  endingGallery(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.lifecycle.endingGallery(user.id, workId);
  }

  @Post('me/creator-studio/stories/:workId/memory')
  buildMemory(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: BuildStoryMemoryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.lifecycle.buildMemory(user.id, workId, body, idempotencyKey);
  }

  @Get('me/creator-studio/stories/:workId/memory')
  retrieveMemory(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Query() query: StoryMemoryQueryDto,
  ) {
    return this.lifecycle.retrieveMemory(user.id, workId, query);
  }

  @Post('me/creator-studio/stories/:workId/reviews')
  openReview(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: OpenWriterReviewDto,
  ) {
    return this.lifecycle.openReview(user.id, workId, body);
  }

  @Post('me/creator-studio/reviews/:reviewId/transition')
  transitionReview(
    @CurrentUser() user: AuthUser,
    @Param('reviewId') reviewId: string,
    @Body() body: TransitionWriterReviewDto,
  ) {
    return this.lifecycle.transitionReview(user.id, reviewId, body);
  }

  @Post('me/creator-studio/reviews/:reviewId/submit')
  submitReview(
    @CurrentUser() user: AuthUser,
    @Param('reviewId') reviewId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.lifecycle.submitReview(user.id, reviewId, idempotencyKey);
  }

  @Post('me/creator-studio/stories/:workId/quality-aggregates')
  aggregateQuality(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: AggregateStoryQualityDto,
  ) {
    return this.lifecycle.aggregateQuality(user.id, workId, body);
  }

  @Get('me/creator-studio/stories/:workId/quality-aggregates')
  qualityMetrics(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.lifecycle.qualityMetrics(user.id, workId);
  }
}

@Controller('/admin/api/v1/story-publication')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryPublicationAdminController {
  constructor(private readonly lifecycle: StoryLifecycleService) {}

  @Post(':workId/transition')
  @RequireAdminPermissions('*')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: TransitionStoryPublicationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.lifecycle.transitionPublication(user.id, workId, body, idempotencyKey);
  }
}

import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  AdjustStoryResetQuotaDto,
  CreateManuscriptVersionDto,
  ConfirmStoryCheckpointDto,
  DecideContinuityIssueDto,
  ExecuteStoryResetDto,
  SelectStoryChoiceDto,
  StartStoryProgressDto,
  StoryCatalogQueryDto,
  StoryGraphQueryDto,
  StoryLocaleQueryDto,
  StoryResetPreviewQueryDto,
  SubmitCustomStoryChoiceDto,
  UpdateBeatProgressDto,
} from './dto/story-production.dto';
import { StoryProgressControlService } from './story-progress-control.service';
import { StoryProductionService } from './story-production.service';

type OptionalAuthRequest = { user?: AuthUser };

@Controller()
export class StoryProductionController {
  constructor(
    private readonly stories: StoryProductionService,
    private readonly progressControls: StoryProgressControlService,
  ) {}

  @Get('stories')
  @UseGuards(OptionalJwtAuthGuard)
  catalog(@Req() request: OptionalAuthRequest, @Query() query: StoryCatalogQueryDto) {
    return this.stories.catalog(request.user?.id, query);
  }

  @Get('me/creator-studio/stories')
  @UseGuards(JwtAuthGuard)
  creatorCatalog(
    @CurrentUser() user: AuthUser,
    @Query() query: StoryCatalogQueryDto,
  ) {
    return this.stories.creatorCatalog(user.id, query);
  }

  @Get('me/stories/:workId/access')
  @UseGuards(JwtAuthGuard)
  readerAccess(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.readerAccess(user.id, workId, query);
  }

  @Get('stories/:workId/graph')
  @UseGuards(JwtAuthGuard)
  graph(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Query() query: StoryGraphQueryDto,
  ) {
    return this.stories.graph(user.id, workId, query.focusSceneId);
  }

  @Post('stories/:workId/purchase')
  @UseGuards(JwtAuthGuard)
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.stories.purchaseWork(user.id, workId, idempotencyKey);
  }

  @Post('stories/:workId/progress')
  @UseGuards(JwtAuthGuard)
  startProgress(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: StartStoryProgressDto,
  ) {
    return this.stories.startProgress(user.id, workId, body);
  }

  @Get('stories/:slug')
  @UseGuards(OptionalJwtAuthGuard)
  detail(
    @Req() request: OptionalAuthRequest,
    @Param('slug') slug: string,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.detail(slug, request.user?.id, query);
  }

  @Get('me/story-progress/:progressId')
  @UseGuards(JwtAuthGuard)
  current(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.currentProgress(user.id, progressId, query.locale);
  }

  @Post('me/story-progress/:progressId/beat')
  @UseGuards(JwtAuthGuard)
  updateBeat(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Body() body: UpdateBeatProgressDto,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.updateBeatProgress(user.id, progressId, body, query.locale);
  }

  @Post('me/story-progress/:progressId/choices/:choiceId')
  @UseGuards(JwtAuthGuard)
  choose(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Param('choiceId') choiceId: string,
    @Body() body: SelectStoryChoiceDto,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.selectChoice(
      user.id,
      progressId,
      choiceId,
      body.expectedRevision,
      query.locale,
    );
  }

  @Post('me/story-progress/:progressId/custom-choice')
  @UseGuards(JwtAuthGuard)
  submitCustomChoice(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Body() body: SubmitCustomStoryChoiceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.progressControls.submitCustomChoice(
      user.id,
      progressId,
      body,
      idempotencyKey,
    );
  }

  @Get('me/story-progress/:progressId/checkpoint')
  @UseGuards(JwtAuthGuard)
  getCheckpoint(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
  ) {
    return this.progressControls.checkpoint(user.id, progressId);
  }

  @Post('me/story-progress/:progressId/checkpoint')
  @UseGuards(JwtAuthGuard)
  confirmCheckpoint(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Body() body: ConfirmStoryCheckpointDto,
  ) {
    return this.progressControls.confirmCheckpoint(user.id, progressId, body);
  }

  @Get('me/story-progress/:progressId/reset-preview')
  @UseGuards(JwtAuthGuard)
  resetPreview(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Query() query: StoryResetPreviewQueryDto,
  ) {
    return this.progressControls.resetPreview(user.id, progressId, query);
  }

  @Post('me/story-progress/:progressId/reset')
  @UseGuards(JwtAuthGuard)
  executeReset(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Body() body: ExecuteStoryResetDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.progressControls.executeReset(
      user.id,
      progressId,
      body,
      idempotencyKey,
    );
  }

  @Get('me/stories/:workId/progress-state')
  @UseGuards(JwtAuthGuard)
  publicProgressState(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
  ) {
    return this.progressControls.publicState(user.id, workId);
  }

  @Post('me/creator-studio/stories/:workId/manuscripts')
  @UseGuards(JwtAuthGuard)
  createManuscript(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: CreateManuscriptVersionDto,
  ) {
    return this.stories.createManuscriptVersion(user.id, workId, body);
  }

  @Post('me/creator-studio/manuscripts/:manuscriptId/analyses')
  @UseGuards(JwtAuthGuard)
  analyze(
    @CurrentUser() user: AuthUser,
    @Param('manuscriptId') manuscriptId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.stories.analyzeManuscript(user.id, manuscriptId, idempotencyKey);
  }

  @Get('me/creator-studio/analyses/:analysisId')
  @UseGuards(JwtAuthGuard)
  analysis(
    @CurrentUser() user: AuthUser,
    @Param('analysisId') analysisId: string,
  ) {
    return this.stories.analysis(user.id, analysisId);
  }

  @Get('me/creator-studio/stories/:workId/continuity')
  @UseGuards(JwtAuthGuard)
  continuity(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.stories.continuity(user.id, workId);
  }

  @Post('me/creator-studio/stories/:workId/continuity/:issueId/decision')
  @UseGuards(JwtAuthGuard)
  decideContinuityIssue(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Param('issueId') issueId: string,
    @Body() body: DecideContinuityIssueDto,
  ) {
    return this.stories.decideContinuityIssue(user.id, workId, issueId, body);
  }
}

@Controller('/admin/api/v1/story-progress')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryProgressAdminController {
  constructor(private readonly progressControls: StoryProgressControlService) {}

  @Post('reset-quota-adjustments')
  @RequireAdminPermissions('*')
  adjustResetQuota(
    @CurrentUser() user: AuthUser,
    @Body() body: AdjustStoryResetQuotaDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.progressControls.adjustResetQuota(user.id, body, idempotencyKey);
  }
}

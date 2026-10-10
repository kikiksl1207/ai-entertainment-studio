import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Header,
  Headers,
  NotFoundException,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateStoryDraftDto,
  CreateManuscriptVersionDto,
  ConfirmStoryCheckpointDto,
  DecideContinuityIssueDto,
  ExecuteStoryResetDto,
  PurchaseStoryWorkDto,
  SelectStoryChoiceDto,
  StartStoryProgressDto,
  StoryArtistCandidateQueryDto,
  StoryCatalogQueryDto,
  StoryGraphQueryDto,
  StoryLocaleQueryDto,
  StoryResetPreviewQueryDto,
  SubmitCustomStoryChoiceDto,
  UpdateBeatProgressDto,
  UpdateStoryDraftMetadataDto,
} from './dto/story-production.dto';
import { StoryProgressControlService } from './story-progress-control.service';
import { StoryProductionService } from './story-production.service';
import { RecoverStoryAnalysisProfileDto, StoryAnalysisPageDto } from './dto/story-semantic-analysis.dto';
import { StoryAnalysisDiscoveryQueryDto } from './dto/story-analysis-discovery.dto';
import {
  ApproveCreatorGenerationProfileDto,
  UpdateStoryGenerationProfileDto,
} from '../generation-profile/dto/creator-generation-profile.dto';
import { StoryGenerationProfileService } from './story-generation-profile.service';
import { StoryArtistParticipantService } from './story-artist-participant.service';
import { CreatorStudioService } from '../creator-studio/creator-studio.service';

type OptionalAuthRequest = { user?: AuthUser };

class CurrentSceneNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'private, no-store');
    return true;
  }
}

class CreatorCatalogNoStoreGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const response = context.switchToHttp().getResponse<{
      setHeader(name: string, value: string): void;
      vary(field: string): void;
    }>();
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.vary('Authorization');
    return true;
  }
}

@Controller()
export class StoryProductionController {
  constructor(
    private readonly stories: StoryProductionService,
    private readonly progressControls: StoryProgressControlService,
    @Optional() private readonly generationProfiles?: StoryGenerationProfileService,
    @Optional() private readonly storyParticipants?: StoryArtistParticipantService,
    @Optional() private readonly creatorStudio?: CreatorStudioService,
  ) {}

  @Get('stories')
  @UseGuards(OptionalJwtAuthGuard)
  catalog(@Req() request: OptionalAuthRequest, @Query() query: StoryCatalogQueryDto) {
    return this.stories.catalog(request.user?.id, query);
  }

  @Get('me/creator-studio/stories')
  @UseGuards(CreatorCatalogNoStoreGuard, JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  creatorCatalog(
    @CurrentUser() user: AuthUser,
    @Query() query: StoryCatalogQueryDto,
  ) {
    return this.stories.creatorCatalog(user.id, query);
  }

  @Post('me/creator-studio/stories')
  @UseGuards(JwtAuthGuard)
  async createDraft(@CurrentUser() user: AuthUser, @Body() body: CreateStoryDraftDto) {
    const studio = await this.creatorStudio?.getStudio(user);
    if (studio?.access?.enabled !== true) throw new ForbiddenException('Creator Studio access required');
    return this.stories.createDraft(user.id, body);
  }

  @Patch('me/creator-studio/stories/:workId/metadata')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  async updateDraftMetadata(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() body: UpdateStoryDraftMetadataDto,
  ) {
    const studio = await this.creatorStudio?.getStudio(user);
    if (studio?.access?.enabled !== true) throw new ForbiddenException('Creator Studio access required');
    return this.stories.updateDraftMetadata(user.id, workId, body);
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
  @UseGuards(CreatorCatalogNoStoreGuard, JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  graph(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Query() query: StoryGraphQueryDto,
  ) {
    return this.stories.graph(user.id, workId, query.focusSceneId, query.locale);
  }

  @Post('stories/:workId/purchase')
  @UseGuards(JwtAuthGuard)
  purchase(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Body() body?: PurchaseStoryWorkDto,
  ) {
    return this.stories.purchaseWork(user.id, workId, idempotencyKey, body);
  }

  @Post('stories/:workId/progress')
  @UseGuards(JwtAuthGuard)
  startProgress(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() body: StartStoryProgressDto,
  ) {
    return this.stories.startProgress(user.id, workId, body);
  }

  @Get('me/stories/:workId/artist-candidates')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  artistCandidates(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryArtistCandidateQueryDto,
  ) {
    if (!this.storyParticipants) throw new NotFoundException('Story participant service unavailable');
    return this.storyParticipants.candidates(user.id, workId, query);
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
  @UseGuards(CurrentSceneNoStoreGuard, JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  current(
    @CurrentUser() user: AuthUser,
    @Param('progressId') progressId: string,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.currentProgress(user.id, progressId, query.locale);
  }

  @Get('story-sessions/:sessionId/current-scene')
  @UseGuards(CurrentSceneNoStoreGuard, JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  currentScene(
    @CurrentUser() user: AuthUser,
    @Param('sessionId') sessionId: string,
    @Query() query: StoryLocaleQueryDto,
  ) {
    return this.stories.currentProgress(user.id, sessionId, query.locale);
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
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.stories.selectChoice(
      user.id,
      progressId,
      choiceId,
      body.expectedRevision,
      query.locale,
      idempotencyKey,
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

  @Get('me/creator-studio/stories/:workId/manuscripts')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  manuscripts(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Query() query: StoryAnalysisDiscoveryQueryDto,
  ) {
    return this.stories.manuscriptVersions(user.id, workId, query);
  }

  @Get('me/creator-studio/stories/:workId/generation-profile')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  generationProfile(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
  ) {
    return this.generationProfiles!.getOrCreate(user.id, workId);
  }

  @Patch('me/creator-studio/stories/:workId/generation-profile')
  @UseGuards(JwtAuthGuard)
  updateGenerationProfile(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() body: UpdateStoryGenerationProfileDto,
  ) {
    return this.generationProfiles!.update(user.id, workId, body);
  }

  @Post('me/creator-studio/stories/:workId/generation-profile/approve')
  @UseGuards(JwtAuthGuard)
  approveGenerationProfile(
    @CurrentUser() user: AuthUser,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() body: ApproveCreatorGenerationProfileDto,
  ) {
    return this.generationProfiles!.approve(user.id, workId, body);
  }

  @Get('me/creator-studio/manuscripts/:manuscriptId/analyses')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  analysisJobs(
    @CurrentUser() user: AuthUser,
    @Param('manuscriptId', ParseUUIDPipe) manuscriptId: string,
    @Query() query: StoryAnalysisDiscoveryQueryDto,
  ) {
    return this.stories.analysisJobs(user.id, manuscriptId, query);
  }

  @Get('me/creator-studio/manuscripts/:manuscriptId/branch-preparations')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  branchPreparations(
    @CurrentUser() user: AuthUser,
    @Param('manuscriptId', ParseUUIDPipe) manuscriptId: string,
  ) {
    return this.stories.branchPreparationStatus(user.id, manuscriptId);
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

  @Post('me/creator-studio/analyses/:analysisId/recover-profile')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'private, no-store')
  recoverAnalysisProfile(
    @CurrentUser() user: AuthUser,
    @Param('analysisId', ParseUUIDPipe) analysisId: string,
    @Body() body: RecoverStoryAnalysisProfileDto,
  ) {
    return this.stories.recoverAnalysisProfile(user.id, analysisId, body.expectedSourceContentHash);
  }

  @Get('me/creator-studio/analyses/:analysisId')
  @UseGuards(JwtAuthGuard)
  analysis(
    @CurrentUser() user: AuthUser,
    @Param('analysisId') analysisId: string,
    @Query() query: StoryAnalysisPageDto,
  ) {
    return this.stories.analysis(user.id, analysisId, query.cursor, query.view);
  }

  @Get('me/creator-studio/analyses/:analysisId/evidence/:evidenceId/source')
  @UseGuards(JwtAuthGuard)
  analysisCitation(
    @CurrentUser() user: AuthUser,
    @Param('analysisId') analysisId: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    return this.stories.analysisCitation(user.id, analysisId, evidenceId);
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

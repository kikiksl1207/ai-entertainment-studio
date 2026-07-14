import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { RequireAdminPermissions } from '../auth/decorators/admin-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { AdminPermissionGuard } from '../auth/guards/admin-permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ActivateStoryAiRateCardDto,
  ApproveStoryAiCompensationDto,
  CreateStoryAiRateCardDto,
  EstimateStoryMemoryBudgetDto,
  EstimateStoryPriceDto,
  SettleStoryAiContinuationDto,
  TransitionStoryStyleConsentDto,
  UpsertStoryReleaseCapabilityDto,
  UpsertStoryStyleConsentDto,
} from './dto/story-economics.dto';
import { StoryEconomicsService } from './story-economics.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class StoryEconomicsController {
  constructor(private readonly economics: StoryEconomicsService) {}

  @Get('me/stories/:workId/ai-capability')
  capability(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.economics.readerCapability(user.id, workId);
  }

  @Get('me/story-progress/:progressId/ai-continuations/:continuationId')
  continuation(
    @CurrentUser() user: AuthUser,
    @Param('continuationId') continuationId: string,
  ) {
    return this.economics.continuationStatus(user.id, continuationId);
  }

  @Post('me/creator-studio/stories/:workId/memory-budget/estimate')
  estimateMemoryBudget(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: EstimateStoryMemoryBudgetDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.economics.estimateMemoryBudget(
      user.id,
      workId,
      body,
      idempotencyKey,
    );
  }

  @Get('me/creator-studio/stories/:workId/style-consent')
  styleConsent(@CurrentUser() user: AuthUser, @Param('workId') workId: string) {
    return this.economics.getStyleConsent(user.id, workId);
  }

  @Put('me/creator-studio/stories/:workId/style-consent')
  upsertStyleConsent(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: UpsertStoryStyleConsentDto,
  ) {
    return this.economics.upsertStyleConsent(user.id, workId, body);
  }

  @Post('me/creator-studio/stories/:workId/style-consent/transition')
  transitionStyleConsent(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: TransitionStoryStyleConsentDto,
  ) {
    return this.economics.transitionStyleConsent(user.id, workId, body);
  }
}

@Controller('/admin/api/v1/story-ai')
@UseGuards(AdminAuthGuard, AdminPermissionGuard)
export class StoryEconomicsAdminController {
  constructor(private readonly economics: StoryEconomicsService) {}

  @Post('rate-cards')
  @RequireAdminPermissions('*')
  createRateCard(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateStoryAiRateCardDto,
  ) {
    return this.economics.createRateCard(user.id, body);
  }

  @Post('rate-cards/:rateCardId/activate')
  @RequireAdminPermissions('*')
  activateRateCard(
    @CurrentUser() user: AuthUser,
    @Param('rateCardId') rateCardId: string,
    @Body() body: ActivateStoryAiRateCardDto,
  ) {
    return this.economics.activateRateCard(user.id, rateCardId, body);
  }

  @Put('releases/:releaseId/capability')
  @RequireAdminPermissions('*')
  releaseCapability(
    @CurrentUser() user: AuthUser,
    @Param('releaseId') releaseId: string,
    @Body() body: UpsertStoryReleaseCapabilityDto,
  ) {
    return this.economics.upsertReleaseCapability(user.id, releaseId, body);
  }

  @Post('works/:workId/pricing-estimate')
  @RequireAdminPermissions('*')
  priceEstimate(
    @CurrentUser() user: AuthUser,
    @Param('workId') workId: string,
    @Body() body: EstimateStoryPriceDto,
  ) {
    return this.economics.estimateAndSavePrice(user.id, workId, body);
  }

  @Post('continuations/:continuationId/settle')
  @RequireAdminPermissions('*')
  settleContinuation(
    @CurrentUser() user: AuthUser,
    @Param('continuationId') continuationId: string,
    @Body() body: SettleStoryAiContinuationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.economics.settleContinuation(
      user.id,
      continuationId,
      body,
      idempotencyKey,
    );
  }

  @Post('continuations/:continuationId/compensate')
  @RequireAdminPermissions('*')
  compensateContinuation(
    @CurrentUser() user: AuthUser,
    @Param('continuationId') continuationId: string,
    @Body() body: ApproveStoryAiCompensationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.economics.compensateContinuation(
      user.id,
      continuationId,
      body.reason,
      idempotencyKey,
    );
  }
}

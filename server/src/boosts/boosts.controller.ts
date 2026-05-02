import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BoostsService } from './boosts.service';

type FreeLikeBody = {
  artistId?: string;
  artistSlug?: string;
  idempotencyKey?: string;
};

type PaidLikeBody = {
  artistId?: string;
  artistSlug?: string;
  quantity?: number | string;
  idempotencyKey?: string;
};

type BoostOrderBody = {
  campaignId?: string;
  artistId?: string;
  boostProductId?: string;
  idempotencyKey?: string;
};

@Controller()
export class BoostsController {
  constructor(private readonly boostsService: BoostsService) {}

  @Get('boost-campaigns/current')
  getCurrentCampaign() {
    return this.boostsService.getCurrentCampaign();
  }

  @Get('boost-campaigns/:campaignId/rankings')
  getRankings(@Param('campaignId') campaignId: string) {
    return this.boostsService.getRankings(campaignId);
  }

  @Post('boost-campaigns/:campaignId/free-like')
  @UseGuards(JwtAuthGuard)
  createFreeLike(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: FreeLikeBody,
  ) {
    return this.boostsService.createFreeLike(user.id, {
      campaignId,
      artistId: body?.artistId,
      artistSlug: body?.artistSlug,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Post('boost-campaigns/:campaignId/paid-like')
  @UseGuards(JwtAuthGuard)
  createPaidLike(
    @Param('campaignId') campaignId: string,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: PaidLikeBody,
  ) {
    return this.boostsService.createPaidLike(user.id, {
      campaignId,
      artistId: body?.artistId,
      artistSlug: body?.artistSlug,
      quantity: body?.quantity,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('boost-products')
  getBoostProducts() {
    return this.boostsService.getBoostProducts();
  }

  @Post('boost-orders')
  @UseGuards(JwtAuthGuard)
  createBoostOrder(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: BoostOrderBody,
  ) {
    return this.boostsService.createBoostOrder(user.id, {
      campaignId: this.requireField(body?.campaignId, 'campaignId'),
      artistId: this.requireField(body?.artistId, 'artistId'),
      boostProductId: this.requireField(body?.boostProductId, 'boostProductId'),
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('me/boost-events')
  @UseGuards(JwtAuthGuard)
  getMyBoostEvents(@CurrentUser() user: AuthUser) {
    return this.boostsService.getMyBoostEvents(user.id);
  }

  @Get('me/free-like-quota')
  @UseGuards(JwtAuthGuard)
  getMyFreeLikeQuota(@CurrentUser() user: AuthUser) {
    return this.boostsService.getMyFreeLikeQuota(user.id);
  }

  @Get('me/paid-like-quota')
  @UseGuards(JwtAuthGuard)
  getMyPaidLikeQuota(@CurrentUser() user: AuthUser) {
    return this.boostsService.getMyPaidLikeQuota(user.id);
  }

  private requireField(value: string | undefined, fieldName: string) {
    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value;
  }
}

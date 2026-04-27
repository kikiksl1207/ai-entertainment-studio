import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { BoostsService } from './boosts.service';

type FreeLikeBody = {
  artistId?: string;
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
  createFreeLike(
    @Param('campaignId') campaignId: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: FreeLikeBody,
  ) {
    return this.boostsService.createFreeLike(this.requireUserId(userId), {
      campaignId,
      artistId: this.requireField(body?.artistId, 'artistId'),
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('boost-products')
  getBoostProducts() {
    return this.boostsService.getBoostProducts();
  }

  @Post('boost-orders')
  createBoostOrder(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: BoostOrderBody,
  ) {
    return this.boostsService.createBoostOrder(this.requireUserId(userId), {
      campaignId: this.requireField(body?.campaignId, 'campaignId'),
      artistId: this.requireField(body?.artistId, 'artistId'),
      boostProductId: this.requireField(body?.boostProductId, 'boostProductId'),
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('me/boost-events')
  getMyBoostEvents(@Headers('x-user-id') userId: string | undefined) {
    return this.boostsService.getMyBoostEvents(this.requireUserId(userId));
  }

  private requireUserId(userId?: string) {
    if (!userId) {
      throw new BadRequestException('X-User-Id header is required until auth is implemented');
    }

    return userId;
  }

  private requireField(value: string | undefined, fieldName: string) {
    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value;
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { GiftsService } from './gifts.service';

type GiftOrderBody = {
  artistId?: string;
  giftProductId?: string;
  quantity?: number;
  idempotencyKey?: string;
};

@Controller()
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get('artists/:artistId/gift-products')
  getGiftProducts(@Param('artistId') artistId: string) {
    return this.giftsService.getGiftProducts(artistId);
  }

  @Post('gift-orders')
  createGiftOrder(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: GiftOrderBody,
  ) {
    return this.giftsService.createGiftOrder(this.requireUserId(userId), {
      artistId: this.requireField(body?.artistId, 'artistId'),
      giftProductId: this.requireField(body?.giftProductId, 'giftProductId'),
      quantity: body?.quantity,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('artists/:artistId/gift-progress')
  getGiftProgress(@Param('artistId') artistId: string) {
    return this.giftsService.getGiftProgress(artistId);
  }

  @Get('artists/:artistId/reaction-events')
  getReactionEvents(@Param('artistId') artistId: string) {
    return this.giftsService.getReactionEvents(artistId);
  }

  @Get('artists/:artistId/equipped-items')
  getEquippedItems(@Param('artistId') artistId: string) {
    return this.giftsService.getEquippedItems(artistId);
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

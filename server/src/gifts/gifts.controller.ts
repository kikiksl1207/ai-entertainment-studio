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
  @UseGuards(JwtAuthGuard)
  createGiftOrder(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: GiftOrderBody,
  ) {
    return this.giftsService.createGiftOrder(user.id, {
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

  private requireField(value: string | undefined, fieldName: string) {
    if (!value) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return value;
  }
}

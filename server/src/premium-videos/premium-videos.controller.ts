import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PremiumVideosService } from './premium-videos.service';

@Controller()
export class PremiumVideosController {
  constructor(private readonly premiumVideosService: PremiumVideosService) {}

  @Get('premium-videos')
  findAll() {
    return this.premiumVideosService.findAll();
  }

  @Get('premium-videos/:productId')
  findOne(@Param('productId') productId: string) {
    return this.premiumVideosService.findOne(productId);
  }

  @Post('premium-videos/:productId/unlock')
  @UseGuards(JwtAuthGuard)
  unlock(
    @CurrentUser() user: AuthUser,
    @Param('productId') productId: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.premiumVideosService.unlock(user.id, productId, idempotencyKey);
  }

  @Get('me/premium-video-unlocks')
  @UseGuards(JwtAuthGuard)
  findMyUnlocks(@CurrentUser() user: AuthUser) {
    return this.premiumVideosService.findMyUnlocks(user.id);
  }
}

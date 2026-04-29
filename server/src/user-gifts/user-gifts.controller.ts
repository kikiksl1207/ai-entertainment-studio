import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateUserGiftDto } from './dto/user-gifts.dto';
import { UserGiftsService } from './user-gifts.service';

@Controller('user-gifts')
@UseGuards(JwtAuthGuard)
export class UserGiftsController {
  constructor(private readonly userGiftsService: UserGiftsService) {}

  @Post()
  createUserGift(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: CreateUserGiftDto,
  ) {
    return this.userGiftsService.createTransfer(user.id, {
      ...body,
      idempotencyKey: body.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('sent')
  getSentTransfers(@CurrentUser() user: AuthUser) {
    return this.userGiftsService.getSentTransfers(user.id);
  }

  @Get('received')
  getReceivedTransfers(@CurrentUser() user: AuthUser) {
    return this.userGiftsService.getReceivedTransfers(user.id);
  }
}

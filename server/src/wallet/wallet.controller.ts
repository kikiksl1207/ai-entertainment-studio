import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
} from '@nestjs/common';
import { WalletService } from './wallet.service';

type TestGrantBody = {
  amount?: number | string;
  memo?: string;
  idempotencyKey?: string;
};

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  getWallet(@Headers('x-user-id') userId: string | undefined) {
    return this.walletService.getOrCreateWallet(this.requireUserId(userId));
  }

  @Get('ledger')
  getLedger(
    @Headers('x-user-id') userId: string | undefined,
    @Query('take') take?: string,
  ) {
    return this.walletService.getLedger(this.requireUserId(userId), take);
  }

  @Post('test-grant')
  grantForLocalTesting(
    @Headers('x-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: TestGrantBody,
  ) {
    return this.walletService.grantForLocalTesting(this.requireUserId(userId), {
      amount: body?.amount,
      memo: body?.memo,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  private requireUserId(userId?: string) {
    if (!userId) {
      throw new BadRequestException('X-User-Id header is required until auth is implemented');
    }

    return userId;
  }
}

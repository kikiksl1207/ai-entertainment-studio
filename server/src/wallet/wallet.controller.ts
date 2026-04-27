import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';

type TestGrantBody = {
  amount?: number | string;
  memo?: string;
  idempotencyKey?: string;
};

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: AuthUser) {
    return this.walletService.getOrCreateWallet(user.id);
  }

  @Get('ledger')
  getLedger(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.walletService.getLedger(user.id, take);
  }

  @Post('test-grant')
  grantForLocalTesting(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: TestGrantBody,
  ) {
    return this.walletService.grantForLocalTesting(user.id, {
      amount: body?.amount,
      memo: body?.memo,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }
}

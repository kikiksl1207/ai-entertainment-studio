import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';

type CreatePaymentOrderBody = {
  luminaProductId?: string;
  provider?: string;
  idempotencyKey?: string;
};

type WebhookRequest = {
  rawBody?: Buffer;
};

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  createOrder(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Body() body: CreatePaymentOrderBody,
  ) {
    return this.paymentsService.createOrder(user.id, {
      luminaProductId: body?.luminaProductId,
      provider: body?.provider,
      idempotencyKey: body?.idempotencyKey ?? idempotencyKeyHeader,
    });
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  listOrders(@CurrentUser() user: AuthUser, @Query('take') take?: string) {
    return this.paymentsService.listOrders(user.id, take);
  }

  @Get('orders/:orderId')
  @UseGuards(JwtAuthGuard)
  getOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.paymentsService.getOrder(user.id, orderId);
  }

  @Post('webhooks/:provider')
  handleWebhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Req() request: WebhookRequest,
  ) {
    return this.paymentsService.handleWebhook(provider, headers, body, request.rawBody);
  }
}

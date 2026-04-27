import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  ParsedPaymentWebhook,
  PaymentCheckoutPayload,
  PaymentProviderAdapter,
} from './payment-provider.types';

type MockWebhookBody = {
  orderNo?: string;
  transactionId?: string;
  status?: 'paid' | 'failed' | 'cancelled';
  amount?: string | number;
};

@Injectable()
export class MockPaymentAdapter implements PaymentProviderAdapter {
  readonly provider = 'mock';

  constructor(private readonly configService: ConfigService) {}

  createCheckoutPayload(input: {
    orderNo: string;
    amount: string;
    currency: string;
    orderName: string;
  }): PaymentCheckoutPayload {
    return {
      provider: this.provider,
      orderNo: input.orderNo,
      amount: input.amount,
      currency: input.currency,
      orderName: input.orderName,
      clientKey: this.configService.get<string>('MOCK_PAYMENT_CLIENT_KEY'),
      successUrl: this.configService.get<string>('PAYMENT_SUCCESS_URL'),
      failUrl: this.configService.get<string>('PAYMENT_FAIL_URL'),
    };
  }

  verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): ParsedPaymentWebhook {
    const secret = this.configService.get<string>('MOCK_PAYMENT_WEBHOOK_SECRET');

    if (secret) {
      this.verifySignature(headers, body, secret);
    }

    const payload = body as MockWebhookBody;

    if (!payload.orderNo || !payload.transactionId || !payload.status || !payload.amount) {
      throw new BadRequestException('Invalid mock payment webhook payload');
    }

    return {
      orderNo: payload.orderNo,
      providerTransactionId: payload.transactionId,
      status: payload.status,
      amount: String(payload.amount),
      rawPayload: payload,
    };
  }

  private verifySignature(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    secret: string,
  ) {
    const signatureHeader = headers['x-mock-signature'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!signature) {
      throw new UnauthorizedException('Payment webhook signature is required');
    }

    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(body))
      .digest('hex');

    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      throw new UnauthorizedException('Invalid payment webhook signature');
    }
  }
}

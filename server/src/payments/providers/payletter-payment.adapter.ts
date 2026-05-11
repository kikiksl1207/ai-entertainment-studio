import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ParsedPaymentWebhook,
  PaymentCheckoutPayload,
  PaymentProviderAdapter,
} from './payment-provider.types';

type PayletterCallbackBody = Record<string, unknown>;

@Injectable()
export class PayletterPaymentAdapter implements PaymentProviderAdapter {
  readonly provider = 'payletter';

  constructor(private readonly configService: ConfigService) {}

  createCheckoutPayload(input: {
    orderNo: string;
    amount: string;
    currency: string;
    orderName: string;
  }): PaymentCheckoutPayload {
    const endpoint =
      this.configService.get<string>('PAYLETTER_ENDPOINT') ??
      (this.configService.get<string>('NODE_ENV') === 'production'
        ? 'https://pgapi.payletter.com'
        : 'https://testpgapi.payletter.com');
    const returnUrl = this.configService.get<string>('PAYMENT_SUCCESS_URL');
    const failUrl = this.configService.get<string>('PAYMENT_FAIL_URL');
    const cancelUrl = this.configService.get<string>('PAYMENT_CANCEL_URL');
    const callbackUrl = this.configService.get<string>('PAYMENT_CALLBACK_URL');
    const pgcode = this.configService.get<string>('PAYLETTER_PGCODE') ?? 'creditcard';
    const serviceName =
      this.configService.get<string>('PAYLETTER_SERVICE_NAME') ?? 'Lumina Stage';

    return {
      provider: this.provider,
      mode: 'server_request',
      orderNo: input.orderNo,
      amount: input.amount,
      currency: input.currency,
      orderName: input.orderName,
      successUrl: returnUrl,
      failUrl,
      cancelUrl,
      metadata: {
        endpoint,
        requestPath: '/v1.0/payments/request',
        configured: this.isConfigured(),
        clientIdConfigured: Boolean(this.configService.get<string>('PAYLETTER_CLIENT_ID')),
        paymentApiKeyConfigured: Boolean(
          this.configService.get<string>('PAYLETTER_PAYMENT_API_KEY'),
        ),
        pgcode,
        serviceName,
        returnUrl,
        callbackUrl,
        cancelUrl,
        requestMethod: 'POST',
        authorization: 'PLKEY <PAYLETTER_PAYMENT_API_KEY>',
      },
    };
  }

  verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): ParsedPaymentWebhook {
    this.verifyCallbackSecret(headers);

    const payload = this.recordOrThrow(body);
    const orderNo = this.stringFrom(payload.order_no) ?? this.stringFrom(payload.orderNo);
    const providerTransactionId =
      this.stringFrom(payload.tid) ??
      this.stringFrom(payload.transaction_id) ??
      this.stringFrom(payload.transactionId);
    const amount = this.stringFrom(payload.amount);

    if (!orderNo || !providerTransactionId || !amount) {
      throw new BadRequestException('Invalid payletter callback payload');
    }

    return {
      orderNo,
      providerTransactionId,
      status: this.parseStatus(payload),
      amount,
      rawPayload: payload,
    };
  }

  private isConfigured() {
    return Boolean(
      this.configService.get<string>('PAYLETTER_CLIENT_ID') &&
        this.configService.get<string>('PAYLETTER_PAYMENT_API_KEY'),
    );
  }

  private verifyCallbackSecret(headers: Record<string, string | string[] | undefined>) {
    const expected = this.configService.get<string>('PAYLETTER_CALLBACK_SECRET');

    if (!expected) {
      throw new UnauthorizedException('Payletter callback secret is not configured');
    }

    const header = headers['x-lumina-payletter-secret'];
    const actual = Array.isArray(header) ? header[0] : header;

    if (actual !== expected) {
      throw new UnauthorizedException('Invalid payletter callback secret');
    }
  }

  private parseStatus(payload: PayletterCallbackBody): ParsedPaymentWebhook['status'] {
    const code = this.stringFrom(payload.code) ?? this.stringFrom(payload.result_code);
    const status = (
      this.stringFrom(payload.status) ??
      this.stringFrom(payload.pay_state) ??
      ''
    ).toLowerCase();

    if (code === '0' || ['paid', 'success', 'complete', 'completed'].includes(status)) {
      return 'paid';
    }

    if (['cancel', 'cancelled', 'canceled'].includes(status)) {
      return 'cancelled';
    }

    return 'failed';
  }

  private recordOrThrow(value: unknown): PayletterCallbackBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Invalid payletter callback payload');
    }

    return value as PayletterCallbackBody;
  }

  private stringFrom(value: unknown) {
    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return null;
  }
}

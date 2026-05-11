import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ParsedPaymentWebhook,
  PaymentCheckoutPayload,
  PaymentProviderAdapter,
} from './payment-provider.types';

type TossWebhookBody = Record<string, unknown>;

@Injectable()
export class TossPaymentsAdapter implements PaymentProviderAdapter {
  readonly provider = 'tosspayments';

  constructor(private readonly configService: ConfigService) {}

  createCheckoutPayload(input: {
    orderNo: string;
    amount: string;
    currency: string;
    orderName: string;
  }): PaymentCheckoutPayload {
    const successUrl = this.configService.get<string>('PAYMENT_SUCCESS_URL');
    const failUrl = this.configService.get<string>('PAYMENT_FAIL_URL');
    const clientKey =
      this.configService.get<string>('TOSSPAYMENTS_WIDGET_CLIENT_KEY') ??
      this.configService.get<string>('TOSSPAYMENTS_CLIENT_KEY');

    return {
      provider: this.provider,
      mode: 'payment_widget',
      orderNo: input.orderNo,
      amount: input.amount,
      currency: input.currency,
      orderName: input.orderName,
      clientKey,
      successUrl,
      failUrl,
      metadata: {
        configured: this.isConfigured(),
        widgetClientKeyConfigured: Boolean(
          this.configService.get<string>('TOSSPAYMENTS_WIDGET_CLIENT_KEY'),
        ),
        clientKeyConfigured: Boolean(this.configService.get<string>('TOSSPAYMENTS_CLIENT_KEY')),
        secretKeyConfigured: Boolean(this.configService.get<string>('TOSSPAYMENTS_SECRET_KEY')),
        widgetSecretKeyConfigured: Boolean(
          this.configService.get<string>('TOSSPAYMENTS_WIDGET_SECRET_KEY'),
        ),
        confirmEndpoint:
          this.configService.get<string>('TOSSPAYMENTS_CONFIRM_ENDPOINT') ??
          'https://api.tosspayments.com/v1/payments/confirm',
      },
    };
  }

  verifyAndParseWebhook(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): ParsedPaymentWebhook {
    this.verifyWebhookSecret(headers);

    const payload = this.recordOrThrow(body);
    const orderNo = this.stringFrom(payload.orderId) ?? this.stringFrom(payload.orderNo);
    const providerTransactionId =
      this.stringFrom(payload.paymentKey) ?? this.stringFrom(payload.transactionId);
    const amount =
      this.stringFrom(payload.totalAmount) ??
      this.stringFrom(payload.balanceAmount) ??
      this.stringFrom(payload.amount);

    if (!orderNo || !providerTransactionId || !amount) {
      throw new BadRequestException('Invalid tosspayments webhook payload');
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
      this.configService.get<string>('TOSSPAYMENTS_WIDGET_CLIENT_KEY') ||
        this.configService.get<string>('TOSSPAYMENTS_CLIENT_KEY'),
    );
  }

  private verifyWebhookSecret(headers: Record<string, string | string[] | undefined>) {
    const expected = this.configService.get<string>('TOSSPAYMENTS_WEBHOOK_SECRET');

    if (!expected) {
      throw new UnauthorizedException('TossPayments webhook secret is not configured');
    }

    const header = headers['x-lumina-tosspayments-secret'];
    const actual = Array.isArray(header) ? header[0] : header;

    if (actual !== expected) {
      throw new UnauthorizedException('Invalid tosspayments webhook secret');
    }
  }

  private parseStatus(payload: TossWebhookBody): ParsedPaymentWebhook['status'] {
    const status = (this.stringFrom(payload.status) ?? '').toUpperCase();

    if (['DONE', 'PAID', 'COMPLETED'].includes(status)) {
      return 'paid';
    }

    if (['CANCELED', 'CANCELLED', 'PARTIAL_CANCELED', 'ABORTED', 'EXPIRED'].includes(status)) {
      return 'cancelled';
    }

    return 'failed';
  }

  private recordOrThrow(value: unknown): TossWebhookBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Invalid tosspayments webhook payload');
    }

    return value as TossWebhookBody;
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

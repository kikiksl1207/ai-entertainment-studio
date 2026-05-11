import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentAdapter } from './mock-payment.adapter';
import { PayletterPaymentAdapter } from './payletter-payment.adapter';
import { PaymentProviderAdapter } from './payment-provider.types';
import { TossPaymentsAdapter } from './tosspayments-payment.adapter';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: PaymentProviderAdapter[];
  private readonly configuredProvider: string;

  constructor(configService: ConfigService) {
    this.providers = [
      new MockPaymentAdapter(configService),
      new PayletterPaymentAdapter(configService),
      new TossPaymentsAdapter(configService),
    ];
    this.configuredProvider = configService.get<string>('PAYMENT_PROVIDER') ?? 'mock';
  }

  defaultProvider() {
    return this.configuredProvider;
  }

  get(provider = this.configuredProvider) {
    const adapter = this.providers.find((item) => item.provider === provider);

    if (!adapter) {
      throw new BadRequestException(`Unsupported payment provider: ${provider}`);
    }

    return adapter;
  }
}

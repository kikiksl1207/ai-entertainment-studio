import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockPaymentAdapter } from './mock-payment.adapter';
import { PaymentProviderAdapter } from './payment-provider.types';

@Injectable()
export class PaymentProviderRegistry {
  private readonly providers: PaymentProviderAdapter[];

  constructor(configService: ConfigService) {
    this.providers = [new MockPaymentAdapter(configService)];
  }

  get(provider = 'mock') {
    const adapter = this.providers.find((item) => item.provider === provider);

    if (!adapter) {
      throw new BadRequestException(`Unsupported payment provider: ${provider}`);
    }

    return adapter;
  }
}

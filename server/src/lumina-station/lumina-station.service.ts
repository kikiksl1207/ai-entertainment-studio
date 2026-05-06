import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_CURRENCY = 'LUMINA';
const PRICE_UNIT_KRW = new Decimal(10);
const FIRST_CHARGE_BONUS_RATE = new Decimal('0.1');

@Injectable()
export class LuminaStationService {
  constructor(private readonly prisma: PrismaService) {}

  async getStation(userId: string, takeQuery?: string) {
    const take = this.parseTake(takeQuery);

    const [wallet, products, recentOrders, paidOrderCount] = await this.prisma.$transaction([
      this.prisma.walletAccount.upsert({
        where: {
          userId_currencyCode: {
            userId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
        update: {},
        create: {
          userId,
          currencyCode: DEFAULT_CURRENCY,
        },
      }),
      this.prisma.luminaProduct.findMany({
        where: { status: 'active' },
        orderBy: [{ priceAmount: 'asc' }, { luminaAmount: 'asc' }],
      }),
      this.prisma.paymentOrder.findMany({
        where: { userId },
        include: {
          luminaProduct: true,
          transactions: true,
          refunds: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.paymentOrder.count({
        where: { userId, status: 'paid' },
      }),
    ]);
    const firstChargeEligible = paidOrderCount === 0;

    return {
      wallet,
      products: products.map((product) => {
        const totalLumina = product.luminaAmount.plus(product.bonusAmount);
        const firstChargeBonusLumina = firstChargeEligible
          ? product.luminaAmount.mul(FIRST_CHARGE_BONUS_RATE).toDecimalPlaces(2)
          : new Decimal(0);
        const expectedPrice = totalLumina.times(PRICE_UNIT_KRW);
        const discountAmount = Decimal.max(expectedPrice.minus(product.priceAmount), 0);

        return {
          ...product,
          totalLumina,
          unitPriceKrw: product.priceAmount.div(totalLumina).toDecimalPlaces(2),
          firstChargeBonusLumina,
          firstChargeTotalLumina: totalLumina.plus(firstChargeBonusLumina),
          bonusRate:
            product.luminaAmount.gt(0) && product.bonusAmount.gt(0)
              ? product.bonusAmount.div(product.luminaAmount).times(100).toDecimalPlaces(2)
              : new Decimal(0),
          discountAmount,
          isBestValue: discountAmount.gt(0),
        };
      }),
      recentOrders,
      payment: {
        provider: process.env.PAYMENT_PROVIDER ?? 'mock',
        status: 'pg_pending',
        createOrderEndpoint: '/api/v1/payments/orders',
        orderHistoryEndpoint: '/api/v1/payments/orders',
      },
      policy: {
        currencyCode: DEFAULT_CURRENCY,
        displayName: 'Lumina',
        unitPriceKrw: PRICE_UNIT_KRW,
        signupBonusLumina: 300,
        referralBonusLumina: 500,
        paidLikeUnitPriceLumina: 10,
        paidLikeDailyLimit: 20,
        firstChargeBonus: {
          eligible: firstChargeEligible,
          rate: FIRST_CHARGE_BONUS_RATE.toString(),
          percent: FIRST_CHARGE_BONUS_RATE.times(100).toString(),
          ledgerType: 'first_charge_bonus',
          oneTimePerUser: true,
        },
        fulfillment:
          'Paid Lumina is credited only after the payment provider confirms a paid transaction.',
      },
    };
  }

  private parseTake(value?: string) {
    if (!value) {
      return 5;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
      throw new BadRequestException('take must be an integer between 1 and 20');
    }

    return parsed;
  }
}

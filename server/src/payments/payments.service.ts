import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

const DEFAULT_CURRENCY = 'LUMINA';
const FIRST_CHARGE_BONUS_RATE = new Decimal('0.1');

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: PaymentProviderRegistry,
  ) {}

  async createOrder(
    userId: string,
    input: {
      luminaProductId?: string;
      provider?: string;
      idempotencyKey?: string;
    },
  ) {
    if (!input.luminaProductId) {
      throw new BadRequestException('luminaProductId is required');
    }

    const provider = input.provider ?? this.providerRegistry.defaultProvider();
    const adapter = this.providerRegistry.get(provider);

    if (input.idempotencyKey) {
      const existingOrder = await this.prisma.paymentOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { luminaProduct: true, transactions: true },
      });

      if (existingOrder) {
        return {
          order: existingOrder,
          checkout: adapter.createCheckoutPayload({
            orderNo: existingOrder.orderNo,
            amount: existingOrder.amount.toString(),
            currency: existingOrder.currency,
            orderName: existingOrder.luminaProduct.name,
          }),
          provider: existingOrder.provider,
          idempotentReplay: true,
        };
      }
    }

    const product = await this.prisma.luminaProduct.findFirst({
      where: {
        id: input.luminaProductId,
        status: 'active',
      },
    });

    if (!product) {
      throw new NotFoundException('Lumina product not found');
    }

    const order = await this.prisma.paymentOrder.create({
      data: {
        userId,
        luminaProductId: product.id,
        orderNo: this.createOrderNo(),
        provider,
        status: 'pending',
        amount: product.priceAmount,
        currency: product.priceCurrency,
        idempotencyKey: input.idempotencyKey,
      },
      include: { luminaProduct: true, transactions: true },
    });

    return {
      order,
      checkout: adapter.createCheckoutPayload({
        orderNo: order.orderNo,
        amount: order.amount.toString(),
        currency: order.currency,
        orderName: product.name,
      }),
      provider: order.provider,
      idempotentReplay: false,
    };
  }

  async getOrder(userId: string, orderId: string) {
    const order = await this.prisma.paymentOrder.findFirst({
      where: { id: orderId, userId },
      include: {
        luminaProduct: true,
        transactions: true,
        refunds: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    return order;
  }

  listOrders(userId: string, takeQuery?: string) {
    const take = this.parseTake(takeQuery);

    return this.prisma.paymentOrder.findMany({
      where: { userId },
      include: {
        luminaProduct: true,
        transactions: true,
        refunds: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async handleWebhook(
    provider: string,
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
    rawBody?: Buffer,
  ) {
    const adapter = this.providerRegistry.get(provider);
    const event = adapter.verifyAndParseWebhook(headers, body, rawBody);

    const order = await this.prisma.paymentOrder.findUnique({
      where: { orderNo: event.orderNo },
      include: { luminaProduct: true },
    });

    if (!order) {
      throw new NotFoundException('Payment order not found');
    }

    if (order.provider !== provider) {
      throw new BadRequestException('Payment provider does not match order provider');
    }

    if (!new Decimal(event.amount).equals(order.amount)) {
      throw new BadRequestException('Payment amount does not match order amount');
    }

    return this.prisma.$transaction(async (tx) => {
      const existingTransaction = await tx.paymentTransaction.findUnique({
        where: {
          provider_providerTransactionId: {
            provider,
            providerTransactionId: event.providerTransactionId,
          },
        },
      });

      if (existingTransaction) {
        return {
          order: await tx.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { luminaProduct: true, transactions: true },
          }),
          transaction: existingTransaction,
          idempotentReplay: true,
        };
      }

      const transaction = await tx.paymentTransaction.upsert({
        where: {
          provider_providerTransactionId: {
            provider,
            providerTransactionId: event.providerTransactionId,
          },
        },
        update: {},
        create: {
          paymentOrderId: order.id,
          provider,
          providerTransactionId: event.providerTransactionId,
          status: event.status,
          rawPayload: event.rawPayload as object,
        },
      });

      if (event.status !== 'paid') {
        const nonPaidTransition = await tx.paymentOrder.updateMany({
          where: {
            id: order.id,
            status: {
              not: 'paid',
            },
          },
          data: {
            status: event.status === 'cancelled' ? 'cancelled' : 'failed',
            updatedAt: new Date(),
          },
        });

        const updatedOrder = await tx.paymentOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: { luminaProduct: true, transactions: true },
        });

        return {
          order: updatedOrder,
          transaction,
          idempotentReplay: nonPaidTransition.count === 0,
        };
      }

      const paidTransition = await tx.paymentOrder.updateMany({
        where: {
          id: order.id,
          status: {
            not: 'paid',
          },
        },
        data: {
          status: 'paid',
          updatedAt: new Date(),
        },
      });

      if (paidTransition.count === 0) {
        return {
          order: await tx.paymentOrder.findUniqueOrThrow({
            where: { id: order.id },
            include: { luminaProduct: true, transactions: true },
          }),
          transaction,
          idempotentReplay: true,
        };
      }

      const wallet = await tx.walletAccount.upsert({
        where: {
          userId_currencyCode: {
            userId: order.userId,
            currencyCode: DEFAULT_CURRENCY,
          },
        },
        update: {},
        create: {
          userId: order.userId,
          currencyCode: DEFAULT_CURRENCY,
        },
      });

      const creditAmount = order.luminaProduct.luminaAmount.plus(
        order.luminaProduct.bonusAmount,
      );
      const priorPaidOrderCount = await tx.paymentOrder.count({
        where: {
          userId: order.userId,
          status: 'paid',
          id: { not: order.id },
        },
      });
      const firstChargeBonusIdempotencyKey = `first_charge_bonus:${order.userId}`;
      const existingFirstChargeBonusLedger = await tx.walletLedger.findUnique({
        where: { idempotencyKey: firstChargeBonusIdempotencyKey },
      });
      const firstChargeBonusAmount =
        priorPaidOrderCount === 0 && !existingFirstChargeBonusLedger
          ? order.luminaProduct.luminaAmount
              .mul(FIRST_CHARGE_BONUS_RATE)
              .toDecimalPlaces(2)
          : new Decimal(0);
      const totalCreditAmount = creditAmount.plus(firstChargeBonusAmount);

      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount: creditAmount,
          ledgerType: 'purchase',
          referenceType: 'payment_order',
          referenceId: order.id,
          idempotencyKey: `payment:${provider}:${event.providerTransactionId}`,
          memo: `Lumina purchase: ${order.luminaProduct.name}`,
        },
      });
      const firstChargeBonusLedger = firstChargeBonusAmount.gt(0)
        ? await tx.walletLedger.create({
            data: {
              walletAccountId: wallet.id,
              direction: 'credit',
              amount: firstChargeBonusAmount,
              ledgerType: 'first_charge_bonus',
              referenceType: 'payment_order',
              referenceId: order.id,
              idempotencyKey: firstChargeBonusIdempotencyKey,
              memo: `First charge bonus: ${order.luminaProduct.name}`,
            },
          })
        : null;

      await tx.walletAccount.update({
        where: { id: wallet.id },
        data: {
          cachedBalance: {
            increment: totalCreditAmount,
          },
        },
      });

      const updatedOrder = await tx.paymentOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { luminaProduct: true, transactions: true },
      });

      return {
        order: updatedOrder,
        transaction,
        ledger,
        firstChargeBonusLedger,
        firstChargeBonus: {
          applied: Boolean(firstChargeBonusLedger),
          rate: FIRST_CHARGE_BONUS_RATE.toString(),
          amount: firstChargeBonusAmount.toString(),
        },
        idempotentReplay: false,
      };
    });
  }

  private createOrderNo() {
    return `LUMINA-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

  private parseTake(value?: string) {
    if (!value) {
      return 20;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new BadRequestException('take must be an integer between 1 and 100');
    }

    return parsed;
  }
}

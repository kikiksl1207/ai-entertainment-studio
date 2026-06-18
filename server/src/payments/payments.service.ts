import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVE_CHARGE_PRODUCT_SPECS,
  activeChargeProductWhere,
  isActiveChargeProduct,
} from './charge-products.policy';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';

const DEFAULT_CURRENCY = 'LUMINA';
const FIRST_CHARGE_BONUS_RATE = new Decimal('0.1');
const FIRST_CHARGE_BONUS_BASIS = 'base_lumina_only';

export const FIRST_CHARGE_BONUS_READ_ONLY_AUDIT_PROJECTION = {
  version: '2026-06-17.first-charge-bonus-read-only-audit-projection.v1',
  status: 'read_only_projection_contract',
  mutation: false,
  paymentProviderCall: false,
  walletCredit: false,
  bonusGrant: false,
  sourceOfTruth: {
    products: 'ACTIVE_CHARGE_PRODUCT_SPECS',
    baseLuminaAmount: 'lumina_products.lumina_amount',
    packageBonusLumina: 'lumina_products.bonus_amount',
    firstChargeBonusRateBps: 1000,
    firstChargeBonusBasis: FIRST_CHARGE_BONUS_BASIS,
  },
  serverAuthority: {
    clientSubmittedPriceTrusted: false,
    clientSubmittedLuminaAmountTrusted: false,
    clientSubmittedBonusAmountTrusted: false,
    clientSubmittedFirstChargeBonusTrusted: false,
    packageBonusAndFirstChargeShareLedgerType: false,
    packageBonusAndFirstChargeShareAuditRow: false,
  },
  products: ACTIVE_CHARGE_PRODUCT_SPECS.map((product) => {
    const firstChargeBonusLumina = product.luminaAmount / 10;
    const repeatChargeCreditLumina =
      product.luminaAmount + product.bonusAmount;
    return {
      sku: product.sku,
      priceAmountKrw: product.priceAmount,
      baseLuminaAmount: product.luminaAmount,
      packageBonusLumina: product.bonusAmount,
      firstChargeBonusLumina,
      repeatChargeCreditLumina,
      firstChargeTotalCreditLumina:
        repeatChargeCreditLumina + firstChargeBonusLumina,
      ledgerTypes: {
        packageCredit: 'purchase',
        firstChargeBonus: 'first_charge_bonus',
      },
    };
  }),
} as const;

export const FIRST_CHARGE_BONUS_IDEMPOTENCY_CONTRACT = {
  version: '2026-06-08.first-charge-bonus-idempotency.v1',
  canonicalChargePackageCount: 6,
  grantTrigger: 'first_successful_paid_lumina_order_transition_only',
  idempotencyKeyPattern: 'first_charge_bonus:<userId>',
  bonusBasis: FIRST_CHARGE_BONUS_BASIS,
  bonusRate: '10_percent',
  packageBonusIncluded: false,
  packageBonusLedgerType: 'purchase',
  firstChargeBonusLedgerType: 'first_charge_bonus',
  firstChargeBonusReferenceType: 'payment_order',
  uniquenessScope: ['userId', 'first_charge_bonus'],
  replaySources: [
    'provider_transaction_duplicate',
    'paid_order_callback_retry',
    'wallet_ledger_upsert_race',
  ],
  packageBonusSeparation: {
    packageBonusIncludedInPurchaseLedger: true,
    firstChargeBonusStoredInPurchaseLedger: false,
    highValuePackageBonusRowsSharedWithFirstCharge: false,
  },
  firstChargeOnceAcrossPackagesGuard: {
    version: '2026-06-19.first-charge-bonus-once-across-packages.v1',
    packageScope: 'all_six_canonical_lumina_charge_packages',
    firstPaidOrderSource: 'payment_orders.status_paid_for_user',
    triggerTransition: 'provider_verified_pending_to_paid',
    failedOrPendingOrdersCountAsFirstCharge: false,
    userScopedIdempotencyKey: 'first_charge_bonus:<userId>',
    duplicateGrantLookup: {
      table: 'wallet_ledger',
      ledgerType: 'first_charge_bonus',
      referenceType: 'payment_order',
      userIdScoped: true,
    },
    highValuePackageSeparation: {
      affectedSkus: ['lumina_50000', 'lumina_100000'],
      packageBonusLedgerType: 'purchase',
      firstChargeBonusLedgerType: 'first_charge_bonus',
      packageBonusIncludedInFirstChargeBasis: false,
      firstChargeBasis: 'lumina_products.lumina_amount',
    },
    mutationOpenedByThisContract: false,
    paymentMutation: false,
    walletCreditMutation: false,
    bonusMutation: false,
  },
  auditReadModelSeparation: {
    canonicalPackageSkus: [
      'lumina_1000',
      'lumina_3000',
      'lumina_5000',
      'lumina_10000',
      'lumina_50000',
      'lumina_100000',
    ],
    packageBonusField: 'lumina_products.bonus_amount',
    packageBonusLedgerType: 'purchase',
    firstChargeBonusLedgerType: 'first_charge_bonus',
    firstChargeBonusBasisField: 'lumina_products.lumina_amount',
    firstChargeBonusRateBps: 1000,
    packageBonusAndFirstChargeShareAuditRow: false,
    packageBonusAndFirstChargeShareLedgerType: false,
    highValuePackageBonusRowsSharedWithFirstCharge: false,
    auditTraceFields: [
      'paymentOrderId',
      'luminaProductSku',
      'baseLuminaAmount',
      'packageBonusLumina',
      'firstChargeBonusLumina',
      'walletLedgerType',
      'walletLedgerIdempotencyKey',
    ],
  },
  clientProvidedAmountAccepted: false,
  walletAndLedgerSameTransaction: true,
  duplicateProviderTransactionBehavior: 'idempotent_replay_without_wallet_ledger',
  alreadyPaidOrderBehavior: 'idempotent_replay_without_wallet_ledger',
  duplicateBonusKeyBehavior: 'upsert_replay_without_second_bonus_credit',
  failedProviderEventsLockEligibility: false,
  settlementEligible: false,
  cashRefundable: false,
  readOnlyAuditProjection: FIRST_CHARGE_BONUS_READ_ONLY_AUDIT_PROJECTION,
} as const;
const PAYMENT_ORDER_IDEMPOTENCY_CONFLICT = {
  code: 'PAYMENT_ORDER_IDEMPOTENCY_CONFLICT',
  message: 'payments.order.idempotencyConflict',
  messageKey: 'payments.order.idempotencyConflict',
  paymentOrderMutation: false,
} as const;
const PAYMENT_CHARGE_PRODUCT_UNAVAILABLE = {
  code: 'PAYMENT_CHARGE_PRODUCT_UNAVAILABLE',
  message: 'payments.order.chargeProductUnavailable',
  messageKey: 'payments.order.chargeProductUnavailable',
  paymentOrderMutation: false,
  walletMutation: false,
} as const;

export const CHARGE_FIXTURE_PAYMENT_SEPARATION_CONTRACT = {
  version: '2026-06-08.charge-fixture-payment-separation.v1',
  fixtureScope: {
    allowedSurfaces: ['local_preview_ui', 'storybook_like_preview'],
    serverAcceptedAsProductSource: false,
    paymentOrderMutation: false,
    walletMutation: false,
    bonusMutation: false,
    providerCheckoutMutation: false,
  },
  realPaymentSourceOfTruth: {
    productPolicy: 'ACTIVE_CHARGE_PRODUCT_SPECS',
    productLookup: 'activeChargeProductWhere(luminaProductId)',
    orderStatusBeforeProviderWebhook: 'pending',
    walletCreditTrigger: 'verified_provider_paid_webhook_only',
    firstChargeBonusTrigger: 'verified_first_paid_order_transition_only',
  },
  forbiddenFixtureFields: [
    'pg_pending',
    'preview',
    'fixture',
    'fixtureProductId',
    'fixtureStatus',
    'fixtureWalletBalance',
  ],
  serverAuthority: {
    clientSubmittedPriceTrusted: false,
    clientSubmittedLuminaAmountTrusted: false,
    clientSubmittedBonusAmountTrusted: false,
    clientSubmittedPaymentStatusTrusted: false,
    checkoutPreviewCanCreatePaymentOrder: false,
    checkoutPreviewCanCreateWalletLedger: false,
  },
} as const;

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
    const idempotencyKey = input.idempotencyKey?.trim() || undefined;

    if (idempotencyKey) {
      const existingOrder = await this.prisma.paymentOrder.findUnique({
        where: { idempotencyKey },
        include: { luminaProduct: true, transactions: true },
      });

      if (existingOrder) {
        this.assertCreateOrderIdempotentReplay(existingOrder, {
          userId,
          luminaProductId: input.luminaProductId,
          provider,
        });

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
      where: activeChargeProductWhere({
        id: input.luminaProductId,
      }),
    });

    if (!product) {
      throw new NotFoundException(PAYMENT_CHARGE_PRODUCT_UNAVAILABLE);
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
        idempotencyKey,
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

    this.assertServerChargeProduct(order.luminaProduct);

    if (order.provider !== provider) {
      throw new BadRequestException('Payment provider does not match order provider');
    }

    if (!new Decimal(event.amount).equals(order.amount)) {
      throw new BadRequestException('Payment amount does not match order amount');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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
          rawPayload: this.providerWebhookAuditPayload(provider, event),
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

      const packageBaseAmount = order.luminaProduct.luminaAmount;
      const packageBonusAmount = order.luminaProduct.bonusAmount;
      const packageCreditAmount = packageBaseAmount.plus(packageBonusAmount);
      const priorPaidOrderCount = await tx.paymentOrder.count({
        where: {
          userId: order.userId,
          status: 'paid',
          id: { not: order.id },
        },
      });
      const ledger = await tx.walletLedger.create({
        data: {
          walletAccountId: wallet.id,
          direction: 'credit',
          amount: packageCreditAmount,
          ledgerType: 'purchase',
          referenceType: 'payment_order',
          referenceId: order.id,
          idempotencyKey: `payment:${provider}:${event.providerTransactionId}`,
          memo: `Lumina purchase: ${order.luminaProduct.name}`,
        },
      });
      const firstChargeBonusIdempotencyKey = `first_charge_bonus:${order.userId}`;
      const firstChargeBonusCandidateAmount =
        priorPaidOrderCount === 0
          ? packageBaseAmount.mul(FIRST_CHARGE_BONUS_RATE).toDecimalPlaces(2)
          : new Decimal(0);
      const firstChargeBonusLedger = firstChargeBonusCandidateAmount.gt(0)
        ? await tx.walletLedger.upsert({
            where: { idempotencyKey: firstChargeBonusIdempotencyKey },
            update: {},
            create: {
              walletAccountId: wallet.id,
              direction: 'credit',
              amount: firstChargeBonusCandidateAmount,
              ledgerType: 'first_charge_bonus',
              referenceType: 'payment_order',
              referenceId: order.id,
              idempotencyKey: firstChargeBonusIdempotencyKey,
              memo: `First charge bonus: ${order.luminaProduct.name}`,
            },
          })
        : null;
      const firstChargeBonusApplied =
        firstChargeBonusLedger?.referenceId === order.id;
      const firstChargeBonusAmount = firstChargeBonusApplied
        ? firstChargeBonusCandidateAmount
        : new Decimal(0);
      const totalCreditAmount = packageCreditAmount.plus(firstChargeBonusAmount);

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
        firstChargeBonusLedger: firstChargeBonusApplied
          ? firstChargeBonusLedger
          : null,
        firstChargeBonus: {
          applied: firstChargeBonusApplied,
          rate: FIRST_CHARGE_BONUS_RATE.toString(),
          amount: firstChargeBonusAmount.toString(),
          basis: FIRST_CHARGE_BONUS_BASIS,
          basisField: 'lumina_products.lumina_amount',
          packageBonusIncluded: false,
          oneTimePerUser: true,
          idempotencyKeyPattern: 'first_charge_bonus:<userId>',
        },
        idempotentReplay: false,
      };
    });
  }

  private createOrderNo() {
    return `LUMINA-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

  private assertCreateOrderIdempotentReplay(
    order: {
      userId: string;
      luminaProductId: string;
      provider: string;
    },
    input: {
      userId: string;
      luminaProductId: string;
      provider: string;
    },
  ) {
    if (
      order.userId !== input.userId ||
      order.luminaProductId !== input.luminaProductId ||
      order.provider !== input.provider
    ) {
      throw new ConflictException(PAYMENT_ORDER_IDEMPOTENCY_CONFLICT);
    }
  }

  private assertServerChargeProduct(product: {
    sku?: string | null;
    priceAmount: Decimal.Value;
    priceCurrency?: string | null;
    luminaAmount: Decimal.Value;
    bonusAmount: Decimal.Value;
  }) {
    if (!isActiveChargeProduct(product)) {
      throw new BadRequestException(PAYMENT_CHARGE_PRODUCT_UNAVAILABLE);
    }
  }

  private providerWebhookAuditPayload(
    provider: string,
    event: {
      orderNo: string;
      providerTransactionId: string;
      status: string;
      amount: string;
    },
  ) {
    return {
      provider,
      orderNo: event.orderNo,
      providerTransactionId: event.providerTransactionId,
      status: event.status,
      amount: event.amount,
      sanitized: true,
      rawProviderPayloadStored: false,
    };
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

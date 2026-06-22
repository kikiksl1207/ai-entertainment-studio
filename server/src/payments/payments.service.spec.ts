import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CHARGE_PACKAGE_ADMIN_READ_ONLY_AUDIT_GUARD,
  CHARGE_FIXTURE_PAYMENT_SEPARATION_CONTRACT,
  FIRST_CHARGE_BONUS_IDEMPOTENCY_CONTRACT,
  FIRST_CHARGE_BONUS_READ_ONLY_AUDIT_PROJECTION,
  PaymentsService,
} from './payments.service';
import { ACTIVE_CHARGE_PRODUCT_SPECS } from './charge-products.policy';

const userId = '00000000-0000-4000-8000-000000000001';
const otherUserId = '00000000-0000-4000-8000-000000000002';
const productId = '00000000-0000-4000-8000-000000000101';
const otherProductId = '00000000-0000-4000-8000-000000000102';

function serviceWith(prisma: Record<string, unknown>, adapterOverrides = {}) {
  const adapter = {
    createCheckoutPayload: jest.fn((input) => ({
      provider: 'mock',
      mode: 'mock',
      ...input,
    })),
    verifyAndParseWebhook: jest.fn(),
    ...adapterOverrides,
  };
  const registry = {
    defaultProvider: jest.fn(() => 'mock'),
    get: jest.fn(() => adapter),
  };

  return {
    service: new PaymentsService(prisma as never, registry as never),
    adapter,
    registry,
  };
}

function existingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000201',
    userId,
    luminaProductId: productId,
    provider: 'mock',
    orderNo: 'LUMINA-ORDER-1',
    amount: new Decimal(1000),
    currency: 'KRW',
    luminaProduct: {
      id: productId,
      sku: 'LUMINA_100',
      name: 'Lumina 100',
      luminaAmount: new Decimal(100),
      bonusAmount: new Decimal(0),
      priceAmount: new Decimal(1000),
      priceCurrency: 'KRW',
      status: 'active',
    },
    transactions: [],
    ...overrides,
  };
}

function paidWebhookFixture(
  overrides: {
    existingFirstChargeBonusLedger?: Record<string, unknown> | null;
    existingTransaction?: Record<string, unknown> | null;
    order?: Record<string, unknown>;
    paidTransitionCount?: number;
    priorPaidOrderCount?: number;
    providerTransactionId?: string;
  } = {},
) {
  const order = existingOrder({
    amount: new Decimal(50000),
    luminaProduct: {
      id: productId,
      sku: 'LUMINA_5800',
      name: 'Lumina 5,000 + bonus 800',
      luminaAmount: new Decimal(5000),
      bonusAmount: new Decimal(800),
      priceAmount: new Decimal(50000),
      priceCurrency: 'KRW',
      status: 'active',
    },
    ...overrides.order,
  });
  const providerTransactionId = overrides.providerTransactionId ?? 'provider-txn-paid-1';
  const transaction = {
    id: '00000000-0000-4000-8000-000000000301',
    provider: 'mock',
    providerTransactionId,
  };
  const wallet = {
    id: '00000000-0000-4000-8000-000000000401',
  };
  let ledgerCreateIndex = 0;
  const tx = {
    paymentTransaction: {
      findUnique: jest.fn().mockResolvedValue(overrides.existingTransaction ?? null),
      upsert: jest.fn().mockResolvedValue(transaction),
    },
    paymentOrder: {
      updateMany: jest.fn().mockResolvedValue({
        count: overrides.paidTransitionCount ?? 1,
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      count: jest.fn().mockResolvedValue(overrides.priorPaidOrderCount ?? 0),
    },
    walletAccount: {
      upsert: jest.fn().mockResolvedValue(wallet),
      update: jest.fn().mockResolvedValue(wallet),
    },
    walletLedger: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `ledger-${++ledgerCreateIndex}`,
        ...data,
      })),
      upsert: jest.fn(
        async ({ create }: { create: Record<string, unknown> }) =>
          overrides.existingFirstChargeBonusLedger ?? {
            id: `ledger-${++ledgerCreateIndex}`,
            ...create,
          },
      ),
    },
  };
  const prisma = {
    paymentOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };

  return {
    order,
    prisma,
    tx,
    webhookEvent: {
      orderNo: order.orderNo,
      providerTransactionId,
      status: 'paid',
      amount: order.amount.toString(),
      rawPayload: {
        orderNo: order.orderNo,
        providerTransactionId,
        status: 'paid',
        amount: order.amount.toString(),
      },
    },
  };
}

describe('PaymentsService server-authority contract', () => {
  it('keeps charge preview fixture state out of real order and wallet authority', () => {
    expect(CHARGE_FIXTURE_PAYMENT_SEPARATION_CONTRACT).toMatchObject({
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
      serverAuthority: {
        clientSubmittedPriceTrusted: false,
        clientSubmittedLuminaAmountTrusted: false,
        clientSubmittedBonusAmountTrusted: false,
        clientSubmittedPaymentStatusTrusted: false,
        checkoutPreviewCanCreatePaymentOrder: false,
        checkoutPreviewCanCreateWalletLedger: false,
      },
    });
    expect(
      CHARGE_FIXTURE_PAYMENT_SEPARATION_CONTRACT.forbiddenFixtureFields,
    ).toEqual(
      expect.arrayContaining([
        'pg_pending',
        'preview',
        'fixture',
        'fixtureProductId',
        'fixtureStatus',
        'fixtureWalletBalance',
      ]),
    );
  });

  it('documents first-charge bonus idempotency as a server-side wallet contract', () => {
    expect(FIRST_CHARGE_BONUS_IDEMPOTENCY_CONTRACT).toMatchObject({
      canonicalChargePackageCount: 6,
      grantTrigger: 'first_successful_paid_lumina_order_transition_only',
      idempotencyKeyPattern: 'first_charge_bonus:<userId>',
      bonusBasis: 'base_lumina_only',
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
        auditTraceFields: expect.arrayContaining([
          'paymentOrderId',
          'luminaProductSku',
          'baseLuminaAmount',
          'packageBonusLumina',
          'firstChargeBonusLumina',
          'walletLedgerType',
          'walletLedgerIdempotencyKey',
        ]),
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
    });
  });

  it('publishes first-charge bonus read-only audit projection for all charge packages', () => {
    const projection = FIRST_CHARGE_BONUS_READ_ONLY_AUDIT_PROJECTION;

    expect(projection).toMatchObject({
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
        firstChargeBonusBasis: 'base_lumina_only',
      },
      serverAuthority: {
        clientSubmittedPriceTrusted: false,
        clientSubmittedLuminaAmountTrusted: false,
        clientSubmittedBonusAmountTrusted: false,
        clientSubmittedFirstChargeBonusTrusted: false,
        packageBonusAndFirstChargeShareLedgerType: false,
        packageBonusAndFirstChargeShareAuditRow: false,
      },
      adminReadOnlyAuditGuard: CHARGE_PACKAGE_ADMIN_READ_ONLY_AUDIT_GUARD,
    });
    expect(projection.products.map((product) => product.priceAmountKrw)).toEqual([
      1000, 3000, 5000, 10000, 50000, 100000,
    ]);
    expect(projection.products).toHaveLength(6);
    expect(projection.products).toEqual(
      ACTIVE_CHARGE_PRODUCT_SPECS.map((product) =>
        expect.objectContaining({
          sku: product.sku,
          priceAmountKrw: product.priceAmount,
          baseLuminaAmount: product.luminaAmount,
          packageBonusLumina: product.bonusAmount,
          firstChargeBonusLumina: product.luminaAmount / 10,
          repeatChargeCreditLumina: product.luminaAmount + product.bonusAmount,
          firstChargeTotalCreditLumina:
            product.luminaAmount + product.bonusAmount + product.luminaAmount / 10,
          ledgerTypes: {
            packageCredit: 'purchase',
            firstChargeBonus: 'first_charge_bonus',
          },
        }),
      ),
    );
    expect(projection.products.find((product) => product.priceAmountKrw === 50000)).toMatchObject({
      baseLuminaAmount: 5000,
      packageBonusLumina: 800,
      firstChargeBonusLumina: 500,
      repeatChargeCreditLumina: 5800,
      firstChargeTotalCreditLumina: 6300,
    });
    expect(projection.products.find((product) => product.priceAmountKrw === 100000)).toMatchObject({
      baseLuminaAmount: 10000,
      packageBonusLumina: 2000,
      firstChargeBonusLumina: 1000,
      repeatChargeCreditLumina: 12000,
      firstChargeTotalCreditLumina: 13000,
    });
  });

  it('guards admin charge package audit as super-admin read-only without payment or wallet side effects', () => {
    const guard = CHARGE_PACKAGE_ADMIN_READ_ONLY_AUDIT_GUARD;

    expect(guard).toMatchObject({
      status: 'read_only_audit_contract',
      endpoint: 'GET /api/v1/admin/payments/charge-packages/audit',
      requiredRole: 'super_admin',
      requiredPermission: 'payments:read',
      mutation: false,
      paymentOrderCreate: false,
      paymentProviderCall: false,
      walletCredit: false,
      bonusGrant: false,
      settlementMutation: false,
      payoutMutation: false,
      packageScope: {
        canonicalPackageCount: 6,
        sourceOfTruth: 'ACTIVE_CHARGE_PRODUCT_SPECS',
        clientSubmittedProductTrusted: false,
        clientSubmittedAmountTrusted: false,
      },
      firstChargeAudit: {
        grantLimit: 'once_per_user_across_all_six_packages',
        idempotencyKeyPattern: 'first_charge_bonus:<userId>',
        duplicateGrantBehavior: 'show_existing_ledger_without_second_bonus',
        packageBonusSeparatedFromFirstCharge: true,
        highValuePackageBonusSkus: ['LUMINA_5800', 'LUMINA_12000'],
        firstChargeBasis: 'base_lumina_only',
        firstChargeRateBps: 1000,
      },
      forbiddenSideEffects: {
        paymentOrderCreate: false,
        providerCheckout: false,
        walletCredit: false,
        bonusGrant: false,
        settlement: false,
        payout: false,
      },
      errorResponses: {
        forbidden: {
          code: 'PAYMENT_ADMIN_AUDIT_FORBIDDEN',
          messageKey: 'payments.adminAudit.forbidden',
        },
        unavailable: {
          code: 'PAYMENT_ADMIN_AUDIT_UNAVAILABLE',
          messageKey: 'payments.adminAudit.unavailable',
        },
      },
      privacy: {
        rawEmailReturned: false,
        providerTransactionIdReturned: false,
        paymentCredentialReturned: false,
        tokenReturned: false,
        cookieReturned: false,
      },
    });
    expect(guard.packageScope.skus).toEqual(
      ACTIVE_CHARGE_PRODUCT_SPECS.map((product) => product.sku),
    );
    expect(guard.packageScope.priceAmountsKrw).toEqual([
      1000, 3000, 5000, 10000, 50000, 100000,
    ]);
    expect(guard.projectionFields).toEqual(
      expect.arrayContaining([
        'sku',
        'priceAmountKrw',
        'baseLuminaAmount',
        'packageBonusLumina',
        'firstChargeBonusLumina',
        'firstChargeEligibilityState',
        'duplicateFirstChargeGrantState',
      ]),
    );
  });

  it('applies first-charge 10 percent once across all six canonical packages without mixing package bonus ledger reasons', async () => {
    expect(ACTIVE_CHARGE_PRODUCT_SPECS).toHaveLength(6);

    for (const product of ACTIVE_CHARGE_PRODUCT_SPECS) {
      const { prisma, tx, webhookEvent } = paidWebhookFixture({
        providerTransactionId: `provider-txn-${product.sku}`,
        order: {
          amount: new Decimal(product.priceAmount),
          luminaProduct: {
            id: productId,
            sku: product.sku,
            name: product.name,
            luminaAmount: new Decimal(product.luminaAmount),
            bonusAmount: new Decimal(product.bonusAmount),
            priceAmount: new Decimal(product.priceAmount),
            priceCurrency: product.priceCurrency,
            status: 'active',
          },
        },
      });
      const { service } = serviceWith(prisma, {
        verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
      });

      await expect(service.handleWebhook('mock', {}, {})).resolves.toMatchObject({
        firstChargeBonus: {
          applied: true,
          amount: new Decimal(product.luminaAmount).mul('0.1').toString(),
          basis: 'base_lumina_only',
          packageBonusIncluded: false,
          oneTimePerUser: true,
        },
      });

      const purchaseLedger = tx.walletLedger.create.mock.calls[0][0].data;
      const firstChargeBonusLedger = tx.walletLedger.upsert.mock.calls[0][0].create;
      const expectedPurchaseCredit = new Decimal(product.luminaAmount).plus(
        product.bonusAmount,
      );
      const expectedFirstChargeBonus = new Decimal(product.luminaAmount).mul('0.1');

      expect(purchaseLedger.ledgerType).toBe('purchase');
      expect((purchaseLedger.amount as Decimal).toString()).toBe(
        expectedPurchaseCredit.toString(),
      );
      expect(firstChargeBonusLedger.ledgerType).toBe('first_charge_bonus');
      expect(firstChargeBonusLedger.referenceType).toBe('payment_order');
      expect(firstChargeBonusLedger.idempotencyKey).toBe(
        `first_charge_bonus:${userId}`,
      );
      expect((firstChargeBonusLedger.amount as Decimal).toString()).toBe(
        expectedFirstChargeBonus.toString(),
      );
    }
  });

  it('creates checkout orders only from active charge-policy price tiers', async () => {
    const product = {
      id: productId,
      name: 'Lumina 100',
      sku: 'LUMINA_100',
      priceAmount: new Decimal(1000),
      priceCurrency: 'KRW',
      luminaAmount: new Decimal(100),
      bonusAmount: new Decimal(0),
    };
    const order = existingOrder({
      luminaProductId: product.id,
      amount: product.priceAmount,
      currency: product.priceCurrency,
      luminaProduct: product,
    });
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(order),
      },
      luminaProduct: {
        findFirst: jest.fn().mockResolvedValue(product),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.createOrder(userId, {
        luminaProductId: productId,
        idempotencyKey: ' charge-key-1 ',
        priceAmount: '1',
        luminaAmount: '999999',
        bonusAmount: '999999',
        totalLumina: '999999',
        status: 'pg_pending',
        fixture: true,
        fixtureProductId: otherProductId,
      } as never),
    ).resolves.toMatchObject({
      order,
      idempotentReplay: false,
    });

    expect(prisma.luminaProduct.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: productId,
        status: 'active',
        OR: expect.arrayContaining([
          expect.objectContaining({
            sku: 'LUMINA_100',
            priceAmount: 1000,
            luminaAmount: 100,
            bonusAmount: 0,
          }),
          expect.objectContaining({
            sku: 'LUMINA_12000',
            priceAmount: 100000,
            luminaAmount: 10000,
            bonusAmount: 2000,
          }),
        ]),
      }),
    });
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: product.priceAmount,
          currency: 'KRW',
          idempotencyKey: 'charge-key-1',
        }),
      }),
    );
  });

  it('rejects active products that do not match the six server charge packages', async () => {
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      luminaProduct: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const { service, adapter } = serviceWith(prisma);

    await expect(
      service.createOrder(userId, {
        luminaProductId: productId,
        idempotencyKey: 'charge-key-rogue',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'PAYMENT_CHARGE_PRODUCT_UNAVAILABLE',
        messageKey: 'payments.order.chargeProductUnavailable',
        paymentOrderMutation: false,
        walletMutation: false,
      },
    });

    expect(adapter.createCheckoutPayload).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency key reuse across another user before returning checkout data', async () => {
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(existingOrder({ userId: otherUserId })),
        create: jest.fn(),
      },
      luminaProduct: {
        findFirst: jest.fn(),
      },
    };
    const { service, adapter } = serviceWith(prisma);

    await expect(
      service.createOrder(userId, {
        luminaProductId: productId,
        idempotencyKey: 'charge-key-1',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'PAYMENT_ORDER_IDEMPOTENCY_CONFLICT',
        messageKey: 'payments.order.idempotencyConflict',
        paymentOrderMutation: false,
      },
    });

    expect(adapter.createCheckoutPayload).not.toHaveBeenCalled();
    expect(prisma.luminaProduct.findFirst).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('rejects idempotency key reuse for a different product before creating an order', async () => {
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(existingOrder()),
        create: jest.fn(),
      },
      luminaProduct: {
        findFirst: jest.fn(),
      },
    };
    const { service } = serviceWith(prisma);

    await expect(
      service.createOrder(userId, {
        luminaProductId: otherProductId,
        idempotencyKey: 'charge-key-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.luminaProduct.findFirst).not.toHaveBeenCalled();
    expect(prisma.paymentOrder.create).not.toHaveBeenCalled();
  });

  it('stores only sanitized payment webhook audit payload fields', async () => {
    const order = existingOrder();
    const tx = {
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000301',
        }),
      },
      paymentOrder: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      },
    };
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const { service, adapter } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue({
        orderNo: order.orderNo,
        providerTransactionId: 'provider-txn-1',
        status: 'failed',
        amount: '1000',
        rawPayload: {
          orderNo: order.orderNo,
          token: 'must-not-be-stored',
          cookie: 'must-not-be-stored',
          cardNumber: 'must-not-be-stored',
        },
      }),
    });

    await service.handleWebhook('mock', {}, {});

    expect(adapter.verifyAndParseWebhook).toHaveBeenCalled();
    const createArg = tx.paymentTransaction.upsert.mock.calls[0][0].create;
    expect(createArg.rawPayload).toEqual({
      provider: 'mock',
      orderNo: order.orderNo,
      providerTransactionId: 'provider-txn-1',
      status: 'failed',
      amount: '1000',
      sanitized: true,
      rawProviderPayloadStored: false,
    });
    expect(JSON.stringify(createArg.rawPayload)).not.toContain('must-not-be-stored');
  });

  it('does not lock first-charge bonus eligibility on failed provider events', async () => {
    const order = existingOrder();
    const tx = {
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000302',
        }),
      },
      paymentOrder: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...order,
          status: 'failed',
        }),
        count: jest.fn(),
      },
      walletAccount: {
        upsert: jest.fn(),
        update: jest.fn(),
      },
      walletLedger: {
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      paymentOrder: {
        findUnique: jest.fn().mockResolvedValue(order),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue({
        orderNo: order.orderNo,
        providerTransactionId: 'provider-txn-failed-1',
        status: 'failed',
        amount: order.amount.toString(),
      }),
    });

    const result = await service.handleWebhook('mock', {}, {});

    expect(result).toMatchObject({
      order: expect.objectContaining({ status: 'failed' }),
      idempotentReplay: false,
    });
    expect(tx.paymentOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    expect(tx.paymentOrder.count).not.toHaveBeenCalled();
    expect(tx.walletAccount.upsert).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.walletLedger.upsert).not.toHaveBeenCalled();
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
  });

  it('grants repeatable package bonus and one-time first-charge bonus from base Lumina only', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture();
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    const result = await service.handleWebhook('mock', {}, {});

    expect(tx.walletLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.walletLedger.upsert).toHaveBeenCalledTimes(1);
    const purchaseLedger = tx.walletLedger.create.mock.calls[0][0].data;
    const firstChargeBonusLedger = tx.walletLedger.upsert.mock.calls[0][0].create;
    expect((purchaseLedger.amount as Decimal).toString()).toBe('5800');
    expect(purchaseLedger.ledgerType).toBe('purchase');
    expect((firstChargeBonusLedger.amount as Decimal).toString()).toBe('500');
    expect(firstChargeBonusLedger.ledgerType).toBe('first_charge_bonus');
    expect(firstChargeBonusLedger.idempotencyKey).toBe(`first_charge_bonus:${userId}`);
    const walletIncrement = tx.walletAccount.update.mock.calls[0][0].data.cachedBalance
      .increment as Decimal;
    expect(walletIncrement.toString()).toBe('6300');
    expect(result).toMatchObject({
      firstChargeBonus: {
        applied: true,
        rate: '0.1',
        amount: '500',
        basis: 'base_lumina_only',
        basisField: 'lumina_products.lumina_amount',
        packageBonusIncluded: false,
        oneTimePerUser: true,
      },
      idempotentReplay: false,
    });
  });

  it('does not duplicate first-charge bonus when the user already has the grant ledger', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture({
      existingFirstChargeBonusLedger: {
        id: 'existing-first-charge-bonus-ledger',
        idempotencyKey: `first_charge_bonus:${userId}`,
      },
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    const result = await service.handleWebhook('mock', {}, {});

    expect(tx.walletLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.walletLedger.upsert).toHaveBeenCalledTimes(1);
    const purchaseLedger = tx.walletLedger.create.mock.calls[0][0].data;
    expect((purchaseLedger.amount as Decimal).toString()).toBe('5800');
    const walletIncrement = tx.walletAccount.update.mock.calls[0][0].data.cachedBalance
      .increment as Decimal;
    expect(walletIncrement.toString()).toBe('5800');
    expect(result).toMatchObject({
      firstChargeBonus: {
        applied: false,
        amount: '0',
        basis: 'base_lumina_only',
        packageBonusIncluded: false,
      },
    });
  });

  it('does not attempt first-charge bonus on non-first paid Lumina orders', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture({
      priorPaidOrderCount: 1,
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    const result = await service.handleWebhook('mock', {}, {});

    expect(tx.walletLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.walletLedger.upsert).not.toHaveBeenCalled();
    const walletIncrement = tx.walletAccount.update.mock.calls[0][0].data.cachedBalance
      .increment as Decimal;
    expect(walletIncrement.toString()).toBe('5800');
    expect(result).toMatchObject({
      firstChargeBonusLedger: null,
      firstChargeBonus: {
        applied: false,
        amount: '0',
        oneTimePerUser: true,
      },
    });
  });

  it('does not credit first-charge bonus when the user-scoped bonus key already won a race', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture({
      existingFirstChargeBonusLedger: {
        id: 'existing-first-charge-bonus-ledger',
        referenceId: '00000000-0000-4000-8000-000000000999',
        idempotencyKey: `first_charge_bonus:${userId}`,
      },
      priorPaidOrderCount: 0,
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    const result = await service.handleWebhook('mock', {}, {});

    expect(tx.walletLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.walletLedger.upsert).toHaveBeenCalledTimes(1);
    const walletIncrement = tx.walletAccount.update.mock.calls[0][0].data.cachedBalance
      .increment as Decimal;
    expect(walletIncrement.toString()).toBe('5800');
    expect(result).toMatchObject({
      firstChargeBonusLedger: null,
      firstChargeBonus: {
        applied: false,
        amount: '0',
        oneTimePerUser: true,
      },
    });
  });

  it('fails closed before wallet credit if a paid order references a non-canonical charge product', async () => {
    const { prisma, tx, webhookEvent, order } = paidWebhookFixture({
      order: {
        luminaProduct: {
          id: productId,
          sku: 'LUMINA_TAMPERED',
          name: 'Tampered Lumina',
          luminaAmount: new Decimal(999999),
          bonusAmount: new Decimal(999999),
          priceAmount: new Decimal(1000),
          priceCurrency: 'KRW',
          status: 'active',
        },
      },
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue({
        ...webhookEvent,
        amount: order.amount.toString(),
      }),
    });

    await expect(service.handleWebhook('mock', {}, {})).rejects.toMatchObject({
      response: {
        code: 'PAYMENT_CHARGE_PRODUCT_UNAVAILABLE',
        messageKey: 'payments.order.chargeProductUnavailable',
        walletMutation: false,
      },
    });
    expect(tx.walletAccount.upsert).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.walletLedger.upsert).not.toHaveBeenCalled();
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
  });

  it('treats duplicate provider webhook delivery as an idempotent replay without ledgers', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture({
      existingTransaction: {
        id: 'existing-provider-transaction',
        provider: 'mock',
        providerTransactionId: 'provider-txn-paid-1',
      },
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    await expect(service.handleWebhook('mock', {}, {})).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(tx.paymentTransaction.upsert).not.toHaveBeenCalled();
    expect(tx.walletAccount.upsert).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
  });

  it('treats an already-paid order webhook as a replay before wallet or first bonus ledgers', async () => {
    const { prisma, tx, webhookEvent } = paidWebhookFixture({
      paidTransitionCount: 0,
      providerTransactionId: 'provider-txn-paid-late-delivery',
    });
    const { service } = serviceWith(prisma, {
      verifyAndParseWebhook: jest.fn().mockReturnValue(webhookEvent),
    });

    await expect(service.handleWebhook('mock', {}, {})).resolves.toMatchObject({
      idempotentReplay: true,
    });
    expect(tx.paymentTransaction.upsert).toHaveBeenCalledTimes(1);
    expect(tx.walletAccount.upsert).not.toHaveBeenCalled();
    expect(tx.paymentOrder.count).not.toHaveBeenCalled();
    expect(tx.walletLedger.create).not.toHaveBeenCalled();
    expect(tx.walletLedger.upsert).not.toHaveBeenCalled();
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
  });
});

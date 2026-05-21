import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PaymentsService } from './payments.service';

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
      name: 'Lumina 70',
      luminaAmount: new Decimal(70),
      bonusAmount: new Decimal(0),
    },
    transactions: [],
    ...overrides,
  };
}

describe('PaymentsService server-authority contract', () => {
  it('creates checkout orders only from active charge-policy price tiers', async () => {
    const product = {
      id: productId,
      name: 'Lumina 100',
      priceAmount: new Decimal(1000),
      priceCurrency: 'KRW',
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
      }),
    ).resolves.toMatchObject({
      order,
      idempotentReplay: false,
    });

    expect(prisma.luminaProduct.findFirst).toHaveBeenCalledWith({
      where: {
        id: productId,
        status: 'active',
        priceAmount: { in: [1000, 3000, 5000, 10000, 50000, 100000] },
      },
    });
    expect(prisma.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: 'charge-key-1',
        }),
      }),
    );
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
});

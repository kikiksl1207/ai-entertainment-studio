import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

type PaymentQuery = Parameters<AdminService['getPaymentOrders']>[0];

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const LOOKAHEAD = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-08T00:00:00.000Z');
const PRIVATE_MARKER = 'SYNTHETIC_PAYMENT_FILTER_PRIVATE_MARKER';

function payment(id: string) {
  return {
    id, userId: USER, luminaProductId: FIRST, orderNo: 'QA-ORDER-' + id,
    provider: 'qa-provider', status: 'paid', amount: new Decimal('12.34'), currency: 'KRW',
    createdAt: NOW, updatedAt: NOW, metadata: { marker: PRIVATE_MARKER },
    idempotencyKey: PRIVATE_MARKER,
    user: { id: USER, email: 'payment-filter@example.invalid', status: 'active', passwordHash: PRIVATE_MARKER },
    luminaProduct: null,
    transactions: [{ id: FIRST, paymentOrderId: id, provider: 'qa-provider',
      providerTransactionId: 'QA-TX-' + id, status: 'paid', createdAt: NOW,
      rawPayload: { marker: PRIVATE_MARKER } }],
    refunds: [],
  };
}

function fixture(rows: ReturnType<typeof payment>[] = []) {
  const db = { paymentOrder: { findMany: jest.fn().mockResolvedValue(rows) } };
  // No Prisma client or write methods are constructed for this query boundary.
  const service = new AdminService(db as unknown as PrismaService, new ConfigService({}));
  return { db, service };
}

describe('AdminService payment userId filter boundary', () => {
  it.each([
    ['empty array', []],
    ['repeated-key array', [USER, FIRST]],
    ['object', { value: USER }],
    ['null', null],
    ['zero', 0],
    ['number', 42],
    ['false', false],
    ['true', true],
  ] as const)('rejects supplied %s with 400 before the payment reader', async (_name, userId) => {
    const { db, service } = fixture();
    const result: unknown = await Promise.resolve()
      .then(() => service.getPaymentOrders({ userId } as unknown as PaymentQuery))
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(BadRequestException);
    if (!(result instanceof BadRequestException)) throw new Error('Expected userId input rejection');
    expect(result.getStatus()).toBe(400);
    expect(db.paymentOrder.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['omitted', {}],
    ['undefined', { userId: undefined }],
  ] as const)('preserves the %s filter and default empty-page contract', async (_name, query) => {
    const { db, service } = fixture();
    const page = await service.getPaymentOrders(query);
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {}, take: 51, orderBy: { createdAt: 'desc' },
    }));
    expect(page).toEqual({ items: [], count: 0, hasMore: false, nextCursor: null });
  });

  it('preserves trimmed scalar filters, cursor lookahead and the finance presenter', async () => {
    const rows = [payment(FIRST), payment(SECOND), payment(LOOKAHEAD)];
    const before = JSON.stringify(rows);
    const { db, service } = fixture(rows);
    const page = await service.getPaymentOrders({ userId: ' ' + USER + ' ',
      take: '2', cursor: FIRST, provider: ' qa-provider ', status: ' paid ',
      orderNo: ' QA-ORDER ', q: ' qa-search ' });
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER, provider: 'qa-provider', status: 'paid',
        orderNo: { contains: 'QA-ORDER', mode: 'insensitive' },
        OR: [
          { orderNo: { contains: 'qa-search', mode: 'insensitive' } },
          { provider: { contains: 'qa-search', mode: 'insensitive' } },
          { user: { email: { contains: 'qa-search', mode: 'insensitive' } } },
        ] },
      take: 3, cursor: { id: FIRST }, skip: 1, orderBy: { createdAt: 'desc' },
      include: expect.objectContaining({ transactions: expect.any(Object), refunds: expect.any(Object) }),
    }));
    expect(page.count).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(SECOND);
    expect(page.items.map(item => item.id)).toEqual([FIRST, SECOND]);
    expect(page.items[0].amount).toBe(rows[0].amount);
    expect(page.items[0].createdAt).toBe(NOW);
    expect(page.items[0].transactions[0].providerTransactionId).toBe('QA-TX-' + FIRST);
    expect(JSON.stringify(page)).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it.each(['', '   '])('preserves existing blank-string normalization for %j', async userId => {
    const { db, service } = fixture();
    await service.getPaymentOrders({ userId });
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: '' } }));
  });

  it('does not introduce identifier-format validation for scalar strings', async () => {
    const { db, service } = fixture();
    await service.getPaymentOrders({ userId: ' qa-literal-filter ' });
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'qa-literal-filter' },
    }));
  });

  it('preserves reader failure rather than returning a successful empty page', async () => {
    const { db, service } = fixture();
    const error = new Error('Synthetic payment reader failure');
    db.paymentOrder.findMany.mockRejectedValue(error);
    await expect(service.getPaymentOrders({ userId: USER })).rejects.toBe(error);
    expect(db.paymentOrder.findMany).toHaveBeenCalledTimes(1);
  });
});

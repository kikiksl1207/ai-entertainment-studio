import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Decimal } from '@prisma/client/runtime/library';
import { AdminService } from './admin.service';
import type { PrismaService } from '../prisma/prisma.service';

const CANARY = 'QA_FINANCE_SERVICE_JSON_CANARY_20261006';
const NOW = new Date('2026-10-06T09:00:00.000Z');
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_LOOKAHEAD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const LOOKAHEAD = '33333333-3333-4333-8333-333333333333';
const KEY = 'artist:' + FIRST + ':2026-10';
const AMOUNT = new Decimal('123456789012.34');

function readDb() {
  return {
    paymentOrder: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    refundTransaction: { findMany: jest.fn().mockResolvedValue([]) },
    settlementRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    auditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    settlementLuminaConversionRequest: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountKrw: null, requestedLumina: null } }),
    },
  };
}

type ReadDb = ReturnType<typeof readDb>;

function subject(db: ReadDb) {
  // No PrismaService/PrismaClient is constructed; unregistered write methods fail closed.
  return new AdminService(db as unknown as PrismaService, new ConfigService({}));
}

function noReads(db: ReadDb) {
  for (const model of Object.values(db)) {
    for (const read of Object.values(model)) expect(read).not.toHaveBeenCalled();
  }
}

function payment(id = FIRST) {
  return {
    id, userId: USER, luminaProductId: FIRST, orderNo: 'QA-ORDER-' + id,
    provider: 'qa-provider', status: 'paid', amount: AMOUNT, currency: 'KRW',
    idempotencyKey: CANARY, metadata: { unrelated: CANARY }, createdAt: NOW, updatedAt: NOW,
    user: { id: USER, email: 'finance.service@example.invalid', status: 'active',
      createdAt: NOW, passwordHash: CANARY },
    luminaProduct: { id: FIRST, sku: 'qa-product', name: 'QA Lumina', luminaAmount: AMOUNT,
      bonusAmount: new Decimal(0), priceAmount: AMOUNT, priceCurrency: 'KRW', status: 'active',
      createdAt: NOW, updatedAt: NOW, metadata: { internal: CANARY } },
    transactions: [{ id: FIRST, paymentOrderId: id, provider: 'qa-provider',
      providerTransactionId: 'QA-TX-' + id, status: 'paid', createdAt: NOW,
      rawPayload: { password: CANARY, arbitrary: { marker: CANARY } } }],
    refunds: [],
  };
}

function refund(id = FIRST) {
  return {
    id, paymentOrderId: FIRST, providerRefundId: 'QA-REFUND-' + id, amount: AMOUNT,
    reason: 'Accounting approved duplicate purchase refund.', status: 'requested',
    createdAt: NOW, updatedAt: NOW, metadata: { arbitrary: CANARY },
    paymentOrder: payment(),
  };
}

function record() {
  return {
    id: FIRST, settlementKey: KEY, settlementType: 'artist', period: '2026-10',
    status: 'hold', artistId: FIRST, partnerUserId: null, creatorUserId: USER,
    amountKrw: AMOUNT, reason: 'Period reconciliation pending.', note: 'Awaiting external payout confirmation.',
    paidAt: null, paymentMethod: 'bank_transfer', payoutReference: 'QA-PAYOUT',
    metadata: { arbitrary: CANARY }, createdByUserId: USER, updatedByUserId: USER,
    createdAt: NOW, updatedAt: NOW,
  };
}

function conversion(id = FIRST, requesterUserId = USER) {
  return {
    id, requesterUserId, settlementKey: KEY, settlementType: 'artist', period: '2026-10',
    targetArtistId: FIRST, amountKrw: AMOUNT, requestedLumina: new Decimal('123.45'),
    status: 'approved', note: 'Approved financial attribution.', adminNote: 'Accounting checked totals.',
    walletLedgerId: null, processedByUserId: null, processedAt: null,
    idempotencyKey: CANARY, metadata: { arbitrary: CANARY }, createdAt: NOW, updatedAt: NOW,
  };
}

function requester(id: string) {
  return { id, email: 'requester.' + id + '@example.invalid', status: 'active',
    profile: { displayName: 'QA Requester', publicHandle: 'qa-finance', avatarAssetId: FIRST } };
}

const pagedReads = [
  ['payment orders', (service: AdminService, query: Record<string, string | undefined>) => service.getPaymentOrders(query)],
  ['refunds', (service: AdminService, query: Record<string, string | undefined>) => service.getRefundTransactions(query)],
  ['conversions', (service: AdminService, query: Record<string, string | undefined>) => service.getBackstageSettlementConversions(query)],
] as const;

describe('AdminService finance READ integration', () => {
  it('projects payment page.items after pagination without changing cursor/filter/include contracts', async () => {
    const db = readDb(), rows = [payment(FIRST), payment(SECOND), payment(LOOKAHEAD)];
    db.paymentOrder.findMany.mockResolvedValue(rows);
    const original = JSON.stringify(rows);
    const page = await subject(db).getPaymentOrders({ take: '2', cursor: FIRST, provider: 'qa-provider', status: 'paid' });
    expect(db.paymentOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3, cursor: { id: FIRST }, skip: 1, orderBy: { createdAt: 'desc' },
      where: expect.objectContaining({ provider: 'qa-provider', status: 'paid' }),
      include: expect.objectContaining({ transactions: expect.any(Object), refunds: expect.any(Object) }),
    }));
    expect(page.count).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(SECOND);
    expect(page.items.map(item => item.id)).toEqual([FIRST, SECOND]);
    expect(page.items[0].amount).toBe(AMOUNT);
    expect(page.items[0].createdAt).toBe(NOW);
    expect(page.items[0].transactions[0].providerTransactionId).toBe('QA-TX-' + FIRST);
    expect(JSON.stringify(page)).not.toContain(CANARY);
    expect(JSON.stringify(rows)).toBe(original);
  });

  it('projects order detail and preserves both UUID and non-UUID order-number lookup', async () => {
    const db = readDb(), row = payment(), service = subject(db);
    db.paymentOrder.findFirst.mockResolvedValue(row);
    const dto = await service.getPaymentOrder(FIRST);
    expect(db.paymentOrder.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { OR: [{ id: FIRST }, { orderNo: FIRST }] },
    }));
    expect(dto.orderNo).toBe(row.orderNo);
    expect(dto.user?.email).toBe('finance.service@example.invalid');
    expect(dto.amount).toBe(AMOUNT);
    expect(JSON.stringify(dto)).not.toContain(CANARY);
    await service.getPaymentOrder('QA-ORDER-NUMBER');
    expect(db.paymentOrder.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { orderNo: 'QA-ORDER-NUMBER' },
    }));
  });

  it('projects refund page.items and nested orders while keeping financial reason and cursors', async () => {
    const db = readDb();
    db.refundTransaction.findMany.mockResolvedValue([refund(FIRST), refund(SECOND), refund(LOOKAHEAD)]);
    const page = await subject(db).getRefundTransactions({ take: '2', cursor: FIRST, status: 'requested' });
    expect(db.refundTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3, cursor: { id: FIRST }, skip: 1, orderBy: { createdAt: 'desc' },
      where: expect.objectContaining({ status: 'requested' }),
      include: expect.objectContaining({ paymentOrder: expect.any(Object) }),
    }));
    expect(page.count).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe(SECOND);
    expect(page.items[0].paymentOrder.orderNo).toBe('QA-ORDER-' + FIRST);
    expect(page.items[0].providerRefundId).toBe('QA-REFUND-' + FIRST);
    expect(page.items[0].reason).toBe('Accounting approved duplicate purchase refund.');
    expect('transactions' in page.items[0].paymentOrder).toBe(false);
    expect(JSON.stringify(page)).not.toContain(CANARY);
  });

  it('projects settlement record and embedded audit through the existing snapshot wire keys', async () => {
    const db = readDb();
    db.settlementRecord.findUnique.mockResolvedValue(record());
    const snapshot = { status: 'hold', settlementKey: KEY, settlementType: 'artist', period: '2026-10',
      amountKrw: '123456789012.34', reason: 'Period reconciliation pending.',
      note: 'External payout confirmation.', payoutReference: 'QA-PAYOUT',
      paidAt: null, paymentMethod: 'bank_transfer', updatedByUserId: USER,
      updatedAt: NOW.toISOString(), metadata: { unrelated: CANARY } };
    db.auditEvent.findMany.mockResolvedValue([{ id: SECOND, actorUserId: USER, actorType: 'admin',
      action: 'settlement.status.update', createdAt: NOW, beforeData: snapshot,
      afterData: { ...snapshot, status: 'ready' }, metadata: { unrelated: CANARY } }]);
    const dto = await subject(db).getBackstageSettlement(KEY);
    expect(db.settlementRecord.findUnique).toHaveBeenCalledWith({ where: { settlementKey: KEY } });
    expect(db.auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { targetType: 'settlement_record', targetId: FIRST },
      take: 20, orderBy: { createdAt: 'desc' },
      select: expect.objectContaining({ beforeData: true, afterData: true }),
    }));
    expect(dto.record?.settlementKey).toBe(KEY);
    expect(dto.record?.amountKrw).toBe(AMOUNT);
    expect(dto.record?.note).toBe(record().note);
    expect(dto.metadata).toEqual({});
    expect(dto.auditEvents[0].beforeData?.amountKrw).toBe('123456789012.34');
    expect(dto.auditEvents[0].afterData?.status).toBe('ready');
    expect(dto.auditEvents[0].createdAt).toBe(NOW);
    expect('before' in dto.auditEvents[0]).toBe(false);
    expect('after' in dto.auditEvents[0]).toBe(false);
    expect(JSON.stringify(dto)).not.toContain(CANARY);
    expect(dto.policy).toEqual({ manualOnly: true, moneyTransfer: false, auditEventLimit: 20 });
  });

  it('projects conversion READ directly, excludes the lookahead requester, and preserves summary/attribution', async () => {
    const db = readDb();
    db.settlementLuminaConversionRequest.findMany.mockResolvedValue([
      conversion(FIRST, USER), conversion(SECOND, USER_TWO), conversion(LOOKAHEAD, USER_LOOKAHEAD),
    ]);
    db.user.findMany.mockResolvedValue([requester(USER), requester(USER_TWO)]);
    db.settlementLuminaConversionRequest.groupBy.mockResolvedValue([{ status: 'approved', _count: { _all: 2 } }]);
    db.settlementLuminaConversionRequest.aggregate.mockResolvedValue({
      _sum: { amountKrw: AMOUNT, requestedLumina: new Decimal('246.90') },
    });
    const page = await subject(db).getBackstageSettlementConversions({
      take: '2', cursor: FIRST, status: 'approved', period: '2026-10', type: 'artist',
    });
    expect(db.settlementLuminaConversionRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 3, cursor: { id: FIRST }, skip: 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: expect.objectContaining({ status: 'approved', period: '2026-10', settlementType: 'artist' }),
    }));
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [USER, USER_TWO] } },
      select: expect.objectContaining({ profile: expect.objectContaining({ select: expect.objectContaining({ avatarAssetId: true }) }) }),
    }));
    expect(page.count).toBe(2);
    expect(page.nextCursor).toBe(SECOND);
    expect(page.hasMore).toBe(true);
    expect(page.items[0].requester?.email).toBe(requester(USER).email);
    expect(page.items[0].requester?.avatarAssetId).toBe(FIRST);
    expect(page.items[0].note).toBe(conversion().note);
    expect(page.items[0].amountKrw).toBe(AMOUNT);
    expect(page.summary.statusCounts).toEqual({ approved: 2 });
    expect(page.summary.totalAmountKrw).toBe(AMOUNT);
    expect(JSON.stringify(page)).not.toContain(CANARY);
  });

  it.each(pagedReads)('keeps the empty page contract for %s', async (_name, read) => {
    const db = readDb();
    const page = await read(subject(db), { take: '2' });
    expect(page.items).toEqual([]);
    expect(page.count).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it.each(pagedReads)('rejects invalid cursor/take before any read for %s', async (_name, read) => {
    const db = readDb(), service = subject(db);
    for (const query of [{ cursor: 'invalid-uuid' }, { take: 'not-a-number' }]) {
      await expect((async () => read(service, query))()).rejects.toBeInstanceOf(BadRequestException);
    }
    noReads(db);
  });

  it('rejects malformed settlement keys before record or audit reads', async () => {
    const db = readDb();
    await expect(subject(db).getBackstageSettlement('artist:not-uuid:2026/10')).rejects.toBeInstanceOf(BadRequestException);
    noReads(db);
  });

  it('rejects malformed conversion status/period/type before reads without inventing stricter lookup policy', async () => {
    const db = readDb(), service = subject(db);
    for (const query of [{ status: 'not-a-status' }, { period: '2026/10' }, { type: 'unknown-type' }]) {
      await expect(service.getBackstageSettlementConversions(query)).rejects.toBeInstanceOf(BadRequestException);
    }
    noReads(db);
  });

  it('keeps order not-found behavior on a read miss', async () => {
    const db = readDb();
    await expect(subject(db).getPaymentOrder(FIRST)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.paymentOrder.findFirst).toHaveBeenCalledTimes(1);
    expect(db.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('keeps settlement not-found behavior and does not read audit after a record miss', async () => {
    const db = readDb();
    await expect(subject(db).getBackstageSettlement(KEY)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.settlementRecord.findUnique).toHaveBeenCalledTimes(1);
    expect(db.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['payment list', (db: ReadDb) => db.paymentOrder.findMany, (service: AdminService) => service.getPaymentOrders({})],
    ['payment detail', (db: ReadDb) => db.paymentOrder.findFirst, (service: AdminService) => service.getPaymentOrder(FIRST)],
    ['refund list', (db: ReadDb) => db.refundTransaction.findMany, (service: AdminService) => service.getRefundTransactions({})],
    ['settlement detail', (db: ReadDb) => db.settlementRecord.findUnique, (service: AdminService) => service.getBackstageSettlement(KEY)],
    ['conversion list', (db: ReadDb) => db.settlementLuminaConversionRequest.findMany, (service: AdminService) => service.getBackstageSettlementConversions({})],
  ] as const)('propagates read errors without fake successful DTOs for %s', async (_name, stub, read) => {
    const db = readDb(), error = new Error('Synthetic finance read failure');
    stub(db).mockRejectedValue(error);
    await expect(read(subject(db))).rejects.toBe(error);
  });

  it('keeps the original mutation presenter contract separate without executing any mutation', () => {
    const db = readDb(), service = subject(db), row = conversion(), user = requester(USER);
    const dto = service['presentSettlementConversionForAdmin'](row, user);
    expect(dto.idempotencyKey).toBe(CANARY);
    expect(dto.metadata).toEqual({ arbitrary: CANARY });
    expect(dto.requester?.email).toBe(user.email);
    expect(dto.requester?.avatarAssetId).toBe(FIRST);
    expect(dto.walletLedgerId).toBeNull();
    expect(dto.amountKrw).toBe(AMOUNT);
    noReads(db);
  });
});

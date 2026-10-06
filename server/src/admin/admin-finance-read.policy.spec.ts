import { Decimal } from '@prisma/client/runtime/library';
import {
  projectAdminFinancePaymentOrder,
  projectAdminFinanceRefund,
  projectAdminFinanceSettlementAudit,
  projectAdminFinanceSettlementConversion,
  projectAdminFinanceSettlementRecord,
} from './admin-finance-read.policy';

const CANARY = 'QA_ARBITRARY_JSON_CANARY_20261006';
const WHEN = new Date('2026-10-06T08:00:00.123Z');
const AMOUNT = new Decimal('9999999999999999.99');
const SETTLEMENT_AMOUNT = new Decimal('999999999999.99');
const REASON = 'Approved partial refund: duplicate purchase.';
const NOTE = 'Accounting confirmed period totals; external payout pending.';
const EXTRA = Object.freeze({
  metadata: Object.freeze({ arbitrary: CANARY }),
  idempotencyKey: CANARY,
  retryCount: CANARY,
  passwordHash: CANARY,
  rawPayload: Object.freeze({ nested: Object.freeze({ token: CANARY }) }),
});

function payer() {
  return Object.freeze({ id: 'user-qa', email: 'finance.20261006@example.invalid',
    status: 'active', phoneNumber: CANARY, passwordHash: CANARY });
}

function product() {
  return Object.freeze({ id: 'product-qa', sku: 'qa-finance-product', name: 'QA Lumina',
    luminaAmount: AMOUNT, bonusAmount: new Decimal('0.00'), priceAmount: AMOUNT,
    priceCurrency: 'KRW', status: 'active', ...EXTRA });
}

function refundSummary() {
  return Object.freeze({ id: 'refund-qa', paymentOrderId: 'order-qa',
    providerRefundId: 'provider-refund-qa', amount: AMOUNT, reason: REASON,
    status: 'requested', createdAt: WHEN, updatedAt: WHEN, ...EXTRA });
}

function order() {
  return Object.freeze({ id: 'order-qa', userId: 'user-qa', luminaProductId: 'product-qa',
    orderNo: 'QA-20261006-ORDER', provider: 'qa-provider', status: 'paid', amount: AMOUNT,
    currency: 'KRW', createdAt: WHEN, updatedAt: WHEN, user: payer(), luminaProduct: product(),
    transactions: Object.freeze([Object.freeze({ id: 'transaction-qa', paymentOrderId: 'order-qa',
      provider: 'qa-provider', providerTransactionId: 'provider-transaction-qa',
      status: 'paid', createdAt: WHEN, ...EXTRA })]),
    refunds: Object.freeze([refundSummary()]), ...EXTRA });
}

function settlement() {
  return Object.freeze({ id: 'settlement-qa', settlementKey: 'artist:artist-qa:2026-10',
    settlementType: 'artist', period: '2026-10', status: 'hold', amountKrw: SETTLEMENT_AMOUNT,
    reason: REASON, note: NOTE, paidAt: WHEN, paymentMethod: 'bank_transfer',
    payoutReference: 'payout-reference-qa', updatedByUserId: 'admin-qa',
    createdAt: WHEN, updatedAt: WHEN, ...EXTRA });
}

function conversion() {
  return Object.freeze({ id: 'conversion-qa', requesterUserId: 'user-qa',
    settlementKey: 'artist:artist-qa:2026-10', settlementType: 'artist', period: '2026-10',
    targetArtistId: 'artist-qa', amountKrw: SETTLEMENT_AMOUNT, requestedLumina: AMOUNT,
    status: 'approved', note: NOTE, adminNote: REASON, walletLedgerId: 'ledger-qa',
    processedByUserId: 'admin-qa', processedAt: WHEN, createdAt: WHEN, updatedAt: WHEN, ...EXTRA });
}

describe('admin finance read boundary', () => {
  it('projects list/detail orders, product and payer with reconciliation identifiers and precision', () => {
    const dto = projectAdminFinancePaymentOrder(order());
    expect(Object.keys(dto)).toEqual(['id', 'userId', 'luminaProductId', 'orderNo', 'provider',
      'status', 'amount', 'currency', 'createdAt', 'updatedAt', 'user', 'luminaProduct', 'transactions', 'refunds']);
    expect(dto.amount).toBe(AMOUNT);
    expect(dto.amount.toFixed(2)).toBe('9999999999999999.99');
    expect(dto.luminaProduct?.priceAmount).toBe(AMOUNT);
    expect(dto.createdAt).toBe(WHEN);
    expect(dto.updatedAt).toBe(WHEN);
    expect(dto.user).toEqual({ id: 'user-qa', email: 'finance.20261006@example.invalid', status: 'active' });
    expect(dto.transactions[0]).toEqual({ id: 'transaction-qa', paymentOrderId: 'order-qa',
      provider: 'qa-provider', providerTransactionId: 'provider-transaction-qa', status: 'paid', createdAt: WHEN });
    expect(dto.refunds[0].providerRefundId).toBe('provider-refund-qa');
    expect(dto.refunds[0].reason).toBe(REASON);
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it('projects standalone refunds without exposing nested order internals or sibling transactions', () => {
    const source = Object.freeze({ ...refundSummary(), paymentOrder: order() });
    const dto = projectAdminFinanceRefund(source);
    expect(dto.amount).toBe(AMOUNT);
    expect(dto.reason).toBe(REASON);
    expect(dto.providerRefundId).toBe('provider-refund-qa');
    expect(dto.paymentOrder.orderNo).toBe('QA-20261006-ORDER');
    expect(dto.paymentOrder.luminaProduct?.sku).toBe('qa-finance-product');
    expect(dto.paymentOrder.user?.email).toBe('finance.20261006@example.invalid');
    expect('transactions' in dto.paymentOrder).toBe(false);
    expect('refunds' in dto.paymentOrder).toBe(false);
    expect('idempotencyKey' in dto.paymentOrder).toBe(false);
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it('preserves nullable payment relations, email, refund identifier/reason and empty arrays', () => {
    const dto = projectAdminFinancePaymentOrder({ ...order(), user: null, luminaProduct: null,
      transactions: [], refunds: [] });
    expect(dto.user).toBeNull();
    expect(dto.luminaProduct).toBeNull();
    expect(dto.transactions).toEqual([]);
    expect(dto.refunds).toEqual([]);
    const refund = projectAdminFinanceRefund({ ...refundSummary(), providerRefundId: null, reason: null,
      paymentOrder: { ...order(), user: { ...payer(), email: null } } });
    expect(refund.providerRefundId).toBeNull();
    expect(refund.reason).toBeNull();
    expect(refund.paymentOrder.user?.email).toBeNull();
  });

  it('keeps the existing safe settlement summary and legitimate reason/note, never metadata', () => {
    const dto = projectAdminFinanceSettlementRecord(settlement());
    expect(dto?.amountKrw).toBe(SETTLEMENT_AMOUNT);
    expect(dto?.amountKrw?.toFixed(2)).toBe('999999999999.99');
    expect(dto?.reason).toBe(REASON);
    expect(dto?.note).toBe(NOTE);
    expect(dto?.payoutReference).toBe('payout-reference-qa');
    expect(dto?.updatedByUserId).toBe('admin-qa');
    expect(dto?.paidAt).toBe(WHEN);
    expect(dto && 'metadata' in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it('preserves nullable settlement fields and absent records', () => {
    expect(projectAdminFinanceSettlementRecord(null)).toBeNull();
    expect(projectAdminFinanceSettlementRecord(undefined)).toBeNull();
    const dto = projectAdminFinanceSettlementRecord({ ...settlement(), amountKrw: null, reason: null,
      note: null, paidAt: null, paymentMethod: null, payoutReference: null, updatedByUserId: null });
    expect(dto?.amountKrw).toBeNull();
    expect(dto?.paidAt).toBeNull();
    expect(dto?.reason).toBeNull();
    expect(dto?.note).toBeNull();
    expect(dto?.payoutReference).toBeNull();
  });

  it('projects local audit headers and narrow before/after financial states, dropping raw JSON', () => {
    const snapshot = Object.freeze({ ...settlement(), amountKrw: '999999999999.99',
      paidAt: WHEN.toISOString(), updatedAt: WHEN.toISOString(),
      beforeData: { unrelated: CANARY }, afterData: { manuscript: CANARY } });
    const source = Object.freeze({ id: 'audit-qa', actorUserId: 'admin-qa', actorType: 'admin',
      action: 'settlement.status.update', createdAt: WHEN, beforeData: snapshot,
      afterData: Object.freeze({ ...snapshot, status: 'paid' }), ...EXTRA });
    const dto = projectAdminFinanceSettlementAudit(source);
    expect(Object.keys(dto)).toEqual(['id', 'actorUserId', 'actorType', 'action', 'createdAt', 'beforeData', 'afterData']);
    expect(dto.actorUserId).toBe('admin-qa');
    expect(dto.createdAt).toBe(WHEN);
    expect(dto.beforeData?.amountKrw).toBe('999999999999.99');
    expect(dto.beforeData?.status).toBe('hold');
    expect(dto.afterData?.status).toBe('paid');
    expect(dto.afterData?.reason).toBe(REASON);
    expect(dto.afterData?.note).toBe(NOTE);
    expect(dto.afterData?.payoutReference).toBe('payout-reference-qa');
    expect(dto.afterData?.updatedAt).toBe(WHEN.toISOString());
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it.each([null, undefined, [], 'not-a-snapshot', false])(
    'does not treat malformed/absent audit snapshots as arbitrary objects: %p', value => {
      const dto = projectAdminFinanceSettlementAudit({ id: 'audit-qa', actorUserId: null,
        actorType: 'admin', action: 'settlement.status.update', createdAt: WHEN,
        beforeData: value, afterData: value });
      expect(dto.actorUserId).toBeNull();
      expect(dto.beforeData).toBeNull();
      expect(dto.afterData).toBeNull();
    });

  it('rejects object-valued/nonnumeric audit amounts and invalid timestamps without coercion', () => {
    const dto = projectAdminFinanceSettlementAudit({ id: 'audit-qa', actorUserId: null,
      actorType: 'admin', action: 'settlement.status.update', createdAt: WHEN,
      beforeData: { amountKrw: { toString: () => CANARY }, reason: { private: CANARY },
        paidAt: CANARY, updatedAt: 'invalid-date' },
      afterData: { amountKrw: 'private-payload', status: { internal: CANARY } } });
    expect(dto.beforeData?.amountKrw).toBeNull();
    expect(dto.beforeData?.reason).toBeNull();
    expect(dto.beforeData?.paidAt).toBeNull();
    expect(dto.beforeData?.updatedAt).toBeNull();
    expect(dto.afterData?.amountKrw).toBeNull();
    expect(dto.afterData?.status).toBeNull();
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it('keeps finite zero audit amounts and rejects non-finite numbers', () => {
    const common = { id: 'audit-qa', actorUserId: null, actorType: 'admin',
      action: 'settlement.status.update', createdAt: WHEN };
    expect(projectAdminFinanceSettlementAudit({ ...common, beforeData: { amountKrw: 0 } }).beforeData?.amountKrw).toBe(0);
    expect(projectAdminFinanceSettlementAudit({ ...common, beforeData: { amountKrw: Infinity } }).beforeData?.amountKrw).toBeNull();
    expect(projectAdminFinanceSettlementAudit({ ...common, beforeData: { amountKrw: NaN } }).beforeData?.amountKrw).toBeNull();
  });

  it('keeps conversion attribution, amounts, financial notes and processing references', () => {
    const requester = Object.freeze({ ...payer(), profile: Object.freeze({
      displayName: 'QA Accounting Requester', publicHandle: 'qa-finance', avatarAssetId: 'avatar-qa', ...EXTRA }) });
    const dto = projectAdminFinanceSettlementConversion(conversion(), requester);
    expect(dto.amountKrw).toBe(SETTLEMENT_AMOUNT);
    expect(dto.requestedLumina).toBe(AMOUNT);
    expect(dto.requestedLumina.toFixed(2)).toBe('9999999999999999.99');
    expect(dto.walletLedgerId).toBe('ledger-qa');
    expect(dto.processedByUserId).toBe('admin-qa');
    expect(dto.processedAt).toBe(WHEN);
    expect(dto.note).toBe(NOTE);
    expect(dto.adminNote).toBe(REASON);
    expect(dto.requester?.displayName).toBe('QA Accounting Requester');
    expect(dto.requester?.publicHandle).toBe('qa-finance');
    expect(dto.requester?.avatarAssetId).toBe('avatar-qa');
    expect(dto.requester?.email).toBe('finance.20261006@example.invalid');
    expect(JSON.stringify(dto)).not.toContain(CANARY);
  });

  it('keeps nullable conversion attribution and processing fields without fallback raw data', () => {
    const source = { ...conversion(), targetArtistId: null, walletLedgerId: null,
      processedByUserId: null, processedAt: null, note: null, adminNote: null };
    expect(projectAdminFinanceSettlementConversion(source).requester).toBeNull();
    expect(projectAdminFinanceSettlementConversion(source, null).requester).toBeNull();
    const dto = projectAdminFinanceSettlementConversion(source, { ...payer(), email: null, profile: null });
    expect(dto.processedAt).toBeNull();
    expect(dto.walletLedgerId).toBeNull();
    expect(dto.note).toBeNull();
    expect(dto.requester?.email).toBeNull();
    expect(dto.requester?.displayName).toBeNull();
    expect(dto.requester?.publicHandle).toBeNull();
    expect(dto.requester?.avatarAssetId).toBeNull();
  });

  it('does not mutate frozen rows/relations/arrays or convert Decimal and Date values', () => {
    const payment = order(), record = settlement(), request = conversion();
    const snapshot = JSON.stringify([payment, record, request]);
    const paymentDto = projectAdminFinancePaymentOrder(payment);
    projectAdminFinanceRefund({ ...refundSummary(), paymentOrder: payment });
    projectAdminFinanceSettlementRecord(record);
    projectAdminFinanceSettlementConversion(request);
    expect(JSON.stringify([payment, record, request])).toBe(snapshot);
    expect(paymentDto).not.toBe(payment);
    expect(paymentDto.transactions).not.toBe(payment.transactions);
    expect(paymentDto.refunds).not.toBe(payment.refunds);
    expect(paymentDto.user).not.toBe(payment.user);
    expect(paymentDto.luminaProduct).not.toBe(payment.luminaProduct);
    expect(paymentDto.amount).toBe(payment.amount);
    expect(paymentDto.createdAt).toBe(payment.createdAt);
  });

  it('preserves already-serialized amount and timestamp strings without numeric rounding', () => {
    const dto = projectAdminFinanceSettlementRecord({ ...settlement(), amountKrw: '999999999999.99',
      createdAt: WHEN.toISOString(), updatedAt: WHEN.toISOString(), paidAt: null });
    expect(dto?.amountKrw).toBe('999999999999.99');
    expect(dto?.createdAt).toBe(WHEN.toISOString());
  });
});

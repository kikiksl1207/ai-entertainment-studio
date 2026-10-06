export type AdminFinanceAmount = string | number | { toString(): string };
export type AdminFinanceTimestamp = Date | string;

interface FinancePayer {
  readonly id: string;
  readonly email: string | null;
  readonly status: string;
}

interface FinanceProduct<A> {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly luminaAmount: A;
  readonly bonusAmount: A;
  readonly priceAmount: A;
  readonly priceCurrency: string;
  readonly status: string;
}

interface FinanceOrderSummary<A, T> {
  readonly id: string;
  readonly userId: string;
  readonly luminaProductId: string;
  readonly orderNo: string;
  readonly provider: string;
  readonly status: string;
  readonly amount: A;
  readonly currency: string;
  readonly createdAt: T;
  readonly updatedAt: T;
  readonly user: FinancePayer | null;
  readonly luminaProduct: FinanceProduct<A> | null;
}

interface FinancePaymentTransaction<T> {
  readonly id: string;
  readonly paymentOrderId: string;
  readonly provider: string;
  readonly providerTransactionId: string;
  readonly status: string;
  readonly createdAt: T;
}

interface FinanceRefundSummary<A, T> {
  readonly id: string;
  readonly paymentOrderId: string;
  readonly providerRefundId: string | null;
  readonly amount: A;
  readonly reason: string | null;
  readonly status: string;
  readonly createdAt: T;
  readonly updatedAt: T;
}

export interface AdminFinancePaymentOrderInput<A, T> extends FinanceOrderSummary<A, T> {
  readonly transactions: readonly FinancePaymentTransaction<T>[];
  readonly refunds: readonly FinanceRefundSummary<A, T>[];
}

export interface AdminFinanceRefundInput<A, T> extends FinanceRefundSummary<A, T> {
  readonly paymentOrder: FinanceOrderSummary<A, T>;
}

export interface AdminFinanceSettlementRecordInput<A, T> {
  readonly id: string;
  readonly settlementKey: string;
  readonly settlementType: string;
  readonly period: string;
  readonly status: string;
  readonly amountKrw: A | null;
  readonly reason: string | null;
  readonly note: string | null;
  readonly paidAt: T | null;
  readonly paymentMethod: string | null;
  readonly payoutReference: string | null;
  readonly updatedByUserId: string | null;
  readonly updatedAt: T;
  readonly createdAt: T;
}

export interface AdminFinanceSettlementAuditInput<T> {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorType: string;
  readonly action: string;
  readonly createdAt: T;
  readonly beforeData?: unknown;
  readonly afterData?: unknown;
}

export interface AdminFinanceConversionInput<A, T> {
  readonly id: string;
  readonly requesterUserId: string;
  readonly settlementKey: string;
  readonly settlementType: string;
  readonly period: string;
  readonly targetArtistId: string | null;
  readonly amountKrw: A;
  readonly requestedLumina: A;
  readonly status: string;
  readonly note: string | null;
  readonly adminNote: string | null;
  readonly walletLedgerId: string | null;
  readonly processedByUserId: string | null;
  readonly processedAt: T | null;
  readonly createdAt: T;
  readonly updatedAt: T;
}

export interface AdminFinanceConversionRequester extends FinancePayer {
  readonly profile: {
    readonly displayName: string | null;
    readonly publicHandle: string | null;
    readonly avatarAssetId: string | null;
  } | null;
}

function projectPayer(user: FinancePayer | null) {
  return user ? { id: user.id, email: user.email, status: user.status } : null;
}

function projectOrderSummary<A, T>(order: FinanceOrderSummary<A, T>) {
  const product = order.luminaProduct;
  return {
    id: order.id,
    userId: order.userId,
    luminaProductId: order.luminaProductId,
    orderNo: order.orderNo,
    provider: order.provider,
    status: order.status,
    amount: order.amount,
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    user: projectPayer(order.user),
    luminaProduct: product ? {
      id: product.id,
      sku: product.sku,
      name: product.name,
      luminaAmount: product.luminaAmount,
      bonusAmount: product.bonusAmount,
      priceAmount: product.priceAmount,
      priceCurrency: product.priceCurrency,
      status: product.status,
    } : null,
  };
}

function projectRefundSummary<A, T>(refund: FinanceRefundSummary<A, T>) {
  return {
    id: refund.id,
    paymentOrderId: refund.paymentOrderId,
    providerRefundId: refund.providerRefundId,
    amount: refund.amount,
    reason: refund.reason,
    status: refund.status,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
  };
}

export function projectAdminFinancePaymentOrder<
  A extends AdminFinanceAmount, T extends AdminFinanceTimestamp,
>(order: AdminFinancePaymentOrderInput<A, T>) {
  return {
    ...projectOrderSummary(order),
    transactions: order.transactions.map(transaction => ({
      id: transaction.id,
      paymentOrderId: transaction.paymentOrderId,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      status: transaction.status,
      createdAt: transaction.createdAt,
    })),
    refunds: order.refunds.map(projectRefundSummary),
  };
}

export function projectAdminFinanceRefund<
  A extends AdminFinanceAmount, T extends AdminFinanceTimestamp,
>(refund: AdminFinanceRefundInput<A, T>) {
  return {
    ...projectRefundSummary(refund),
    paymentOrder: projectOrderSummary(refund.paymentOrder),
  };
}

export function projectAdminFinanceSettlementRecord<
  A extends AdminFinanceAmount, T extends AdminFinanceTimestamp,
>(record: AdminFinanceSettlementRecordInput<A, T> | null | undefined) {
  if (!record) return null;
  return {
    id: record.id,
    settlementKey: record.settlementKey,
    settlementType: record.settlementType,
    period: record.period,
    status: record.status,
    amountKrw: record.amountKrw,
    reason: record.reason,
    note: record.note,
    paidAt: record.paidAt,
    paymentMethod: record.paymentMethod,
    payoutReference: record.payoutReference,
    updatedByUserId: record.updatedByUserId,
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
  };
}

function historyText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function historyAmount(value: unknown): string | number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? value : null;
}

function historyTimestamp(value: unknown): string | null {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}

// Historical JSON snapshots are a separate scalar-only boundary, never whole records.
function projectSettlementHistoryState(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  return {
    settlementKey: historyText(state.settlementKey),
    settlementType: historyText(state.settlementType),
    period: historyText(state.period),
    status: historyText(state.status),
    amountKrw: historyAmount(state.amountKrw),
    reason: historyText(state.reason),
    note: historyText(state.note),
    paidAt: historyTimestamp(state.paidAt),
    paymentMethod: historyText(state.paymentMethod),
    payoutReference: historyText(state.payoutReference),
    updatedByUserId: historyText(state.updatedByUserId),
    updatedAt: historyTimestamp(state.updatedAt),
  };
}

export function projectAdminFinanceSettlementAudit<T extends AdminFinanceTimestamp>(
  event: AdminFinanceSettlementAuditInput<T>,
) {
  return {
    id: event.id,
    actorUserId: event.actorUserId,
    actorType: event.actorType,
    action: event.action,
    createdAt: event.createdAt,
    beforeData: projectSettlementHistoryState(event.beforeData),
    afterData: projectSettlementHistoryState(event.afterData),
  };
}

export function projectAdminFinanceSettlementConversion<
  A extends AdminFinanceAmount, T extends AdminFinanceTimestamp,
>(
  row: AdminFinanceConversionInput<A, T>,
  requester?: AdminFinanceConversionRequester | null,
) {
  return {
    id: row.id,
    requesterUserId: row.requesterUserId,
    requester: requester ? {
      id: requester.id,
      email: requester.email,
      status: requester.status,
      displayName: requester.profile?.displayName ?? null,
      publicHandle: requester.profile?.publicHandle ?? null,
      avatarAssetId: requester.profile?.avatarAssetId ?? null,
    } : null,
    settlementKey: row.settlementKey,
    settlementType: row.settlementType,
    period: row.period,
    targetArtistId: row.targetArtistId,
    amountKrw: row.amountKrw,
    requestedLumina: row.requestedLumina,
    status: row.status,
    note: row.note,
    adminNote: row.adminNote,
    walletLedgerId: row.walletLedgerId,
    processedByUserId: row.processedByUserId,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

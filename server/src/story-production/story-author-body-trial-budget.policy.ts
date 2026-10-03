import { isUUID } from 'class-validator';

export interface AuthorBodyTrialContinuationCost {
  id: string;
  userId: string;
  workId: string;
  requestKind: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  dispatchStartedAt: Date | null;
  estimatedCostKrw: string;
  hardBudgetKrw: string;
  actualCostKrw: string | null;
  sharedResultReused: boolean;
  sharedResultEvidenceVerified: boolean;
  confirmedNoProviderDispatch?: boolean;
  sharedResultId: string | null;
  resultGeneratedSceneId: string | null;
}

export interface AuthorBodyTrialLedgerCost {
  id: string;
  continuationId: string;
  userId: string;
  workId: string;
  eventKind: string;
  status: string;
  provenance: string;
  estimatedCostKrw: string;
  actualCostKrw: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  imageUnits: number;
}

export interface AuthorBodyTrialCostSnapshot {
  userId: string;
  workId: string;
  complete: boolean;
  continuations: AuthorBodyTrialContinuationCost[];
  ledger: AuthorBodyTrialLedgerCost[];
}

export class StoryAuthorBodyTrialBudgetError extends Error {
  constructor() {
    super('Story author body trial cost evidence is unavailable');
    this.name = 'StoryAuthorBodyTrialBudgetError';
  }
}

const SCALE = 1_000_000n;
const pendingStatuses = new Set(['queued', 'processing', 'retry_wait']);
const terminalStatuses = new Set(['completed', 'failed', 'timeout']);
const finalEvents: Record<string, string> = {
  completed: 'new_route_completed', failed: 'new_route_failed', timeout: 'new_route_timeout',
};

function invalid(): never { throw new StoryAuthorBodyTrialBudgetError(); }

function money(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}

function formatMoney(value: bigint): string {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(6, '0')}`;
}

function zeroUsage(row: AuthorBodyTrialLedgerCost) {
  return row.inputTokens === 0 && row.outputTokens === 0 && row.cachedInputTokens === 0 && row.imageUnits === 0;
}

export function summarizeAuthorBodyTrialCosts(snapshot: AuthorBodyTrialCostSnapshot) {
  if (!snapshot || snapshot.complete !== true || !isUUID(snapshot.userId) || !isUUID(snapshot.workId) ||
      !Array.isArray(snapshot.continuations) || !Array.isArray(snapshot.ledger) ||
      snapshot.continuations.length > 1000 || snapshot.ledger.length > 6000) invalid();
  const requests = new Map<string, AuthorBodyTrialContinuationCost>();
  for (const row of snapshot.continuations) {
    if (!row || !isUUID(row.id) || requests.has(row.id) || row.userId !== snapshot.userId ||
        row.workId !== snapshot.workId || row.requestKind !== 'recommended_choice' ||
        (!pendingStatuses.has(row.status) && !terminalStatuses.has(row.status)) ||
        !Number.isSafeInteger(row.attemptCount) || row.attemptCount < 0 ||
        !Number.isSafeInteger(row.maxAttempts) || row.maxAttempts < 1 || row.maxAttempts > 3 ||
        row.attemptCount > row.maxAttempts || typeof row.sharedResultReused !== 'boolean' ||
        typeof row.sharedResultEvidenceVerified !== 'boolean' ||
        (row.confirmedNoProviderDispatch !== undefined && typeof row.confirmedNoProviderDispatch !== 'boolean') ||
        (row.dispatchStartedAt !== null && (!(row.dispatchStartedAt instanceof Date) ||
          !Number.isFinite(row.dispatchStartedAt.getTime()))) ||
        (row.sharedResultId !== null && !isUUID(row.sharedResultId)) ||
        (row.resultGeneratedSceneId !== null && !isUUID(row.resultGeneratedSceneId))) invalid();
    const estimate = money(row.estimatedCostKrw), maximum = money(row.hardBudgetKrw);
    if (maximum === 0n || estimate > maximum) invalid();
    if (row.actualCostKrw !== null) money(row.actualCostKrw);
    requests.set(row.id, row);
  }
  const rowsByRequest = new Map<string, AuthorBodyTrialLedgerCost[]>();
  const ledgerIds = new Set<string>();
  for (const row of snapshot.ledger) {
    if (!row || !isUUID(row.id) || ledgerIds.has(row.id) || !requests.has(row.continuationId) ||
        row.userId !== snapshot.userId || row.workId !== snapshot.workId ||
        !['recommended_route_request', 'shared_route_reused', 'approved_compensation', ...Object.values(finalEvents)]
          .includes(row.eventKind) ||
        [row.inputTokens, row.outputTokens, row.cachedInputTokens, row.imageUnits]
          .some(value => !Number.isSafeInteger(value) || value < 0) || row.cachedInputTokens > row.inputTokens) invalid();
    money(row.estimatedCostKrw);
    if (row.actualCostKrw !== null) money(row.actualCostKrw);
    if (row.eventKind === 'approved_compensation') {
      if (row.status !== 'compensated' || row.provenance !== 'ai_generated') invalid();
    } else if (row.eventKind === 'recommended_route_request') {
      if (row.status !== 'reserved' || row.provenance !== 'ai_generated' || row.actualCostKrw !== null) invalid();
    } else if (row.eventKind === 'shared_route_reused') {
      if (row.status !== 'completed' || row.provenance !== 'ai_reused') invalid();
    } else if (finalEvents[row.status] !== row.eventKind || row.provenance !== 'ai_generated') invalid();
    ledgerIds.add(row.id);
    rowsByRequest.set(row.continuationId, [...(rowsByRequest.get(row.continuationId) ?? []), row]);
  }

  let actual = 0n, reserved = 0n, pendingCount = 0, unknownCostCount = 0, verifiedSharedReuseCount = 0;
  for (const row of requests.values()) {
    const ledger = rowsByRequest.get(row.id) ?? [];
    const reservations = ledger.filter(item => item.eventKind === 'recommended_route_request');
    const settlements = ledger.filter(item => Object.values(finalEvents).includes(item.eventKind));
    const reuse = ledger.filter(item => item.eventKind === 'shared_route_reused');
    if (reservations.length > 1 || settlements.length > 1 || reuse.length > 1 ||
        (reuse.length > 0 && (reservations.length > 0 || settlements.length > 0))) invalid();
    if (reservations.some(item => money(item.estimatedCostKrw) !== money(row.estimatedCostKrw)) ||
        settlements.some(item => item.status !== row.status ||
          (item.actualCostKrw === null) !== (row.actualCostKrw === null) ||
          (item.actualCostKrw !== null && money(item.actualCostKrw) !== money(row.actualCostKrw!)))) invalid();

    if (row.sharedResultReused || reuse.length > 0) {
      const proof = reuse[0];
      if (row.status === 'completed' && row.sharedResultReused && row.sharedResultEvidenceVerified &&
          row.sharedResultId && row.resultGeneratedSceneId &&
          row.attemptCount === 0 && row.dispatchStartedAt === null && row.actualCostKrw !== null &&
          money(row.actualCostKrw) === 0n && money(row.estimatedCostKrw) === 0n && proof &&
          proof.actualCostKrw !== null && money(proof.actualCostKrw) === 0n &&
          money(proof.estimatedCostKrw) === 0n && zeroUsage(proof) && ledger.length === 1) {
        verifiedSharedReuseCount++;
        continue;
      }
      // A reuse flag alone is not evidence that no paid provider request occurred.
      if (row.actualCostKrw !== null) actual += money(row.actualCostKrw);
      unknownCostCount++;
      continue;
    }
    if (pendingStatuses.has(row.status)) {
      if (row.actualCostKrw !== null || settlements.length > 0) invalid();
      pendingCount++;
      reserved += money(row.hardBudgetKrw) * BigInt(row.maxAttempts);
      if (reservations.length !== 1 || row.attemptCount > 1) unknownCostCount++;
      continue;
    }
    if (row.confirmedNoProviderDispatch && row.status === 'failed' && row.attemptCount === 1 &&
      row.dispatchStartedAt === null && row.actualCostKrw !== null && money(row.actualCostKrw) === 0n &&
      reservations.length === 1 && settlements.length === 1 && settlements[0].actualCostKrw !== null &&
      money(settlements[0].actualCostKrw) === 0n && zeroUsage(settlements[0])) continue;
    if (row.actualCostKrw !== null) actual += money(row.actualCostKrw);
    if (row.actualCostKrw === null || reservations.length !== 1 || settlements.length !== 1 ||
        row.attemptCount !== 1 || row.dispatchStartedAt === null) unknownCostCount++;
    // Compensation restores an allowance, not a provider payment; it never subtracts cost.
  }
  return {
    knownActualCostKrw: formatMoney(actual), reservedMaximumCostKrw: formatMoney(reserved),
    committedCostKrw: formatMoney(actual + reserved), requestCount: requests.size,
    pendingCount, unknownCostCount, verifiedSharedReuseCount,
  };
}

export function evaluateAuthorBodyTrialBudget(
  snapshot: AuthorBodyTrialCostSnapshot, approvedBudgetKrw: string, nextMaximumCostKrw: string,
) {
  const cap = money(approvedBudgetKrw), next = money(nextMaximumCostKrw);
  if (cap === 0n || next === 0n) invalid();
  const costs = summarizeAuthorBodyTrialCosts(snapshot);
  const committed = money(costs.committedCostKrw);
  const maximumAfterReservation = committed + next;
  const reason = costs.unknownCostCount > 0 ? 'unknown_cost' as const :
    maximumAfterReservation > cap ? 'budget_exceeded' as const : 'within_budget' as const;
  return { ...costs, mayReserve: reason === 'within_budget', reason,
    remainingBudgetKrw: formatMoney(committed < cap ? cap - committed : 0n),
    maximumAfterReservationKrw: formatMoney(maximumAfterReservation) };
}

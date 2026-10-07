import type { StoryAuthorBodyTrialApproval } from '@prisma/client';
import { isUUID } from 'class-validator';
import { createHash } from 'crypto';
import {
  summarizeApprovedAuthorBodyTrialCosts,
  summarizeAuthorBodyTrialCosts,
  type AuthorBodyTrialCostSnapshot,
} from './story-author-body-trial-budget.policy';

export const AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW = 300;
const SCALE = 1_000_000n;
const ORIGINAL_MAXIMUM_KRW = 10_000n * SCALE;
const APPROVAL_KEYS = [
  'id', 'userId', 'workId', 'releaseId', 'manuscriptVersionId', 'releaseChecksum',
  'capabilityRevision', 'styleConsentId', 'styleConsentRevision', 'analysisJobId',
  'analysisVersion', 'generationProfileId', 'generationProfileRevision',
  'generationProfileFingerprint', 'approvedBudgetKrw', 'approvalReference',
  'status', 'createdAt', 'expiresAt',
] as const;

export type AuthorBodyTrialUnknownHoldApproval =
  Omit<Pick<StoryAuthorBodyTrialApproval, typeof APPROVAL_KEYS[number]>, 'approvedBudgetKrw'> &
  { approvedBudgetKrw: string };

// These are existing server-verified records, not caller assertions or approval creators.
export interface AuthorBodyTrialUnknownHoldAcknowledgement {
  id: string;
  trialApprovalId: string;
  userId: string;
  workId: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  originalApprovedBudgetKrw: string;
  maximumTotalHoldKrw: number;
  provisionalHoldOnly: boolean;
  unknownCostRemainsUnknown: boolean;
  notProviderChargeOrLiabilityCeiling: boolean;
}

export interface AuthorBodyTrialUnknownHold {
  id: string;
  continuationId: string;
  idempotencyKey: string;
  acknowledgementId: string;
  unknownEvidenceSha256: string;
  amountKrw: number;
  status: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthorBodyTrialUnknownHoldInput {
  now: Date;
  snapshot: AuthorBodyTrialCostSnapshot;
  approval: AuthorBodyTrialUnknownHoldApproval;
  currentAuthorization: {
    verified: boolean;
    checkedAt: Date;
    approval: AuthorBodyTrialUnknownHoldApproval;
  };
  acknowledgement: AuthorBodyTrialUnknownHoldAcknowledgement;
  holdsComplete: boolean;
  existingHolds: AuthorBodyTrialUnknownHold[];
  requestedHold?: AuthorBodyTrialUnknownHold;
  // Zero checks existing commitments only; it never permits a new reservation.
  nextMaximumCostKrw: string;
}

export class StoryAuthorBodyTrialUnknownHoldError extends Error {
  constructor() {
    super('Story author body trial provisional hold evidence is unavailable');
    this.name = 'StoryAuthorBodyTrialUnknownHoldError';
  }
}

function invalid(): never { throw new StoryAuthorBodyTrialUnknownHoldError(); }
function uuid(value: string) { return typeof value === 'string' && value === value.toLowerCase() && isUUID(value); }
function hash(value: string) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function time(value: Date): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) invalid();
  return value.getTime();
}
function positiveInteger(value: number, maximum: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function money(value: string): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(value)) invalid();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
}
function formatMoney(value: bigint) {
  return `${value / SCALE}.${(value % SCALE).toString().padStart(6, '0')}`;
}

function validateApproval(approval: AuthorBodyTrialUnknownHoldApproval, now: number) {
  if (!approval || ![approval.id, approval.userId, approval.workId, approval.releaseId,
    approval.manuscriptVersionId, approval.styleConsentId, approval.analysisJobId].every(uuid) ||
    !hash(approval.releaseChecksum) || approval.status !== 'active' ||
    ![approval.capabilityRevision, approval.styleConsentRevision, approval.analysisVersion]
      .every(value => positiveInteger(value, 2_147_483_647)) ||
    typeof approval.approvalReference !== 'string' || approval.approvalReference.length < 1 ||
    approval.approvalReference.length > 128 || time(approval.createdAt) > now ||
    time(approval.expiresAt) <= now || time(approval.expiresAt) <= time(approval.createdAt)) invalid();
  const cap = money(approval.approvedBudgetKrw);
  if (cap === 0n || cap > ORIGINAL_MAXIMUM_KRW) invalid();
  if (approval.generationProfileId === null) {
    if (approval.generationProfileRevision !== null || approval.generationProfileFingerprint !== null) invalid();
  } else if (!uuid(approval.generationProfileId) ||
    !positiveInteger(approval.generationProfileRevision!, 2_147_483_647) ||
    !hash(approval.generationProfileFingerprint!)) invalid();
  return cap;
}

function approvalPins(approval: AuthorBodyTrialUnknownHoldApproval) {
  return JSON.stringify(APPROVAL_KEYS.map(key => key === 'approvedBudgetKrw'
    ? formatMoney(money(approval[key])) : approval[key]));
}

function unknownEvidence(snapshot: AuthorBodyTrialCostSnapshot, continuationId: string) {
  if (!uuid(continuationId)) invalid();
  const row = snapshot.continuations.find(item => item.id === continuationId);
  if (!row || !['failed', 'timeout'].includes(row.status) || row.actualCostKrw !== null ||
    row.attemptCount !== 1 || row.maxAttempts !== 1 || row.dispatchStartedAt === null ||
    row.sharedResultReused || row.sharedResultEvidenceVerified || row.confirmedNoProviderDispatch ||
    row.sharedResultId !== null || row.resultGeneratedSceneId !== null ||
    !uuid(row.authorBodyTrialApprovalId!)) invalid();
  if (time(row.dispatchStartedAt) < time(row.createdAt!)) invalid();
  const ledger = snapshot.ledger.filter(item => item.continuationId === row.id);
  if (ledger.length !== 2 ||
    ledger.filter(item => item.eventKind === 'recommended_route_request').length !== 1 ||
    ledger.filter(item => item.eventKind === (row.status === 'failed' ? 'new_route_failed' : 'new_route_timeout')).length !== 1 ||
    summarizeAuthorBodyTrialCosts({ ...snapshot, continuations: [row], ledger }).unknownCostCount !== 1) invalid();
  const digest = createHash('sha256').update(JSON.stringify({
    userId: snapshot.userId, workId: snapshot.workId,
    row: [row.id, row.requestKind, row.status, row.attemptCount, row.maxAttempts,
      row.dispatchStartedAt, formatMoney(money(row.estimatedCostKrw)), formatMoney(money(row.hardBudgetKrw)),
      row.actualCostKrw, row.sharedResultReused, row.sharedResultEvidenceVerified,
      row.confirmedNoProviderDispatch ?? false, row.sharedResultId, row.resultGeneratedSceneId,
      row.createdAt, row.authorBodyTrialApprovalId],
    ledger: [...ledger].sort((a, b) => a.id.localeCompare(b.id)).map(item => [
      item.id, item.continuationId, item.userId, item.workId, item.eventKind, item.status,
      item.provenance, formatMoney(money(item.estimatedCostKrw)), item.actualCostKrw,
      item.inputTokens, item.outputTokens, item.cachedInputTokens, item.imageUnits,
    ]),
  })).digest('hex');
  return { row, digest };
}

// Evidence fingerprint only; this does not create an acknowledgement, hold or authorization.
export function authorBodyTrialUnknownHoldEvidenceSha256(snapshot: AuthorBodyTrialCostSnapshot, continuationId: string) {
  summarizeAuthorBodyTrialCosts(snapshot);
  return unknownEvidence(snapshot, continuationId).digest;
}

function holdIdentity(hold: AuthorBodyTrialUnknownHold) {
  return JSON.stringify([hold.id, hold.continuationId, hold.idempotencyKey, hold.acknowledgementId,
    hold.unknownEvidenceSha256, hold.amountKrw, hold.status, hold.createdAt, hold.expiresAt]);
}

// Call only inside the existing serialized authorization/reservation transaction.
// mayReserve is budget arithmetic, never a dispatch grant or a bound on provider liability.
export function evaluateAuthorBodyTrialUnknownHolds(input: AuthorBodyTrialUnknownHoldInput) {
  if (!input || !input.snapshot || !input.currentAuthorization || !input.acknowledgement ||
    input.holdsComplete !== true || !Array.isArray(input.existingHolds) ||
    input.existingHolds.length > AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW) invalid();
  const now = time(input.now), cap = validateApproval(input.approval, now);
  validateApproval(input.currentAuthorization.approval, now);
  if (input.currentAuthorization.verified !== true || time(input.currentAuthorization.checkedAt) !== now ||
    approvalPins(input.currentAuthorization.approval) !== approvalPins(input.approval) ||
    input.snapshot.userId !== input.approval.userId || input.snapshot.workId !== input.approval.workId) invalid();
  // Reuse the existing exact historical-pair check; never generate a new past exclusion.
  const costs = summarizeApprovedAuthorBodyTrialCosts(input.snapshot, input.approval);
  if (input.snapshot.continuations.some(row => !uuid(row.id)) ||
    input.snapshot.ledger.some(row => !uuid(row.id) || !uuid(row.continuationId))) invalid();
  const acknowledgement = input.acknowledgement;
  if (!uuid(acknowledgement.id) || acknowledgement.trialApprovalId !== input.approval.id ||
    acknowledgement.userId !== input.approval.userId || acknowledgement.workId !== input.approval.workId ||
    acknowledgement.status !== 'active' || acknowledgement.provisionalHoldOnly !== true ||
    acknowledgement.unknownCostRemainsUnknown !== true || acknowledgement.notProviderChargeOrLiabilityCeiling !== true ||
    !positiveInteger(acknowledgement.maximumTotalHoldKrw, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW) ||
    money(acknowledgement.originalApprovedBudgetKrw) !== cap ||
    time(acknowledgement.createdAt) < time(input.approval.createdAt) || time(acknowledgement.createdAt) > now ||
    time(acknowledgement.expiresAt) <= now || time(acknowledgement.expiresAt) > time(input.approval.expiresAt)) invalid();

  const holds: AuthorBodyTrialUnknownHold[] = [];
  const validateHold = (hold: AuthorBodyTrialUnknownHold) => {
    if (!hold || ![hold.id, hold.continuationId, hold.idempotencyKey].every(uuid) ||
      hold.acknowledgementId !== acknowledgement.id || !hash(hold.unknownEvidenceSha256) ||
      !positiveInteger(hold.amountKrw, acknowledgement.maximumTotalHoldKrw) || hold.status !== 'active' ||
      time(hold.createdAt) < time(acknowledgement.createdAt) || time(hold.createdAt) > now ||
      time(hold.expiresAt) <= now || time(hold.expiresAt) > time(acknowledgement.expiresAt)) invalid();
    const evidence = unknownEvidence(input.snapshot, hold.continuationId);
    if (evidence.digest !== hold.unknownEvidenceSha256 || evidence.row.authorBodyTrialApprovalId !== input.approval.id ||
      time(evidence.row.createdAt!) < time(input.approval.createdAt) ||
      time(evidence.row.createdAt!) > time(hold.createdAt) ||
      time(evidence.row.dispatchStartedAt!) > time(hold.createdAt)) invalid();
  };
  const overlaps = (a: AuthorBodyTrialUnknownHold, b: AuthorBodyTrialUnknownHold) =>
    a.id === b.id || a.continuationId === b.continuationId || a.idempotencyKey === b.idempotencyKey;
  for (const hold of input.existingHolds) {
    validateHold(hold);
    if (holds.some(existing => overlaps(existing, hold))) invalid();
    holds.push(hold);
  }
  let requestedHoldState: 'none' | 'new' | 'reused' = 'none';
  if (input.requestedHold !== undefined) {
    validateHold(input.requestedHold);
    const overlapping = holds.filter(existing => overlaps(existing, input.requestedHold!));
    if (overlapping.length) {
      if (overlapping.length !== 1 || holdIdentity(overlapping[0]) !== holdIdentity(input.requestedHold)) invalid();
      requestedHoldState = 'reused';
    } else {
      holds.push(input.requestedHold);
      requestedHoldState = 'new';
    }
  }
  const provisional = holds.reduce((total, hold) => total + BigInt(hold.amountKrw) * SCALE, 0n);
  if (provisional > BigInt(acknowledgement.maximumTotalHoldKrw) * SCALE || holds.length > costs.unknownCostCount) invalid();
  const next = money(input.nextMaximumCostKrw);
  if (next > ORIGINAL_MAXIMUM_KRW) invalid();
  const unresolvedUnheldCount = costs.unknownCostCount - holds.length;
  const budgetCommitted = money(costs.committedCostKrw) + provisional;
  const maximumAfterReservation = budgetCommitted + next;
  const reason = unresolvedUnheldCount > 0 ? 'unknown_cost' as const
    : maximumAfterReservation > cap ? 'budget_exceeded' as const : 'within_budget' as const;
  return {
    contract: 'story-author-body-trial-unknown-hold-v1' as const,
    ...costs,
    provisionalHeldAmountKrw: formatMoney(provisional),
    provisionalHeldCount: holds.length,
    unresolvedUnheldCount,
    unknownCostState: costs.unknownCostCount > 0 ? 'UNKNOWN' as const : 'KNOWN' as const,
    approvedBudgetKrw: formatMoney(cap),
    budgetCommittedIncludingHoldsKrw: formatMoney(budgetCommitted),
    remainingBudgetIncludingHoldsKrw: formatMoney(budgetCommitted < cap ? cap - budgetCommitted : 0n),
    maximumAfterReservationKrw: formatMoney(maximumAfterReservation),
    requestedHoldState,
    budgetCheckPassed: reason === 'within_budget',
    mayReserve: next > 0n && reason === 'within_budget', reason,
    generationAuthorized: false as const,
    holdIsProviderCharge: false as const,
    holdIsGuaranteedLiabilityCeiling: false as const,
  };
}

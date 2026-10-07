import type { Prisma, AuditEvent } from '@prisma/client';
import { isUUID } from 'class-validator';
import {
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW,
  type AuthorBodyTrialUnknownHold,
  type AuthorBodyTrialUnknownHoldAcknowledgement,
} from './story-author-body-trial-unknown-hold.policy';

export const AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE = 'user-approved-20261007-current-unknown-hold-v1';
export const AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION = 'story.author_body_trial.unknown_hold_registered';
export const AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY = 'authorBodyTrialUnknownHold';
export const AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION = 'story-author-body-trial-unknown-hold-registration-v1';

export interface AuthorBodyTrialUnknownHoldPersistedProof {
  version: typeof AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION;
  approvalReference: typeof AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE;
  auditId: string;
  failureCode: 'provider_outcome_unknown';
  acknowledgement: AuthorBodyTrialUnknownHoldAcknowledgement;
  hold: AuthorBodyTrialUnknownHold;
}

export type AuthorBodyTrialUnknownHoldAuditBinding = Pick<AuditEvent,
  'id' | 'actorUserId' | 'actorType' | 'action' | 'targetType' | 'targetId' | 'metadata' | 'createdAt'>;

const ACK_KEYS = ['id', 'trialApprovalId', 'userId', 'workId', 'status', 'createdAt', 'expiresAt',
  'originalApprovedBudgetKrw', 'maximumTotalHoldKrw', 'provisionalHoldOnly',
  'unknownCostRemainsUnknown', 'notProviderChargeOrLiabilityCeiling'];
const HOLD_KEYS = ['id', 'continuationId', 'idempotencyKey', 'acknowledgementId',
  'unknownEvidenceSha256', 'amountKrw', 'status', 'createdAt', 'expiresAt'];

export class StoryAuthorBodyTrialUnknownHoldProofError extends Error {
  constructor() {
    super('Story author body trial unknown hold proof is unavailable');
    this.name = 'StoryAuthorBodyTrialUnknownHoldProofError';
  }
}

function blocked(): never { throw new StoryAuthorBodyTrialUnknownHoldProofError(); }
function uuid(value: unknown): value is string {
  return typeof value === 'string' && value === value.toLowerCase() && isUUID(value);
}
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) blocked();
  return value;
}
function timestamp(value: unknown): number {
  if (!(value instanceof Date) || !Number.isSafeInteger(value.getTime()) || value.getTime() < 0) blocked();
  return value.getTime();
}
function isoDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) blocked();
  const date = new Date(value);
  timestamp(date);
  if (date.toISOString() !== value) blocked();
  return date;
}
function cap(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})\.\d{6}$/.test(value)) return false;
  const scaled = BigInt(value.replace('.', ''));
  return scaled > 0n && scaled <= 10_000_000_000n;
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 5 || Array.isArray(value) || (typeof value === 'string' && value.length > 128)) blocked();
  if (record(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length > 24) blocked();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') blocked();
  return encoded;
}
export function encodeAuthorBodyTrialUnknownHoldProof(proof: AuthorBodyTrialUnknownHoldPersistedProof): Prisma.InputJsonObject {
  return { ...proof,
    acknowledgement: { ...proof.acknowledgement, createdAt: proof.acknowledgement.createdAt.toISOString(),
      expiresAt: proof.acknowledgement.expiresAt.toISOString() },
    hold: { ...proof.hold, createdAt: proof.hold.createdAt.toISOString(), expiresAt: proof.hold.expiresAt.toISOString() },
  };
}

// Decode only with the matching existing audit row; parsed dates are not fresh authorization.
export function decodeAuthorBodyTrialUnknownHoldProof(
  value: unknown, audit: AuthorBodyTrialUnknownHoldAuditBinding,
): AuthorBodyTrialUnknownHoldPersistedProof {
  const envelope = exact(value, ['version', 'approvalReference', 'auditId', 'failureCode', 'acknowledgement', 'hold']);
  const ack = exact(envelope.acknowledgement, ACK_KEYS), hold = exact(envelope.hold, HOLD_KEYS);
  if (envelope.version !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION ||
    envelope.approvalReference !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE ||
    envelope.failureCode !== 'provider_outcome_unknown' || !uuid(envelope.auditId) ||
    ![ack.id, ack.trialApprovalId, ack.userId, ack.workId, hold.id, hold.continuationId,
      hold.idempotencyKey, hold.acknowledgementId].every(uuid) || !hash(hold.unknownEvidenceSha256) ||
    ack.status !== 'active' || hold.status !== 'active' || hold.acknowledgementId !== ack.id ||
    !cap(ack.originalApprovedBudgetKrw) || ack.maximumTotalHoldKrw !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW ||
    hold.amountKrw !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW || ack.provisionalHoldOnly !== true ||
    ack.unknownCostRemainsUnknown !== true || ack.notProviderChargeOrLiabilityCeiling !== true ||
    new Set([ack.id, hold.id, envelope.auditId]).size !== 3) blocked();
  const proof: AuthorBodyTrialUnknownHoldPersistedProof = {
    version: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION, approvalReference: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE,
    auditId: envelope.auditId as string, failureCode: 'provider_outcome_unknown',
    acknowledgement: { id: ack.id as string, trialApprovalId: ack.trialApprovalId as string,
      userId: ack.userId as string, workId: ack.workId as string, status: 'active',
      createdAt: isoDate(ack.createdAt), expiresAt: isoDate(ack.expiresAt),
      originalApprovedBudgetKrw: ack.originalApprovedBudgetKrw as string,
      maximumTotalHoldKrw: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW,
      provisionalHoldOnly: true, unknownCostRemainsUnknown: true, notProviderChargeOrLiabilityCeiling: true },
    hold: { id: hold.id as string, continuationId: hold.continuationId as string, idempotencyKey: hold.idempotencyKey as string,
      acknowledgementId: hold.acknowledgementId as string, unknownEvidenceSha256: hold.unknownEvidenceSha256 as string,
      amountKrw: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW, status: 'active',
      createdAt: isoDate(hold.createdAt), expiresAt: isoDate(hold.expiresAt) },
  };
  if (proof.acknowledgement.createdAt.getTime() !== proof.hold.createdAt.getTime() ||
    proof.acknowledgement.expiresAt.getTime() !== proof.hold.expiresAt.getTime() ||
    proof.hold.expiresAt <= proof.hold.createdAt || !audit || audit.id !== proof.auditId ||
    audit.actorType !== 'system' || audit.actorUserId !== proof.acknowledgement.userId ||
    audit.action !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION || audit.targetType !== 'story_ai_continuation' ||
    audit.targetId !== proof.hold.continuationId || timestamp(audit.createdAt) !== timestamp(proof.hold.createdAt)) blocked();
  const metadata = exact(audit.metadata, ['approvalReference', 'proof']);
  if (metadata.approvalReference !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE ||
    canonical(metadata.proof) !== canonical(value) || canonical(encodeAuthorBodyTrialUnknownHoldProof(proof)) !== canonical(value)) blocked();
  return proof;
}


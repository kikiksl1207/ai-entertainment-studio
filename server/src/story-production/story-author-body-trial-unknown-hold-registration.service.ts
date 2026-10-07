import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { summarizeApprovedAuthorBodyTrialCosts, StoryAuthorBodyTrialBudgetError } from './story-author-body-trial-budget.policy';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialService } from './story-author-body-trial.service';
import {
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW,
  authorBodyTrialUnknownHoldEvidenceSha256,
  evaluateAuthorBodyTrialUnknownHolds,
  StoryAuthorBodyTrialUnknownHoldError,
} from './story-author-body-trial-unknown-hold.policy';
import {
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE,
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION,
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY,
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION,
  decodeAuthorBodyTrialUnknownHoldProof,
  encodeAuthorBodyTrialUnknownHoldProof,
  StoryAuthorBodyTrialUnknownHoldProofError,
  type AuthorBodyTrialUnknownHoldPersistedProof,
} from './story-author-body-trial-unknown-hold-proof';
export {
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION,
  AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION,
  decodeAuthorBodyTrialUnknownHoldProof, encodeAuthorBodyTrialUnknownHoldProof, StoryAuthorBodyTrialUnknownHoldProofError,
  type AuthorBodyTrialUnknownHoldPersistedProof, type AuthorBodyTrialUnknownHoldAuditBinding,
} from './story-author-body-trial-unknown-hold-proof';

export interface AuthorBodyTrialUnknownHoldRegistrationCommand {
  userId: string;
  workId: string;
  approvalId: string;
  continuationId: string;
  idempotencyKey: string;
  expectedEvidenceSha256: string;
  expectedApprovedBudgetKrw: string;
  approvalReference: typeof AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE;
  expiresAt: Date;
  provisionalHoldOnly: boolean;
  unknownCostRemainsUnknown: boolean;
  notProviderChargeOrLiabilityCeiling: boolean;
}

const COMMAND_KEYS = ['userId', 'workId', 'approvalId', 'continuationId', 'idempotencyKey',
  'expectedEvidenceSha256', 'expectedApprovedBudgetKrw', 'approvalReference', 'expiresAt',
  'provisionalHoldOnly', 'unknownCostRemainsUnknown', 'notProviderChargeOrLiabilityCeiling'];
function blocked(): never {
  throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REGISTRATION_BLOCKED', generationStarted: false });
}
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
function cap(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})\.\d{6}$/.test(value)) return false;
  const scaled = BigInt(value.replace('.', ''));
  return scaled > 0n && scaled <= 10_000_000_000n;
}
function validateCommand(command: AuthorBodyTrialUnknownHoldRegistrationCommand) {
  exact(command, COMMAND_KEYS);
  if (![command.userId, command.workId, command.approvalId, command.continuationId, command.idempotencyKey].every(uuid) ||
    !hash(command.expectedEvidenceSha256) || !cap(command.expectedApprovedBudgetKrw) ||
    command.approvalReference !== AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE || command.provisionalHoldOnly !== true ||
    command.unknownCostRemainsUnknown !== true || command.notProviderChargeOrLiabilityCeiling !== true) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REGISTRATION_INPUT_INVALID' });
  }
  timestamp(command.expiresAt);
}

@Injectable()
export class StoryAuthorBodyTrialUnknownHoldRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trials: StoryAuthorBodyTrialService,
    private readonly costs: StoryAuthorBodyTrialCostService,
  ) {}

  // Server-only explicit command. No controller/module/approval/grant is created here.
  async registerCurrentUnknown(input: AuthorBodyTrialUnknownHoldRegistrationCommand) {
    validateCommand(input);
    const command = { ...input, expiresAt: new Date(input.expiresAt.getTime()) };
    try {
      return await this.prisma.$transaction(async tx => {
        // Existing authorizeTx owns the same author-work lock and every current approval pin check.
        const approval = await this.trials.authorizeTx(tx, command.userId, { workId: command.workId, approvalId: command.approvalId });
        if (approval.id !== command.approvalId || approval.userId !== command.userId || approval.workId !== command.workId ||
          approval.status !== 'active' || !approval.approvedBudgetKrw.isFinite() || approval.approvedBudgetKrw.lte(0) ||
          approval.approvedBudgetKrw.gt(10000) || approval.approvedBudgetKrw.decimalPlaces() > 6 ||
          approval.approvedBudgetKrw.toFixed(6) !== command.expectedApprovedBudgetKrw ||
          timestamp(command.expiresAt) > timestamp(approval.expiresAt)) blocked();
        // Preserve PostgreSQL microseconds; a JavaScript Date loses the last three digits.
        const dispatchPins = await tx.$queryRaw<Array<{ dispatchStartedAtUtc: string | null }>>(Prisma.sql`
          SELECT to_char(dispatch_started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "dispatchStartedAtUtc"
          FROM story_ai_continuations
          WHERE id = ${command.continuationId}::uuid AND user_id = ${command.userId}::uuid AND work_id = ${command.workId}::uuid
          FOR SHARE`);
        const dispatchPin = dispatchPins.length === 1 ? dispatchPins[0].dispatchStartedAtUtc : null;
        if (typeof dispatchPin !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(dispatchPin) ||
          !Number.isSafeInteger(Date.parse(dispatchPin))) blocked();
        const rows = await tx.storyAiContinuation.findMany({ where: { userId: command.userId, workId: command.workId },
          orderBy: { id: 'asc' }, take: 1001,
          select: { id: true, userId: true, workId: true, releaseId: true, releaseChecksum: true, manuscriptVersionId: true,
            styleConsentId: true, styleConsentRevision: true, capabilityRevision: true, analysisJobId: true, analysisVersion: true,
            requestKind: true, authorBodyTrialApprovalId: true, status: true, failureCode: true, attemptCount: true, maxAttempts: true,
            actualCostKrw: true, dispatchStartedAt: true, contextReferences: true, createdAt: true } });
        if (rows.length > 1000 || new Set(rows.map(row => row.id)).size !== rows.length ||
          rows.some(row => !uuid(row.id) || row.userId !== command.userId || row.workId !== command.workId || !record(row.contextReferences))) blocked();
        const target = rows.find(row => row.id === command.continuationId);
        if (!target || target.authorBodyTrialApprovalId !== approval.id || target.requestKind !== 'recommended_choice' ||
          target.status !== 'failed' || target.failureCode !== 'provider_outcome_unknown' || target.attemptCount !== 1 ||
          target.maxAttempts !== 1 || target.actualCostKrw !== null || target.dispatchStartedAt === null ||
          target.releaseId !== approval.releaseId || target.releaseChecksum !== approval.releaseChecksum ||
          target.manuscriptVersionId !== approval.manuscriptVersionId || target.styleConsentId !== approval.styleConsentId ||
          target.styleConsentRevision !== approval.styleConsentRevision || target.capabilityRevision !== approval.capabilityRevision ||
          target.analysisJobId !== approval.analysisJobId || target.analysisVersion !== approval.analysisVersion) blocked();
        if (Date.parse(dispatchPin) !== timestamp(target.dispatchStartedAt)) blocked();
        const snapshot = await this.costs.snapshotTx(tx, command.userId, command.workId);
        const summary = summarizeApprovedAuthorBodyTrialCosts(snapshot, approval);
        if (summary.unknownCostCount !== 1 ||
          authorBodyTrialUnknownHoldEvidenceSha256(snapshot, target.id) !== command.expectedEvidenceSha256) blocked();
        const audits = await tx.auditEvent.findMany({ where: { action: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION, OR: [
          { targetId: command.continuationId },
          { actorUserId: command.userId, metadata: { path: ['proof', 'acknowledgement', 'workId'], equals: command.workId } },
          { metadata: { path: ['proof', 'hold', 'idempotencyKey'], equals: command.idempotencyKey } },
        ] }, orderBy: { id: 'asc' }, take: 2,
          select: { id: true, actorUserId: true, actorType: true, action: true, targetType: true,
            targetId: true, metadata: true, createdAt: true } });
        const stored = rows.filter(row => Object.prototype.hasOwnProperty.call(row.contextReferences, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY));
        if (stored.length > 1 || audits.length > 1) blocked();
        const now = new Date();
        if (timestamp(command.expiresAt) <= timestamp(now) || timestamp(approval.expiresAt) <= timestamp(now)) blocked();
        let proof: AuthorBodyTrialUnknownHoldPersistedProof;
        const replay = stored.length === 1;
        if (replay) {
          if (stored[0].id !== target.id || audits.length !== 1) blocked();
          proof = decodeAuthorBodyTrialUnknownHoldProof(
            (stored[0].contextReferences as Prisma.JsonObject)[AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY], audits[0]);
          if (proof.acknowledgement.trialApprovalId !== command.approvalId || proof.acknowledgement.userId !== command.userId ||
            proof.acknowledgement.workId !== command.workId || proof.acknowledgement.originalApprovedBudgetKrw !== command.expectedApprovedBudgetKrw ||
            proof.hold.continuationId !== command.continuationId || proof.hold.idempotencyKey !== command.idempotencyKey ||
            proof.hold.unknownEvidenceSha256 !== command.expectedEvidenceSha256 ||
            proof.hold.expiresAt.getTime() !== command.expiresAt.getTime()) blocked();
        } else {
          if (audits.length !== 0) blocked();
          // IDs record the explicitly supplied acknowledgement; authorizeTx is not human consent.
          const acknowledgementId = randomUUID(), holdId = randomUUID(), auditId = randomUUID();
          proof = { version: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION,
            approvalReference: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE, auditId, failureCode: 'provider_outcome_unknown',
            acknowledgement: { id: acknowledgementId, trialApprovalId: approval.id, userId: command.userId, workId: command.workId,
              status: 'active', createdAt: now, expiresAt: command.expiresAt, originalApprovedBudgetKrw: command.expectedApprovedBudgetKrw,
              maximumTotalHoldKrw: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW, provisionalHoldOnly: command.provisionalHoldOnly,
              unknownCostRemainsUnknown: command.unknownCostRemainsUnknown,
              notProviderChargeOrLiabilityCeiling: command.notProviderChargeOrLiabilityCeiling },
            hold: { id: holdId, continuationId: target.id, idempotencyKey: command.idempotencyKey, acknowledgementId,
              unknownEvidenceSha256: command.expectedEvidenceSha256, amountKrw: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_MAXIMUM_KRW,
              status: 'active', createdAt: now, expiresAt: command.expiresAt } };
        }
        const normalizedApproval = { ...approval, approvedBudgetKrw: approval.approvedBudgetKrw.toFixed(6) };
        const budget = evaluateAuthorBodyTrialUnknownHolds({ now, snapshot, approval: normalizedApproval,
          currentAuthorization: { verified: true, checkedAt: now, approval: normalizedApproval },
          acknowledgement: proof.acknowledgement, holdsComplete: true, existingHolds: replay ? [proof.hold] : [],
          requestedHold: proof.hold, nextMaximumCostKrw: '0.000000' });
        if (!budget.budgetCheckPassed || budget.unknownCostCount !== 1 || budget.provisionalHeldCount !== 1 ||
          budget.unresolvedUnheldCount !== 0 || budget.mayReserve !== false) blocked();
        if (!replay) {
          const json = encodeAuthorBodyTrialUnknownHoldProof(proof);
          const audit = await tx.auditEvent.create({ data: { id: proof.auditId, actorUserId: command.userId, actorType: 'system',
            action: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_ACTION, targetType: 'story_ai_continuation', targetId: target.id,
            metadata: { approvalReference: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_REFERENCE, proof: json }, createdAt: now } });
          decodeAuthorBodyTrialUnknownHoldProof(json, audit);
          const updated = await tx.storyAiContinuation.updateMany({ where: { id: target.id, userId: command.userId,
            workId: command.workId, authorBodyTrialApprovalId: approval.id, requestKind: 'recommended_choice', status: 'failed',
            failureCode: 'provider_outcome_unknown', attemptCount: 1, maxAttempts: 1, actualCostKrw: null,
            dispatchStartedAt: dispatchPin, contextReferences: { equals: target.contextReferences as Prisma.InputJsonValue } },
            data: { contextReferences: { ...(target.contextReferences as Prisma.JsonObject), [AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY]: json } } });
          if (updated.count !== 1) blocked();
        }
        if (command.expiresAt <= new Date() || approval.expiresAt <= new Date()) blocked();
        return { contract: AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROOF_VERSION, registrationState: replay ? 'reused' as const : 'registered' as const,
          proof, budget, generationAuthorized: false as const, generationStarted: false as const, imageGenerationStarted: false as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
    } catch (error) {
      if (error instanceof StoryAuthorBodyTrialUnknownHoldProofError || error instanceof StoryAuthorBodyTrialUnknownHoldError || error instanceof StoryAuthorBodyTrialBudgetError) blocked();
      throw error;
    }
  }
}

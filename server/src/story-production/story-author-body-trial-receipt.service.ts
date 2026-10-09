import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { STORY_LOCALES } from './story-production.policy';

export type AuthorBodyTrialReceiptScope = {
  approvalId: string; progressId: string; expectedRevision: number; locale: string;
};

export function normalizeAuthorBodyTrialReceiptQuery(url: string): AuthorBodyTrialReceiptScope {
  const query = new URL(url, 'http://localhost').searchParams;
  const keys = ['approvalId', 'progressId', 'expectedRevision', 'locale'];
  if (query.size !== keys.length || keys.some(key => query.getAll(key).length !== 1) ||
      !/^[1-9][0-9]{0,9}$/.test(query.get('expectedRevision') || '')) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_INPUT_INVALID' });
  }
  const result = { approvalId: query.get('approvalId')!, progressId: query.get('progressId')!,
    expectedRevision: Number(query.get('expectedRevision')), locale: query.get('locale')! };
  validateScope(result);
  return result;
}

function validateScope(value: AuthorBodyTrialReceiptScope) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4 ||
      Object.keys(value).some(key => !['approvalId', 'progressId', 'expectedRevision', 'locale'].includes(key)) ||
      ![value.approvalId, value.progressId].every(id => typeof id === 'string' && isUUID(id)) ||
      !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1 || value.expectedRevision > 2147483646 ||
      !STORY_LOCALES.includes(value.locale as typeof STORY_LOCALES[number])) {
    throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_INPUT_INVALID' });
  }
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

function advisoryFailureReason(code: unknown) {
  if (code === 'dispatch_lease_insufficient') return 'lease_time_insufficient';
  if (code === 'provider_outcome_unknown') return 'provider_outcome_unknown';
  if (typeof code !== 'string') return null;
  if (['continuation_output_underlength', 'continuation_output_overlength'].includes(code)) return 'narrative_length_rejected';
  if (['provider_malformed_output', 'provider_output_route_invalid', 'provider_output_size_invalid',
    'provider_incomplete_output', 'provider_output_token_limit'].includes(code)) return 'output_validation_rejected';
  if (['continuation_invalid_calendar_date', 'continuation_source_prose_repeated',
    'continuation_generated_prose_repeated'].includes(code)) return 'quality_rule_rejected';
  if (code === 'participant_missing_from_scene') return 'participant_missing';
  if (['server_moderation_rejected', 'provider_refusal', 'provider_content_filtered'].includes(code)) return 'content_rejected';
  return null;
}

@Injectable()
export class StoryAuthorBodyTrialReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  async recover(userId: string, workId: string) {
    if (![userId, workId].every(id => typeof id === 'string' && isUUID(id))) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECOVERY_INPUT_INVALID' });
    }
    userId = userId.toLowerCase(); workId = workId.toLowerCase();
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await tx.storyWork.findFirst({ where: { id: workId, ownerUserId: userId, fixtureSource: false },
        select: { id: true, ownerUserId: true } });
      if (!work || work.id !== workId || work.ownerUserId !== userId) {
        throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECOVERY_UNAVAILABLE' });
      }
      const envelope = { contract: 'story-author-body-trial-recovery-v1' as const, workId,
        readOnly: true as const, generationAuthorized: false as const, generationStarted: false as const,
        imageGenerationStarted: false as const };
      const command = await tx.storyAuthorBodyTrialCommand.findFirst({ where: { userId, workId },
        orderBy: [{ createdAt: 'desc' }, { idempotencyKey: 'desc' }] });
      if (!command) return { ...envelope, command: null };
      const invalid = () => { throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECOVERY_EVIDENCE_INVALID' }); };
      const body = { approvalId: command.approvalId, progressId: command.progressId,
        expectedRevision: command.sourceRevision, locale: command.locale };
      try { validateScope(body); } catch { invalid(); }
      if (command.userId !== userId || command.workId !== workId || !isUUID(command.choiceId) ||
        !/^[A-Za-z0-9._:-]{8,120}$/.test(command.idempotencyKey)) invalid();
      const stored = record(command.receipt);
      if (stored.contract !== 'story-author-body-trial-choice-v1' || stored.imageGenerationStarted !== false ||
        stored.revisionAfterRequest !== command.sourceRevision + 1) invalid();
      if (stored.continuationId === undefined) {
        if (stored.progressId !== command.progressId || stored.generationStarted !== false ||
          !['active', 'completed'].includes(stored.status as string)) invalid();
      } else if (typeof stored.continuationId !== 'string' || !isUUID(stored.continuationId) ||
        !['queued', 'processing', 'completed', 'failed', 'timeout'].includes(stored.status as string) ||
        stored.privateInputReturned !== false || stored.providerPayloadReturned !== false || stored.internalCostReturned !== false ||
        stored.progressApplied !== (stored.status === 'completed') ||
        !['ai_generated', 'ai_reused'].includes(stored.provenance as string) ||
        !(stored.resultGeneratedSceneId === null || typeof stored.resultGeneratedSceneId === 'string' && isUUID(stored.resultGeneratedSceneId)) ||
        (stored.status === 'completed' ? stored.resultGeneratedSceneId === null : stored.resultGeneratedSceneId !== null)) invalid();
      const [approval, progress] = await Promise.all([
        tx.storyAuthorBodyTrialApproval.findFirst({ where: { id: command.approvalId, userId, workId }, select: { id: true } }),
        tx.storyReaderProgress.findFirst({ where: { id: command.progressId, userId, workId }, select: { id: true } }),
      ]);
      if (!approval || !progress) invalid();
      // This is a lookup locator only; the existing exact receipt GET still validates its outcome.
      return { ...envelope, command: { workId, choiceId: command.choiceId, key: command.idempotencyKey, body } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async lookup(userId: string, workId: string, choiceId: string, scope: AuthorBodyTrialReceiptScope, key: string) {
    validateScope(scope);
    if (![userId, workId, choiceId].every(id => typeof id === 'string' && isUUID(id)) ||
        typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,120}$/.test(key)) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_INPUT_INVALID' });
    }
    userId = userId.toLowerCase(); workId = workId.toLowerCase(); choiceId = choiceId.toLowerCase();
    scope = { ...scope, approvalId: scope.approvalId.toLowerCase(), progressId: scope.progressId.toLowerCase() };
    const unavailable = () => { throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_UNAVAILABLE' }); };
    const invalid = () => { throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_RECEIPT_EVIDENCE_INVALID' }); };
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      // Historical receipt access is ownership, not permission to dispatch another generation.
      const work = await tx.storyWork.findFirst({ where: { id: workId, ownerUserId: userId, fixtureSource: false },
        select: { id: true, ownerUserId: true } });
      if (!work || work.id !== workId || work.ownerUserId !== userId) unavailable();
      const command = await tx.storyAuthorBodyTrialCommand.findUnique({ where: {
        userId_idempotencyKey: { userId, idempotencyKey: key },
      } });
      if (!command || command.userId !== userId || command.workId !== workId || command.approvalId !== scope.approvalId ||
          command.progressId !== scope.progressId || command.choiceId !== choiceId ||
          command.sourceRevision !== scope.expectedRevision || command.locale !== scope.locale) unavailable();
      const [approval, progress] = await Promise.all([
        tx.storyAuthorBodyTrialApproval.findFirst({ where: { id: scope.approvalId, userId, workId } }),
        tx.storyReaderProgress.findFirst({ where: { id: scope.progressId, userId, workId }, select: { id: true } }),
      ]);
      if (!approval || !progress) unavailable();
      const stored = record(command!.receipt);
      if (stored.contract !== 'story-author-body-trial-choice-v1' || stored.imageGenerationStarted !== false ||
          stored.revisionAfterRequest !== scope.expectedRevision + 1) invalid();
      let receipt: Record<string, unknown>;
      if (stored.continuationId === undefined) {
        if (stored.progressId !== scope.progressId || stored.generationStarted !== false ||
            !['active', 'completed'].includes(stored.status as string)) invalid();
        receipt = { contract: stored.contract, progressId: scope.progressId, status: stored.status,
          revisionAfterRequest: scope.expectedRevision + 1, generationStarted: false,
          imageGenerationStarted: false, idempotentReplay: true };
      } else {
        if (typeof stored.continuationId !== 'string' || !isUUID(stored.continuationId)) invalid();
        const continuation = await tx.storyAiContinuation.findFirst({ where: { id: stored.continuationId as string,
          userId, workId, progressId: scope.progressId, authorBodyTrialApprovalId: scope.approvalId } });
        if (!continuation || continuation.releaseId !== approval!.releaseId || continuation.requestKind !== 'recommended_choice' ||
            continuation.idempotencyKey !== `recommended-choice:${key}` || continuation.sourceProgressRevision !== scope.expectedRevision ||
            continuation.locale !== scope.locale || continuation.maxAttempts !== 1 ||
            !((continuation.recommendedChoiceId === choiceId && continuation.generatedChoiceId === null) ||
              (continuation.generatedChoiceId === choiceId && continuation.recommendedChoiceId === null)) ||
            !['queued', 'processing', 'completed', 'failed', 'timeout'].includes(continuation.status)) invalid();
        const current = continuation!;
        const reused = record(current.contextReferences).sharedResultReused === true;
        if (current.status === 'completed') {
          const result = current.resultGeneratedSceneId && await tx.storyAiGeneratedScene.findFirst({ where: {
            id: current.resultGeneratedSceneId, userId, workId, releaseId: current.releaseId,
            progressId: scope.progressId, continuationId: current.id, status: 'ready',
          }, select: { id: true } });
          if (!result) invalid();
        } else if (current.resultGeneratedSceneId !== null) invalid();
        receipt = { contract: stored.contract, continuationId: current.id, status: current.status,
          revisionAfterRequest: scope.expectedRevision + 1, progressApplied: current.status === 'completed',
          privateInputReturned: false, providerPayloadReturned: false, internalCostReturned: false,
          // Advisory only: failure text cannot certify usage, cost, or permission to retry.
          failureReason: current.status === 'failed' ? advisoryFailureReason(current.failureCode) : null,
          resultGeneratedSceneId: current.resultGeneratedSceneId, provenance: reused ? 'ai_reused' : 'ai_generated',
          imageGenerationStarted: false, idempotentReplay: true };
      }
      return { contract: 'story-author-body-trial-receipt-v1' as const, workId, choiceId,
        approvalId: scope.approvalId, progressId: scope.progressId, sourceRevision: scope.expectedRevision, locale: scope.locale,
        readOnly: true as const, generationAuthorized: false as const, generationStarted: false as const,
        imageGenerationStarted: false as const, receipt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

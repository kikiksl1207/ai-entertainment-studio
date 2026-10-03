import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyTrialBudgetError, summarizeAuthorBodyTrialCosts, type AuthorBodyTrialCostSnapshot } from './story-author-body-trial-budget.policy';

@Injectable()
export class StoryAuthorBodyTrialCostService {
  constructor(private readonly prisma: PrismaService) {}

  async current(userId: string, workId: string) {
    if (!isUUID(userId) || !isUUID(workId)) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    return this.prisma.$transaction(async db => {
      await db.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await db.storyWork.findFirst({ where: { id: workId, ownerUserId: userId,
        status: 'published', fixtureSource: false }, select: { id: true, ownerUserId: true } });
      if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_UNAVAILABLE' });
      if (work.id !== workId || work.ownerUserId !== userId) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_UNAVAILABLE' });
      }
      try {
        const costs = summarizeAuthorBodyTrialCosts(await this.snapshotTx(db, userId, workId));
        return { contract: 'story-author-body-trial-cost-v1' as const, workId,
          scope: 'all_recommended_body_requests_for_author_work' as const,
          readOnly: true as const, generationAuthorized: false as const,
          imageGenerationStarted: false as const, ...costs,
          evidenceReadyForBudgetCheck: costs.unknownCostCount === 0 };
      } catch (error) {
        if (!(error instanceof StoryAuthorBodyTrialBudgetError)) throw error;
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  // The caller owns the write transaction and scope locks; the public GET remains read-only.
  async snapshotTx(db: Prisma.TransactionClient, userId: string, workId: string): Promise<AuthorBodyTrialCostSnapshot> {
      // Include old releases and reset routes: neither erases provider spending.
      const continuations = await db.storyAiContinuation.findMany({
        where: { userId, workId, requestKind: 'recommended_choice' }, orderBy: { id: 'asc' }, take: 1001,
        select: { id: true, userId: true, workId: true, requestKind: true, status: true,
          attemptCount: true, maxAttempts: true, dispatchStartedAt: true,
          estimatedCostKrw: true, hardBudgetKrw: true, actualCostKrw: true,
          contextReferences: true, sharedResultId: true, resultGeneratedSceneId: true, releaseId: true, progressId: true, failureCode: true,
          createdAt: true, authorBodyTrialApprovalId: true },
      });
      if (continuations.length > 1000) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' });
      }
      const ledger = await db.storyAiUsageLedger.findMany({
        where: { userId, workId }, orderBy: { id: 'asc' }, take: 6001,
        select: { id: true, continuationId: true, userId: true, workId: true, eventKind: true,
          status: true, provenance: true, estimatedCostKrw: true, actualCostKrw: true,
          inputTokens: true, outputTokens: true, cachedInputTokens: true, imageUnits: true },
      });
      if (ledger.length > 6000) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' });
      }
      const selectedIds = new Set(continuations.map(row => row.id));
      const unclassifiedIds = [...new Set(ledger.filter(row => !selectedIds.has(row.continuationId)).map(row => row.continuationId))];
      // Exclude a custom-choice cost only with an existing same-owner/work custom request.
      // Orphan terminal rows must not disappear just because their request row is missing.
      const customRequests = unclassifiedIds.length ? await db.storyAiContinuation.findMany({
        where: { id: { in: unclassifiedIds }, userId, workId, requestKind: 'custom_choice' },
        select: { id: true, userId: true, workId: true, requestKind: true },
      }) : [];
      const customIds = new Set(customRequests.filter(row => row.userId === userId && row.workId === workId &&
        row.requestKind === 'custom_choice' && unclassifiedIds.includes(row.id)).map(row => row.id));
      const recommendedLedger = ledger.filter(row => !customIds.has(row.continuationId) ||
        ['recommended_route_request', 'shared_route_reused'].includes(row.eventKind));
      const sharedIds = [...new Set(continuations.flatMap(row => row.sharedResultId ? [row.sharedResultId] : []))];
      const sceneIds = [...new Set(continuations.flatMap(row => row.sharedResultId && row.resultGeneratedSceneId ? [row.resultGeneratedSceneId] : []))];
      const sharedResults = sharedIds.length ? await db.storyAiReusableResult.findMany({
        where: { id: { in: sharedIds }, workId },
        select: { id: true, workId: true, releaseId: true, resultChecksum: true },
      }) : [];
      const reusedScenes = sceneIds.length ? await db.storyAiGeneratedScene.findMany({
        where: { id: { in: sceneIds }, userId, workId, provenance: 'ai_reused', status: 'ready' },
        select: { id: true, userId: true, workId: true, releaseId: true, progressId: true,
          continuationId: true, sharedResultId: true, resultChecksum: true, provenance: true, status: true },
      }) : [];
      const sharedById = new Map(sharedResults.map(row => [row.id, row]));
      const scenesById = new Map(reusedScenes.map(row => [row.id, row]));
        return { userId, workId, complete: ledger.length <= 6000,
          continuations: continuations.map(row => {
            const shared = row.sharedResultId ? sharedById.get(row.sharedResultId) : undefined;
            const scene = row.resultGeneratedSceneId ? scenesById.get(row.resultGeneratedSceneId) : undefined;
            const references = row.contextReferences && typeof row.contextReferences === 'object' && !Array.isArray(row.contextReferences)
              ? row.contextReferences : {};
            const proof = references.noProviderDispatchEvidence;
            return { ...row,
            estimatedCostKrw: row.estimatedCostKrw.toFixed(6), hardBudgetKrw: row.hardBudgetKrw.toFixed(6),
            actualCostKrw: row.actualCostKrw?.toFixed(6) ?? null,
            confirmedNoProviderDispatch: Boolean(proof && typeof proof === 'object' && !Array.isArray(proof) &&
              proof.continuationId === row.id && proof.attemptCount === 1 &&
              ((row.failureCode === 'generation_authorization_changed' && proof.kind === 'authorization_rejected_before_dispatch_v1') ||
                (typeof row.failureCode === 'string' && proof.failureCode === row.failureCode &&
                  proof.kind === 'provider_preflight_rejected_before_dispatch_v1'))),
            sharedResultReused: Boolean(row.contextReferences && typeof row.contextReferences === 'object' &&
              !Array.isArray(row.contextReferences) && row.contextReferences.sharedResultReused === true),
            sharedResultEvidenceVerified: Boolean(shared && scene && shared.workId === workId &&
              shared.releaseId === row.releaseId && shared.resultChecksum && /^[a-f0-9]{64}$/.test(shared.resultChecksum) &&
              scene.id === row.resultGeneratedSceneId && scene.continuationId === row.id &&
              scene.userId === userId && scene.workId === workId && scene.releaseId === row.releaseId &&
              scene.progressId === row.progressId && scene.sharedResultId === shared.id &&
              scene.provenance === 'ai_reused' && scene.status === 'ready' && scene.resultChecksum === shared.resultChecksum),
          }; }),
          ledger: recommendedLedger.map(row => ({ ...row, estimatedCostKrw: row.estimatedCostKrw.toFixed(6),
            actualCostKrw: row.actualCostKrw?.toFixed(6) ?? null })),
        };
  }
}

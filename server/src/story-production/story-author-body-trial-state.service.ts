import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialBudgetError, summarizeApprovedAuthorBodyTrialCosts } from './story-author-body-trial-budget.policy';

@Injectable()
export class StoryAuthorBodyTrialStateService {
  constructor(private readonly prisma: PrismaService, private readonly costs: StoryAuthorBodyTrialCostService) {}

  async current(userId: string, workId: string) {
    if (![userId, workId].every(id => isUUID(id))) {
      throw new BadRequestException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_INPUT_INVALID' });
    }
    userId = userId.toLowerCase();
    workId = workId.toLowerCase();
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
      const work = await tx.storyWork.findFirst({ where: { id: workId, ownerUserId: userId,
        status: 'published', fixtureSource: false }, select: { id: true, ownerUserId: true, activeReleaseId: true } });
      if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      if (work.id !== workId || work.ownerUserId !== userId) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      }
      const base = { contract: 'story-author-body-trial-state-v1' as const, workId,
        readOnly: true as const, generationAuthorized: false as const, currentAuthorizationVerified: false as const,
        imageGenerationStarted: false as const };
      const approval = await tx.storyAuthorBodyTrialApproval.findFirst({ where: { userId, workId, status: 'active' },
        select: { id: true, userId: true, workId: true, status: true, releaseId: true, approvedBudgetKrw: true, expiresAt: true,
          createdAt: true, approvalReference: true } });
      if (!approval) return { ...base, state: 'approval_required' as const, approval: null, budget: null };
      if (approval.userId !== userId || approval.workId !== workId || approval.status !== 'active' ||
        approval.approvedBudgetKrw.lte(0) || approval.approvedBudgetKrw.gt(10000)) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      }
      let summary;
      try {
        summary = summarizeApprovedAuthorBodyTrialCosts(await this.costs.snapshotTx(tx, userId, workId), approval);
      } catch (error) {
        if (!(error instanceof StoryAuthorBodyTrialBudgetError)) throw error;
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' });
      }
      const remaining = approval.approvedBudgetKrw.minus(summary.committedCostKrw);
      const known = summary.unknownCostCount === 0;
      // This is a recorded approval snapshot, not a dispatch grant. POST revalidates every pinned criterion.
      const state = approval.expiresAt <= new Date() ? 'approval_expired' as const
        : approval.releaseId !== work.activeReleaseId ? 'release_changed' as const
        : !known ? 'cost_unknown' as const
        : remaining.lt(0) ? 'budget_over_limit' as const : 'approval_recorded' as const;
      return { ...base, state, approval: { id: approval.id, expiresAt: approval.expiresAt.toISOString() },
        budget: { ...summary, approvedBudgetKrw: approval.approvedBudgetKrw.toFixed(6),
          remainingBudgetKrw: known ? (remaining.lt(0) ? '0.000000' : remaining.toFixed(6)) : null,
          evidenceReadyForBudgetCheck: known } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StoryAuthorBodyTrialApproval } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialBudgetError, summarizeApprovedAuthorBodyTrialCosts } from './story-author-body-trial-budget.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { StoryAuthorBodyTrialUnknownHoldError } from './story-author-body-trial-unknown-hold.policy';
import { AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY } from './story-author-body-trial-unknown-hold-proof';

type NextCostQuote = { nextMaximumCostKrw: string | null; nextCostQuoteState: 'prepared' | 'withheld';
  nextCostQuoteReason: string | null };

function withheldNextCost(reason: string): NextCostQuote {
  return { nextMaximumCostKrw: null, nextCostQuoteState: 'withheld', nextCostQuoteReason: reason };
}

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
        status: 'published', fixtureSource: false }, select: { id: true, ownerUserId: true, activeReleaseId: true,
          publishedVersion: true } });
      if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      if (work.id !== workId || work.ownerUserId !== userId) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      }
      const base = { contract: 'story-author-body-trial-state-v1' as const, workId,
        readOnly: true as const, generationAuthorized: false as const, currentAuthorizationVerified: false as const,
        imageGenerationStarted: false as const };
      const approval = await tx.storyAuthorBodyTrialApproval.findFirst({ where: { userId, workId, status: 'active' },
        select: { id: true, userId: true, workId: true, status: true, releaseId: true, approvedBudgetKrw: true, expiresAt: true,
          createdAt: true, approvalReference: true, manuscriptVersionId: true, releaseChecksum: true,
          capabilityRevision: true, styleConsentId: true, styleConsentRevision: true, analysisJobId: true,
          analysisVersion: true, generationProfileId: true, generationProfileRevision: true,
          generationProfileFingerprint: true } });
      if (!approval) return { ...base, ...withheldNextCost('approval_required'),
        state: 'approval_required' as const, approval: null, budget: null };
      if (approval.userId !== userId || approval.workId !== workId || approval.status !== 'active' ||
        !approval.approvedBudgetKrw.isFinite() || !Number.isFinite(approval.expiresAt.getTime()) ||
        approval.approvedBudgetKrw.lte(0) || approval.approvedBudgetKrw.gt(10000)) {
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_STATE_UNAVAILABLE' });
      }
      let summary, snapshot;
      try {
        snapshot = await this.costs.snapshotTx(tx, userId, workId);
        summary = summarizeApprovedAuthorBodyTrialCosts(snapshot, approval);
      } catch (error) {
        if (!(error instanceof StoryAuthorBodyTrialBudgetError)) throw error;
        throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE' });
      }
      const remaining = approval.approvedBudgetKrw.minus(summary.committedCostKrw);
      const known = summary.unknownCostCount === 0;
      // This is a recorded approval snapshot, not a dispatch grant. POST revalidates every pinned criterion.
      let state: 'approval_expired' | 'release_changed' | 'cost_unknown' | 'budget_over_limit' |
        'approval_recorded' | 'approval_recorded_with_provisional_hold' =
        approval.expiresAt <= new Date() ? 'approval_expired'
        : approval.releaseId !== work.activeReleaseId ? 'release_changed'
        : !known ? 'cost_unknown'
        : remaining.lt(0) ? 'budget_over_limit' : 'approval_recorded';
      let quote = state !== 'approval_recorded' ? withheldNextCost(state)
        : summary.pendingCount > 0 ? withheldNextCost('pending_cost')
        : await this.nextCostQuoteTx(tx, work, approval, remaining);
      let provisional: Awaited<ReturnType<StoryAuthorBodyTrialCostService['provisionalBudgetTx']>> = null;
      if (state !== 'approval_expired' && state !== 'release_changed' && snapshot.continuations.some(row => row.contextReferences &&
        typeof row.contextReferences === 'object' && !Array.isArray(row.contextReferences) &&
        Object.prototype.hasOwnProperty.call(row.contextReferences, AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_PROPERTY))) {
        // This read-only pin check prepares a quote, never a dispatch grant or a human review.
        const pinQuote = await this.nextCostQuoteTx(tx, work, approval, approval.approvedBudgetKrw);
        if (pinQuote.nextCostQuoteState === 'prepared') {
          try { provisional = await this.costs.provisionalBudgetTx(tx, approval, snapshot, true); }
          catch (error) {
            if (!(error instanceof StoryAuthorBodyTrialUnknownHoldError)) throw error;
            throw new ConflictException({ code: 'STORY_AUTHOR_BODY_TRIAL_UNKNOWN_HOLD_EVIDENCE_INCOMPLETE' });
          }
          if (provisional?.budgetCheckPassed && provisional.unresolvedUnheldCount === 0) {
            state = 'approval_recorded_with_provisional_hold';
            quote = summary.pendingCount > 0 ? withheldNextCost('pending_cost')
              : new Prisma.Decimal(pinQuote.nextMaximumCostKrw!).gt(provisional.remainingBudgetIncludingHoldsKrw)
                ? withheldNextCost('next_cost_exceeds_remaining') : pinQuote;
          }
        } else quote = pinQuote;
      }
      return { ...base, ...quote, state, approval: { id: approval.id, expiresAt: approval.expiresAt.toISOString() },
        budget: { ...summary, approvedBudgetKrw: approval.approvedBudgetKrw.toFixed(6),
          remainingBudgetKrw: known ? (remaining.lt(0) ? '0.000000' : remaining.toFixed(6)) : null,
          evidenceReadyForBudgetCheck: known,
          ...(provisional ? { provisionalHeldAmountKrw: provisional.provisionalHeldAmountKrw,
            provisionalHeldCount: provisional.provisionalHeldCount, unresolvedUnheldCount: provisional.unresolvedUnheldCount,
            budgetCommittedIncludingHoldsKrw: provisional.budgetCommittedIncludingHoldsKrw,
            remainingBudgetIncludingHoldsKrw: provisional.remainingBudgetIncludingHoldsKrw,
            provisionalHoldExpiresAt: provisional.provisionalHoldExpiresAt,
            budgetCheckPassed: provisional.budgetCheckPassed,
            holdIsProviderCharge: false as const, holdIsGuaranteedLiabilityCeiling: false as const } : {}) } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async nextCostQuoteTx(tx: Prisma.TransactionClient,
    work: { id: string; ownerUserId: string; activeReleaseId: string | null; publishedVersion: number },
    approval: StoryAuthorBodyTrialApproval, remaining: Prisma.Decimal): Promise<NextCostQuote> {
    // Mirror the existing approval pins with reads only: no authorization locks or profile getOrCreate.
    const release = await tx.storyRelease.findFirst({ where: { id: approval.releaseId, workId: work.id, status: 'active' },
      select: { id: true, workId: true, status: true, version: true, manuscriptVersionId: true, checksum: true } });
    const capability = await tx.storyReleaseCapability.findUnique({ where: { releaseId: approval.releaseId },
      select: { workId: true, releaseId: true, status: true, revision: true, hardBudgetKrw: true } });
    const consent = await tx.storyStyleProfileConsent.findUnique({ where: { id: approval.styleConsentId },
      select: { id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, status: true, revision: true,
        rightsConfirmed: true, aiBranchAllowed: true, startsAt: true, expiresAt: true } });
    const analysis = await tx.storyAnalysisJob.findFirst({ where: { workId: work.id,
      manuscriptVersionId: approval.manuscriptVersionId, status: 'completed' },
      orderBy: [{ analysisVersion: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, workId: true, manuscriptVersionId: true, status: true, analysisVersion: true } });
    const profile = await tx.storyWorkGenerationProfile.findFirst({ where: { workId: work.id,
      manuscriptVersionId: approval.manuscriptVersionId }, orderBy: { profileVersion: 'desc' },
      select: { id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, analysisJobId: true,
        status: true, profileVersion: true, reviewRevision: true, sourceFingerprint: true,
        approvedFingerprint: true, approvedSettings: true } });
    const now = new Date();
    if (approval.expiresAt <= now) return withheldNextCost('approval_expired');
    if (!release || release.id !== work.activeReleaseId || release.workId !== work.id || release.status !== 'active' ||
      release.version !== work.publishedVersion || release.manuscriptVersionId !== approval.manuscriptVersionId ||
      release.checksum !== approval.releaseChecksum || capability?.workId !== work.id ||
      capability.releaseId !== approval.releaseId || capability.status !== 'active' ||
      capability.revision !== approval.capabilityRevision || consent?.id !== approval.styleConsentId ||
      consent.workId !== work.id || consent.ownerUserId !== work.ownerUserId || consent.status !== 'active' ||
      consent.manuscriptVersionId !== approval.manuscriptVersionId || consent.revision !== approval.styleConsentRevision ||
      !consent.rightsConfirmed || !consent.aiBranchAllowed || !Number.isFinite(consent.startsAt.getTime()) ||
      consent.startsAt > now || (consent.expiresAt && (!Number.isFinite(consent.expiresAt.getTime()) || consent.expiresAt <= now)) ||
      analysis?.id !== approval.analysisJobId || analysis.workId !== work.id || analysis.status !== 'completed' ||
      analysis.manuscriptVersionId !== approval.manuscriptVersionId || analysis.analysisVersion !== approval.analysisVersion ||
      (approval.generationProfileId ? !profile || profile.id !== approval.generationProfileId ||
        profile.workId !== work.id || profile.ownerUserId !== work.ownerUserId ||
        profile.manuscriptVersionId !== approval.manuscriptVersionId || profile.status !== 'approved' ||
        profile.reviewRevision !== approval.generationProfileRevision ||
        profile.approvedFingerprint !== approval.generationProfileFingerprint || profile.analysisJobId !== analysis.id
        : Boolean(profile) || approval.generationProfileRevision !== null || approval.generationProfileFingerprint !== null)) {
      return withheldNextCost('approval_pins_changed');
    }
    if (profile) {
      try { continuationGenerationProfileSnapshot(profile); }
      catch (error) {
        return withheldNextCost(error instanceof Error && error.message === 'generation_profile_context_too_large'
          ? 'approved_profile_context_too_large' : 'approval_pins_changed');
      }
    }
    const maximum = capability.hardBudgetKrw;
    if (!maximum || !maximum.isFinite() || maximum.lte(0) || maximum.decimalPlaces() > 6) {
      return withheldNextCost('invalid_next_maximum');
    }
    if (maximum.gt(remaining)) return withheldNextCost('next_cost_exceeds_remaining');
    // One author-trial attempt's reservation ceiling, not a provider estimate or a dispatch grant.
    return { nextMaximumCostKrw: maximum.toFixed(6), nextCostQuoteState: 'prepared', nextCostQuoteReason: null };
  }
}

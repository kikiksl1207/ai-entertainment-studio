import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type StoryAuthorBodyTrialApproval } from '@prisma/client';
import { isUUID } from 'class-validator';
import { StoryAuthorBodyTrialCostService } from './story-author-body-trial-cost.service';
import { StoryAuthorBodyTrialBudgetError, summarizeApprovedAuthorBodyTrialCosts } from './story-author-body-trial-budget.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';

export type AuthorBodyTrialScope = { workId: string; approvalId: string };

@Injectable()
export class StoryAuthorBodyTrialService {
  constructor(private readonly costs: StoryAuthorBodyTrialCostService) {}

  private changed(code = 'STORY_AUTHOR_BODY_TRIAL_APPROVAL_CHANGED'): never {
    throw new ConflictException({ code, generationStarted: false });
  }

  async lockWorkTx(tx: Prisma.TransactionClient, userId: string, workId: string) {
    if (![userId, workId].every(id => isUUID(id))) this.changed();
    // Serialize this author's trials, not unrelated readers. SHARE remains compatible with read confirmation.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`story-author-body-trial:${userId}:${workId}`}, 2049))`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR SHARE`);
  }

  async authorizeTx(tx: Prisma.TransactionClient, userId: string, scope: AuthorBodyTrialScope) {
    if (![userId, scope.workId, scope.approvalId].every(id => isUUID(id))) this.changed();
    await this.lockWorkTx(tx, userId, scope.workId);
    const work = await tx.storyWork.findFirst({ where: { id: scope.workId, ownerUserId: userId,
      status: 'published', fixtureSource: false } });
    if (!work) throw new NotFoundException({ code: 'STORY_AUTHOR_BODY_TRIAL_UNAVAILABLE' });
    // No caller amount and no implicit grant: only a separately recorded, scoped approval is usable.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_author_body_trial_approvals
      WHERE id = ${scope.approvalId}::uuid FOR SHARE`);
    const approval = await tx.storyAuthorBodyTrialApproval.findFirst({ where: {
      id: scope.approvalId, userId, workId: scope.workId, status: 'active', expiresAt: { gt: new Date() },
    } });
    if (!approval || !work.activeReleaseId || work.activeReleaseId !== approval.releaseId ||
      approval.approvedBudgetKrw.lte(0) || approval.approvedBudgetKrw.gt(10000)) this.changed();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_releases WHERE id = ${approval.releaseId}::uuid FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_release_capabilities WHERE release_id = ${approval.releaseId}::uuid FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_style_profile_consents WHERE id = ${approval.styleConsentId}::uuid FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_analysis_jobs WHERE id = ${approval.analysisJobId}::uuid FOR SHARE`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles
      WHERE work_id = ${work.id}::uuid AND manuscript_version_id = ${approval.manuscriptVersionId}::uuid
      ORDER BY profile_version DESC LIMIT 1 FOR SHARE`);
    const now = new Date();
    const release = await tx.storyRelease.findFirst({ where: { id: approval.releaseId, workId: work.id, status: 'active' } });
    const capability = await tx.storyReleaseCapability.findUnique({ where: { releaseId: approval.releaseId } });
    const consent = await tx.storyStyleProfileConsent.findUnique({ where: { id: approval.styleConsentId } });
    const analysis = await tx.storyAnalysisJob.findFirst({ where: { workId: work.id,
      manuscriptVersionId: approval.manuscriptVersionId, status: 'completed' },
      orderBy: [{ analysisVersion: 'desc' }, { createdAt: 'desc' }] });
    const profile = await tx.storyWorkGenerationProfile.findFirst({ where: { workId: work.id,
      manuscriptVersionId: approval.manuscriptVersionId }, orderBy: { profileVersion: 'desc' } });
    if (!release || release.version !== work.publishedVersion ||
      release.manuscriptVersionId !== approval.manuscriptVersionId || release.checksum !== approval.releaseChecksum ||
      capability?.status !== 'active' || capability.revision !== approval.capabilityRevision ||
      consent?.status !== 'active' || consent.workId !== work.id || consent.ownerUserId !== userId ||
      consent.manuscriptVersionId !== approval.manuscriptVersionId || consent.revision !== approval.styleConsentRevision ||
      !consent.rightsConfirmed || !consent.aiBranchAllowed || consent.startsAt > now ||
      (consent.expiresAt && consent.expiresAt <= now) || analysis?.id !== approval.analysisJobId ||
      analysis.analysisVersion !== approval.analysisVersion ||
      (approval.generationProfileId ? !profile || profile.id !== approval.generationProfileId ||
        profile.ownerUserId !== userId || profile.status !== 'approved' || profile.reviewRevision !== approval.generationProfileRevision ||
        profile.approvedFingerprint !== approval.generationProfileFingerprint ||
        profile.analysisJobId !== analysis.id
        : Boolean(profile) || approval.generationProfileRevision !== null || approval.generationProfileFingerprint !== null)) {
      this.changed();
    }
    if (profile) {
      try { continuationGenerationProfileSnapshot(profile); } catch { this.changed(); }
    }
    return approval;
  }

  async guardOrdinaryRequestTx(tx: Prisma.TransactionClient, userId: string, workId: string) {
    const trial = await tx.storyAuthorBodyTrialApproval.findFirst({ where: { userId, workId, status: 'active' } });
    if (trial) this.changed('STORY_AUTHOR_BODY_TRIAL_PRIVATE_REQUEST_REQUIRED');
  }

  async assertCommittedBudgetTx(tx: Prisma.TransactionClient, approval: StoryAuthorBodyTrialApproval) {
    try {
      const summary = summarizeApprovedAuthorBodyTrialCosts(await this.costs.snapshotTx(tx, approval.userId, approval.workId), approval);
      if (summary.unknownCostCount) this.changed('STORY_AUTHOR_BODY_TRIAL_COST_UNKNOWN');
      if (new Prisma.Decimal(summary.committedCostKrw).gt(approval.approvedBudgetKrw)) {
        this.changed('STORY_AUTHOR_BODY_TRIAL_BUDGET_EXCEEDED');
      }
      return { ...summary, approvedBudgetKrw: approval.approvedBudgetKrw.toFixed(6) };
    } catch (error) {
      if (!(error instanceof StoryAuthorBodyTrialBudgetError)) throw error;
      this.changed('STORY_AUTHOR_BODY_TRIAL_COST_EVIDENCE_INCOMPLETE');
    }
  }

  async authorizeDispatchTx(tx: Prisma.TransactionClient, continuation: {
    authorBodyTrialApprovalId: string | null; userId: string; workId: string; releaseId: string;
    manuscriptVersionId: string | null; styleConsentId: string; styleConsentRevision: number;
    capabilityRevision: number; analysisJobId: string | null; analysisVersion: number | null; maxAttempts: number;
  }) {
    if (!continuation.authorBodyTrialApprovalId) return true;
    try {
      const approval = await this.authorizeTx(tx, continuation.userId, {
        workId: continuation.workId, approvalId: continuation.authorBodyTrialApprovalId,
      });
      if (continuation.releaseId !== approval.releaseId || continuation.manuscriptVersionId !== approval.manuscriptVersionId ||
        continuation.styleConsentId !== approval.styleConsentId || continuation.styleConsentRevision !== approval.styleConsentRevision ||
        continuation.capabilityRevision !== approval.capabilityRevision || continuation.analysisJobId !== approval.analysisJobId ||
        continuation.analysisVersion !== approval.analysisVersion || continuation.maxAttempts !== 1) return false;
      await this.assertCommittedBudgetTx(tx, approval);
      return true;
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) return false;
      throw error;
    }
  }
}

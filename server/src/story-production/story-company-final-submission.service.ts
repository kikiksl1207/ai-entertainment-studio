import { BeforeApplicationShutdown, ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { resolveCompanyPrivateIntakeSource } from './story-company-source.policy';
import { assertCompanyFinalSubmissionCurrent, COMPANY_FINAL_SUBMISSION_ACTION, COMPANY_FINAL_SUBMISSION_CONTRACT,
  COMPANY_FINAL_SUBMISSION_PREFIX, companyFinalBindingHash, companyFinalEmptyDecision,
  readCompanyFinalSubmissionBinding } from './story-company-final-submission.policy';

type BootstrapProfile = {
  id: string; createdAt: string; ownerUserId: string; workId: string;
  manuscriptVersionId: string; analysisJobId: string;
};

@Injectable()
export class StoryCompanyFinalSubmissionService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(StoryCompanyFinalSubmissionService.name);
  private bootstrapRecovery?: Promise<void>;
  private bootstrapStopping = false;
  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (this.bootstrapStopping || this.bootstrapRecovery) return;
    const recovery: Promise<void> = this.recoverApprovedCompanySubmissions().catch((error: unknown) => {
      this.logger.warn(`Company manuscript submission recovery stopped: ${this.bootstrapErrorName(error)}`);
    }).finally(() => {
      if (this.bootstrapRecovery === recovery) this.bootstrapRecovery = undefined;
    });
    this.bootstrapRecovery = recovery;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.bootstrapStopping = true;
    await this.bootstrapRecovery;
  }

  private async recoverApprovedCompanySubmissions() {
    const batchSize = 100;
    const startedAt = Date.now();
    let after: Pick<BootstrapProfile, 'createdAt' | 'id'> | null = null;
    for (let page = 0; page < 10; page++) {
      if (this.bootstrapStopping) return;
      if (Date.now() - startedAt >= 10000) {
        this.logger.warn('Company manuscript submission recovery reached the 10-second time limit');
        return;
      }
      // Text preserves the database timestamp's microseconds across keyset pages.
      const pending: BootstrapProfile[] = await this.prisma.$queryRaw<BootstrapProfile[]>(Prisma.sql`
        SELECT profile.id, profile.created_at::text AS "createdAt",
          profile.owner_user_id AS "ownerUserId", profile.work_id AS "workId",
          profile.manuscript_version_id AS "manuscriptVersionId", profile.analysis_job_id AS "analysisJobId"
        FROM story_work_generation_profiles AS profile
        JOIN story_works AS work ON work.id = profile.work_id AND work.owner_user_id = profile.owner_user_id
        WHERE profile.status = ${'approved'} AND work.author_display_name = ${'루미나'}
          AND work.fixture_source = false AND work.status = ${'draft'}
          ${after ? Prisma.sql`AND (profile.created_at, profile.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)` : Prisma.empty}
        ORDER BY profile.created_at ASC, profile.id ASC LIMIT ${batchSize}
      `);
      for (const profile of pending) {
        if (this.bootstrapStopping) return;
        if (Date.now() - startedAt >= 10000) {
          this.logger.warn('Company manuscript submission recovery reached the 10-second time limit');
          return;
        }
        try {
          await this.autoSubmitCompletedAnalysis(profile.ownerUserId, profile.workId,
            profile.manuscriptVersionId, profile.analysisJobId);
        } catch (error) {
          this.logger.warn(`Company manuscript submission recovery skipped: ${this.bootstrapErrorName(error)}`);
        }
      }
      if (pending.length < batchSize) return;
      const last: BootstrapProfile = pending[pending.length - 1];
      after = { createdAt: last.createdAt, id: last.id };
    }
    this.logger.warn('Company manuscript submission recovery reached the 1000-profile scan limit');
  }

  private bootstrapErrorName(error: unknown) {
    if (error instanceof ConflictException) return 'ConflictException';
    if (error instanceof Prisma.PrismaClientKnownRequestError) return 'PrismaClientKnownRequestError';
    return error instanceof Error ? 'Error' : 'unknown error';
  }

  async currentSubmittedReview(ownerUserId: string, reviewId: string) {
    const review = await this.prisma.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId } });
    if (!review || review.state !== 'submitted') return null;
    const submission = await this.prisma.storyFinalSubmission.findUnique({ where: { reviewId } });
    if (!submission?.idempotencyKey.startsWith(COMPANY_FINAL_SUBMISSION_PREFIX)) return null;
    const manuscript = await this.prisma.storyManuscriptVersion.findFirst({ where: { workId: review.workId, ownerUserId },
      orderBy: { version: 'desc' } });
    if (!manuscript) return null;
    const authority = await assertCompanyFinalSubmissionCurrent(this.prisma, {
      ownerUserId, workId: review.workId, review, manuscript, submission });
    return { review, submission, bindingHash: authority!.bindingHash,
      approvalBasis: 'company_delegation' as const, idempotentReplay: true };
  }

  async autoSubmitReview(ownerUserId: string, reviewId: string, expectedRevision: number) {
    const owned = await this.prisma.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId } });
    if (!owned) return null;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${owned.workId}::uuid FOR UPDATE`);
      return this.submitInTransaction(tx, ownerUserId, owned.workId, reviewId, expectedRevision);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
  }

  async autoSubmitCompletedAnalysis(ownerUserId: string, workId: string, manuscriptVersionId: string, analysisJobId: string) {
    if (![ownerUserId, workId, manuscriptVersionId, analysisJobId].every(id => isUUID(id))) return null;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${workId}::uuid FOR UPDATE`);
      const work = await tx.storyWork.findFirst({ where: { id: workId, ownerUserId } });
      if (!work || work.status !== 'draft' || work.fixtureSource || work.authorDisplayName !== '루미나' ||
          await tx.storyAuthoredImport.findUnique({ where: { workId } })) return null;
      const manuscript = await tx.storyManuscriptVersion.findFirst({ where: { workId, ownerUserId },
        orderBy: { version: 'desc' } });
      if (!manuscript || manuscript.id !== manuscriptVersionId ||
          !await resolveCompanyPrivateIntakeSource(tx, ownerUserId, workId, manuscript)) return null;
      const existing = await tx.storyWriterReview.findFirst({ where: {
        workId, ownerUserId, manuscriptVersionId, analysisJobId } });
      if (existing) return this.submitInTransaction(tx, ownerUserId, workId, existing.id, existing.revision);
      const history = await tx.storyWriterReview.findMany({ where: { workId, manuscriptVersionId }, take: 1001 });
      if (history.length > 1000 || history.some(row => row.state !== 'analysis_ready' || row.revision !== 1 ||
          row.submittedAt || !companyFinalEmptyDecision(row.decisions) || !companyFinalEmptyDecision(row.finalSummary))) return null;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${workId}::uuid FOR SHARE`);
      const identity = { id: randomUUID(), workId, ownerUserId, manuscriptVersionId, analysisJobId };
      if (!await readCompanyFinalSubmissionBinding(tx, ownerUserId, workId, identity)) return null;
      // Creation and delegation share one transaction; a failed receipt must not leave an automatic review.
      const review = await tx.storyWriterReview.create({ data: { ...identity, state: 'analysis_ready' } });
      const submitted = await this.submitInTransaction(tx, ownerUserId, workId, review.id, review.revision);
      if (!submitted) throw new ConflictException({ code: 'COMPANY_FINAL_SUBMISSION_CHANGED',
        message: 'The current company manuscript submission must be checked again' });
      return submitted;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 30000 });
  }

  private async submitInTransaction(tx: Prisma.TransactionClient, ownerUserId: string, workId: string,
    reviewId: string, expectedRevision: number) {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_writer_reviews WHERE id = ${reviewId}::uuid FOR UPDATE`);
      const review = await tx.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId } });
      if (!review || review.workId !== workId) return null;
      if (review.revision !== expectedRevision) throw new ConflictException({ code: 'COMPANY_FINAL_REVIEW_CHANGED',
        message: 'The current manuscript review must be used' });
      const work = await tx.storyWork.findFirst({ where: { id: review.workId, ownerUserId } });
      if (!work || work.fixtureSource || work.authorDisplayName !== '루미나' ||
          await tx.storyAuthoredImport.findUnique({ where: { workId: work.id } })) return null;
      const manuscript = await tx.storyManuscriptVersion.findFirst({ where: { workId: work.id, ownerUserId },
        orderBy: { version: 'desc' } });
      if (!manuscript || manuscript.id !== review.manuscriptVersionId) return null;
      const existing = await tx.storyFinalSubmission.findUnique({ where: { reviewId } });
      if (existing) {
        if (!existing.idempotencyKey.startsWith(COMPANY_FINAL_SUBMISSION_PREFIX)) return null;
        const authority = await assertCompanyFinalSubmissionCurrent(tx, { ownerUserId, workId: work.id, review, manuscript, submission: existing });
        return { review, submission: existing, bindingHash: authority!.bindingHash,
          approvalBasis: 'company_delegation' as const, idempotentReplay: true };
      }
      if (review.state !== 'analysis_ready' || review.revision !== 1 || review.submittedAt ||
          !companyFinalEmptyDecision(review.decisions) || !companyFinalEmptyDecision(review.finalSummary) ||
          !await resolveCompanyPrivateIntakeSource(tx, ownerUserId, work.id, manuscript)) return null;
      const history = await tx.storyWriterReview.findMany({ where: { workId: work.id,
        manuscriptVersionId: manuscript.id, id: { not: review.id } }, take: 1001 });
      if (history.length > 1000 || history.some(row => row.state !== 'analysis_ready' || row.revision !== 1 ||
          row.submittedAt || !companyFinalEmptyDecision(row.decisions) || !companyFinalEmptyDecision(row.finalSummary))) return null;
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_work_generation_profiles WHERE work_id = ${work.id}::uuid FOR SHARE`);
      const binding = await readCompanyFinalSubmissionBinding(tx, ownerUserId, work.id, review);
      if (!binding) return null;
      const receiptBinding = { ...binding, beforeReviewRevision: review.revision, submittedReviewRevision: review.revision + 1 };
      const bindingHash = companyFinalBindingHash(receiptBinding);
      const submission = await tx.storyFinalSubmission.create({ data: { reviewId,
        manuscriptVersionId: manuscript.id, checksum: manuscript.contentHash,
        idempotencyKey: `${COMPANY_FINAL_SUBMISSION_PREFIX}${bindingHash}` } });
      const changed = await tx.storyWriterReview.updateMany({ where: { id: review.id, ownerUserId,
        workId: work.id, manuscriptVersionId: manuscript.id, analysisJobId: review.analysisJobId,
        state: 'analysis_ready', revision: expectedRevision, submittedAt: null,
        decisions: { equals: {} }, finalSummary: { equals: {} } },
        data: { state: 'submitted', revision: { increment: 1 }, submittedAt: new Date(), updatedAt: new Date() } });
      if (changed.count !== 1) throw new ConflictException({ code: 'COMPANY_FINAL_REVIEW_CHANGED',
        message: 'The current manuscript review must be used' });
      await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'system',
        action: COMPANY_FINAL_SUBMISSION_ACTION, targetType: 'story_final_submission', targetId: submission.id,
        beforeData: { state: review.state, revision: review.revision },
        afterData: { state: 'submitted', revision: review.revision + 1 },
        metadata: { contract: COMPANY_FINAL_SUBMISSION_CONTRACT, approvalBasis: 'company_delegation',
          scope: 'manuscript_submission', binding: receiptBinding, bindingHash,
          humanSemanticReview: false, publication: false, sharedReuse: false } as unknown as Prisma.InputJsonValue } });
      const current = await tx.storyWriterReview.findUniqueOrThrow({ where: { id: review.id } });
      return { review: current, submission, bindingHash, approvalBasis: 'company_delegation' as const, idempotentReplay: false };
  }
}

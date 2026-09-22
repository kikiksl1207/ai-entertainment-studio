import { HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorReviewConfirmationDto, AuthorReviewProposalDto } from './dto/story-author-final-review.dto';
import { verifyAuthoredImportDraftTx } from './story-authored-import.service';
import {
  AUTHOR_FINAL_REVIEW_VERSION, AUTHOR_WHOLE_PART_MAPPING, authorReviewConflict,
  verifiedWholePartReferences, type AuthorReviewSnapshot,
} from './story-author-final-review.policy';
import { authorContentChecksum, authorReviewSnapshotHash, createAuthorFinalSubmissionTx, lockAuthorMaterializedRows } from './story-author-final-review.store';

@Injectable()
export class StoryAuthorFinalReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async propose(ownerUserId: string, reviewId: string, body: AuthorReviewProposalDto) {
    return this.transaction(async tx => {
      const prepared = await this.prepare(tx, ownerUserId, reviewId, body);
      return { proposalId: prepared.proposalHash, proposalHash: prepared.proposalHash,
        approval: 'proposed' as const, snapshot: prepared.snapshot };
    }, Prisma.TransactionIsolationLevel.RepeatableRead);
  }

  async confirm(ownerUserId: string, reviewId: string, body: AuthorReviewConfirmationDto, key: string) {
    return this.transaction(async tx => {
      const owned = await this.ownedReview(tx, ownerUserId, reviewId);
      await lockAuthorMaterializedRows(tx, owned.workId);
      await this.ownedReview(tx, ownerUserId, reviewId);
      if (typeof key !== 'string' || !key.length || key.length > 200 ||
          !Array.isArray(body.reviewedScopes) || body.reviewedScopes.length < 1 || body.reviewedScopes.length > 2 ||
          body.reviewedScopes.some(scope => !['authored_publication', 'continuation_anchor'].includes(scope)) ||
          new Set(body.reviewedScopes).size !== body.reviewedScopes.length) {
        authorReviewConflict('AUTHOR_FINAL_REVIEW_CONFIRMATION_INVALID');
      }
      const existingKey = await tx.storyFinalSubmission.findUnique({ where: { idempotencyKey: key } });
      const existingReview = await tx.storyFinalSubmission.findUnique({ where: { reviewId } });
      if (existingKey && (existingKey.reviewId !== reviewId || existingKey.manuscriptVersionId !== owned.manuscriptVersionId)) {
        authorReviewConflict('AUTHOR_FINAL_REVIEW_IDEMPOTENCY_CONFLICT');
      }
      if (existingKey || existingReview) {
        const existing = existingKey ?? existingReview!;
        const proof = await tx.storyAuthorFinalReviewProof.findUnique({ where: { finalSubmissionId: existing.id } });
        if (!proof) authorReviewConflict('AUTHOR_LEGACY_SUBMISSION_PROOF_UNSUPPORTED');
        const snapshot = proof.bindingSnapshot as unknown as AuthorReviewSnapshot;
        const scopes = body.includeContinuationAnchor ? ['authored_publication', 'continuation_anchor'] : ['authored_publication'];
        if (existing.idempotencyKey !== key || proof.ownerUserId !== ownerUserId || proof.reviewId !== reviewId ||
            proof.proposalHash !== body.proposalHash || proof.reviewRevision !== body.expectedRevision ||
            proof.releaseId !== body.releaseId || proof.anchorScope !== Boolean(body.includeContinuationAnchor) ||
            JSON.stringify([...body.reviewedScopes].sort()) !== JSON.stringify([...scopes].sort()) ||
            (snapshot.anchorPolicy && snapshot.anchorPolicy.minGeneratedSegments !== body.minGeneratedSegments)) {
          authorReviewConflict('AUTHOR_FINAL_REVIEW_IDEMPOTENCY_CONFLICT');
        }
        const revoked = await tx.storyAuthorFinalReviewRevocation.findUnique({ where: { proofId: proof.id } });
        return { submissionId: existing.id, status: existing.status, proofId: proof.id, proofHash: proof.proofHash,
          proofStatus: revoked ? 'revoked' : 'recorded', idempotentReplay: true };
      }
      const prepared = await this.prepare(tx, ownerUserId, reviewId, body);
      if (!['final_confirmation', 'submission_failed'].includes(prepared.review.state) ||
          prepared.proposalHash !== body.proposalHash || !Array.isArray(body.reviewedScopes) ||
          JSON.stringify([...body.reviewedScopes].sort()) !== JSON.stringify([...prepared.snapshot.reviewedScopes].sort())) {
        authorReviewConflict('AUTHOR_FINAL_REVIEW_CONFIRMATION_STALE');
      }
      const issues = await tx.storyContinuityIssue.findMany({ where: { workId: owned.workId, analysisJobId: owned.analysisJobId,
        status: 'open', pathScope: 'author_original', pathKey: 'author_original' }, select: { severity: true } });
      const decisions = prepared.review.decisions as Record<string, unknown>;
      if (issues.some(issue => issue.severity === 'critical') ||
          (issues.some(issue => issue.severity === 'warning') && decisions?.warningAcknowledged !== true)) {
        authorReviewConflict('AUTHOR_FINAL_REVIEW_CONTINUITY_BLOCKED');
      }
      const submission = await createAuthorFinalSubmissionTx(tx, { reviewId, manuscriptVersionId: owned.manuscriptVersionId,
        idempotencyKey: key, checksum: prepared.snapshot.manuscriptContentHash });
      const proofId = randomUUID();
      const proofHash = await authorReviewSnapshotHash(tx, { proofId, finalSubmissionId: submission.id, proposalHash: prepared.proposalHash });
      await tx.storyAuthorFinalReviewProof.create({ data: { id: proofId, finalSubmissionId: submission.id, reviewId,
        reviewRevision: body.expectedRevision, ownerUserId, workId: owned.workId, manuscriptVersionId: owned.manuscriptVersionId,
        releaseId: body.releaseId, authoredImportId: prepared.snapshot.receiptId, contractVersion: AUTHOR_FINAL_REVIEW_VERSION,
        proposalHash: prepared.proposalHash, contentChecksum: prepared.snapshot.contentChecksum,
        anchorScope: Boolean(body.includeContinuationAnchor), bindingSnapshot: prepared.snapshot as unknown as Prisma.InputJsonValue, proofHash } });
      const updated = await tx.storyWriterReview.updateMany({ where: { id: reviewId, ownerUserId,
        revision: body.expectedRevision, state: prepared.review.state }, data: { state: 'submitted',
        revision: { increment: 1 }, submittedAt: new Date(), updatedAt: new Date() } });
      if (updated.count !== 1) authorReviewConflict('AUTHOR_FINAL_REVIEW_CONFIRMATION_STALE');
      await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user', action: 'story_author_final_review.confirmed',
        targetType: 'story_work', targetId: owned.workId, metadata: { proofId, proofHash, anchorScope: Boolean(body.includeContinuationAnchor) } } });
      return { submissionId: submission.id, status: submission.status, proofId, proofHash, proofStatus: 'recorded', idempotentReplay: false };
    }, Prisma.TransactionIsolationLevel.Serializable, true);
  }

  async revoke(ownerUserId: string, proofId: string) {
    return this.transaction(async tx => {
      const proof = await tx.storyAuthorFinalReviewProof.findFirst({ where: { id: proofId, ownerUserId } });
      if (!proof) throw new NotFoundException('Author review proof not found');
      await tx.$queryRaw(Prisma.sql`SELECT id FROM story_works WHERE id = ${proof.workId}::uuid FOR UPDATE`);
      await this.ownedReview(tx, ownerUserId, proof.reviewId);
      const prior = await tx.storyAuthorFinalReviewRevocation.findUnique({ where: { proofId } });
      if (!prior) {
        await tx.storyAuthorFinalReviewRevocation.create({ data: { proofId, actorUserId: ownerUserId, reasonCode: 'author_withdrawn' } });
        await tx.auditEvent.create({ data: { actorUserId: ownerUserId, actorType: 'user', action: 'story_author_final_review.revoked',
          targetType: 'story_work', targetId: proof.workId, metadata: { proofId } } });
      }
      return { proofId, proofStatus: 'revoked', idempotentReplay: Boolean(prior) };
    }, Prisma.TransactionIsolationLevel.Serializable, true);
  }

  private async transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel, retryConflict = false): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(run, { isolationLevel, maxWait: 2000, timeout: 30000 });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) {
          if (retryConflict && attempt < 2) continue;
          authorReviewConflict('AUTHOR_FINAL_REVIEW_CONCURRENT_CHANGE');
        }
        // A lost commit response is not proof of rollback. A bound replay reconciles it.
        throw new ServiceUnavailableException({ code: 'AUTHOR_FINAL_REVIEW_PERSISTENCE_UNKNOWN',
          message: 'Author review persistence could not be confirmed' });
      }
    }
    return authorReviewConflict('AUTHOR_FINAL_REVIEW_CONCURRENT_CHANGE');
  }

  private async ownedReview(tx: Prisma.TransactionClient, ownerUserId: string, reviewId: string) {
    const review = await tx.storyWriterReview.findFirst({ where: { id: reviewId, ownerUserId } });
    const work = review ? await tx.storyWork.findFirst({ where: { id: review.workId, ownerUserId } }) : null;
    if (!review || !work) throw new NotFoundException('Writer review not found');
    return review;
  }

  private async prepare(tx: Prisma.TransactionClient, ownerUserId: string, reviewId: string, body: AuthorReviewProposalDto) {
    const review = await this.ownedReview(tx, ownerUserId, reviewId);
    if (review.revision !== body.expectedRevision || review.state === 'submitted' ||
        await tx.storyFinalSubmission.findUnique({ where: { reviewId } })) authorReviewConflict('AUTHOR_NEW_SUBMISSION_REQUIRED');
    const verified = await verifyAuthoredImportDraftTx(tx, review.workId, body.releaseId);
    const analysis = await tx.storyAnalysisJob.findFirst({ where: { id: review.analysisJobId, workId: review.workId,
      manuscriptVersionId: review.manuscriptVersionId, status: 'completed' } });
    if (!verified || !analysis || verified.manuscript.id !== review.manuscriptVersionId ||
        verified.work.ownerUserId !== ownerUserId || verified.receipt.ownerUserId !== ownerUserId) authorReviewConflict('AUTHOR_FINAL_REVIEW_BINDING_CHANGED');
    if (!Number.isSafeInteger(body.minGeneratedSegments) || body.minGeneratedSegments < 1 || body.minGeneratedSegments > 1000) {
      authorReviewConflict('AUTHOR_ENDING_POLICY_INVALID');
    }
    const snapshot: AuthorReviewSnapshot = {
      version: AUTHOR_FINAL_REVIEW_VERSION, reviewId, reviewRevision: review.revision, ownerUserId, workId: review.workId,
      manuscriptVersionId: review.manuscriptVersionId, manuscriptContentHash: verified.manuscript.contentHash,
      releaseId: verified.release.id, releaseChecksum: verified.release.checksum, receiptId: verified.receipt.id,
      sourceMapSha256: verified.receipt.sourceMapSha256, planChecksum: verified.receipt.planChecksum,
      draftMaterializedChecksum: verified.receipt.materializedChecksum, contentChecksum: await authorContentChecksum(tx, review.workId),
      mappingVersion: AUTHOR_WHOLE_PART_MAPPING, sourceLocale: verified.receipt.locale,
      endingResolution: verified.receipt.endingResolution,
      reviewedScopes: body.includeContinuationAnchor ? ['authored_publication', 'continuation_anchor'] : ['authored_publication'],
      anchorPolicy: body.includeContinuationAnchor ? { version: 'author-branch-resolution-v1', minGeneratedSegments: body.minGeneratedSegments } : null,
      parts: verifiedWholePartReferences(verified.snapshot, verified.receipt.provenance, verified.receipt.locale, Boolean(body.includeContinuationAnchor)),
    };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 1_500_000) authorReviewConflict('AUTHOR_REVIEW_PROPOSAL_LIMIT');
    return { review, snapshot, proposalHash: await authorReviewSnapshotHash(tx, snapshot) };
  }
}

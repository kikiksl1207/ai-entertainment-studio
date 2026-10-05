import { ConflictException } from '@nestjs/common';
import { Prisma, StoryFinalSubmission, StoryManuscriptVersion, StoryWriterReview } from '@prisma/client';
import { createHash } from 'crypto';
import { stableJson } from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { resolveCompanyPrivateSubmissionSource } from './story-company-source.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

export const COMPANY_FINAL_SUBMISSION_CONTRACT = 'story-company-final-submission-v1';
export const COMPANY_FINAL_SUBMISSION_PREFIX = 'story-company-final-v1:';
export const COMPANY_FINAL_SUBMISSION_ACTION = 'story.final_submission.company_delegated';

type BindingDb = Pick<Prisma.TransactionClient, 'storyWork' | 'storyManuscriptVersion' |
  'storyAnalysisJob' | 'storyWorkGenerationProfile' |
  'storyContinuityIssue' | 'storyPublicationImportJob' | 'storyRelease' | 'storyPublicationTransition' | 'auditEvent'>;

export function companyFinalBindingHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function companyFinalEmptyDecision(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;
}

export async function readCompanyFinalSubmissionBinding(
  db: BindingDb, ownerUserId: string, workId: string,
  review: Pick<StoryWriterReview, 'id' | 'workId' | 'ownerUserId' | 'manuscriptVersionId' | 'analysisJobId'>,
) {
  if (review.workId !== workId || review.ownerUserId !== ownerUserId) return null;
  const manuscript = await db.storyManuscriptVersion.findFirst({ where: { workId, ownerUserId },
    orderBy: { version: 'desc' } });
  if (!manuscript || manuscript.workId !== workId || manuscript.ownerUserId !== ownerUserId ||
      manuscript.id !== review.manuscriptVersionId || manuscript.locale !== 'ko' ||
      !/^[a-f0-9]{64}$/.test(manuscript.contentHash)) return null;
  const source = await resolveCompanyPrivateSubmissionSource(db, ownerUserId, workId, manuscript);
  if (!source) return null;
  const analysis = await db.storyAnalysisJob.findFirst({ where: { workId,
    manuscriptVersionId: manuscript.id, pipeline: SEMANTIC_PIPELINE }, orderBy: { analysisVersion: 'desc' } });
  if (!analysis || analysis.workId !== workId || analysis.manuscriptVersionId !== manuscript.id ||
      analysis.id !== review.analysisJobId || analysis.status !== 'completed' || analysis.pipeline !== SEMANTIC_PIPELINE ||
      analysis.sourceLocale !== manuscript.locale || analysis.sourceContentHash !== manuscript.contentHash ||
      !Number.isSafeInteger(analysis.analysisVersion) || analysis.analysisVersion < 1 ||
      !Number.isSafeInteger(analysis.plannedChunks) || analysis.plannedChunks < 1 ||
      analysis.completedChunks !== analysis.plannedChunks ||
      !Number.isSafeInteger(analysis.totalParagraphs) || analysis.totalParagraphs < 1 ||
      analysis.plannedParagraphs !== analysis.totalParagraphs || analysis.completedParagraphs !== analysis.totalParagraphs) return null;
  const profile = await db.storyWorkGenerationProfile.findFirst({ where: { workId }, orderBy: { profileVersion: 'desc' } });
  const sourceFingerprint = companyFinalBindingHash({ workId, manuscriptVersionId: manuscript.id,
    contentHash: manuscript.contentHash, analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion,
    analysisConfigHash: analysis.configHash });
  if (!profile || profile.ownerUserId !== ownerUserId || profile.workId !== workId ||
      profile.manuscriptVersionId !== manuscript.id || profile.analysisJobId !== analysis.id ||
      profile.status !== 'approved' || profile.sourceFingerprint !== sourceFingerprint ||
      profile.approvedByUserId !== ownerUserId || !profile.approvedAt ||
      !Number.isSafeInteger(profile.profileVersion) || profile.profileVersion < 1 ||
      !Number.isSafeInteger(profile.reviewRevision) || profile.reviewRevision < 1) return null;
  let profilePin;
  try { profilePin = continuationGenerationProfileSnapshot(profile).pin; } catch { return null; }
  const issues = await db.storyContinuityIssue.findMany({ where: { workId, analysisJobId: analysis.id,
    status: 'open', pathScope: 'author_original', pathKey: 'author_original' }, select: { severity: true }, take: 1001 });
  // Delegation is not a person's acknowledgement of an unresolved warning.
  if (issues.length > 1000 || issues.some(issue => issue.severity !== 'info')) return null;
  return { contract: COMPANY_FINAL_SUBMISSION_CONTRACT, scope: 'manuscript_submission',
    ownerUserId, workId, reviewId: review.id, manuscriptVersionId: manuscript.id,
    manuscriptHash: manuscript.contentHash, manuscriptLocale: manuscript.locale, source,
    analysisPin: { id: analysis.id, version: analysis.analysisVersion, configHash: analysis.configHash,
      totalParagraphs: analysis.totalParagraphs },
    profilePin: { ...profilePin, approvedAt: profile.approvedAt.toISOString(), approvedByUserId: profile.approvedByUserId } };
}

export async function assertCompanyFinalSubmissionCurrent(db: BindingDb, input: {
  ownerUserId: string; workId: string; review: StoryWriterReview;
  manuscript: Pick<StoryManuscriptVersion, 'id' | 'workId' | 'ownerUserId' | 'contentHash'>;
  submission: StoryFinalSubmission;
}) {
  if (typeof input.submission.idempotencyKey !== 'string' ||
      !input.submission.idempotencyKey.startsWith(COMPANY_FINAL_SUBMISSION_PREFIX)) return null;
  const { ownerUserId, workId, review, manuscript, submission } = input;
  const reject = (): never => { throw new ConflictException({ code: 'COMPANY_FINAL_SUBMISSION_CHANGED',
    message: 'The company manuscript submission no longer matches the current source' }); };
  if (review.ownerUserId !== ownerUserId || review.workId !== workId || review.state !== 'submitted' ||
      review.revision !== 2 || !review.submittedAt || !companyFinalEmptyDecision(review.decisions) || !companyFinalEmptyDecision(review.finalSummary) ||
      manuscript.ownerUserId !== ownerUserId || manuscript.workId !== workId ||
      manuscript.id !== review.manuscriptVersionId || submission.reviewId !== review.id ||
      submission.manuscriptVersionId !== manuscript.id || submission.checksum !== manuscript.contentHash ||
      submission.status !== 'submitted') reject();
  const binding = await readCompanyFinalSubmissionBinding(db, ownerUserId, workId, review);
  if (!binding) reject();
  const receiptBinding = { ...binding, beforeReviewRevision: 1, submittedReviewRevision: 2 };
  const bindingHash = companyFinalBindingHash(receiptBinding);
  if (submission.idempotencyKey !== `${COMPANY_FINAL_SUBMISSION_PREFIX}${bindingHash}`) reject();
  const audit = await db.auditEvent.findFirst({ where: { actorUserId: ownerUserId, actorType: 'system',
    action: COMPANY_FINAL_SUBMISSION_ACTION, targetType: 'story_final_submission', targetId: submission.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!audit || audit.actorUserId !== ownerUserId || audit.actorType !== 'system' ||
      audit.action !== COMPANY_FINAL_SUBMISSION_ACTION || audit.targetType !== 'story_final_submission' ||
      audit.targetId !== submission.id || companyFinalBindingHash(audit.metadata) !== companyFinalBindingHash({
        contract: COMPANY_FINAL_SUBMISSION_CONTRACT, approvalBasis: 'company_delegation', scope: 'manuscript_submission',
        binding: receiptBinding, bindingHash, humanSemanticReview: false, publication: false, sharedReuse: false })) reject();
  return { approvalBasis: 'company_delegation' as const, bindingHash };
}

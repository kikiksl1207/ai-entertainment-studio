import type { Prisma } from '@prisma/client';
import { brotliDecompressSync } from 'zlib';
import { PUBLICATION_AUTHOR_REVIEW_STATUS } from './story-publication-private-intake.policy';
import { releaseChecksum } from './story-lifecycle.policy';

type CompanySourceDb = Pick<Prisma.TransactionClient,
  'storyWork' | 'storyManuscriptVersion' | 'storyPublicationImportJob' | 'auditEvent'>;

export type CompanyPrivateIntakeSourceProof = {
  companyPrivateIntakeJobId: string; companyPrivateIntakeAuditId: string;
  companySourceBindingSha256: string; companyManuscriptVersionId: string;
};

export type CurrentCompanyPublicationBinding = {
  companyPublishedReleaseId: string; companyReleaseChecksum: string; companyManuscriptVersionId: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function privatePlan(value: unknown): Record<string, unknown> | null {
  const stored = record(value);
  if (!stored) return null;
  if (stored.storageContract === undefined) return stored;
  if (stored.storageContract !== 'story-publication-plan-br-base64-v1' || typeof stored.data !== 'string') return null;
  try {
    // Match the existing intake storage contract and its decompression limit.
    const serialized = brotliDecompressSync(Buffer.from(stored.data, 'base64'), { maxOutputLength: 64 * 1024 * 1024 });
    return record(JSON.parse(serialized.toString('utf8')));
  } catch {
    return null;
  }
}

// The caller holds the work lock. Display credit and cover metadata are not authority on their own.
export async function resolveCompanyPrivateIntakeSource(
  db: CompanySourceDb, ownerUserId: string, workId: string,
  source: { id: string; contentHash: string },
): Promise<CompanyPrivateIntakeSourceProof | null> {
  const work = await db.storyWork.findFirst({
    where: { id: workId, ownerUserId, fixtureSource: false },
    select: { id: true, ownerUserId: true, authorDisplayName: true, fixtureSource: true,
      slug: true, status: true, activeReleaseId: true, publishedAt: true, coverManifest: true },
  });
  if (!work || work.id !== workId || work.ownerUserId !== ownerUserId || work.fixtureSource ||
      work.authorDisplayName !== '루미나' || work.status !== 'draft' || work.activeReleaseId || work.publishedAt) return null;
  const intake = record(record(work.coverManifest)?.privateIntake);
  if (!intake || intake.contract !== 'publication-writer-intake-v1' || typeof intake.jobId !== 'string' ||
      typeof intake.sourceBindingSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(intake.sourceBindingSha256) ||
      intake.manuscriptHash !== source.contentHash) return null;
  const manuscript = await db.storyManuscriptVersion.findFirst({
    where: { workId, ownerUserId }, orderBy: { version: 'desc' },
    select: { id: true, workId: true, ownerUserId: true, contentHash: true },
  });
  if (!manuscript || manuscript.id !== source.id || manuscript.contentHash !== source.contentHash ||
      manuscript.workId !== workId || manuscript.ownerUserId !== ownerUserId) return null;
  const job = await db.storyPublicationImportJob.findFirst({
    where: { id: intake.jobId, workId, actorUserId: ownerUserId, status: PUBLICATION_AUTHOR_REVIEW_STATUS,
      releaseId: null, errorCode: null },
    select: { id: true, workId: true, actorUserId: true, status: true, releaseId: true, errorCode: true,
      storyKey: true, sourceBindingSha256: true, planSnapshot: true },
  });
  if (!job || job.id !== intake.jobId || job.workId !== workId || job.actorUserId !== ownerUserId ||
      job.status !== PUBLICATION_AUTHOR_REVIEW_STATUS || job.releaseId !== null || job.errorCode !== null ||
      job.sourceBindingSha256 !== intake.sourceBindingSha256) return null;
  const plan = privatePlan(job.planSnapshot);
  if (!plan || plan.writerIntakeWorkflow !== 'writer_review_before_choices_v1' || plan.storyKey !== job.storyKey ||
      plan.slug !== work.slug || plan.sourceBindingSha256 !== job.sourceBindingSha256 ||
      record(plan.manuscript)?.contentHash !== manuscript.contentHash ||
      !Array.isArray(plan.parts) || !plan.parts.length || !Array.isArray(plan.prompts)) return null;
  const audit = await db.auditEvent.findFirst({
    where: { actorUserId: ownerUserId, actorType: 'admin', action: 'story_publication.private_writer_intake',
      targetType: 'story_work', targetId: workId, metadata: { path: ['jobId'], equals: job.id } },
    select: { id: true, actorUserId: true, actorType: true, action: true, targetType: true, targetId: true, metadata: true },
  });
  const evidence = record(audit?.metadata);
  if (!audit || audit.actorUserId !== ownerUserId || audit.actorType !== 'admin' ||
      audit.action !== 'story_publication.private_writer_intake' || audit.targetType !== 'story_work' ||
      audit.targetId !== workId || !evidence || evidence.jobId !== job.id ||
      evidence.manuscriptVersionId !== manuscript.id || evidence.manuscriptHash !== manuscript.contentHash ||
      evidence.sourceBindingSha256 !== job.sourceBindingSha256 || evidence.partCount !== plan.parts.length ||
      evidence.analysisStarted !== false || evidence.choicesGenerated !== false || evidence.published !== false) return null;
  return { companyPrivateIntakeJobId: job.id, companyPrivateIntakeAuditId: audit.id,
    companySourceBindingSha256: job.sourceBindingSha256, companyManuscriptVersionId: manuscript.id };
}

// This is a binding guard, not independent authority: pass the release ID from a verified company receipt/audit.
export async function resolveCurrentCompanyPublicationBinding(
  db: Pick<Prisma.TransactionClient, 'storyWork' | 'storyManuscriptVersion' | 'storyRelease'>,
  ownerUserId: string, workId: string, source: { id: string; contentHash: string }, receiptReleaseId: unknown,
): Promise<CurrentCompanyPublicationBinding | null> {
  if (typeof receiptReleaseId !== 'string') return null;
  const work = await db.storyWork.findFirst({
    where: { id: workId, ownerUserId, fixtureSource: false },
    select: { id: true, ownerUserId: true, authorDisplayName: true, fixtureSource: true,
      status: true, activeReleaseId: true, publishedAt: true },
  });
  if (!work || work.id !== workId || work.ownerUserId !== ownerUserId || work.fixtureSource ||
      work.authorDisplayName !== '루미나' || work.status !== 'published' || !work.publishedAt ||
      work.activeReleaseId !== receiptReleaseId) return null;
  const manuscript = await db.storyManuscriptVersion.findFirst({
    where: { workId, ownerUserId }, orderBy: { version: 'desc' },
    select: { id: true, workId: true, ownerUserId: true, contentHash: true },
  });
  if (!manuscript || manuscript.id !== source.id || manuscript.contentHash !== source.contentHash ||
      manuscript.workId !== workId || manuscript.ownerUserId !== ownerUserId) return null;
  const release = await db.storyRelease.findFirst({
    where: { id: receiptReleaseId, workId, manuscriptVersionId: manuscript.id, status: 'active' },
    select: { id: true, workId: true, manuscriptVersionId: true, status: true, checksum: true,
      branchGraphSnapshot: true, endingSetSnapshot: true, sceneAssetManifest: true, localizedDisplaySnapshot: true },
  });
  if (!release || release.id !== receiptReleaseId || release.workId !== workId || release.status !== 'active' ||
      release.manuscriptVersionId !== manuscript.id || release.checksum !== releaseChecksum({
        manuscriptVersionId: release.manuscriptVersionId, branchGraphSnapshot: release.branchGraphSnapshot,
        endingSetSnapshot: release.endingSetSnapshot, sceneAssetManifest: release.sceneAssetManifest,
        localizedDisplaySnapshot: release.localizedDisplaySnapshot,
      })) return null;
  return { companyPublishedReleaseId: release.id, companyReleaseChecksum: release.checksum,
    companyManuscriptVersionId: manuscript.id };
}

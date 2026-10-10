import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import {
  assertCreatorGenerationProfileApprovable, normalizeCreatorGenerationProfile, stableJson,
  type CreatorGenerationProfileSection,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileApprovalPin } from './story-continuation-context.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';
import { STORY_LOCALES } from './story-production.policy';

// Callers own the READ ONLY / RepeatableRead transaction; no execution context is assembled.
export async function readCurrentApprovedStoryStyleSnapshot(
  tx: Prisma.TransactionClient, userId: string, workId: string,
) {
  const work = await tx.storyWork.findFirst({
    where: { id: workId, ownerUserId: userId }, select: { id: true },
  });
  if (!work) throw new NotFoundException('Story work not found');
  const canonicalWorkId = work.id;
  const manuscript = await tx.storyManuscriptVersion.findFirst({
    where: { workId: canonicalWorkId, ownerUserId: userId }, orderBy: { version: 'desc' },
    select: { id: true, version: true, locale: true, contentHash: true },
  });
  if (!manuscript) throw new ConflictException({
    code: 'GENERATION_PROFILE_MANUSCRIPT_REQUIRED', message: 'A current manuscript is required',
  });
  const analysis = await tx.storyAnalysisJob.findFirst({
    where: { workId: canonicalWorkId, manuscriptVersionId: manuscript.id, status: 'completed', pipeline: SEMANTIC_PIPELINE },
    orderBy: { analysisVersion: 'desc' },
    select: { id: true, analysisVersion: true, sourceContentHash: true, configHash: true },
  });
  if (!analysis || analysis.sourceContentHash !== manuscript.contentHash) {
    throw new ServiceUnavailableException({
      code: 'GENERATION_PROFILE_ANALYSIS_REQUIRED', message: 'Current completed manuscript analysis is required',
    });
  }
  const profile = await tx.storyWorkGenerationProfile.findFirst({
    where: { workId: canonicalWorkId }, orderBy: { profileVersion: 'desc' },
    select: {
      id: true, workId: true, ownerUserId: true, manuscriptVersionId: true, analysisJobId: true,
      sourceFingerprint: true, profileVersion: true, reviewRevision: true, status: true,
      approvedSettings: true, approvedFingerprint: true, approvedByUserId: true, approvedAt: true,
    },
  });
  if (!profile || profile.status !== 'approved') throw new ConflictException({
    code: 'GENERATION_PROFILE_APPROVED_STYLE_REQUIRED', message: 'The current profile must be approved',
  });
  const sourceFingerprint = createHash('sha256').update(stableJson({
    workId: work.id, manuscriptVersionId: manuscript.id, contentHash: manuscript.contentHash,
    analysisJobId: analysis.id, analysisVersion: analysis.analysisVersion, analysisConfigHash: analysis.configHash,
  })).digest('hex');
  if (profile.workId !== canonicalWorkId || profile.ownerUserId !== userId
    || profile.manuscriptVersionId !== manuscript.id || profile.analysisJobId !== analysis.id
    || profile.sourceFingerprint !== sourceFingerprint) {
    throw new ConflictException({
      code: 'GENERATION_PROFILE_APPROVED_STYLE_STALE', message: 'The approved profile does not match the current source',
    });
  }
  const invalid = () => new ConflictException({
    code: 'GENERATION_PROFILE_APPROVED_STYLE_INVALID', message: 'The approved writing style is not readable',
  });
  let section: CreatorGenerationProfileSection;
  let approvalPin: ReturnType<typeof continuationGenerationProfileApprovalPin>;
  try {
    const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
    if (!positiveInteger(manuscript.version) || !positiveInteger(analysis.analysisVersion)
      || !positiveInteger(profile.profileVersion) || !positiveInteger(profile.reviewRevision)
      || !STORY_LOCALES.includes(manuscript.locale as typeof STORY_LOCALES[number])
      || !/^[a-f0-9]{64}$/i.test(manuscript.contentHash)
      || typeof analysis.configHash !== 'string' || !/^[a-f0-9]{64}$/i.test(analysis.configHash)
      || profile.approvedByUserId !== userId || !(profile.approvedAt instanceof Date)
      || !Number.isFinite(profile.approvedAt.getTime())) throw invalid();
    const settings = normalizeCreatorGenerationProfile('story', profile.approvedSettings);
    assertCreatorGenerationProfileApprovable(settings);
    approvalPin = continuationGenerationProfileApprovalPin(profile);
    section = settings.sections.find(item => item.key === 'writing_style')!;
    const stored = profile.approvedSettings;
    const storedSections = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored.sections : undefined;
    const storedStyle = Array.isArray(storedSections)
      ? storedSections.find(item => item && typeof item === 'object' && !Array.isArray(item) && item.key === 'writing_style') : undefined;
    if (stableJson(storedStyle) !== stableJson(section)) throw invalid();
  } catch {
    throw invalid();
  }
  return {
    approvalPin,
    projection: {
      version: 'story-author-approved-style-v1' as const,
      sourceScope: 'latest_private_manuscript_completed_analysis' as const,
      locale: manuscript.locale, manuscriptVersion: manuscript.version, analysisVersion: analysis.analysisVersion,
      profileVersion: profile.profileVersion, reviewRevision: profile.reviewRevision, section,
      readOnly: true as const, providerCalls: 0 as const, operatingWrites: 0 as const,
      bodySourceAligned: false as const, semanticQualityVerified: false as const,
    },
  };
}

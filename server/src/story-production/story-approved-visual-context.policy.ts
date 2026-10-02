import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { assertCreatorGenerationProfileApprovable, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile, stableJson } from '../generation-profile/creator-generation-profile.policy';
import { approvedStoryVisualSettings } from './story-approved-visual.policy';
import { SEMANTIC_PIPELINE } from './story-semantic-analysis.types';

function fail(): never {
  throw new ConflictException({ code: 'STORY_VISUAL_PROFILE_CHANGED',
    message: 'The current author-approved manuscript and visual settings are required' });
}

export async function currentApprovedStoryVisual(tx: Pick<Prisma.TransactionClient,
  'storyWorkGenerationProfile' | 'storyManuscriptVersion' | 'storyAnalysisJob' | 'storyStyleProfileConsent'>,
  work: { id: string; ownerUserId?: string | null }, manuscriptVersionId?: string | null) {
  // Unanalysed legacy publications retain their existing verified art direction.
  const profile = await tx.storyWorkGenerationProfile.findFirst({ where: { workId: work.id }, orderBy: { profileVersion: 'desc' } });
  const analysis = await tx.storyAnalysisJob.findFirst({ where: { workId: work.id, status: 'completed', pipeline: SEMANTIC_PIPELINE },
    orderBy: [{ analysisVersion: 'desc' }, { id: 'desc' }], select: { id: true, manuscriptVersionId: true,
      analysisVersion: true, configHash: true, sourceContentHash: true, completedParagraphs: true, totalParagraphs: true } });
  if (!profile && !analysis) return null;
  if (!work.ownerUserId || !profile || !analysis || !manuscriptVersionId || profile.workId !== work.id ||
      profile.ownerUserId !== work.ownerUserId || profile.approvedByUserId !== work.ownerUserId ||
      profile.status !== 'approved' || !profile.approvedAt || profile.profileVersion < 1 || profile.reviewRevision < 1 ||
      profile.manuscriptVersionId !== manuscriptVersionId || profile.analysisJobId !== analysis.id) fail();
  const manuscript = await tx.storyManuscriptVersion.findFirst({ where: { workId: work.id, ownerUserId: work.ownerUserId },
    orderBy: { version: 'desc' }, select: { id: true, contentHash: true } });
  const consent = await tx.storyStyleProfileConsent.findUnique({ where: { workId: work.id } });
  const now = new Date();
  if (!manuscript || manuscript.id !== manuscriptVersionId || analysis.manuscriptVersionId !== manuscript.id ||
      analysis.sourceContentHash !== manuscript.contentHash || analysis.completedParagraphs !== analysis.totalParagraphs ||
      analysis.totalParagraphs < 1 || !consent || consent.ownerUserId !== work.ownerUserId ||
      consent.manuscriptVersionId !== manuscript.id || consent.status !== 'active' || !consent.rightsConfirmed ||
      !consent.imageTransformationAllowed || !consent.aiBranchAllowed || !Array.isArray(consent.allowedLocales) ||
      !consent.allowedLocales.includes('ko') || consent.startsAt > now || (consent.expiresAt && consent.expiresAt <= now)) fail();
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: work.id, manuscriptVersionId: manuscript!.id,
    contentHash: manuscript!.contentHash, analysisJobId: analysis!.id, analysisVersion: analysis!.analysisVersion,
    analysisConfigHash: analysis!.configHash })).digest('hex');
  if (sourceFingerprint !== profile!.sourceFingerprint) fail();
  try {
    const settings = normalizeCreatorGenerationProfile('story', profile!.approvedSettings);
    assertCreatorGenerationProfileApprovable(settings);
    if (creatorGenerationProfileFingerprint(sourceFingerprint, settings) !== profile!.approvedFingerprint) fail();
    return approvedStoryVisualSettings(settings, { id: profile!.id, profileVersion: profile!.profileVersion,
      reviewRevision: profile!.reviewRevision, approvedFingerprint: profile!.approvedFingerprint,
      sourceFingerprint, approvedAt: profile!.approvedAt!.toISOString(), consentId: consent!.id, consentRevision: consent!.revision });
  } catch { fail(); }
}

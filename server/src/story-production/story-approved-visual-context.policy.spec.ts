import { createHash, randomUUID } from 'crypto';
import { creatorGenerationProfileFingerprint, normalizeCreatorGenerationProfile, stableJson,
  STORY_PROFILE_SECTION_KEYS } from '../generation-profile/creator-generation-profile.policy';
import { currentApprovedStoryVisual } from './story-approved-visual-context.policy';

export function visualContextFixture() {
  const work = { id: randomUUID(), ownerUserId: randomUUID() };
  const manuscript = { id: randomUUID(), contentHash: 'a'.repeat(64), version: 1, workId: work.id, ownerUserId: work.ownerUserId };
  const analysis = { id: randomUUID(), analysisVersion: 1, workId: work.id, manuscriptVersionId: manuscript.id,
    configHash: 'b'.repeat(64), sourceContentHash: manuscript.contentHash, completedParagraphs: 2, totalParagraphs: 2 };
  const sourceFingerprint = createHash('sha256').update(stableJson({ workId: work.id, manuscriptVersionId: manuscript.id,
    contentHash: manuscript.contentHash, analysisJobId: analysis.id, analysisVersion: 1, analysisConfigHash: analysis.configHash })).digest('hex');
  const settings = normalizeCreatorGenerationProfile('story', { schemaVersion: 'creator-generation-profile-v1', kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({ key, decision: 'accepted', value: { summary: key }, evidence: [] })) });
  const profile = { id: randomUUID(), workId: work.id, ownerUserId: work.ownerUserId, approvedByUserId: work.ownerUserId,
    manuscriptVersionId: manuscript.id, analysisJobId: analysis.id, profileVersion: 1, reviewRevision: 1, status: 'approved',
    approvedAt: new Date(), sourceFingerprint, approvedSettings: settings, approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) };
  const consent = { id: randomUUID(), revision: 1, workId: work.id, ownerUserId: work.ownerUserId,
    manuscriptVersionId: manuscript.id, status: 'active', rightsConfirmed: true, imageTransformationAllowed: true,
    aiBranchAllowed: true, allowedLocales: ['ko'],
    startsAt: new Date(0), expiresAt: null as Date | null };
  const db = { storyWorkGenerationProfile: { findFirst: jest.fn(async () => profile) },
    storyAnalysisJob: { findFirst: jest.fn(async () => analysis) },
    storyManuscriptVersion: { findFirst: jest.fn(async () => manuscript) },
    storyStyleProfileConsent: { findUnique: jest.fn(async () => consent) } };
  return { work, manuscript, analysis, settings, profile, consent, db };
}

describe('current author visual approval binding', () => {
  it('resolves a current owner approval and changes its cache identity even when re-approved without text edits', async () => {
    const f = visualContextFixture();
    const first = await currentApprovedStoryVisual(f.db as never, f.work, f.manuscript.id);
    f.profile.reviewRevision++;
    expect((await currentApprovedStoryVisual(f.db as never, f.work, f.manuscript.id))?.fingerprint).not.toBe(first?.fingerprint);
    f.consent.revision++;
    expect((await currentApprovedStoryVisual(f.db as never, f.work, f.manuscript.id))?.fingerprint).not.toBe(first?.fingerprint);
  });
  it('preserves the existing contract only for publications with neither analysis nor generation profiles', async () => {
    const f = visualContextFixture(); f.db.storyWorkGenerationProfile.findFirst.mockResolvedValue(null as never);
    f.db.storyAnalysisJob.findFirst.mockResolvedValue(null as never);
    expect(await currentApprovedStoryVisual(f.db as never, f.work, f.manuscript.id)).toBeNull();
    expect(f.db.storyStyleProfileConsent.findUnique).not.toHaveBeenCalled();
  });
  it.each(['profile_owner', 'approver', 'status', 'revision', 'manuscript', 'latest_manuscript', 'analysis', 'hash',
    'partial_analysis', 'settings', 'consent', 'image_consent', 'expired', 'source'])('blocks %s without legacy fallback', async kind => {
    const f = visualContextFixture();
    if (kind === 'profile_owner') f.profile.ownerUserId = randomUUID();
    if (kind === 'approver') f.profile.approvedByUserId = randomUUID();
    if (kind === 'status') f.profile.status = 'needs_review';
    if (kind === 'revision') f.profile.reviewRevision = 0;
    if (kind === 'manuscript') f.profile.manuscriptVersionId = randomUUID();
    if (kind === 'latest_manuscript') f.manuscript.id = randomUUID();
    if (kind === 'analysis') f.analysis.id = randomUUID();
    if (kind === 'hash') f.analysis.sourceContentHash = 'c'.repeat(64);
    if (kind === 'partial_analysis') f.analysis.completedParagraphs--;
    if (kind === 'settings') f.settings.sections[0].value.summary = 'unapproved';
    if (kind === 'consent') f.consent.status = 'withdrawn';
    if (kind === 'image_consent') f.consent.imageTransformationAllowed = false;
    if (kind === 'expired') f.consent.expiresAt = new Date(1);
    if (kind === 'source') f.profile.sourceFingerprint = 'c'.repeat(64);
    await expect(currentApprovedStoryVisual(f.db as never, f.work, f.profile.manuscriptVersionId))
      .rejects.toMatchObject({ response: { code: 'STORY_VISUAL_PROFILE_CHANGED' } });
  });
});

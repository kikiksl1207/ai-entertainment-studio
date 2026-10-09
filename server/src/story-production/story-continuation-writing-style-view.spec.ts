import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileSection,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';

const MAX_VIEW_BYTES = 16_384;
const STYLE_TAIL = [
  'STYLE: Keep the close third-person viewpoint and clipped dialogue rhythm.',
  'PROHIBITION: Never introduce omniscient narration or explain emotions directly.',
  'EXCEPTION: Longer sentences are allowed only in an explicitly established recollection.',
].join(' ');
const STYLE_SUMMARY = `${'Synthetic pacing reference. '.repeat(12)}${STYLE_TAIL}`;
const BRANCH_SUMMARY = `${'Preserve selected branch consequences. '.repeat(10)}Never treat the author ending as an occurred route event unless that route establishes it.`;
const REFERENCE_SUMMARY = 'R'.repeat(600);

function approvedSyntheticProfile(input: {
  writingSummary?: string;
  writingDecision?: CreatorGenerationProfileSection['decision'];
  branchSummary?: string;
  paddingLength?: number;
} = {}) {
  const {
    writingSummary = STYLE_SUMMARY,
    writingDecision = 'accepted',
    branchSummary = BRANCH_SUMMARY,
    paddingLength = 0,
  } = input;
  const approvedSettings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key,
      decision: key === 'writing_style' ? writingDecision : 'accepted',
      evidence: [],
      value: {
        summary: key === 'writing_style' ? writingSummary
          : key === 'branch_behavior' ? branchSummary : REFERENCE_SUMMARY,
        ...(key === 'writing_style' ? { imitationBoundary: 'approved_work_only' } : {}),
        ...(key === 'branch_behavior' ? { selectedChoiceMustMateriallyDiverge: true } : {}),
        ...(key === 'canon' && paddingLength > 0 ? {
          syntheticBudgetPadding: [
            'P'.repeat(Math.floor(paddingLength / 2)),
            'P'.repeat(Math.ceil(paddingLength / 2)),
          ],
        } : {}),
      },
    })),
  });
  const sourceFingerprint = 'a'.repeat(64);
  return {
    id: 'synthetic-writing-style-profile',
    status: 'approved',
    profileVersion: 1,
    reviewRevision: 2,
    sourceFingerprint,
    approvedSettings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, approvedSettings),
  };
}

describe('Approved writing style continuation prompt view', () => {
  it.each(['accepted', 'edited'] as const)(
    'preserves the complete %s writing_style summary including guidance after 240 characters',
    writingDecision => {
      const profile = approvedSyntheticProfile({ writingDecision });
      const originalSettings = JSON.stringify(profile.approvedSettings);
      const { approved, pin } = continuationGenerationProfileSnapshot(profile as never);
      const writingStyle = approved.sections.find(section => section.key === 'writing_style')!.value;

      expect(STYLE_SUMMARY.indexOf(STYLE_TAIL)).toBeGreaterThan(240);
      expect(writingStyle).toEqual({
        summary: STYLE_SUMMARY,
        imitationBoundary: 'approved_work_only',
        referenceScope: 'production_constraint',
      });
      expect(writingStyle.summary).toContain(STYLE_TAIL);
      expect(pin).toEqual({
        id: profile.id,
        profileVersion: profile.profileVersion,
        reviewRevision: profile.reviewRevision,
        sourceFingerprint: profile.sourceFingerprint,
        approvedFingerprint: profile.approvedFingerprint,
      });
      expect(JSON.stringify(profile.approvedSettings)).toBe(originalSettings);
      expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(MAX_VIEW_BYTES);
    },
  );

  it.each(['unknown', 'removed', 'proposed'] as const)(
    'never includes %s writing_style guidance in the approved view',
    writingDecision => {
      const marker = 'UNAPPROVED_WRITING_STYLE_ONLY';
      const profile = approvedSyntheticProfile({ writingDecision, writingSummary: marker });
      const { approved } = continuationGenerationProfileSnapshot(profile as never);

      expect(approved.sections.some(section => section.key === 'writing_style')).toBe(false);
      expect(JSON.stringify(approved)).not.toContain(marker);
      expect(approved.sections.find(section => section.key === 'branch_behavior')?.value.summary)
        .toBe(BRANCH_SUMMARY);
    },
  );

  it('rejects a changed writing_style tail even when the first 240 characters are identical', () => {
    const profile = approvedSyntheticProfile();
    const changedSummary = `${STYLE_SUMMARY} Unapproved exception.`;
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map(section => section.key !== 'writing_style'
        ? section : { ...section, value: { ...section.value, summary: changedSummary } }),
    });

    expect(changedSummary.slice(0, 240)).toBe(STYLE_SUMMARY.slice(0, 240));
    expect(() => continuationGenerationProfileSnapshot(profile as never))
      .toThrow('generation_profile_fingerprint_changed');
  });

  it.each(['approvedFingerprint', 'sourceFingerprint'] as const)(
    'rejects a mismatched %s before projecting approved writing_style',
    field => {
      const profile = approvedSyntheticProfile();
      profile[field] = 'b'.repeat(64);

      expect(() => continuationGenerationProfileSnapshot(profile as never))
        .toThrow('generation_profile_fingerprint_changed');
    },
  );

  it('fails closed instead of truncating a complete writing_style summary over 16KB', () => {
    const writingSummary = '\uac00'.repeat(6_000);
    const profile = approvedSyntheticProfile({ writingSummary });

    expect(Buffer.byteLength(writingSummary, 'utf8')).toBeGreaterThan(MAX_VIEW_BYTES);
    expect(profile.approvedSettings.sections.find(section => section.key === 'writing_style')?.value.summary)
      .toBe(writingSummary);
    expect(() => continuationGenerationProfileSnapshot(profile as never))
      .toThrow('generation_profile_context_too_large');
  });

  it('fails closed when complete writing_style and branch_behavior together exceed 16KB', () => {
    const writingSummary = '\uac00'.repeat(3_000);
    const branchSummary = '\ub098'.repeat(3_000);
    const profile = approvedSyntheticProfile({ writingSummary, branchSummary });

    expect(Buffer.byteLength(writingSummary, 'utf8')).toBeLessThan(MAX_VIEW_BYTES);
    expect(Buffer.byteLength(branchSummary, 'utf8')).toBeLessThan(MAX_VIEW_BYTES);
    expect(Buffer.byteLength(writingSummary + branchSummary, 'utf8')).toBeGreaterThan(MAX_VIEW_BYTES);
    expect(() => continuationGenerationProfileSnapshot(profile as never))
      .toThrow('generation_profile_context_too_large');
  });

  it.each([
    { overflowBytes: 0, summaryLimit: 240 },
    { overflowBytes: 120, summaryLimit: 200 },
    { overflowBytes: 360, summaryLimit: 160 },
  ])('keeps both full constraints while other section summaries remain bounded at $summaryLimit characters', ({
    overflowBytes, summaryLimit,
  }) => {
    const baseline = approvedSyntheticProfile();
    const { approved: firstView } = continuationGenerationProfileSnapshot(baseline as never);
    // Inert synthetic metadata applies byte pressure without changing either approved rule.
    const paddingOverhead = Buffer.byteLength(JSON.stringify({ syntheticBudgetPadding: ['', ''] }), 'utf8') - 1;
    const paddingLength = overflowBytes === 0 ? 0
      : MAX_VIEW_BYTES + overflowBytes - Buffer.byteLength(JSON.stringify(firstView), 'utf8') - paddingOverhead;
    const profile = approvedSyntheticProfile({ paddingLength });
    const { approved, pin } = continuationGenerationProfileSnapshot(profile as never);

    expect(approved.sections).toHaveLength(STORY_PROFILE_SECTION_KEYS.length);
    expect(approved.sections.find(section => section.key === 'writing_style')?.value).toEqual({
      summary: STYLE_SUMMARY,
      imitationBoundary: 'approved_work_only',
      referenceScope: 'production_constraint',
    });
    expect(approved.sections.find(section => section.key === 'branch_behavior')?.value).toEqual({
      summary: BRANCH_SUMMARY,
      selectedChoiceMustMateriallyDiverge: true,
      referenceScope: 'production_constraint',
    });
    for (const section of approved.sections) {
      if (section.key === 'writing_style' || section.key === 'branch_behavior') continue;
      expect(section.value.summary).toBe(REFERENCE_SUMMARY.slice(0, summaryLimit));
      expect(section.value.referenceScope).toBe(section.key === 'scene_scale'
        ? 'production_constraint' : 'author_plan_not_route_history');
    }
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(MAX_VIEW_BYTES);
    expect(pin.approvedFingerprint).toBe(profile.approvedFingerprint);
  });
});

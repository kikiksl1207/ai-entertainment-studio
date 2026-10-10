'use strict';
import { CREATOR_GENERATION_PROFILE_SCHEMA, STORY_PROFILE_SECTION_KEYS, creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile } from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot, StoryContinuationProfileViewContextTooLargeError,
  STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';

const END = '  SYNTHETIC_ENDING_CONDITION\n\t ';
const SOURCE = 'analysis:11111111-1111-4111-8111-111111111111';
const scopeBytes = Buffer.byteLength(',"referenceScope":"writing_pattern"', 'utf8');

function fixture(styleSummary = 'synthetic complete style' + END, branchSummary = 'keep consequences' + END) {
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: 'accepted',
      evidence: key === 'writing_style' ? [{ sourceType: 'manuscript',
        sourceRef: SOURCE + ':PART-1:7', summary: 'synthetic provenance' }] : [],
      value: key === 'writing_style' ? { summary: styleSummary, mandatoryRule: END,
        observations: [0, 1, 2].map(() => ({ title: '  repeated title\n', detail: '  repeated detail ' + END, sourceRef: SOURCE })),
        categories: [{ category: '  rhythm  ', observations: [END, END] }] }
        : { summary: key === 'branch_behavior' ? branchSummary : 'N'.repeat(600) },
    })),
  });
  const sourceFingerprint = 'a'.repeat(64);
  return { id: 'synthetic-profile-size', status: 'approved', profileVersion: 1, reviewRevision: 1,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings) };
}

function overflow(profile: ReturnType<typeof fixture>) {
  try { continuationGenerationProfileSnapshot(profile as never); }
  catch (error) {
    if (error instanceof StoryContinuationProfileViewContextTooLargeError) return error;
    throw error;
  }
  throw new Error('Expected unchanged guard rejection');
}

function expectedViews(profile: ReturnType<typeof fixture>) {
  return [240, 200, 160].map(limit => ({
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    sections: profile.approvedSettings.sections.filter(section => ['accepted', 'edited'].includes(section.decision)).map(section => {
      const style = section.key === 'writing_style';
      const source = section.value as Record<string, any>;
      const value: Record<string, any> = {
        summary: style || section.key === 'branch_behavior' ? source.summary : source.summary.trim().slice(0, limit),
      };
      if (style) value.mandatoryRule = source.mandatoryRule;
      value.referenceScope = ['writing_style', 'scene_scale', 'branch_behavior'].includes(section.key)
        ? 'production_constraint' : 'author_plan_not_route_history';
      if (style) {
        value.observations = source.observations.map((row: Record<string, unknown>) => ({
          title: row.title, detail: row.detail, referenceScope: 'writing_pattern',
          sourceRef: SOURCE, sourcePartKey: 'PART-1', sourceParagraphIndex: 7,
        }));
        value.categories = source.categories;
      }
      return { key: section.key, value };
    }),
  }));
}

describe('unchanged profile-view guard numeric diagnostic (synthetic only)', () => {
  it('retains the exact accepted v6 profile and no diagnostic on a fitting snapshot', () => {
    const profile = fixture(), before = JSON.stringify(profile);
    const snapshot = continuationGenerationProfileSnapshot(profile as never);
    expect(snapshot.approved).toEqual(expectedViews(profile)[0]);
    expect(snapshot).not.toHaveProperty('profileViewDiagnostic');
    expect(snapshot.pin.approvedFingerprint).toBe(profile.approvedFingerprint);
    expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
    expect(JSON.stringify(profile)).toBe(before);
  });

  it.each(['\uac00', '\ud834\udd1e', '\n\t"'])('reports exact UTF8 sizes without trimming full style %s', text => {
    const profile = fixture(text.repeat(Math.floor(7900 / text.length)) + END);
    const before = JSON.stringify(profile), views = expectedViews(profile);
    const error = overflow(profile), result = error.profileViewDiagnostic;
    const style = views[0].sections.find(section => section.key === 'writing_style')!;
    expect(error.message).toBe('generation_profile_context_too_large');
    expect(result).toEqual({
      contract: 'story-profile-view-byte-diagnostic-v1', byteCap: 16384,
      minimumProjectedViewBytes: Math.min(...views.map(view => Buffer.byteLength(JSON.stringify(view), 'utf8'))),
      writingStyleSectionBytes: Buffer.byteLength(JSON.stringify(style), 'utf8'),
      scopeObservationCount: 3, trustedRepeatedScopeBytes: 3 * scopeBytes, projectionTiers: 3,
      modelInputFit: 'unmeasured', compactViewFit: 'unmeasured', semanticQualityVerified: false,
    });
    expect(result.minimumProjectedViewBytes).toBeGreaterThan(result.byteCap);
    expect(Object.isFrozen(result)).toBe(true);
    for (const privateValue of [END, SOURCE, profile.id, profile.approvedFingerprint, profile.sourceFingerprint]) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('counts no style section when only accepted branch guidance causes the same rejection', () => {
    const profile = fixture('short', '\uac00'.repeat(7900));
    profile.approvedSettings.sections.find(section => section.key === 'writing_style')!.decision = 'proposed';
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
    const before = JSON.stringify(profile), result = overflow(profile).profileViewDiagnostic;
    expect(result.writingStyleSectionBytes).toBeNull();
    expect(result.scopeObservationCount).toBe(0);
    expect(result.trustedRepeatedScopeBytes).toBe(0);
    expect(result.minimumProjectedViewBytes).toBeGreaterThan(16384);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it.each(['unapproved', 'missing-fingerprint', 'stale-tail', 'stale-source'])('never measures invalid approval: %s', change => {
    const profile = fixture('\uac00'.repeat(7900));
    if (change === 'unapproved') profile.status = 'needs_review';
    else if (change === 'missing-fingerprint') profile.approvedFingerprint = '';
    else if (change === 'stale-source') profile.sourceFingerprint = 'b'.repeat(64);
    else (profile.approvedSettings.sections.find(section => section.key === 'writing_style')!.value as Record<string, unknown>).mandatoryRule = 'changed';
    let caught: unknown;
    try { continuationGenerationProfileSnapshot(profile as never); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(StoryContinuationProfileViewContextTooLargeError);
    expect(caught).not.toHaveProperty('profileViewDiagnostic');
  });

  it('does not serialize unknown constructor fields, identifiers or private text', () => {
    const error = new StoryContinuationProfileViewContextTooLargeError({
      minimumProjectedViewBytes: 18000, writingStyleSectionBytes: 17000, scopeObservationCount: 2,
      trustedRepeatedScopeBytes: 2 * scopeBytes, privateText: END, privateId: SOURCE,
    } as never);
    expect(Object.keys(error.profileViewDiagnostic)).toHaveLength(10);
    expect(JSON.stringify(error.profileViewDiagnostic)).not.toContain(END);
    expect(JSON.stringify(error.profileViewDiagnostic)).not.toContain(SOURCE);
  });

  it.each([NaN, Infinity, 16384, -1, 2000001, 18000.5])('declines invalid reported size %s without a measured payload', value => {
    try {
      new StoryContinuationProfileViewContextTooLargeError({ minimumProjectedViewBytes: value,
        writingStyleSectionBytes: null, scopeObservationCount: 0, trustedRepeatedScopeBytes: 0 });
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(StoryContinuationProfileViewContextTooLargeError);
      expect(error).not.toHaveProperty('profileViewDiagnostic');
    }
  });
});

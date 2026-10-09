import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot, STORY_CONTINUATION_PROFILE_VIEW_VERSION } from './story-continuation-context.policy';
import { koreanContinuationContext } from './story-continuation-korean-context.fixture';
import { preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';

function approvedLongBookProfile(styleRepeats = 0) {
  const observation = '장면의 감정은 설명보다 인물의 행동과 짧은 대화의 간격에서 드러난다. 같은 표현을 반복하지 않고 다음 사건의 원인을 남긴다. ';
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA,
    kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map((key) => ({
      key, decision: 'accepted', evidence: [],
      value: {
        summary: observation.repeat(7),
        observations: Array.from({ length: 20 }, (_, index) => ({
          title: `${key} ${index + 1}`,
          detail: `${key === 'writing_style' && styleRepeats === 0
            ? '인물의 감정은 행동과 대화 간격으로 드러낸다.'
            : observation.repeat(key === 'writing_style' ? styleRepeats : 3)} ${index + 1}`,
          sourceRef: `analysis:source-${index + 1}`,
        })),
        ...(key === 'writing_style' ? {
          imitationBoundary: 'approved_work_only',
          categories: Array.from({ length: 6 }, (_, index) => ({
            category: `style-${index + 1}`, observations: [observation.repeat(2)],
          })),
        } : {}),
        ...(key === 'branch_behavior' ? { selectedChoiceMustMateriallyDiverge: true } : {}),
      },
    })),
  });
  const sourceFingerprint = 'a'.repeat(64);
  return {
    id: 'profile-id', status: 'approved', profileVersion: 1, reviewRevision: 1,
    sourceFingerprint, approvedSettings: settings,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
}

function withBranchSummary(summary: string, decision = 'edited') {
  const profile = approvedLongBookProfile();
  profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
    ...profile.approvedSettings,
    sections: profile.approvedSettings.sections.map(section => section.key !== 'branch_behavior'
      ? section : { ...section, decision, value: { ...section.value, summary } }),
  });
  profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);
  return profile;
}

describe('Long-book generation profile prompt view', () => {
  it('rejects the original oversized full style fixture rather than choosing only representative rules', () => {
    const profile = approvedLongBookProfile(3);
    const before = JSON.stringify(profile);
    expect(() => continuationGenerationProfileSnapshot(profile as never)).toThrow('generation_profile_context_too_large');
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('retains the complete approved branching constraint, including guidance beyond the summary excerpt', () => {
    const summary = `${'Maintain selected branch consequences. '.repeat(12)}Only resolve the branch when its established conflict is resolved; never import the author ending as an occurred event.`;
    const { approved, pin } = continuationGenerationProfileSnapshot(withBranchSummary(summary) as never);
    const branch = approved.sections.find(section => section.key === 'branch_behavior')!.value;
    expect(branch.summary).toBe(summary);
    expect(branch.referenceScope).toBe('production_constraint');
    expect(pin.approvedFingerprint).toBe(withBranchSummary(summary).approvedFingerprint);
    expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
  });

  it('fails closed when full approved branching guidance cannot fit the bounded context', () => {
    const profile = withBranchSummary('가'.repeat(6_000));
    expect(() => continuationGenerationProfileSnapshot(profile as never))
      .toThrow('generation_profile_context_too_large');
  });

  it.each(['unknown', 'removed', 'proposed'])('never promotes %s branch guidance into approved context', decision => {
    const { approved } = continuationGenerationProfileSnapshot(withBranchSummary('DO_NOT_INCLUDE_UNAPPROVED_ENDING', decision) as never);
    expect(approved.sections.some(section => section.key === 'branch_behavior')).toBe(false);
    expect(JSON.stringify(approved)).not.toContain('DO_NOT_INCLUDE_UNAPPROVED_ENDING');
  });

  it('does not synthesize an ending instruction when approved guidance is absent', () => {
    const { approved } = continuationGenerationProfileSnapshot(withBranchSummary('Keep branch consequences.') as never);
    expect(approved.sections.find(section => section.key === 'branch_behavior')!.value.summary)
      .toBe('Keep branch consequences.');
    expect(JSON.stringify(approved)).not.toMatch(/endingEligibility|mustEnd|completionStage/);
  });

  it('keeps every approved style rule and samples other evidence within a bounded prompt', () => {
    const profile = approvedLongBookProfile();
    const { pin, approved } = continuationGenerationProfileSnapshot(profile as never);
    const sections = new Map(approved.sections.map((section) => [section.key, section.value]));

    expect(Buffer.byteLength(JSON.stringify(profile.approvedSettings), 'utf8')).toBeGreaterThan(50_000);
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(approved.sections).toHaveLength(STORY_PROFILE_SECTION_KEYS.length);
    expect(pin.approvedFingerprint).toBe(profile.approvedFingerprint);
    expect(sections.get('writing_style')?.observations).toHaveLength(20);
    expect((sections.get('writing_style')?.observations as Array<Record<string, unknown>>).map(row => row.detail))
      .toEqual((profile.approvedSettings.sections.find(section => section.key === 'writing_style')!.value.observations as Array<Record<string, unknown>>).map(row => row.detail));
    expect(sections.get('writing_style')?.categories)
      .toEqual(profile.approvedSettings.sections.find(section => section.key === 'writing_style')!.value.categories);
    expect(sections.get('canon')?.observations).toHaveLength(2);
    expect(sections.get('writing_style')?.imitationBoundary).toBe('approved_work_only');
    expect(sections.get('branch_behavior')?.selectedChoiceMustMateriallyDiverge).toBe(true);
    expect(JSON.stringify(approved)).not.toContain('analysis:source-');
    expect(sections.get('timeline')?.referenceScope).toBe('author_plan_not_route_history');
    expect(JSON.stringify(approved)).toContain('writing_style 20');
  });

  it('passes the production-sized Korean scene preflight without calling a model', () => {
    const { approved } = continuationGenerationProfileSnapshot(approvedLongBookProfile() as never);
    const context = koreanContinuationContext();
    context.generationProfile = approved;
    const config: StoryContinuationOpenAiConfig = {
      enabled: true, provider: 'openai', model: 'gpt-5.4-mini-2026-03-17',
      rateCardId: 'rate-card', rateCardVersion: 'v1', apiKey: 'test-only',
      timeoutMs: 90_000, maxInputTokens: 32_768, maxOutputTokens: 8_192,
      maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
    };
    const result = preflightStoryContinuationOpenAiRequest({
      operationId: 'long-book-qa', locale: 'ko', contextFingerprint: 'test-fingerprint',
      promptVersion: 'story-continuation-v5', outputSchemaVersion: 'story-continuation-output-v1',
      inputTokenLimit: 32_768, outputTokenLimit: 8_192,
      provider: config.provider, model: config.model,
      rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
      approvedContext: context,
    }, config);

    expect(result.supported).toBe(true);
    expect(result.inputTokenUpperBound).toBeLessThan(32_768);
  });

  it('rejects oversized approved style observations without changing their fingerprint or truncating them', () => {
    const profile = approvedLongBookProfile();
    const expanded = {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => ({
        ...section,
        value: {
          ...section.value,
          summary: '가'.repeat(section.key === 'writing_style' ? 400 : 900),
          observations: Array.from({ length: 20 }, (_, index) => ({
            title: `다${'다'.repeat(28)}${index}`,
            detail: '나'.repeat(150), sourceRef: `analysis:${index}`,
          })),
          ...(section.key === 'writing_style' ? {
            categories: Array.from({ length: 6 }, (_, index) => ({
              category: `style-${index}`, observations: ['라'.repeat(200)],
            })),
          } : {}),
        },
      })),
    };
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', expanded);
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(
      profile.sourceFingerprint, profile.approvedSettings);

    const before = JSON.stringify(profile);
    expect(() => continuationGenerationProfileSnapshot(profile as never)).toThrow('generation_profile_context_too_large');
    expect(JSON.stringify(profile)).toBe(before);
    expect(profile.approvedFingerprint).toBe(creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings));
  });

  it('carries approved source locations as author plans, never as reader-route facts', () => {
    const profile = approvedLongBookProfile();
    const sourceRef = 'analysis:11111111-1111-4111-8111-111111111111';
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => section.key !== 'timeline' ? section : {
        ...section,
        value: {
          summary: '원작 마지막 파트에서 주인공이 죽는다.',
          referenceScope: 'reader_route_fact',
          observations: [{ title: '원작 엔딩', detail: '어머니는 죽는다.', sourceRef,
            sourcePartKey: 'forged-early-part', referenceScope: 'reader_route_fact' }],
        },
        evidence: [{ sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-32:17`, summary: '원고 근거' }],
      }),
    });
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);

    const { approved } = continuationGenerationProfileSnapshot(profile as never);
    expect(approved.sections.find((section) => section.key === 'timeline')?.value).toEqual({
      summary: '원작 마지막 파트에서 주인공이 죽는다.',
      referenceScope: 'author_plan_not_route_history',
      observations: [{ title: '원작 엔딩', detail: '어머니는 죽는다.', sourceRef,
        sourcePartKey: 'PART-32', sourceParagraphIndex: 17, referenceScope: 'author_plan_not_route_history' }],
    });
  });

  it('does not invent locations for ambiguous or missing source evidence', () => {
    const profile = approvedLongBookProfile();
    const sourceRef = 'analysis:11111111-1111-4111-8111-111111111111';
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => section.key !== 'canon' ? section : {
        ...section,
        value: { summary: '원고 인물 기준', observations: [
          { title: '모호함', detail: '출처가 상충한다.', sourceRef },
          { title: '미확인', detail: '출처 없음.', sourceRef: 'analysis:external-instruction' },
        ] },
        evidence: [
          { sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-1:3`, summary: '첫 근거' },
          { sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-32:17`, summary: '다른 근거' },
        ],
      }),
    });
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);

    const { approved } = continuationGenerationProfileSnapshot(profile as never);
    const observations = approved.sections.find((section) => section.key === 'canon')?.value.observations;
    expect(observations).toEqual([
      { title: '모호함', detail: '출처가 상충한다.', sourceRef, referenceScope: 'author_plan_not_route_history' },
      { title: '미확인', detail: '출처 없음.', referenceScope: 'author_plan_not_route_history' },
    ]);
  });

  it.each(['-'.repeat(36), 'a'.repeat(36), '111111111-111-4111-8111-111111111111'])('does not attach a location to malformed analysis ID %s', (id) => {
    const profile = approvedLongBookProfile();
    const sourceRef = `analysis:${id}`;
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => section.key !== 'timeline' ? section : {
        ...section,
        value: { summary: '원고 기준', observations: [{ title: '미확인', detail: '원고 참고', sourceRef }] },
        evidence: [{ sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-32:17`, summary: '미확인 출처' }],
      }),
    });
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);

    const { approved } = continuationGenerationProfileSnapshot(profile as never);
    expect(approved.sections.find(section => section.key === 'timeline')?.value.observations).toEqual([
      { title: '미확인', detail: '원고 참고', referenceScope: 'author_plan_not_route_history' },
    ]);
  });

  it('bounds a long-book profile including full source provenance without dropping approved locks', () => {
    const profile = approvedLongBookProfile();
    profile.approvedSettings = normalizeCreatorGenerationProfile('story', {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => {
        const observations = (section.value.observations as Array<Record<string, unknown>>).map((item, index) => ({
          ...item, detail: String(item.detail).slice(0, section.key === 'writing_style' ? 20 : 150),
          sourceRef: `analysis:11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        }));
        return { ...section, value: { ...section.value, observations,
          ...(section.key === 'writing_style' ? { summary: 'Complete synthetic voice.', categories: [
            { category: 'dialogue', observations: ['Retain quotations.', 'Keep the exception.'] },
          ] } : {}) }, evidence: observations.map(item => ({
          sourceType: 'manuscript', sourceRef: `${item.sourceRef}:${'P'.repeat(64)}:999999999`, summary: '출처 위치',
        })) };
      }),
    });
    profile.approvedFingerprint = creatorGenerationProfileFingerprint(profile.sourceFingerprint, profile.approvedSettings);

    const { approved, pin } = continuationGenerationProfileSnapshot(profile as never);
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(approved.sections).toHaveLength(8);
    expect(pin.approvedFingerprint).toBe(profile.approvedFingerprint);
    expect(approved.sections.find(section => section.key === 'branch_behavior')?.value.selectedChoiceMustMateriallyDiverge).toBe(true);
    expect(JSON.stringify(approved)).toContain('sourceParagraphIndex');
  });
});

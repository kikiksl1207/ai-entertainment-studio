import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { koreanContinuationContext } from './story-continuation-korean-context.fixture';
import { preflightStoryContinuationOpenAiRequest } from './story-continuation-openai.prompt';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';

function approvedLongBookProfile() {
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
          detail: `${observation.repeat(3)} ${index + 1}`,
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

describe('Long-book generation profile prompt view', () => {
  it('keeps every approved section and representative evidence within a bounded prompt', () => {
    const profile = approvedLongBookProfile();
    const { pin, approved } = continuationGenerationProfileSnapshot(profile as never);
    const sections = new Map(approved.sections.map((section) => [section.key, section.value]));

    expect(Buffer.byteLength(JSON.stringify(profile.approvedSettings), 'utf8')).toBeGreaterThan(50_000);
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(approved.sections).toHaveLength(STORY_PROFILE_SECTION_KEYS.length);
    expect(pin.approvedFingerprint).toBe(profile.approvedFingerprint);
    expect(sections.get('writing_style')?.observations).toHaveLength(4);
    expect(sections.get('canon')?.observations).toHaveLength(2);
    expect(sections.get('writing_style')?.imitationBoundary).toBe('approved_work_only');
    expect(sections.get('branch_behavior')?.selectedChoiceMustMateriallyDiverge).toBe(true);
    expect(JSON.stringify(approved)).not.toContain('sourceRef');
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

  it('reduces oversized observations without changing the approved source fingerprint', () => {
    const profile = approvedLongBookProfile();
    const expanded = {
      ...profile.approvedSettings,
      sections: profile.approvedSettings.sections.map((section) => ({
        ...section,
        value: {
          ...section.value,
          summary: '가'.repeat(900),
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

    const { pin, approved } = continuationGenerationProfileSnapshot(profile as never);

    expect(pin.approvedFingerprint).toBe(profile.approvedFingerprint);
    expect(Buffer.byteLength(JSON.stringify(approved), 'utf8')).toBeLessThanOrEqual(16_384);
    expect(approved.sections).toHaveLength(8);
    expect(JSON.stringify(approved)).toContain('style-5');
  });
});

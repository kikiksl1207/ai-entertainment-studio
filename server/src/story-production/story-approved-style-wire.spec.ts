import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
} from '../generation-profile/creator-generation-profile.policy';
import { continuationGenerationProfileSnapshot } from './story-continuation-context.policy';
import { authorPartStoryContinuationLengthBounds } from './story-continuation-length.policy';
import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import { STORY_CONTINUATION_PROMPT_VERSION, STORY_CONTINUATION_SCHEMA_VERSION } from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';
import { STORY_LOCALES, type StoryLocale } from './story-production.policy';

const config: StoryContinuationOpenAiConfig = Object.freeze({
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'synthetic-style-wire-card', rateCardVersion: 'synthetic-v1',
  apiKey: 'synthetic-not-a-real-key', timeoutMs: 100,
  maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(child => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

function fixture(locale: StoryLocale) {
  const style = {
    summary: 'Keep every approved voice condition. '.repeat(12) + 'SUMMARY_TAIL',
    observations: Array.from({ length: 6 }, (_, index) => ({
      title: 'Complete approved observation title. '.repeat(3) + 'TITLE_TAIL_' + index,
      detail: 'Preserve measured dialogue and deliberate pauses. '.repeat(7) + 'DETAIL_TAIL_' + index,
    })),
    categories: Array.from({ length: 7 }, (_, index) => ({
      category: 'Synthetic writing category ' + index,
      observations: [
        'Keep concrete witness actions. '.repeat(6) + 'CATEGORY_FIRST_TAIL_' + index,
        'Retain the original deliberate voice. '.repeat(6) + 'CATEGORY_LAST_TAIL_' + index,
      ],
    })),
  };
  const settings = normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: 'accepted', evidence: [],
      value: key === 'writing_style' ? style : { summary: 'Synthetic ' + key },
    })),
  });
  // This synthetic row checks the real projection, not ownership or human approval.
  const sourceFingerprint = 'a'.repeat(64);
  const row = deepFreeze({
    id: 'aaaaaaaa-1111-4111-8111-111111111111', status: 'approved',
    profileVersion: 1, reviewRevision: 1, sourceFingerprint,
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
    approvedSettings: settings,
  });
  const projected = continuationGenerationProfileSnapshot(row as never);
  const sourceTexts = ['o'.repeat(2_034), 'o'.repeat(2_000), 'o'.repeat(2_000)];
  const bounds = authorPartStoryContinuationLengthBounds(locale, sourceTexts);
  const request: StoryContinuationProviderRequest = deepFreeze({
    operationId: 'synthetic-style-wire-' + locale, locale,
    contextFingerprint: 'b'.repeat(64), provider: config.provider, model: config.model,
    rateCardId: config.rateCardId, rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
    outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768, outputTokenLimit: 8_192,
    approvedContext: {
      sourceScene: { title: 'Synthetic source', beats: sourceTexts.map(content => ({ beatType: 'paragraph', content })) },
      selectedChoice: { label: 'Follow the synthetic alternative' }, path: [], memories: [],
      narrativeLength: bounds, generationProfile: projected.approved,
    },
  });
  const payload = {
    title: { [locale]: 'Synthetic response, not quality evidence' },
    beats: Array.from({ length: 11 }, () => ({ beatType: 'paragraph', content: { [locale]: 'z'.repeat(550) } })),
    nextChoices: ['first', 'second', 'third'].map(choiceKey => ({ choiceKey, label: { [locale]: 'Synthetic ' + choiceKey } })),
    ending: null,
  };
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockImplementation(async () => new Response(JSON.stringify({
      model: config.model, service_tier: 'default', status: 'completed',
      output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      usage: { input_tokens: 1_000, input_tokens_details: { cached_tokens: 0 },
        output_tokens: 2_000, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 3_000 },
    })));
  const provider = new OpenAiStoryContinuationProvider(config, transport);
  return { style, row, projected, sourceTexts, request, transport, provider };
}

describe('complete approved-style projection to synthetic wire at unchanged limits', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network prohibited'));
  });
  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { jest.restoreAllMocks(); }
  });

  it.each(STORY_LOCALES)('STYLE-WIRE: retains every style rule and original scale in %s', async locale => {
    const f = fixture(locale);
    const before = JSON.stringify({ row: f.row, request: f.request, config });
    await expect(f.provider.preflight(f.request)).resolves.toMatchObject({
      supported: true, reason: 'provider_preflight_ready', inputTokenLimit: 32_768,
    });
    expect(f.transport).not.toHaveBeenCalled();
    await f.provider.generate(f.request, new AbortController().signal);
    expect(f.transport).toHaveBeenCalledTimes(1);
    const [url, init] = f.transport.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init.redirect).toBe('error');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: config.model, max_output_tokens: 8_192,
      store: false, stream: false, background: false, truncation: 'disabled',
      text: { format: { type: 'json_schema', strict: true } },
    });
    const outbound = JSON.parse(body.input[0].content[0].text);
    expect(outbound.generationProfile).toStrictEqual(f.projected.approved);
    const outboundStyle = outbound.generationProfile.sections.find((section: { key: string }) => section.key === 'writing_style').value;
    expect(outboundStyle.summary).toBe(f.style.summary);
    expect(outboundStyle.observations).toHaveLength(6);
    for (const [index, observation] of f.style.observations.entries()) {
      expect(outboundStyle.observations[index]).toMatchObject({
        ...observation, referenceScope: 'writing_pattern',
      });
    }
    expect(outboundStyle.categories).toStrictEqual(f.style.categories);
    expect(outboundStyle.referenceScope).toBe('production_constraint');
    expect(outbound.sourceScene.beats.map((beat: { content: string }) => beat.content)).toStrictEqual(f.sourceTexts);
    expect(outbound.narrativeLength).toMatchObject({
      sourceUnits: 6_034, minimumUnits: 4_828, targetUnits: 6_034, maximumUnits: 7_240,
    });
    expect(body.instructions).toContain('creator-approved production constraint');
    expect(body.instructions).toContain('mandatory bounds');
    for (const privateValue of [
      f.request.operationId, f.request.contextFingerprint, f.projected.pin.id,
      f.projected.pin.sourceFingerprint, f.projected.pin.approvedFingerprint,
      config.rateCardId, config.apiKey,
    ]) expect(init.body as string).not.toContain(privateValue);
    expect(f.request.inputTokenLimit).toBe(32_768);
    expect(f.request.outputTokenLimit).toBe(8_192);
    expect(JSON.stringify({ row: f.row, request: f.request, config })).toBe(before);
  });
});

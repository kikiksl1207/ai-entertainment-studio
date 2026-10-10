import { OpenAiStoryContinuationProvider, type StoryContinuationFetch } from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import {
  authorPartStoryContinuationLengthBounds,
  assertStoryContinuationLengthBounds,
  StoryContinuationLengthPolicyError,
  validateStoryContinuationNarrativeLength,
  type StoryContinuationLengthBounds,
} from './story-continuation-length.policy';
import {
  buildStoryContinuationOpenAiRequest,
  preflightStoryContinuationOpenAiRequest,
} from './story-continuation-openai.prompt';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
  storyContinuationOutputSchema,
} from './story-continuation-openai.schema';
import { STORY_LOCALES, type StoryLocale } from './story-production.policy';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';

const config: StoryContinuationOpenAiConfig = Object.freeze({
  enabled: true,
  provider: 'openai',
  model: 'gpt-4.1-2025-04-14',
  rateCardId: 'schema-feasibility-synthetic-card',
  rateCardVersion: 'synthetic-v1',
  apiKey: 'synthetic-not-a-real-key',
  timeoutMs: 100,
  maxInputTokens: 32_768,
  maxOutputTokens: 8_192,
  maxResponseBytes: 200_000,
  visualAssetPath: '/assets/story/neutral-placeholder.webp',
});

type BeatSchema = {
  type: string;
  minItems: number;
  maxItems: number;
  items: {
    type: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
      beatType: { type: string; enum: string[] };
      content: {
        type: string;
        required: string[];
        additionalProperties: boolean;
        properties: Record<string, { type: string; minLength: number; maxLength: number }>;
      };
    };
  };
};

function beatsOf(schema: ReturnType<typeof storyContinuationOutputSchema>): BeatSchema {
  return schema.properties.beats as BeatSchema;
}

function originalBounds(locale: StoryLocale, referenceUnits: 125_000 | 125_001) {
  // Each invented source text is below 32 KiB and their total is below 256 KiB.
  const texts = Object.freeze([
    ...Array.from({ length: 4 }, () => 'x'.repeat(31_250)),
    ...(referenceUnits === 125_001 ? ['x'] : []),
  ]);
  const bounds = authorPartStoryContinuationLengthBounds(locale, texts);
  assertStoryContinuationLengthBounds(bounds);
  return bounds;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(child => freeze(child));
    Object.freeze(value);
  }
  return value;
}

function request(locale: StoryLocale, bounds?: StoryContinuationLengthBounds): StoryContinuationProviderRequest {
  // Caller-projected synthetic context is not proof of an actual author approval.
  return freeze({
    operationId: 'schema-feasibility-synthetic-operation',
    locale,
    contextFingerprint: 'synthetic-context-not-source-proof',
    provider: config.provider,
    model: config.model,
    rateCardId: config.rateCardId,
    rateCardVersion: config.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION,
    outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 32_768,
    outputTokenLimit: 8_192,
    approvedContext: {
      sourceScene: {
        title: 'Synthetic source scene',
        beats: [{ beatType: 'paragraph', content: 'A synthetic reader takes a new path.' }],
      },
      selectedChoice: { label: 'Follow the synthetic path' },
      path: [],
      memories: [],
      ...(bounds ? { narrativeLength: bounds } : {}),
    },
  });
}

function providerFixture() {
  const transport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockRejectedValue(new Error('Synthetic transport must not be called'));
  const provider = new OpenAiStoryContinuationProvider(config, transport);
  const generate = jest.spyOn(provider, 'generate');
  return { provider, transport, generate };
}

describe('story continuation schema feasibility at unchanged fixed limits', () => {
  let network: jest.SpyInstance;

  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network prohibited'));
  });

  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it.each(STORY_LOCALES)(
    'SCHEMA-FEASIBILITY-RED: rejects an impossible original minimum for %s',
    locale => {
      const bounds = originalBounds(locale, 125_001);
      expect(bounds).toMatchObject({
        locale,
        referenceUnits: 125_001,
        minUnits: 100_001,
        targetUnits: 125_001,
        maxUnits: 150_001,
      });
      expect(() => storyContinuationOutputSchema(locale, bounds.minUnits, bounds.maxUnits))
        .toThrow('provider_narrative_schema_unavailable');
    },
  );

  it.each(STORY_LOCALES)(
    'retains the inclusive 100000-unit schema boundary for %s without raising either cap',
    locale => {
      const bounds = originalBounds(locale, 125_000);
      expect(bounds).toMatchObject({ referenceUnits: 125_000, minUnits: 100_000, maxUnits: 150_000 });
      const schema = storyContinuationOutputSchema(locale, bounds.minUnits, bounds.maxUnits);
      const beats = beatsOf(schema);
      expect(beats).toMatchObject({
        type: 'array',
        minItems: 40,
        maxItems: 40,
        items: {
          additionalProperties: false,
          required: ['beatType', 'content'],
          properties: {
            beatType: { type: 'string', enum: ['paragraph', 'dialogue'] },
            content: {
              additionalProperties: false,
              required: [locale],
              properties: { [locale]: { type: 'string', minLength: 2_500, maxLength: 2_500 } },
            },
          },
        },
      });
      expect(beats.maxItems * beats.items.properties.content.properties[locale].maxLength).toBe(100_000);
      expect(schema.properties.nextChoices).toMatchObject({ minItems: 0, maxItems: 3 });
      expect(config.maxInputTokens).toBe(32_768);
      expect(config.maxOutputTokens).toBe(8_192);
    },
  );

  it('proves that even the maximal schema narrative misses legal full-original 125001 bounds', () => {
    const bounds = originalBounds('en', 125_001);
    const originalSnapshot = JSON.stringify(bounds);
    const unboundedSchema = storyContinuationOutputSchema('en');
    const beats = beatsOf(unboundedSchema);
    const maxLength = beats.items.properties.content.properties.en.maxLength;
    expect(beats.maxItems).toBe(40);
    expect(maxLength).toBe(2_500);
    const candidate = freeze({
      locale: 'en',
      beats: Array.from({ length: beats.maxItems }, () => ({
        beatType: 'paragraph',
        content: { en: 'x'.repeat(maxLength) },
      })),
    });
    const candidateSnapshot = JSON.stringify(candidate);
    const boundary = originalBounds('en', 125_000);
    expect(validateStoryContinuationNarrativeLength(candidate, boundary)).toEqual({
      units: 100_000,
      utf8Bytes: 100_000,
      beatCount: 40,
    });
    expect(() => validateStoryContinuationNarrativeLength(candidate, bounds))
      .toThrow(StoryContinuationLengthPolicyError);
    expect(() => validateStoryContinuationNarrativeLength(candidate, bounds))
      .toThrow('continuation_output_underlength');
    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
    expect(JSON.stringify(bounds)).toBe(originalSnapshot);
  });

  it('keeps the existing small bounded schema exactly within its original shape', () => {
    const beats = beatsOf(storyContinuationOutputSchema('en', 80, 120));
    expect(beats).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: {
        type: 'object',
        properties: {
          beatType: { type: 'string', enum: ['paragraph', 'dialogue', 'scene_break'] },
          content: {
            type: 'object',
            properties: { en: { type: 'string', minLength: 100, maxLength: 120 } },
            required: ['en'],
            additionalProperties: false,
          },
        },
        required: ['beatType', 'content'],
        additionalProperties: false,
      },
    });
  });

  it('keeps omitted and explicit-zero unbounded schemas unchanged', () => {
    const omitted = storyContinuationOutputSchema('en');
    expect(storyContinuationOutputSchema('en', 0, 0)).toEqual(omitted);
    expect(beatsOf(omitted)).toEqual({
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        properties: {
          beatType: { type: 'string', enum: ['paragraph', 'dialogue', 'scene_break'] },
          content: {
            type: 'object',
            properties: { en: { type: 'string', minLength: 1, maxLength: 2_500 } },
            required: ['en'],
            additionalProperties: false,
          },
        },
        required: ['beatType', 'content'],
        additionalProperties: false,
      },
    });
  });

  it.each(STORY_LOCALES)(
    'preflight withholds impossible %s requests without generation or transport',
    async locale => {
      const input = request(locale, originalBounds(locale, 125_001));
      const before = JSON.stringify({ input, config });
      const f = providerFixture();
      const result = await f.provider.preflight(input);
      expect(result).toMatchObject({ supported: false, inputTokenLimit: 32_768 });
      // Existing plain-schema errors are safely mapped by the unchanged prompt preflight.
      expect(['provider_context_invalid', 'provider_narrative_schema_unavailable']).toContain(result.reason);
      expect(() => buildStoryContinuationOpenAiRequest(input, config))
        .toThrow('provider_narrative_schema_unavailable');
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.transport).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(config.apiKey);
      expect(JSON.stringify({ input, config })).toBe(before);
    },
  );

  it('keeps boundary and existing source-derived small preflight available without claiming output fit', async () => {
    const boundaryRequest = request('en', originalBounds('en', 125_000));
    const smallRequest = request('en');
    const before = JSON.stringify([boundaryRequest, smallRequest, config]);
    const f = providerFixture();
    for (const input of [boundaryRequest, smallRequest]) {
      const result = await f.provider.preflight(input);
      expect(result).toMatchObject({
        supported: true,
        reason: 'provider_preflight_ready',
        budgetMethod: 'js_tiktoken_o200k_base_v1',
        inputTokenLimit: 32_768,
      });
      expect(result.inputTokenUpperBound).toEqual(expect.any(Number));
      expect(result.inputTokenUpperBound).toBeLessThanOrEqual(32_768);
      expect(preflightStoryContinuationOpenAiRequest(input, config)).toEqual(result);
      const built = buildStoryContinuationOpenAiRequest(input, config);
      expect(built.max_output_tokens).toBe(8_192);
      expect(built.truncation).toBe('disabled');
      expect(result).not.toHaveProperty('outputFit');
      expect(result).not.toHaveProperty('semanticQualityVerified');
    }
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(JSON.stringify([boundaryRequest, smallRequest, config])).toBe(before);
  });
});

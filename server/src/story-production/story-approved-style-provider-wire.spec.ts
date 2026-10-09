import {
  CREATOR_GENERATION_PROFILE_SCHEMA,
  STORY_PROFILE_SECTION_KEYS,
  creatorGenerationProfileFingerprint,
  normalizeCreatorGenerationProfile,
  type CreatorGenerationProfileSettings,
} from '../generation-profile/creator-generation-profile.policy';
import {
  StoryChoicePreparationProvider,
  type StoryChoicePreparationInput,
  type StoryChoiceTransport,
} from './story-choice-preparation.provider';
import {
  STORY_CONTINUATION_PROFILE_VIEW_VERSION,
  continuationGenerationProfileSnapshot,
} from './story-continuation-context.policy';
import {
  OpenAiStoryContinuationProvider,
  type StoryContinuationFetch,
} from './story-continuation-openai.adapter';
import type { StoryContinuationOpenAiConfig } from './story-continuation-openai.config';
import {
  STORY_CONTINUATION_PROMPT_VERSION,
  STORY_CONTINUATION_SCHEMA_VERSION,
} from './story-continuation-openai.schema';
import type { StoryContinuationProviderRequest } from './story-continuation.provider';

type ApprovedProfileRow = Parameters<typeof continuationGenerationProfileSnapshot>[0];

// Synthetic fixtures only; Korean choice labels retain the existing provider contract.
const sourceRef = 'analysis:11111111-1111-4111-8111-111111111111';
const futurePlan = 'AUTHOR_PLAN_ONLY: The clock tower opens in a later original-route scene.';
const choiceInput: StoryChoicePreparationInput = {
  workTitle: 'Synthetic Wire Story',
  parts: [{
    partKey: 'part-1', title: 'The Quiet Hall',
    endingExcerpt: 'A ledger rests on an empty desk.',
    originalChoiceLabel: 'Inspect the ledger',
    context: 'Only the desk and ledger have been seen.',
  }],
};
const continuationConfig: StoryContinuationOpenAiConfig = {
  enabled: true, provider: 'openai', model: 'gpt-4.1-2025-04-14',
  rateCardId: 'card-1', rateCardVersion: 'v1', apiKey: 'fake-test-key',
  timeoutMs: 100, maxInputTokens: 32_768, maxOutputTokens: 8_192,
  maxResponseBytes: 200_000, visualAssetPath: '/assets/story/neutral-placeholder.webp',
};

function settingsWithStyle(decision: 'accepted' | 'edited', summary: string) {
  return normalizeCreatorGenerationProfile('story', {
    schemaVersion: CREATOR_GENERATION_PROFILE_SCHEMA, kind: 'story',
    sections: STORY_PROFILE_SECTION_KEYS.map(key => ({
      key, decision: key === 'writing_style' ? decision : 'accepted',
      value: key === 'writing_style' ? {
        summary,
        observations: [{
          title: 'Synthetic rhythm reference',
          detail: 'Use clipped dialogue and measured pauses around an unresolved reveal.',
          sourceRef,
        }],
      } : key === 'timeline' ? {
        summary: futurePlan,
        observations: [{ title: 'Later author plan', detail: futurePlan, sourceRef }],
      } : { summary: `Approved synthetic ${key} constraint.` },
      evidence: key === 'writing_style' || key === 'timeline' ? [{
        sourceType: 'manuscript', sourceRef: `${sourceRef}:PART-FUTURE:17`,
        summary: 'Synthetic later original-route reference, not a reached reader event.',
      }] : [],
    })),
  });
}

function approvedRow(settings: CreatorGenerationProfileSettings): ApprovedProfileRow {
  const sourceFingerprint = '1'.repeat(64);
  return {
    id: 'style-wire-profile', status: 'approved', profileVersion: 1, reviewRevision: 2,
    sourceFingerprint,
    approvedSettings: settings as unknown as ApprovedProfileRow['approvedSettings'],
    approvedFingerprint: creatorGenerationProfileFingerprint(sourceFingerprint, settings),
  };
}

function providerFixture() {
  const choiceTransport = jest.fn<ReturnType<StoryChoiceTransport>, Parameters<StoryChoiceTransport>>()
    .mockImplementation(async () => new Response(JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        choices: { 'part-1': {
          first: '\ubcf5\ub3c4\ub85c \ub3cc\uc544\uac00 \uc9c1\uc6d0\uc5d0\uac8c \ub3c4\uc6c0\uc744 \uccad\ud55c\ub2e4',
          second: '\ubb38 \ubc16\uc73c\ub85c \ub098\uac00 \uc8fc\ubcc0 \ubc1c\uc790\uad6d\uc744 \ucd94\uc801\ud55c\ub2e4',
        } },
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const continuationTransport = jest.fn<ReturnType<StoryContinuationFetch>, Parameters<StoryContinuationFetch>>()
    .mockImplementation(async () => new Response(JSON.stringify({
      model: continuationConfig.model, service_tier: 'default', status: 'completed',
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{
        type: 'output_text', text: JSON.stringify({
          title: { en: 'The Lantern' },
          beats: [{ beatType: 'paragraph', content: { en: 'The reader lifts the lantern.' } }],
          nextChoices: [
            { choiceKey: 'open-gate', label: { en: 'Open the gate' } },
            { choiceKey: 'ask-guard', label: { en: 'Question the guard' } },
            { choiceKey: 'turn-back', label: { en: 'Turn back' } },
          ], ending: null,
        }),
      }] }],
      usage: {
        input_tokens: 120, input_tokens_details: { cached_tokens: 30 },
        output_tokens: 100, output_tokens_details: { reasoning_tokens: 70 }, total_tokens: 220,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  return {
    choiceTransport, continuationTransport,
    choiceProvider: new StoryChoicePreparationProvider(
      { apiKey: 'unit-test-key', model: 'gpt-5-mini' }, choiceTransport,
    ),
    continuationProvider: new OpenAiStoryContinuationProvider(continuationConfig, continuationTransport),
  };
}

async function serializeApprovedProfile(row: ApprovedProfileRow, fixture: ReturnType<typeof providerFixture>) {
  // Use the real approval projection before either real provider constructs its request.
  const { approved } = continuationGenerationProfileSnapshot(row);
  await expect(fixture.choiceProvider.generate({ ...choiceInput, generationProfile: approved }))
    .resolves.toHaveLength(1);
  const request: StoryContinuationProviderRequest = {
    operationId: 'style-wire-operation', locale: 'en', contextFingerprint: 'style-wire-context',
    provider: continuationConfig.provider, model: continuationConfig.model,
    rateCardId: continuationConfig.rateCardId, rateCardVersion: continuationConfig.rateCardVersion,
    promptVersion: STORY_CONTINUATION_PROMPT_VERSION, outputSchemaVersion: STORY_CONTINUATION_SCHEMA_VERSION,
    inputTokenLimit: 8_192, outputTokenLimit: 8_192,
    approvedContext: {
      sourceScene: { title: 'The Gate', beats: [{ beatType: 'paragraph', content: 'A lantern waits beside the gate.' }] },
      selectedChoice: { label: 'Lift the lantern' }, path: [], memories: [], generationProfile: approved,
    },
  };
  await expect(fixture.continuationProvider.generate(request, new AbortController().signal))
    .resolves.toMatchObject({ title: { en: 'The Lantern' } });
  expect(fixture.choiceTransport).toHaveBeenCalledTimes(1);
  expect(fixture.continuationTransport).toHaveBeenCalledTimes(1);
  const choiceBody = JSON.parse(fixture.choiceTransport.mock.calls[0][1]!.body as string);
  const continuationBody = JSON.parse(fixture.continuationTransport.mock.calls[0][1].body as string);
  const choicePayload = JSON.parse(choiceBody.input);
  const continuationPayload = JSON.parse(continuationBody.input[0].content[0].text);
  expect(choicePayload.generationProfile).toEqual(approved);
  expect(continuationPayload.generationProfile).toEqual(approved);
  return { approved, choiceBody, continuationBody, choicePayload, continuationPayload };
}

describe('Approved style provider wire contracts (synthetic mock transport only)', () => {
  let network: jest.SpyInstance;
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('STYLE-WIRE network prohibited'));
  });
  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
  });

  it.each(['accepted', 'edited'] as const)(
    'serializes the full %s style tail and keeps future author-plan evidence out of route history',
    async decision => {
      const tail = `STYLE_WIRE_${decision.toUpperCase()}_TAIL: Keep unresolved choices separate; ` +
        'never narrate a future author-plan reveal as current history. Preserve "measured pauses".';
      const summary = 'Use restrained third-person voice, concrete verbs, and short dialogue. '.repeat(70) +
        `\n\n${tail}`;
      expect(summary.length).toBeGreaterThan(240);
      expect(summary.length).toBeLessThanOrEqual(8_000);
      expect(STORY_CONTINUATION_PROFILE_VIEW_VERSION).toBe('story-profile-prompt-v6');
      const wire = await serializeApprovedProfile(approvedRow(settingsWithStyle(decision, summary)), providerFixture());

      for (const payload of [wire.choicePayload, wire.continuationPayload]) {
        const sections = payload.generationProfile.sections as Array<{ key: string; value: Record<string, unknown> }>;
        const style = sections.find(section => section.key === 'writing_style')!.value;
        const timeline = sections.find(section => section.key === 'timeline')!.value;
        expect(style.summary).toBe(summary);
        expect(String(style.summary).endsWith(tail)).toBe(true);
        expect(style.referenceScope).toBe('production_constraint');
        expect(style.observations).toEqual([expect.objectContaining({
          referenceScope: 'writing_pattern', sourceRef, sourcePartKey: 'PART-FUTURE', sourceParagraphIndex: 17,
        })]);
        expect(timeline).toMatchObject({
          summary: futurePlan, referenceScope: 'author_plan_not_route_history',
          observations: [expect.objectContaining({
            detail: futurePlan, referenceScope: 'author_plan_not_route_history',
            sourceRef, sourcePartKey: 'PART-FUTURE', sourceParagraphIndex: 17,
          })],
        });
      }
      expect(JSON.stringify(wire.choicePayload.parts)).not.toContain(futurePlan);
      expect(JSON.stringify({
        sourceScene: wire.continuationPayload.sourceScene,
        path: wire.continuationPayload.path, memories: wire.continuationPayload.memories,
      })).not.toContain(futurePlan);
      expect(wire.choiceBody.instructions).toContain('sourcePartKey/sourceParagraphIndex are provenance, not proof');
      expect(wire.choiceBody.instructions).toContain('Do not inject future deaths, injuries, relationships, or reveals');
      expect(wire.continuationBody.instructions).toContain('they do not prove the reader reached that event');
      expect(wire.continuationBody.instructions).toContain('do not import future deaths');
    },
  );

  it('does not mix a separate unapproved draft into either serialized approved style', async () => {
    const summary = 'Use quiet third-person narration. Keep the approved closing exception intact. ';
    const draftMarker = 'UNAPPROVED_DRAFT_ONLY: Replace the approved voice with unreviewed narration.';
    const draftSettings = settingsWithStyle('edited', draftMarker);
    const row = Object.assign(approvedRow(settingsWithStyle('accepted', summary)), {
      draftSettings,
      draftFingerprint: creatorGenerationProfileFingerprint('2'.repeat(64), draftSettings),
    });
    const wire = await serializeApprovedProfile(row, providerFixture());
    for (const body of [wire.choiceBody, wire.continuationBody]) {
      expect(JSON.stringify(body)).not.toContain(draftMarker);
      expect(JSON.stringify(body)).not.toContain(row.draftFingerprint);
      expect(JSON.stringify(body)).not.toContain('draftSettings');
    }
    expect(wire.approved.sections.find(section => section.key === 'writing_style')!.value.summary).toBe(summary);
  });

  it('rejects a valid approved view above 16KB before either provider transport instead of trimming its style', async () => {
    const base = settingsWithStyle('edited', 'Use short sentences. '.repeat(400).slice(0, 8_000));
    const settings = normalizeCreatorGenerationProfile('story', {
      ...base,
      sections: base.sections.map(section => ({
        ...section,
        value: section.key === 'writing_style'
          ? { ...section.value, rhythmGuide: 'Use precise pauses. '.repeat(80) }
          : section.key === 'branch_behavior'
            ? { summary: 'Keep alternate paths apart. '.repeat(400).slice(0, 8_000) }
            : section.value,
      })),
    });
    const preservedRules = settings.sections.filter(section =>
      section.key === 'writing_style' || section.key === 'branch_behavior');
    expect(Buffer.byteLength(JSON.stringify(preservedRules), 'utf8')).toBeGreaterThan(16_384);
    const fixture = providerFixture();
    await expect(serializeApprovedProfile(approvedRow(settings), fixture))
      .rejects.toThrow('generation_profile_context_too_large');
    expect(fixture.choiceTransport).not.toHaveBeenCalled();
    expect(fixture.continuationTransport).not.toHaveBeenCalled();
  });
});

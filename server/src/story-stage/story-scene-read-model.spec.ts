import {
  findStorySceneProviderGuardViolations,
  buildStorySceneAssetFallbackErrorEnvelope,
  getStorySceneFixtureReadModel,
  listStorySceneFixtureReadModels,
  resolveStorySceneBackgroundState,
  resolveStorySceneCharacterVisibility,
  STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS,
  STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
  STORY_SCENE_ASSET_FALLBACK_ERROR_ENVELOPE_CONTRACT,
  STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT,
  STORY_SCENE_CHARACTER_LAYER_ORDER,
  STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT,
  STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT,
  STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT,
  STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT,
  STORY_SCENE_DEFAULT_FALLBACK_KEY,
  STORY_SCENE_FIXTURE_API_CONTRACT,
  STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT,
  STORY_SCENE_PROVIDER_GUARD_CONTRACT,
  STORY_SCENE_READ_MODEL_CONTRACT,
  STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT,
  STORY_PRODUCTION_CURRENT_SCENE_ALLOWED_RESPONSE_FIELDS,
} from './story-scene-read-model';
import { STORY_STAGE_CONTRACT } from './story-stage-contract';

describe('Story scene read model fixtures', () => {
  it('publishes a safe scene read model shape with fixture API path', () => {
    const fixtures = listStorySceneFixtureReadModels();

    expect(STORY_STAGE_CONTRACT.storySceneReadModel).toBe(
      STORY_SCENE_READ_MODEL_CONTRACT,
    );
    expect(STORY_SCENE_READ_MODEL_CONTRACT.fixtureApiContract).toBe(
      STORY_SCENE_FIXTURE_API_CONTRACT,
    );
    expect(STORY_SCENE_FIXTURE_API_CONTRACT.endpoint).toMatchObject({
      method: 'GET',
      path: '/api/v1/story-sessions/fixtures/story-scene-preview/scenes',
      enabled: false,
      authRequired: false,
      fixtureFlag: 'storySceneFixturePreview',
    });
    expect(STORY_SCENE_FIXTURE_API_CONTRACT.localeFields).toBe(
      STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT,
    );
    expect(fixtures).toHaveLength(3);

    for (const fixture of fixtures) {
      expect(Object.keys(fixture).sort()).toEqual(
        [...STORY_SCENE_ALLOWED_RESPONSE_FIELDS].sort(),
      );
      expect(Object.keys(fixture.backgroundAsset).sort()).toEqual(
        [...STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS].sort(),
      );
      expect(
        findStorySceneProviderGuardViolations(fixture),
      ).toHaveLength(0);
    }
  });

  it('guards live story-stage fixture cards for #1608 without mutations', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.liveFixtureExposureGuard).toBe(
      STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT,
    );
    expect(STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT.route).toMatchObject({
      path: '/story-stage',
      queryFlag: 'storySceneFixturePreview=1',
      expectedSectionAttribute: 'data-story-stage-fixture-preview',
      expectedCardAttribute: 'data-story-branch-fixture-card',
    });
    expect(
      STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT.requiredChoiceCards,
    ).toEqual([
      expect.objectContaining({
        choice: 'A',
        nextSceneId: 'S05',
        backgroundState: 'bg-war-room-map',
      }),
      expect.objectContaining({
        choice: 'B',
        nextSceneId: 'S06',
        backgroundState: 'bg-harbor-night',
      }),
      expect.objectContaining({
        choice: 'C',
        nextSceneId: 'S07',
        backgroundState: 'bg-fog-shore',
      }),
    ]);
    expect(
      STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT.failureConditions,
    ).toEqual(
      expect.arrayContaining([
        'live_fixture_route_returns_zero_branch_cards',
        'fixture_flag_not_visible_in_dom',
      ]),
    );
    expect(
      Object.values(
        STORY_STAGE_LIVE_FIXTURE_EXPOSURE_GUARD_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('covers ready, characterless, and fallback scene combinations', () => {
    const fixtures = listStorySceneFixtureReadModels();
    const backgroundAssetIds = new Set(
      fixtures.map((fixture) => fixture.backgroundAsset.assetId),
    );

    expect(backgroundAssetIds.size).toBe(3);
    expect(
      fixtures.some((fixture) => fixture.characters.length > 0),
    ).toBe(true);
    expect(
      fixtures.some((fixture) => fixture.characters.length === 0),
    ).toBe(true);
    expect(
      fixtures.some((fixture) => fixture.backgroundState === 'fallback'),
    ).toBe(true);
  });

  it('resolves missing or loading background state to public fallback data', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.backgroundStateResolver).toBe(
      STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT,
    );

    const missing = resolveStorySceneBackgroundState({
      backgroundAsset: null,
      requestedBackgroundState: 'missing',
    });
    expect(missing).toMatchObject({
      backgroundState: 'fallback',
      fallbackKey: STORY_SCENE_DEFAULT_FALLBACK_KEY,
    });
    expect(missing.backgroundAsset.assetId).toBe(
      'story-scene-background-fallback-default',
    );

    const loading = resolveStorySceneBackgroundState({
      requestedBackgroundState: 'loading',
    });
    expect(loading.backgroundState).toBe('loading');
    expect(loading.backgroundAsset.assetId).toBe(
      'story-scene-background-fallback-default',
    );
    expect(
      Object.values(
        STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps character projection ordered by layer and empty scenes explicit', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.characterLayerReadModel).toBe(
      STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT,
    );

    const bridge = getStorySceneFixtureReadModel(
      'fixture-scene-collapsed-bridge',
    );
    const archive = getStorySceneFixtureReadModel('fixture-scene-archive-room');

    expect(bridge).toBeDefined();
    expect(archive).toBeDefined();
    expect(archive?.characters).toEqual([]);
    expect(
      STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT.emptySceneBehavior
        .charactersReturnedAsEmptyArray,
    ).toBe(true);

    const layers = bridge?.characters.map((character) => character.characterLayer);
    expect(layers).toEqual(['midground', 'offscreen']);
    expect(layers?.map((layer) => STORY_SCENE_CHARACTER_LAYER_ORDER[layer])).toEqual(
      [1, 3],
    );

    for (const character of bridge?.characters ?? []) {
      expect(Object.keys(character).sort()).toEqual(
        [...STORY_SCENE_ALLOWED_CHARACTER_FIELDS].sort(),
      );
    }
    expect(bridge?.characters.map((character) => character.visibility)).toEqual([
      'visible',
      'offscreen',
    ]);
    expect(
      resolveStorySceneCharacterVisibility({
        characterLayer: 'foreground',
        entranceState: 'absent',
      }),
    ).toBe('hidden');
  });

  it('guards future provider expansion from leaking provider or private fields', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.providerGuardContract).toBe(
      STORY_SCENE_PROVIDER_GUARD_CONTRACT,
    );

    const violations = findStorySceneProviderGuardViolations({
      sceneId: 'unsafe-scene',
      providerPayload: { prompt: 'hidden' },
      backgroundAsset: {
        assetId: 'unsafe-background',
        url: '/fixtures/story-scenes/backgrounds/unsafe.webp',
        storageKey: 'private/object/path',
      },
      characters: [
        {
          characterId: 'unsafe-character',
          privatePersona: 'hidden',
        },
      ],
    });

    expect(violations).toEqual([
      'providerPayload',
      'backgroundAsset.storageKey',
      'characters[0].privatePersona',
    ]);
    expect(
      Object.values(STORY_SCENE_PROVIDER_GUARD_CONTRACT.mutationPolicy).every(
        (enabled) => enabled === false,
      ),
    ).toBe(true);
  });

  it('enables the authenticated production current-scene projection', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.currentSceneEndpointDelta).toBe(
      STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT,
    );
    expect(STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT.endpoint).toMatchObject(
      {
        method: 'GET',
        path: '/api/v1/story-sessions/:sessionId/current-scene',
        enabled: true,
        authRequired: true,
        response: 'StoryProductionCurrentSceneProjection',
      },
    );
    expect(
      STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT.allowedResponseFields,
    ).toBe(STORY_PRODUCTION_CURRENT_SCENE_ALLOWED_RESPONSE_FIELDS);
    expect(
      Object.values(
        STORY_SCENE_CURRENT_SCENE_ENDPOINT_DELTA_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('keeps future choice and progress writes behind a disabled no-mutation guard', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.choiceProgressWriteGuard).toBe(
      STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT,
    );
    expect(
      STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT.previewFixtureMode,
    ).toMatchObject({
      readOnly: true,
      acceptsChoiceSubmit: false,
      advancesProgress: false,
      failureMessageKey: 'storyStage.scene.choice.readOnlyPreview',
    });
    expect(
      Object.values(
        STORY_SCENE_CHOICE_PROGRESS_WRITE_GUARD_CONTRACT.mutationPolicy,
      ).every((enabled) => enabled === false),
    ).toBe(true);
  });

  it('publishes fixture locale key fields without translated bodies or provider copy', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.fixtureLocaleFields).toBe(
      STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT,
    );
    expect(
      STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT.supportedLocaleSlots,
    ).toEqual(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']);
    expect(
      STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT.fixtureFieldsUsingI18nKeys,
    ).toEqual(
      expect.arrayContaining([
        'sceneText',
        'backgroundAsset.labelKey',
        'characters[].displayNameKey',
        'fallbackKey',
      ]),
    );
    expect(STORY_SCENE_FIXTURE_LOCALE_FIELD_CONTRACT.copyPolicy).toMatchObject({
      fullTranslatedCopyInFixture: false,
      publicKeyPreferred: true,
      rawProviderPromptAllowedAsCopy: false,
    });
  });

  it('contracts character visibility resolver and asset fallback error envelope', () => {
    expect(STORY_SCENE_READ_MODEL_CONTRACT.characterVisibilityResolver).toBe(
      STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT,
    );
    expect(STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT.states).toEqual([
      'visible',
      'offscreen',
      'hidden',
    ]);
    expect(
      STORY_SCENE_CHARACTER_VISIBILITY_RESOLVER_CONTRACT.emptySceneBehavior
        .returnsEmptyCharactersArray,
    ).toBe(true);

    expect(STORY_SCENE_READ_MODEL_CONTRACT.assetFallbackErrorEnvelope).toBe(
      STORY_SCENE_ASSET_FALLBACK_ERROR_ENVELOPE_CONTRACT,
    );
    const envelope = buildStorySceneAssetFallbackErrorEnvelope({
      code: 'STORY_SCENE_BACKGROUND_ASSET_UNAVAILABLE',
    });
    expect(Object.keys(envelope).sort()).toEqual(
      ['code', 'fallbackKey', 'retryable', 'shortLabelKey'].sort(),
    );
    expect(envelope).toMatchObject({
      code: 'STORY_SCENE_BACKGROUND_ASSET_UNAVAILABLE',
      fallbackKey: STORY_SCENE_DEFAULT_FALLBACK_KEY,
      retryable: false,
    });
    expect(
      Object.values(
        STORY_SCENE_ASSET_FALLBACK_ERROR_ENVELOPE_CONTRACT.privacy,
      ).every((returned) => returned === false),
    ).toBe(true);
  });
});

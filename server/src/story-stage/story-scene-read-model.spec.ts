import {
  findStorySceneProviderGuardViolations,
  getStorySceneFixtureReadModel,
  listStorySceneFixtureReadModels,
  resolveStorySceneBackgroundState,
  STORY_SCENE_ALLOWED_BACKGROUND_ASSET_FIELDS,
  STORY_SCENE_ALLOWED_CHARACTER_FIELDS,
  STORY_SCENE_ALLOWED_RESPONSE_FIELDS,
  STORY_SCENE_BACKGROUND_STATE_RESOLVER_CONTRACT,
  STORY_SCENE_CHARACTER_LAYER_ORDER,
  STORY_SCENE_CHARACTER_LAYER_READ_MODEL_CONTRACT,
  STORY_SCENE_DEFAULT_FALLBACK_KEY,
  STORY_SCENE_FIXTURE_API_CONTRACT,
  STORY_SCENE_PROVIDER_GUARD_CONTRACT,
  STORY_SCENE_READ_MODEL_CONTRACT,
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
});

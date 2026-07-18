import {
  findStoryChoiceVisualRouteViolations,
  projectStoredStorySceneVisualManifest,
  projectStorySceneVisualManifest,
  STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT,
} from './story-scene-visual-manifest-contract';

describe('story scene visual manifest API contract', () => {
  it('projects public visual fields and uses a locale-neutral fallback', () => {
    const projection = projectStorySceneVisualManifest({
      sceneKey: 'scene-a',
      background: {
        publicAssetPath: null,
        altKey: 'story.visual.sceneA',
        state: 'missing',
      },
      characters: [
        {
          characterKey: 'lead',
          placement: 'left',
          expressionKey: 'story.expression.focused',
          publicAssetPath: '/assets/story/lead-focused.webp',
        },
        {
          characterKey: 'guide',
          placement: 'right',
          expressionKey: 'story.expression.neutral',
        },
      ],
      fallback: {
        publicAssetPath: '/assets/story/fallback-neutral.webp',
        altKey: 'story.visual.fallback',
      },
    });

    expect(projection.background).toEqual({
      publicAssetPath: '/assets/story/fallback-neutral.webp',
      altKey: 'story.visual.fallback',
      state: 'fallback',
    });
    expect(projection.characters[1]).toMatchObject({
      publicAssetPath: '/assets/story/fallback-neutral.webp',
      fallbackUsed: true,
    });
    expect(JSON.stringify(projection)).not.toMatch(
      /storage|provider|internalId/i,
    );
  });

  it('requires distinct choice manifests until an explicit rejoin', () => {
    const distinctRoutes = ['a', 'b', 'c'].map((choice) => ({
      choiceKey: `choice-${choice}`,
      nextSceneKey: `scene-${choice}`,
      manifestSceneKey: `scene-${choice}`,
      explicitRejoin: false,
    }));
    expect(findStoryChoiceVisualRouteViolations(distinctRoutes)).toEqual([]);

    const forcedConvergence = distinctRoutes.map((route) => ({
      ...route,
      nextSceneKey: 'scene-shared',
      manifestSceneKey: 'scene-shared',
    }));
    expect(findStoryChoiceVisualRouteViolations(forcedConvergence)).toContain(
      'unmarked_choice_convergence:scene-shared',
    );

    const explicitRejoin = forcedConvergence.map((route) => ({
      ...route,
      explicitRejoin: true,
      rejoinGroupKey: 'rejoin-after-local-scenes',
    }));
    expect(findStoryChoiceVisualRouteViolations(explicitRejoin)).toEqual([]);
    expect(STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT.endpoint).toMatchObject({
      path: '/api/v1/story-sessions/:sessionId/current-scene',
      enabled: true,
      authRequired: true,
      responseField: 'scene.visualManifest',
    });
  });

  it('allows only safe stored manifest fields and rejects an unsafe fallback', () => {
    const projection = projectStoredStorySceneVisualManifest(
      {
        sceneKey: 'scene-a',
        background: {
          publicAssetPath: '/assets/story/scene-a.webp',
          altKey: 'story.visual.sceneA',
          state: 'ready',
          storageKey: 'private/background.webp',
        },
        characters: [
          {
            characterKey: 'lead',
            placement: 'left',
            expressionKey: 'story.expression.focused',
            publicAssetPath: '../private/lead.webp',
            providerPayload: { id: 'private-provider-id' },
          },
        ],
        fallback: {
          publicAssetPath: '/assets/story/fallback.webp',
          altKey: 'story.visual.fallback',
        },
        internalPrompt: 'private prompt',
      },
      'scene-a',
    );

    expect(projection).toEqual({
      sceneKey: 'scene-a',
      background: {
        publicAssetPath: '/assets/story/scene-a.webp',
        altKey: 'story.visual.sceneA',
        state: 'ready',
      },
      characters: [
        {
          characterKey: 'lead',
          placement: 'left',
          expressionKey: 'story.expression.focused',
          publicAssetPath: '/assets/story/fallback.webp',
          fallbackUsed: true,
        },
      ],
    });
    expect(JSON.stringify(projection)).not.toMatch(/storage|provider|prompt/i);
    expect(
      projectStoredStorySceneVisualManifest(
        {
          sceneKey: 'scene-a',
          fallback: { publicAssetPath: '../private.webp', altKey: 'fallback' },
        },
        'scene-a',
      ),
    ).toBeNull();
  });
});

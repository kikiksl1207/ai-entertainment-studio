import {
  findStoryChoiceVisualRouteViolations,
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
    expect(STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT.endpoint.enabled).toBe(
      false,
    );
  });
});

import {
  validateFreeStoryReleaseConfiguration,
  validateStoryReleaseGraphCandidate,
  validateStoryReleaseVisualCandidate,
} from './story-release-validation';

const baseScenes = [
  { sceneId: 'scene-start' },
  { sceneId: 'scene-left' },
  { sceneId: 'scene-right' },
  { sceneId: 'scene-end', terminal: true },
] as const;

const baseRoutes = [
  {
    sourceSceneId: 'scene-start',
    choiceId: 'choice-1',
    displaySlot: 1,
    nextSceneId: 'scene-left',
    stateChangeKey: 'state-left',
  },
  {
    sourceSceneId: 'scene-start',
    choiceId: 'choice-2',
    displaySlot: 2,
    nextSceneId: 'scene-right',
    stateChangeKey: 'state-right',
  },
  {
    sourceSceneId: 'scene-start',
    choiceId: 'choice-3',
    displaySlot: 3,
    nextSceneId: 'scene-end',
    stateChangeKey: 'state-direct-end',
  },
  {
    sourceSceneId: 'scene-left',
    choiceId: 'choice-left',
    displaySlot: 1,
    nextSceneId: 'scene-end',
    stateChangeKey: 'state-left-resolved',
  },
  {
    sourceSceneId: 'scene-right',
    choiceId: 'choice-right',
    displaySlot: 1,
    nextSceneId: 'scene-end',
    stateChangeKey: 'state-right-resolved',
  },
] as const;

describe('story release candidate validation', () => {
  it('accepts a free fixed-choice release with reachable writer ending', () => {
    expect(
      validateFreeStoryReleaseConfiguration({
        pricingMode: 'free',
        customChoiceAllowed: false,
        choiceRoutes: baseRoutes,
      }),
    ).toMatchObject({ valid: true, violationCodes: [] });

    expect(
      validateStoryReleaseGraphCandidate({
        entrySceneId: 'scene-start',
        scenes: baseScenes,
        choiceRoutes: baseRoutes,
        endings: [
          {
            endingId: 'ending-main',
            sceneId: 'scene-end',
            provenance: 'author_main',
          },
        ],
      }),
    ).toMatchObject({
      valid: true,
      counts: { sceneCount: 4, choiceRouteCount: 5, endingCount: 1 },
    });
  });

  it('blocks custom choices, unsafe convergence, cycles, and unreachable endings', () => {
    const result = validateStoryReleaseGraphCandidate({
      entrySceneId: 'scene-start',
      scenes: [
        { sceneId: 'scene-start' },
        { sceneId: 'scene-loop' },
        { sceneId: 'scene-end', terminal: true },
        { sceneId: 'scene-unreachable', terminal: true },
      ],
      choiceRoutes: [
        {
          sourceSceneId: 'scene-start',
          choiceId: 'choice-1',
          displaySlot: 1,
          nextSceneId: 'scene-loop',
          stateChangeKey: 'state-a',
        },
        {
          sourceSceneId: 'scene-start',
          choiceId: 'choice-2',
          displaySlot: 2,
          nextSceneId: 'scene-loop',
          stateChangeKey: 'state-b',
        },
        {
          sourceSceneId: 'scene-loop',
          choiceId: 'choice-loop',
          displaySlot: 1,
          nextSceneId: 'scene-start',
          stateChangeKey: 'state-loop',
        },
      ],
      endings: [
        {
          endingId: 'ending-unreachable',
          sceneId: 'scene-unreachable',
          provenance: 'author_sub',
        },
      ],
    });

    expect(
      validateFreeStoryReleaseConfiguration({
        pricingMode: 'free',
        customChoiceAllowed: true,
        choiceRoutes: baseRoutes,
      }).violationCodes,
    ).toContain('free_release_custom_choice_disabled');
    expect(result.valid).toBe(false);
    expect(result.violationCodes).toEqual(
      expect.arrayContaining([
        'immediate_unpreserved_convergence:scene-start:scene-loop',
        'graph_cycle:scene-start',
        'ending_unreachable:ending-unreachable',
      ]),
    );
  });

  it('requires every scene and choice to bind a safe public visual manifest', () => {
    const visualResult = validateStoryReleaseVisualCandidate({
      scenes: baseScenes,
      choiceRoutes: baseRoutes,
      visualRoutes: baseRoutes.map((route) => ({
        choiceKey: route.choiceId,
        nextSceneKey: route.nextSceneId,
        manifestSceneKey: route.nextSceneId,
        explicitRejoin: false,
      })),
      manifests: baseScenes.map((scene) => ({
        sceneKey: scene.sceneId,
        background: {
          publicAssetPath: `/assets/story/${scene.sceneId}.webp`,
          altKey: `story.visual.${scene.sceneId}`,
          state: 'ready' as const,
        },
        characters: [],
        fallback: {
          publicAssetPath: '/assets/story/fallback-neutral.webp',
          altKey: 'story.visual.fallback',
        },
      })),
    });

    expect(visualResult).toMatchObject({ valid: true, violationCodes: [] });

    const missingManifest = validateStoryReleaseVisualCandidate({
      scenes: baseScenes,
      choiceRoutes: baseRoutes,
      visualRoutes: [],
      manifests: [],
    });
    expect(missingManifest.violationCodes).toEqual(
      expect.arrayContaining([
        'manifest_missing:scene-start',
        'visual_route_missing:choice-1',
      ]),
    );
  });
});

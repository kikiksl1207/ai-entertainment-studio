export type StoryVisualAssetState =
  | 'ready'
  | 'loading'
  | 'missing'
  | 'fallback';

export interface StorySceneVisualManifestSource {
  sceneKey: string;
  background: {
    publicAssetPath?: string | null;
    altKey: string;
    state: StoryVisualAssetState;
  };
  characters: Array<{
    characterKey: string;
    placement: 'left' | 'center' | 'right' | 'offscreen';
    expressionKey: string;
    publicAssetPath?: string | null;
  }>;
  fallback: {
    publicAssetPath: string;
    altKey: string;
  };
}

export interface StorySceneVisualManifestProjection {
  sceneKey: string;
  background: {
    publicAssetPath: string;
    altKey: string;
    state: StoryVisualAssetState;
  };
  characters: Array<{
    characterKey: string;
    placement: 'left' | 'center' | 'right' | 'offscreen';
    expressionKey: string;
    publicAssetPath: string;
    fallbackUsed: boolean;
  }>;
}

export interface StoryChoiceVisualRoute {
  choiceKey: string;
  nextSceneKey: string;
  manifestSceneKey: string;
  explicitRejoin: boolean;
  rejoinGroupKey?: string;
}

function isSafePublicAssetPath(value?: string | null): value is string {
  return Boolean(value?.startsWith('/') && !value.includes('..'));
}

export function projectStorySceneVisualManifest(
  source: StorySceneVisualManifestSource,
): StorySceneVisualManifestProjection {
  const backgroundAssetPath = source.background.publicAssetPath;
  const backgroundReady =
    source.background.state === 'ready' &&
    isSafePublicAssetPath(backgroundAssetPath);

  return {
    sceneKey: source.sceneKey,
    background: {
      publicAssetPath: backgroundReady
        ? backgroundAssetPath
        : source.fallback.publicAssetPath,
      altKey: backgroundReady
        ? source.background.altKey
        : source.fallback.altKey,
      state: backgroundReady ? 'ready' : 'fallback',
    },
    characters: source.characters.map((character) => {
      const characterAssetPath = character.publicAssetPath;
      const assetReady = isSafePublicAssetPath(characterAssetPath);
      return {
        characterKey: character.characterKey,
        placement: character.placement,
        expressionKey: character.expressionKey,
        publicAssetPath: assetReady
          ? characterAssetPath
          : source.fallback.publicAssetPath,
        fallbackUsed: !assetReady,
      };
    }),
  };
}

export function findStoryChoiceVisualRouteViolations(
  routes: readonly StoryChoiceVisualRoute[],
): string[] {
  const violations: string[] = [];
  const routesByNextScene = new Map<string, StoryChoiceVisualRoute[]>();

  for (const route of routes) {
    if (route.manifestSceneKey !== route.nextSceneKey) {
      violations.push(`manifest_scene_mismatch:${route.choiceKey}`);
    }
    if (route.explicitRejoin && !route.rejoinGroupKey) {
      violations.push(`rejoin_group_missing:${route.choiceKey}`);
    }
    routesByNextScene.set(route.nextSceneKey, [
      ...(routesByNextScene.get(route.nextSceneKey) ?? []),
      route,
    ]);
  }

  for (const [sceneKey, converged] of routesByNextScene) {
    if (converged.length < 2) continue;
    const groups = new Set(converged.map((route) => route.rejoinGroupKey));
    const validExplicitRejoin =
      converged.every((route) => route.explicitRejoin) &&
      groups.size === 1 &&
      !groups.has(undefined);
    if (!validExplicitRejoin) {
      violations.push(`unmarked_choice_convergence:${sceneKey}`);
    }
  }

  return violations;
}

export const STORY_SCENE_VISUAL_MANIFEST_API_CONTRACT = {
  version: '2026-07-11.story-scene-visual-manifest.v1',
  status: 'read_only_contract',
  endpoint: {
    method: 'GET',
    path: '/api/v1/story-stage/scenes/:sceneKey/visual-manifest',
    enabled: false,
  },
  projectionFields: ['sceneKey', 'background', 'characters'],
  backgroundFields: ['publicAssetPath', 'altKey', 'state'],
  characterFields: [
    'characterKey',
    'placement',
    'expressionKey',
    'publicAssetPath',
    'fallbackUsed',
  ],
  routePolicy: {
    nextSceneOwnsManifest: true,
    immediateChoiceConvergenceAllowed: false,
    explicitRejoinMayShareManifest: true,
  },
  fallbackPolicy: {
    localeNeutralAssetRequired: true,
    publicPathOnly: true,
    rawStoragePathReturned: false,
    internalIdentifierReturned: false,
  },
  mutationPolicy: {
    assetUpload: false,
    imageGeneration: false,
    providerCall: false,
    storyWrite: false,
    storyProgressMutation: false,
  },
} as const;

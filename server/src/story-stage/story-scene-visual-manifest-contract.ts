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

export function projectStoredStorySceneVisualManifest(
  value: unknown,
  expectedSceneKey: string,
): StorySceneVisualManifestProjection | null {
  const manifest = record(value);
  const background = record(manifest?.background);
  const fallback = record(manifest?.fallback);
  const sceneKey = text(manifest?.sceneKey);
  const fallbackAssetPath = text(fallback?.publicAssetPath);
  const fallbackAltKey = text(fallback?.altKey);
  if (
    sceneKey !== expectedSceneKey ||
    !isSafePublicAssetPath(fallbackAssetPath) ||
    !fallbackAltKey
  ) {
    return null;
  }

  const backgroundState = text(background?.state);
  const source: StorySceneVisualManifestSource = {
    sceneKey,
    background: {
      publicAssetPath: text(background?.publicAssetPath),
      altKey: text(background?.altKey) || fallbackAltKey,
      state: isVisualAssetState(backgroundState) ? backgroundState : 'missing',
    },
    characters: (Array.isArray(manifest?.characters) ? manifest.characters : [])
      .map((item) => record(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        characterKey: text(item.characterKey),
        placement: placement(item.placement),
        expressionKey: text(item.expressionKey),
        publicAssetPath: text(item.publicAssetPath),
      }))
      .filter((item) => Boolean(item.characterKey && item.expressionKey))
      .slice(0, 4),
    fallback: {
      publicAssetPath: fallbackAssetPath,
      altKey: fallbackAltKey,
    },
  };

  return projectStorySceneVisualManifest(source);
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
  status: 'production_read_projection',
  endpoint: {
    method: 'GET',
    path: '/api/v1/story-sessions/:sessionId/current-scene',
    enabled: true,
    authRequired: true,
    responseField: 'scene.visualManifest',
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isVisualAssetState(value: string): value is StoryVisualAssetState {
  return ['ready', 'loading', 'missing', 'fallback'].includes(value);
}

function placement(
  value: unknown,
): 'left' | 'center' | 'right' | 'offscreen' {
  return ['left', 'center', 'right', 'offscreen'].includes(String(value))
    ? (value as 'left' | 'center' | 'right' | 'offscreen')
    : 'offscreen';
}

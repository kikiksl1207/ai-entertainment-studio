import {
  findStoryChoiceVisualRouteViolations,
  projectStorySceneVisualManifest,
  type StoryChoiceVisualRoute,
  type StorySceneVisualManifestSource,
} from './story-scene-visual-manifest-contract';

export const STORY_FREE_RELEASE_FIXED_CHOICE_SLOTS = [1, 2, 3] as const;

export type StoryEndingProvenance =
  | 'author_main'
  | 'author_sub'
  | 'ai_generated';

export interface StoryReleaseSceneCandidate {
  sceneId: string;
  terminal?: boolean;
}

export interface StoryReleaseChoiceRouteCandidate {
  sourceSceneId: string;
  choiceId: string;
  displaySlot: number;
  nextSceneId: string;
  stateChangeKey: string;
  explicitRejoin?: boolean;
  rejoinGroupKey?: string;
}

export interface StoryReleaseEndingCandidate {
  endingId: string;
  sceneId: string;
  provenance: StoryEndingProvenance;
}

export interface StoryReleaseGraphCandidate {
  entrySceneId: string;
  scenes: readonly StoryReleaseSceneCandidate[];
  choiceRoutes: readonly StoryReleaseChoiceRouteCandidate[];
  endings: readonly StoryReleaseEndingCandidate[];
}

export interface StoryFreeReleaseConfiguration {
  pricingMode: 'free' | 'paid' | 'mixed';
  customChoiceAllowed: boolean;
  choiceRoutes: readonly StoryReleaseChoiceRouteCandidate[];
}

export interface StoryReleaseVisualCandidate {
  scenes: readonly StoryReleaseSceneCandidate[];
  choiceRoutes: readonly StoryReleaseChoiceRouteCandidate[];
  visualRoutes: readonly StoryChoiceVisualRoute[];
  manifests: readonly StorySceneVisualManifestSource[];
}

export interface StoryReleaseValidationResult {
  valid: boolean;
  violationCodes: string[];
  counts: {
    sceneCount: number;
    choiceRouteCount: number;
    endingCount: number;
    manifestCount: number;
  };
}

const ALLOWED_ENDING_PROVENANCE = new Set<StoryEndingProvenance>([
  'author_main',
  'author_sub',
  'ai_generated',
]);

function result(
  violations: Set<string>,
  counts: Partial<StoryReleaseValidationResult['counts']>,
): StoryReleaseValidationResult {
  return {
    valid: violations.size === 0,
    violationCodes: [...violations].sort(),
    counts: {
      sceneCount: counts.sceneCount ?? 0,
      choiceRouteCount: counts.choiceRouteCount ?? 0,
      endingCount: counts.endingCount ?? 0,
      manifestCount: counts.manifestCount ?? 0,
    },
  };
}

function isFixedChoiceSlot(value: number): boolean {
  return STORY_FREE_RELEASE_FIXED_CHOICE_SLOTS.includes(
    value as (typeof STORY_FREE_RELEASE_FIXED_CHOICE_SLOTS)[number],
  );
}

function hasSafePublicAssetPath(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith('/') && !value.includes('..'));
}

export function validateFreeStoryReleaseConfiguration(
  input: StoryFreeReleaseConfiguration,
): StoryReleaseValidationResult {
  const violations = new Set<string>();

  if (input.pricingMode !== 'free') {
    violations.add('free_release_pricing_required');
  }
  if (input.customChoiceAllowed) {
    violations.add('free_release_custom_choice_disabled');
  }
  for (const route of input.choiceRoutes) {
    if (!isFixedChoiceSlot(route.displaySlot)) {
      violations.add(`invalid_fixed_choice_slot:${route.choiceId}`);
    }
  }

  return result(violations, { choiceRouteCount: input.choiceRoutes.length });
}

export function validateStoryReleaseGraphCandidate(
  input: StoryReleaseGraphCandidate,
): StoryReleaseValidationResult {
  const violations = new Set<string>();
  const scenesById = new Map<string, StoryReleaseSceneCandidate>();
  const routesBySource = new Map<
    string,
    StoryReleaseChoiceRouteCandidate[]
  >();
  const routesByChoiceId = new Set<string>();

  for (const scene of input.scenes) {
    if (!scene.sceneId) {
      violations.add('scene_id_missing');
      continue;
    }
    if (scenesById.has(scene.sceneId)) {
      violations.add(`duplicate_scene_id:${scene.sceneId}`);
    }
    scenesById.set(scene.sceneId, scene);
  }

  if (!scenesById.has(input.entrySceneId)) {
    violations.add('entry_scene_missing');
  }

  for (const route of input.choiceRoutes) {
    if (!route.choiceId) {
      violations.add('choice_id_missing');
    } else if (routesByChoiceId.has(route.choiceId)) {
      violations.add(`duplicate_choice_id:${route.choiceId}`);
    } else {
      routesByChoiceId.add(route.choiceId);
    }
    if (!scenesById.has(route.sourceSceneId)) {
      violations.add(`choice_source_scene_missing:${route.choiceId}`);
    }
    if (!scenesById.has(route.nextSceneId)) {
      violations.add(`choice_next_scene_missing:${route.choiceId}`);
    }
    if (!isFixedChoiceSlot(route.displaySlot)) {
      violations.add(`invalid_fixed_choice_slot:${route.choiceId}`);
    }
    routesBySource.set(route.sourceSceneId, [
      ...(routesBySource.get(route.sourceSceneId) ?? []),
      route,
    ]);
  }

  for (const [sourceSceneId, routes] of routesBySource) {
    const slots = new Set<number>();
    for (const route of routes) {
      if (slots.has(route.displaySlot)) {
        violations.add(`duplicate_choice_slot:${sourceSceneId}`);
      }
      slots.add(route.displaySlot);
    }

    const routesByNextScene = new Map<
      string,
      StoryReleaseChoiceRouteCandidate[]
    >();
    for (const route of routes) {
      routesByNextScene.set(route.nextSceneId, [
        ...(routesByNextScene.get(route.nextSceneId) ?? []),
        route,
      ]);
    }
    for (const [nextSceneId, converged] of routesByNextScene) {
      if (converged.length < 2) continue;
      const rejoinGroups = new Set(
        converged.map((route) => route.rejoinGroupKey?.trim() || ''),
      );
      const stateChanges = new Set(
        converged.map((route) => route.stateChangeKey.trim()),
      );
      const preservedExplicitRejoin =
        converged.every((route) => route.explicitRejoin === true) &&
        rejoinGroups.size === 1 &&
        !rejoinGroups.has('') &&
        stateChanges.size === converged.length &&
        !stateChanges.has('');
      if (!preservedExplicitRejoin) {
        violations.add(`immediate_unpreserved_convergence:${sourceSceneId}:${nextSceneId}`);
      }
    }
  }

  for (const scene of input.scenes) {
    if (!scene.terminal && !routesBySource.has(scene.sceneId)) {
      violations.add(`nonterminal_scene_without_choices:${scene.sceneId}`);
    }
  }

  const reachable = new Set<string>();
  const active = new Set<string>();
  const visit = (sceneId: string) => {
    if (active.has(sceneId)) {
      violations.add(`graph_cycle:${sceneId}`);
      return;
    }
    if (reachable.has(sceneId)) return;
    reachable.add(sceneId);
    active.add(sceneId);
    for (const route of routesBySource.get(sceneId) ?? []) {
      if (scenesById.has(route.nextSceneId)) visit(route.nextSceneId);
    }
    active.delete(sceneId);
  };
  if (scenesById.has(input.entrySceneId)) visit(input.entrySceneId);

  for (const sceneId of scenesById.keys()) {
    if (!reachable.has(sceneId)) {
      violations.add(`scene_unreachable:${sceneId}`);
    }
  }

  const endingsById = new Set<string>();
  const endingSceneIds = new Set<string>();
  for (const ending of input.endings) {
    if (!ending.endingId) {
      violations.add('ending_id_missing');
    } else if (endingsById.has(ending.endingId)) {
      violations.add(`duplicate_ending_id:${ending.endingId}`);
    } else {
      endingsById.add(ending.endingId);
    }
    if (!scenesById.has(ending.sceneId)) {
      violations.add(`ending_scene_missing:${ending.endingId}`);
    }
    if (!reachable.has(ending.sceneId)) {
      violations.add(`ending_unreachable:${ending.endingId}`);
    }
    if (!ALLOWED_ENDING_PROVENANCE.has(ending.provenance)) {
      violations.add(`ending_provenance_invalid:${ending.endingId}`);
    }
    endingSceneIds.add(ending.sceneId);
  }

  if (input.endings.length === 0) {
    violations.add('ending_missing');
  }
  for (const scene of input.scenes) {
    if (scene.terminal && !endingSceneIds.has(scene.sceneId)) {
      violations.add(`terminal_scene_ending_missing:${scene.sceneId}`);
    }
  }

  return result(violations, {
    sceneCount: input.scenes.length,
    choiceRouteCount: input.choiceRoutes.length,
    endingCount: input.endings.length,
  });
}

export function validateStoryReleaseVisualCandidate(
  input: StoryReleaseVisualCandidate,
): StoryReleaseValidationResult {
  const violations = new Set<string>();
  const sceneIds = new Set(input.scenes.map((scene) => scene.sceneId));
  const choicesById = new Map(
    input.choiceRoutes.map((route) => [route.choiceId, route]),
  );
  const manifestsByScene = new Map<string, StorySceneVisualManifestSource>();
  const visualRoutesByChoice = new Map<string, StoryChoiceVisualRoute>();

  for (const manifest of input.manifests) {
    if (!sceneIds.has(manifest.sceneKey)) {
      violations.add(`manifest_scene_missing:${manifest.sceneKey}`);
    }
    if (manifestsByScene.has(manifest.sceneKey)) {
      violations.add(`duplicate_manifest_scene:${manifest.sceneKey}`);
    }
    manifestsByScene.set(manifest.sceneKey, manifest);

    if (!hasSafePublicAssetPath(manifest.fallback.publicAssetPath)) {
      violations.add(`fallback_asset_invalid:${manifest.sceneKey}`);
    }
    if (
      manifest.background.state === 'ready' &&
      !hasSafePublicAssetPath(manifest.background.publicAssetPath)
    ) {
      violations.add(`background_asset_invalid:${manifest.sceneKey}`);
    }
    for (const character of manifest.characters) {
      if (
        character.publicAssetPath &&
        !hasSafePublicAssetPath(character.publicAssetPath)
      ) {
        violations.add(
          `character_asset_invalid:${manifest.sceneKey}:${character.characterKey}`,
        );
      }
    }
    projectStorySceneVisualManifest(manifest);
  }

  for (const sceneId of sceneIds) {
    if (!manifestsByScene.has(sceneId)) {
      violations.add(`manifest_missing:${sceneId}`);
    }
  }

  const visualRoutesBySource = new Map<string, StoryChoiceVisualRoute[]>();
  for (const visualRoute of input.visualRoutes) {
    if (visualRoutesByChoice.has(visualRoute.choiceKey)) {
      violations.add(`duplicate_visual_route:${visualRoute.choiceKey}`);
    }
    visualRoutesByChoice.set(visualRoute.choiceKey, visualRoute);
    const choiceRoute = choicesById.get(visualRoute.choiceKey);
    if (!choiceRoute) {
      violations.add(`visual_route_choice_missing:${visualRoute.choiceKey}`);
      continue;
    }
    if (choiceRoute.nextSceneId !== visualRoute.nextSceneKey) {
      violations.add(`visual_route_next_scene_mismatch:${visualRoute.choiceKey}`);
    }
    visualRoutesBySource.set(choiceRoute.sourceSceneId, [
      ...(visualRoutesBySource.get(choiceRoute.sourceSceneId) ?? []),
      visualRoute,
    ]);
  }

  for (const choiceId of choicesById.keys()) {
    if (!visualRoutesByChoice.has(choiceId)) {
      violations.add(`visual_route_missing:${choiceId}`);
    }
  }
  for (const routes of visualRoutesBySource.values()) {
    for (const violation of findStoryChoiceVisualRouteViolations(routes)) {
      violations.add(violation);
    }
  }

  return result(violations, {
    sceneCount: input.scenes.length,
    choiceRouteCount: input.choiceRoutes.length,
    manifestCount: input.manifests.length,
  });
}

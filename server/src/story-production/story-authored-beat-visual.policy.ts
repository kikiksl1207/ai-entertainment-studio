import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import { isPublicStorySourceSafe } from './story-production.policy';

export function projectAuthoredBeatVisual(beat: { sourceSceneKey?: string | null; visualManifest?: unknown }) {
  if (beat.sourceSceneKey == null && beat.visualManifest == null) return { valid: true as const };
  if (!beat.sourceSceneKey || !isPublicStorySourceSafe({ manifest: beat.visualManifest })) return { valid: false as const };
  const manifest = projectStoredStorySceneVisualManifest(beat.visualManifest, beat.sourceSceneKey);
  if (!manifest) return { valid: false as const };
  return { valid: true as const, visualContext: { sourceSceneKey: beat.sourceSceneKey,
    assetReadiness: manifest.background.state === 'ready' ? 'ready' as const : 'missing' as const, manifest } };
}

export function missingAuthoredSceneVisual(sourceSceneKey: string) {
  return { sceneKey: sourceSceneKey, background: { state: 'missing', altKey: 'story.scene.background' },
    characters: [], fallback: { publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.scene.fallback' } };
}

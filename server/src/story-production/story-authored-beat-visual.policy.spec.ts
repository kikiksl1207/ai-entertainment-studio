import { missingAuthoredSceneVisual, projectAuthoredBeatVisual } from './story-authored-beat-visual.policy';

describe('authored beat visual context', () => {
  it('leaves legacy null and absent fields unchanged', () => {
    expect(projectAuthoredBeatVisual({})).toEqual({ valid: true });
    expect(projectAuthoredBeatVisual({ sourceSceneKey: null, visualManifest: null })).toEqual({ valid: true });
  });

  it('preserves distinct scene identity with honest missing assets and empty cast', () => {
    for (const key of ['part-001-scene-001', 'part-001-scene-002']) {
      expect(projectAuthoredBeatVisual({ sourceSceneKey: key, visualManifest: missingAuthoredSceneVisual(key) }))
        .toEqual({ valid: true, visualContext: { sourceSceneKey: key, assetReadiness: 'missing',
          manifest: { sceneKey: key, background: { state: 'fallback',
            publicAssetPath: '/assets/story/fallback.webp', altKey: 'story.scene.fallback' }, characters: [] } } });
    }
  });

  it('fails closed for incomplete or mismatched visual bindings', () => {
    expect(projectAuthoredBeatVisual({ sourceSceneKey: 's1' })).toEqual({ valid: false });
    expect(projectAuthoredBeatVisual({ visualManifest: missingAuthoredSceneVisual('s1') })).toEqual({ valid: false });
    expect(projectAuthoredBeatVisual({ sourceSceneKey: 's2', visualManifest: missingAuthoredSceneVisual('s1') }))
      .toEqual({ valid: false });
  });

  it('projects only public manifest fields, not arbitrary private keys', () => {
    const result = projectAuthoredBeatVisual({ sourceSceneKey: 's1', visualManifest: {
      ...missingAuthoredSceneVisual('s1'), privatePrompt: 'PRIVATE_SYNTHETIC_MARKER', storageKey: 'secret-object' } });
    expect(result.valid).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC_MARKER|storageKey|secret-object/);
  });
});

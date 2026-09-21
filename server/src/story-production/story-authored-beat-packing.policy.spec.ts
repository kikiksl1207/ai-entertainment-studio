import { createHash } from 'crypto';
import { packAuthoredSceneBeats } from './story-authored-beat-packing.policy';

describe('authored scene beat packing (synthetic local text only)', () => {
  it('preserves every scene boundary even when two scenes fit in one beat', () => {
    const scenes = [{ sourceSceneKey: 'part-001-scene-001', text: 'First synthetic scene.\n' },
      { sourceSceneKey: 'part-001-scene-002', text: 'Second synthetic scene.\n' }];
    const result = packAuthoredSceneBeats(scenes);
    expect(result.beats.map(beat => beat.sourceSceneKey)).toEqual(scenes.map(scene => scene.sourceSceneKey));
    expect(result.beats.map(beat => beat.text)).toEqual(scenes.map(scene => scene.text));
    expect(result.beats.map(beat => beat.position)).toEqual([1, 2]);
  });

  it('packs within one scene without trimming, normalization, or dropping whitespace', () => {
    const text = '  Opening.\r\n\r\n' + 'a'.repeat(7480) + '\r\n\r\n' + 'b'.repeat(7480) + '\n\nEnding.  \n';
    const result = packAuthoredSceneBeats([{ sourceSceneKey: 's1', text }]);
    expect(result.beats.length).toBeGreaterThan(1);
    expect(result.beats.every(beat => beat.text.length <= 7500 && beat.sourceSceneKey === 's1')).toBe(true);
    expect(result.beats.map(beat => beat.text).join('')).toBe(text);
    expect(result.scenes[0]).toMatchObject({ textBytes: Buffer.byteLength(text),
      textSha256: createHash('sha256').update(text).digest('hex'), firstBeatPosition: 1,
      beatCount: result.beats.length });
    for (const beat of result.beats) {
      expect(text.slice(beat.sceneTextStart, beat.sceneTextEnd)).toBe(beat.text);
    }
  });

  it('never splits a supplementary code point or a CRLF pair', () => {
    for (const text of ['x'.repeat(7499) + '\ud83d\ude00' + 'tail', 'x'.repeat(7499) + '\r\ntail']) {
      const result = packAuthoredSceneBeats([{ sourceSceneKey: 's1', text }]);
      expect(result.beats.map(beat => beat.text).join('')).toBe(text);
      expect(result.beats[0].text).toHaveLength(7499);
    }
  });

  it('retains ordered scene identity across multiple beats and the final scene', () => {
    const result = packAuthoredSceneBeats([{ sourceSceneKey: 's1', text: 'a'.repeat(15001) },
      { sourceSceneKey: 's2', text: 'Final authored body before any ending choice.' }]);
    expect(result.beats.map(beat => beat.sourceSceneKey)).toEqual(['s1', 's1', 's1', 's2']);
    expect(result.scenes.map(scene => [scene.firstBeatPosition, scene.beatCount])).toEqual([[1, 3], [4, 1]]);
  });

  it('accepts the reader limit exactly and rejects overflow instead of truncating', () => {
    const scenes = Array.from({ length: 40 }, (_, i) => ({ sourceSceneKey: `s${i}`, text: 'Body.' }));
    expect(packAuthoredSceneBeats(scenes).beats).toHaveLength(40);
    expect(() => packAuthoredSceneBeats([...scenes, { sourceSceneKey: 'extra', text: 'Body.' }])).toThrow();
    expect(() => packAuthoredSceneBeats([{ sourceSceneKey: 's1', text: 'a'.repeat(300001) }])).toThrow();
    expect(() => packAuthoredSceneBeats([{ sourceSceneKey: 's1', text: 'a'.repeat(300000) },
      { sourceSceneKey: 's2', text: 'Body.' }])).toThrow();
  });

  it.each(['', ' ', 'bad\0text', 'bad\ud800text', 'bad\udc00text'])('rejects invalid narrative without reflecting it', text => {
    try {
      packAuthoredSceneBeats([{ sourceSceneKey: 's1', text }]);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(String(error)).toContain('Authored scene packing failed bounded validation');
      expect(String(error)).not.toContain('bad');
    }
  });

  it('rejects an empty scene list, duplicate identity, and unsafe source keys', () => {
    expect(() => packAuthoredSceneBeats([])).toThrow();
    expect(() => packAuthoredSceneBeats([{ sourceSceneKey: 's1', text: 'One.' },
      { sourceSceneKey: 's1', text: 'Two.' }])).toThrow();
    expect(() => packAuthoredSceneBeats([{ sourceSceneKey: '../private', text: 'One.' }])).toThrow();
  });
});

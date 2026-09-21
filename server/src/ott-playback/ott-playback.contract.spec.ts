import { createPlaybackManifest, graphReadiness, PlaybackGraph, PlaybackNode, playbackCommand, playbackGraph, playbackHash } from './ott-playback.contract';
import { LOCALES } from '../ott-media/ott-media.contract';

const fileId = '10000000-0000-4000-8000-000000000001';
const versionId = '10000000-0000-4000-8000-000000000002';
const labels = Object.fromEntries(LOCALES.map((locale) => [locale, `Synthetic ${locale}`]));
const clip = { fileId, mediaVersionId: versionId, startMs: 0, endMs: 1000 };
const ending = (key: string): PlaybackNode => ({ key, clip, choices: [], ending: { key, label: labels }, rejoin: false });
function graph(): PlaybackGraph { return { entryNodeKey: 'start', nodes: [
  { key: 'start', clip, choices: [
    { key: 'left', label: labels, targetNodeKey: 'left' },
    { key: 'right', label: labels, targetNodeKey: 'right' },
  ], ending: null, rejoin: false }, ending('left'), ending('right'),
] }; }

describe('private authored OTT graph contract (synthetic references only)', () => {
  it('preserves distinct destinations and all five localized labels', () => {
    const parsed = createPlaybackManifest({ graph: graph() });
    expect(parsed.graph.nodes[0].choices.map((choice) => choice.targetNodeKey)).toEqual(['left', 'right']);
    expect(parsed.graph.nodes[0].choices[0].label).toEqual(labels);
    expect(graphReadiness(parsed.graph, [{ fileId, mediaVersionId: versionId, durationMs: 2000, subtitleLocales: LOCALES }]))
      .toMatchObject({ fiveLocaleReady: true, issues: [] });
  });
  it('requires explicit rejoin at a multiply referenced destination, never inserts it', () => {
    const value = graph(); value.nodes[0].choices[1].targetNodeKey = 'left'; value.nodes.pop();
    expect(() => playbackGraph(value)).toThrow();
    value.nodes[1].rejoin = true;
    expect(playbackGraph(value).nodes[0].choices).toHaveLength(2);
  });
  it.each(['zero', 'four', 'unknown', 'cycle', 'disconnected', 'ending-with-choice', 'bad-clip'])('rejects %s graph structure', (kind) => {
    const value = graph();
    if (kind === 'zero') value.nodes[0].choices = [];
    if (kind === 'four') value.nodes[0].choices = ['a', 'b', 'c', 'd'].map((key) => ({ key, label: labels, targetNodeKey: 'left' }));
    if (kind === 'unknown') value.nodes[0].choices[0].targetNodeKey = 'missing';
    if (kind === 'cycle') value.nodes[0].choices[0].targetNodeKey = 'start';
    if (kind === 'disconnected') value.nodes.push(ending('unreachable'));
    if (kind === 'ending-with-choice') value.nodes[0].ending = { key: 'wrong', label: labels };
    if (kind === 'bad-clip') value.nodes[0].clip = { ...clip, endMs: 0 };
    expect(() => playbackGraph(value)).toThrow();
  });
  it('keeps missing/unmade assets and translations explicitly unready', () => {
    const value = graph(); value.nodes[1].clip = null;
    value.nodes[0].choices[0].label = { ko: 'Synthetic' };
    const checked = graphReadiness(playbackGraph(value), [{ fileId, mediaVersionId: versionId, durationMs: 500, subtitleLocales: ['ko'] }]);
    expect(checked.previewReadyByLocale.ko).toBe(false);
    expect(checked.issues).toEqual(expect.arrayContaining([
      { code: 'clip_missing', nodeKey: 'left' }, { code: 'subtitle_missing', nodeKey: 'start', locale: 'en' },
      { code: 'choice_translation_missing', nodeKey: 'start', choiceKey: 'left', locale: 'ja' },
      { code: 'clip_out_of_bounds', nodeKey: 'start' },
    ]));
  });
  it('rejects caller targets, freeform fields and fractional playback positions', () => {
    const command = { manifestId: versionId, expectedRevision: 1, nodeKey: 'start', choiceKey: 'left' };
    expect(() => playbackCommand({ ...command, targetNodeKey: 'right' }, 'choice')).toThrow();
    expect(() => playbackCommand({ ...command, input: 'free form' }, 'choice')).toThrow();
    expect(() => playbackCommand({ manifestId: versionId, expectedRevision: 1, nodeKey: 'start', positionMs: 0.5 }, 'position')).toThrow();
  });
  it('normalizes property order before checksumming immutable manifests', () => {
    const value = graph();
    const a = createPlaybackManifest({ graph: value });
    const b = createPlaybackManifest({ graph: { nodes: value.nodes, entryNodeKey: value.entryNodeKey } });
    expect(playbackHash(a)).toBe(playbackHash(b));
  });
  it('permits ready owner preview without inventing missing subtitles or claiming five-locale readiness', () => {
    const checked = graphReadiness(playbackGraph(graph()), [{ fileId, mediaVersionId: versionId, durationMs: 2000, subtitleLocales: [] }]);
    expect(checked.previewReadyByLocale.ko).toBe(true);
    expect(checked.fiveLocaleReady).toBe(false);
    expect(checked.issues.filter((issue) => issue.code === 'subtitle_missing')).toHaveLength(15);
  });
  it('bounds graph size and rejects duplicate keys, unsafe text and extra object fields', () => {
    const oversized = graph(); oversized.nodes = Array.from({ length: 129 }, (_, i) => ending(`end-${i}`));
    expect(() => playbackGraph(oversized)).toThrow();
    const duplicate = graph(); duplicate.nodes[2].key = 'left';
    expect(() => playbackGraph(duplicate)).toThrow();
    const unsafe = graph(); unsafe.nodes[0].choices[0].label.ko = '<script>';
    expect(() => playbackGraph(unsafe)).toThrow();
    expect(() => createPlaybackManifest({ graph: graph(), ownerId: versionId })).toThrow();
  });
});

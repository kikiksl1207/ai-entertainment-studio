import { createHash } from 'crypto';
import { fail, LOCALES, Locale, object, uuid } from '../ott-media/ott-media.contract';

export const MAX_PLAYBACK_NODES = 128;
export const MAX_FULL_PLAYBACK_BYTES = 256 * 1024 * 1024;
export type LocalizedLabel = Partial<Record<Locale, string>>;
export type PlaybackChoice = { key: string; label: LocalizedLabel; targetNodeKey: string };
export type PlaybackNode = {
  key: string;
  clip: { fileId: string; mediaVersionId: string; startMs: number; endMs: number } | null;
  choices: PlaybackChoice[];
  ending: { key: string; label: LocalizedLabel } | null;
  rejoin: boolean;
};
export type PlaybackGraph = { entryNodeKey: string; nodes: PlaybackNode[] };
export type CreatePlaybackManifest = { graph: PlaybackGraph };
export type PlaybackIssue = { code: string; nodeKey?: string; choiceKey?: string; locale?: Locale };

function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) fail('INVALID');
  return value;
}
function label(value: unknown): LocalizedLabel {
  const input = object(value, [...LOCALES]);
  const result: LocalizedLabel = {};
  for (const locale of LOCALES) {
    if (input[locale] === undefined) continue;
    const text = input[locale];
    if (typeof text !== 'string' || !text.trim() || text.length > 200 || /[<>\x00-\x1f]/.test(text)) fail('INVALID');
    result[locale] = text.trim();
  }
  return result;
}
export function position(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail('INVALID');
  return Number(value);
}
export function createPlaybackManifest(value: unknown): CreatePlaybackManifest {
  const input = object(value, ['graph']);
  return { graph: playbackGraph(input.graph) };
}
export function playbackGraph(value: unknown): PlaybackGraph {
  const input = object(value, ['entryNodeKey', 'nodes']);
  if (!Array.isArray(input.nodes) || !input.nodes.length || input.nodes.length > MAX_PLAYBACK_NODES) fail('INVALID');
  const nodes: PlaybackNode[] = input.nodes.map((value) => {
    const node = object(value, ['key', 'clip', 'choices', 'ending', 'rejoin']);
    if (!Array.isArray(node.choices) || node.choices.length > 3 || typeof node.rejoin !== 'boolean') fail('INVALID');
    const choices = node.choices.map((value) => {
      const choice = object(value, ['key', 'label', 'targetNodeKey']);
      return { key: key(choice.key), label: label(choice.label), targetNodeKey: key(choice.targetNodeKey) };
    });
    if (new Set(choices.map((choice) => choice.key)).size !== choices.length) fail('INVALID');
    let ending: PlaybackNode['ending'] = null;
    if (node.ending !== null) {
      const value = object(node.ending, ['key', 'label']);
      ending = { key: key(value.key), label: label(value.label) };
    }
    if (Boolean(ending) === Boolean(choices.length)) fail('INVALID');
    let clip: PlaybackNode['clip'] = null;
    if (node.clip !== null) {
      const value = object(node.clip, ['fileId', 'mediaVersionId', 'startMs', 'endMs']);
      clip = { fileId: uuid(value.fileId), mediaVersionId: uuid(value.mediaVersionId), startMs: position(value.startMs), endMs: position(value.endMs) };
      if (clip.endMs <= clip.startMs) fail('INVALID');
    }
    return { key: key(node.key), clip, choices, ending, rejoin: node.rejoin };
  });
  const graph = { entryNodeKey: key(input.entryNodeKey), nodes };
  validateTopology(graph);
  return graph;
}

function validateTopology(graph: PlaybackGraph) {
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]));
  if (nodes.size !== graph.nodes.length || !nodes.has(graph.entryNodeKey)) fail('INVALID');
  const incoming = new Map<string, number>();
  const endings = new Set<string>();
  for (const node of graph.nodes) {
    if (node.ending) {
      if (endings.has(node.ending.key)) fail('INVALID');
      endings.add(node.ending.key);
    }
    for (const choice of node.choices) {
      if (!nodes.has(choice.targetNodeKey)) fail('INVALID');
      incoming.set(choice.targetNodeKey, (incoming.get(choice.targetNodeKey) ?? 0) + 1);
    }
  }
  for (const node of graph.nodes) {
    if ((incoming.get(node.key) ?? 0) > 1 && !node.rejoin) fail('INVALID');
  }
  const active = new Set<string>(); const visited = new Set<string>();
  const visit = (nodeKey: string) => {
    if (active.has(nodeKey)) fail('INVALID');
    if (visited.has(nodeKey)) return;
    active.add(nodeKey);
    const node = nodes.get(nodeKey)!;
    for (const choice of node.choices) visit(choice.targetNodeKey);
    active.delete(nodeKey); visited.add(nodeKey);
  };
  visit(graph.entryNodeKey);
  // Every reachable leaf was required to declare an ending above. No cycles,
  // disconnected drafts or implicit routing can conceal an unmade destination.
  if (visited.size !== nodes.size || !endings.size) fail('INVALID');
}

export function graphReadiness(graph: PlaybackGraph, assets: Array<{
  fileId: string; mediaVersionId: string; durationMs: number; subtitleLocales: readonly Locale[];
}>) {
  const issues: PlaybackIssue[] = [];
  const subtitleIssues: PlaybackIssue[] = [];
  for (const node of graph.nodes) {
    const media = assets.find((asset) => asset.fileId === node.clip?.fileId && asset.mediaVersionId === node.clip?.mediaVersionId);
    if (!node.clip) issues.push({ code: 'clip_missing', nodeKey: node.key });
    else if (!media) issues.push({ code: 'media_not_confirmed', nodeKey: node.key });
    else if (node.clip.endMs > media.durationMs) {
      issues.push({ code: 'clip_out_of_bounds', nodeKey: node.key });
    }
    for (const locale of LOCALES) if (!media?.subtitleLocales.includes(locale)) {
      subtitleIssues.push({ code: 'subtitle_missing', nodeKey: node.key, locale });
    }
    for (const choice of node.choices) {
      for (const locale of LOCALES) if (!choice.label[locale]) issues.push({ code: 'choice_translation_missing', nodeKey: node.key, choiceKey: choice.key, locale });
    }
    if (node.ending) for (const locale of LOCALES) if (!node.ending.label[locale]) {
      issues.push({ code: 'ending_translation_missing', nodeKey: node.key, locale });
    }
  }
  return {
    previewReadyByLocale: Object.fromEntries(LOCALES.map((locale) => [locale,
      !issues.some((issue) => !issue.locale || issue.locale === locale)])) as Record<Locale, boolean>,
    fiveLocaleReady: issues.length === 0 && subtitleIssues.length === 0,
    issues: [...issues, ...subtitleIssues],
    publication: 'not_authorized' as const,
  };
}

export function playbackHash(value: unknown) {
  // Input DTOs project a fixed ordered shape; caller property order is discarded.
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function playbackCommand(value: unknown, kind: 'choice' | 'position') {
  const input = object(value, ['manifestId', 'expectedRevision', 'nodeKey', kind === 'choice' ? 'choiceKey' : 'positionMs']);
  const expectedRevision = position(input.expectedRevision);
  if (expectedRevision < 1) fail('INVALID');
  return { manifestId: uuid(input.manifestId), expectedRevision, nodeKey: key(input.nodeKey),
    ...(kind === 'choice' ? { choiceKey: key(input.choiceKey) } : { positionMs: position(input.positionMs) }) };
}

import { continuationHash } from './story-continuation-context.policy';
import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';

export const STORY_AI_SIBLING_CONTEXT_VERSION = 'story-ai-sibling-context-v1';

export type StoryAiSiblingSource =
  | { kind: 'canonical'; sceneId: string }
  | { kind: 'shared'; resultId: string }
  | { kind: 'private'; sceneId: string };

export function storyAiSiblingContextKey(input: {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
  manuscriptVersionId: string;
  source: StoryAiSiblingSource;
  route: { kind: 'shared'; hash: string } | { kind: 'private'; nodeId: string };
  locale: string;
  promptVersion: string;
  outputSchemaVersion: string;
  approvedContext: StoryContinuationApprovedContext;
  pins: Record<string, unknown>;
}) {
  const context = input.approvedContext;
  return continuationHash({
    version: STORY_AI_SIBLING_CONTEXT_VERSION,
    workId: input.workId,
    releaseId: input.releaseId,
    releaseChecksum: input.releaseChecksum,
    manuscriptVersionId: input.manuscriptVersionId,
    source: input.source,
    route: input.route,
    locale: input.locale,
    promptVersion: input.promptVersion,
    outputSchemaVersion: input.outputSchemaVersion,
    pins: input.pins,
    context: {
      sourceScene: context.sourceScene,
      path: context.path,
      memories: context.memories,
      narrativeLength: context.narrativeLength ?? null,
      generationProfile: context.generationProfile ?? null,
      participantArtist: context.participantArtist ?? null,
    },
  });
}

export function storyAiSiblingChoiceKey(source: StoryAiSiblingSource, choice: { id: string; choiceKey: string }) {
  return continuationHash(source.kind === 'canonical'
    ? { source, choiceId: choice.id }
    : { source, choiceKey: choice.choiceKey.trim() });
}

export function storyAiNarrativeChecksum(input: {
  title: unknown;
  beats: Array<{ beatType: string; content: unknown }>;
}) {
  return continuationHash({
    version: 'story-ai-narrative-v3',
    beats: input.beats.map(({ content }) => normalizedNarrativeValue(content)),
  });
}

function normalizedNarrativeValue(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (Array.isArray(value)) return value.map(normalizedNarrativeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizedNarrativeValue(item)]));
  }
  return value;
}

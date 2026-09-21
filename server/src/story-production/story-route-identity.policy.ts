import { continuationHash } from './story-continuation-context.policy';

export const STORY_ROUTE_IDENTITY_VERSION = 'story-route-v1';
export type StoryRouteStep =
  | { kind: 'canonical'; sceneId: string; choiceId: string; targetSceneId: string | null; endingKey: string | null }
  | { kind: 'shared'; sharedResultId: string; choiceKey: string; endingKey: string | null }
  | { kind: 'private' };

export function storyRouteRootHash(input: {
  workId: string; releaseId: string; releaseChecksum: string; manuscriptVersionId: string; entrySceneId: string;
}) {
  return continuationHash({ version: STORY_ROUTE_IDENTITY_VERSION, root: {
    workId: input.workId, releaseId: input.releaseId, releaseChecksum: input.releaseChecksum,
    manuscriptVersionId: input.manuscriptVersionId, entrySceneId: input.entrySceneId,
  } });
}

export function appendStoryRouteHash(previous: string | null | undefined, step: StoryRouteStep): string | null {
  if (!previous || !/^[a-f0-9]{64}$/.test(previous) || step.kind === 'private') return null;
  // Explicit projection keeps reader IDs, labels, timestamps and private input out.
  const identity = step.kind === 'canonical'
    ? { kind: step.kind, sceneId: step.sceneId, choiceId: step.choiceId,
        targetSceneId: step.targetSceneId, endingKey: step.endingKey }
    : { kind: step.kind, sharedResultId: step.sharedResultId, choiceKey: step.choiceKey, endingKey: step.endingKey };
  return continuationHash({ version: STORY_ROUTE_IDENTITY_VERSION, previous, step: identity });
}

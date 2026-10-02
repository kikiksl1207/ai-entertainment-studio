import { releaseChecksum } from './story-lifecycle.policy';

export type StoryCanonicalSource = {
  workId: string; ownerUserId: string; releaseId: string; releaseChecksum: string;
  manuscriptVersionId: string; manuscriptHash: string; partId: string; partPosition: number;
  sceneId: string; sceneKey: string; scenePosition: number; beatId: string; beatPosition: number;
  beatType: string; sourceSceneKey: string | null; locale: string; sourceText: string;
};

export function validCanonicalStoryText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64000 && Array.from(value.trim()).length >= 2 &&
    !value.includes('\0') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}

export function canonicalStorySourceChecksum(source: StoryCanonicalSource) {
  return releaseChecksum({ contract: 'story-canonical-interaction-source-v1', ...source });
}

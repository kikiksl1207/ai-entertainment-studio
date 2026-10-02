import { createHash } from 'crypto';
import { releaseChecksum } from './story-lifecycle.policy';

export function canonicalReadTextHash(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export type StoryCanonicalReadIdentity = {
  userId: string; progressId: string; workId: string; ownerUserId: string; releaseId: string;
  releaseChecksum: string; manuscriptVersionId: string; manuscriptHash: string; partId: string;
  sceneId: string; beatId: string; beatPosition: number; actNumber: number; locale: string;
  sourceChecksum: string; sourceTextHash: string; routeNodeId: string; routeHash: string;
  storyVersion: number; progressRevision: number;
};

export function canonicalReadScopeChecksum(identity: StoryCanonicalReadIdentity) {
  return releaseChecksum({ contract: 'story-canonical-read-scope-v1', ...identity, displayedAndRead: true });
}

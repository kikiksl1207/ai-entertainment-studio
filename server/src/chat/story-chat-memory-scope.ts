import { releaseChecksum } from '../story-production/story-lifecycle.policy';
import type { StoryChatMemoryContext } from './story-chat-memory';

export type StoryChatMemoryMarker = {
  version: 1;
  source: StoryChatMemoryContext['source'];
  checksum: string;
};

export function storyChatMemoryMarker(context: StoryChatMemoryContext): StoryChatMemoryMarker {
  return {
    version: 1,
    source: context.source,
    checksum: releaseChecksum({
      contract: 'story-chat-memory-scope-v1',
      source: context.source,
      items: context.items,
      canonicalProofFingerprint: context.canonicalProofFingerprint ?? null,
    }),
  };
}

export function storyChatMemoryMarkerMatches(value: unknown, current: StoryChatMemoryMarker): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 3 || keys.some(key =>
    key !== 'version' && key !== 'source' && key !== 'checksum')) return false;
  const marker = value as Record<string, unknown>;
  return marker.version === 1 &&
    (marker.source === 'no_verified_interaction' || marker.source === 'attributed_story_dialogue') &&
    typeof marker.checksum === 'string' && marker.checksum.length === 64 &&
    /^[0-9a-f]{64}$/.test(marker.checksum) &&
    marker.version === current.version && marker.source === current.source &&
    marker.checksum === current.checksum;
}

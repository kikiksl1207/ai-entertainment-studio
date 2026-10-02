import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';

export const STORY_VISUAL_QUEUE_LEGACY_SLUGS: readonly string[] = Object.freeze([
  'records-of-the-burning-sea-imjin-war',
  'norse-myth-loki-crossroads',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CONFIG_BYTES = 16 * 1024;
const MAX_RELEASES = 10;

type StoryVisualQueueRelease = {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
};

function invalid(): never {
  throw new ServiceUnavailableException('Story visual queue configuration is invalid');
}

export class StoryVisualQueueScope {
  constructor(private readonly config: ConfigService) {}

  workFilter(): Prisma.StoryWorkWhereInput {
    const entries = this.entries();
    const legacy = { slug: { in: [...STORY_VISUAL_QUEUE_LEGACY_SLUGS] } };
    return entries.length ? {
      OR: [legacy, ...entries.map(entry => ({ id: entry.workId, activeReleaseId: entry.releaseId }))],
    } : legacy;
  }

  allows(work: { id: string; slug: string }, release: { id: string; checksum: string }): boolean {
    const entries = this.entries();
    if (STORY_VISUAL_QUEUE_LEGACY_SLUGS.includes(work.slug)) return true;
    return entries.some(entry => entry.workId === work.id.toLowerCase() &&
      entry.releaseId === release.id.toLowerCase() && entry.releaseChecksum === release.checksum);
  }

  private entries(): StoryVisualQueueRelease[] {
    const configured = this.config.get<unknown>('STORY_IMAGE_QUEUE_RELEASES');
    const value = configured === undefined || configured === '' ? '[]' : configured;
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_CONFIG_BYTES) invalid();
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      invalid();
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_RELEASES) invalid();
    const identities = new Set<string>();
    return parsed.map((candidate): StoryVisualQueueRelease => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) invalid();
      const item = candidate as Record<string, unknown>;
      if (Object.keys(item).length !== 3 ||
          typeof item.workId !== 'string' || item.workId.length !== 36 || !UUID.test(item.workId) ||
          typeof item.releaseId !== 'string' || item.releaseId.length !== 36 || !UUID.test(item.releaseId) ||
          typeof item.releaseChecksum !== 'string' || item.releaseChecksum.length !== 64 || !SHA256.test(item.releaseChecksum)) {
        invalid();
      }
      const workId = item.workId.toLowerCase();
      const releaseId = item.releaseId.toLowerCase();
      const identity = `${workId}:${releaseId}`;
      if (identities.has(identity)) invalid();
      identities.add(identity);
      return { workId, releaseId, releaseChecksum: item.releaseChecksum };
    });
  }
}

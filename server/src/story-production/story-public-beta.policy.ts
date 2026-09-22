import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;

type StoryPublicBetaRelease = {
  workId: string;
  releaseId: string;
  releaseChecksum: string;
  freeAccess: boolean;
};

@Injectable()
export class StoryPublicBetaPolicy {
  private parsedValue?: string;
  private parsedEntries: StoryPublicBetaRelease[] = [];

  constructor(private readonly config: ConfigService) {}

  enabled() {
    return this.config.get<string>('STORY_PUBLIC_BETA_ENABLED') === 'true';
  }

  allows(workId: string, releaseId: string, releaseChecksum: string) {
    if (!this.enabled()) return true;
    return Boolean(this.entry(workId, releaseId, releaseChecksum));
  }

  freeAccess(workId: string, releaseId: string, releaseChecksum: string) {
    if (!this.enabled()) return false;
    return this.entry(workId, releaseId, releaseChecksum)?.freeAccess === true;
  }

  assertAllowed(workId: string, releaseId: string, releaseChecksum: string) {
    if (!this.allows(workId, releaseId, releaseChecksum)) {
      throw new NotFoundException('Published story not found');
    }
  }

  private entry(workId: string, releaseId: string, releaseChecksum: string) {
    return this.entries().find(entry => entry.workId === workId && entry.releaseId === releaseId &&
      entry.releaseChecksum === releaseChecksum);
  }

  private entries() {
    const value = this.config.get<string>('STORY_PUBLIC_BETA_RELEASES') || '[]';
    if (value === this.parsedValue) return this.parsedEntries;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ServiceUnavailableException('Story public beta configuration is invalid');
    }
    if (!Array.isArray(parsed) || parsed.length > 10) {
      throw new ServiceUnavailableException('Story public beta configuration is invalid');
    }
    const entries = parsed.map((candidate): StoryPublicBetaRelease => {
      const item = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? candidate as Record<string, unknown> : {};
      if (typeof item.workId !== 'string' || !UUID.test(item.workId) ||
          typeof item.releaseId !== 'string' || !UUID.test(item.releaseId) ||
          typeof item.releaseChecksum !== 'string' || !SHA256.test(item.releaseChecksum) ||
          typeof item.freeAccess !== 'boolean') {
        throw new ServiceUnavailableException('Story public beta configuration is invalid');
      }
      return { workId: item.workId, releaseId: item.releaseId,
        releaseChecksum: item.releaseChecksum, freeAccess: item.freeAccess };
    });
    const keys = entries.map(entry => `${entry.workId}:${entry.releaseId}`);
    if (new Set(keys).size !== keys.length) {
      throw new ServiceUnavailableException('Story public beta configuration is invalid');
    }
    this.parsedValue = value;
    this.parsedEntries = entries;
    return entries;
  }
}

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { StoryPublicBetaPolicy } from './story-public-beta.policy';

describe('StoryPublicBetaPolicy', () => {
  const workId = '00000000-0000-4000-8000-000000000001';
  const releaseId = '00000000-0000-4000-8000-000000000002';
  const releaseChecksum = 'a'.repeat(64);

  function policy(values: Record<string, string>) {
    return new StoryPublicBetaPolicy({ get: (key: string) => values[key] } as never);
  }

  it('does not restrict normal production when beta mode is disabled', () => {
    expect(policy({ STORY_PUBLIC_BETA_ENABLED: 'false' }).allows(workId, releaseId, releaseChecksum)).toBe(true);
  });

  it('allows only the exact configured release and keeps free access separate from pricing', () => {
    const subject = policy({
      STORY_PUBLIC_BETA_ENABLED: 'true',
      STORY_PUBLIC_BETA_RELEASES: JSON.stringify([{ workId, releaseId, releaseChecksum, freeAccess: true }]),
    });
    expect(subject.allows(workId, releaseId, releaseChecksum)).toBe(true);
    expect(subject.freeAccess(workId, releaseId, releaseChecksum)).toBe(true);
    expect(() => subject.assertAllowed(workId, releaseId, 'b'.repeat(64))).toThrow(NotFoundException);
  });

  it('fails closed when the allowlist is malformed', () => {
    const subject = policy({ STORY_PUBLIC_BETA_ENABLED: 'true', STORY_PUBLIC_BETA_RELEASES: '{bad' });
    expect(() => subject.allows(workId, releaseId, releaseChecksum)).toThrow(ServiceUnavailableException);
  });
});

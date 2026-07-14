import {
  containsBlockedTerm,
  normalizePrivateCustomChoice,
  safeResetAuditMetadata,
  STORY_PROGRESS_MESSAGE_KEYS,
  STORY_PROGRESS_LOCALE_SLOTS,
  storyProgressStatusKey,
  storyResetRemaining,
  storyResetScopeKey,
  validatePrivateCustomChoice,
} from './story-progress-control.policy';

describe('story progress control policy', () => {
  it('enforces one full reset and three resets for each act', () => {
    expect(storyResetRemaining('full', 0)).toBe(1);
    expect(storyResetRemaining('full', 1)).toBe(0);
    expect(storyResetRemaining('act', 2)).toBe(1);
    expect(storyResetRemaining('act', 3)).toBe(0);
    expect(storyResetScopeKey('act', 2)).toBe('act:2');
  });

  it('normalizes private choices and rejects empty, long, or repeated input', () => {
    expect(normalizePrivateCustomChoice('  Go\n north  ')).toBe('Go north');
    expect(validatePrivateCustomChoice('   ')).toEqual({ accepted: false, reason: 'empty' });
    expect(validatePrivateCustomChoice('x'.repeat(501))).toEqual({
      accepted: false,
      reason: 'too_long',
    });
    expect(validatePrivateCustomChoice('a'.repeat(12))).toEqual({
      accepted: false,
      reason: 'repeated_input',
    });
    expect(validatePrivateCustomChoice('Take the east gate')).toEqual(
      expect.objectContaining({ accepted: true, normalized: 'Take the east gate' }),
    );
  });

  it('matches normalized blocked terms without returning the private input', () => {
    expect(containsBlockedTerm('Meet at the Secret Gate', ['secret gate'])).toBe(true);
    expect(containsBlockedTerm('Take the north road', ['secret gate'])).toBe(false);
  });

  it('returns message keys for all stable public states and five locale slots', () => {
    expect(STORY_PROGRESS_LOCALE_SLOTS).toEqual(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']);
    expect(
      storyProgressStatusKey({
        hasProgress: true,
        completed: false,
        versionMatches: false,
        quotaExhausted: false,
      }),
    ).toBe(STORY_PROGRESS_MESSAGE_KEYS.versionMismatch);
    expect(
      storyProgressStatusKey({
        hasProgress: true,
        completed: true,
        versionMatches: true,
        quotaExhausted: false,
      }),
    ).toBe(STORY_PROGRESS_MESSAGE_KEYS.completed);
  });

  it('keeps reset audit metadata free of manuscript and private choice content', () => {
    expect(
      safeResetAuditMetadata({
        target: 'act',
        actNumber: 2,
        beforeRevision: 4,
        afterRevision: 5,
        invalidatedEventCount: 3,
      }),
    ).toEqual({
      target: 'act',
      actNumber: 2,
      beforeRevision: 4,
      afterRevision: 5,
      invalidatedEventCount: 3,
    });
  });
});

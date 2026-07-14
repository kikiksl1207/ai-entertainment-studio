import { createHash } from 'crypto';

export const STORY_RESET_LIMITS = {
  full: 1,
  act: 3,
} as const;

export const STORY_PROGRESS_LOCALE_SLOTS = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
] as const;

export const STORY_PROGRESS_MESSAGE_KEYS = {
  ready: 'story.progress.status.ready',
  noProgress: 'story.progress.status.noProgress',
  completed: 'story.progress.status.completed',
  versionMismatch: 'story.progress.status.versionMismatch',
  quotaExhausted: 'story.progress.status.quotaExhausted',
  checkpoint: 'story.progress.checkpoint.label',
  fullReset: 'story.progress.reset.fullSummary',
  actReset: 'story.progress.reset.actSummary',
  customChoiceDenied: 'story.progress.customChoice.entitlementRequired',
  customChoiceRejected: 'story.progress.customChoice.rejected',
  staleRevision: 'story.progress.error.staleRevision',
} as const;

export type StoryResetTarget = 'full' | 'act';

export function storyResetScopeKey(target: StoryResetTarget, actNumber?: number) {
  if (target === 'full') return 'full';
  if (!Number.isInteger(actNumber) || Number(actNumber) < 1) {
    throw new Error('actNumber is required for act reset');
  }
  return `act:${actNumber}`;
}

export function storyResetRemaining(
  target: StoryResetTarget,
  usedCount: number,
  limitOverride?: number,
) {
  const limit = limitOverride ?? STORY_RESET_LIMITS[target];
  return Math.max(0, limit - Math.max(0, usedCount));
}

export function normalizePrivateCustomChoice(input: string) {
  return input.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

export function validatePrivateCustomChoice(input: string, maxLength = 500) {
  const normalized = normalizePrivateCustomChoice(input);
  if (!normalized) return { accepted: false as const, reason: 'empty' as const };
  if (normalized.length > maxLength) {
    return { accepted: false as const, reason: 'too_long' as const };
  }
  if (/^(.)\1{11,}$/u.test(normalized)) {
    return { accepted: false as const, reason: 'repeated_input' as const };
  }
  return {
    accepted: true as const,
    normalized,
    contentHash: createHash('sha256').update(normalized).digest('hex'),
  };
}

export function containsBlockedTerm(input: string, terms: string[]) {
  const normalized = normalizePrivateCustomChoice(input).toLocaleLowerCase();
  return terms.some((term) => {
    const candidate = normalizePrivateCustomChoice(term).toLocaleLowerCase();
    return candidate.length > 0 && normalized.includes(candidate);
  });
}

export function storyProgressStatusKey(input: {
  hasProgress: boolean;
  completed: boolean;
  versionMatches: boolean;
  quotaExhausted: boolean;
}) {
  if (!input.hasProgress) return STORY_PROGRESS_MESSAGE_KEYS.noProgress;
  if (!input.versionMatches) return STORY_PROGRESS_MESSAGE_KEYS.versionMismatch;
  if (input.quotaExhausted) return STORY_PROGRESS_MESSAGE_KEYS.quotaExhausted;
  if (input.completed) return STORY_PROGRESS_MESSAGE_KEYS.completed;
  return STORY_PROGRESS_MESSAGE_KEYS.ready;
}

export function safeResetAuditMetadata(input: {
  target: StoryResetTarget;
  actNumber?: number;
  beforeRevision: number;
  afterRevision: number;
  invalidatedEventCount: number;
}) {
  return {
    target: input.target,
    actNumber: input.actNumber ?? null,
    beforeRevision: input.beforeRevision,
    afterRevision: input.afterRevision,
    invalidatedEventCount: input.invalidatedEventCount,
  };
}

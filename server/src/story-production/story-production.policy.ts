import { createHash } from 'crypto';

export const STORY_LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
export type StoryLocale = (typeof STORY_LOCALES)[number];

export type LocalizedValue = Partial<Record<StoryLocale, string>>;

const FIXTURE_ID_MARKERS = /(^|[-_/])(fixture|mock|sample|demo|preview)([-_/]|$)/i;
const FIXTURE_URL_MARKERS = /\/(fixtures?|mocks?|samples?|demos?|previews?)\//i;

export function projectLocalizedValue(
  value: unknown,
  requestedLocale: string,
  defaultLocale: string,
): { value: string; locale: StoryLocale; fallback: boolean } {
  const record = isRecord(value) ? value : {};
  const requested = normalizeLocale(requestedLocale);
  const fallbackOrder = [requested, normalizeLocale(defaultLocale), ...STORY_LOCALES];
  const locale = [...new Set(fallbackOrder)].find(
    (candidate) => typeof record[candidate] === 'string' && record[candidate].trim(),
  );

  if (!locale) {
    return { value: '', locale: normalizeLocale(defaultLocale), fallback: true };
  }

  return {
    value: String(record[locale]),
    locale,
    fallback: locale !== requested,
  };
}

export function isPublicStorySourceSafe(input: {
  fixtureSource?: boolean;
  slug?: string;
  manifest?: unknown;
}): boolean {
  if (input.fixtureSource || (input.slug && FIXTURE_ID_MARKERS.test(input.slug))) {
    return false;
  }

  return !collectStrings(input.manifest).some(
    (value) => FIXTURE_URL_MARKERS.test(value) || FIXTURE_ID_MARKERS.test(value),
  );
}

export function assertPublicProjectionHasNoFixtureMarkers(payload: unknown): string[] {
  return collectStrings(payload).filter(
    (value) => FIXTURE_URL_MARKERS.test(value) || FIXTURE_ID_MARKERS.test(value),
  );
}

export function boundedPath<T>(path: T[], limit = 24): T[] {
  return path.slice(-Math.max(1, Math.min(limit, 50)));
}

export function manuscriptContentHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export type ManuscriptParagraph = {
  kind: 'title' | 'scene_break' | 'paragraph' | 'dialogue';
  text: string;
};

export type ManuscriptPart = {
  partKey: string;
  title: string;
  paragraphs: ManuscriptParagraph[];
};

export type AnalysisEvidenceDraft = {
  evidenceType:
    | 'scene'
    | 'beat'
    | 'dialogue'
    | 'background'
    | 'cast'
    | 'time'
    | 'place'
    | 'branch_candidate'
    | 'entity'
    | 'event'
    | 'foreshadow'
    | 'payoff';
  sourcePartKey: string;
  sourceParagraphIndex: number;
  payload: Record<string, string | number | boolean>;
};

export function analyzeStructuredManuscript(parts: ManuscriptPart[]) {
  const evidence: AnalysisEvidenceDraft[] = [];
  const tagPattern =
    /\[(background|cast|time|place|branch|entity|event|foreshadow|payoff):([^\]]{1,80})\]/gi;

  for (const part of parts) {
    part.paragraphs.forEach((paragraph, paragraphIndex) => {
      if (paragraph.kind === 'scene_break' || paragraph.kind === 'title') {
        evidence.push({
          evidenceType: 'scene',
          sourcePartKey: part.partKey,
          sourceParagraphIndex: paragraphIndex,
          payload: { label: paragraph.text },
        });
      } else {
        evidence.push({
          evidenceType: paragraph.kind === 'dialogue' ? 'dialogue' : 'beat',
          sourcePartKey: part.partKey,
          sourceParagraphIndex: paragraphIndex,
          payload: { kind: paragraph.kind, excerpt: paragraph.text.slice(0, 160) },
        });
      }

      for (const match of paragraph.text.matchAll(tagPattern)) {
        const tagType = match[1].toLowerCase();
        evidence.push({
          evidenceType: (tagType === 'branch' ? 'branch_candidate' : tagType) as AnalysisEvidenceDraft['evidenceType'],
          sourcePartKey: part.partKey,
          sourceParagraphIndex: paragraphIndex,
          payload: { label: match[2].trim() },
        });
      }
    });
  }

  const counts = evidence.reduce<Record<string, number>>((result, item) => {
    result[item.evidenceType] = (result[item.evidenceType] ?? 0) + 1;
    return result;
  }, {});

  return { evidence, counts, partCount: parts.length };
}

export function deriveContinuityLedger(evidence: Array<AnalysisEvidenceDraft & { id: string }>) {
  const tagged = evidence.filter((item) =>
    ['entity', 'event', 'foreshadow', 'payoff'].includes(item.evidenceType),
  );
  const grouped = new Map<string, typeof tagged>();

  for (const item of tagged) {
    const label = String(item.payload.label ?? '').trim();
    const key = `${item.evidenceType}:${slugKey(label)}`;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  const entries = [...grouped.entries()].map(([key, items]) => ({
    entryType: items[0].evidenceType,
    ledgerKey: key,
    label: String(items[0].payload.label),
    evidenceIds: items.map((item) => item.id),
    state: items[0].evidenceType === 'payoff' ? 'resolved' : 'observed',
  }));

  const payoffKeys = new Set(
    entries
      .filter((entry) => entry.entryType === 'payoff')
      .map((entry) => slugKey(entry.label)),
  );
  const issues = entries
    .filter(
      (entry) => entry.entryType === 'foreshadow' && !payoffKeys.has(slugKey(entry.label)),
    )
    .map((entry) => ({
      issueKey: `missing-payoff:${slugKey(entry.label)}`,
      severity: 'critical',
      summary: `Foreshadowing has no matching payoff: ${entry.label}`,
      evidenceIds: entry.evidenceIds,
    }));

  return { entries, issues };
}

export function hasActiveEntitlement(
  entitlements: Array<{ startsAt: Date; expiresAt: Date | null; revokedAt: Date | null }>,
  now = new Date(),
): boolean {
  return entitlements.some(
    (item) =>
      item.startsAt <= now &&
      item.revokedAt === null &&
      (item.expiresAt === null || item.expiresAt > now),
  );
}

export function projectStoryAccess(input: {
  authenticated: boolean;
  entitled: boolean;
  isFree: boolean;
  priceLumina: string;
  hasProgress?: boolean;
  endingCount?: number;
}) {
  const accessible = input.entitled || input.isFree;
  const hasProgress = Boolean(input.hasProgress);
  const endingCount = Math.max(0, input.endingCount ?? 0);
  const status = input.entitled
    ? 'entitled'
    : input.isFree
      ? 'free'
      : input.authenticated
        ? 'purchase_required'
        : 'sign_in_required';
  const primaryAction = !input.authenticated
    ? 'sign_in'
    : !accessible
      ? 'purchase'
      : hasProgress
        ? 'continue'
        : 'start';

  return {
    status,
    accessible,
    entitled: input.entitled,
    pricing: {
      amountLumina: input.priceLumina,
      currencyCode: 'LUMINA',
      free: input.isFree,
    },
    actions: {
      primary: primaryAction,
      authenticationRequired: !input.authenticated,
      canPurchase: input.authenticated && !accessible,
      canStart: input.authenticated && accessible,
      canContinue: input.authenticated && accessible && hasProgress,
      canRestart: input.authenticated && accessible,
      canReset: input.authenticated && accessible && hasProgress,
      canViewEndings: input.authenticated && endingCount > 0,
    },
    endingCount,
  };
}

export function creatorStorySelectionPermissions() {
  return {
    createManuscript: true,
    requestAnalysis: true,
    reviewContinuity: true,
    openFinalReview: true,
    publish: false,
    finalSubmissionRequiresReviewState: true,
  };
}

function normalizeLocale(value: string): StoryLocale {
  return STORY_LOCALES.includes(value as StoryLocale) ? (value as StoryLocale) : 'ko';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function slugKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/(^-|-$)/g, '');
}

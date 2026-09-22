import { LOCALES, Locale } from '../../ott-media/ott-media.contract';

export type OttPublicReleaseCandidate = {
  slug: string;
  workId: string;
  manifestId: string;
  rightsContractVersionId: string;
  status: 'published';
  source: 'authored_uploaded_clips';
  fixtureSource: false;
  rightsAuthorization: 'cleared_for_public_streaming';
  authorizedAt: Date;
  publishedAt: Date;
  title: Record<Locale, string>;
  synopsis: Record<Locale, string>;
  creatorName: Record<Locale, string>;
};

export type OttPublicCatalogItem = {
  slug: string;
  title: Record<Locale, string>;
  synopsis: Record<Locale, string>;
  creatorName: Record<Locale, string>;
  publishedAt: Date;
  detailPath: string;
  viewing: { available: false };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function parseOttPublicReleaseRegistry(value: string | undefined): OttPublicReleaseCandidate[] {
  if (!value?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length > 100) return [];
    const releases = parsed.map(parseRelease);
    if (new Set(releases.map((release) => release.slug)).size !== releases.length) return [];
    return releases;
  } catch {
    return [];
  }
}

export function toOttPublicCatalogItem(release: OttPublicReleaseCandidate): OttPublicCatalogItem {
  return {
    slug: release.slug,
    title: release.title,
    synopsis: release.synopsis,
    creatorName: release.creatorName,
    publishedAt: release.publishedAt,
    detailPath: `/ott?title=${encodeURIComponent(release.slug)}`,
    viewing: { available: false },
  };
}

function parseRelease(value: unknown): OttPublicReleaseCandidate {
  const item = record(value);
  const allowed = [
    'slug', 'workId', 'manifestId', 'rightsContractVersionId', 'status', 'source',
    'fixtureSource', 'rightsAuthorization', 'authorizedAt', 'publishedAt',
    'title', 'synopsis', 'creatorName',
  ];
  if (Object.keys(item).some((key) => !allowed.includes(key))) throw new Error('invalid release');
  if (typeof item.slug !== 'string' || !SLUG.test(item.slug) || item.slug.length > 100) throw new Error('invalid slug');
  if (item.status !== 'published' || item.source !== 'authored_uploaded_clips' || item.fixtureSource !== false ||
      item.rightsAuthorization !== 'cleared_for_public_streaming') throw new Error('release is not public');
  return {
    slug: item.slug,
    workId: uuid(item.workId),
    manifestId: uuid(item.manifestId),
    rightsContractVersionId: uuid(item.rightsContractVersionId),
    status: item.status,
    source: item.source,
    fixtureSource: item.fixtureSource,
    rightsAuthorization: item.rightsAuthorization,
    authorizedAt: date(item.authorizedAt),
    publishedAt: date(item.publishedAt),
    title: localized(item.title, 160),
    synopsis: localized(item.synopsis, 1200),
    creatorName: localized(item.creatorName, 120),
  };
}

function localized(value: unknown, maximum: number): Record<Locale, string> {
  const input = record(value);
  if (Object.keys(input).some((key) => !LOCALES.includes(key as Locale))) throw new Error('invalid locale');
  return Object.fromEntries(LOCALES.map((locale) => {
    const text = input[locale];
    if (typeof text !== 'string' || !text.trim() || text.length > maximum || /[<>\x00-\x1f]/.test(text)) {
      throw new Error('invalid localized text');
    }
    return [locale, text.trim()];
  })) as Record<Locale, string>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid object');
  return value as Record<string, unknown>;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('invalid uuid');
  return value;
}

function date(value: unknown): Date {
  if (typeof value !== 'string') throw new Error('invalid date');
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error('invalid date');
  return parsed;
}

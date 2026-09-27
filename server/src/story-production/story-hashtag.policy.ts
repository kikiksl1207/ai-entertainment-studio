import {
  LocalizedValue,
  projectLocalizedValue,
  StoryLocale,
} from './story-production.policy';

export type StoryHashtagDefinition = {
  key: string;
  labels: Record<StoryLocale, string>;
};

export const STORY_HASHTAGS = {
  romance: hashtag('romance', '로맨스', 'Romance', 'ロマンス', '浪漫', '浪漫'),
  mystery: hashtag('mystery', '미스터리', 'Mystery', 'ミステリー', '悬疑', '懸疑'),
  fantasy: hashtag('fantasy', '판타지', 'Fantasy', 'ファンタジー', '奇幻', '奇幻'),
  'modern-korea': hashtag('modern-korea', '현대한국', 'Modern Korea', '現代韓国', '现代韩国', '現代韓國'),
  complete: hashtag('complete', '완결', 'Completed', '完結', '完结', '完結'),
  'political-fantasy': hashtag('political-fantasy', '정치판타지', 'Political fantasy', '政治ファンタジー', '政治奇幻', '政治奇幻'),
  'court-intrigue': hashtag('court-intrigue', '궁정암투', 'Court intrigue', '宮廷陰謀', '宫廷权谋', '宮廷權謀'),
  history: hashtag('history', '역사', 'History', '歴史', '历史', '歷史'),
  'imjin-war': hashtag('imjin-war', '임진왜란', 'Imjin War', '文禄・慶長の役', '壬辰倭乱', '壬辰倭亂'),
  'yi-sun-sin': hashtag('yi-sun-sin', '이순신', 'Yi Sun-sin', '李舜臣', '李舜臣', '李舜臣'),
  war: hashtag('war', '전쟁', 'War', '戦争', '战争', '戰爭'),
  mythology: hashtag('mythology', '신화', 'Mythology', '神話', '神话', '神話'),
  'norse-mythology': hashtag('norse-mythology', '북유럽신화', 'Norse mythology', '北欧神話', '北欧神话', '北歐神話'),
  loki: hashtag('loki', '로키', 'Loki', 'ロキ', '洛基', '洛基'),
  'choice-fiction': hashtag('choice-fiction', '선택형스토리', 'Interactive story', '選択型ストーリー', '互动故事', '互動故事'),
  'exclusive-contract': hashtag('exclusive-contract', '독점계약', 'Exclusive', '独占契約', '独家签约', '獨家簽約'),
} as const satisfies Record<string, StoryHashtagDefinition>;

export function labelsForStoryHashtags(keys: readonly string[]): Record<string, LocalizedValue> {
  return Object.fromEntries(keys.flatMap((key) => {
    const definition = STORY_HASHTAGS[key as keyof typeof STORY_HASHTAGS];
    return definition ? [[key, definition.labels]] : [];
  }));
}

export function projectStoryHashtags(
  keys: unknown,
  labels: unknown,
  requestedLocale: string,
  defaultLocale: string,
) {
  const labelMap = isRecord(labels) ? labels : {};
  return normalizeStoryHashtagKeys(keys).flatMap((key) => {
    const label = projectLocalizedValue(labelMap[key], requestedLocale, defaultLocale);
    return label.value ? [{ key, label: label.value, locale: label.locale, fallback: label.fallback }] : [];
  });
}

export function buildStorySearchText(
  title: string,
  summary: string,
  labels: Record<string, LocalizedValue>,
  authorDisplayName = '',
) {
  const labelText = Object.values(labels).flatMap((localized) => Object.values(localized));
  return [title, summary, authorDisplayName, ...labelText]
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeStoryHashtagKey(value: unknown) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLocaleLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(normalized) ? normalized : '';
}

function normalizeStoryHashtagKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeStoryHashtagKey).filter(Boolean))].slice(0, 20);
}

function hashtag(
  key: string,
  ko: string,
  en: string,
  ja: string,
  zhHans: string,
  zhHant: string,
): StoryHashtagDefinition {
  return { key, labels: { ko, en, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

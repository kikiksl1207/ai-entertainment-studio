export const STORY_PAYLOAD_LOCALES = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
] as const;

export type StoryPayloadLocale = (typeof STORY_PAYLOAD_LOCALES)[number];
export type StoryLocalizedContentClass = 'manuscript' | 'system_copy';

const STORY_LOCALE_ALIASES: Record<string, StoryPayloadLocale> = {
  ko: 'ko',
  'ko-kr': 'ko',
  en: 'en',
  'en-us': 'en',
  'en-gb': 'en',
  ja: 'ja',
  'ja-jp': 'ja',
  'zh-hans': 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
};

export function normalizeStoryPayloadLocale(
  locale: string,
): StoryPayloadLocale | null {
  return STORY_LOCALE_ALIASES[locale.trim().replace(/_/g, '-').toLowerCase()] ?? null;
}

function isUsableLocalizedValue(value?: string | null): value is string {
  if (!value?.trim()) return false;
  if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/.test(value)) return false;
  return !Array.from(value).some((character) =>
    [0x00c2, 0x00c3, 0xfffd].includes(character.charCodeAt(0)),
  );
}

export function resolveStoryLocalizedValue(input: {
  contentClass: StoryLocalizedContentClass;
  requestedLocale: string;
  sourceLocale: StoryPayloadLocale;
  payload: Partial<Record<StoryPayloadLocale, string | null | undefined>>;
}) {
  const requested = normalizeStoryPayloadLocale(input.requestedLocale);
  const order = [
    requested,
    input.sourceLocale,
    'ko' as const,
    'en' as const,
    ...STORY_PAYLOAD_LOCALES,
  ].filter((locale): locale is StoryPayloadLocale => locale !== null);
  const fallbackOrder = [...new Set(order)];

  for (const locale of fallbackOrder) {
    const value = input.payload[locale];
    if (!isUsableLocalizedValue(value)) continue;
    return {
      contentClass: input.contentClass,
      requestedLocale: requested,
      resolvedLocale: locale,
      value,
      status: locale === requested ? 'resolved' : 'fallback',
    } as const;
  }

  return {
    contentClass: input.contentClass,
    requestedLocale: requested,
    resolvedLocale: null,
    value: null,
    status: 'unavailable',
  } as const;
}

export const STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT = {
  version: '2026-07-11.story-locale-payload-fallback.v1',
  status: 'read_only_projection_contract',
  endpoint: {
    method: 'GET',
    path: '/api/v1/story-stage/stories/:storyKey/localized-payload',
    enabled: false,
  },
  localeSlots: STORY_PAYLOAD_LOCALES,
  fields: [
    'title',
    'synopsis',
    'sceneCopy',
    'choiceCopy',
    'endingLabel',
  ],
  contentClasses: ['manuscript', 'system_copy'],
  fallbackPolicy: {
    order: ['requested_locale', 'source_locale', 'ko', 'en', 'first_available'],
    zhHansAndZhHantSeparated: true,
    emptyStringReturned: false,
    rawKeyReturned: false,
    malformedEncodingReturned: false,
  },
  mutationPolicy: {
    translationGeneration: false,
    providerCall: false,
    storyWrite: false,
    localeWrite: false,
    paymentMutation: false,
  },
} as const;

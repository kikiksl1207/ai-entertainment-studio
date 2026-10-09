import { FanEngagementService } from './fan-engagement.service';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class { constructor() { throw new Error('Real Prisma client forbidden'); } },
}));

const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const translatedLocales = ['en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const korean = Object.freeze({ title: 'stored Korean title', description: 'stored Korean description' });
const unusable = [undefined, null, false, 0, 'not label metadata', [], {}];
const service = new FanEngagementService(new Proxy({}, {
  get() { throw new Error('Persistence access forbidden in label projection'); },
}) as never);
const labels = (value: unknown, locale: string) => (service as unknown as {
  labels(value: unknown, locale: string): Record<string, unknown> | undefined;
}).labels(value, locale);

describe('fan localized labels: stored metadata fallback only', () => {
  it.each(locales)('preserves populated requested %s labels, with or without Korean metadata, without mutation', locale => {
    const requested = Object.freeze({ title: `stored ${locale} \uac00 \u65e5 \u4e2d & <text>\n`, action: 'stored action' });
    for (const includeKorean of [true, false]) {
      const value = Object.freeze({ labels: Object.freeze({ ...(includeKorean ? { ko: korean } : {}), [locale]: requested }) });
      const before = structuredClone(value);
      expect(labels(value, locale)).toEqual({ [locale]: requested });
      expect(labels(value, locale)?.[locale]).toBe(requested);
      expect(value).toEqual(before);
      expect(requested).not.toHaveProperty('description');
    }
  });

  it.each(translatedLocales)('uses stored Korean labels for missing requested %s metadata without mutation', locale => {
    const value = Object.freeze({ labels: Object.freeze({ ko: korean }) });
    const before = structuredClone(value);
    expect(labels(value, locale)).toEqual({ [locale]: korean });
    expect(value).toEqual(before);
  });

  it.each([null, false, 0, 'not label metadata', [], {}])('uses Korean metadata when requested metadata is unusable: %p', requested => {
    for (const locale of translatedLocales) {
      const value = { labels: { ko: korean, [locale]: requested } };
      const before = structuredClone(value);
      expect(labels(value, locale)).toEqual({ [locale]: korean });
      expect(value).toEqual(before);
    }
  });

  it.each(locales)('returns undefined for %s when neither requested nor Korean metadata is usable', locale => {
    for (const fallback of unusable) {
      const value = { labels: { ko: fallback, [locale]: {} } };
      const before = structuredClone(value);
      expect(labels(value, locale)).toBeUndefined();
      expect(value).toEqual(before);
    }
  });

  it.each(unusable)('does not invent labels for missing, invalid or empty root/labels metadata: %p', value => {
    for (const locale of locales) {
      expect(labels(value, locale)).toBeUndefined();
      const wrapped = { labels: value }, before = structuredClone(wrapped);
      expect(labels(wrapped, locale)).toBeUndefined();
      expect(wrapped).toEqual(before);
    }
  });
});

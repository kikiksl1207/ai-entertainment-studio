import {
  normalizeStoryPayloadLocale,
  resolveStoryLocalizedValue,
  STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT,
} from './story-locale-payload-contract';

describe('story locale payload fallback API contract', () => {
  it('normalizes aliases while keeping simplified and traditional Chinese separate', () => {
    expect(normalizeStoryPayloadLocale('zh-CN')).toBe('zh-Hans');
    expect(normalizeStoryPayloadLocale('zh_HK')).toBe('zh-Hant');
    expect(normalizeStoryPayloadLocale('zh-Hans')).not.toBe(
      normalizeStoryPayloadLocale('zh-Hant'),
    );
  });

  it('uses requested locale before source and common fallbacks', () => {
    expect(
      resolveStoryLocalizedValue({
        contentClass: 'manuscript',
        requestedLocale: 'ja-JP',
        sourceLocale: 'ko',
        payload: {
          ko: 'scene-copy-ko',
          ja: 'scene-copy-ja',
        },
      }),
    ).toMatchObject({
      resolvedLocale: 'ja',
      value: 'scene-copy-ja',
      status: 'resolved',
    });
  });

  it('skips empty raw-key and malformed values without exposing them', () => {
    const malformed = `copy-${String.fromCharCode(0xfffd)}`;
    expect(
      resolveStoryLocalizedValue({
        contentClass: 'system_copy',
        requestedLocale: 'zh-CN',
        sourceLocale: 'ko',
        payload: {
          'zh-Hans': 'storyStage.scene.rawKey',
          ko: '',
          en: malformed,
          ja: 'safe-copy-ja',
        },
      }),
    ).toMatchObject({
      resolvedLocale: 'ja',
      value: 'safe-copy-ja',
      status: 'fallback',
    });
    expect(
      STORY_LOCALE_PAYLOAD_FALLBACK_API_CONTRACT.fallbackPolicy,
    ).toMatchObject({
      zhHansAndZhHantSeparated: true,
      emptyStringReturned: false,
      rawKeyReturned: false,
      malformedEncodingReturned: false,
    });
  });
});

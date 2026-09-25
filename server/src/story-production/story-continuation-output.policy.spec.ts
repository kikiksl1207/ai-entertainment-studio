import { BadRequestException } from '@nestjs/common';
import { normalizeLongStoryContinuationProse, validateStoryContinuationProviderResult } from './story-continuation-output.policy';
import type { StoryContinuationProviderResult } from './story-continuation.provider';

const valid = {
  title: { en: 'An ending' }, beats: [{ beatType: 'paragraph', content: { en: 'The end.' } }],
  ending: { endingKey: 'ai-end' },
  usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, imageUnits: 0 },
  visualManifest: { sceneKey: 'ai-test', background: { state: 'fallback' }, characters: [],
    fallback: { publicAssetPath: '/assets/story/placeholder.webp', altKey: 'story.visual.fallback' } },
} as StoryContinuationProviderResult;
const input = { locale: 'en', sceneKey: 'ai-test', inputTokenLimit: 100, outputTokenLimit: 100 };

describe('continuation output ending defense', () => {
  it.each([{}, { endingKey: '' }, { endingKey: '   ' }, { endingKey: 123 }, { endingKey: null },
    { endingKey: {} }, { endingKey: 'private-invalid-key' }, [], 'private-ending-payload'])('rejects malformed ending %# without reflecting its payload', (ending) => {
    try {
      validateStoryContinuationProviderResult({ ...valid, ending } as StoryContinuationProviderResult, input);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toBe('Generated continuation ending key is invalid');
      expect((error as Error).message).not.toContain('private');
    }
  });
  it('keeps a valid ending and no choices', () => {
    const result = validateStoryContinuationProviderResult(valid, input);
    expect(result.ending).toEqual({ endingKey: 'ai-end' });
    expect(result.nextChoices).toBeUndefined();
  });

  it('keeps continuation choices when a provider redundantly also marks an ending', () => {
    const result = validateStoryContinuationProviderResult({
      ...valid,
      nextChoices: [{ choiceKey: 'continue', label: { en: 'Continue' } }],
    }, input);
    expect(result.nextChoices).toEqual([{ choiceKey: 'continue', label: { en: 'Continue' } }]);
    expect(result.ending).toBeUndefined();
  });
  it.each([null, undefined, false, 0])('rejects empty routing %#', (ending) => {
    expect(() => validateStoryContinuationProviderResult({ ...valid, ending } as StoryContinuationProviderResult, input))
      .toThrow(BadRequestException);
  });

  it('splits overlong Korean prose into bounded beats without dropping narrative characters', () => {
    const koreanInput = { ...input, locale: 'ko' };
    const withBeat = (content: string) => ({
      ...valid,
      title: { ko: '갈라진 물길' },
      beats: [{ beatType: 'paragraph', content: { ko: content } }],
    }) as StoryContinuationProviderResult;
    const beats = validateStoryContinuationProviderResult(withBeat('가'.repeat(11_000)), koreanInput).beats;
    expect(beats.length).toBeGreaterThan(1);
    expect(beats.every((beat) => Buffer.byteLength(beat.content.ko, 'utf8') <= 14_000)).toBe(true);
    expect(beats.map((beat) => beat.content.ko).join('')).toBe('가'.repeat(11_000));
    expect(() => validateStoryContinuationProviderResult(withBeat('가'.repeat(35_000)), koreanInput))
      .toThrow('Generated localized text exceeds its byte limit');
  });

  it('rejects a standalone closing bracket but keeps ordinary quoted bracket text', () => {
    const withText = (text: string) => ({
      ...valid,
      beats: [{ beatType: 'paragraph', content: { en: text } }],
    }) as StoryContinuationProviderResult;
    expect(() => validateStoryContinuationProviderResult(withText('She waited.\n\n]\n\nThen left.'), input))
      .toThrow('Generated continuation contains a stray bracket paragraph');
    expect(validateStoryContinuationProviderResult(withText('The note read [stay].'), input).beats[0].content.en)
      .toBe('The note read [stay].');
  });

  it('turns escaped model line breaks into real paragraph breaks before storing prose', () => {
    const result = validateStoryContinuationProviderResult({
      ...valid,
      beats: [{ beatType: 'paragraph', content: { en: 'She opened the file.\\r\\n\\r\\nThen she read it.' } }],
    }, input);
    expect(result.beats[0].content.en).toBe('She opened the file.\n\nThen she read it.');
  });

  it('joins split words and removes only a short unfinished tail from long AI prose', () => {
    const beats = Array.from({ length: 10 }, (_, index) => ({
      beatType: 'paragraph' as const,
      content: { ko: index === 4 ? '그는 재빨' : index === 5 ? '리 제지했다.' :
        index === 9 ? '“누가 왔죠?” 그는' : `장면 ${index}이 끝났다.` },
    }));
    const normalized = normalizeLongStoryContinuationProse({ ...valid, beats }, 'ko');
    expect(normalized.beats.map((beat) => beat.content.ko)).toContain('그는 재빨리 제지했다.');
    expect(normalized.beats.at(-1)?.content.ko).toBe('“누가 왔죠?”');
    expect(beats[4].content.ko).toBe('그는 재빨');
  });

  it('rejects a long unfinished final fragment instead of publishing it', () => {
    const beats = Array.from({ length: 10 }, (_, index) => ({
      beatType: 'paragraph' as const,
      content: { ko: index === 9 ? `그는 확인했다. ${'끝나지 않은 서술'.repeat(20)}` : '완전한 문장이다.' },
    }));
    expect(() => normalizeLongStoryContinuationProse({ ...valid, beats }, 'ko'))
      .toThrow('Generated continuation final sentence is incomplete');
  });
});

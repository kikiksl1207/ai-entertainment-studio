import { BadRequestException } from '@nestjs/common';
import { validateStoryContinuationProviderResult } from './story-continuation-output.policy';
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

  it('accepts a bounded long Korean beat and still rejects an oversized one', () => {
    const koreanInput = { ...input, locale: 'ko' };
    const withBeat = (content: string) => ({
      ...valid,
      title: { ko: '갈라진 물길' },
      beats: [{ beatType: 'paragraph', content: { ko: content } }],
    }) as StoryContinuationProviderResult;
    expect(validateStoryContinuationProviderResult(withBeat('가'.repeat(9_000)), koreanInput).beats[0].content)
      .toEqual({ ko: '가'.repeat(9_000) });
    expect(() => validateStoryContinuationProviderResult(withBeat('가'.repeat(11_000)), koreanInput))
      .toThrow('Generated localized text exceeds its byte limit');
  });
});

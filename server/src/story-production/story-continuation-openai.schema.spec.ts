import { sourceStoryContinuationLengthBounds, validateStoryContinuationNarrativeLength } from './story-continuation-length.policy';
import { storyContinuationOutputSchema } from './story-continuation-openai.schema';

describe('story continuation output schema', () => {
  it.each([1, 300, 2_710, 7_158, 10_000, 20_000])(
    'cannot permit overlength narrative for a %i-unit author reference', (units) => {
      const sourceBeats = Array.from({ length: Math.ceil(units / 5_000) }, (_, index) => ({
        beatType: 'paragraph', content: '가'.repeat(Math.min(5_000, units - index * 5_000)),
      }));
      const bounds = sourceStoryContinuationLengthBounds('ko', sourceBeats);
      const beats = storyContinuationOutputSchema('ko', bounds.minUnits, bounds.maxUnits)
        .properties.beats as {
          minItems: number;
          maxItems: number;
          items: { properties: { content: { properties: { ko: { minLength: number; maxLength: number } } } } };
        };
      const length = beats.items.properties.content.properties.ko;

      expect(beats.minItems).toBe(beats.maxItems);
      expect(length.minLength).toBeLessThanOrEqual(length.maxLength);
      expect(beats.maxItems * length.maxLength).toBeLessThanOrEqual(bounds.maxUnits);
      const output = Array.from({ length: beats.maxItems }, () => ({
        beatType: 'paragraph', content: { ko: '가'.repeat(length.maxLength) },
      }));
      expect(validateStoryContinuationNarrativeLength({ locale: 'ko', beats: output }, bounds).units)
        .toBeLessThanOrEqual(bounds.maxUnits);
    },
  );
});

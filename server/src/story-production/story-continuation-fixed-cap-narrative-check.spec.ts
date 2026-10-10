import { inspectStoryContinuationFixedCapNarrative } from './story-continuation-fixed-cap-narrative-check';
import * as lengthPolicy from './story-continuation-length.policy';
import type { StoryContinuationLengthBounds } from './story-continuation-length.policy';

const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'] as const;
const textByLocale: Record<(typeof locales)[number], string> = {
  ko: '\uac00 \ub098\n\ub2e4 \ub77c \ub9c8',
  en: 'A B\nC D E',
  ja: '\u3042 \u3044\n\u3046 \u3048 \u304a',
  'zh-Hans': '\u95e8 \u706f\n\u4e66 \u4eba \u8def',
  'zh-Hant': '\u9580 \u71c8\n\u66f8 \u4eba \u8def',
};
const PRIVATE = 'PRIVATE_NARRATIVE_SENTINEL';
const reasons = [
  'fixed_cap_narrative_within_original_bounds', 'fixed_cap_narrative_unmeasured',
  'author_length_profile_invalid', 'author_length_locale_mismatch', 'author_length_locale_unsupported',
  'author_length_beats_invalid', 'author_length_beat_type_invalid', 'author_length_text_invalid',
  'author_length_byte_limit', 'author_length_unicode_invalid',
  'continuation_output_underlength', 'continuation_output_overlength',
];
type Candidate = Parameters<typeof inspectStoryContinuationFixedCapNarrative>[0];
type Diagnostic = ReturnType<typeof inspectStoryContinuationFixedCapNarrative>;

function candidate(text = 'abcde', locale: string = 'en'): Candidate {
  return { locale, beats: [{ beatType: 'paragraph', content: { [locale]: text } }] };
}

function bounds(units = 5, locale = 'en') {
  return lengthPolicy.sourceStoryContinuationLengthBounds(locale,
    Array.from({ length: Math.ceil(units / 32_000) }, (_, index) => ({
      beatType: 'paragraph', content: 'a'.repeat(Math.min(32_000, units - index * 32_000)),
    })));
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function inspect(input: Candidate, expected: StoryContinuationLengthBounds): Diagnostic {
  const result = inspectStoryContinuationFixedCapNarrative(input, expected);
  expect(result).not.toBeInstanceOf(Error);
  expect(result).toMatchObject({ version: 'story-fixed-cap-narrative-v1', currentApprovalVerified: false,
    providerReceiptVerified: false, semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0 });
  expect(['within_original_bounds', 'underlength', 'overlength', 'unmeasured']).toContain(result.narrativeFit);
  expect(reasons).toContain(result.reason);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.keys(result).sort()).toEqual(['version', 'narrativeFit', 'reason', 'measuredUnits', 'utf8Bytes',
    'beatCount', 'expectedBounds', 'currentApprovalVerified', 'providerReceiptVerified',
    'semanticQualityVerified', 'dispatchAuthorized', 'providerCalls'].sort());
  for (const value of [result.measuredUnits, result.utf8Bytes, result.beatCount]) {
    if (value !== null) expect(Number.isSafeInteger(value) && value >= 0).toBe(true);
  }
  if (result.expectedBounds !== null) {
    expect(Object.isFrozen(result.expectedBounds)).toBe(true);
    expect(Object.keys(result.expectedBounds).sort()).toEqual(['referenceUnits', 'minUnits', 'targetUnits', 'maxUnits'].sort());
    for (const value of Object.values(result.expectedBounds)) {
      expect(Number.isSafeInteger(value) && value > 0).toBe(true);
    }
  }
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(PRIVATE);
  expect(serialized).not.toMatch(/"(?:locale|beats|content|text|apiKey|operationId|fingerprint|hash|source|candidate|error|stack)"/);
  expect(serialized).not.toMatch(/\b[a-f0-9]{40}(?:[a-f0-9]{24})?\b/i);
  return result;
}

function expectUnknown(result: Diagnostic, reason: string) {
  expect(result).toMatchObject({ narrativeFit: 'unmeasured', reason, measuredUnits: null, utf8Bytes: null, beatCount: null });
}

describe('Fixed-cap saved-candidate narrative diagnostic (offline synthetic only)', () => {
  let network: jest.SpyInstance;
  let loggers: jest.SpyInstance[];
  beforeEach(() => {
    network = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network prohibited'));
    loggers = ['log', 'info', 'warn', 'error', 'debug'].map(method =>
      jest.spyOn(console, method as 'log').mockImplementation(() => undefined));
  });
  afterEach(() => {
    try {
      expect(network).not.toHaveBeenCalled();
      for (const logger of loggers) expect(logger).not.toHaveBeenCalled();
    } finally { jest.restoreAllMocks(); }
  });

  it.each(locales)('FIXED-CAP-NARRATIVE: measures projected %s nonwhitespace codepoints with the existing validator', locale => {
    const input = candidate(textByLocale[locale], locale);
    const expected = bounds(5, locale);
    const measured = lengthPolicy.validateStoryContinuationNarrativeLength(input, expected);
    expect(inspect(input, expected)).toMatchObject({ narrativeFit: 'within_original_bounds',
      reason: 'fixed_cap_narrative_within_original_bounds', measuredUnits: 5,
      utf8Bytes: Buffer.byteLength(textByLocale[locale], 'utf8'), beatCount: 1 });
    expect(measured).toEqual({ units: 5, utf8Bytes: Buffer.byteLength(textByLocale[locale], 'utf8'), beatCount: 1 });
  });

  it.each([8, 10, 12])('FIXED-CAP-NARRATIVE: accepts %i units including the exact original min and max', units => {
    expect(inspect(candidate('a'.repeat(units)), bounds(10))).toMatchObject({ narrativeFit: 'within_original_bounds',
      measuredUnits: units, expectedBounds: { referenceUnits: 10, minUnits: 8, targetUnits: 10, maxUnits: 12 } });
  });

  it.each([
    { units: 7, narrativeFit: 'underlength', reason: 'continuation_output_underlength' },
    { units: 13, narrativeFit: 'overlength', reason: 'continuation_output_overlength' },
  ])('FIXED-CAP-NARRATIVE: preserves $narrativeFit without retrying or inventing measured counts', ({ units, narrativeFit, reason }) => {
    const input = freezeDeep(candidate('a'.repeat(units)));
    const expected = bounds(10);
    const before = JSON.stringify({ input, expected });
    const validate = jest.spyOn(lengthPolicy, 'validateStoryContinuationNarrativeLength');
    const result = inspect(input, expected);
    expect(result).toMatchObject({ narrativeFit, reason, measuredUnits: null, utf8Bytes: null, beatCount: null,
      expectedBounds: { referenceUnits: 10, minUnits: 8, targetUnits: 10, maxUnits: 12 } });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify({ input, expected })).toBe(before);
  });

  it.each([
    { name: 'null', value: null }, { name: 'false', value: false },
    { name: 'version', change: { profileVersion: PRIVATE } },
    { name: 'measurement', change: { measurement: PRIVATE } },
    { name: 'unsupported locale', change: { locale: 'fr' } },
    { name: 'reference', change: { referenceUnits: NaN } },
    { name: 'minimum', change: { minUnits: 1 } },
    { name: 'target', change: { targetUnits: 9 } },
    { name: 'maximum', change: { maxUnits: 99 } },
    { name: 'extra approval field', change: { approved: true } },
  ])('FIXED-CAP-NARRATIVE: invalid $name bounds expose no expected numbers or candidate reads', test => {
    const expected = ('value' in test ? test.value : { ...bounds(10), ...test.change }) as unknown as StoryContinuationLengthBounds;
    const reads = jest.fn(() => { throw new Error(PRIVATE); });
    const input = { get locale() { return reads(); }, get beats() { return reads(); } };
    const validate = jest.spyOn(lengthPolicy, 'validateStoryContinuationNarrativeLength');
    const result = inspect(input, expected);
    expectUnknown(result, 'author_length_profile_invalid');
    expect(result.expectedBounds).toBeNull();
    expect(validate).not.toHaveBeenCalled();
    expect(reads).not.toHaveBeenCalled();
  });

  it.each([null, false].map(value => [value]))('FIXED-CAP-NARRATIVE: malformed runtime candidate %s returns no exception or raw value', value => {
    const result = inspect(value as unknown as Candidate, bounds());
    expectUnknown(result, value === false ? 'author_length_locale_mismatch' : 'fixed_cap_narrative_unmeasured');
    expect(result.expectedBounds).toEqual({ referenceUnits: 5, minUnits: 4, targetUnits: 5, maxUnits: 6 });
  });

  it.each([
    { name: 'missing', value: undefined }, { name: 'nonarray', value: {} },
    { name: 'empty', value: [] },
    { name: '41 beats', value: Array.from({ length: 41 }, () => ({ beatType: 'paragraph', content: { en: 'a' } })) },
  ])('FIXED-CAP-NARRATIVE: rejects $name beats without taking a partial candidate', ({ value }) => {
    expectUnknown(inspect({ locale: 'en', beats: value }, bounds()), 'author_length_beats_invalid');
  });

  it.each(['narration', 'background', PRIVATE])('FIXED-CAP-NARRATIVE: does not silently omit unsupported output beat kind %s', beatType => {
    expectUnknown(inspect({ locale: 'en', beats: [{ beatType, content: { en: 'abcde' } }] }, bounds()),
      'author_length_beat_type_invalid');
  });

  it.each([
    { name: 'absent', content: undefined }, { name: 'wrong locale', content: { ko: 'abcde' } },
    { name: 'multiple locale keys', content: { en: 'abcde', ko: PRIVATE } },
  ])('FIXED-CAP-NARRATIVE: requires an exact projected locale map for $name content', ({ content }) => {
    expectUnknown(inspect({ locale: 'en', beats: [{ beatType: 'paragraph', content }] }, bounds()),
      'author_length_locale_mismatch');
  });

  it('FIXED-CAP-NARRATIVE: candidate locale cannot convert the original bounds', () => {
    expectUnknown(inspect(candidate('abcde', 'ko'), bounds()), 'author_length_locale_mismatch');
  });

  it('FIXED-CAP-NARRATIVE: rejects nonstring projected text without coercing it', () => {
    expectUnknown(inspect({ locale: 'en', beats: [{ beatType: 'paragraph', content: { en: 12345 } }] }, bounds()),
      'author_length_text_invalid');
  });

  it.each(['\ud800', '\udfff'])('FIXED-CAP-NARRATIVE: unpaired surrogate %s is not repaired or counted', text => {
    expectUnknown(inspect(candidate(text), bounds(1)), 'author_length_unicode_invalid');
  });

  it('FIXED-CAP-NARRATIVE: preserves codepoint counting without NFC repair or control padding', () => {
    const text = 'A \t\r\n\u{1f642}e\u0301\u00a0\u200b\u200d\u0000';
    expect(inspect(candidate(text), bounds(4))).toMatchObject({ narrativeFit: 'within_original_bounds',
      measuredUnits: 4, utf8Bytes: Buffer.byteLength(text, 'utf8') });
  });

  it('FIXED-CAP-NARRATIVE: blank narrative is underlength with unknown measured counts, not zero success', () => {
    expect(inspect(candidate(' \n\t\u200b'), bounds())).toMatchObject({ narrativeFit: 'underlength',
      reason: 'continuation_output_underlength', measuredUnits: null, utf8Bytes: null, beatCount: null });
  });

  it('FIXED-CAP-NARRATIVE: dialogue counts while scene-break text counts only towards bytes and beatCount', () => {
    const input = { locale: 'en', beats: [
      { beatType: 'dialogue', content: { en: 'abcde' } },
      { beatType: 'scene_break', content: { en: PRIVATE } },
    ] };
    expect(inspect(input, bounds())).toMatchObject({ narrativeFit: 'within_original_bounds',
      measuredUnits: 5, utf8Bytes: 5 + Buffer.byteLength(PRIVATE, 'utf8'), beatCount: 2 });
  });

  it('FIXED-CAP-NARRATIVE: title, choices and ending cannot pay the narrative floor or imply schema approval', () => {
    const input = { ...candidate('a'), title: { en: PRIVATE.repeat(10) },
      nextChoices: [{ label: { en: PRIVATE.repeat(10) } }], ending: { endingKey: PRIVATE } };
    expect(inspect(input, bounds())).toMatchObject({ narrativeFit: 'underlength', measuredUnits: null });
  });

  it('FIXED-CAP-NARRATIVE: retains the exact 16000-byte per-text output boundary', () => {
    const input = candidate('\u{1f642}'.repeat(4_000));
    expect(inspect(input, bounds(4_000))).toMatchObject({ narrativeFit: 'within_original_bounds',
      measuredUnits: 4_000, utf8Bytes: 16_000, beatCount: 1 });
    expectUnknown(inspect(candidate('\u{1f642}'.repeat(4_001)), bounds(4_001)), 'author_length_byte_limit');
  });

  it('FIXED-CAP-NARRATIVE: retains the string-length guard before per-text byte checks', () => {
    expectUnknown(inspect(candidate('a'.repeat(16_001)), bounds(16_001)), 'author_length_text_invalid');
  });

  it('FIXED-CAP-NARRATIVE: retains the total 100000-byte boundary without dropping later beats', () => {
    const input = { locale: 'en', beats: Array.from({ length: 7 }, (_, index) => ({
      beatType: 'paragraph', content: { en: 'a'.repeat(index < 6 ? 16_000 : 4_000) },
    })) };
    expect(inspect(input, bounds(100_000))).toMatchObject({ narrativeFit: 'within_original_bounds',
      measuredUnits: 100_000, utf8Bytes: 100_000, beatCount: 7 });
    input.beats[6].content.en += 'a';
    expectUnknown(inspect(input, bounds(100_000)), 'author_length_byte_limit');
  });

  it('FIXED-CAP-NARRATIVE: deeply frozen candidate and bounds stay unchanged through one real validation', () => {
    const input = freezeDeep(candidate());
    const expected = freezeDeep({ ...bounds() });
    const before = JSON.stringify({ input, expected });
    const validate = jest.spyOn(lengthPolicy, 'validateStoryContinuationNarrativeLength');
    expect(inspect(input, expected)).toMatchObject({ narrativeFit: 'within_original_bounds' });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(input, expected);
    expect(JSON.stringify({ input, expected })).toBe(before);
  });

  it('FIXED-CAP-NARRATIVE: private extra data and throwing getters are not inspected or reflected', () => {
    const reads = jest.fn(() => { throw new Error(PRIVATE); });
    const text = `${PRIVATE}abcde`;
    const input = { ...candidate(text), operationId: PRIVATE, fingerprint: 'a'.repeat(64),
      get apiKey() { return reads(); }, get source() { return reads(); } };
    const result = inspect(input, bounds(text.length));
    expect(result.narrativeFit).toBe('within_original_bounds');
    expect(reads).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('outputFit');
    expect(result).not.toHaveProperty('model');
  });

  it.each([
    { name: 'plain policy-like error', error: new Error('continuation_output_underlength') },
    { name: 'forged code object', error: { code: 'continuation_output_overlength', message: PRIVATE } },
    { name: 'unknown typed code', error: new lengthPolicy.StoryContinuationLengthPolicyError(PRIVATE) },
  ])('FIXED-CAP-NARRATIVE: sanitizes $name without a message echo or false length classification', ({ error }) => {
    jest.spyOn(lengthPolicy, 'validateStoryContinuationNarrativeLength').mockImplementation(() => { throw error; });
    const result = inspect(candidate(), bounds());
    expectUnknown(result, 'fixed_cap_narrative_unmeasured');
    expect(result.expectedBounds).toEqual({ referenceUnits: 5, minUnits: 4, targetUnits: 5, maxUnits: 6 });
  });
});

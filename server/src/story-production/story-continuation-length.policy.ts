import { STORY_LOCALES, type StoryLocale } from './story-production.policy';

export const AUTHOR_LENGTH_PROFILE_VERSION = 'author-length-80-120-v1';
export const NARRATIVE_LENGTH_MEASUREMENT = 'narrative-nonwhite-codepoints-v1';

export type StoryContinuationLengthBounds = Readonly<{
  profileVersion: typeof AUTHOR_LENGTH_PROFILE_VERSION;
  measurement: typeof NARRATIVE_LENGTH_MEASUREMENT;
  locale: StoryLocale;
  referenceUnits: number;
  minUnits: number;
  targetUnits: number;
  maxUnits: number;
}>;

export class StoryContinuationLengthPolicyError extends Error {
  constructor(readonly code: string) { super(code); }
}

const BOUNDS_KEYS = [
  'profileVersion', 'measurement', 'locale', 'referenceUnits', 'minUnits', 'targetUnits', 'maxUnits',
];
const NON_NARRATIVE_CODE_POINT = /[\p{White_Space}\p{Cc}\p{Cf}]/u;

// This measures an already projected reference. It neither resolves source ownership
// nor confirms author approval; the caller must bind the proposal to reviewed source.
export function proposeStoryContinuationLength(reference: { locale: string; beats: unknown }) {
  const measured = measureNarrative(reference, 'reference');
  if (!measured.units) fail('author_length_reference_empty');
  const bounds: StoryContinuationLengthBounds = Object.freeze({
    profileVersion: AUTHOR_LENGTH_PROFILE_VERSION,
    measurement: NARRATIVE_LENGTH_MEASUREMENT,
    locale: reference.locale as StoryLocale,
    referenceUnits: measured.units,
    minUnits: Math.ceil(measured.units * 4 / 5),
    targetUnits: measured.units,
    maxUnits: Math.floor(measured.units * 6 / 5),
  });
  return Object.freeze({ approval: 'proposed' as const, bounds });
}

export function assertStoryContinuationLengthBounds(value: unknown): asserts value is StoryContinuationLengthBounds {
  if (!record(value) || Object.keys(value).length !== BOUNDS_KEYS.length ||
      BOUNDS_KEYS.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
      value.profileVersion !== AUTHOR_LENGTH_PROFILE_VERSION ||
      value.measurement !== NARRATIVE_LENGTH_MEASUREMENT || !supportedLocale(value.locale) ||
      !integer(value.referenceUnits, 1, 256_000) ||
      value.targetUnits !== value.referenceUnits ||
      value.minUnits !== Math.ceil(value.referenceUnits * 4 / 5) ||
      value.maxUnits !== Math.floor(value.referenceUnits * 6 / 5)) {
    fail('author_length_profile_invalid');
  }
}

// Use alongside the full output validator. This does not validate the JSON envelope,
// author proof, ending eligibility, or semantic quality and never authorizes dispatch.
export function validateStoryContinuationNarrativeLength(
  output: { locale: string; beats: unknown },
  bounds: StoryContinuationLengthBounds,
) {
  assertStoryContinuationLengthBounds(bounds);
  if (output.locale !== bounds.locale) fail('author_length_locale_mismatch');
  const measured = measureNarrative(output, 'output');
  if (measured.units < bounds.minUnits) fail('continuation_output_underlength');
  if (measured.units > bounds.maxUnits) fail('continuation_output_overlength');
  return measured;
}

function measureNarrative(input: { locale: string; beats: unknown }, mode: 'reference' | 'output') {
  if (!supportedLocale(input.locale)) fail('author_length_locale_unsupported');
  if (!Array.isArray(input.beats) || input.beats.length < 1 || input.beats.length > 40) {
    fail('author_length_beats_invalid');
  }
  const perTextBytes = mode === 'reference' ? 32_000 : 16_000;
  const totalBytes = mode === 'reference' ? 256_000 : 100_000;
  let units = 0;
  let utf8Bytes = 0;
  for (const beat of input.beats) {
    if (!record(beat) || typeof beat.beatType !== 'string' ||
        !['paragraph', 'dialogue', 'scene_break', ...(mode === 'reference' ? ['narration'] : [])].includes(beat.beatType)) {
      fail('author_length_beat_type_invalid');
    }
    if (!record(beat.content) || Object.keys(beat.content).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(beat.content, input.locale)) fail('author_length_locale_mismatch');
    const text = beat.content[input.locale];
    if (typeof text !== 'string' || text.length > perTextBytes) fail('author_length_text_invalid');
    const bytes = Buffer.byteLength(text, 'utf8');
    utf8Bytes += bytes;
    if (bytes > perTextBytes || utf8Bytes > totalBytes) fail('author_length_byte_limit');
    for (const point of text) {
      const code = point.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) fail('author_length_unicode_invalid');
      if (beat.beatType !== 'scene_break' && !NON_NARRATIVE_CODE_POINT.test(point)) units++;
    }
  }
  return { units, utf8Bytes, beatCount: input.beats.length };
}

function supportedLocale(value: unknown): value is StoryLocale {
  return typeof value === 'string' && (STORY_LOCALES as readonly string[]).includes(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function fail(code: string): never { throw new StoryContinuationLengthPolicyError(code); }

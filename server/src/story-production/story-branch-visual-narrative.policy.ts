import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { stableContinuationJson } from './story-continuation-context.policy';
import type { StoryContinuationProviderResult } from './story-continuation.provider';
import { STORY_LOCALES } from './story-production.policy';

const MAX_TITLE_BYTES = 500;
const MAX_BEAT_BYTES = 14_000;
const MAX_SOURCE_BYTES = 100_000;

// Source identity verification does not establish narrative quality or author approval.
export function verifiedStoredBranchVisualNarrative(
  locale: string,
  title: Prisma.JsonValue,
  beats: ReadonlyArray<{ position: number; beatType: string; content: Prisma.JsonValue }>,
  expected: Pick<StoryContinuationProviderResult, 'title' | 'beats'>,
): { title: string; prose: string } {
  try {
    if (!STORY_LOCALES.some(value => value === locale) || !isRecord(expected) ||
        !Array.isArray(beats) || beats.length < 1 || beats.length > 40 ||
        !Array.isArray(expected.beats) || expected.beats.length !== beats.length) sourceChanged();

    const storedTitle = localizedText(title, locale, MAX_TITLE_BYTES);
    const suppliedTitle = localizedText(expected.title, locale, MAX_TITLE_BYTES);
    const storedBeats: StoryContinuationProviderResult['beats'] = [];
    const suppliedBeats: StoryContinuationProviderResult['beats'] = [];
    for (let index = 0; index < beats.length; index++) {
      const beat = beats[index];
      if (!isRecord(beat) || beat.position !== index + 1) sourceChanged();
      storedBeats.push(narrativeBeat(beat, locale));
      suppliedBeats.push(narrativeBeat(expected.beats[index], locale));
    }

    const storedJson = stableContinuationJson({ title: { [locale]: storedTitle }, beats: storedBeats });
    const suppliedJson = stableContinuationJson({ title: { [locale]: suppliedTitle }, beats: suppliedBeats });
    if (Buffer.byteLength(storedJson, 'utf8') > MAX_SOURCE_BYTES || storedJson !== suppliedJson) sourceChanged();

    return { title: storedTitle, prose: storedBeats.map(beat => beat.content[locale]).join('\n') };
  } catch {
    sourceChanged();
  }
}

function narrativeBeat(value: unknown, locale: string): StoryContinuationProviderResult['beats'][number] {
  if (!isRecord(value) || (value.beatType !== 'paragraph' && value.beatType !== 'dialogue' &&
      value.beatType !== 'scene_break')) sourceChanged();
  const text = localizedText(value.content, locale, MAX_BEAT_BYTES);
  return { beatType: value.beatType, content: { [locale]: text } };
}

function localizedText(value: unknown, locale: string, maxBytes: number): string {
  if (!isRecord(value)) sourceChanged();
  const entries = Object.entries(value);
  if (entries.length !== 1 || entries[0][0] !== locale) sourceChanged();
  const text = entries[0][1];
  if (typeof text !== 'string' || !text.trim() || text.includes('\0') ||
      Buffer.byteLength(text, 'utf8') > maxBytes || !wellFormedUnicode(text)) sourceChanged();
  return text;
}

function wellFormedUnicode(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sourceChanged(): never {
  throw new ConflictException({ code: 'STORY_VISUAL_BRANCH_SOURCE_CHANGED' });
}

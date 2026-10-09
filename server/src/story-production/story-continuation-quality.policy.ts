import type { StoryContinuationApprovedContext } from './story-continuation-context.assembler';
import type { StoryContinuationProviderResult } from './story-continuation.provider';
import { StoryContinuationProviderError } from './story-continuation.provider';

const MIN_REPEATED_PARAGRAPH_UNITS = 240;
const DATED_NUMERIC = /(?<!\d)(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?!\d)/gu;
const DATED_KOREAN = /(?<!\d)(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/gu;

export function assertStoryContinuationQuality(
  result: StoryContinuationProviderResult,
  context: StoryContinuationApprovedContext,
  locale: string,
): void {
  const outputText = [
    result.title[locale],
    ...result.beats.map((beat) => beat.content[locale]),
    ...(result.nextChoices ?? []).map((choice) => choice.label[locale]),
  ].join('\n');
  const approvedText = [
    ...context.sourceScene.beats.map((beat) => beat.content),
    ...context.memories.map((memory) => memory.content),
    JSON.stringify(context.generationProfile ?? {}),
  ].join('\n');
  for (const pattern of [DATED_NUMERIC, DATED_KOREAN]) {
    for (const match of outputText.matchAll(pattern)) {
      if (!validGregorianDate(Number(match[1]), Number(match[2]), Number(match[3])) &&
          !approvedText.includes(match[0])) {
        throw new StoryContinuationProviderError('continuation_invalid_calendar_date', false);
      }
    }
  }

  const sourceParagraphs = [
    ...context.sourceScene.beats.flatMap((beat) => paragraphs(beat.content)),
    ...context.memories.filter((memory) => memory.memoryType === 'style')
      .flatMap((memory) => paragraphs(memory.content)),
  ].map((text) => ({ text, long: Array.from(text).length >= MIN_REPEATED_PARAGRAPH_UNITS }));
  // Paragraph and beat boundaries must not hide a complete copied source paragraph.
  const generatedNarrative = result.beats.flatMap((beat) => paragraphs(beat.content[locale])).join(' ');
  if (sourceParagraphs.some((source) => source.long && generatedNarrative.includes(source.text))) {
    throw new StoryContinuationProviderError('continuation_source_prose_repeated', false);
  }
  const generatedParagraphs = new Set<string>();
  for (const beat of result.beats) {
    for (const paragraph of paragraphs(beat.content[locale])) {
      if (Array.from(paragraph).length < MIN_REPEATED_PARAGRAPH_UNITS) continue;
      if (sourceParagraphs.some((source) => source.text.includes(paragraph) ||
          (source.long && paragraph.includes(source.text)))) {
        throw new StoryContinuationProviderError('continuation_source_prose_repeated', false);
      }
      if (generatedParagraphs.has(paragraph)) {
        throw new StoryContinuationProviderError('continuation_generated_prose_repeated', false);
      }
      generatedParagraphs.add(paragraph);
    }
  }
}

function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/u).map((paragraph) => paragraph.normalize('NFC').replace(/\s+/gu, ' ').trim()).filter(Boolean);
}

function validGregorianDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

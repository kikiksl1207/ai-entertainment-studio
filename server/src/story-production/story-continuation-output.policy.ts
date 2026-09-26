import { BadRequestException } from '@nestjs/common';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import type { StoryContinuationProviderResult } from './story-continuation.provider';

const MAX_OUTPUT_BYTES = 100_000;
const MAX_BEAT_BYTES = 14_000;
const SENTENCE_END = /[.!?。！？…]+[”"'’)]*$/u;
const SENTENCE_BOUNDARY = /[.!?。！？…]+[”"'’)]*\s*/gu;

export function normalizeLongStoryContinuationProse(value: StoryContinuationProviderResult, locale: string) {
  if (value.beats.length < 10) return value;
  const beats: StoryContinuationProviderResult['beats'] = [];
  for (const beat of value.beats) {
    const text = beat.content[locale];
    const previous = beats.at(-1);
    if (previous && previous.beatType !== 'scene_break' && beat.beatType !== 'scene_break' &&
        !SENTENCE_END.test(previous.content[locale]) &&
        Buffer.byteLength(previous.content[locale] + text, 'utf8') <= MAX_BEAT_BYTES) {
      previous.content[locale] += text;
    } else {
      beats.push({ beatType: beat.beatType, content: { [locale]: text } });
    }
  }
  const last = beats.at(-1);
  if (!last || last.beatType === 'scene_break') invalid('Generated continuation final sentence is incomplete');
  const text = last!.content[locale].trimEnd();
  if (!SENTENCE_END.test(text)) {
    let completeEnd = 0;
    for (const match of text.matchAll(SENTENCE_BOUNDARY)) completeEnd = (match.index ?? 0) + match[0].length;
    if (!completeEnd || Array.from(text.slice(completeEnd)).length > 120) {
      invalid('Generated continuation final sentence is incomplete');
    }
    last!.content[locale] = text.slice(0, completeEnd).trimEnd();
  }
  return { ...value, beats };
}

export function validateStoryContinuationProviderResult(
  value: StoryContinuationProviderResult,
  input: {
    locale: string;
    sceneKey: string;
    inputTokenLimit: number;
    outputTokenLimit: number;
  },
): StoryContinuationProviderResult {
  if (!value || typeof value !== 'object') invalid('Generated continuation output is invalid');
  const title = localizedOnly(value.title, input.locale, 500);
  if (!Array.isArray(value.beats) || value.beats.length < 1 || value.beats.length > 40) {
    invalid('Generated continuation requires 1 to 40 beats');
  }
  const beats = value.beats.flatMap((beat) => {
    if (!beat || !['paragraph', 'dialogue', 'scene_break'].includes(beat.beatType)) {
      invalid('Generated continuation beat type is invalid');
    }
    const content = localizedOnly(beat.content, input.locale, MAX_OUTPUT_BYTES);
    const prose = content[input.locale].replace(/\\r\\n|\\n|\\r/gu, '\n');
    return splitNarrativeBeat(prose).map((text) => {
      if (text.split(/\r?\n/u).some((line) => line.trim() === ']')) {
        invalid('Generated continuation contains a stray bracket paragraph');
      }
      return { beatType: beat.beatType, content: { [input.locale]: text } };
    });
  });
  if (beats.length > 40) invalid('Generated continuation requires 1 to 40 beats');
  const hasChoices = Array.isArray(value.nextChoices) && value.nextChoices.length > 0;
  const hasEnding = Boolean(value.ending);
  if (hasChoices === hasEnding || (hasChoices && value.nextChoices!.length !== 3)) {
    invalid('Generated continuation requires exactly 3 choices or one ending');
  }
  const choices = (value.nextChoices ?? []).map((choice) => {
    const choiceKey = typeof choice.choiceKey === 'string' ? choice.choiceKey.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(choiceKey)) {
      invalid('Generated continuation choice key is invalid');
    }
    return {
      choiceKey,
      label: localizedOnly(choice.label, input.locale, 1_000),
    };
  });
  if (
    new Set(choices.map((choice) => choice.choiceKey)).size !== choices.length ||
    new Set(choices.map((choice) => choice.label[input.locale])).size !== choices.length
  ) {
    invalid('Generated continuation choices must be distinct');
  }
  const endingKey = typeof value.ending?.endingKey === 'string' ? value.ending.endingKey.trim() : undefined;
  if (hasEnding && (!endingKey || !/^ai-[a-z0-9][a-z0-9_-]{0,116}$/i.test(endingKey))) {
    invalid('Generated continuation ending key is invalid');
  }
  const usage = usageRecord(value.usage);
  if (
    usage.inputTokens > input.inputTokenLimit ||
    usage.outputTokens > input.outputTokenLimit ||
    usage.cachedInputTokens > usage.inputTokens
  ) {
    invalid('Generated continuation usage exceeds its pinned limits');
  }
  const visualManifest = sanitizeContinuationVisualManifest(value.visualManifest, input.sceneKey);
  const sanitized: StoryContinuationProviderResult = {
    title,
    beats,
    visualManifest,
    ...(choices.length ? { nextChoices: choices } : {}),
    ...(!choices.length && endingKey ? { ending: { endingKey } } : {}),
    usage,
  };
  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_OUTPUT_BYTES) {
    invalid('Generated continuation output exceeds the byte limit');
  }
  return sanitized;
}

function splitNarrativeBeat(text: string): string[] {
  if (Buffer.byteLength(text, 'utf8') <= MAX_BEAT_BYTES) return [text];
  const points = Array.from(text);
  const parts: string[] = [];
  let start = 0;
  while (start < points.length) {
    let end = start;
    let bytes = 0;
    let boundary = start;
    while (end < points.length) {
      const nextBytes = Buffer.byteLength(points[end], 'utf8');
      if (bytes + nextBytes > MAX_BEAT_BYTES) break;
      bytes += nextBytes;
      if (/\s|[.!?。！？]/u.test(points[end])) boundary = end + 1;
      end++;
    }
    const split = boundary >= start + Math.floor((end - start) / 2) ? boundary : end;
    const part = points.slice(start, split).join('').trim();
    if (part) parts.push(part);
    start = split;
  }
  return parts;
}

export function sanitizeContinuationVisualManifest(
  value: Record<string, unknown>,
  expectedSceneKey: string,
): Record<string, unknown> {
  const projected = projectStoredStorySceneVisualManifest(value, expectedSceneKey);
  const fallback = value?.fallback && typeof value.fallback === 'object' && !Array.isArray(value.fallback)
    ? value.fallback as Record<string, unknown>
    : {};
  if (!projected || typeof fallback.publicAssetPath !== 'string' || typeof fallback.altKey !== 'string') {
    invalid('Generated continuation visual fallback is invalid');
  }
  return {
    sceneKey: projected.sceneKey,
    background: {
      publicAssetPath: projected.background.publicAssetPath,
      altKey: projected.background.altKey,
      state: projected.background.state,
    },
    characters: projected.characters.map((character) => ({
      characterKey: character.characterKey,
      placement: character.placement,
      expressionKey: character.expressionKey,
      publicAssetPath: character.publicAssetPath,
    })),
    fallback: {
      publicAssetPath: fallback.publicAssetPath,
      altKey: fallback.altKey,
    },
  };
}

function localizedOnly(value: unknown, locale: string, maxBytes: number) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    invalid('Generated localized text is invalid');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== 1 || entries[0][0] !== locale || typeof entries[0][1] !== 'string') {
    invalid('Generated localized text must contain only the requested locale');
  }
  const text = entries[0][1].trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maxBytes) {
    invalid('Generated localized text exceeds its byte limit');
  }
  return { [locale]: text };
}

function usageRecord(value: StoryContinuationProviderResult['usage']) {
  const result = {
    inputTokens: value?.inputTokens,
    outputTokens: value?.outputTokens,
    cachedInputTokens: value?.cachedInputTokens,
    imageUnits: value?.imageUnits,
  };
  if (Object.values(result).some((item) => !Number.isFinite(item) || !Number.isInteger(item) || item < 0)) {
    invalid('Generated continuation usage is invalid');
  }
  return result as StoryContinuationProviderResult['usage'];
}

function invalid(message: string): never {
  throw new BadRequestException(message);
}

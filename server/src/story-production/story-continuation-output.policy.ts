import { BadRequestException } from '@nestjs/common';
import { projectStoredStorySceneVisualManifest } from '../story-stage/story-scene-visual-manifest-contract';
import type { StoryContinuationProviderResult } from './story-continuation.provider';

const MAX_OUTPUT_BYTES = 100_000;
const MAX_TEXT_BYTES = 16_000;

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
  const beats = value.beats.map((beat) => {
    if (!beat || !['paragraph', 'dialogue', 'scene_break'].includes(beat.beatType)) {
      invalid('Generated continuation beat type is invalid');
    }
    return {
      beatType: beat.beatType,
      content: localizedOnly(beat.content, input.locale, MAX_TEXT_BYTES),
    };
  });
  const hasChoices = Array.isArray(value.nextChoices) && value.nextChoices.length > 0;
  const hasEnding = Boolean(value.ending);
  if (hasChoices === hasEnding || (hasChoices && value.nextChoices!.length > 3)) {
    invalid('Generated continuation requires 1 to 3 choices or one ending');
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
  const endingKey = value.ending?.endingKey?.trim();
  if (endingKey && !/^ai-[a-z0-9][a-z0-9_-]{0,116}$/i.test(endingKey)) {
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
    ...(endingKey ? { ending: { endingKey } } : {}),
    usage,
  };
  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > MAX_OUTPUT_BYTES) {
    invalid('Generated continuation output exceeds the byte limit');
  }
  return sanitized;
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

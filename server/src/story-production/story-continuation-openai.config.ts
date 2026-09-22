import { storyContinuationModelEncoding } from './story-continuation-tokenizer';

export type StoryContinuationConfigReader = { get<T = string>(key: string): T | undefined };

export type StoryContinuationOpenAiConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  rateCardId: string;
  rateCardVersion: string;
  apiKey: string;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxResponseBytes: number;
  visualAssetPath: string;
};

export function readStoryContinuationOpenAiConfig(reader: StoryContinuationConfigReader): StoryContinuationOpenAiConfig {
  const text = (key: string) => String(reader.get(key) ?? '').trim();
  return {
    enabled: text('STORY_CONTINUATION_PROVIDER_ENABLED') === 'true',
    provider: text('STORY_CONTINUATION_PROVIDER'),
    model: text('STORY_CONTINUATION_OPENAI_MODEL'),
    rateCardId: text('STORY_CONTINUATION_RATE_CARD_ID'),
    rateCardVersion: text('STORY_CONTINUATION_RATE_CARD_VERSION'),
    apiKey: text('STORY_CONTINUATION_OPENAI_API_KEY') || text('OPENAI_API_KEY'),
    timeoutMs: configInteger(reader, 'STORY_CONTINUATION_REQUEST_TIMEOUT_MS', 25_000),
    maxInputTokens: configInteger(reader, 'STORY_CONTINUATION_MAX_INPUT_TOKENS', 32_768),
    maxOutputTokens: configInteger(reader, 'STORY_CONTINUATION_MAX_OUTPUT_TOKENS', 8_192),
    maxResponseBytes: configInteger(reader, 'STORY_CONTINUATION_MAX_RESPONSE_BYTES', 200_000),
    visualAssetPath: text('STORY_CONTINUATION_VISUAL_ASSET_PATH'),
  };
}

export function storyContinuationConfigFailure(config: StoryContinuationOpenAiConfig): string | undefined {
  if (!config.enabled) return 'provider_disabled';
  if (config.provider !== 'openai') return 'provider_configuration_mismatch';
  // No rolling aliases: deployments must deliberately pin a dated snapshot.
  if (!/^[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}$/.test(config.model)) return 'provider_model_not_pinned';
  if (!storyContinuationModelEncoding(config.model)) return 'provider_model_encoding_unknown';
  if (!config.apiKey || /[\r\n]/.test(config.apiKey) || !config.rateCardId || !config.rateCardVersion) {
    return 'provider_not_configured';
  }
  if (!/^\/assets\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpg|jpeg)$/.test(config.visualAssetPath)) {
    return 'provider_visual_not_configured';
  }
  if (!inRange(config.timeoutMs, 100, 29_000) ||
      !inRange(config.maxInputTokens, 1, 128_000) ||
      !inRange(config.maxOutputTokens, 16, 32_768) ||
      !inRange(config.maxResponseBytes, 1_024, 1_000_000)) return 'provider_limits_invalid';
  return undefined;
}

export function configInteger(reader: StoryContinuationConfigReader, key: string, fallback: number): number {
  const value = reader.get(key);
  return value === undefined ? fallback : /^\d+$/.test(String(value)) ? Number(value) : NaN;
}

export function inRange(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

import { getEncoding, getEncodingNameForModel, type Tiktoken, type TiktokenModel } from 'js-tiktoken';
import { StoryContinuationProviderError } from './story-continuation.provider';

export const STORY_CONTINUATION_TOKEN_BUDGET_METHOD = 'js_tiktoken_o200k_base_v1';
let tokenizer: Tiktoken | undefined;

// js-tiktoken 1.0.21 predates this documented pinned snapshot. OpenAI's
// current GPT-5.4 Mini family uses the same o200k token budget boundary.
const PINNED_O200K_MODEL_OVERRIDES = new Set([
  'gpt-5.4-mini-2026-03-17',
]);

export function storyContinuationModelEncoding(model: string): 'o200k_base' | undefined {
  if (!/^[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}$/.test(model)) return undefined;
  if (PINNED_O200K_MODEL_OVERRIDES.has(model)) return 'o200k_base';
  try {
    // The pinned package's exact model table, never an arbitrary prefix/default encoding.
    return getEncodingNameForModel(model as TiktokenModel) === 'o200k_base' ? 'o200k_base' : undefined;
  } catch { return undefined; }
}

export function storyContinuationInputTokenBudget(body: { model: string }): number {
  if (!storyContinuationModelEncoding(body.model)) {
    throw new StoryContinuationProviderError('provider_model_encoding_unknown', false);
  }
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > 256_000) {
    throw new StoryContinuationProviderError('provider_input_bound_exceeded', false);
  }
  tokenizer ??= getEncoding('o200k_base');
  // Count ALL serialized instructions, schema, context and request fields. Special-token text
  // is ordinary story data. Reserve 10% plus 256 tokens for Responses framing/schema differences.
  const tokens = tokenizer.encode(serialized, [], []).length;
  return Math.ceil(tokens * 1.1) + 256;
}

export function storyContinuationTextTokens(model: string, text: string): number {
  if (!storyContinuationModelEncoding(model)) throw new StoryContinuationProviderError('provider_model_encoding_unknown', false);
  if (Buffer.byteLength(text, 'utf8') > 256_000) throw new StoryContinuationProviderError('provider_input_bound_exceeded', false);
  tokenizer ??= getEncoding('o200k_base');
  return tokenizer.encode(text, [], []).length;
}

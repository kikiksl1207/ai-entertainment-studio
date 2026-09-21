import { getEncoding, getEncodingNameForModel, type Tiktoken, type TiktokenModel } from 'js-tiktoken';
import { StoryContinuationProviderError } from './story-continuation.provider';

export const STORY_CONTINUATION_TOKEN_BUDGET_METHOD = 'js_tiktoken_o200k_base_v1';
let tokenizer: Tiktoken | undefined;

export function storyContinuationModelEncoding(model: string): 'o200k_base' | undefined {
  if (!/^[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}$/.test(model)) return undefined;
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

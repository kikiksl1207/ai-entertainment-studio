import type { SemanticConfig } from './story-semantic-analysis.config';
import type { SemanticInput } from './story-semantic-analysis.types';
import { boundary } from './story-semantic-analysis.source';

export const semanticTestConfig = (changes: Partial<SemanticConfig> = {}): SemanticConfig => ({
  enabled: true, workerEnabled: false, apiKey: 'offline-synthetic-test-key', provider: 'openai',
  model: 'gpt-4o-mini-2024-07-18', rateCardId: '00000000-0000-4000-8000-000000000183', rateCardVersion: 'offline-v1',
  inputKrwPerMillion: '1000', cachedInputKrwPerMillion: '500', outputKrwPerMillion: '2000',
  inputTokenLimit: 8192, outputTokenLimit: 2048, maxJobInputTokens: 10000000,
  maxJobOutputTokens: 10000000, maxJobCostKrw: '100000', timeoutMs: 1000, ...changes,
});
export const semanticTestInput = (): SemanticInput => ({
  manuscriptVersionId: '00000000-0000-4000-8000-000000000185', contentHash: 'a'.repeat(64), locale: 'ko',
  pieces: [{ partIndex: 0, partKey: 'part-1', paragraphIndex: 3, start: 0, end: 28,
    kind: 'paragraph', text: 'Mina opened the sealed door.' }].map(piece => ({ ...piece, end: piece.text.length })),
});
export function semanticTestOutput(input: SemanticInput) {
  const piece = input.pieces[0];
  let end = Math.min(piece?.text.length ?? 0, 32);
  if (piece && !boundary(piece.text, end)) end--;
  return { manuscriptVersionId: input.manuscriptVersionId, contentHash: input.contentHash,
    evidence: piece?.text ? [{ kind: 'event', title: 'A local action', observation: 'The passage describes an action by a character.', styleCategory: null, citations: [{
      partIndex: piece.partIndex, partKey: piece.partKey, paragraphIndex: piece.paragraphIndex,
      start: piece.start, end: piece.start + end, quote: piece.text.slice(0, end),
    }] }] : [],
  };
}
export function semanticTestEnvelope(value: unknown, overrides: Record<string, unknown> = {}) {
  return { model: semanticTestConfig().model, status: 'completed',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150,
      input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } },
    ...overrides,
  };
}

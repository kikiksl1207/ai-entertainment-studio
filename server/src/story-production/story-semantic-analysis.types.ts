export const SEMANTIC_PIPELINE = 'semantic_extraction_v1';
export const SEMANTIC_KINDS = ['scene', 'background', 'entity', 'event', 'foreshadow', 'payoff', 'style'] as const;
export const STYLE_CATEGORIES = ['dialogue', 'description', 'narrative_voice', 'sentence_rhythm', 'imagery'] as const;
export type SourceRef = { partIndex: number; partKey: string; paragraphIndex: number; start: number; end: number };
export type SourcePiece = SourceRef & { text: string; kind: string };
export type SourceCursor = { part: number; paragraph: number; offset: number };
export type SemanticInput = {
  manuscriptVersionId: string; contentHash: string; locale: string; pieces: SourcePiece[];
};
export type SemanticCitation = SourceRef & { quoteHash: string };
export type SemanticEvidence = {
  kind: typeof SEMANTIC_KINDS[number];
  title: string;
  observation: string;
  styleCategory: typeof STYLE_CATEGORIES[number] | null;
  citations: SemanticCitation[];
};
export type SemanticUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number };
export type SemanticResult = { evidence: SemanticEvidence[]; usage: SemanticUsage; discardedEvidenceCount?: number };
export class SemanticAnalysisError extends Error {
  constructor(
    readonly code: string,
    readonly outcome: 'not_dispatched' | 'known_rejected' | 'unknown' | 'received' = 'not_dispatched',
    readonly usage?: SemanticUsage,
  ) { super(code); this.name = 'SemanticAnalysisError'; }
}

import { semanticConfigFailure, type SemanticConfig } from './story-semantic-analysis.config';
import { semanticRequest } from './story-semantic-analysis.schema';
import { inputBudget, boundary, sha256 } from './story-semantic-analysis.source';
import { SEMANTIC_KINDS, STYLE_CATEGORIES, SemanticAnalysisError,
  type SemanticEvidence, type SemanticInput, type SemanticUsage, type SemanticResult } from './story-semantic-analysis.types';

export type SemanticTransport = (url: string, init: RequestInit) => Promise<Response>;
export class SemanticAnalysisProvider {
  readonly config: Readonly<SemanticConfig>;
  constructor(config: SemanticConfig, private readonly transport: SemanticTransport = (url, init) => fetch(url, init)) {
    this.config = Object.freeze({ ...config });
  }
  async readiness() {
    const reason = semanticConfigFailure(this.config);
    return { enabled: !reason, reason };
  }
  preflight(input: SemanticInput) {
    const reason = semanticConfigFailure(this.config);
    if (reason) throw new SemanticAnalysisError(reason);
    if (inputBudget(input, this.config) > this.config.inputTokenLimit)
      throw new SemanticAnalysisError('analysis_input_bound_exceeded');
  }
  async generate(input: SemanticInput, signal: AbortSignal): Promise<SemanticResult> {
    this.preflight(input);
    if (signal.aborted) throw new SemanticAnalysisError('analysis_cancelled');
    const controller = new AbortController();
    let rejectAbort!: (error: Error) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => { rejectAbort(new SemanticAnalysisError('provider_outcome_unknown', 'unknown')); controller.abort(); };
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.config.timeoutMs);
    try {
      return await Promise.race([this.send(input, controller.signal), aborted]);
    } catch (error) {
      if (error instanceof SemanticAnalysisError) throw error;
      throw new SemanticAnalysisError('provider_outcome_unknown', 'unknown');
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); }
  }
  private async send(input: SemanticInput, signal: AbortSignal): Promise<SemanticResult> {
    const response = await this.transport('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(semanticRequest(input, this.config)),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new SemanticAnalysisError(response.status === 429 ? 'provider_rate_limited' : 'provider_http_failed',
        response.status === 408 || response.status >= 500 ? 'unknown' : 'known_rejected');
    }
    let usage: SemanticUsage | undefined;
    try {
      const envelope = record(JSON.parse(await boundedResponse(response, signal)));
      usage = parseUsage(envelope.usage);
      if (usage.inputTokens > this.config.inputTokenLimit || usage.outputTokens > this.config.outputTokenLimit)
        throw new Error();
      if (envelope.model !== this.config.model || !Array.isArray(envelope.output)) throw new Error();
      const texts: string[] = [];
      for (const item of envelope.output) {
        const message = record(item);
        if (message.type === 'reasoning') continue;
        if (message.type !== 'message' || message.role !== 'assistant' || !Array.isArray(message.content)) throw new Error();
        for (const item of message.content) {
          const content = record(item);
          if (content.type === 'refusal') throw new SemanticAnalysisError('provider_refusal', 'received', usage);
          if (content.type !== 'output_text' || typeof content.text !== 'string') throw new Error();
          texts.push(content.text);
        }
        if (message.status !== 'completed') throw new Error();
      }
      if (envelope.status !== 'completed' || texts.length !== 1 || Buffer.byteLength(texts[0]) > 100000) throw new Error();
      return { evidence: validateSemanticEvidence(JSON.parse(texts[0]), input), usage };
    } catch (error) {
      if (error instanceof SemanticAnalysisError && error.code === 'provider_refusal') throw error;
      throw new SemanticAnalysisError('provider_output_invalid', 'received', usage);
    }
  }
}
export function validateSemanticEvidence(value: unknown, input: SemanticInput): SemanticEvidence[] {
  const root = exact(value, ['manuscriptVersionId', 'contentHash', 'evidence']);
  if (root.manuscriptVersionId !== input.manuscriptVersionId || root.contentHash !== input.contentHash ||
    !Array.isArray(root.evidence) || root.evidence.length > 64) throw new Error('analysis_citation_invalid');
  return root.evidence.map(value => {
    const item = exact(value, ['kind', 'title', 'observation', 'styleCategory', 'citations']);
    const title = semanticPlainText(item.title, 120), observation = semanticPlainText(item.observation, 1200);
    if (title === null || observation === null) throw new Error('analysis_observation_invalid');
    if (!SEMANTIC_KINDS.includes(item.kind as never) ||
      (item.kind === 'style' ? !STYLE_CATEGORIES.includes(item.styleCategory as never) : item.styleCategory !== null) ||
      !Array.isArray(item.citations) || item.citations.length < 1 || item.citations.length > 4) throw new Error('analysis_citation_invalid');
    const citations = item.citations.map(value => {
      const cite = exact(value, ['partIndex', 'partKey', 'paragraphIndex', 'start', 'end', 'quote']);
      if (typeof cite.quote !== 'string' || cite.quote.length < 1 || cite.quote.length > 512 ||
        !Number.isSafeInteger(cite.start) || !Number.isSafeInteger(cite.end) ||
        Number(cite.end) <= Number(cite.start)) throw new Error('analysis_citation_invalid');
      const candidates = input.pieces.filter(piece => piece.partIndex === cite.partIndex && piece.partKey === cite.partKey &&
        piece.paragraphIndex === cite.paragraphIndex);
      const direct = candidates.find(piece => Number(cite.start) >= piece.start && Number(cite.end) <= piece.end &&
        boundary(piece.text, Number(cite.start) - piece.start) && boundary(piece.text, Number(cite.end) - piece.start) &&
        piece.text.slice(Number(cite.start) - piece.start, Number(cite.end) - piece.start) === cite.quote);
      let piece = direct;
      let start = Number(cite.start), end = Number(cite.end);
      if (!piece) {
        // Models sometimes report the paragraph boundary instead of the quoted
        // span. Recover only a unique exact quote inside the cited source piece.
        const matches = candidates.flatMap(candidate => {
          if (Number(cite.start) < candidate.start - 16 || Number(cite.start) > candidate.end + 16 ||
            Number(cite.end) < candidate.start - 16 || Number(cite.end) > candidate.end + 16) return [];
          const offset = candidate.text.indexOf(cite.quote as string);
          return offset >= 0 && candidate.text.indexOf(cite.quote as string, offset + 1) < 0 &&
            boundary(candidate.text, offset) && boundary(candidate.text, offset + (cite.quote as string).length)
            ? [{ candidate, start: candidate.start + offset }] : [];
        });
        if (matches.length !== 1) throw new Error('analysis_citation_invalid');
        const match = matches[0];
        piece = match.candidate;
        start = match.start;
        end = start + cite.quote.length;
      }
      return { partIndex: piece.partIndex, partKey: piece.partKey, paragraphIndex: piece.paragraphIndex,
        start, end, quoteHash: sha256(cite.quote) };
    });
    return { kind: item.kind as SemanticEvidence['kind'], title, observation,
      styleCategory: item.styleCategory as SemanticEvidence['styleCategory'], citations };
  });
}
async function boundedResponse(response: Response, signal: AbortSignal) {
  if (!response.body || Number(response.headers.get('content-length')) > 256000) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error();
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw new Error();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256000) throw new Error();
      parts.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } finally { signal.removeEventListener('abort', cancel); cancel(); }
}
// Content is never interpreted as HTML, a template, a URL, or an instruction.
// This is a bounded text/citation validator, not a factual truth verifier.
export function semanticPlainText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
    /[\u0000-\u0008\u000B-\u001F\u007F]/.test(value) || /<\/?[A-Za-z][^>]*>|```/.test(value)) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return null;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
  }
  return value;
}
function parseUsage(value: unknown): SemanticUsage {
  const usage = record(value);
  const inputTokens = count(usage.input_tokens), outputTokens = count(usage.output_tokens);
  const cachedInputTokens = count(record(usage.input_tokens_details).cached_tokens);
  const reasoningTokens = count(record(usage.output_tokens_details).reasoning_tokens);
  if (cachedInputTokens > inputTokens || reasoningTokens > outputTokens || count(usage.total_tokens) !== inputTokens + outputTokens) throw new Error();
  return { inputTokens, outputTokens, cachedInputTokens, reasoningTokens };
}
function count(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(); return value as number; }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
function exact(value: unknown, keys: string[]) {
  const object = record(value);
  if (Object.keys(object).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(object, key))) throw new Error();
  return object;
}

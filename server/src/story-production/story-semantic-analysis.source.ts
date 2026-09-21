import { createHash } from 'crypto';
import { manuscriptContentHash, type ManuscriptPart } from './story-production.policy';
import { storyContinuationInputTokenBudget } from './story-continuation-tokenizer';
import { semanticPackingProfile, type SemanticPins } from './story-semantic-analysis.config';
import { semanticRequest } from './story-semantic-analysis.schema';
import { SemanticAnalysisError, type SemanticInput, type SourceCursor, type SourcePiece, type SourceRef } from './story-semantic-analysis.types';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export function sourceParts(body: unknown): ManuscriptPart[] {
  const parts = (body as { parts?: ManuscriptPart[] })?.parts;
  if (!Array.isArray(parts) || !parts.length) throw new SemanticAnalysisError('analysis_source_invalid');
  const keys = new Set<string>();
  for (const part of parts) {
    if (!part || typeof part.partKey !== 'string' || !part.partKey || part.partKey.length > 120 || keys.has(part.partKey) ||
      !Array.isArray(part.paragraphs)) throw new SemanticAnalysisError('analysis_source_invalid');
    keys.add(part.partKey);
    for (const paragraph of part.paragraphs) if (!paragraph || typeof paragraph.text !== 'string' ||
      !['paragraph', 'dialogue', 'title', 'scene_break'].includes(paragraph.kind))
      throw new SemanticAnalysisError('analysis_source_invalid');
  }
  return parts;
}
export function boundary(text: string, offset: number) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length &&
    !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
}
export function pieceFor(parts: ManuscriptPart[], ref: SourceRef): SourcePiece {
  const part = parts[ref.partIndex];
  const paragraph = part?.paragraphs[ref.paragraphIndex];
  if (!part || part.partKey !== ref.partKey || !paragraph ||
    !boundary(paragraph.text, ref.start) || !boundary(paragraph.text, ref.end) || ref.end < ref.start)
    throw new SemanticAnalysisError('analysis_source_reference_invalid');
  return { ...ref, kind: paragraph.kind, text: paragraph.text.slice(ref.start, ref.end) };
}
export const inputBudget = (input: SemanticInput, pins: SemanticPins) =>
  storyContinuationInputTokenBudget(semanticRequest(input, pins));

export function nextSourceChunk(
  parts: ManuscriptPart[], cursor: SourceCursor, identity: Omit<SemanticInput, 'pieces'>,
  pins: SemanticPins, measure = inputBudget,
) {
  const framed = semanticPackingProfile(pins) !== 'legacy_32';
  let { part: p, paragraph: n, offset } = cursor;
  const pieces: SourcePiece[] = [];
  let chars = 0;
  // A character target only bounds planning work; the complete framed request is
  // then tokenized, including schema/instructions and the shared 10%+256 buffer.
  const target = framed ? 12000 : Math.min(12000, pins.inputTokenLimit);
  while (p < parts.length && pieces.length < (framed ? 256 : 32) && chars < target) {
    const part = parts[p];
    if (n >= part.paragraphs.length) { p++; n = 0; offset = 0; continue; }
    const text = part.paragraphs[n].text;
    if (!boundary(text, offset)) throw new SemanticAnalysisError('analysis_cursor_invalid');
    let end = Math.min(text.length, offset + (framed ? target - chars : Math.max(2, target - chars)));
    if (!boundary(text, end)) end--;
    if (framed && end === offset && offset < text.length) break;
    const piece = pieceFor(parts, { partIndex: p, partKey: part.partKey, paragraphIndex: n, start: offset, end });
    pieces.push(piece); chars += piece.text.length;
    if (end === text.length) { n++; offset = 0; } else { offset = end; break; }
  }
  if (!pieces.length) return null;
  let tokens = measure({ ...identity, pieces }, pins);
  if (framed && tokens > pins.inputTokenLimit) {
    const fitted = fitFramedPrefix(parts, pieces, identity, pins, measure);
    pieces.splice(0, pieces.length, ...fitted.pieces);
    tokens = fitted.tokens;
  }
  while (!framed && tokens > pins.inputTokenLimit && pieces.length > 1) {
    pieces.splice(Math.ceil(pieces.length / 2));
    tokens = measure({ ...identity, pieces }, pins);
  }
  if (tokens > pins.inputTokenLimit) {
    const original = pieces[0];
    const text = parts[original.partIndex].paragraphs[original.paragraphIndex].text;
    let end = original.end;
    while (tokens > pins.inputTokenLimit && end > original.start) {
      let smaller = original.start + Math.floor((end - original.start) / 2);
      if (!boundary(text, smaller)) smaller--;
      if (smaller <= original.start) {
        smaller = original.start + 1;
        if (!boundary(text, smaller)) smaller++;
      }
      if (smaller >= end) throw new SemanticAnalysisError('analysis_input_budget_too_small');
      end = smaller;
      pieces[0] = pieceFor(parts, { ...original, end });
      tokens = measure({ ...identity, pieces }, pins);
    }
    if (end <= original.start) throw new SemanticAnalysisError('analysis_input_budget_too_small');
  }
  const last = pieces[pieces.length - 1];
  const full = last.end === parts[last.partIndex].paragraphs[last.paragraphIndex].text.length;
  const next = { part: last.partIndex, paragraph: last.paragraphIndex + (full ? 1 : 0), offset: full ? 0 : last.end };
  while (next.part < parts.length && next.paragraph >= parts[next.part].paragraphs.length) {
    next.part++; next.paragraph = 0; next.offset = 0;
  }
  return {
    refs: pieces.map(({ text: _text, kind: _kind, ...ref }) => ref),
    sourceHash: manuscriptContentHash(pieces), inputTokens: tokens, next,
    completedParagraphs: pieces.filter(piece => piece.end === parts[piece.partIndex].paragraphs[piece.paragraphIndex].text.length).length,
    done: next.part === parts.length,
  };
}

function fitFramedPrefix(
  parts: ManuscriptPart[], candidates: SourcePiece[], identity: Omit<SemanticInput, 'pieces'>,
  pins: SemanticPins, measure: typeof inputBudget,
) {
  let low = 1, high = candidates.length - 1;
  let accepted: { pieces: SourcePiece[]; tokens: number } | undefined;
  // At most eight prefix probes for 256 pieces. Token counts are not assumed
  // perfectly monotone: only an actually measured fitting prefix is accepted.
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const pieces = candidates.slice(0, count);
    const tokens = measure({ ...identity, pieces }, pins);
    if (tokens <= pins.inputTokenLimit) { accepted = { pieces, tokens }; low = count + 1; }
    else high = count - 1;
  }
  if (accepted) return accepted;

  const first = candidates[0];
  const text = parts[first.partIndex].paragraphs[first.paragraphIndex].text;
  low = first.start + 1;
  high = first.end - 1;
  // A single long paragraph gets at most fourteen UTF-16 probes (12k units).
  // Empty references cannot be discarded even if framing alone does not fit.
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const end = boundary(text, middle) ? middle : middle - 1;
    if (end <= first.start) { low = middle + 1; continue; }
    const pieces = [pieceFor(parts, { ...first, end })];
    const tokens = measure({ ...identity, pieces }, pins);
    if (tokens <= pins.inputTokenLimit) { accepted = { pieces, tokens }; low = middle + 1; }
    else high = middle - 1;
  }
  if (!accepted) throw new SemanticAnalysisError('analysis_input_budget_too_small');
  return accepted;
}

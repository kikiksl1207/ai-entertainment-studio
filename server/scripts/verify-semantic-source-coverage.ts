// Offline only: no application bootstrap, DB, provider, file writes, or source output.
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { getEncoding } from 'js-tiktoken';
import { PayloadTooLargeException } from '@nestjs/common';
import { PASTED_MANUSCRIPT_IDENTITY_VERSION, prepareManuscript, preparePastedManuscript, storedManuscriptBody } from '../src/story-production/story-manuscript-file.policy';
import { manuscriptContentHash } from '../src/story-production/story-production.policy';
import { SEMANTIC_PACKING_PROFILE, semanticReservation, type SemanticPins } from '../src/story-production/story-semantic-analysis.config';
import { semanticRequest } from '../src/story-production/story-semantic-analysis.schema';
import { boundary, inputBudget, nextSourceChunk, pieceFor } from '../src/story-production/story-semantic-analysis.source';
import { storyContinuationModelEncoding } from '../src/story-production/story-continuation-tokenizer';
import type { SourceCursor } from '../src/story-production/story-semantic-analysis.types';

const sources = {
  imjin: 'E:/LuminaStage_Audit/isunsin_next_seat_writer_revision/final_upload_first_person/upload_service_full_first_person.md',
  norse: 'E:/LuminaStage_Audit/norse_loki_paid_story_planning/05_final/service_upload_20260715/02_official_story_with_choices_full.md',
};
const intakeRoot = 'E:/CodexMovedCache/tmp/manuscript-intake-20260914/revision-2';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function requireSafe(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }

function main() {
  const started = performance.now();
  const name = process.argv[2] as keyof typeof sources;
  const mode = process.argv[3];
  const packingProfile = process.argv[4] ?? SEMANTIC_PACKING_PROFILE;
  requireSafe(Object.prototype.hasOwnProperty.call(sources, name) && ['body', 'lossless-paste'].includes(mode) &&
    [SEMANTIC_PACKING_PROFILE, 'legacy_32'].includes(packingProfile), 'invalid_offline_arguments');
  globalThis.fetch = async () => { throw new Error('offline_network_forbidden'); };
  const raw = readFileSync(sources[name]);
  const originalStat = statSync(sources[name]);
  const rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  const projectionBytes = readFileSync(`${intakeRoot}/${name}/analysis-input.json`);
  const report = JSON.parse(readFileSync(`${intakeRoot}/${name}/report.json`, 'utf8'));
  requireSafe(hash(raw) === report.primarySha256 && hash(projectionBytes) === report.analysisPayloadSha256, 'intake_source_hash_mismatch');
  const projection = prepareManuscript(projectionBytes);
  requireSafe(projection.locale === 'ko', 'source_locale_mismatch');

  // Verify each imported body quote against the authoritative primary in order.
  // These are body-only projections: metadata/choices excluded by the existing
  // intake converter are NOT claimed covered by this check.
  const primary = rawText.replace(/\r\n/g, '\n');
  let at = 0;
  for (const part of projection.parts) for (const paragraph of part.paragraphs) {
    const quote = paragraph.text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '');
    requireSafe(quote.length > 0, 'empty_imported_quote');
    const found = primary.indexOf(quote, at);
    requireSafe(found >= at, 'imported_quote_missing_or_reordered');
    at = found + quote.length;
  }

  let prepared = projection, currentIntakeSupported = true;
  if (mode === 'lossless-paste') {
    // Offline hypothetical intake only; this generated boundary manifest is not
    // author approval and is never uploaded. The first part retains the preamble.
    const headings = Array.from(rawText.matchAll(/^# Part (\d+)\s*[-:]\s*([^\r\n]+)$/gm));
    requireSafe(headings.length > 0, 'source_boundaries_missing');
    const boundaries = headings.map((heading, index) => ({ partKey: `offline-part-${index}`, title: `Offline part ${index}`,
      start: index ? heading.index! : 0, end: headings[index + 1]?.index ?? rawText.length }));
    try {
      prepared = preparePastedManuscript(raw, JSON.stringify({ locale: projection.locale, confirmed: true, parts: boundaries }));
      storedManuscriptBody(prepared);
    } catch (error) {
      if (!(error instanceof PayloadTooLargeException)) throw error;
      // Hypothetical coverage remains useful for a rejected book, but never
      // represent per-part parsing as a successful whole-book admission.
      currentIntakeSupported = false;
      const parts = boundaries.flatMap(part => {
        const text = rawText.slice(part.start, part.end);
        return preparePastedManuscript(Buffer.from(text), JSON.stringify({ locale: projection.locale, confirmed: true,
          parts: [{ ...part, start: 0, end: text.length }] })).parts;
      });
      prepared = { ...projection, parts, paragraphCount: parts.reduce((count, part) => count + part.paragraphs.length, 0),
        contentHash: manuscriptContentHash({ identityVersion: PASTED_MANUSCRIPT_IDENTITY_VERSION, locale: projection.locale, parts, sourceSha256: hash(raw) }),
        source: { kind: 'utf8_paste', rawText, sha256: hash(raw), byteLength: raw.length }, confirmedBoundaries: boundaries };
    }
    requireSafe(hash(prepared.parts.flatMap(part => part.paragraphs.map(paragraph => paragraph.text)).join('')) === hash(raw), 'lossless_source_coverage_failed');
  }
  // Illustrative local costing, not a production rate card or deployment config.
  const pins: SemanticPins = { provider: 'openai', model: 'gpt-4o-mini-2024-07-18',
    ...(packingProfile === 'legacy_32' ? {} : { packingProfile: SEMANTIC_PACKING_PROFILE }),
    rateCardId: '11111111-1111-4111-8111-111111111111', rateCardVersion: 'offline-illustrative',
    inputKrwPerMillion: '1000', cachedInputKrwPerMillion: '500', outputKrwPerMillion: '2000',
    inputTokenLimit: 8192, outputTokenLimit: 2048, maxJobInputTokens: 10000000,
    maxJobOutputTokens: 10000000, maxJobCostKrw: '100000' };
  requireSafe(storyContinuationModelEncoding(pins.model) === 'o200k_base', 'model_encoding_unknown');
  const tokenizer = getEncoding('o200k_base');
  const identity = { manuscriptVersionId: '22222222-2222-4222-8222-222222222222', contentHash: prepared.contentHash, locale: prepared.locale };
  let cursor: SourceCursor = { part: 0, paragraph: 0, offset: 0 };
  let expected = { ...cursor }, chunks = 0, completed = 0, emptyOnly = 0, tiny = 0, framedInputTokens = 0, inputReservation = 0;
  let plannerTokenizationProbes = 0, minimumTextUnits = Infinity, maximumTextUnits = 0, maximumPieces = 0;
  const coverageHash = createHash('sha256');
  while (true) {
    const chunk = nextSourceChunk(prepared.parts, cursor, identity, pins, input => {
      plannerTokenizationProbes++;
      const framedTokens = tokenizer.encode(JSON.stringify(semanticRequest(input, pins)), [], []).length;
      return Math.ceil(framedTokens * 1.1) + 256;
    });
    if (!chunk) break;
    const pieces = chunk.refs.map(ref => pieceFor(prepared.parts, ref));
    // Prefix search may end with a rejected probe, so measure the accepted
    // request independently rather than counting whichever probe ran last.
    const acceptedFramedTokens = tokenizer.encode(JSON.stringify(semanticRequest({ ...identity, pieces }, pins)), [], []).length;
    requireSafe(Math.ceil(acceptedFramedTokens * 1.1) + 256 === chunk.inputTokens && chunk.inputTokens <= pins.inputTokenLimit, 'accepted_token_budget_mismatch');
    if (!chunks) requireSafe(chunk.inputTokens === inputBudget({ ...identity, pieces }, pins), 'token_measure_mismatch');
    requireSafe(manuscriptContentHash(pieces) === chunk.sourceHash, 'chunk_hash_mismatch');
    let textUnits = 0, nonWhitespaceUnits = 0;
    for (const piece of pieces) {
      requireSafe(piece.partIndex === expected.part && piece.paragraphIndex === expected.paragraph && piece.start === expected.offset, 'coverage_gap_or_overlap');
      const paragraph = prepared.parts[piece.partIndex].paragraphs[piece.paragraphIndex];
      requireSafe(boundary(paragraph.text, piece.start) && boundary(paragraph.text, piece.end), 'surrogate_split');
      textUnits += piece.text.length; nonWhitespaceUnits += piece.text.replace(/\s/g, '').length;
      coverageHash.update(piece.text);
      expected.offset = piece.end;
      if (piece.end === paragraph.text.length) { expected.paragraph++; expected.offset = 0; }
      while (expected.part < prepared.parts.length && expected.paragraph === prepared.parts[expected.part].paragraphs.length) {
        expected.part++; expected.paragraph = 0;
      }
    }
    chunks++; completed += chunk.completedParagraphs; framedInputTokens += acceptedFramedTokens; inputReservation += chunk.inputTokens;
    maximumPieces = Math.max(maximumPieces, pieces.length);
    if (!nonWhitespaceUnits) emptyOnly++;
    else if (nonWhitespaceUnits < 256) tiny++;
    minimumTextUnits = Math.min(minimumTextUnits, textUnits); maximumTextUnits = Math.max(maximumTextUnits, textUnits);
    cursor = chunk.next;
  }
  requireSafe(expected.part === prepared.parts.length && completed === prepared.paragraphCount, 'coverage_incomplete');
  const projectedHash = hash(prepared.parts.flatMap(part => part.paragraphs.map(paragraph => paragraph.text)).join(''));
  requireSafe(coverageHash.digest('hex') === projectedHash, 'coverage_hash_mismatch');
  requireSafe(hash(readFileSync(sources[name])) === hash(raw) && statSync(sources[name]).mtimeMs === originalStat.mtimeMs, 'source_modified');
  const outputReservation = chunks * pins.outputTokenLimit;
  const cost = semanticReservation(pins, inputReservation, outputReservation, chunks);
  let rawPhysicalLines = 0, rawBlankPhysicalLines = 0;
  for (const match of rawText.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) if (match[0]) {
    rawPhysicalLines++;
    if (/^[ \t\r\n]*$/.test(match[0])) rawBlankPhysicalLines++;
  }
  console.log(JSON.stringify({ name, scope: mode === 'body' ? 'existing_intake_body_only' : 'hypothetical_lossless_paste_not_author_approved',
    sourceLocale: prepared.locale, currentIntakeSupported, packingProfile,
    intakeIdentityVersion: mode === 'body' ? 2 : PASTED_MANUSCRIPT_IDENTITY_VERSION,
    intakeUnsupportedReason: currentIntakeSupported ? null : 'current_intake_size_limit',
    sourceSha256: hash(raw), intakeSha256: hash(projectionBytes), projectedTextSha256: projectedHash,
    sourceBytes: raw.length, sourceUtf16: rawText.length, projectedUtf16: prepared.parts.reduce((sum, part) => sum + part.paragraphs.reduce((n, p) => n + p.text.length, 0), 0),
    parts: prepared.parts.length, paragraphs: prepared.paragraphCount, completedParagraphs: completed,
    rawPhysicalLines, rawBlankPhysicalLines, contentHash: prepared.contentHash,
    chunks, emptyOnlyChunks: emptyOnly, tinyNonemptyChunksUnder256NonWhitespaceUtf16: tiny, minimumTextUnits, maximumTextUnits,
    framedInputTokens, reservedInputTokensIncludingBuffer: inputReservation, reservedOutputTokens: outputReservation,
    maximumPieces, plannerTokenizationProbes, elapsedSeconds: (performance.now() - started) / 1000,
    illustrativeReservedCostKrw: cost.toString(), wholeJobCapSupported: inputReservation <= pins.maxJobInputTokens &&
      outputReservation <= pins.maxJobOutputTokens && cost.lte(pins.maxJobCostKrw),
    productionBudgetSupported: 'unknown', exactCoverage: true, sourceUnchanged: true, paidCalls: 0,
    semanticQualityEvaluated: false, memoryQualityEvaluated: false }));
}
try { main(); } catch { console.error(JSON.stringify({ ok: false, code: 'offline_coverage_validation_failed', paidCalls: 0 })); process.exitCode = 1; }

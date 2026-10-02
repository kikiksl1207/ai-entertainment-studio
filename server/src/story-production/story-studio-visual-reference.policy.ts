import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { publicationVisualReferenceData } from './story-approved-visual.policy';
import { readerPartText } from './story-studio-reader-text.policy';
import { PublicationVisualSceneBinding } from './story-publication-visual-binding.policy';

type Identity = { workId: string; manuscriptVersionId: string; manuscriptHash: string };
type SourcePrompt = { sourceSceneKey: string; promptText: string; promptSha256: string };
type Source = { prompts: SourcePrompt[]; sceneBindings?: unknown };
type ReaderPart = { partKey: string; segments: string[] };
const hashPattern = /^[a-f0-9]{64}$/;

function invalid(): never {
  throw new BadRequestException({ code: 'STUDIO_VISUAL_REFERENCE_QUERY_INVALID' });
}

function context(body: unknown, identity: Identity, expectedManuscriptHash: string, expectedSourceChecksum: string) {
  if (!hashPattern.test(expectedManuscriptHash) || !hashPattern.test(expectedSourceChecksum)) invalid();
  if (identity.manuscriptHash !== expectedManuscriptHash) {
    throw new ConflictException({ code: 'STUDIO_VISUAL_REFERENCE_SOURCE_CHANGED' });
  }
  const reference = publicationVisualReferenceData(body, identity.manuscriptHash);
  if (!reference) throw new NotFoundException({ code: 'STUDIO_VISUAL_REFERENCE_NOT_FOUND' });
  if (reference.checksum !== expectedSourceChecksum) {
    throw new ConflictException({ code: 'STUDIO_VISUAL_REFERENCE_SOURCE_CHANGED' });
  }
  const source = (body as { publicationVisualSource: Source }).publicationVisualSource;
  const bindings = reference.bindings;
  return { source, bindings, common: { ...identity, checksum: reference.checksum,
    approvalState: 'reference_only' as const, requiresSceneReview: true as const,
    mappingState: bindings ? 'exact_source_segments' as const : 'unmapped_legacy' as const } };
}

function bounded<T>(value: T, maximum: number): T {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maximum) {
    throw new ConflictException({ code: 'STUDIO_VISUAL_REFERENCE_RESPONSE_TOO_LARGE' });
  }
  return value;
}

export function studioVisualReferenceReaderRange(body: unknown, binding: PublicationVisualSceneBinding) {
  const projection = (body as { publicationReaderProjection: { parts: ReaderPart[] } }).publicationReaderProjection;
  const part = projection.parts.find(item => item.partKey === binding.partKey)!;
  // Intersect the exact contiguous source range with the heading-normalized reader text.
  const full = part.segments.join('\n\n');
  const removedPrefix = full.length - readerPartText(full, binding.partTitle).length;
  const first = binding.segmentIndexes[0];
  const start = part.segments.slice(0, first).reduce((total, text) => total + text.length + 2, 0);
  const length = binding.segmentIndexes.reduce((total, index) => total + part.segments[index].length, 0) +
    (binding.segmentIndexes.length - 1) * 2;
  return full.slice(Math.max(start, removedPrefix), start + length);
}

export function studioVisualReferencePage(body: unknown, identity: Identity,
  expectedManuscriptHash: string, expectedSourceChecksum: string, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2000) invalid();
  const { source, bindings, common } = context(body, identity, expectedManuscriptHash, expectedSourceChecksum);
  if (offset > 0 && offset >= source.prompts.length) invalid();
  const items = source.prompts.slice(offset, offset + 8).map((prompt, index) => {
    const binding = bindings?.[offset + index];
    return { referenceIndex: offset + index, sourceSceneKey: prompt.sourceSceneKey,
      promptSha256: prompt.promptSha256, partKey: binding?.partKey ?? null,
      partTitle: binding?.partTitle ?? null, segmentCount: binding?.segmentIndexes.length ?? 0 };
  });
  return bounded({ contract: 'publication-visual-reference-page-v1' as const, ...common,
    totalReferences: source.prompts.length, offset,
    nextOffset: offset + items.length < source.prompts.length ? offset + items.length : null, items }, 64 * 1024);
}

export function studioVisualReferenceDetail(body: unknown, identity: Identity,
  expectedManuscriptHash: string, expectedSourceChecksum: string, referenceIndex: number, textOffset = 0) {
  if (!Number.isSafeInteger(referenceIndex) || referenceIndex < 0 || referenceIndex >= 2000 ||
      !Number.isSafeInteger(textOffset) || textOffset < 0) invalid();
  const { source, bindings, common } = context(body, identity, expectedManuscriptHash, expectedSourceChecksum);
  const prompt = source.prompts[referenceIndex];
  if (!prompt) throw new NotFoundException({ code: 'STUDIO_VISUAL_REFERENCE_NOT_FOUND' });
  const binding = bindings?.[referenceIndex];
  let reader: { partKey: string; partTitle: string; segmentCount: number; text: string;
    textOffset: number; nextTextOffset: number | null; totalTextLength: number } | null = null;
  if (binding) {
    const text = studioVisualReferenceReaderRange(body, binding);
    // Offsets are UTF-16 code units; an entirely omitted heading has one empty page.
    if ((textOffset > 0 && textOffset >= text.length) || (textOffset > 0 && /[\uDC00-\uDFFF]/u.test(text[textOffset]) &&
        /[\uD800-\uDBFF]/u.test(text[textOffset - 1]))) invalid();
    let end = Math.min(textOffset + 6000, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
    reader = { partKey: binding.partKey, partTitle: binding.partTitle, segmentCount: binding.segmentIndexes.length,
      text: text.slice(textOffset, end), textOffset, nextTextOffset: end < text.length ? end : null,
      totalTextLength: text.length };
  } else if (textOffset !== 0) invalid();
  return bounded({ contract: 'publication-visual-reference-detail-v1' as const, ...common,
    referenceIndex, sourceSceneKey: prompt.sourceSceneKey, promptSha256: prompt.promptSha256,
    promptText: prompt.promptText, reader }, 256 * 1024);
}

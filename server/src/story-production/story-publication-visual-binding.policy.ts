import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { releaseChecksum } from './story-lifecycle.policy';
import { ManuscriptPart } from './story-production.policy';
import { publicationReaderProjection, publicationReaderText } from './story-publication-reader-projection.policy';

type SourcePrompt = { sourceSceneKey: string; promptText: string; promptSha256: string };
type PlannedPart = { partKey: string; title: string; beats: Array<{ text: string; sourceSceneKey?: string }> };
type ReaderProjection = ReturnType<typeof publicationReaderProjection>;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
function invalid(): never {
  throw new ConflictException({ code: 'STORY_PUBLICATION_VISUAL_BINDING_INVALID',
    message: 'The original visual reference must identify one exact reader segment' });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function publicationVisualSceneBindings(manuscriptHash: string, sources: ManuscriptPart[],
  projection: ReaderProjection, planned: PlannedPart[], prompts: SourcePrompt[]) {
  if (projection.manuscriptHash !== manuscriptHash || projection.parts.length !== sources.length ||
      planned.length !== sources.length || prompts.length > 2000) invalid();
  const locations = new Map<string, Array<{ partIndex: number; segmentIndex: number }>>();
  planned.forEach((part, partIndex) => {
    if (part.partKey !== sources[partIndex].partKey || part.title !== sources[partIndex].title ||
        releaseChecksum(part.beats.map(beat => beat.text)) !== releaseChecksum(projection.parts[partIndex].segments)) invalid();
    part.beats.forEach((beat, segmentIndex) => {
      if (!beat.sourceSceneKey) return;
      const rows = locations.get(beat.sourceSceneKey) ?? [];
      rows.push({ partIndex, segmentIndex }); locations.set(beat.sourceSceneKey, rows);
    });
  });
  const body = { parts: sources, publicationReaderProjection: projection } as unknown as Prisma.JsonValue;
  const sourceHashes = new Map(sources.map(part => [part.partKey, releaseChecksum(part)]));
  const readerHashes = new Map(sources.map(part => [part.partKey,
    sha256(publicationReaderText(body, part, manuscriptHash))]));
  const seen = new Set<string>();
  return prompts.map(prompt => {
    const matches = locations.get(prompt.sourceSceneKey);
    if (seen.has(prompt.sourceSceneKey) || !matches?.length ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(prompt.sourceSceneKey) ||
        !prompt.promptText.trim() || prompt.promptText.length > 32000 || prompt.promptText.includes('\0') ||
        prompt.promptSha256 !== sha256(prompt.promptText)) invalid();
    seen.add(prompt.sourceSceneKey);
    const { partIndex } = matches[0];
    if (matches.some((match, index) => match.partIndex !== partIndex ||
        match.segmentIndex !== matches[0].segmentIndex + index)) invalid();
    const source = sources[partIndex];
    return { sourceSceneKey: prompt.sourceSceneKey, partKey: source.partKey, partTitle: source.title,
      sourcePartSha256: sourceHashes.get(source.partKey)!, readerPartSha256: readerHashes.get(source.partKey)!,
      segmentIndexes: matches.map(match => match.segmentIndex),
      segmentSha256s: matches.map(match => sha256(projection.parts[partIndex].segments[match.segmentIndex])),
      promptSha256: prompt.promptSha256 };
  });
}

export type PublicationVisualSceneBinding = ReturnType<typeof publicationVisualSceneBindings>[number];

export function verifiedPublicationVisualBindings(body: unknown, prompts: SourcePrompt[], bindings: unknown,
  expectedManuscriptHash?: string) {
  if (bindings === undefined) return null;
  const source = record(body), projection = record(source.publicationReaderProjection);
  if (!Array.isArray(source.parts) || !Array.isArray(projection.parts) ||
      projection.contract !== 'publication-reader-projection-v1' || typeof projection.manuscriptHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(projection.manuscriptHash) ||
      (expectedManuscriptHash !== undefined && projection.manuscriptHash !== expectedManuscriptHash) ||
      !Array.isArray(bindings) || bindings.length !== prompts.length) invalid();
  try {
    const sourceParts = source.parts;
    const byKey = new Map(projection.parts.map(raw => {
      const part = record(raw);
      if (typeof part.partKey !== 'string' || !Array.isArray(part.segments)) invalid();
      return [part.partKey, part];
    }));
    if (byKey.size !== projection.parts.length || source.parts.length !== byKey.size) invalid();
    const readerHashes = new Map<string, string>(), sourceHashes = new Map<string, string>();
    const originals = new Map<string, ManuscriptPart>();
    for (const raw of sourceParts) {
      const part = raw as ManuscriptPart;
      if (!part || typeof part.partKey !== 'string' || readerHashes.has(part.partKey)) invalid();
      readerHashes.set(part.partKey, sha256(publicationReaderText(source as Prisma.JsonValue, part, projection.manuscriptHash)));
      sourceHashes.set(part.partKey, releaseChecksum(part));
      originals.set(part.partKey, part);
    }
    const seen = new Set<string>(), usedSegments = new Set<string>();
    return prompts.map((prompt, index) => {
      const binding = record(bindings[index]);
      if (typeof binding.partKey !== 'string') invalid();
      const part = byKey.get(binding.partKey);
      const original = originals.get(binding.partKey);
      if (!part || !original || binding.sourceSceneKey !== prompt.sourceSceneKey || seen.has(prompt.sourceSceneKey) ||
          binding.partTitle !== original.title || binding.sourcePartSha256 !== sourceHashes.get(original.partKey) ||
          binding.readerPartSha256 !== readerHashes.get(original.partKey) || binding.promptSha256 !== prompt.promptSha256 ||
          !Array.isArray(binding.segmentIndexes) || !Array.isArray(binding.segmentSha256s) ||
          !binding.segmentIndexes.length || binding.segmentIndexes.length !== binding.segmentSha256s.length ||
          binding.segmentIndexes.length > 1000) invalid();
      binding.segmentIndexes.forEach((segmentIndex, index) => {
        if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 ||
            segmentIndex >= (part.segments as unknown[]).length ||
            segmentIndex !== Number((binding.segmentIndexes as unknown[])[0]) + index ||
            (binding.segmentSha256s as unknown[])[index] !== sha256((part.segments as string[])[segmentIndex])) invalid();
        const segmentKey = JSON.stringify([binding.partKey, segmentIndex]);
        if (usedSegments.has(segmentKey)) invalid();
        usedSegments.add(segmentKey);
      });
      seen.add(prompt.sourceSceneKey);
      return binding as PublicationVisualSceneBinding;
    });
  } catch { invalid(); }
}

export function publicationVisualReferencePreview(body: unknown, manuscriptHash: string,
  checksum: string, prompts: SourcePrompt[], bindings: unknown) {
  const verified = verifiedPublicationVisualBindings(body, prompts, bindings, manuscriptHash);
  const preview = { contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only',
    manuscriptHash, checksum, totalReferences: prompts.length, mappedReferences: verified?.length ?? 0,
    mappingState: verified ? 'exact_source_segments' : 'unmapped_legacy', requiresSceneReview: true,
    items: [] as Array<Record<string, unknown>>, truncated: prompts.length > 0 };
  for (const [index, prompt] of prompts.slice(0, 8).entries()) {
    const excerpt = Array.from(prompt.promptText).slice(0, 1000).join('');
    preview.items.push({ sourceSceneKey: prompt.sourceSceneKey, promptSha256: prompt.promptSha256,
      promptExcerpt: excerpt, promptTruncated: excerpt !== prompt.promptText,
      ...(verified ? { binding: verified[index] } : {}) });
    if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > 64 * 1024) { preview.items.pop(); break; }
  }
  preview.truncated = prompts.length > preview.items.length;
  return preview;
}

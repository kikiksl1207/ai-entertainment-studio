import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ManuscriptPart } from './story-production.policy';
import { readerPartText } from './story-studio-reader-text.policy';
import { releaseChecksum } from './story-lifecycle.policy';

const contract = 'publication-reader-projection-v1';
const hash = (part: ManuscriptPart) => releaseChecksum(part);
const compact = (text: string) => text.replace(/\s+/gu, '');
function invalid(): never { throw new ConflictException({ code: 'STORY_PUBLICATION_READER_PROJECTION_INVALID' }); }

function checkedText(source: ManuscriptPart, segments: unknown): string {
  if (!Array.isArray(segments) || !segments.length || segments.length > 1000) invalid();
  const raw = source.paragraphs.map(row => row.text).join('');
  const fragments = segments.map(text => {
    if (typeof text !== 'string' || !text.trim()) invalid();
    return compact(text);
  });
  const ordered = (original: string) => {
    let cursor = 0;
    for (const fragment of fragments) {
      const at = original.indexOf(fragment, cursor);
      if (at < 0) return false;
      cursor = at + fragment.length;
    }
    return true;
  };
  // Plain manuscripts may retain scene markers; imported projections may omit them.
  if (!ordered(compact(raw)) && !ordered(compact(raw.replace(/^\[장면 [1-9]\d*\][\t ]*(?:\r?\n|\r|$)/gm, '')))) invalid();
  return readerPartText(segments.join('\n\n'), source.title);
}

export function publicationReaderProjection(manuscriptHash: string, sources: ManuscriptPart[],
  planParts: Array<{ partKey: string; title: string; beats: Array<{ text: string }> }>) {
  if (!Array.isArray(sources) || !Array.isArray(planParts) || sources.length !== planParts.length ||
      !sources.length || new Set(sources.map(source => source?.partKey)).size !== sources.length) invalid();
  const parts = sources.map((source, index) => {
    const planned = planParts[index];
    if (!source || !planned || planned.partKey !== source.partKey || planned.title !== source.title ||
        !Array.isArray(planned.beats) || planned.beats.some(beat => !beat || typeof beat.text !== 'string')) invalid();
    const segments = planned.beats.map(beat => beat.text);
    checkedText(source, segments);
    return { partKey: source.partKey, title: source.title, sourcePartSha256: hash(source), segments };
  });
  return { contract, manuscriptHash, parts };
}

// Only server-created projections may omit Markdown packaging/production notes.
// Every retained segment must still occur, in order, in its exact source part.
export function publicationReaderText(body: Prisma.JsonValue, source: ManuscriptPart,
  manuscriptHash: string): string {
  const record = body as Record<string, unknown>;
  if (!record || typeof record !== 'object' || Array.isArray(record)) invalid();
  if (!Object.prototype.hasOwnProperty.call(record, 'publicationReaderProjection')) {
    return readerPartText(source.paragraphs.map(row => row.text).join(''), source.title);
  }
  const projection = record.publicationReaderProjection as Record<string, unknown>;
  if (!projection || projection.contract !== contract || projection.manuscriptHash !== manuscriptHash ||
      !Array.isArray(projection.parts) || !Array.isArray(record.parts) ||
      projection.parts.length !== record.parts.length) invalid();
  const rows = projection.parts.filter((value): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      (value as Record<string, unknown>).partKey === source.partKey));
  if (rows.length !== 1 || rows[0].title !== source.title || rows[0].sourcePartSha256 !== hash(source)) invalid();
  return checkedText(source, rows[0].segments);
}

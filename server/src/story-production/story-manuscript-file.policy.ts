import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import type { CreateManuscriptVersionDto } from './dto/story-production.dto';
import { ManuscriptPart, manuscriptContentHash, STORY_LOCALES } from './story-production.policy';

export const MANUSCRIPT_FILE_LIMITS = {
  fileBytes: 16 * 1024 * 1024,
  requestBytes: 16 * 1024 * 1024 + 16 * 1024,
  pasteRequestBytes: 16 * 1024 * 1024 + 256 * 1024,
  manifestBytes: 128 * 1024,
  storedBytes: 40 * 1024 * 1024,
  parts: 1000,
  paragraphsPerPart: 5000,
  totalParagraphs: 200_000,
  textUnits: 10_000,
  uploadMilliseconds: 60_000,
} as const;

export type ManuscriptSourceKind = 'utf8_json_file' | 'json_projection' | 'utf8_paste';
export type PreparedManuscript = {
  locale: string;
  parts: ManuscriptPart[];
  contentHash: string;
  legacyHash: string;
  source: { kind: ManuscriptSourceKind; rawText: string; sha256: string; byteLength: number };
  paragraphCount: number;
  confirmedBoundaries?: Array<{ partKey: string; title: string; start: number; end: number }>;
};

export function invalidManuscript(code = 'MANUSCRIPT_INVALID_DOCUMENT'): never {
  throw new BadRequestException({ code, message: 'Invalid complete manuscript document' });
}

function within(value: number, maximum: number) {
  if (value > maximum) throw new PayloadTooLargeException({
    code: 'MANUSCRIPT_SIZE_LIMIT', message: 'Manuscript exceeds the bounded intake limit',
  });
}

function exactObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
    invalidManuscript('MANUSCRIPT_UNKNOWN_OR_MISSING_FIELDS');
  }
}

function validString(value: unknown, maximum: number, nonblank = false): asserts value is string {
  if (typeof value !== 'string' || (nonblank && !value.trim()) || value.includes('\0')) invalidManuscript();
  within(value.length, maximum);
  assertValidUnicode(value);
}

function assertValidUnicode(value: string) {
  // JSON accepts escaped lone surrogates; PostgreSQL JSONB cannot preserve them.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) invalidManuscript('MANUSCRIPT_INVALID_UNICODE');
    } else if (code >= 0xdc00 && code <= 0xdfff) invalidManuscript('MANUSCRIPT_INVALID_UNICODE');
  }
}

// JSON.parse remains the grammar parser. This bounded lexical pass only rejects
// duplicate member names (including escaped aliases) and excessive nesting.
function assertUniqueMembers(text: string) {
  const stack: Array<{ object: boolean; key: boolean; keys: Set<string> }> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      if (i >= text.length) invalidManuscript();
      const frame = stack[stack.length - 1];
      if (frame?.object && frame.key) {
        let name: string;
        try { name = JSON.parse(text.slice(start, i + 1)); } catch { invalidManuscript(); }
        if (frame.keys.has(name)) invalidManuscript('MANUSCRIPT_DUPLICATE_JSON_MEMBER');
        frame.keys.add(name);
        frame.key = false;
      }
    } else if (c === '{' || c === '[') {
      stack.push({ object: c === '{', key: c === '{', keys: new Set() });
      if (stack.length > 8) invalidManuscript('MANUSCRIPT_NESTING_LIMIT');
    } else if (c === '}' || c === ']') {
      stack.pop();
    } else if (c === ',' && stack[stack.length - 1]?.object) {
      stack[stack.length - 1].key = true;
    }
  }
}

export function prepareManuscript(buffer: Buffer): PreparedManuscript {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalidManuscript('MANUSCRIPT_FILE_REQUIRED');
  within(buffer.length, MANUSCRIPT_FILE_LIMITS.fileBytes);
  let rawText: string;
  try { rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { invalidManuscript('MANUSCRIPT_INVALID_UTF8'); }
  const json = rawText.startsWith('\ufeff') ? rawText.slice(1) : rawText;
  assertUniqueMembers(json);
  let value: unknown;
  try { value = JSON.parse(json); } catch { invalidManuscript(); }
  exactObject(value, ['locale', 'parts']);
  if (!STORY_LOCALES.includes(value.locale as never)) invalidManuscript('MANUSCRIPT_INVALID_LOCALE');
  if (!Array.isArray(value.parts) || value.parts.length === 0) invalidManuscript();
  within(value.parts.length, MANUSCRIPT_FILE_LIMITS.parts);
  const keys = new Set<string>();
  let paragraphCount = 0;
  for (const part of value.parts) {
    exactObject(part, ['partKey', 'title', 'paragraphs']);
    validString(part.partKey, 80, true);
    validString(part.title, 240, true);
    if (keys.has(part.partKey)) invalidManuscript('MANUSCRIPT_DUPLICATE_PART_KEY');
    keys.add(part.partKey);
    if (!Array.isArray(part.paragraphs) || !part.paragraphs.length) invalidManuscript();
    within(part.paragraphs.length, MANUSCRIPT_FILE_LIMITS.paragraphsPerPart);
    paragraphCount += part.paragraphs.length;
    within(paragraphCount, MANUSCRIPT_FILE_LIMITS.totalParagraphs);
    for (const paragraph of part.paragraphs) {
      exactObject(paragraph, ['kind', 'text']);
      if (!['title', 'scene_break', 'paragraph', 'dialogue'].includes(paragraph.kind as string)) invalidManuscript();
      validString(paragraph.text, MANUSCRIPT_FILE_LIMITS.textUnits);
    }
  }
  const locale = value.locale as string;
  const parts = value.parts as ManuscriptPart[];
  return prepareIdentity(buffer, rawText, locale, parts, paragraphCount, 'utf8_json_file');
}

export function preparePastedManuscript(buffer: Buffer, manifestText: unknown): PreparedManuscript {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalidManuscript('MANUSCRIPT_FILE_REQUIRED');
  within(buffer.length, MANUSCRIPT_FILE_LIMITS.fileBytes);
  if (typeof manifestText !== 'string' || !manifestText.length) invalidManuscript('MANUSCRIPT_BOUNDARIES_REQUIRED');
  within(Buffer.byteLength(manifestText), MANUSCRIPT_FILE_LIMITS.manifestBytes);
  let rawText: string;
  try { rawText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { invalidManuscript('MANUSCRIPT_INVALID_UTF8'); }
  if (!rawText.trim() || rawText.includes('\0')) invalidManuscript();
  assertValidUnicode(rawText);
  assertUniqueMembers(manifestText);
  let manifest: unknown;
  try { manifest = JSON.parse(manifestText); } catch { invalidManuscript('MANUSCRIPT_INVALID_BOUNDARIES'); }
  exactObject(manifest, ['locale', 'confirmed', 'parts']);
  if (!STORY_LOCALES.includes(manifest.locale as never)) invalidManuscript('MANUSCRIPT_INVALID_LOCALE');
  if (manifest.confirmed !== true) invalidManuscript('MANUSCRIPT_BOUNDARIES_NOT_CONFIRMED');
  if (!Array.isArray(manifest.parts) || !manifest.parts.length) invalidManuscript('MANUSCRIPT_BOUNDARIES_REQUIRED');
  within(manifest.parts.length, MANUSCRIPT_FILE_LIMITS.parts);
  const keys = new Set<string>();
  const parts: ManuscriptPart[] = [];
  const confirmedBoundaries: NonNullable<PreparedManuscript['confirmedBoundaries']> = [];
  let cursor = 0;
  let paragraphCount = 0;
  for (const boundary of manifest.parts) {
    exactObject(boundary, ['partKey', 'title', 'start', 'end']);
    validString(boundary.partKey, 80, true);
    validString(boundary.title, 240, true);
    if (keys.has(boundary.partKey)) invalidManuscript('MANUSCRIPT_DUPLICATE_PART_KEY');
    keys.add(boundary.partKey);
    if (typeof boundary.start !== 'number' || typeof boundary.end !== 'number' ||
        !Number.isSafeInteger(boundary.start) || !Number.isSafeInteger(boundary.end) ||
        boundary.start !== cursor || boundary.end <= cursor || boundary.end > rawText.length) {
      invalidManuscript('MANUSCRIPT_INVALID_BOUNDARIES');
    }
    if (boundary.end < rawText.length &&
        rawText.charCodeAt(boundary.end - 1) >= 0xd800 && rawText.charCodeAt(boundary.end - 1) <= 0xdbff &&
        rawText.charCodeAt(boundary.end) >= 0xdc00 && rawText.charCodeAt(boundary.end) <= 0xdfff) {
      invalidManuscript('MANUSCRIPT_INVALID_BOUNDARIES');
    }
    const text = rawText.slice(cursor, boundary.end);
    if (!text.trim()) invalidManuscript('MANUSCRIPT_EMPTY_PART');
    const paragraphs: ManuscriptPart['paragraphs'] = [];
    for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
      const line = match[0];
      if (!line) continue;
      for (let start = 0; start < line.length;) {
        let end = Math.min(start + MANUSCRIPT_FILE_LIMITS.textUnits, line.length);
        if (end < line.length && line.charCodeAt(end - 1) >= 0xd800 && line.charCodeAt(end - 1) <= 0xdbff) end--;
        paragraphs.push({ kind: 'paragraph', text: line.slice(start, end) });
        within(paragraphs.length, MANUSCRIPT_FILE_LIMITS.paragraphsPerPart);
        start = end;
      }
    }
    paragraphCount += paragraphs.length;
    within(paragraphCount, MANUSCRIPT_FILE_LIMITS.totalParagraphs);
    parts.push({ partKey: boundary.partKey, title: boundary.title, paragraphs });
    confirmedBoundaries.push({ partKey: boundary.partKey, title: boundary.title,
      start: boundary.start, end: boundary.end });
    cursor = boundary.end;
  }
  if (cursor !== rawText.length) invalidManuscript('MANUSCRIPT_INVALID_BOUNDARIES');
  return { ...prepareIdentity(buffer, rawText, manifest.locale as string, parts, paragraphCount, 'utf8_paste'),
    confirmedBoundaries };
}

// Only for the existing JSON route after its ValidationPipe/DTO contract. Do not
// reapply the file contract: DTO MaxLength counts characters, permits blank
// keys/titles and repeated part keys, and has no extra file-level restrictions.
export function prepareValidatedJsonManuscript(body: CreateManuscriptVersionDto): PreparedManuscript {
  const rawText = JSON.stringify(body);
  const buffer = Buffer.from(rawText);
  const paragraphCount = body.parts.reduce((count, part) => count + part.paragraphs.length, 0);
  return prepareIdentity(buffer, rawText, body.locale, body.parts, paragraphCount, 'json_projection');
}

function prepareIdentity(
  buffer: Buffer, rawText: string, locale: string, parts: ManuscriptPart[],
  paragraphCount: number, kind: ManuscriptSourceKind,
): PreparedManuscript {
  return {
    locale, parts, paragraphCount,
    contentHash: kind === 'utf8_paste'
      ? manuscriptContentHash({ identityVersion: 3, locale, parts, sourceSha256: createHash('sha256').update(buffer).digest('hex') })
      : manuscriptContentHash({ identityVersion: 2, locale, parts }),
    legacyHash: manuscriptContentHash({ parts }),
    source: { kind, rawText, byteLength: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') },
  };
}

export function storedManuscriptBody(input: PreparedManuscript) {
  const body = { parts: input.parts, intake: {
    format: 'story-manuscript-intake-v1', identityVersion: input.source.kind === 'utf8_paste' ? 3 : 2,
    locale: input.locale, source: input.source,
    ...(input.confirmedBoundaries ? { confirmedBoundaries: input.confirmedBoundaries } : {}),
  } };
  within(Buffer.byteLength(JSON.stringify(body)), MANUSCRIPT_FILE_LIMITS.storedBytes);
  return body;
}

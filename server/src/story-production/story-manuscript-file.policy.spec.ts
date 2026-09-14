import { HttpException } from '@nestjs/common';
import { MANUSCRIPT_FILE_LIMITS, prepareManuscript, preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';

const document = (locale = 'ko') => ({ locale, parts: [{ partKey: 'p1', title: 'Synthetic',
  paragraphs: [{ kind: 'paragraph', text: '  Exact\r\ntext \u00e9 e\u0301 \ud55c\uae00 \ud83d\ude80  ' }] }] });
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('bounded full manuscript parser', () => {
  it.each(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'])('accepts the complete %s projection without rewriting', locale => {
    const raw = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(JSON.stringify(document(locale), null, 2) + '\r\n')]);
    const parsed = prepareManuscript(raw);
    expect(parsed.parts).toEqual(document(locale).parts);
    expect(Buffer.from(storedManuscriptBody(parsed).intake.source.rawText)).toEqual(raw);
    expect(parsed.source.byteLength).toBe(raw.length);
  });

  it('separates byte identity from locale-aware semantic identity and preserves all parts', () => {
    const value = document();
    value.parts = Array.from({ length: 216 }, (_, i) => ({ ...value.parts[0], partKey: `part-${i}` }));
    const compact = prepareManuscript(bytes(value));
    const pretty = prepareManuscript(Buffer.from(JSON.stringify(value, null, 2)));
    expect(compact.parts).toHaveLength(216);
    expect(compact.contentHash).toBe(pretty.contentHash);
    expect(compact.source.sha256).not.toBe(pretty.source.sha256);
    const en = prepareManuscript(bytes({ ...value, locale: 'en' }));
    expect(compact.contentHash).not.toBe(en.contentHash);
    expect(compact.legacyHash).toBe(en.legacyHash);
  });

  it.each([
    {}, { ...document(), unknown: true }, { ...document(), locale: 'xx' }, { ...document(), parts: [] },
    { ...document(), parts: [document().parts[0], document().parts[0]] },
    { ...document(), parts: [{ ...document().parts[0], title: ' ' }] },
    { ...document(), parts: [{ ...document().parts[0], paragraphs: [{ kind: 'paragraph', text: '\0' }] }] },
    { ...document(), parts: [{ ...document().parts[0], paragraphs: [{ kind: 'paragraph', text: '\ud800' }] }] },
    { ...document(), parts: [{ ...document().parts[0], paragraphs: [{ kind: 'paragraph', text: 'safe', secret: 'hidden' }] }] },
  ])('rejects malformed/unknown/incomplete projections without input in errors %#', value => {
    expect(() => prepareManuscript(bytes(value))).toThrow(HttpException);
  });

  it.each([
    Buffer.from([0xff]), Buffer.from([0xe3, 0x81]), Buffer.from('{"locale":"ko",'),
    Buffer.from('{"locale":"ko","lo\\u0063ale":"en","parts":[]}'),
    Buffer.from('{"locale":"ko","parts":[{"partKey":"a","partKey":"b"}]}'),
    Buffer.from('['.repeat(9) + ']'.repeat(9)),
  ])('rejects UTF8, duplicate members, unfinished JSON or nesting %#', raw => {
    expect(() => prepareManuscript(raw)).toThrow(HttpException);
  });

  it('applies byte, part, paragraph and UTF16 bounds', () => {
    expect(() => prepareManuscript(Buffer.alloc(MANUSCRIPT_FILE_LIMITS.fileBytes + 1))).toThrow(HttpException);
    const value = document();
    expect(() => prepareManuscript(bytes({ ...value, parts: Array.from({ length: 1001 }, (_, i) => ({ ...value.parts[0], partKey: `${i}` })) }))).toThrow(HttpException);
    value.parts[0].paragraphs = Array.from({ length: 5001 }, () => ({ kind: 'paragraph', text: '' }));
    expect(() => prepareManuscript(bytes(value))).toThrow(HttpException);
    value.parts[0].paragraphs = [{ kind: 'paragraph', text: '\ud83d\ude80'.repeat(5001) }];
    expect(() => prepareManuscript(bytes(value))).toThrow(HttpException);
    const wide = document();
    wide.parts[0].paragraphs = Array.from({ length: 5000 }, () => ({ kind: 'paragraph', text: '' }));
    wide.parts = Array.from({ length: 41 }, (_, i) => ({ ...wide.parts[0], partKey: `${i}` }));
    expect(() => prepareManuscript(bytes(wide))).toThrow(HttpException);
  });
});

describe('confirmed raw paste', () => {
  const raw = '  Title\r\nDialogue 🚀\r\n\r\nSecond part\n  ';
  const firstEnd = raw.indexOf('Second');
  const manifest = { locale: 'ko', confirmed: true, parts: [
    { partKey: 'p1', title: 'First', start: 0, end: firstEnd },
    { partKey: 'p2', title: 'Second', start: firstEnd, end: raw.length },
  ] };
  const parse = (text = raw, boundaries: unknown = manifest) => preparePastedManuscript(Buffer.from(text), JSON.stringify(boundaries));

  it('retains every source byte and confirmed part span without normalization or a response body', () => {
    const input = parse();
    expect(input.parts.map(part => part.paragraphs.map(p => p.text).join('')).join('')).toBe(raw);
    expect(input.parts[0].paragraphs[0].text).toBe('  Title\r\n');
    expect(storedManuscriptBody(input).intake.source.rawText).toBe(raw);
    expect(input.confirmedBoundaries).toEqual(manifest.parts);
    expect(input.source.kind).toBe('utf8_paste');
    expect(input.parts).toHaveLength(2);
    expect(JSON.stringify({ sourceKind: input.source.kind, parts: input.parts.length })).not.toContain('Dialogue');
  });

  it('chunks long parts on valid Unicode boundaries and keeps the full source', () => {
    const text = '🚀'.repeat(6000);
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'long', title: 'Long', start: 0, end: text.length },
    ] });
    expect(input.parts[0].paragraphs.map(p => p.text).join('')).toBe(text);
    expect(input.parts[0].paragraphs).toHaveLength(2);
  });

  it.each([
    { ...manifest, confirmed: false },
    { ...manifest, parts: [{ ...manifest.parts[0], start: 1 }, manifest.parts[1]] },
    { ...manifest, parts: [{ ...manifest.parts[0], end: firstEnd - 1 }, manifest.parts[1]] },
    { ...manifest, parts: [manifest.parts[0]] },
    { ...manifest, parts: [manifest.parts[0], { ...manifest.parts[1], partKey: 'p1' }] },
    { ...manifest, parts: [manifest.parts[0], { ...manifest.parts[1], end: raw.length + 1 }] },
    { ...manifest, unexpected: true },
  ])('rejects unconfirmed, overlapping, incomplete or unknown boundary data %#', candidate => {
    expect(() => parse(raw, candidate)).toThrow(HttpException);
  });

  it('bounds file, manifest, part count, invalid UTF8 and empty spans', () => {
    expect(() => preparePastedManuscript(Buffer.from([0xff]), JSON.stringify(manifest))).toThrow(HttpException);
    expect(() => preparePastedManuscript(Buffer.alloc(MANUSCRIPT_FILE_LIMITS.fileBytes + 1), '{}')).toThrow(HttpException);
    expect(() => preparePastedManuscript(Buffer.from(raw), ' '.repeat(MANUSCRIPT_FILE_LIMITS.manifestBytes + 1))).toThrow(HttpException);
    expect(() => parse('   ', { locale: 'ko', confirmed: true, parts: [{ partKey: 'a', title: 'A', start: 0, end: 3 }] })).toThrow(HttpException);
    const many = Array.from({ length: 1001 }, (_, i) => ({ partKey: `${i}`, title: 'A', start: i, end: i + 1 }));
    expect(() => parse('x'.repeat(1001), { locale: 'ko', confirmed: true, parts: many })).toThrow(HttpException);
  });
});

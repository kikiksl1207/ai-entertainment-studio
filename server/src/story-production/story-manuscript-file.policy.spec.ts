import { HttpException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { MANUSCRIPT_FILE_LIMITS, PASTED_MANUSCRIPT_IDENTITY_VERSION, prepareManuscript, preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { manuscriptContentHash } from './story-production.policy';

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

  (process.env.STORY_QA_MANUSCRIPT_PATH ? it : it.skip)(
    'accepts the supplied 32-part final manuscript and preserves the exact source', () => {
      const raw = readFileSync(process.env.STORY_QA_MANUSCRIPT_PATH!, 'utf8');
      const headings = [...raw.matchAll(/^# (?:Part|외전) [0-9]{1,2}\. (.+?)\r?$/gm)];
      expect(headings).toHaveLength(32);
      const parts = headings.map((heading, index) => ({
        partKey: `part-${index + 1}`, title: heading[1],
        start: index === 0 ? 0 : heading.index,
        end: headings[index + 1]?.index ?? raw.length,
      }));
      const parsed = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
        locale: 'ko', confirmed: true, parts,
      }));
      expect(parsed.parts).toHaveLength(32);
      expect(parsed.parts.map(part => part.paragraphs.map(row => row.text).join('')).join('')).toBe(raw);
      expect(storedManuscriptBody(parsed).intake.source.rawText).toBe(raw);
      const reviewed = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
        locale: 'ko', confirmed: true, preface: { start: 0, end: headings[0].index! },
        parts: headings.map((heading, index) => ({
          partKey: `part-${index + 1}`, title: heading[1], start: heading.index!,
          end: headings[index + 1]?.index ?? raw.length,
        })),
      }));
      expect(reviewed.parts).toHaveLength(32);
      expect(reviewed.parts[0].paragraphs.map(row => row.text).join('')).toBe(raw.slice(headings[0].index!, headings[1].index!));
      expect(reviewed.source.rawText).toBe(raw);
    }, 30_000);

  it('keeps a reviewed preface in source bytes but outside reader parts', () => {
    const raw = '작품 소개\r\n메모\r\n\r\n# Part 01. 첫 장\r\n본문\r\n# Part 02. 둘째 장\r\n결말';
    const first = raw.indexOf('# Part 01');
    const second = raw.indexOf('# Part 02');
    const parsed = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko',
      confirmed: true, preface: { start: 0, end: first }, parts: [
        { partKey: 'part-1', title: '첫 장', start: first, end: second },
        { partKey: 'part-2', title: '둘째 장', start: second, end: raw.length },
      ] }));
    expect(parsed.parts[0].paragraphs.map(row => row.text).join('')).toBe(raw.slice(first, second));
    expect(parsed.confirmedPreface).toEqual({ start: 0, end: first });
    expect(raw.slice(0, first) + parsed.parts.map(part => part.paragraphs.map(row => row.text).join('')).join('')).toBe(raw);
    expect(storedManuscriptBody(parsed).intake.confirmedPreface).toEqual({ start: 0, end: first });
    expect(storedManuscriptBody(parsed).intake.source.rawText).toBe(raw);
    expect(() => preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko',
      confirmed: true, preface: { start: 0, end: first + 1 }, parts: [
        { partKey: 'part-1', title: '첫 장', start: first, end: raw.length },
      ] }))).toThrow();
  });

  (process.env.STORY_QA_LONG_MANUSCRIPT_PATH ? it : it.skip)(
    'accepts the supplied 265-part three-digit final manuscript without changing source text', () => {
      const raw = readFileSync(process.env.STORY_QA_LONG_MANUSCRIPT_PATH!, 'utf8');
      const headings = [...raw.matchAll(/^# Part [0-9]{3}\. (.+?)\r?$/gm)];
      expect(headings).toHaveLength(265);
      const parsed = preparePastedManuscript(Buffer.from(raw), JSON.stringify({
        locale: 'ko', confirmed: true, parts: headings.map((heading, index) => ({
          partKey: `part-${index + 1}`, title: heading[1],
          start: index === 0 ? 0 : heading.index!,
          end: headings[index + 1]?.index ?? raw.length,
        })),
      }));
      expect(parsed.parts).toHaveLength(265);
      expect(parsed.parts.map(part => part.paragraphs.map(row => row.text).join('')).join('')).toBe(raw);
      expect(storedManuscriptBody(parsed).intake.source.rawText).toBe(raw);
    }, 60_000);

  it('keeps a UTF-8 BOM and CRLF part offsets from the writer paste screen', () => {
    const source = '\uFEFF제1화 첫 문\r\n본문\r\n\r\n제2화 둘째 문\r\n본문';
    const second = source.indexOf('제2화');
    const parsed = preparePastedManuscript(Buffer.from(source), JSON.stringify({
      locale: 'ko', confirmed: true, parts: [
        { partKey: 'part-1', title: '첫 문', start: 0, end: second },
        { partKey: 'part-2', title: '둘째 문', start: second, end: source.length },
      ],
    }));
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts.map(part => part.paragraphs.map(row => row.text).join('')).join('')).toBe(source);
    expect(storedManuscriptBody(parsed).intake.source.rawText).toBe(source);
  });

  it('chunks long parts on valid Unicode boundaries and keeps the full source', () => {
    const text = '🚀'.repeat(6000);
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'long', title: 'Long', start: 0, end: text.length },
    ] });
    expect(input.parts[0].paragraphs.map(p => p.text).join('')).toBe(text);
    expect(input.parts[0].paragraphs).toHaveLength(2);
  });

  it('coalesces only blank lines, retaining BOM, mixed newlines, whitespace and nonblank line boundaries', () => {
    const text = '\ufeffTitle\r\n\r\n \t\nDialogue\r\rEnding\n  ';
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end: text.length },
    ] });
    expect(input.parts[0].paragraphs.map(p => p.text)).toEqual([
      '\ufeffTitle\r\n\r\n \t\n', 'Dialogue\r\r', 'Ending\n  ',
    ]);
    expect(Buffer.from(input.parts[0].paragraphs.map(p => p.text).join(''))).toEqual(Buffer.from(text));
    expect(Buffer.from(storedManuscriptBody(input).intake.source.rawText)).toEqual(Buffer.from(text));
    expect(storedManuscriptBody(input).intake.identityVersion).toBe(PASTED_MANUSCRIPT_IDENTITY_VERSION);
    expect(input.contentHash).toBe(manuscriptContentHash({ identityVersion: 4, locale: 'ko',
      parts: input.parts, sourceSha256: input.source.sha256 }));
  });

  it.each([9999, 10000, 10001, 20001])('keeps %i leading/trailing blank units within surrogate-safe paragraph bounds', count => {
    const text = ' '.repeat(count) + '\n\ud83d\ude80\n' + '\n'.repeat(count) + 'Next';
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end: text.length },
    ] });
    const paragraphs = input.parts[0].paragraphs;
    expect(paragraphs.map(p => p.text).join('')).toBe(text);
    expect(paragraphs.every(p => p.text.length > 0 && p.text.length <= 10000)).toBe(true);
    for (const p of paragraphs) {
      expect(p.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
  });

  it('attaches leading blank lines within their own part and never crosses confirmed boundaries', () => {
    const text = '\n \t\nFirst\n\n\nSecond\n';
    const end = text.indexOf('\nSecond');
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end },
      { partKey: 'b', title: 'B', start: end, end: text.length },
    ] });
    expect(input.parts.map(part => part.paragraphs.map(p => p.text).join(''))).toEqual([text.slice(0, end), text.slice(end)]);
    expect(input.parts.map(part => part.paragraphs.length)).toEqual([1, 1]);
    expect(input.confirmedBoundaries?.map(part => [part.start, part.end])).toEqual([[0, end], [end, text.length]]);
  });

  it('admits many raw blank lines without raising the unchanged paragraph caps or altering JSON intake', () => {
    const text = 'A\n' + '\n'.repeat(200001) + 'B';
    const input = parse(text, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end: text.length },
    ] });
    expect(input.parts[0].paragraphs.map(p => p.text).join('')).toBe(text);
    expect(input.paragraphCount).toBeLessThan(30);
    const json = { locale: 'ko', parts: [{ partKey: 'a', title: 'A', paragraphs: [
      { kind: 'paragraph', text: 'A\n' }, { kind: 'paragraph', text: '\n' }, { kind: 'paragraph', text: 'B' },
    ] }] };
    expect(prepareManuscript(bytes(json)).parts).toEqual(json.parts);
    expect(MANUSCRIPT_FILE_LIMITS.totalParagraphs).toBe(200000);
    expect(MANUSCRIPT_FILE_LIMITS.paragraphsPerPart).toBe(5000);
    const nonblank = 'A\n'.repeat(5001);
    expect(() => parse(nonblank, { locale: 'ko', confirmed: true, parts: [
      { partKey: 'a', title: 'A', start: 0, end: nonblank.length },
    ] })).toThrow(HttpException);
    const partText = 'A\n'.repeat(5000);
    const large = partText.repeat(41);
    expect(() => parse(large, { locale: 'ko', confirmed: true, parts: Array.from({ length: 41 }, (_, i) => ({
      partKey: `part-${i}`, title: 'A', start: i * partText.length, end: (i + 1) * partText.length,
    })) })).toThrow(HttpException);
  });

  it('rejects a confirmed part edge inside a UTF-16 surrogate pair', () => {
    const text = 'A🚀B';
    const parts = [
      { partKey: 'a', title: 'First', start: 0, end: 2 },
      { partKey: 'b', title: 'Second', start: 2, end: 4 },
    ];
    expect(() => parse(text, { locale: 'ko', confirmed: true, parts })).toThrow(HttpException);
    parts[0].end = 3;
    parts[1].start = 3;
    expect(parse(text, { locale: 'ko', confirmed: true, parts }).parts.map(part => part.paragraphs[0].text)).toEqual(['A🚀', 'B']);
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

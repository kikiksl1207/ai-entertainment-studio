import { HttpException } from '@nestjs/common';
import { MANUSCRIPT_FILE_LIMITS, prepareManuscript, storedManuscriptBody } from './story-manuscript-file.policy';

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

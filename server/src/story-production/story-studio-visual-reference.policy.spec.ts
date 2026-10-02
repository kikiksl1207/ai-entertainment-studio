import { createHash, randomUUID } from 'crypto';
import { releaseChecksum } from './story-lifecycle.policy';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { publicationVisualSceneBindings } from './story-publication-visual-binding.policy';
import { studioVisualReferenceDetail, studioVisualReferencePage } from './story-studio-visual-reference.policy';

function fixture(count = 19, mapped = true, segments = ['첫 번째 사건의 실제 원문.', '두 번째 사건의 실제 원문.']) {
  let raw = '';
  const parts = Array.from({ length: count }, (_, index) => {
    const start = raw.length;
    raw += segments.join('\n\n') + '\n\n';
    return { partKey: `part-${index * 3 + 1}`, title: '동일한 제목', start, end: raw.length };
  });
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true, parts }));
  const planned = prepared.parts.map((part, index) => ({ partKey: part.partKey, title: part.title,
    beats: segments.map(text => ({ text, sourceSceneKey: `origin-${index}` })) }));
  const projection = publicationReaderProjection(prepared.contentHash, prepared.parts, planned);
  const prompts = planned.map((_, index) => {
    const promptText = `PRIVATE-${index}: 인물과 장면을 원문으로 검토합니다.`;
    return { sourceSceneKey: `origin-${index}`, promptText,
      promptSha256: createHash('sha256').update(promptText).digest('hex') };
  });
  const reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
    sourceBindingSha256: 'a'.repeat(64), prompts,
    ...(mapped ? { sceneBindings: publicationVisualSceneBindings(prepared.contentHash, prepared.parts, projection, planned, prompts) } : {}) };
  const checksum = releaseChecksum(reference);
  const body = { ...storedManuscriptBody(prepared), publicationReaderProjection: projection,
    publicationVisualSource: { ...reference, checksum } };
  const identity = { workId: randomUUID(), manuscriptVersionId: randomUUID(), manuscriptHash: prepared.contentHash };
  return { body, identity, checksum, prompts, segments };
}

const page = (f: ReturnType<typeof fixture>, offset = 0) =>
  studioVisualReferencePage(f.body, f.identity, f.identity.manuscriptHash, f.checksum, offset);
const detail = (f: ReturnType<typeof fixture>, index = 0, textOffset = 0) =>
  studioVisualReferenceDetail(f.body, f.identity, f.identity.manuscriptHash, f.checksum, index, textOffset);

describe('private original visual reference reads', () => {
  it('returns all reference metadata in stable bounded pages without inferring from duplicate titles', () => {
    const f = fixture();
    const pages = [page(f), page(f, 8), page(f, 16)];
    expect(pages.map(value => value.items.length)).toEqual([8, 8, 3]);
    expect(pages.map(value => value.nextOffset)).toEqual([8, 16, null]);
    expect(pages.flatMap(value => value.items).map(item => item.referenceIndex)).toEqual(Array.from({ length: 19 }, (_, i) => i));
    expect(pages[1].items[0]).toMatchObject({ sourceSceneKey: 'origin-8', partKey: 'part-25', segmentCount: 2 });
    for (const value of pages) {
      expect(value).toMatchObject({ contract: 'publication-visual-reference-page-v1', ...f.identity,
        checksum: f.checksum, approvalState: 'reference_only', requiresSceneReview: true, totalReferences: 19 });
      expect(JSON.stringify(value)).not.toContain('PRIVATE-');
      expect(JSON.stringify(value)).not.toContain('실제 원문');
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024);
    }
  });

  it('returns full prompt and only the exactly bound reader segments, retaining reference-only status', () => {
    const f = fixture(2);
    const value = detail(f, 1);
    expect(value).toMatchObject({ contract: 'publication-visual-reference-detail-v1', ...f.identity,
      sourceSceneKey: 'origin-1', promptText: f.prompts[1].promptText, promptSha256: f.prompts[1].promptSha256,
      approvalState: 'reference_only', requiresSceneReview: true, mappingState: 'exact_source_segments',
      reader: { partKey: 'part-4', partTitle: '동일한 제목', segmentCount: 2,
        text: f.segments.join('\n\n'), textOffset: 0, nextTextOffset: null } });
    expect(value).not.toHaveProperty('approved');
    expect(value).not.toHaveProperty('generationStarted');
  });

  it('preserves long contiguous scene text across bounded pages without splitting surrogate pairs', () => {
    const f = fixture(1, true, ['가'.repeat(5999) + '😀끝.', '나'.repeat(8900)]);
    const chunks: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const value = detail(f, 0, offset);
      expect(value.reader!.textOffset).toBe(offset);
      expect(value.reader!.text.length).toBeLessThanOrEqual(6000);
      expect(value.reader!.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
      expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(256 * 1024);
      chunks.push(value.reader!.text); offset = value.reader!.nextTextOffset;
    }
    expect(chunks.join('')).toBe(f.segments.join('\n\n'));
    expect(detail(f).reader!.nextTextOffset).toBe(5999);
    expect(() => detail(f, 0, 6000)).toThrow();
  });

  it('keeps the accepted long-scene tail reachable past the former arbitrary 2.5M-unit limit', () => {
    const f = fixture(1, true, ['x'.repeat(1_000_000), 'y'.repeat(1_000_000), 'z'.repeat(1_000_000)]);
    const previous = detail(f, 0, 2_496_000);
    expect(previous.reader!.nextTextOffset).toBe(2_502_000);
    expect(detail(f, 0, previous.reader!.nextTextOffset!).reader!.textOffset).toBe(2_502_000);
    const last = detail(f, 0, previous.reader!.totalTextLength - 1000);
    expect(last.reader!.text).toBe('z'.repeat(1000));
    expect(last.reader!.nextTextOffset).toBeNull();
  });

  it('omits only the matching heading that the actual reader omits at the beginning of the part', () => {
    const f = fixture(1, true, ['# Part 1. 동일한 제목\n\n첫 번째 실제 사건.', '두 번째 실제 사건.']);
    expect(detail(f).reader!.text).toBe('첫 번째 실제 사건.\n\n두 번째 실제 사건.');
  });

  it('preserves heading-like story text in later bound segments instead of normalizing it as a part title', () => {
    const f = fixture(1, true, ['첫 번째 실제 사건.', '# Part 1. 동일한 제목\n이것은 이야기 속 문서.']);
    const parts = f.body.parts;
    const planned = parts.map(part => ({ partKey: part.partKey, title: part.title,
      beats: f.segments.map((text, index) => ({ text, sourceSceneKey: `origin-${index}` })) }));
    const prompt = { ...f.body.publicationVisualSource.prompts[0], sourceSceneKey: 'origin-1' };
    f.body.publicationVisualSource.prompts.push(prompt);
    f.body.publicationVisualSource.sceneBindings = publicationVisualSceneBindings(f.identity.manuscriptHash,
      parts, f.body.publicationReaderProjection, planned, f.body.publicationVisualSource.prompts);
    const { checksum: _, ...source } = f.body.publicationVisualSource;
    f.checksum = f.body.publicationVisualSource.checksum = releaseChecksum(source);
    expect(detail(f, 1).reader!.text).toBe(f.segments[1]);
  });

  it('does not reintroduce a title-only segment whose newline comes from the next reader segment', () => {
    const f = fixture(1, true, ['# Part 1. 동일한 제목', '본문 사건.']);
    const planned = f.body.parts.map(part => ({ partKey: part.partKey, title: part.title,
      beats: f.segments.map((text, index) => ({ text, sourceSceneKey: `origin-${index}` })) }));
    f.body.publicationVisualSource.prompts.push({ ...f.prompts[0], sourceSceneKey: 'origin-1' });
    f.body.publicationVisualSource.sceneBindings = publicationVisualSceneBindings(f.identity.manuscriptHash,
      f.body.parts, f.body.publicationReaderProjection, planned, f.body.publicationVisualSource.prompts);
    const { checksum: _, ...source } = f.body.publicationVisualSource;
    f.checksum = f.body.publicationVisualSource.checksum = releaseChecksum(source);
    expect(detail(f).reader).toMatchObject({ text: '', textOffset: 0, nextTextOffset: null, totalTextLength: 0 });
    expect(detail(f, 1).reader!.text).toBe('본문 사건.');
  });

  it('does not guess legacy unbound references or accept a prose page offset for them', () => {
    const f = fixture(1, false);
    expect(page(f)).toMatchObject({ mappingState: 'unmapped_legacy', items: [{ partKey: null, segmentCount: 0 }] });
    expect(detail(f)).toMatchObject({ mappingState: 'unmapped_legacy', reader: null, promptText: f.prompts[0].promptText });
    expect(() => detail(f, 0, 1)).toThrow();
  });

  it('keeps the complete maximum-length prompt within the raw-detail byte budget, including escaped characters', () => {
    const f = fixture(1, true, ['가'.repeat(6000)]);
    const prompt = f.body.publicationVisualSource.prompts[0];
    prompt.promptText = '\u0001'.repeat(32000);
    prompt.promptSha256 = createHash('sha256').update(prompt.promptText).digest('hex');
    f.body.publicationVisualSource.sceneBindings![0].promptSha256 = prompt.promptSha256;
    const { checksum: _, ...source } = f.body.publicationVisualSource;
    f.checksum = f.body.publicationVisualSource.checksum = releaseChecksum(source);
    const value = detail(f);
    expect(value.promptText).toBe(prompt.promptText);
    expect(value.promptText).toHaveLength(32000);
    expect(value.reader!.text).toBe(f.segments[0]);
    expect(Buffer.byteLength(JSON.stringify(value), 'utf8')).toBeLessThanOrEqual(256 * 1024);
  });

  it('supports an empty reference list without fabricating a prompt or reader scene', () => {
    const f = fixture(1, false);
    f.body.publicationVisualSource.prompts = [];
    const { checksum: _, ...source } = f.body.publicationVisualSource;
    f.checksum = f.body.publicationVisualSource.checksum = releaseChecksum(source);
    expect(page(f)).toMatchObject({ totalReferences: 0, items: [], nextOffset: null });
    expect(() => detail(f)).toThrow();
  });

  it.each([-1, 1.5, 2001, NaN, Infinity])('rejects invalid metadata offset %s', offset => {
    expect(() => page(fixture(), offset)).toThrow();
  });

  it.each([-1, 1.5, 2000, NaN, Infinity])('rejects invalid reference index %s', index => {
    expect(() => detail(fixture(), index)).toThrow();
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity])('rejects invalid reader offset %s', offset => {
    expect(() => detail(fixture(1), 0, offset)).toThrow();
  });

  it('rejects missing/out-of-range items and prevents replay under another source hash or checksum', () => {
    const f = fixture(1);
    expect(() => page(f, 1)).toThrow();
    expect(() => detail(f, 1)).toThrow();
    expect(() => detail(f, 0, f.segments.join('\n\n').length)).toThrow();
    for (const [hash, checksum] of [['b'.repeat(64), f.checksum], [f.identity.manuscriptHash, 'b'.repeat(64)],
      ['bad', f.checksum], [f.identity.manuscriptHash, 'bad']]) {
      expect(() => studioVisualReferencePage(f.body, f.identity, hash, checksum)).toThrow();
      expect(() => studioVisualReferenceDetail(f.body, f.identity, hash, checksum, 0)).toThrow();
    }
    expect(() => studioVisualReferencePage({}, f.identity, f.identity.manuscriptHash, f.checksum)).toThrow();
  });

  it('validates source/bindings on every read and never silently substitutes malformed references', () => {
    const f = fixture(1);
    f.body.publicationVisualSource.prompts[0].promptText += '변경';
    expect(() => page(f)).toThrow(); expect(() => detail(f)).toThrow();
    const other = fixture(1);
    const binding = other.body.publicationVisualSource.sceneBindings![0];
    binding.readerPartSha256 = 'b'.repeat(64);
    const { checksum: _, ...source } = other.body.publicationVisualSource;
    other.checksum = other.body.publicationVisualSource.checksum = releaseChecksum(source);
    expect(() => page(other)).toThrow(); expect(() => detail(other)).toThrow();
  });
});

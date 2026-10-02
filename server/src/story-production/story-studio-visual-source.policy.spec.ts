import { createHash } from 'crypto';
import { publicationVisualReferenceData } from './story-approved-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { publicationReaderProjection } from './story-publication-reader-projection.policy';
import { sourceOf } from './story-studio-linear.service';
import { studioVisualReferenceDetail, studioVisualReferencePage } from './story-studio-visual-reference.policy';
import { studioManuscriptVisualReviewSource, STUDIO_MANUSCRIPT_VISUAL_PROPOSAL_VERSION } from './story-studio-visual-source.policy';

function fixture(text = '첫 사건의 실제 본문.\n\n', second = '두 번째 사건의 실제 본문.') {
  const preface = 'PRIVATE PRODUCTION NOTES\n\n', raw = preface + text + second;
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true,
    preface: { start: 0, end: preface.length }, parts: [
      { partKey: 'part-a', title: '첫 사건', start: preface.length, end: preface.length + text.length },
      { partKey: 'part-b', title: '둘째 사건', start: preface.length + text.length, end: raw.length }] }));
  const manuscript = { locale: 'ko', contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) };
  return { manuscript, prepared: sourceOf(manuscript), hash: prepared.contentHash };
}
const identity = (hash: string) => ({ workId: 'work', manuscriptVersionId: 'manuscript', manuscriptHash: hash });
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

describe('private proposed visual guidance for a manuscript without imported guides', () => {
  it('reconstructs one unapproved prose-bound proposal per part without editing any source', () => {
    const f = fixture(), original = JSON.stringify(f.manuscript.structuredBody);
    const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared);
    expect(view.guidanceOrigin).toBe('manuscript_proposal');
    const source = (view.body as any).publicationVisualSource;
    expect(source).toMatchObject({ guidanceVersion: STUDIO_MANUSCRIPT_VISUAL_PROPOSAL_VERSION, approvalState: 'reference_only' });
    expect(source.prompts.map((row: any) => row.sourceSceneKey)).toEqual(['part-a-main', 'part-b-main']);
    expect(source.prompts[0].promptText).toContain('첫 사건의 실제 본문.');
    expect(JSON.stringify(source)).not.toContain('PRIVATE PRODUCTION');
    const page = studioVisualReferencePage(view.body, identity(f.hash), f.hash, view.reference.checksum);
    expect(page).toMatchObject({ requiresSceneReview: true, approvalState: 'reference_only', totalReferences: 2,
      mappingState: 'exact_source_segments', items: [{ partKey: 'part-a', segmentCount: 1 }, { partKey: 'part-b', segmentCount: 1 }] });
    expect(studioVisualReferenceDetail(view.body, identity(f.hash), f.hash, view.reference.checksum, 0).reader?.text)
      .toBe(f.prepared.readerPartTexts!.get('part-a'));
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
    expect(f.manuscript.structuredBody).not.toHaveProperty('publicationVisualSource');
  });

  it('has deterministic identity on every read and pins even prose omitted from the proposed prompt excerpt', () => {
    const firstText = '시작.\n' + '가'.repeat(3500) + '중간 사건 A.' + '나'.repeat(3500) + '\n끝.\n\n';
    const a = fixture(firstText), b = fixture(firstText.replace('중간 사건 A.', '중간 사건 B.'));
    const one = studioManuscriptVisualReviewSource(a.manuscript.structuredBody, a.hash, a.prepared);
    expect(studioManuscriptVisualReviewSource(a.manuscript.structuredBody, a.hash, a.prepared)).toEqual(one);
    const two = studioManuscriptVisualReviewSource(b.manuscript.structuredBody, b.hash, b.prepared);
    expect((one.body as any).publicationVisualSource.prompts[0].promptText)
      .toBe((two.body as any).publicationVisualSource.prompts[0].promptText);
    expect(one.reference.checksum).not.toBe(two.reference.checksum);
    expect(one.reference.bindings![0].readerPartSha256).not.toBe(two.reference.bindings![0].readerPartSha256);
    const detail = studioVisualReferenceDetail(one.body, identity(a.hash), a.hash, one.reference.checksum, 0, 6000);
    expect(detail.reader?.text).toBe(a.prepared.readerPartTexts!.get('part-a')!.slice(6000));
  });

  it('uses the existing verified reader projection without republishing private packaging or matching headings', () => {
    const f = fixture('# Part 1. 첫 사건\n\n유지할 실제 본문.\n\n');
    const projection = publicationReaderProjection(f.hash, f.prepared.parts, f.prepared.parts.map(part => ({
      partKey: part.partKey, title: part.title, beats: [{ text: part.paragraphs.map(row => row.text).join('') }] })));
    Object.assign(f.manuscript.structuredBody, { publicationReaderProjection: projection });
    const prepared = sourceOf(f.manuscript), original = JSON.stringify(f.manuscript.structuredBody);
    const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, prepared);
    const detail = studioVisualReferenceDetail(view.body, identity(f.hash), f.hash, view.reference.checksum, 0);
    expect(detail.reader?.text).toBe('유지할 실제 본문.\n\n');
    expect(detail.promptText).not.toContain('# Part 1.');
    expect(JSON.stringify(f.manuscript.structuredBody)).toBe(original);
  });

  it.each(['\n', '\r\n', '\r'])('retains scene-marker prose in proposed guidance instead of rejecting or rewriting it %#', newline => {
    const f = fixture(`[장면 1]${newline}실제 본문.${newline}${newline}`);
    const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared);
    const detail = studioVisualReferenceDetail(view.body, identity(f.hash), f.hash, view.reference.checksum, 0);
    expect(detail.reader!.text).toBe(f.prepared.readerPartTexts!.get('part-a'));
    expect(detail.reader!.text).toContain('[장면 1]'); expect(detail.promptText).toContain('실제 본문.');
  });

  it('preserves imported guide identity, including explicitly empty or unmapped imports, with no proposal fallback', () => {
    for (const prompts of [[], [{ sourceSceneKey: 'original-scene', promptText: 'ORIGINAL', promptSha256: sha('ORIGINAL') }]]) {
      const f = fixture(), reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
        sourceBindingSha256: 'e'.repeat(64), prompts };
      Object.assign(f.manuscript.structuredBody, { publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } });
      const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared);
      expect(view.guidanceOrigin).toBe('imported_reference');
      expect(view.body).toBe(f.manuscript.structuredBody);
      expect(view.reference).toEqual(publicationVisualReferenceData(f.manuscript.structuredBody, f.hash));
      expect(view.reference.promptCount).toBe(prompts.length);
    }
  });

  it.each([null, {}, { contract: 'other' }, { contract: 'publication-visual-source-v1', checksum: 'e'.repeat(64) }])
    ('rejects damaged imported data rather than quietly replacing it: %j', value => {
      const f = fixture(); Object.assign(f.manuscript.structuredBody, { publicationVisualSource: value });
      expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
    });

  it.each(['', 'x'.repeat(64), 'E'.repeat(64), 'e'.repeat(64)])('rejects wrong manuscript identity %s', hash => {
    const f = fixture(); expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, hash, f.prepared)).toThrow();
  });

  it('rejects mismatched source parts and reader text that does not come from the source', () => {
    const f = fixture(), b = fixture('서로 다른 원고.\n\n');
    expect(() => studioManuscriptVisualReviewSource(b.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
    f.prepared.readerPartTexts = new Map(f.prepared.readerPartTexts).set('part-a', '원고에 없는 사건.');
    expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
  });

  it.each(['', 'invalid.part', 'a'.repeat(65)])('rejects unsupported part keys %s', partKey => {
    const f = fixture(); f.prepared.parts[0].partKey = partKey;
    (f.manuscript.structuredBody as any).parts = f.prepared.parts;
    expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
  });

  it('rejects duplicate or excessive source parts without creating ambiguous indexes', () => {
    const f = fixture(); f.prepared.parts[1].partKey = f.prepared.parts[0].partKey;
    (f.manuscript.structuredBody as any).parts = f.prepared.parts;
    expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
    f.prepared.parts = Array.from({ length: 2001 }, (_, index) => ({ ...f.prepared.parts[0], partKey: `p-${index}` }));
    (f.manuscript.structuredBody as any).parts = f.prepared.parts;
    expect(() => studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared)).toThrow();
  });

  it('keeps Unicode text intact and allows the full reader text to be paginated independently of the proposal', () => {
    const f = fixture('가'.repeat(5999) + '😀' + '나'.repeat(500) + '\n\n');
    const view = studioManuscriptVisualReviewSource(f.manuscript.structuredBody, f.hash, f.prepared);
    const first = studioVisualReferenceDetail(view.body, identity(f.hash), f.hash, view.reference.checksum, 0);
    expect(first.reader?.nextTextOffset).toBe(5999);
    const last = studioVisualReferenceDetail(view.body, identity(f.hash), f.hash, view.reference.checksum, 0, first.reader!.nextTextOffset!);
    expect(first.reader!.text + last.reader!.text).toBe(f.prepared.readerPartTexts!.get('part-a'));
  });

  it('keeps all 265 parts addressable in bounded pages and binds the last proposal to its exact reader text', () => {
    let raw = '';
    const boundaries = Array.from({ length: 265 }, (_, index) => {
      const start = raw.length; raw += `Exact source ${index}. ` + '원고 본문. '.repeat(100) + '\n\n';
      return { partKey: `part-${index}`, title: `Title ${index}`, start, end: raw.length };
    });
    const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'ko', confirmed: true, parts: boundaries }));
    const manuscript = { locale: 'ko', contentHash: prepared.contentHash, structuredBody: storedManuscriptBody(prepared) };
    const view = studioManuscriptVisualReviewSource(manuscript.structuredBody, manuscript.contentHash, sourceOf(manuscript));
    const keys: string[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      const page = studioVisualReferencePage(view.body, identity(prepared.contentHash), prepared.contentHash, view.reference.checksum, offset);
      expect(page.items.length).toBeLessThanOrEqual(8);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(64 * 1024);
      keys.push(...page.items.map(row => row.sourceSceneKey)); offset = page.nextOffset;
    }
    expect(keys).toHaveLength(265); expect(new Set(keys).size).toBe(265); expect(keys.at(-1)).toBe('part-264-main');
    const last = studioVisualReferenceDetail(view.body, identity(prepared.contentHash), prepared.contentHash, view.reference.checksum, 264);
    expect(last.reader?.text).toBe(sourceOf(manuscript).readerPartTexts!.get('part-264'));
    expect(last.promptText).toContain('Exact source 264.');
    expect(last.approvalState).toBe('reference_only');
  });
});

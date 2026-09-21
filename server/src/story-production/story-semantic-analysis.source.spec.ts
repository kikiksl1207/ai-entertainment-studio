import { manuscriptContentHash, type ManuscriptPart } from './story-production.policy';
import { boundary, nextSourceChunk, pieceFor } from './story-semantic-analysis.source';
import { semanticTestConfig, semanticTestInput } from './story-semantic-analysis.test-fixture';
import type { SourceCursor } from './story-semantic-analysis.types';

describe('Deterministic complete semantic source coverage', () => {
  const identity = semanticTestInput();
  it.each([19537, 104036])('covers every one of %i synthetic paragraphs without a first-page cap', count => {
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: Array.from({ length: count }, (_, i) => ({ kind: 'paragraph', text: `Source ${i}.` })) }];
    const before = manuscriptContentHash(parts);
    let cursor: SourceCursor = { part: 0, paragraph: 0, offset: 0 }, covered = 0, chunks = 0;
    while (true) {
      // Coverage logic only here. Real-token overhead is checked separately below.
      const chunk = nextSourceChunk(parts, cursor, identity, semanticTestConfig(), input => 1000 + input.pieces.length);
      if (!chunk) break;
      for (const ref of chunk.refs) { expect(ref.paragraphIndex).toBe(covered++); expect(ref.start).toBe(0); }
      cursor = chunk.next; chunks++;
    }
    expect(covered).toBe(count); expect(chunks).toBeGreaterThan(100);
    expect(manuscriptContentHash(parts)).toBe(before);
  });
  it('splits long Korean paragraphs with real local tokens, complete overhead, and surrogate-safe UTF-16 offsets', () => {
    const text = '\uD55C\uAE00 \uC774\uC57C\uAE30\uC758 \uC120\uD0DD\uACFC \uAD00\uACC4\uB294 \uBCC0\uD55C\uB2E4. \uD83D\uDE00 '.repeat(900);
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic Korean', paragraphs: [{ kind: 'paragraph', text }] }];
    let cursor: SourceCursor = { part: 0, paragraph: 0, offset: 0 }, joined = '', count = 0;
    const first = nextSourceChunk(parts, cursor, identity, semanticTestConfig())!;
    expect(nextSourceChunk(parts, cursor, identity, semanticTestConfig())).toEqual(first);
    while (true) {
      const chunk = nextSourceChunk(parts, cursor, identity, semanticTestConfig());
      if (!chunk) break;
      expect(chunk.inputTokens).toBeLessThanOrEqual(8192);
      expect(chunk.refs[0].start).toBe(joined.length);
      for (const ref of chunk.refs) { expect(boundary(text, ref.end)).toBe(true); joined += pieceFor(parts, ref).text; }
      count += chunk.completedParagraphs; cursor = chunk.next;
    }
    expect(joined).toBe(text); expect(count).toBe(1); expect(first.done).toBe(false);
  });
  it('does not drop empty paragraphs or the transition between parts', () => {
    const parts: ManuscriptPart[] = [
      { partKey: 'empty-part', title: '', paragraphs: [] },
      { partKey: 'two', title: '', paragraphs: [{ kind: 'paragraph', text: '' }, { kind: 'dialogue', text: 'End' }] },
    ];
    const chunk = nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, identity, semanticTestConfig())!;
    expect(chunk.completedParagraphs).toBe(2); expect(chunk.done).toBe(true);
    expect(chunk.refs.map(ref => ref.partKey)).toEqual(['two', 'two']);
  });
  it('keeps one surrogate pair when halving a three-unit paragraph at a tight budget', () => {
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: [{ kind: 'paragraph', text: '\uD83D\uDE00a' }] }];
    const measure = (input: typeof identity) => input.pieces[0].text.length > 2 ? 8193 : 8192;
    const first = nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, identity, semanticTestConfig(), measure)!;
    expect(first.refs[0]).toMatchObject({ start: 0, end: 2 });
    const last = nextSourceChunk(parts, first.next, identity, semanticTestConfig(), measure)!;
    expect(last.refs[0]).toMatchObject({ start: 2, end: 3 });
    expect(last.done).toBe(true);
  });
});

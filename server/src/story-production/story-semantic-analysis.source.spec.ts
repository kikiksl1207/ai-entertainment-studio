import { manuscriptContentHash, type ManuscriptPart } from './story-production.policy';
import { boundary, inputBudget, nextSourceChunk, pieceFor } from './story-semantic-analysis.source';
import { SEMANTIC_PACKING_PROFILE, type SemanticPins } from './story-semantic-analysis.config';
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
    expect(covered).toBe(count); expect(chunks).toBe(Math.ceil(count / 256));
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

  it('preserves the exact legacy 32-piece output, cursor, checksum and budget with absent profile', () => {
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: Array.from({ length: 70 }, (_, i) => ({ kind: 'paragraph', text: i % 3 ? `Line ${i}` : '' })) }];
    const config = semanticTestConfig({ packingProfile: undefined });
    const measure = (input: typeof identity) => 1000 + input.pieces.length;
    let cursor: SourceCursor = { part: 0, paragraph: 0, offset: 0 };
    for (const [start, count] of [[0, 32], [32, 32], [64, 6]]) {
      const chunk = nextSourceChunk(parts, cursor, identity, config, measure)!;
      const refs = parts[0].paragraphs.slice(start, start + count).map((paragraph, i) => ({
        partIndex: 0, partKey: 'part-1', paragraphIndex: start + i, start: 0, end: paragraph.text.length,
      }));
      expect(chunk.refs).toEqual(refs);
      expect(chunk.sourceHash).toBe(manuscriptContentHash(refs.map(ref => pieceFor(parts, ref))));
      expect(chunk.inputTokens).toBe(1000 + count);
      expect(chunk.completedParagraphs).toBe(count);
      cursor = chunk.next;
    }
    expect(cursor).toEqual({ part: 1, paragraph: 0, offset: 0 });
  });

  it('uses a measured fitting prefix above 32 with bounded probes and no lost empty references', () => {
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: Array.from({ length: 600 }, () => ({ kind: 'paragraph', text: '' })) }];
    const measure = jest.fn((input: typeof identity) => 1000 + input.pieces.length * 40);
    const config = semanticTestConfig();
    let cursor: SourceCursor = { part: 0, paragraph: 0, offset: 0 }, covered = 0;
    while (true) {
      measure.mockClear();
      const chunk = nextSourceChunk(parts, cursor, identity, config, measure);
      if (!chunk) break;
      expect(measure.mock.calls.length).toBeLessThanOrEqual(9);
      expect(chunk.refs.length).toBe(Math.min(179, 600 - covered));
      for (const ref of chunk.refs) expect(ref).toMatchObject({ paragraphIndex: covered++, start: 0, end: 0 });
      expect(chunk.inputTokens).toBe(1000 + chunk.refs.length * 40);
      cursor = chunk.next;
    }
    expect(covered).toBe(600);
  });

  it('limits new-profile candidates to 256 pieces and 12k UTF16 even at a larger token cap', () => {
    const config = semanticTestConfig({ inputTokenLimit: 32000 });
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: [{ kind: 'paragraph', text: 'A'.repeat(11999) }, { kind: 'dialogue', text: '\ud83d\ude80End' }] }];
    const before = manuscriptContentHash(parts);
    const measure = jest.fn((input: typeof identity) => {
      expect(input.pieces.reduce((sum, piece) => sum + piece.text.length, 0)).toBeLessThanOrEqual(12000);
      expect(input.pieces.length).toBeLessThanOrEqual(256);
      return 1000;
    });
    const first = nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, identity, config, measure)!;
    expect(first.refs).toHaveLength(1);
    const last = nextSourceChunk(parts, first.next, identity, config, measure)!;
    expect(last.refs[0]).toMatchObject({ paragraphIndex: 1, start: 0, end: 5 });
    expect(last.done).toBe(true);
    expect(manuscriptContentHash(parts)).toBe(before);
  });

  it('measures full schema/instruction framing and preserves checksums across a saved resume cursor', () => {
    const config = semanticTestConfig();
    const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: 'Synthetic',
      paragraphs: Array.from({ length: 300 }, (_, i) => ({ kind: 'paragraph', text: `\ud55c\uae00 ${i}\r\n` })) }];
    const first = nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, identity, config)!;
    expect(first.refs.length).toBeGreaterThan(32);
    expect(first.inputTokens).toBe(inputBudget({ ...identity, pieces: first.refs.map(ref => pieceFor(parts, ref)) }, config));
    expect(first.inputTokens).toBeLessThanOrEqual(config.inputTokenLimit);
    const savedCursor = JSON.parse(JSON.stringify(first.next));
    const resumed = nextSourceChunk(parts, savedCursor, identity, config)!;
    expect(resumed).toEqual(nextSourceChunk(parts, first.next, identity, config));
    expect(resumed.refs[0].paragraphIndex).toBe(first.completedParagraphs);
  });

  it('does not skip an empty ref or a single code point when framing cannot fit', () => {
    for (const text of ['', '\ud83d\ude80']) {
      const parts: ManuscriptPart[] = [{ partKey: 'part-1', title: '', paragraphs: [{ kind: 'paragraph', text }] }];
      expect(() => nextSourceChunk(parts, { part: 0, paragraph: 0, offset: 0 }, identity, semanticTestConfig(), () => 8193))
        .toThrow('analysis_input_budget_too_small');
    }
  });

  it('fails unknown profiles before even measuring source', () => {
    const measure = jest.fn();
    const config = { ...semanticTestConfig(), packingProfile: `${SEMANTIC_PACKING_PROFILE}-unknown` } as unknown as SemanticPins;
    expect(() => nextSourceChunk([], { part: 0, paragraph: 0, offset: 0 }, identity, config, measure))
      .toThrow('analysis_packing_profile_unsupported');
    expect(measure).not.toHaveBeenCalled();
  });
});

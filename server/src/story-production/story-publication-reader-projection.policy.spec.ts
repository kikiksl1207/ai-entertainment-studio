import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ManuscriptPart } from './story-production.policy';
import { publicationReaderProjection, publicationReaderText } from './story-publication-reader-projection.policy';
import { readerPartText } from './story-studio-reader-text.policy';
import { releaseChecksum } from './story-lifecycle.policy';

const manuscriptHash = 'a'.repeat(64);
const firstProse = 'First \ud55c\uae00 \ud83d\ude80 prose.\r\nAn exact second line.';
const secondProse = 'Second dialogue: \u00e9 and e\u0301 stay distinct.';
const partHash = (part: ManuscriptPart) => releaseChecksum(part);
const read = (body: unknown, source: ManuscriptPart, hash = manuscriptHash) =>
  publicationReaderText(body as Prisma.JsonValue, source, hash);

function fixture() {
  const sources: ManuscriptPart[] = [
    { partKey: 'part-1', title: 'First', paragraphs: [
      { kind: 'title', text: '# Part 1. First\r\n' },
      { kind: 'paragraph', text: 'Package introduction\r\n## Body\r\n[Scene 1]\r\n' },
      { kind: 'paragraph', text: `  ${firstProse}\r\n\r\n` },
      { kind: 'scene_break', text: '[Scene 2]\r\n' },
      { kind: 'dialogue', text: `${secondProse}\n` },
      { kind: 'paragraph', text: '\n---\n## Production notes\nPrivate visual instructions\n' },
    ] },
    { partKey: 'part-2', title: 'Second', paragraphs: [
      { kind: 'title', text: '# Part 2. Second\n' },
      { kind: 'paragraph', text: 'Third scene.\n' },
    ] },
  ];
  const planParts = [
    { partKey: 'part-1', title: 'First', beats: [{ text: firstProse }, { text: secondProse }] },
    { partKey: 'part-2', title: 'Second', beats: [{ text: 'Third scene.' }] },
  ];
  const projection = publicationReaderProjection(manuscriptHash, sources, planParts);
  const body = { parts: sources, publicationReaderProjection: projection };
  return { sources, planParts, projection, body };
}

function markerFixture(newline = '\r\n') {
  const prose = Array.from({ length: 22 }, (_, index) =>
    `Prose ${index + 1}: \ud55c\uae00 \ud83d\ude80.${newline}Exact line ${index + 1}.`);
  const marked = prose.map((text, index) =>
    `[\uc7a5\uba74 ${index + 1}]\t ${newline}${text}`).join(newline);
  const source: ManuscriptPart = { partKey: 'part-1', title: 'First', paragraphs: [
    { kind: 'paragraph', text: `# Part 1. First${newline}## Body${newline}${marked}${newline}---${newline}Private notes` },
  ] };
  const plan = { partKey: source.partKey, title: source.title, beats: [{ text: prose.join(newline) }] };
  const projection = publicationReaderProjection(manuscriptHash, [source], [plan]);
  return { source, prose, plan, projection, body: { parts: [source], publicationReaderProjection: projection } };
}

function expectInvalid(run: () => unknown) {
  let error: unknown;
  try { run(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ConflictException);
  expect((error as ConflictException).getResponse()).toMatchObject({
    code: 'STORY_PUBLICATION_READER_PROJECTION_INVALID',
  });
}

describe('publication reader projection construction', () => {
  it('binds verified segments to exact source parts in source order without mutating inputs', () => {
    const f = fixture();
    const before = JSON.stringify({ sources: f.sources, planParts: f.planParts });
    const projection = publicationReaderProjection(manuscriptHash, f.sources, f.planParts);
    expect(projection).toEqual({ contract: 'publication-reader-projection-v1', manuscriptHash,
      parts: f.sources.map((source, index) => ({ partKey: source.partKey, title: source.title,
        sourcePartSha256: partHash(source), segments: f.planParts[index].beats.map(beat => beat.text) })) });
    expect(JSON.stringify({ sources: f.sources, planParts: f.planParts })).toBe(before);
  });

  it('projects prose only while preserving packaging and private notes in the source', () => {
    const f = fixture();
    const before = JSON.stringify(f.body);
    const text = read(f.body, f.sources[0]);
    expect(text).toBe(`${firstProse}\n\n${secondProse}`);
    for (const packaging of ['Package introduction', '## Body', '[Scene', 'Production notes', 'Private visual']) {
      expect(text).not.toContain(packaging);
    }
    expect(read(f.body, f.sources[1])).toBe('Third scene.');
    expect(JSON.stringify(f.body)).toBe(before);
  });

  it.each(['part key', 'title', 'content', 'part order', 'part count', 'empty beats'])('rejects a different %s', change => {
    const f = fixture();
    if (change === 'part key') f.planParts[0].partKey = 'unknown';
    if (change === 'title') f.planParts[0].title = 'Changed title';
    if (change === 'content') f.planParts[0].beats[0].text = 'Invented prose';
    if (change === 'part order') f.planParts.reverse();
    if (change === 'part count') f.planParts.pop();
    if (change === 'empty beats') f.planParts[0].beats = [];
    expectInvalid(() => publicationReaderProjection(manuscriptHash, f.sources, f.planParts));
  });

  it('rejects an empty source and plan', () => {
    expectInvalid(() => publicationReaderProjection(manuscriptHash, [], []));
  });

  it('rejects duplicate source part keys even when both plan rows match', () => {
    const f = fixture();
    f.sources[1].partKey = f.sources[0].partKey;
    f.planParts[1].partKey = f.sources[0].partKey;
    expectInvalid(() => publicationReaderProjection(manuscriptHash, f.sources, f.planParts));
  });

  it.each([null, {}, { partKey: 'part-1', title: 'First', beats: null }])(
    'rejects malformed plan rows with the projection error %#', row => {
      const f = fixture();
      expectInvalid(() => publicationReaderProjection(manuscriptHash, [f.sources[0]],
        [row] as unknown as typeof f.planParts));
    });
});

describe('publication reader projection validation', () => {
  it('survives JSONB-style object-key reordering at every stored object level', () => {
    const f = fixture();
    const storedSources: ManuscriptPart[] = f.sources.map(source => ({
      paragraphs: source.paragraphs.map(row => ({ text: row.text, kind: row.kind })),
      title: source.title, partKey: source.partKey,
    }));
    const storedProjection = { parts: f.projection.parts.map(row => ({
      segments: row.segments, sourcePartSha256: row.sourcePartSha256, title: row.title, partKey: row.partKey,
    })), manuscriptHash: f.projection.manuscriptHash, contract: f.projection.contract };
    const storedBody = JSON.parse(JSON.stringify({ publicationReaderProjection: storedProjection, parts: storedSources }));
    expect(JSON.stringify(storedSources)).not.toBe(JSON.stringify(f.sources));
    expect(publicationReaderProjection(manuscriptHash, storedSources, f.planParts)).toEqual(f.projection);
    for (let index = 0; index < f.sources.length; index++) {
      expect(partHash(storedSources[index])).toBe(f.projection.parts[index].sourcePartSha256);
      expect(read(storedBody, storedBody.parts[index])).toBe(read(f.body, f.sources[index]));
    }
    storedBody.parts[0].paragraphs[2].text += 'Tampered after storage';
    expectInvalid(() => read(storedBody, storedBody.parts[0]));
  });

  it.each(['\n', '\r\n', '\r'])('verifies 22 standalone scene markers removed into one prose beat %#', newline => {
    const f = markerFixture(newline);
    const before = JSON.stringify(f.source);
    expect(f.source.paragraphs[0].text.match(/\[\uc7a5\uba74 \d+\]/g)).toHaveLength(22);
    expect(f.projection.parts[0].segments).toEqual([f.prose.join(newline)]);
    expect(read(f.body, f.source)).toBe(f.prose.join(newline));
    expect(read(f.body, f.source)).not.toContain('[\uc7a5\uba74');
    expect(read(f.body, f.source)).not.toContain('Private notes');
    expect(JSON.stringify(f.source)).toBe(before);
  });

  it.each(['\n', '\r\n', '\r'])('retains literal scene markers when segments match the full original reader prose %#', newline => {
    const f = markerFixture(newline), text = f.source.paragraphs[0].text;
    const projection = publicationReaderProjection(manuscriptHash, [f.source], [{ ...f.plan, beats: [{ text }] }]);
    expect(read({ parts: [f.source], publicationReaderProjection: projection }, f.source)).toBe(readerPartText(text, f.source.title));
    expect(projection.parts[0].segments[0]).toContain('[\uc7a5\uba74 1]');
  });

  it.each(['invented marker', 'reordered', 'duplicated'])('rejects %s in a marker-retaining projection', change => {
    const f = markerFixture(), raw = f.source.paragraphs[0].text;
    const fragments = raw.split('[\uc7a5\uba74 2]');
    const text = change === 'invented marker' ? raw.replace('[\uc7a5\uba74 1]', '[\uc7a5\uba74 99]')
      : change === 'reordered' ? fragments.slice().reverse().join('[\uc7a5\uba74 2]') : raw + raw;
    expectInvalid(() => publicationReaderProjection(manuscriptHash, [f.source], [{ ...f.plan, beats: [{ text }] }]));
  });

  it.each(['forged', 'reordered', 'duplicated'])('rejects %s prose after scene-marker removal', change => {
    const f = markerFixture();
    const changed = change === 'forged' ? [f.prose[0].replace('Prose', 'Invented'), ...f.prose.slice(1)]
      : change === 'reordered' ? [...f.prose].reverse()
        : [f.prose[0], f.prose[0], ...f.prose.slice(1)];
    const text = changed.join('\r\n');
    expectInvalid(() => publicationReaderProjection(manuscriptHash, [f.source], [{
      ...f.plan, beats: [{ text }],
    }]));
    f.projection.parts[0].segments = [text];
    expectInvalid(() => read(f.body, f.source));
  });

  it.each(['Before [\uc7a5\uba74 1] after.', 'Before.\n[\uc7a5\uba74 1] Keep this sentence.\nAfter.',
    'Before.\n[Production notes]\nAfter.'])('does not remove inline markers or arbitrary packaging during matching %#', text => {
    const source: ManuscriptPart = { partKey: 'part-1', title: 'First',
      paragraphs: [{ kind: 'paragraph', text }] };
    expectInvalid(() => publicationReaderProjection(manuscriptHash, [source], [{
      partKey: source.partKey, title: source.title,
      beats: [{ text: text.startsWith('Before [') ? 'Before after.' : 'Before.\nAfter.' }],
    }]));
  });

  it('binds excluded scene markers to the exact source hash', () => {
    const f = markerFixture();
    f.source.paragraphs[0].text = f.source.paragraphs[0].text.replace('[\uc7a5\uba74 1]', '[\uc7a5\uba74 23]');
    expectInvalid(() => read(f.body, f.source));
  });

  it('accepts whitespace differences in verified segments without rewriting their Unicode or newlines', () => {
    const source: ManuscriptPart = { partKey: 'unicode', title: 'Unicode', paragraphs: [
      { kind: 'paragraph', text: '  \ud55c\uae00\t\ud83d\ude80\r\n\r\n\u00e9\u00a0e\u0301 \u3000end\n' },
    ] };
    const segments = ['\ud55c\uae00 \ud83d\ude80', '\u00e9\ne\u0301\tend'];
    const projection = publicationReaderProjection(manuscriptHash, [source], [{
      partKey: source.partKey, title: source.title, beats: segments.map(text => ({ text })),
    }]);
    expect(read({ parts: [source], publicationReaderProjection: projection }, source))
      .toBe(segments.join('\n\n'));
  });

  it('does not treat composed and decomposed Unicode as interchangeable', () => {
    const source: ManuscriptPart = { partKey: 'unicode', title: 'Unicode',
      paragraphs: [{ kind: 'paragraph', text: '\u00e9' }] };
    expectInvalid(() => publicationReaderProjection(manuscriptHash, [source], [{
      partKey: source.partKey, title: source.title, beats: [{ text: 'e\u0301' }],
    }]));
  });

  it.each(['invented', 'reordered', 'duplicated', 'case changed'])('rejects %s segments during construction and reading', change => {
    const f = fixture();
    const segments = change === 'invented' ? ['Never present in the source']
      : change === 'reordered' ? [secondProse, firstProse]
        : change === 'duplicated' ? [firstProse, firstProse]
          : [firstProse.toUpperCase()];
    f.planParts[0].beats = segments.map(text => ({ text }));
    f.projection.parts[0].segments = segments;
    expectInvalid(() => publicationReaderProjection(manuscriptHash, f.sources, f.planParts));
    expectInvalid(() => read(f.body, f.sources[0]));
  });

  it.each([[], [''], [' \t\r\n\u00a0'], [null], [42], 'not an array', null, Array(1001).fill(firstProse)])(
    'rejects empty, malformed or excessive segment lists %#', segments => {
      const f = fixture();
      expectInvalid(() => read({ ...f.body, publicationReaderProjection: {
        ...f.projection, parts: [{ ...f.projection.parts[0], segments }, f.projection.parts[1]],
      } }, f.sources[0]));
    });

  it.each(['manuscript hash', 'source hash', 'title', 'part key', 'duplicate key', 'part count'])(
    'rejects a mismatched %s', change => {
      const f = fixture();
      if (change === 'manuscript hash') f.projection.manuscriptHash = 'b'.repeat(64);
      if (change === 'source hash') f.projection.parts[0].sourcePartSha256 = 'b'.repeat(64);
      if (change === 'title') f.projection.parts[0].title = 'Different title';
      if (change === 'part key') f.projection.parts[0].partKey = 'unknown';
      if (change === 'duplicate key') f.projection.parts[1] = { ...f.projection.parts[0] };
      if (change === 'part count') f.projection.parts.pop();
      expectInvalid(() => read(f.body, f.sources[0]));
    });

  it.each(['prose', 'packaging', 'whitespace', 'newline', 'paragraph kind', 'title', 'part key'])(
    'rejects source tampering: %s', change => {
      const f = fixture();
      const source = f.sources[0];
      if (change === 'prose') source.paragraphs[2].text += 'Tampered prose';
      if (change === 'packaging') source.paragraphs[1].text += 'Changed production material';
      if (change === 'whitespace') source.paragraphs[2].text += ' ';
      if (change === 'newline') source.paragraphs[2].text = source.paragraphs[2].text.replace(/\r\n/g, '\n');
      if (change === 'paragraph kind') source.paragraphs[2].kind = 'dialogue';
      if (change === 'title') source.title = 'Different title';
      if (change === 'part key') source.partKey = 'unknown';
      expectInvalid(() => read(f.body, source));
    });

  it.each([null, {}, [], 'invalid', 42, { contract: 'unknown' },
    { contract: 'publication-reader-projection-v2' }])('rejects malformed or unknown projections %#', projection => {
    const f = fixture();
    expectInvalid(() => read({ parts: f.sources, publicationReaderProjection: projection }, f.sources[0]));
  });

  it.each([null, [], 'invalid', 42])('rejects a malformed body %#', body => {
    expectInvalid(() => read(body, fixture().sources[0]));
  });

  it.each([null, {}, 'invalid', [], [null, null]])('rejects malformed projection parts %#', parts => {
    const f = fixture();
    expectInvalid(() => read({ ...f.body, publicationReaderProjection: { ...f.projection, parts } }, f.sources[0]));
  });

  it.each([null, {}, 'invalid', []])('requires manuscript parts when a projection exists %#', parts => {
    const f = fixture();
    expectInvalid(() => read({ ...f.body, parts }, f.sources[0]));
  });

  it('strips a retained matching heading using the existing reader policy', () => {
    const source: ManuscriptPart = { partKey: 'part-1', title: 'First', paragraphs: [
      { kind: 'paragraph', text: '\ufeff# Part 1. First\r\n\r\nExact prose.\r\n' },
    ] };
    const text = source.paragraphs[0].text;
    const projection = publicationReaderProjection(manuscriptHash, [source], [{
      partKey: source.partKey, title: source.title, beats: [{ text }],
    }]);
    expect(read({ parts: [source], publicationReaderProjection: projection }, source))
      .toBe('Exact prose.\r\n');
  });

  it('preserves the old reader behavior when the projection is absent', () => {
    const f = fixture();
    for (const source of f.sources) {
      const raw = source.paragraphs.map(row => row.text).join('');
      expect(read({ parts: f.sources }, source)).toBe(readerPartText(raw, source.title));
      expect(read({}, source)).toBe(readerPartText(raw, source.title));
    }
    expect(read({ parts: f.sources }, f.sources[0])).toContain('Private visual instructions');
    const source: ManuscriptPart = { partKey: 'plain', title: 'Different', paragraphs: [
      { kind: 'paragraph', text: '# Part 1. First\r\n  Unchanged \ud83d\ude80 prose.\n' },
    ] };
    expect(read({}, source)).toBe(source.paragraphs[0].text);
  });
});

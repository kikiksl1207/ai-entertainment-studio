import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { publicationVisualReference } from './story-approved-visual.policy';
import { releaseChecksum } from './story-lifecycle.policy';
import * as lifecycle from './story-lifecycle.policy';
import { preparePastedManuscript, storedManuscriptBody } from './story-manuscript-file.policy';
import { publicationReaderProjection, publicationReaderText } from './story-publication-reader-projection.policy';
import { publicationVisualReferencePreview, publicationVisualSceneBindings,
  verifiedPublicationVisualBindings } from './story-publication-visual-binding.policy';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const otherHash = sha256('different source');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture(partKeys = ['part-1', 'part-9', 'part-17'], segmentCount = 3, bindAll = false,
  promptText = 'Illustrate the exact original moment, without text labels.') {
  const title = 'Shared title';
  const texts = partKeys.map(partKey => Array.from({ length: segmentCount }, (_, index) =>
    `Original prose for ${partKey}, segment ${index}: this moment belongs only to this source.`));
  let raw = '';
  const boundaries = texts.map((segments, index) => {
    const start = raw.length;
    raw += `${segments.join('\n\n')}\n\n`;
    return { partKey: partKeys[index], title, start, end: raw.length };
  });
  const prepared = preparePastedManuscript(Buffer.from(raw), JSON.stringify({ locale: 'en', confirmed: true, parts: boundaries }));
  const planned = prepared.parts.map((part, partIndex) => ({ partKey: part.partKey, title: part.title,
    beats: texts[partIndex].map((text, segmentIndex) => ({ text,
      sourceSceneKey: bindAll || segmentIndex < 2 ? `lens-origin-${partIndex}` : undefined })) }));
  const projection = publicationReaderProjection(prepared.contentHash, prepared.parts, planned);
  const prompts = partKeys.map((_, index) => ({ sourceSceneKey: `lens-origin-${index}`, promptText,
    promptSha256: sha256(promptText) }));
  const bindings = publicationVisualSceneBindings(prepared.contentHash, prepared.parts, projection, planned, prompts);
  const body = { ...storedManuscriptBody(prepared), publicationReaderProjection: projection };
  return { prepared, sources: prepared.parts, planned, projection, prompts, bindings, body };
}

function verify(f: ReturnType<typeof fixture>) {
  return verifiedPublicationVisualBindings(f.body, f.prompts, f.bindings, f.prepared.contentHash);
}

function preview(f: ReturnType<typeof fixture>, bindings: unknown = f.bindings) {
  return publicationVisualReferencePreview(f.body, f.prepared.contentHash, releaseChecksum(f.prompts), f.prompts, bindings);
}

function referenceBody(f: ReturnType<typeof fixture>, mapped = true) {
  const reference = { contract: 'publication-visual-source-v1', approvalState: 'reference_only',
    sourceBindingSha256: sha256('original import binding'), prompts: f.prompts,
    ...(mapped ? { sceneBindings: f.bindings } : {}) };
  return { ...f.body, publicationVisualSource: { ...reference, checksum: releaseChecksum(reference) } };
}

function expectInvalid(action: () => unknown, code = 'STORY_PUBLICATION_VISUAL_BINDING_INVALID') {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected ${code}`);
}

function checkMutations(cases: Array<[string, (f: ReturnType<typeof fixture>) => void]>,
  action: (f: ReturnType<typeof fixture>) => unknown = verify) {
  for (const [label, mutate] of cases) {
    const f = fixture(); mutate(f);
    try { expectInvalid(() => action(f)); }
    catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

describe('publication visual scene bindings', () => {
  it.each([{ partKey: ['part-1'] }, { partKey: { toString: () => 'part-1' } }, { partKey: 1 }, { partKey: null }])
    ('rejects non-string source part aliases %p', ({ partKey }) => {
    const f = fixture(['part-1']);
    (f.bindings[0] as unknown as Record<string, unknown>).partKey = partKey;
    expectInvalid(() => verify(f));
  });

  it('rejects aliased overlapping bindings even when their scene keys and prompt hashes are distinct', () => {
    const f = fixture(['part-1']);
    f.prompts.push({ ...f.prompts[0], sourceSceneKey: 'distinct-key' });
    f.bindings.push({ ...f.bindings[0], sourceSceneKey: 'distinct-key',
      partKey: ['part-1'] as unknown as string });
    expectInvalid(() => verify(f));
  });

  it('hashes each source part only a constant number of times when many references share it', () => {
    const f = fixture(['large-part'], 1000);
    const planned = f.planned.map(part => ({ ...part,
      beats: part.beats.map((beat, index) => ({ ...beat, sourceSceneKey: `origin-${index}` })) }));
    const prompts = planned[0].beats.map(beat => ({ ...f.prompts[0], sourceSceneKey: beat.sourceSceneKey }));
    const bindings = publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, planned, prompts);
    const sourcePart = f.body.parts[0];
    const hash = jest.spyOn(lifecycle, 'releaseChecksum');
    try {
      expect(verifiedPublicationVisualBindings(f.body, prompts, bindings, f.prepared.contentHash)).toHaveLength(1000);
      expect(hash.mock.calls.filter(([value]) => value === sourcePart)).toHaveLength(2);
    } finally { hash.mockRestore(); }
  });

  it('binds arbitrary scene keys to exact noncontinuous parts despite identical titles', () => {
    const f = fixture();
    expect(f.prepared.parts.map(part => part.partKey)).toEqual(['part-1', 'part-9', 'part-17']);
    expect(new Set(f.prepared.parts.map(part => part.title)).size).toBe(1);
    expect(f.bindings.map(binding => binding.partKey)).toEqual(['part-1', 'part-9', 'part-17']);
    f.bindings.forEach((binding, index) => {
      expect(binding).toEqual({ sourceSceneKey: f.prompts[index].sourceSceneKey,
        partKey: f.sources[index].partKey, partTitle: f.sources[index].title,
        sourcePartSha256: releaseChecksum(f.sources[index]),
        readerPartSha256: sha256(publicationReaderText(f.body as unknown as Prisma.JsonValue, f.sources[index], f.prepared.contentHash)),
        segmentIndexes: [0, 1], segmentSha256s: f.projection.parts[index].segments.slice(0, 2).map(sha256),
        promptSha256: sha256(f.prompts[index].promptText) });
      expect(binding.sourceSceneKey).not.toMatch(/^part-/);
    });
    expect(verify(f)).toEqual(f.bindings);
  });

  it('preserves prompt order without inferring a part from array index or title', () => {
    const f = fixture();
    const prompts = [f.prompts[2], f.prompts[0], f.prompts[1]];
    const bindings = publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, prompts);
    expect(bindings.map(binding => binding.partKey)).toEqual(['part-17', 'part-1', 'part-9']);
    expect(verifiedPublicationVisualBindings(f.body, prompts, bindings, f.prepared.contentHash)).toEqual(bindings);
  });

  it('a single scene split into contiguous segments keeps every segment index and full hash', () => {
    const f = fixture(['part-9'], 4, true);
    expect(f.bindings[0].segmentIndexes).toEqual([0, 1, 2, 3]);
    expect(f.bindings[0].segmentSha256s).toEqual(f.projection.parts[0].segments.map(sha256));
    expect(verify(f)).toEqual(f.bindings);
  });

  it('rejects the same scene key appearing in different parts', () => {
    const f = fixture(); f.planned[1].beats[0].sourceSceneKey = f.prompts[0].sourceSceneKey;
    expectInvalid(() => publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, f.prompts));
  });

  it('rejects a noncontiguous same-key scene within one part', () => {
    const f = fixture(); f.planned[0].beats[1].sourceSceneKey = undefined;
    f.planned[0].beats[2].sourceSceneKey = f.prompts[0].sourceSceneKey;
    expectInvalid(() => publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, f.prompts));
  });

  it('rejects missing exact scene keys rather than matching a similarly titled part', () => {
    const f = fixture(); f.prompts[0].sourceSceneKey = 'unknown-scene';
    expectInvalid(() => publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, f.prompts));
  });

  it('rejects invalid prompt identities, hashes and source-plan alignment', () => { checkMutations([
    ['duplicate prompt key', (f: any) => { f.prompts[1] = { ...f.prompts[0] }; }],
    ['invalid scene key', (f: any) => { f.prompts[0].sourceSceneKey = '../scene'; }],
    ['blank prompt', (f: any) => { f.prompts[0].promptText = ' '; f.prompts[0].promptSha256 = sha256(' '); }],
    ['NUL prompt', (f: any) => { f.prompts[0].promptText = 'text\0text'; f.prompts[0].promptSha256 = sha256('text\0text'); }],
    ['oversized prompt', (f: any) => { f.prompts[0].promptText = 'x'.repeat(32001); f.prompts[0].promptSha256 = sha256(f.prompts[0].promptText); }],
    ['wrong prompt hash', (f: any) => { f.prompts[0].promptSha256 = otherHash; }],
    ['wrong manuscript hash', (f: any) => { f.projection.manuscriptHash = otherHash; }],
    ['wrong planned part key', (f: any) => { f.planned[0].partKey = 'part-2'; }],
    ['wrong planned title', (f: any) => { f.planned[0].title = 'Changed title'; }],
    ['changed beat text', (f: any) => { f.planned[0].beats[0].text += ' changed'; }],
    ['missing planned part', (f: any) => { f.planned.pop(); }],
    ['missing projection part', (f: any) => { f.projection.parts.pop(); }],
  ], f => publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, f.prompts));
  });

  it('rejects a prompt collection above the bounded 2000-reference limit', () => {
    const f = fixture(); f.prompts = Array.from({ length: 2001 }, (_, index) => ({ ...f.prompts[0], sourceSceneKey: `shot-${index}` }));
    expectInvalid(() => publicationVisualSceneBindings(f.prepared.contentHash, f.sources, f.projection, f.planned, f.prompts));
  });
});

describe('verified publication visual bindings', () => {
  it('validates a JSON stored-body round trip without depending on object identity', () => {
    const f = clone(fixture()); expect(verify(f)).toEqual(f.bindings);
  });

  it('rejects binding hash, identity, segment-array and duplicate-map mutations', () => { checkMutations([
    ['scene key', (f: any) => { f.bindings[0].sourceSceneKey = 'wrong-key'; }],
    ['part key with same title', (f: any) => { f.bindings[0].partKey = 'part-9'; }],
    ['part title', (f: any) => { f.bindings[0].partTitle = 'Changed title'; }],
    ['source part hash', (f: any) => { f.bindings[0].sourcePartSha256 = otherHash; }],
    ['reader part hash', (f: any) => { f.bindings[0].readerPartSha256 = otherHash; }],
    ['prompt binding hash', (f: any) => { f.bindings[0].promptSha256 = otherHash; }],
    ['prompt source hash', (f: any) => { f.prompts[0].promptSha256 = otherHash; }],
    ['missing segment indexes', (f: any) => { delete f.bindings[0].segmentIndexes; }],
    ['empty segment indexes', (f: any) => { f.bindings[0].segmentIndexes = []; f.bindings[0].segmentSha256s = []; }],
    ['nonarray segment indexes', (f: any) => { f.bindings[0].segmentIndexes = {}; }],
    ['negative index', (f: any) => { f.bindings[0].segmentIndexes[0] = -1; }],
    ['fractional index', (f: any) => { f.bindings[0].segmentIndexes[0] = 0.5; }],
    ['string index', (f: any) => { f.bindings[0].segmentIndexes[0] = '0'; }],
    ['unsafe index', (f: any) => { f.bindings[0].segmentIndexes[0] = Number.MAX_SAFE_INTEGER + 1; }],
    ['out-of-range index', (f: any) => { f.bindings[0].segmentIndexes[1] = 100; }],
    ['noncontiguous indexes', (f: any) => { f.bindings[0].segmentIndexes[1] = 2; f.bindings[0].segmentSha256s[1] = sha256(f.projection.parts[0].segments[2]); }],
    ['reversed indexes', (f: any) => { f.bindings[0].segmentIndexes.reverse(); f.bindings[0].segmentSha256s.reverse(); }],
    ['duplicate segment index', (f: any) => { f.bindings[0].segmentIndexes[1] = 0; }],
    ['missing segment hashes', (f: any) => { delete f.bindings[0].segmentSha256s; }],
    ['hash array length', (f: any) => { f.bindings[0].segmentSha256s.pop(); }],
    ['wrong segment hash', (f: any) => { f.bindings[0].segmentSha256s[0] = otherHash; }],
    ['reversed segment hashes', (f: any) => { f.bindings[0].segmentSha256s.reverse(); }],
    ['duplicate prompt map', (f: any) => { f.prompts[1] = { ...f.prompts[0] }; f.bindings[1] = clone(f.bindings[0]); }],
    ['missing binding', (f: any) => { f.bindings.pop(); }],
    ['reordered bindings', (f: any) => { f.bindings.reverse(); }],
  ]);
  });

  it('rejects malformed projections, duplicate parts and altered original prose', () => { checkMutations([
    ['missing projection', (f: any) => { delete f.body.publicationReaderProjection; }],
    ['null projection', (f: any) => { f.body.publicationReaderProjection = null; }],
    ['wrong projection contract', (f: any) => { f.projection.contract = 'old-contract'; }],
    ['malformed manuscript hash', (f: any) => { f.projection.manuscriptHash = 'not-a-hash'; }],
    ['different manuscript hash', (f: any) => { f.projection.manuscriptHash = otherHash; }],
    ['nonarray projection parts', (f: any) => { f.projection.parts = {}; }],
    ['duplicate projection part key', (f: any) => { f.projection.parts[1] = clone(f.projection.parts[0]); }],
    ['missing projection part', (f: any) => { f.projection.parts.pop(); }],
    ['wrong projection title', (f: any) => { f.projection.parts[0].title = 'Changed title'; }],
    ['wrong projection source hash', (f: any) => { f.projection.parts[0].sourcePartSha256 = otherHash; }],
    ['nonarray reader segments', (f: any) => { f.projection.parts[0].segments = {}; }],
    ['blank reader segment', (f: any) => { f.projection.parts[0].segments[0] = ' '; }],
    ['nonstring reader segment', (f: any) => { f.projection.parts[0].segments[0] = 42; }],
    ['changed reader prose', (f: any) => { f.projection.parts[0].segments[0] = 'Text absent from the original source'; }],
    ['duplicate source part key', (f: any) => { f.body.parts[1] = clone(f.body.parts[0]); }],
    ['missing source parts', (f: any) => { delete f.body.parts; }],
    ['changed source part text', (f: any) => { f.body.parts[0].paragraphs[0].text += ' Changed.'; }],
  ]);
  });

  it('rejects segment arrays above the bounded 1000-segment limit', () => {
    const f = fixture(['part-1'], 1000, true);
    expect(verify(f)).toEqual(f.bindings);
    f.bindings[0].segmentIndexes.push(1000); f.bindings[0].segmentSha256s.push(otherHash);
    expectInvalid(() => verify(f));
  });

  it('rejects two different scene keys claiming the same reader segments', () => {
    const f = fixture(); f.prompts[1].sourceSceneKey = 'second-camera';
    f.bindings[1] = { ...clone(f.bindings[0]), sourceSceneKey: 'second-camera', promptSha256: f.prompts[1].promptSha256 };
    expectInvalid(() => verify(f));
  });

  it('does not treat null or an object as missing legacy bindings', () => {
    const f = fixture();
    for (const bindings of [null, {}]) expectInvalid(() => verifiedPublicationVisualBindings(f.body, f.prompts, bindings, f.prepared.contentHash));
  });

  it('missing legacy bindings return null, including bodies without a projection', () => {
    const f = fixture();
    expect(verifiedPublicationVisualBindings(f.body, f.prompts, undefined, f.prepared.contentHash)).toBeNull();
    expect(verifiedPublicationVisualBindings(storedManuscriptBody(f.prepared), f.prompts, undefined, f.prepared.contentHash)).toBeNull();
  });
});

describe('publication visual reference preview', () => {
  it('exact mappings remain reference-only and require explicit scene review', () => {
    const f = fixture(), result = preview(f);
    expect(result).toMatchObject({ contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only',
      manuscriptHash: f.prepared.contentHash, checksum: releaseChecksum(f.prompts), totalReferences: 3,
      mappedReferences: 3, mappingState: 'exact_source_segments', requiresSceneReview: true, truncated: false });
    expect(result.items.map(item => item.binding)).toEqual(f.bindings);
    expect(result.items.every(item => item.promptTruncated === false)).toBe(true);
    expect(result).not.toHaveProperty('approved');
  });

  it('legacy previews are unmapped references and never acquire synthetic bindings or approval', () => {
    const f = fixture();
    const result = publicationVisualReferencePreview(storedManuscriptBody(f.prepared), f.prepared.contentHash,
      releaseChecksum(f.prompts), f.prompts, undefined);
    expect(result).toMatchObject({ approvalState: 'reference_only', mappingState: 'unmapped_legacy',
      mappedReferences: 0, totalReferences: 3, requiresSceneReview: true });
    result.items.forEach(item => expect(item).not.toHaveProperty('binding'));
  });

  it('shows at most eight of nine prompts without silently changing total or mapped counts', () => {
    const f = fixture(Array.from({ length: 9 }, (_, index) => `part-${1 + index * 8}`)), result = preview(f);
    expect(result.items).toHaveLength(8); expect(result.totalReferences).toBe(9);
    expect(result.mappedReferences).toBe(9); expect(result.truncated).toBe(true);
    expect(result.items.map(item => item.sourceSceneKey)).toEqual(f.prompts.slice(0, 8).map(prompt => prompt.sourceSceneKey));
  });

  it.each([999, 1000, 1001])('bounds a %i-codepoint Unicode prompt excerpt without splitting surrogate pairs', length => {
    const text = '\u{1F9ED}'.repeat(length), f = fixture(['part-17'], 3, false, text), result = preview(f);
    const item = result.items[0];
    expect(Array.from(item.promptExcerpt as string)).toHaveLength(Math.min(length, 1000));
    expect(item.promptExcerpt).toBe(Array.from(text).slice(0, 1000).join(''));
    expect(item.promptTruncated).toBe(length > 1000);
    expect(item.promptSha256).toBe(sha256(text)); expect(item.promptSha256).toBe(f.bindings[0].promptSha256);
    if (length > 1000) expect(item.promptSha256).not.toBe(sha256(item.promptExcerpt as string));
    expect(result.truncated).toBe(false);
  });

  it.each([800, 1000])('caps the entire UTF-8 response at 64KiB with %i-entry segment arrays', segmentCount => {
    const f = fixture(Array.from({ length: 9 }, (_, index) => `part-${1 + index * 8}`), segmentCount, true,
      '\u{1F9ED}'.repeat(1500)), result = preview(f);
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(result.totalReferences).toBe(9); expect(result.mappedReferences).toBe(9);
    expect(result.items.length).toBeLessThan(8); expect(result.truncated).toBe(true);
    if (segmentCount === 800) expect(result.items.length).toBeGreaterThan(0);
    if (segmentCount === 1000) expect(result.items).toHaveLength(0);
    result.items.forEach((item, index) => {
      expect(item.binding).toEqual(f.bindings[index]);
      expect((item.binding as typeof f.bindings[number]).segmentIndexes).toHaveLength(segmentCount);
      expect(item.promptSha256).toBe(sha256(f.prompts[index].promptText));
      expect(Array.from(item.promptExcerpt as string)).toHaveLength(1000);
    });
  });

  it('an empty reference set is not truncated or approved', () => {
    const f = fixture(); const result = publicationVisualReferencePreview(f.body, f.prepared.contentHash, otherHash, [], []);
    expect(result).toMatchObject({ totalReferences: 0, mappedReferences: 0, items: [], truncated: false,
      approvalState: 'reference_only', requiresSceneReview: true });
  });

  it('rejects malformed mappings before producing an exact preview', () => {
    const f = fixture(); f.bindings[0].sourcePartSha256 = otherHash;
    expectInvalid(() => preview(f));
  });
});

describe('publication visual reference checksum integration', () => {
  it('accepts bound references without turning source guidance into approval', () => {
    const f = fixture(), body = referenceBody(f);
    expect(publicationVisualReference(body)).toEqual({ checksum: body.publicationVisualSource.checksum, bible: null, promptCount: 3 });
    expect(body.publicationVisualSource.approvalState).toBe('reference_only');
  });

  it('changing a binding invalidates the source-reference checksum', () => {
    const body = referenceBody(fixture()); body.publicationVisualSource.sceneBindings![0].partKey = 'part-9';
    expectInvalid(() => publicationVisualReference(body), 'STORY_VISUAL_SOURCE_REFERENCE_CHANGED');
  });

  it('rejects another manuscript hash even when the visual reference envelope is internally consistent', () => {
    const f = fixture(), body = referenceBody(f);
    expect(publicationVisualReference(body, f.prepared.contentHash)).toMatchObject({ promptCount: 3 });
    expectInvalid(() => publicationVisualReference(body, otherHash));
  });

  it('recomputing the envelope checksum cannot make a corrupt segment hash valid', () => {
    const body = referenceBody(fixture()); body.publicationVisualSource.sceneBindings![0].segmentSha256s[0] = otherHash;
    const { checksum: _checksum, ...reference } = body.publicationVisualSource;
    body.publicationVisualSource.checksum = releaseChecksum(reference);
    expectInvalid(() => publicationVisualReference(body));
  });

  it('legacy guidance is readable but remains unmapped reference-only', () => {
    const f = fixture(), body = referenceBody(f, false);
    expect(publicationVisualReference(body)).toMatchObject({ bible: null, promptCount: 3 });
    expect(verifiedPublicationVisualBindings(body, f.prompts, body.publicationVisualSource.sceneBindings)).toBeNull();
    expect(publicationVisualReferencePreview(body, f.prepared.contentHash, body.publicationVisualSource.checksum,
      f.prompts, undefined)).toMatchObject({ approvalState: 'reference_only', mappingState: 'unmapped_legacy', mappedReferences: 0 });
  });

  it('full prompt text mutation cannot hide behind the existing prompt hash', () => {
    const body = referenceBody(fixture()); body.publicationVisualSource.prompts[0].promptText += ' changed';
    const { checksum: _checksum, ...reference } = body.publicationVisualSource;
    body.publicationVisualSource.checksum = releaseChecksum(reference);
    expectInvalid(() => publicationVisualReference(body), 'STORY_VISUAL_SOURCE_REFERENCE_CHANGED');
  });
});

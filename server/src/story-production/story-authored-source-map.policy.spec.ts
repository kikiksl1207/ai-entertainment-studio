import { readFileSync } from 'fs';
import { authoredImportFixture } from './story-authored-import.test-fixture';
import { authoredHash, parseAuthoredImportMetadata, prepareAuthoredSourceMap } from './story-authored-source-map.policy';
import { prepareManuscript } from './story-manuscript-file.policy';

describe('authored compact source map validation', () => {
  it('preserves ordered source scenes, all narrative, acts and authored choice destinations', () => {
    const f = authoredImportFixture();
    const result = prepareAuthoredSourceMap(f.buffer, f.manuscript, f.ending);
    expect(result.counts).toEqual({ parts: 3, acts: 2, sourceScenes: 6, beats: 6, choices: 9,
      verifiedDesignPrompts: 6, verifiedVisualAssets: 0 });
    expect(result.parts.map(part => part.actNumber)).toEqual([1, 2, 2]);
    expect(result.parts[0].choices[0].destination).toEqual({ kind: 'part', partKey: 'part-002' });
    expect(result.parts[2].choices[0].destination).toEqual({ kind: 'ending', endingKey: 'author_main', provenance: 'author_main' });
    expect(result.parts.flatMap(part => part.choices.slice(1)).every(choice =>
      choice.routeKind === 'generation_required' && choice.destination === null)).toBe(true);
    const publicText = result.parts.flatMap(part => part.packing.beats.map(beat => beat.text)).join('');
    expect(publicText).toContain('Synthetic narrative after direction.');
    expect(publicText).not.toMatch(/PRIVATE_|###|##/);
    expect(result.endingResolution.approval).toBe('not_bound');
    expect(result.parts[0].packing.beats.map(beat => beat.sourceSceneKey)).toEqual(['part-001-scene-001', 'part-001-scene-002']);
  });

  it.each([
    ['missing part', (r: any) => r.parts.pop()],
    ['reordered parts', (r: any) => r.parts.reverse()],
    ['reordered paragraphs', (r: any) => r.parts[0].paragraphSegments.reverse()],
    ['missing scene', (r: any) => r.parts[0].scenes.pop()],
    ['reused scene key', (r: any) => { r.parts[1].scenes[0].sceneKey = r.parts[0].scenes[0].sceneKey; }],
    ['dropped byte', (r: any) => r.parts[0].segmentBytes.pop()],
    ['invalid UTF8 boundary', (r: any) => { const size = r.parts[0].segmentBytes[2]; r.parts[0].segmentBytes[2] = 6; r.parts[0].segmentBytes[3] += size - 6; }],
    ['changed source', (r: any) => { r.parts[0].text += 'hidden'; }],
    ['missing design', (r: any) => r.designs.pop()],
    ['changed design', (r: any) => { r.designs[0].text += 'hidden'; }],
    ['forged design count', (r: any) => { r.designs[0].designObserved = 999; }],
    ['forced B rejoin', (r: any) => { r.parts[0].choices[1].targetPartKey = 'part-002'; }],
    ['extra choice', (r: any) => r.parts[0].choices.push(r.parts[0].choices[0])],
    ['act changed', (r: any) => { r.parts[1].act = 1; }],
    ['analysis hash changed', (r: any) => { r.analysisPayloadSha256 = 'b'.repeat(64); }],
    ['caller ready flag', (r: any) => { r.ready = true; }],
  ])('rejects %s without reflecting private text', (_name, mutate) => {
    const f = authoredImportFixture();
    mutate(f.root);
    expect(() => prepareAuthoredSourceMap(Buffer.from(JSON.stringify(f.root)), f.manuscript, f.ending))
      .toThrow('Authored source map failed bounded validation');
  });

  it('cannot replace independently stored manuscript text using consistent caller-side hashes', () => {
    const f = authoredImportFixture();
    const changed = structuredClone(f.root);
    changed.parts[0].text = changed.parts[0].text.replace('narrative one', 'narrative two');
    changed.parts[0].sourceSha256 = authoredHash(changed.parts[0].text);
    changed.sourceInventory.find(entry => entry.path === changed.parts[0].sourcePath)!.sha256 = changed.parts[0].sourceSha256;
    const changedPrimary = changed.primaryAssembly.parts.map((entry, i) => entry.before +
      changed.parts[i].text.replace(/\r\n/g, '\n').replace(/[\r\n]+$/, '')).join('') + changed.primaryAssembly.after;
    changed.sourceInventory.find(entry => entry.path === changed.primaryAssembly.sourcePath)!.sha256 = authoredHash(changedPrimary);
    changed.sourceInventorySha256 = authoredHash(JSON.stringify(changed.sourceInventory));
    expect(() => prepareAuthoredSourceMap(Buffer.from(JSON.stringify(changed)), f.manuscript, f.ending)).toThrow();
  });

  it('does not claim uploaded inventory entries prove unreceived original files', () => {
    const f = authoredImportFixture();
    f.root.sourceInventory.push({ path: 'unreceived/other.md', bytes: 123, sha256: 'f'.repeat(64) });
    f.root.sourceInventorySha256 = authoredHash(JSON.stringify(f.root.sourceInventory));
    const result = prepareAuthoredSourceMap(Buffer.from(JSON.stringify(f.root)), f.manuscript, f.ending);
    expect(result.identityEvidence.submittedInventory).toMatchObject({ entryCount: 9,
      uncoveredEntryCount: 1, originalFilesystemVerifiedByServer: false });
    expect(result.identityEvidence.serverVerified.coveredSourceFileCount).toBe(8);
    expect(result.endingResolution.approval).toBe('not_bound');
  });

  it.each(['\uBC30\uACBD', '\uBC30\uACBD \uC774\uBBF8\uC9C0', '\uB4F1\uC7A5 \uC778\uBB3C', '\uB4F1\uC7A5\uC778\uBB3C',
    '\uC774\uC804 \uC120\uD0DD', '\uC774\uC804 \uC120\uD0DD \uC694\uC57D', '- \uC774\uC804 \uC120\uD0DD \uC694\uC57D'])(
    'keeps pre-scene production field %s private while verifying stored analysis agreement', label => {
      const f = authoredImportFixture({ preSceneProduction: `${label}: PRIVATE_SYNTHETIC_PREFACE` });
      const result = prepareAuthoredSourceMap(f.buffer, f.manuscript, f.ending);
      expect(result.counts.sourceScenes).toBe(6);
      expect(result.parts.flatMap(part => part.packing.beats).some(beat => beat.text.includes('PRIVATE_SYNTHETIC_PREFACE'))).toBe(false);
      expect(result.provenance.parts[0]).toMatchObject({ preSceneProductionSegments: [2] });
      expect((result.provenance.parts[0].analysisParagraphSegments as number[]).includes(2)).toBe(true);
    });

  it('keeps the exact previous-choice/cast/time bullet group private without accepting arbitrary multiline introductions', () => {
    const f = authoredImportFixture({ preSceneProduction: '- \uC774\uC804 \uC120\uD0DD \uC694\uC57D: PRIVATE_SUMMARY\n- \uB4F1\uC7A5 \uC778\uBB3C: PRIVATE_CAST\n- \uC2DC\uAC04: PRIVATE_TIME' });
    const result = prepareAuthoredSourceMap(f.buffer, f.manuscript, f.ending);
    expect(result.parts.flatMap(part => part.packing.beats).some(beat => beat.text.includes('PRIVATE_'))).toBe(false);
    expect(result.provenance.parts[0]).toMatchObject({ preSceneProductionSegments: [2] });
  });

  it.each(['Unknown production: PRIVATE_UNMAPPED', 'Legitimate introductory narration without a scene marker.',
    '\uBC30\uACBD\uC740: narrative-like label, not a declared field', '\uBC30\uACBD : near-match label',
    '\uC2DC\uAC04: standalone narrative-like introduction',
    '\uBC30\uACBD: PRIVATE_FIELD\nOrdinary narrative must not disappear.'])(
    'rejects unmapped or near-match introduction %# instead of guessing a visual binding', preSceneProduction => {
    const f = authoredImportFixture({ preSceneProduction });
    expect(() => prepareAuthoredSourceMap(f.buffer, f.manuscript, f.ending)).toThrow();
  });

  it('rejects unbound ending intent, duplicate keys, invalid UTF8 and oversize', () => {
    const f = authoredImportFixture();
    expect(() => prepareAuthoredSourceMap(f.buffer, f.manuscript, { endingKey: 'author_main', evidenceSegment: 0 })).toThrow();
    expect(() => prepareAuthoredSourceMap(Buffer.from('{"contract":1,"contract":2}'), f.manuscript, f.ending)).toThrow();
    expect(() => prepareAuthoredSourceMap(Buffer.from([0xff]), f.manuscript, f.ending)).toThrow();
    expect(() => prepareAuthoredSourceMap(Buffer.alloc(16 * 1024 * 1024 + 1), f.manuscript, f.ending)).toThrow();
    expect(() => parseAuthoredImportMetadata('{"apply":false,"apply":true}')).toThrow();
    expect(() => parseAuthoredImportMetadata('[')).toThrow();
  });

  const actualMap = process.env.AUTHORED_SOURCE_MAP_PATH;
  const actualAnalysis = process.env.AUTHORED_ANALYSIS_INPUT_PATH;
  (actualMap && actualAnalysis ? it : it.skip)('reconciles the complete actual source without emitting prose (optional readonly fixture)', () => {
    const buffer = readFileSync(actualMap!);
    const analysis = readFileSync(actualAnalysis!);
    const before = [authoredHash(buffer), authoredHash(analysis)];
    const root = JSON.parse(buffer.toString('utf8'));
    const finalA = root.parts.at(-1).choices[0];
    const finalAEvidenceSegments = Array.isArray(finalA.evidenceSegments) ? finalA.evidenceSegments :
      Array.isArray(finalA.evidence) ? finalA.evidence.map((item: any) => item.segment) : [];
    const evidence = root.endingEvidence.find((item: any) => item.part === root.parts.length &&
      finalAEvidenceSegments.includes(item.source.segment) && item.provenanceClaims.includes('author_default'));
    const result = prepareAuthoredSourceMap(buffer, prepareManuscript(analysis),
      { endingKey: 'author_main', evidenceSegment: evidence.source.segment });
    expect(result.counts).toMatchObject({ parts: 216, acts: 11, sourceScenes: 2138, choices: 648,
      verifiedDesignPrompts: 2138, verifiedVisualAssets: 0 });
    expect(result.parts.every(part => part.packing.beats.length <= 40)).toBe(true);
    expect([authoredHash(readFileSync(actualMap!)), authoredHash(readFileSync(actualAnalysis!))]).toEqual(before);
  });
});

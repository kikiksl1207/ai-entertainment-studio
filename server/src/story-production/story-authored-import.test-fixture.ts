import { authoredHash } from './story-authored-source-map.policy';
import { prepareManuscript } from './story-manuscript-file.policy';

// Small invented text only. This is not a public story, approval, or source asset.
export function authoredImportFixture(options: { preSceneProduction?: string } = {}) {
  const inventory: Array<{ path: string; bytes: number; sha256: string }> = [];
  function source(path: string, text: string) {
    const identity = { path, bytes: Buffer.byteLength(text), sha256: authoredHash(text) };
    inventory.push(identity);
    return identity;
  }
  const parts: any[] = [];
  const analysisParts: any[] = [];
  const rows: any[] = [];
  const designs: any[] = [];
  const endingEvidence: any[] = [];
  let endingEvidenceSegment = 0;
  for (let n = 1; n <= 3; n++) {
    const partKey = `part-${String(n).padStart(3, '0')}`;
    const title = `Local synthetic part ${n}`;
    const blocks = [`# Part ${n} - ${title}\n`, '\n',
      '### \uC7A5\uBA74 1: Synthetic first scene\n', 'Synthetic narrative one.\r\n', '\r\n',
      '[\uBC30\uACBD: PRIVATE_SYNTHETIC_DIRECTION]\n', '\n', 'Synthetic narrative after direction.\n', '\n',
      '### \uC7A5\uBA74 2: Synthetic second scene\n', 'Synthetic narrative two.\n', '\n',
      '## \uC120\uD0DD\uC9C0\n', '\n'];
    const preSceneOffset = n === 1 && options.preSceneProduction ? 2 : 0;
    if (preSceneOffset) blocks.splice(2, 0, `${options.preSceneProduction}\n`, '\n');
    const choices: any[] = [];
    for (const [i, label] of ['A', 'B', 'C'].entries()) {
      const segment = blocks.length;
      blocks.push(`### \uC120\uD0DD ${label} - Local synthetic choice ${label}\n`);
      blocks.push(n === 3 && i === 0 ? '\uC791\uAC00 \uC5D4\uB529: PRIVATE_SYNTHETIC_ENDING_NOTE\n' : 'PRIVATE_SYNTHETIC_CHOICE_NOTE\n');
      blocks.push('\n');
      choices.push({ choiceKey: `${partKey}-${label}`, label, readerOrdinal: i + 1, segment,
        evidenceSegments: [segment, segment + 1], targetPartKey: i === 0 && n < 3 ? `part-00${n + 1}` : null,
        resolution: i > 0 ? 'ai_required_unresolved' : n < 3 ? 'authored_a_candidate' : 'ending_resolution_required' });
      if (n === 3 && i === 0) {
        endingEvidenceSegment = segment + 1;
        const byteStart = Buffer.byteLength(blocks.slice(0, segment + 1).join(''));
        endingEvidence.push({ part: n, source: { fileId: `part-source-00${n}`, segment: segment + 1,
          byteStart, byteEnd: byteStart + Buffer.byteLength(blocks[segment + 1]),
          lineStart: segment + 2, lineEnd: segment + 2, sha256: authoredHash(blocks[segment + 1]) },
        provenanceClaims: ['author_default'], status: 'source_claim_unresolved' });
      }
    }
    const text = blocks.join('');
    const identity = source(`parts/${n}.md`, text);
    const paragraphSegments = [...(preSceneOffset ? [2] : []), ...[2, 3, 7, 9, 10].map(i => i + preSceneOffset)];
    const metadataSegments = blocks.flatMap((block, i) => block.trim() && !paragraphSegments.includes(i) ? [i] : []);
    const scenes = [2, 9].map((segment, i) => ({ sceneKey: `${partKey}-scene-00${i + 1}`, segment: segment + preSceneOffset }));
    parts.push({ partKey, number: n, act: n === 1 ? 1 : 2, title, sourceFileId: `part-source-00${n}`,
      sourcePath: identity.path, sourceSha256: identity.sha256, sourceBytes: identity.bytes,
      text, segmentBytes: blocks.map(block => Buffer.byteLength(block)), paragraphSegments, metadataSegments, scenes, choices });
    analysisParts.push({ partKey, title, paragraphs: paragraphSegments.map(index => ({
      kind: scenes.some(scene => scene.segment === index) ? 'scene_break' : 'paragraph', text: blocks[index] })) });
    const designText = '# Synthetic design\n\n- \uC774\uBBF8\uC9C0 \uC9C0\uC2DC: PRIVATE_ONE\n\n- \uC774\uBBF8\uC9C0 \uC9C0\uC2DC: PRIVATE_TWO\n';
    const designIdentity = source(`design/${n}.md`, designText);
    const designBlocks = designText.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)!.filter(Boolean);
    designs.push({ part: n, declared: 2, designObserved: 2, inlineObserved: 0, selectedObserved: 2,
      sourcePath: designIdentity.path, sourceSha256: designIdentity.sha256, text: designText,
      segmentBytes: designBlocks.map(block => Buffer.byteLength(block)) });
    rows.push({ part: n, part_id: String(n), act: n === 1 ? 1 : 2, title,
      manuscript: identity.path, scene_design: designIdentity.path, scenes: 2, image_prompts: 2, choices: 3,
      official_a_next_part: n < 3 ? n + 1 : null });
  }
  const sourceManifest = { path: 'manifest.json', text: JSON.stringify({ schema_version: 'lumina-stage-story-v1',
    parts: 3, acts: 2, scenes: 6, image_prompts: 6, choices: 9, parts_index: rows }) };
  source(sourceManifest.path, sourceManifest.text);
  source('primary.md', parts.map(part => part.text.replace(/\r\n/g, '\n').replace(/[\r\n]+$/, '')).join('\n\n'));
  const manuscript = prepareManuscript(Buffer.from(JSON.stringify({ locale: 'ko', parts: analysisParts })));
  const root = { contract: 'story-authored-source-map-v1', locale: 'ko', packageSha256: 'a'.repeat(64),
    analysisPayloadSha256: manuscript.source.sha256, sourceInventorySha256: authoredHash(JSON.stringify(inventory)),
    sourceInventory: inventory, sourceManifest, primaryPreamble: { sourcePath: 'primary.md', bytes: 0, segments: [], classifications: [] },
    primaryAssembly: { sourcePath: 'primary.md', parts: parts.map((part, i) => ({ before: i === 0 ? '' : '\n\n', partKey: part.partKey })), after: '' },
    indexFieldObservations: [], parts, designs, endingEvidence,
    actResetCandidates: [{ act: 1, entryPartKey: 'part-001', runtimeBinding: null },
      { act: 2, entryPartKey: 'part-002', runtimeBinding: null }] };
  return { root, manuscript, buffer: Buffer.from(JSON.stringify(root)),
    ending: { endingKey: 'author_main' as const, evidenceSegment: endingEvidenceSegment } };
}

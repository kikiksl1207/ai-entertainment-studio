import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'crypto';
import { TextDecoder } from 'util';
import { packAuthoredSceneBeats } from './story-authored-beat-packing.policy';
import { AUTHORED_INITIAL_IMPORT_LIMITS, AuthoredInitialPart, AuthoredSceneText } from './story-authored-import.contract';
import type { PreparedManuscript } from './story-manuscript-file.policy';

const SCENE = /^(?:\[|### )\uC7A5\uBA74\s*(\d+)\s*[:\].-]/;
const VISUAL = /^\[(?:\uBC30\uACBD|\uBC30\uACBD \uC774\uBBF8\uC9C0|\uB4F1\uC7A5|\uB4F1\uC7A5\uC778\uBB3C|\uD1F4\uC7A5)\s*:/;
const CHOICE = /^### \uC120\uD0DD ([A-Z])\s*-\s*(.+)$/;
const CHOICES = /^## (?:\uCD5C\uC885 )?\uC120\uD0DD\uC9C0(?: 3\uAC1C)?$/;
const BODY = '## \uBCF8\uBB38 \uC6D0\uACE0';
const PRE_SCENE_PRODUCTION = /^(?:- )?(?:\uBC30\uACBD(?: \uC774\uBBF8\uC9C0)?|\uB4F1\uC7A5 ?\uC778\uBB3C|\uC774\uC804 \uC120\uD0DD(?: \uC694\uC57D)?):[^\r\n]*(?:\r\n|\r|\n)?$/;
const PRE_SCENE_PRODUCTION_GROUP = /^- \uC774\uC804 \uC120\uD0DD \uC694\uC57D:[^\r\n]+(?:\r\n|\r|\n)- \uB4F1\uC7A5 \uC778\uBB3C:[^\r\n]+(?:\r\n|\r|\n)- \uC2DC\uAC04:[^\r\n]+(?:\r\n|\r|\n)?$/;
const PRIVATE_SECTIONS = new Set([
  '## \uC774\uC804 \uC120\uD0DD \uC694\uC57D', '## \uBC30\uACBD \uD55C \uC904',
  '## \uB2E4\uC74C \uD30C\uD2B8 \uC5F0\uACB0 \uC815\uBCF4', '## \uB4F1\uC7A5 \uC778\uBB3C',
  '## \uD30C\uD2B8 \uC0C1\uD0DC \uC694\uC57D', '## \uC7A5\uBA74\uBCC4 \uBC30\uACBD \uC774\uBBF8\uC9C0 \uC9C0\uC2DC',
  '## \uC7A5\uBA74\uBCC4 \uC774\uBBF8\uC9C0 \uC9C0\uC2DC', '## \uC791\uD488 \uC644\uACB0 \uB4A4 \uC778\uACC4 \uC815\uBCF4',
  '## AI \uC5F0\uACB0\uBD80 \uC0DD\uC131\uC6A9 \uC694\uC57D', '## AI \uC5F0\uACB0\uBD80 \uC0DD\uC131\uC6A9 \uCD5C\uC885 \uC694\uC57D',
]);
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export type AuthoredEndingIntent = { endingKey: 'author_main' | 'author_sub'; evidenceSegment: number };

function invalid(code = 'AUTHORED_SOURCE_MAP_INVALID'): never {
  throw new BadRequestException({ code, message: 'Authored source map failed bounded validation' });
}
export function authoredHash(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }
function digest(value: unknown) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid();
  return value;
}
function text(value: unknown, max = 240): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || /[\uD800-\uDFFF]/u.test(value)) invalid();
  return value;
}
function integer(value: unknown, max: number, min = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
}
function object(value: unknown, keys?: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (keys && (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key)))) invalid();
  return value as Record<string, any>;
}
function array(value: unknown, max: number): any[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function equal(a: unknown, b: unknown, code: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) invalid(code);
}
function pathKey(value: unknown) {
  const path = text(value, 512);
  if (!path || path.startsWith('/') || /[\\:]/.test(path) || path.split('/').some(x => !x || x === '.' || x === '..')) invalid();
  return path;
}

function parse(textValue: string): unknown {
  const stack: Array<{ object: boolean; key: boolean; keys: Set<string> }> = [];
  for (let i = 0; i < textValue.length; i++) {
    const c = textValue[i];
    if (c === '"') {
      const start = i++;
      while (i < textValue.length && textValue[i] !== '"') { if (textValue[i] === '\\') i++; i++; }
      const frame = stack.at(-1);
      if (frame?.object && frame.key) {
        let key: string;
        try { key = JSON.parse(textValue.slice(start, i + 1)); } catch { invalid(); }
        if (frame.keys.has(key)) invalid('AUTHORED_DUPLICATE_JSON_MEMBER');
        frame.keys.add(key); frame.key = false;
      }
    } else if (c === '{' || c === '[') {
      stack.push({ object: c === '{', key: c === '{', keys: new Set() });
      if (stack.length > 16) invalid('AUTHORED_NESTING_LIMIT');
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.at(-1)?.object) stack.at(-1)!.key = true;
  }
  try { return JSON.parse(textValue); } catch { invalid(); }
}

function decode(buffer: Buffer) {
  try { return decoder.decode(buffer); } catch { invalid('AUTHORED_UTF8_INVALID'); }
}

export function parseAuthoredImportMetadata(value: string): Record<string, unknown> {
  if (Buffer.byteLength(value) > 8192) invalid('AUTHORED_METADATA_LIMIT');
  return object(parse(value));
}

type Segment = { text: string; start: number; end: number; blank: boolean; lineStart: number; lineEnd: number };
function segmentsFor(raw: unknown, sizesValue: unknown): Segment[] {
  const rawText = text(raw, AUTHORED_INITIAL_IMPORT_LIMITS.sourceMapFileBytes);
  const bytes = Buffer.from(rawText, 'utf8');
  const sizes = array(sizesValue, 20_000);
  const segments: Segment[] = [];
  let cursor = 0;
  let line = 1;
  for (const sizeValue of sizes) {
    const size = integer(sizeValue, bytes.length, 1);
    if (cursor + size > bytes.length) invalid('AUTHORED_SPAN_OVERFLOW');
    const segment = decode(bytes.subarray(cursor, cursor + size));
    const lineCount = [...segment.matchAll(/\r\n|\n|\r/g)].length;
    segments.push({ text: segment, start: cursor, end: cursor + size, blank: !segment.trim(),
      lineStart: line, lineEnd: line + lineCount - (/[\r\n]$/.test(segment) ? 1 : 0) });
    cursor += size; line += lineCount;
  }
  if (cursor !== bytes.length || !segments.length) invalid('AUTHORED_SPAN_COVERAGE');
  // Verify the adapter's partition independently, so supplied boundaries cannot
  // hide narrative inside a heading or a private production marker.
  const canonical: Array<{ size: number; blank: boolean; marker: boolean }> = [];
  for (const match of rawText.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    const chunk = match[0];
    if (!chunk) continue;
    const blank = !chunk.trim();
    const marker = chunk.startsWith('#') || /^[A-Z]\. /.test(chunk) || SCENE.test(chunk) || VISUAL.test(chunk);
    const previous = canonical.at(-1);
    if (previous && previous.blank === blank && !marker && !previous.marker) previous.size += Buffer.byteLength(chunk);
    else canonical.push({ size: Buffer.byteLength(chunk), blank,
      marker: chunk.startsWith('#') || SCENE.test(chunk) || VISUAL.test(chunk) });
  }
  equal(sizes, canonical.map(segment => segment.size), 'AUTHORED_SEGMENT_PARTITION_INVALID');
  return segments;
}

export function prepareAuthoredSourceMap(buffer: Buffer, manuscript: PreparedManuscript, ending: AuthoredEndingIntent) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) invalid();
  if (buffer.length > AUTHORED_INITIAL_IMPORT_LIMITS.sourceMapFileBytes) throw new PayloadTooLargeException({ code: 'AUTHORED_SOURCE_MAP_LIMIT' });
  const sourceMapSha256 = authoredHash(buffer);
  const root = object(parse(decode(buffer)), ['contract', 'locale', 'packageSha256', 'analysisPayloadSha256',
    'sourceInventorySha256', 'sourceInventory', 'sourceManifest', 'primaryPreamble', 'indexFieldObservations',
    'parts', 'designs', 'endingEvidence', 'actResetCandidates', 'primaryAssembly']);
  if (root.contract !== 'story-authored-source-map-v1' || root.locale !== manuscript.locale ||
      root.analysisPayloadSha256 !== manuscript.source.sha256) invalid('AUTHORED_MANUSCRIPT_BINDING_MISMATCH');
  // The original package serialization is not uploaded. This is declared
  // provenance, not a server-verified hash of that original package.
  const declaredPackageSha256 = digest(root.packageSha256);
  const inventory = array(root.sourceInventory, 10_000);
  const inventoryByPath = new Map<string, { bytes: number; sha256: string }>();
  for (const item of inventory) {
    const entry = object(item, ['path', 'bytes', 'sha256']);
    const path = pathKey(entry.path);
    if (inventoryByPath.has(path)) invalid();
    inventoryByPath.set(path, { bytes: integer(entry.bytes, 64 * 1024 * 1024), sha256: digest(entry.sha256) });
  }
  const submittedInventorySha256 = authoredHash(JSON.stringify(inventory));
  if (submittedInventorySha256 !== root.sourceInventorySha256) invalid('AUTHORED_INVENTORY_DIGEST_MISMATCH');
  const coveredSourcePaths = new Set<string>();
  function sourceIdentity(path: unknown, raw: string) {
    const entry = inventoryByPath.get(pathKey(path));
    if (!entry || entry.bytes !== Buffer.byteLength(raw) || entry.sha256 !== authoredHash(raw)) invalid('AUTHORED_SOURCE_IDENTITY_MISMATCH');
    coveredSourcePaths.add(pathKey(path));
    return entry;
  }
  const manifestSource = object(root.sourceManifest, ['path', 'text']);
  const manifestText = text(manifestSource.text, 1024 * 1024);
  const manifestIdentity = sourceIdentity(manifestSource.path, manifestText);
  const manifest = object(parse(manifestText));
  if (manifest.schema_version !== 'lumina-stage-story-v1') invalid('AUTHORED_MANIFEST_VERSION_UNSUPPORTED');
  const parts = array(root.parts, AUTHORED_INITIAL_IMPORT_LIMITS.parts);
  const index = array(manifest.parts_index, AUTHORED_INITIAL_IMPORT_LIMITS.parts);
  const designs = array(root.designs, AUTHORED_INITIAL_IMPORT_LIMITS.parts);
  if (!parts.length || parts.length !== index.length || parts.length !== manuscript.parts.length ||
      parts.length !== designs.length || parts.length !== manifest.parts) invalid('AUTHORED_PART_COVERAGE_MISMATCH');
  const primarySha256 = validatePrimary(root.primaryPreamble, root.primaryAssembly, parts, sourceIdentity);
  for (const value of array(root.indexFieldObservations, 1000)) {
    const observation = object(value, ['field', 'part', 'csvRecord', 'observedCsv', 'selectedSource', 'manifestPointer']);
    const part = integer(observation.part, parts.length, 1);
    if (observation.field !== 'sources' || observation.observedCsv !== 'System.Object[]' || observation.selectedSource !== 'manifest' ||
        observation.csvRecord !== part + 1 || observation.manifestPointer !== `/parts_index/${part - 1}/sources`) invalid('AUTHORED_UNMAPPED_INDEX_OBSERVATION');
  }
  const sourcePaths = new Set<string>();
  const sceneKeys = new Set<string>();
  let priorAct = 1;
  let observedScenes = 0;
  let observedImages = 0;
  const provenance: Array<Record<string, unknown>> = [];
  const preparedParts: AuthoredInitialPart[] = parts.map((value, partIndex) => {
    const part = object(value, ['partKey', 'number', 'act', 'title', 'sourceFileId', 'sourcePath', 'sourceSha256',
      'sourceBytes', 'text', 'segmentBytes', 'paragraphSegments', 'metadataSegments', 'scenes', 'choices']);
    const row = object(index[partIndex]);
    const stored = manuscript.parts[partIndex];
    const position = partIndex + 1;
    const partKey = text(part.partKey, 80);
    const act = integer(part.act, parts.length, 1);
    if (part.number !== position || row.part !== position || Number(row.part_id) !== position ||
        row.act !== act || act < priorAct || act > priorAct + 1 || (partIndex === 0 && act !== 1) ||
        partKey !== stored.partKey || part.title !== stored.title) invalid('AUTHORED_PART_ORDER_MISMATCH');
    priorAct = act;
    const raw = text(part.text, 1024 * 1024);
    const identity = sourceIdentity(part.sourcePath, raw);
    if (sourcePaths.has(part.sourcePath) || row.manuscript !== part.sourcePath ||
        identity.sha256 !== part.sourceSha256 || identity.bytes !== part.sourceBytes) invalid('AUTHORED_PART_IDENTITY_MISMATCH');
    sourcePaths.add(part.sourcePath);
    const segments = segmentsFor(raw, part.segmentBytes);
    const sourceScenes = array(part.scenes, 40).map(value => object(value, ['sceneKey', 'segment']));
    const sceneBySegment = new Map<number, string>();
    sourceScenes.forEach((scene, i) => {
      const key = text(scene.sceneKey, 160);
      const segment = integer(scene.segment, segments.length - 1);
      const marker = segments[segment].text.match(SCENE);
      if (!marker || Number(marker[1]) !== i + 1 || sceneKeys.has(key) ||
          key !== `${partKey}-scene-${String(i + 1).padStart(3, '0')}`) invalid('AUTHORED_SCENE_ORDER_MISMATCH');
      sceneKeys.add(key); sceneBySegment.set(segment, key);
    });
    const sceneTexts: AuthoredSceneText[] = [];
    const observedParagraphs: number[] = [];
    const observedMetadata: number[] = [];
    const preSceneProduction: number[] = [];
    const observedChoices: Array<{ label: string; text: string; segment: number; evidence: number[] }> = [];
    let mode: 'body' | 'metadata' | 'choices' = 'body';
    let currentChoice: typeof observedChoices[number] | null = null;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const line = segment.text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)[0];
      if (segment.blank) {
        if (mode === 'body' && sceneTexts.length) sceneTexts.at(-1)!.text += segment.text;
        continue;
      }
      if (!observedChoices.length && SCENE.test(line)) mode = 'body';
      if (line.startsWith('# Part ')) {
        const heading = line.match(/^# Part (\d+)\s*[-:]\s*(.+)$/);
        if (i !== 0 || !heading || Number(heading[1]) !== position || heading[2] !== part.title) invalid('AUTHORED_PART_HEADING_MISMATCH');
        observedMetadata.push(i); continue;
      }
      if (line.startsWith('## ')) {
        if (line === BODY) mode = 'body';
        else if (CHOICES.test(line)) mode = 'choices';
        else if (PRIVATE_SECTIONS.has(line)) mode = 'metadata';
        else invalid('AUTHORED_UNMAPPED_SECTION');
        currentChoice = null; observedMetadata.push(i); continue;
      }
      const choice = mode === 'choices' ? line.match(CHOICE) : null;
      if (choice) {
        currentChoice = { label: choice[1], text: choice[2].trim(), segment: i, evidence: [i] };
        observedChoices.push(currentChoice);
      } else if (currentChoice) currentChoice.evidence.push(i);
      if (mode !== 'body' || VISUAL.test(line)) { observedMetadata.push(i); continue; }
      observedParagraphs.push(i);
      // The existing intake includes these unheaded production fields in its
      // analysis projection. Verify them there, but never turn them into beats.
      if (!sceneTexts.length && (PRE_SCENE_PRODUCTION.test(segment.text) || PRE_SCENE_PRODUCTION_GROUP.test(segment.text))) {
        preSceneProduction.push(i); continue;
      }
      const sourceSceneKey = sceneBySegment.get(i);
      if (SCENE.test(line)) {
        if (!sourceSceneKey) invalid('AUTHORED_SCENE_UNMAPPED');
        sceneTexts.push({ sourceSceneKey, text: '' });
      } else {
        if (!sceneTexts.length || /^\s*\[[^\]\r\n]{1,80}:[^\]\r\n]*\]\s*$/m.test(segment.text) ||
            /^\s*\[[\uAC00-\uD7A3A-Za-z][\uAC00-\uD7A3A-Za-z ]{0,30}\s+\d+\s*\]\s*$/m.test(segment.text)) {
          invalid('AUTHORED_UNMAPPED_PRODUCTION_SYNTAX');
        }
        sceneTexts.at(-1)!.text += segment.text;
      }
    }
    equal(array(part.paragraphSegments, 5000), observedParagraphs, 'AUTHORED_PARAGRAPH_COVERAGE_MISMATCH');
    equal(array(part.metadataSegments, 20_000), observedMetadata, 'AUTHORED_METADATA_COVERAGE_MISMATCH');
    if (stored.paragraphs.length !== observedParagraphs.length) invalid('AUTHORED_MANUSCRIPT_PARAGRAPH_MISMATCH');
    observedParagraphs.forEach((segment, i) => {
      const kind = sceneBySegment.has(segment) ? 'scene_break' : 'paragraph';
      if (stored.paragraphs[i].kind !== kind || stored.paragraphs[i].text !== segments[segment].text) invalid('AUTHORED_MANUSCRIPT_PARAGRAPH_MISMATCH');
    });
    if (sceneTexts.length !== sourceScenes.length || sourceScenes.length !== row.scenes || !sourceScenes.length) invalid('AUTHORED_SCENE_COVERAGE_MISMATCH');
    const packing = packAuthoredSceneBeats(sceneTexts);
    const choices = array(part.choices, 3);
    if (choices.length !== 3 || observedChoices.length !== 3 || row.choices !== 3) invalid('AUTHORED_CHOICE_COVERAGE_MISMATCH');
    const target = partIndex + 1 < parts.length ? parts[partIndex + 1].partKey : null;
    if (row.official_a_next_part !== (target ? position + 1 : null)) invalid('AUTHORED_NEXT_PART_MISMATCH');
    const preparedChoices = choices.map((value, i) => {
      const choice = object(value, ['choiceKey', 'label', 'readerOrdinal', 'segment', 'evidenceSegments', 'targetPartKey', 'resolution']);
      const observed = observedChoices[i];
      const label = String.fromCharCode(65 + i);
      if (choice.label !== label || observed.label !== label || choice.readerOrdinal !== i + 1 ||
          choice.choiceKey !== `${partKey}-${label}` || choice.segment !== observed.segment ||
          !observed.text || observed.text.length > 500) invalid('AUTHORED_CHOICE_LABEL_MISMATCH');
      equal(choice.evidenceSegments, observed.evidence, 'AUTHORED_CHOICE_EVIDENCE_MISMATCH');
      if (choice.targetPartKey !== (i === 0 ? target : null) ||
          choice.resolution !== (i !== 0 ? 'ai_required_unresolved' : target ? 'authored_a_candidate' : 'ending_resolution_required')) invalid('AUTHORED_CHOICE_ROUTE_MISMATCH');
      if (i > 0) return { choiceKey: choice.choiceKey, label: observed.text, readerOrdinal: (i + 1) as 2 | 3,
        routeKind: 'generation_required' as const, destination: null };
      if (!target) validateEnding(root.endingEvidence, position, part.sourceFileId, segments, observed.evidence, ending);
      return { choiceKey: choice.choiceKey, label: observed.text, readerOrdinal: 1 as const,
        routeKind: 'writer_original' as const, destination: target ? { kind: 'part' as const, partKey: target as string }
          : { kind: 'ending' as const, endingKey: ending.endingKey, provenance: ending.endingKey } };
    }) as AuthoredInitialPart['choices'];
    const design = object(designs[partIndex], ['part', 'declared', 'designObserved', 'inlineObserved', 'selectedObserved',
      'sourcePath', 'sourceSha256', 'text', 'segmentBytes']);
    const designText = text(design.text, 1024 * 1024);
    const designIdentity = sourceIdentity(design.sourcePath, designText);
    if (design.part !== position || row.scene_design !== design.sourcePath || designIdentity.sha256 !== design.sourceSha256) invalid('AUTHORED_DESIGN_BINDING_MISMATCH');
    segmentsFor(designText, design.segmentBytes);
    const designCount = [...designText.matchAll(/^- \uC774\uBBF8\uC9C0 (?:\uD504\uB86C\uD504\uD2B8|\uC9C0\uC2DC):/gm)].length;
    let inImages = false;
    let inlineCount = 0;
    for (const line of raw.split(/\r\n|\r|\n/)) {
      if (line.startsWith('## ')) inImages = /^## \uC7A5\uBA74\uBCC4 (?:\uBC30\uACBD )?\uC774\uBBF8\uC9C0 \uC9C0\uC2DC/.test(line);
      else if (inImages && /^\d+\. /.test(line)) inlineCount++;
    }
    const imageCount = designCount || inlineCount;
    if (design.designObserved !== designCount || design.inlineObserved !== inlineCount ||
        design.selectedObserved !== imageCount || design.declared !== imageCount || row.image_prompts !== imageCount) invalid('AUTHORED_DESIGN_COVERAGE_MISMATCH');
    observedImages += imageCount; observedScenes += sourceScenes.length;
    provenance.push({ sourceFileId: text(part.sourceFileId, 100), sourceSha256: identity.sha256, sourceBytes: identity.bytes,
      segmentBytes: part.segmentBytes, analysisParagraphSegments: observedParagraphs,
      narrativeSegments: observedParagraphs.filter(segment => !preSceneProduction.includes(segment)),
      privateSegments: [...observedMetadata, ...preSceneProduction].sort((a, b) => a - b),
      preSceneProductionSegments: preSceneProduction,
      scenes: packing.scenes.map((scene, i) => ({ ...scene, markerSegment: sourceScenes[i].segment })),
      designSha256: designIdentity.sha256, designBytes: designIdentity.bytes, designSegmentBytes: design.segmentBytes });
    return { partKey, position, actNumber: act, title: text(part.title), sourceSha256: identity.sha256,
      sourceBytes: identity.bytes, packing, choices: preparedChoices };
  });
  if (manifest.scenes !== observedScenes || manifest.choices !== parts.length * 3 || manifest.acts !== priorAct ||
      manifest.image_prompts !== observedImages) invalid('AUTHORED_MANIFEST_TOTALS_MISMATCH');
  const acts = preparedParts.filter((part, i) => i === 0 || preparedParts[i - 1].actNumber !== part.actNumber)
    .map(part => ({ act: part.actNumber, entryPartKey: part.partKey, runtimeBinding: null }));
  equal(root.actResetCandidates, acts, 'AUTHORED_ACT_BOUNDARIES_MISMATCH');
  return { sourceMapSha256, declaredPackageSha256, submittedInventorySha256, manifestSha256: manifestIdentity.sha256,
    identityEvidence: {
      serverVerified: { compactByteSha256: sourceMapSha256, reconstructedManifestSha256: manifestIdentity.sha256,
        reconstructedPrimarySha256: primarySha256, coveredSourceFileCount: coveredSourcePaths.size,
        coveredSourceBytes: [...coveredSourcePaths].reduce((n, path) => n + inventoryByPath.get(path)!.bytes, 0),
        orderedStoredManuscriptHash: manuscript.contentHash },
      declared: { packageSha256: declaredPackageSha256, originalPackageBytesReceived: false },
      submittedInventory: { listSha256: submittedInventorySha256, entryCount: inventory.length,
        uncoveredEntryCount: inventory.length - coveredSourcePaths.size, originalFilesystemVerifiedByServer: false },
    },
    parts: preparedParts, locale: manuscript.locale, endingResolution: { ...ending, approval: 'not_bound' as const },
    provenance: { contract: 'story-authored-source-spans-v1', primarySha256, manifestSha256: manifestIdentity.sha256, parts: provenance },
    counts: { parts: parts.length, acts: priorAct, sourceScenes: observedScenes,
      beats: preparedParts.reduce((n, part) => n + part.packing.beats.length, 0), choices: parts.length * 3,
      verifiedDesignPrompts: observedImages, verifiedVisualAssets: 0 } };
}

function validatePrimary(preambleValue: unknown, assemblyValue: unknown, parts: any[],
  identity: (path: unknown, raw: string) => { sha256: string }) {
  const preamble = object(preambleValue, ['sourcePath', 'bytes', 'segments', 'classifications']);
  const originalSegments = array(preamble.segments, 2000);
  const raw = originalSegments.map(value => text(object(value).text, 65536)).join('');
  if (Buffer.byteLength(raw) !== integer(preamble.bytes, 65536)) invalid('AUTHORED_PRIMARY_PREAMBLE_MISMATCH');
  const classifications = array(preamble.classifications, 2000);
  if (classifications.length !== originalSegments.length) invalid('AUTHORED_PRIMARY_PREAMBLE_MISMATCH');
  if (raw) {
    const segments = segmentsFor(raw, originalSegments.map(value => value.byteEnd - value.byteStart));
    let titleSeen = false;
    segments.forEach((segment, i) => {
      const original = originalSegments[i];
      const value = segment.text.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '');
      let kind = 'unmapped';
      if (segment.blank) kind = 'blank';
      else if (/^# \uC81C\d+\uAD8C\s*-[^\r\n]+$/.test(value)) kind = 'volume_heading';
      else if (!titleSeen && /^# [^\r\n]+$/.test(value)) { kind = 'document_title'; titleSeen = true; }
      else if (value === '---') kind = 'assembly_rule';
      else if (value === `\uACF5\uC2DD \uC120\uD0DD A \uBA54\uC778 \uB8E8\uD2B8 ${parts.length}\uD30C\uD2B8, \uD30C\uD2B8\uBCC4 \uC120\uD0DD\uC9C0\u00B7\uACB0\uACFC \uBA54\uBAA8\u00B7AI \uC5F0\uACB0 \uC694\uC57D \uD3EC\uD568 \uD1B5\uD569\uBCF8.`) kind = 'assembly_description';
      const classification = object(classifications[i], ['kind', 'source']);
      const ref = object(classification.source);
      if (kind === 'unmapped' || classification.kind !== kind || original.byteStart !== segment.start || original.byteEnd !== segment.end ||
          original.sha256 !== authoredHash(segment.text) || ref.fileId !== 'primary-source' || ref.segment !== i ||
          ref.byteStart !== segment.start || ref.byteEnd !== segment.end || ref.sha256 !== authoredHash(segment.text)) invalid('AUTHORED_PRIMARY_UNMAPPED');
    });
  } else if (originalSegments.length) invalid('AUTHORED_PRIMARY_PREAMBLE_MISMATCH');
  const assembly = object(assemblyValue, ['sourcePath', 'parts', 'after']);
  const entries = array(assembly.parts, 1000);
  if (entries.length !== parts.length || assembly.sourcePath !== preamble.sourcePath) invalid('AUTHORED_PRIMARY_ASSEMBLY_INVALID');
  let totalGapBytes = 0;
  const chunks: string[] = [];
  entries.forEach((value, i) => {
    const entry = object(value, ['before', 'partKey']);
    const before = text(entry.before, 65536);
    totalGapBytes += Buffer.byteLength(before);
    if (entry.partKey !== parts[i].partKey || totalGapBytes > 256 * 1024 || (i === 0 && before !== raw)) invalid('AUTHORED_PRIMARY_ASSEMBLY_INVALID');
    if (i > 0 && before.split(/\r\n|\r|\n/).some(line => line.trim() && line !== '---' && !/^# \uC81C\d+\uAD8C\s*-/.test(line))) invalid('AUTHORED_PRIMARY_UNMAPPED');
    chunks.push(before, text(parts[i].text, 1024 * 1024).replace(/\r\n/g, '\n').replace(/[\r\n]+$/, ''));
  });
  const after = text(assembly.after, 65536);
  if (after.trim()) invalid('AUTHORED_PRIMARY_UNMAPPED');
  chunks.push(after);
  return identity(assembly.sourcePath, chunks.join('')).sha256;
}

function validateEnding(evidenceValue: unknown, part: number, fileId: unknown, segments: Segment[],
  choiceEvidence: number[], ending: AuthoredEndingIntent) {
  if (!['author_main', 'author_sub'].includes(ending.endingKey) || !choiceEvidence.includes(ending.evidenceSegment)) invalid('AUTHORED_ENDING_INTENT_INVALID');
  const segment = segments[ending.evidenceSegment];
  const claim = ending.endingKey === 'author_main' ? 'author_default' : 'author_sub';
  const evidence = array(evidenceValue, 1000).find(value => value?.part === part && value?.source?.segment === ending.evidenceSegment);
  if (!evidence || evidence.status !== 'source_claim_unresolved' || evidence.source.fileId !== fileId ||
      !array(evidence.provenanceClaims, 3).includes(claim) || evidence.source.byteStart !== segment.start ||
      evidence.source.byteEnd !== segment.end || evidence.source.sha256 !== authoredHash(segment.text)) invalid('AUTHORED_ENDING_EVIDENCE_MISMATCH');
  if (!(claim === 'author_default' ? /\uC791\uAC00.*\uC5D4\uB529/.test(segment.text) : /\uC11C\uBE0C \uC5D4\uB529/.test(segment.text))) invalid('AUTHORED_ENDING_EVIDENCE_MISMATCH');
}

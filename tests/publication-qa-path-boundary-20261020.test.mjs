import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const self = fileURLToPath(import.meta.url);
const target = path.join(root, 'scripts', 'build-public-site.mjs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const closing = [];

function ordinaryRead(file, cap) {
  const info = lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'ordinary source file required');
  assert.equal(realpathSync(file), path.resolve(file), 'source path must not be linked');
  assert.ok(info.size <= cap, 'source cap exceeded before allocation');
  const bytes = readFileSync(file);
  assert.equal(bytes.length, info.size, 'source size changed during read');
  return bytes;
}

function canonical(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.ok(Buffer.from(text).equals(bytes), 'UTF8 roundtrip required');
  assert.ok(!text.startsWith('\uFEFF'), 'BOM forbidden');
  assert.ok(!/\r(?!\n)/.test(text), 'bare CR forbidden');
  if (text.includes('\r\n')) assert.ok(!/(?<!\r)\n/.test(text), 'mixed EOL forbidden');
  return Buffer.from(text.replace(/\r\n/g, '\n'));
}

function tuple(bytes) { return [bytes.length, sha(bytes), blob(bytes)]; }

const builderRaw = ordinaryRead(target, 16384);
const builderLF = canonical(builderRaw);
const allowedRaw = [
  [8081, '95f395d64f182132f92525ce84ba1a5f600e6f65121000c7f0bea0207ddf5e75', 'd25d17a67bb284330af07821e8feb269a272d000'],
  [8084, '6e72f4d633a376a31eada243074914cafd356055f587aa042233f397e8bceca1', '1f7719fe27c8cac23f51ba8e67f41e2c40120229'],
  [8230, 'bdb8c3bc9d72406ceb51ece1e5ebd77ee42969d91d961b31f8c9e3c99ad85707', 'fe39b0b5bdc840bc57ceadc5c8bb108d90f193fa'],
  [8233, '14b1ee2cce9d0552952b2ec2dba359b3430dae6237621254ffc07c78fbdf40ad', '292e95af5f04090b157338381774fb7fe7a5599c'],
];
assert.ok(allowedRaw.some((pin) => JSON.stringify(pin) === JSON.stringify(tuple(builderRaw))), 'unknown physical builder');
assert.ok(allowedRaw.slice(0, 2).some((pin) => JSON.stringify(pin) === JSON.stringify(tuple(builderLF))), 'unknown canonical builder');
closing.push({ file: target, bytes: builderRaw, cap: 16384 });
closing.push({ file: self, bytes: ordinaryRead(self, 16384), cap: 16384 });

after(() => {
  const errors = [];
  for (const row of closing) {
    try { assert.ok(ordinaryRead(row.file, row.cap).equals(row.bytes), 'closing bytes changed'); }
    catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'publication QA source closing failed');
});

test('publication refuses explicit internal QA segments before creating an artifact', async (t) => {
  const { publicationFiles, buildPublicSite, verifyPublicArtifact } = await import(pathToFileURL(target).href);
  assert.equal(typeof publicationFiles, 'function');
  assert.equal(typeof buildPublicSite, 'function');
  assert.equal(typeof verifyPublicArtifact, 'function');
  const hosted = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP;
  if (process.platform === 'win32' && !hosted) assert.match(root, /^E:\\/i, 'local QA must stay on E');
  assert.equal(realpathSync(root), path.resolve(root), 'ordinary fixture root required');
  const base = hosted ? path.resolve(process.env.RUNNER_TEMP) : path.join(root, 'qa-artifacts');
  if (!existsSync(base)) mkdirSync(base);
  assert.ok(lstatSync(base).isDirectory() && !lstatSync(base).isSymbolicLink(), 'ordinary QA parent required');
  assert.equal(realpathSync(base), path.resolve(base), 'linked QA parent forbidden');
  const fixture = mkdtempSync(path.join(base, 'publication-qa-path-'));
  assert.equal(realpathSync(fixture), path.resolve(fixture));

  const manifest = {
    version: 1,
    files: ['index.html', 'robots.txt', 'pages/qa-guide.js'],
    routes: ['story-stage'],
    characterCovers: ['fixture-artist'],
    selectedGalleries: ['fixture-artist'],
    referenceGalleries: ['fixture-other'],
  };
  const expected = [
    'index.html', 'robots.txt', 'pages/qa-guide.js', 'story-stage/index.html',
    'assets/characters/fixture-artist/cover.png', 'assets/characters/fixture-artist/thumb.png',
    ...Array.from({ length: 14 }, (_, i) => `assets/characters/fixture-artist/site-selected/gallery-${String(i + 1).padStart(2, '0')}.png`),
    ...Array.from({ length: 14 }, (_, i) => `assets/characters/fixture-other/reference-final-${String(i + 1).padStart(2, '0')}.png`),
  ].sort();
  const privateNames = ['qa/private-root.txt', 'nested/qa/private-nested.txt', 'separate/QA/private-case.txt'];
  assert.equal(expected.length, 34);
  assert.equal(new Set([...expected, ...privateNames].map((file) => file.toLowerCase())).size, 37);
  let total = 0;
  for (const [index, relative] of [...expected, ...privateNames].entries()) {
    const bytes = Buffer.from(`synthetic publication fixture ${index}\n`);
    assert.ok(bytes.length <= 128);
    total += bytes.length;
    const absolute = path.join(fixture, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes, { flag: 'wx' });
    closing.push({ file: absolute, bytes, cap: 128 });
  }
  assert.ok(total < 8192, 'synthetic input cap');
  const expectedRecords = expected.map((file) => {
    const bytes = ordinaryRead(path.join(fixture, file), 128);
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  });
  assert.deepEqual(publicationFiles(manifest), expected, 'independent normal inventory');
  const normalOutput = path.join(fixture, 'build', 'public-site');
  const normal = buildPublicSite({ sourceRoot: fixture, output: normalOutput, manifest });
  assert.equal(normal.verified, true);
  assert.deepEqual(normal.records, expectedRecords, 'independent normal byte records');
  assert.deepEqual(verifyPublicArtifact(normalOutput, expectedRecords), {
    files: 34, bytes: expectedRecords.reduce((sum, row) => sum + row.bytes, 0), verified: true,
  });
  for (const row of expectedRecords) {
    assert.deepEqual(ordinaryRead(path.join(normalOutput, row.file), 128), ordinaryRead(path.join(fixture, row.file), 128));
  }
  assert.equal(ordinaryRead(path.join(normalOutput, '.nojekyll'), 0).length, 0);
  for (const name of privateNames) assert.equal(existsSync(path.join(normalOutput, name)), false, 'unlisted QA stays out');
  t.diagnostic(JSON.stringify({ phase: 'normal_qualified', synthetic: true, inputFiles: 37, publicFiles: 34, verified: true }));

  for (const [index, relative] of privateNames.entries()) {
    const privatePath = path.join(fixture, relative);
    assert.ok(ordinaryRead(privatePath, 128).length > 0, 'negative input exists and is ordinary');
    const output = path.join(fixture, 'qa-artifacts', `reject-${index}`);
    assert.equal(existsSync(output), false, 'negative output must start absent');
    const changedManifest = { ...manifest, files: [...manifest.files, relative] };
    let failure = null;
    let built = null;
    try { built = buildPublicSite({ sourceRoot: fixture, output, manifest: changedManifest }); }
    catch (error) { failure = error; }
    const observation = {
      phase: 'private_path_qualified', relative, inputExists: true,
      outputCreated: existsSync(output), privateCopied: existsSync(path.join(output, relative)),
      builtVerified: built?.verified === true,
      rejection: failure ? { name: failure.name, message: failure.message } : null,
    };
    t.diagnostic(JSON.stringify(observation));
    assert.ok(failure instanceof Error, 'EXPLICIT_INTERNAL_QA_PATH_MUST_BE_REJECTED');
    assert.equal(failure.message, 'Non-public publication path', 'only the intended admission rejection qualifies');
    assert.equal(observation.outputCreated, false, 'denial must precede artifact creation');
    assert.equal(observation.privateCopied, false);
  }
  // Keep every synthetic source and artifact for independent saved-evidence review.
});

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { buildPublicSite, publicationFiles, verifyPublicArtifact } from '../build-public-site.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const hostedRunner = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_TEMP;
const temporary = hostedRunner ? path.resolve(process.env.RUNNER_TEMP) :
  process.platform === 'win32' ? 'E:\\Codex\\LuminaStage\\qa-temp' : os.tmpdir();
mkdirSync(temporary, { recursive: true });
const manifest = () => ({ version: 1, files: ['index.html', 'robots.txt', 'pages/story.js'], routes: ['story-stage'],
  characterCovers: ['artist-one'], selectedGalleries: ['artist-one'], referenceGalleries: ['artist-two'] });
function fixture(t) {
  const root = mkdtempSync(path.join(temporary, 'publication-test-'));
  for (const file of publicationFiles(manifest())) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), Buffer.from(`fixture:${file}`));
  }
  t.after(() => {
    const absolute = path.resolve(root);
    assert.ok(absolute.startsWith(path.resolve(temporary) + path.sep + 'publication-test-'));
    rmSync(absolute, { recursive: true, force: true });
  });
  return { root, output: path.join(root, 'build', 'public-site'), config: manifest() };
}

test('publication manifest preserves the currently selected dynamic 350-image galleries', () => {
  const config = JSON.parse(readFileSync(path.join(repository, 'scripts/public-site-manifest.json'), 'utf8'));
  const files = new Set(publicationFiles(config));
  const context = { window: {} };
  runInNewContext(readFileSync(path.join(repository, 'data/characters.js'), 'utf8'), context, { timeout: 1000 });
  const artists = context.window.LuminaStaticData.characters;
  assert.equal(artists.length, 25);
  let images = 0;
  for (const artist of artists) {
    for (const value of [artist.images.cover, artist.images.thumb, ...artist.gallery.map((item) => item.src)]) {
      const file = value.replace(/^\.\//, '');
      assert.ok(files.has(file), 'Missing current catalog asset');
    }
    images += artist.gallery.length;
  }
  assert.equal(images, 350);
  assert.ok([...files].every((file) => !/(?:server|docs|tests|scripts|qa-artifacts|reference-rebuild|hold)\//.test(file)));
});

test('only allowlisted bytes enter a new artifact; internal files and candidate artwork stay out', (t) => {
  const { root, output, config } = fixture(t);
  for (const file of ['server/.env', 'docs/notes.md', 'qa-artifacts/private.json', '_check.js', 'assets/characters/artist-one/hold/candidate.png']) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), 'PRIVATE-FIXTURE');
  }
  const result = buildPublicSite({ sourceRoot: root, output, manifest: config });
  assert.equal(result.verified, true);
  assert.equal(result.files, publicationFiles(config).length);
  assert.equal(readFileSync(path.join(output, 'pages/story.js'), 'utf8'), 'fixture:pages/story.js');
  assert.equal(existsSync(path.join(output, 'server')), false);
  assert.equal(existsSync(path.join(output, '_check.js')), false);
  assert.equal(existsSync(path.join(output, 'assets/characters/artist-one/hold')), false);
  assert.equal(readFileSync(path.join(root, 'server/.env'), 'utf8'), 'PRIVATE-FIXTURE');
});

for (const file of ['server/src/main.js', 'scripts/test.js', 'tests/probe.js', 'docs/notes.txt', 'qa-artifacts/result.js',
  '.env', '.github/workflows/deploy.html', '_check.js', 'secret.txt', 'pages/private.test.js', 'creator-studio.html.bak',
  'assets/characters/artist-one/hold/candidate.png', 'assets/characters/artist-one/reference-rebuild/candidate.png',
  '../index.html', '/index.html', 'pages\\story.js']) {
  test(`non-public manifest path is rejected: ${file}`, () => {
    const config = manifest();
    config.files.push(file);
    assert.throws(() => publicationFiles(config), /Non-public publication path/);
  });
}

test('duplicate case and Unicode-normalized paths cannot collide in a cross-platform artifact', () => {
  const config = manifest();
  config.files.push('INDEX.HTML');
  assert.throws(() => publicationFiles(config), /colliding/);
});

test('invalid or unknown manifest structure is rejected', () => {
  assert.throws(() => publicationFiles({ ...manifest(), everything: ['server'] }), /Invalid/);
  assert.throws(() => publicationFiles({ ...manifest(), selectedGalleries: [] }), /Invalid/);
});

test('missing inputs fail before an output directory is created', (t) => {
  const { root, output, config } = fixture(t);
  config.files.push('missing.js');
  assert.throws(() => buildPublicSite({ sourceRoot: root, output, manifest: config }), /Missing/);
  assert.equal(existsSync(output), false);
});

test('existing artifact is retained rather than recursively deleted or overwritten', (t) => {
  const { root, output, config } = fixture(t);
  buildPublicSite({ sourceRoot: root, output, manifest: config });
  writeFileSync(path.join(output, 'retained.txt'), 'retain');
  assert.throws(() => buildPublicSite({ sourceRoot: root, output, manifest: config }), /overwrite/);
  assert.equal(readFileSync(path.join(output, 'retained.txt'), 'utf8'), 'retain');
});

test('output cannot point at a public source directory or outside the source root', (t) => {
  const { root, config } = fixture(t);
  for (const output of [root, path.join(root, 'pages'), path.join(root, '..', 'outside')]) {
    assert.throws(() => buildPublicSite({ sourceRoot: root, output, manifest: config }), /dedicated/);
  }
});

test('source directory junctions are rejected', (t) => {
  const { root, output, config } = fixture(t);
  const linked = path.join(root, 'alias');
  symlinkSync(path.join(root, 'pages'), linked, process.platform === 'win32' ? 'junction' : 'dir');
  config.files.push('alias/story.js');
  assert.throws(() => buildPublicSite({ sourceRoot: root, output, manifest: config }), /linked/);
  assert.equal(existsSync(output), false);
});

test('output directory junctions are rejected without touching their target', (t) => {
  const { root, config } = fixture(t);
  const outside = path.join(root, 'retained');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  symlinkSync(outside, path.join(root, 'build'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => buildPublicSite({ sourceRoot: root, output: path.join(root, 'build/public-site'), manifest: config }), /Linked/);
  assert.equal(readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('post-build verification detects an extra file or changed byte, not just required filenames', (t) => {
  const { root, output, config } = fixture(t);
  const result = buildPublicSite({ sourceRoot: root, output, manifest: config });
  writeFileSync(path.join(output, 'unexpected.js'), 'extra');
  assert.throws(() => verifyPublicArtifact(output, result.records), /Unexpected/);
  rmSync(path.join(output, 'unexpected.js'));
  writeFileSync(path.join(output, 'pages/story.js'), 'changed');
  assert.throws(() => verifyPublicArtifact(output, result.records), /changed/);
});

test('Pages uploads the generated public artifact, never the checkout root', () => {
  const workflow = readFileSync(path.join(repository, '.github/workflows/deploy-pages.yml'), 'utf8');
  assert.match(workflow, /path: build\/public-site/);
  assert.doesNotMatch(workflow, /path: \.(?:\s|$)/);
  assert.equal([...workflow.matchAll(/run: node scripts\/build-public-site\.mjs/g)].length, 2);
  assert.match(workflow, /node --test scripts\/tests\/build-public-site\.test\.mjs/);
});

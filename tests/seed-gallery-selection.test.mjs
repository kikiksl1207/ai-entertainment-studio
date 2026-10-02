import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const helperSource = readFileSync(join(root, 'server/prisma/seed-gallery-selection.ts'), 'utf8');
const seedSource = readFileSync(join(root, 'server/prisma/seed.ts'), 'utf8');
const seedAst = ts.createSourceFile('seed.ts', seedSource, ts.ScriptTarget.ES2021, true);

function compile(source, fileName) {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  });
  const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')), []);
  return result.outputText;
}

const helperContext = { exports: {} };
vm.runInNewContext(compile(helperSource, 'seed-gallery-selection.ts'), helperContext);
const { selectCanonicalGalleryImageKeys } = helperContext.exports;

function canonicalKeys(slug, directory) {
  const prefix = directory === 'site-selected' ? 'site-selected/gallery-' : 'reference-final-';
  return Array.from({ length: 14 }, (_, index) =>
    `assets/characters/${slug}/${prefix}${String(index + 1).padStart(2, '0')}.png`);
}

function select(slug, directory, fileExists) {
  return Array.from(selectCanonicalGalleryImageKeys(slug, directory, fileExists));
}

function sourceDeclaration(name) {
  const statement = seedAst.statements.find((item) =>
    (ts.isFunctionDeclaration(item) && item.name?.text === name) ||
    (ts.isVariableStatement(item) && item.declarationList.declarations.some((entry) => entry.name.getText(seedAst) === name)));
  assert.ok(statement, `Missing seed declaration: ${name}`);
  return statement.getText(seedAst);
}

// Evaluate only the gallery declarations, never seed main or Prisma construction.
const seedSelectionSource = compile([
  sourceDeclaration('galleryDirsBySlug'),
  sourceDeclaration('getGalleryImageKeys'),
  sourceDeclaration('resolveAssetDir'),
  'globalThis.selection = { galleryDirsBySlug, getGalleryImageKeys };',
].join('\n'), 'seed-selection.ts');

function seedSelection(fs = { existsSync, statSync }) {
  const context = {
    ...fs,
    join,
    process: { cwd: () => join(root, 'server') },
    selectCanonicalGalleryImageKeys,
  };
  vm.runInNewContext(seedSelectionSource, context);
  return context.selection;
}

const characterContext = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'data/characters.js'), 'utf8'), characterContext);
const characters = characterContext.window.LuminaStaticData.characters;
const characterBySlug = new Map(characters.map((artist) => [artist.slug, artist]));
const approved = JSON.parse(readFileSync(join(root, 'server/prisma/approved-public-artists-2026-09-27.json'), 'utf8'));

for (const directory of ['site-selected', '.']) {
  test(`${directory}: only exact PNG 01..14 keys are selected in numeric order`, () => {
    const slug = 'gallery-artist';
    const expected = canonicalKeys(slug, directory);
    const storageDirectory = `assets/characters/${slug}${directory === '.' ? '' : '/site-selected'}`;
    const files = new Set([
      ...expected.toReversed(),
      ...['cover.png', 'thumb.png', 'gallery-00.png', 'gallery-15.png', 'gallery-20.png',
        'gallery-1.png', 'gallery-01.jpg', 'gallery-01.webp', 'gallery-01-rejected.png',
        'reference-final-00.png', 'reference-final-15.png', 'reference-final-20.png',
        'reference-final-1.png', 'reference-final-01.jpg', 'reference-final-01-rejected.png',
        'rejected/gallery-01.png', 'reference-final/reference-final-01.png',
      ].map((name) => `${storageDirectory}/${name}`),
    ]);
    const checked = [];
    assert.deepEqual(select(slug, directory, (key) => {
      checked.push(key);
      return files.has(key);
    }), expected);
    assert.deepEqual(checked, expected);
  });

  test(`${directory}: a missing canonical PNG is not replaced by stale or alternate images`, () => {
    const slug = 'gallery-artist';
    const expected = canonicalKeys(slug, directory);
    const missing = expected[6];
    const files = new Set(expected.filter((key) => key !== missing));
    files.add(missing.replace('.png', '.jpg'));
    files.add(missing.replace('-07', '-20'));
    files.add(`assets/characters/${slug}/cover.png`);
    files.add(`assets/characters/${slug}/thumb.png`);
    files.add(`assets/characters/${slug}/reference-final/reference-final-07.png`);
    const checked = [];
    assert.throws(() => select(slug, directory, (key) => {
      checked.push(key);
      return files.has(key);
    }), (error) => error.message.includes('13/14 files') && error.message.includes(missing));
    assert.deepEqual(checked, expected);
  });

  test(`${directory}: every missing key is reported without a partial gallery`, () => {
    const expected = canonicalKeys('gallery-artist', directory);
    const missing = new Set([expected[0], expected[9], expected[13]]);
    assert.throws(() => select('gallery-artist', directory, (key) => !missing.has(key)), (error) =>
      error.message.includes('11/14 files') && [...missing].every((key) => error.message.includes(key)));
  });

  test(`${directory}: absent source reports zero of fourteen instead of falling back`, () => {
    assert.throws(() => select('gallery-artist', directory, () => false), /0\/14 files/);
  });
}

test('unknown sources and unsafe slugs are rejected before probing any file', () => {
  for (const [slug, directory] of [
    ['artist', 'reference-final'], ['artist', 'rejected'], ['artist', '../site-selected'],
    ['../artist', '.'], ['artist/other', '.'], ['', '.'], ['Artist', '.'],
  ]) {
    let reads = 0;
    assert.throws(() => select(slug, directory, () => { reads += 1; return true; }), /Unknown canonical gallery source/);
    assert.equal(reads, 0);
  }
});

test('seed sources match the public canonical galleries without changing artist membership', () => {
  const { galleryDirsBySlug, getGalleryImageKeys } = seedSelection();
  assert.deepEqual(Object.keys(galleryDirsBySlug).sort(), [
    'yoon-serin', 'han-seoyul', 'park-doa', 'oh-hyerin', 'seo-yuan',
    'choi-seojin', 'cha-dohyun', 'min-chaeon', 'ha-yuna', 'kwon-taejun',
  ].sort());
  for (const slug of Object.keys(galleryDirsBySlug)) {
    assert.deepEqual(Array.from(getGalleryImageKeys(slug)),
      Array.from(characterBySlug.get(slug).gallery, (item) => item.src.replace(/^\.\//, '')), slug);
  }
});

test('unmapped seed artists keep an empty gallery without probing guessed sources', () => {
  const { getGalleryImageKeys } = seedSelection({
    existsSync() { assert.fail('Must not probe an unknown source'); },
    statSync() { assert.fail('Must not inspect an unknown source'); },
  });
  assert.deepEqual(Array.from(getGalleryImageKeys('unknown-artist')), []);
});

for (const unavailable of ['missing', 'directory', 'empty']) {
  test(`seed rejects a ${unavailable} canonical image even if all stale images exist`, () => {
    const expected = canonicalKeys('yoon-serin', 'site-selected');
    const missing = resolve(root, expected[4]);
    const paths = new Set([
      ...expected,
      ...canonicalKeys('yoon-serin', '.'),
      ...['cover.png', 'thumb.png', 'gallery-20.png', 'gallery-05.jpg'].map((name) =>
        `assets/characters/yoon-serin/site-selected/${name}`),
    ].map((key) => resolve(root, key)));
    if (unavailable === 'missing') paths.delete(missing);
    const { getGalleryImageKeys } = seedSelection({
      existsSync: (path) => paths.has(path),
      statSync: (path) => ({ isFile: () => path !== missing || unavailable !== 'directory', size: path === missing && unavailable === 'empty' ? 0 : 1 }),
    });
    assert.throws(() => getGalleryImageKeys('yoon-serin'), (error) =>
      error.message.includes('13/14 files') && error.message.includes('site-selected/gallery-05.png'));
  });
}

test('seed preflights canonical galleries before the first database access and reuses the checked keys', () => {
  const main = seedAst.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'main');
  const statements = main.body.statements;
  const preflightIndex = statements.findIndex((item) => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some((entry) => entry.name.getText(seedAst) === 'galleryImageKeysBySlug'));
  const firstDatabaseIndex = statements.findIndex((item) => /\bprisma\./.test(item.getText(seedAst)));
  assert.ok(preflightIndex >= 0 && firstDatabaseIndex > preflightIndex);
  assert.match(statements[preflightIndex].getText(seedAst), /artistsToSeed\.map.*getGalleryImageKeys\(artist\.slug\)/s);
  assert.match(main.getText(seedAst), /galleryImageKeysBySlug\.get\(artist\.slug\)/);
  assert.doesNotMatch(sourceDeclaration('getGalleryImageKeys'), /readdirSync|localeCompare/);
  compile(seedSource, 'seed.ts');
});

for (const artist of characters.filter((item) => item.gallery?.length === 14)) {
  test(`${artist.slug}: all fourteen public canonical keys point to nonempty files`, () => {
    const expected = Array.from(artist.gallery, (item) => item.src.replace(/^\.\//, ''));
    const directory = expected[0].includes('/site-selected/') ? 'site-selected' : '.';
    let existingCount = 0;
    const actual = select(artist.slug, directory, (key) => {
      const path = resolve(root, key);
      const valid = existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
      if (valid) existingCount += 1;
      return valid;
    });
    assert.deepEqual(actual, expected);
    assert.equal(existingCount, 14);
  });
}

test('approved release still has exactly seventeen artists', () => {
  assert.equal(approved.release, 'approved-public-artists-2026-09-27');
  assert.equal(approved.artists.length, 17);
});

for (const artist of approved.artists) {
  test(`${artist.slug}: approved release preserves the same fourteen canonical gallery keys`, () => {
    const expected = Array.from(characterBySlug.get(artist.slug).gallery, (item) => item.src.replace(/^\.\//, ''));
    const directory = expected[0].includes('/site-selected/') ? 'site-selected' : '.';
    assert.deepEqual(artist.gallery, expected);
    assert.deepEqual(select(artist.slug, directory, (key) => {
      const path = resolve(root, key);
      return existsSync(path) && statSync(path).isFile() && statSync(path).size > 0;
    }), expected);
    assert.equal(new Set([artist.cover, artist.thumb, ...expected]).size, 16);
  });
}

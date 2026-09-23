import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}/data/characters.js`, 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);

const characters = context.window.LuminaStaticData.characters;
const bySlug = new Map(characters.map((character) => [character.slug, character]));
const fullGallerySlugs = [
  'nam-ian',
  'jang-taegeon',
  'bae-seongpil',
  'jung-doyun',
  'lim-jaeguk',
  'seo-hamin',
  'ryu-taeo',
  'cha-mawang',
  'seo-ika',
  'baek-toga',
  'kwon-bandong',
  'kang-sia',
  'lee-jiwon',
  'baek-ria',
  'oh-yuna',
];

function localAssetPath(relativePath) {
  return `${root}/${relativePath.replace(/^\.\//, '')}`;
}

test('all handoff characters have local cover and thumbnail assets', () => {
  for (const slug of fullGallerySlugs) {
    const character = bySlug.get(slug);
    assert.ok(character, `${slug}: character record is missing`);
    assert.equal(character.status, 'public', `${slug}: must be publicly visible`);
    assert.ok(existsSync(localAssetPath(character.images.cover)), `${slug}: cover is missing`);
    assert.ok(existsSync(localAssetPath(character.images.thumb)), `${slug}: thumbnail is missing`);
  }
});

test('completed character sets expose exactly fourteen ordered gallery images', () => {
  for (const slug of fullGallerySlugs) {
    const character = bySlug.get(slug);
    assert.equal(character.gallery.length, 14, `${slug}: gallery count`);
    character.gallery.forEach((item, index) => {
      const expectedNumber = String(index + 1).padStart(2, '0');
      assert.match(item.src, new RegExp(`reference-final-${expectedNumber}\\.png$`));
      assert.ok(existsSync(localAssetPath(item.src)), `${slug}: ${item.src} is missing`);
    });
  }
});

test('all final handoff folders contain only the two representatives and fourteen ordered gallery assets', () => {
  for (const slug of fullGallerySlugs) {
    const files = readdirSync(`${root}/assets/characters/${slug}`).filter((file) => file.endsWith('.png')).sort();
    assert.equal(files.length, 16, `${slug}: unexpected PNG count`);
    assert.equal(files[0], 'cover.png', `${slug}: cover filename`);
    assert.equal(files.at(-1), 'thumb.png', `${slug}: thumbnail filename`);
  }
});

test('existing character measurements use the latest production sheet', () => {
  const expected = {
    'kang-sia': ['1998년 9월 17일 (만 27세)', '168cm'],
    'lee-jiwon': ['1997년 8월 17일 (만 29세)', '173cm'],
    'baek-ria': ['2004년 7월 12일 (만 22세, 성인)', '166cm'],
    'oh-yuna': ['2000년 8월 2일 (만 26세)', '163cm'],
    'seo-hamin': ['1994년 4월 9일 (만 32세)', '176cm'],
    'ryu-taeo': ['1999년 6월 3일 (만 27세)', '184cm'],
  };

  for (const [slug, [birthDate, body]] of Object.entries(expected)) {
    assert.equal(bySlug.get(slug).profile.생년월일, birthDate, `${slug}: birth date`);
    assert.equal(bySlug.get(slug).profile.신체, body, `${slug}: body measurement`);
  }
});

test('character detail hides an unavailable gallery instead of filling it', () => {
  const detailPage = readFileSync(`${root}/pages/character-detail.js`, 'utf8');
  assert.match(detailPage, /artist\.galleryMode === "hidden"/);
  assert.match(detailPage, /gallery\.hidden = true/);
  assert.doesNotMatch(detailPage, /caption: "Cover", src: artist\.images\.cover/);
});

test('public catalog uses thumbnails and detail pages use main cover images', () => {
  const catalogPage = readFileSync(`${root}/pages/character-catalog.js`, 'utf8');
  const detailPage = readFileSync(`${root}/pages/character-detail.js`, 'utf8');
  const detailStyles = readFileSync(`${root}/styles/character-detail.css`, 'utf8');
  assert.match(catalogPage, /a\.images\.thumb \|\| a\.images\.cover/);
  assert.match(detailPage, /artist\.images\.cover \|\| artist\.images\.thumb/);
  assert.match(catalogPage, /candidate: "신규"/);
  assert.match(detailPage, /candidate: "신규"/);
  assert.match(detailStyles, /detail-hero-image-nam-ian/);
  assert.match(detailStyles, /detail-hero-image-ryu-taeo/);
  assert.match(detailStyles, /detail-hero-image-cha-mawang/);
  assert.match(detailStyles, /detail-hero-image-kwon-bandong/);
});

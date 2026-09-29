import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const copy = JSON.parse(readFileSync(new URL('../server/prisma/public-artist-copy-2026-09-29.json', import.meta.url)));
const approved = JSON.parse(readFileSync(new URL('../server/prisma/approved-public-artists-2026-09-27.json', import.meta.url)));
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const fields = ['displayName', 'tagline', 'summary', 'publicStory'];

test('localized copy covers exactly the public static artist roster', () => {
  const context = { window: {} };
  const characters = readFileSync(new URL('../data/characters.js', import.meta.url), 'utf8');
  vm.runInNewContext(characters, context);
  const publicSlugs = Array.from(context.window.LuminaStaticData.characters)
    .filter((artist) => artist.status === 'public')
    .map((artist) => artist.slug)
    .sort();

  assert.deepEqual(Object.keys(copy).sort(), publicSlugs);
});

test('all 25 public artists have complete publishable copy in five locales', () => {
  assert.equal(Object.keys(copy).length, 25);
  for (const [slug, byLocale] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(byLocale), locales, `${slug} locales`);
    for (const locale of locales) {
      for (const field of fields) assert.ok(byLocale[locale][field]?.trim(), `${slug} ${locale} ${field}`);
      const visible = Object.values(byLocale[locale]).join(' ');
      assert.doesNotMatch(visible, /\b(?:planned|candidate|TBD)\b|준비\s*중|후보/i, `${slug} ${locale}`);
      assert.ok([...byLocale[locale].tagline].length <= 60, `${slug} ${locale} tagline`);
      assert.ok([...byLocale[locale].summary].length <= 100, `${slug} ${locale} summary`);
      assert.ok([...byLocale[locale].publicStory].length <= 240, `${slug} ${locale} story`);
    }
    assert.match(Object.values(byLocale.ko).join(' '), /[가-힣]/, `${slug} Korean copy`);
  }
});

test('approved Korean copy stays aligned except for the documented Choi Seojin birthplace removal', () => {
  for (const artist of approved.artists) {
    const korean = copy[artist.slug].ko;
    assert.equal(korean.displayName, artist.displayName);
    assert.equal(korean.tagline, artist.tagline);
    assert.equal(korean.summary, artist.summary);
    if (artist.slug === 'choi-seojin') {
      assert.doesNotMatch(korean.publicStory, /서울|성남|용산/);
    } else {
      assert.equal(korean.publicStory, artist.publicStory);
    }
  }
});

test('both database write paths attach the same localized copy map', () => {
  const seed = readFileSync(new URL('../server/prisma/seed.ts', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../server/scripts/release-approved-public-artists.mjs', import.meta.url), 'utf8');
  assert.match(seed, /publicCopyByLocale/);
  assert.match(release, /publicCopyByLocale/);
});

test('backstage profile status uses the readiness keys returned by the admin API', () => {
  const backstage = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
  const adminService = readFileSync(new URL('../server/src/admin/admin.service.ts', import.meta.url), 'utf8');
  assert.match(adminService, /profiles:\s*{[\s\S]*?publicReady:[\s\S]*?contentReady:/);
  assert.match(backstage, /profileStatus\(artist\.profiles, "contentReady"\)/);
  assert.match(backstage, /profileStatus\(artist\.profiles, "publicReady"\)/);
  assert.doesNotMatch(backstage, /profileStatus\(artist\.profiles, "(?:content|public)Profile"\)/);
});

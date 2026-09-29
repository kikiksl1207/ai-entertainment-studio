import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('../data/characters.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(readFileSync(new URL('../data/artist-profile-locales.js', import.meta.url), 'utf8'), context);

const publicArtists = Array.from(context.window.LuminaStaticData.characters)
  .filter((artist) => artist.status === 'public');
const profiles = context.window.LuminaStaticData.artistProfileByLocale;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const pendingBySlug = {
  'han-seoyul': ['생년월일', '신체'],
  'park-doa': ['생년월일', '신체'],
  'choi-seojin': ['생년월일', '출신지', '신체'],
  'cha-dohyun': ['생년월일', '신체'],
  'seo-yuan': ['생년월일', '신체'],
  'kwon-taejun': ['생년월일', '신체'],
};

test('all 25 public artists have profile rows in five locales', () => {
  assert.deepEqual(Object.keys(profiles).sort(), publicArtists.map((artist) => artist.slug).sort());
  for (const artist of publicArtists) {
    assert.deepEqual(Object.keys(profiles[artist.slug]), locales, `${artist.slug} locales`);
    const sourceKeys = Object.keys(artist.profile || {});
    for (const locale of locales) {
      const rows = Array.from(profiles[artist.slug][locale]);
      assert.deepEqual(rows.map((row) => row.key), sourceKeys, `${artist.slug} ${locale} fields`);
      for (const row of rows) {
        assert.ok(row.label?.trim(), `${artist.slug} ${locale} ${row.key} label`);
        assert.ok(row.value?.trim(), `${artist.slug} ${locale} ${row.key} value`);
        assert.match(row.status, /^(?:confirmed|pending)$/);
        if (locale !== 'ko') assert.doesNotMatch(`${row.label} ${row.value}`, /[가-힣]/);
      }
    }
  }
});

test('only disputed canonical facts are marked pending in every locale', () => {
  for (const artist of publicArtists) {
    const expected = new Set(pendingBySlug[artist.slug] || []);
    for (const locale of locales) {
      const pendingRows = Array.from(profiles[artist.slug][locale])
        .filter((row) => row.status === 'pending');
      assert.deepEqual(pendingRows.map((row) => row.key), [...expected], `${artist.slug} ${locale}`);
      assert.ok(pendingRows.every((row) => !/\d{4}|cm|kg/.test(row.value)), `${artist.slug} ${locale}`);
    }
  }
});

test('localized profile data loads before the detail renderer and reacts to locale changes', () => {
  const html = readFileSync(new URL('../character-detail/index.html', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../pages/character-detail.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('/data/artist-profile-locales.js') < html.indexOf('/pages/character-detail.js'));
  assert.match(renderer, /luminaI18n\?\.getLocale/);
  assert.match(renderer, /addEventListener\("lumina:localechange"/);
  assert.match(renderer, /renderLocalizedDetailProfile\(artist\)/);
});

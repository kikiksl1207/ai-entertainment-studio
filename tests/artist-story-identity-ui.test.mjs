import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/creator-studio.css', import.meta.url), 'utf8');

test('artist story identity review exposes the complete creator flow', () => {
  for (const id of [
    'artistStoryIdentityPanel',
    'artistIdentityArtistSelect',
    'artistIdentityAssets',
    'artistIdentityAnalyze',
    'artistIdentityReview',
    'artistIdentityModal',
    'artistIdentitySections',
    'artistIdentitySave',
    'artistIdentityApprove'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  assert.match(script, /artists\/\$\{encodeURIComponent\(id\)\}\/story-identity-profile/);
  assert.match(script, /artistIdentityRequest\(id, "\/draft"/);
  assert.match(script, /artistIdentityRequest\(id, "\/approve"/);
  assert.match(script, /slice\(0, 8\)/);
});

test('artist story identity review ships all supported locales and mobile layout', () => {
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    const localeKey = locale.includes('-') ? `"${locale}"` : locale;
    assert.match(script, new RegExp(`${localeKey}:\\s*\\{`));
  }

  assert.match(css, /\.artist-identity-assets\s*\{/);
  assert.match(css, /@media\s*\(max-width:\s*680px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
});

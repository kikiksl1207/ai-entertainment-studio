import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('public OTT surface is separate and never links owner-private playback', () => {
  const html = read('ott/index.html');
  const script = read('pages/ott.js');
  assert.match(html, /href="\/ott"/);
  assert.match(script, /\/api\/v1\/ott/);
  assert.doesNotMatch(`${html}\n${script}`, /me\/ott-media|ott-private-preview|playback-session|private-files|storageKey|fileId/);
  assert.match(script, /viewing|감상 이용은 제공되지 않습니다/);
  assert.match(script, /response\.status === 404/);
  assert.match(script, /OTT 작품 공개를 준비하고 있습니다/);
});

test('home and primary mobile surfaces expose Home Artists Story OTT Feed with Korean fallbacks', () => {
  for (const path of ['index.html', 'story-stage/index.html', 'ott/index.html']) {
    const html = read(path);
    const tabs = [...html.matchAll(/class="mobile-tab"[^>]*data-tab-key="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabs, ['index', 'characters', 'story', 'ott', 'lumina-feed'], path);
    assert.doesNotMatch(html, />\?\?\?</);
  }
  const home = read('index.html');
  const app = read('app.js');
  assert.match(home, /href="\/story-stage"/);
  assert.match(home, /href="\/ott"/);
  assert.match(home, /href="\/lumina-pick"/);
  assert.match(home, /home\.discovery\.story\.label">스토리</);
  assert.match(home, /home\.discovery\.ott\.label">영상 작품</);
  assert.match(home, /home\.discovery\.pick\.label">루미나 픽</);
  assert.doesNotMatch(home, /<strong>(?:Story|OTT|Pick)<\/strong>/);
  for (const key of ['home', 'artists', 'story', 'ott', 'feed']) {
    assert.match(app, new RegExp(`<span data-i18n="tab\\.${key}">`));
  }
});

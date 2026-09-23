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
});

test('home and primary mobile surfaces expose the canonical six-item discovery order', () => {
  for (const path of ['index.html', 'story-stage/index.html', 'ott/index.html']) {
    const html = read(path);
    const tabs = [...html.matchAll(/class="mobile-tab"[^>]*data-tab-key="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(tabs, ['index', 'characters', 'story', 'ott', 'lumina-feed', 'lumina-pick'], path);
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
  for (const key of ['home', 'artists', 'story', 'ott', 'feed', 'pick']) {
    assert.match(app, new RegExp(`<span data-i18n="tab\\.${key}">`));
  }
});

test('public API projection is gated and omits private identifiers', () => {
  const contract = read('server/src/public/ott/ott-public.contract.ts');
  const service = read('server/src/public/ott/ott-public.service.ts');
  const controller = read('server/src/public/ott/ott-public.controller.ts');
  assert.match(contract, /status: 'published'/);
  assert.match(contract, /source: 'authored_uploaded_clips'/);
  assert.match(contract, /fixtureSource: false/);
  assert.match(contract, /cleared_for_public_streaming/);
  assert.match(service, /approvalState: 'approved_configuration'/);
  assert.match(service, /contentVersionId: \{ in: mediaVersionIds \}/);
  assert.match(service, /mediaVersionIds\.every/);
  assert.match(service, /media\.includes\('ott_streaming'\)/);
  assert.match(service, /status: 'confirmed'/);
  assert.match(service, /upload\.revocation/);
  assert.doesNotMatch(contract.match(/export type OttPublicCatalogItem[\s\S]*?};\r?\n/)[0], /workId|manifestId|fileId|url|token|graph/);
  assert.match(controller, /@Controller\('ott'\)/);
  assert.doesNotMatch(controller, /UseGuards|me\/ott-media/);
});

// Intercepted local fixtures, not real JWT/PG/cookie-issuer or production delivery proof.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphServer, ids, locales, ownerAuth, failure } from './ott-graph-preview.test-support.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.STORY_UI_PLAYWRIGHT || 'playwright');
const repo = fileURLToPath(new URL('../', import.meta.url));
const origin = 'https://ott.local.test';
const artifacts = process.env.STORY_UI_ARTIFACTS;
const fixturePath = process.env.OTT_UI_MEDIA_FIXTURE;
let browser;
let clip;
before(async () => {
  assert.match(process.env.TEMP || '', /^E:[/\\]/i, 'E-only browser TEMP');
  assert.match(process.env.TMP || '', /^E:[/\\]/i, 'E-only browser TMP');
  assert.match(fixturePath || '', /^E:[/\\]/i, 'explicit retained local test MP4, not a public movie');
  clip = await readFile(fixturePath);
  browser = await chromium.launch({ executablePath: process.env.STORY_UI_BROWSER, headless: true });
});
after(async () => { await browser?.close(); });

async function fixture({ width = 1280, locale = 'en', server = graphServer(), intercept } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 960 } });
  const page = await context.newPage();
  const calls = [];
  const media = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ origin, locale, ownerAuth }) => {
    window.LUMINA_API_BASE = origin;
    localStorage.setItem('lumina_auth', JSON.stringify(ownerAuth));
    localStorage.setItem('lumina_locale', locale);
  }, { origin, locale, ownerAuth });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/v1/ott-media/private-files/')) {
      const headers = request.headers();
      media.push({ url: request.url(), headers });
      if (!headers.cookie?.includes('local_preview=fixture')) return route.fulfill({ status: 403, body: '' });
      const range = /^bytes=(\d+)-(\d*)$/.exec(headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = Math.min(range?.[2] ? Number(range[2]) : clip.length - 1, clip.length - 1);
      return route.fulfill({ status: range ? 206 : 200,
        headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {}) }, body: clip.subarray(start, end + 1) });
    }
    if (url.pathname.startsWith('/api/')) {
      const headers = request.headers();
      const call = { url: request.url(), options: { method: request.method(), body: request.postData(),
        headers: { ...headers, 'Idempotency-Key': headers['idempotency-key'] } } };
      calls.push(call);
      const override = await intercept?.(call, server, route);
      if (override === 'handled') return;
      const response = override || server.handle(call);
      const data = await response.json();
      return route.fulfill({ status: response.status, contentType: 'application/json',
        headers: { 'Cache-Control': 'private, no-store', ...(url.pathname.endsWith('/playback-session') && response.ok ? {
          'Set-Cookie': `local_preview=fixture; Path=/api/v1/ott-media/private-files/; HttpOnly; Secure; SameSite=Strict`
        } : {}) }, body: JSON.stringify(data) });
    }
    const assets = {
      '/ott-private-preview': ['ott-private-preview/index.html', 'text/html'],
      '/pages/ott-private-preview.js': ['pages/ott-private-preview.js', 'application/javascript'],
      '/pages/ott-graph-preview.js': ['pages/ott-graph-preview.js', 'application/javascript'],
      '/styles/ott-private-preview.css': ['styles/ott-private-preview.css', 'text/css'],
      '/assets/brand/lumina-stage-logo.png': ['assets/brand/lumina-stage-logo.png', 'image/png']
    };
    const asset = assets[url.pathname];
    if (!asset) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({ contentType: asset[1], body: await readFile(path.join(repo, asset[0])) });
  });
  await page.goto(`${origin}/ott-private-preview?manifestId=${ids.manifest}`);
  await page.locator('#previewPlayer').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.getElementById('previewStart').disabled);
  return { page, context, calls, media, errors, server,
    commands: () => calls.filter(call => /\/(position|choices)$/.test(call.url)),
    close: () => context.close(),
    async play() {
      await page.locator('#previewStart').click();
      await page.waitForFunction(() => { const video = document.querySelector('video'); return video.readyState >= 2 && video.videoWidth > 0; });
    }
  };
}

test('browser functional: real native decode uses cookie range and source clip bounds', async () => {
  const f = await fixture();
  try {
    await f.play();
    await f.page.waitForFunction(() => document.querySelector('video').paused && document.querySelector('video').currentTime >= .7);
    assert.ok(f.media.length > 0);
    assert.ok(f.media.some(call => call.headers.range));
    assert.ok(f.media.every(call => call.headers.cookie.includes('local_preview=fixture')));
    assert.ok(f.media.every(call => !call.headers.authorization && !call.url.includes('?')));
    const image = await f.page.evaluate(() => {
      const video = document.querySelector('video');
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
      const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 16, 16);
      const pixels = context.getImageData(0, 0, 16, 16).data;
      return { width: video.videoWidth, height: video.videoHeight, time: video.currentTime,
        colors: new Set(Array.from({ length: 256 }, (_, i) => Array.from(pixels.slice(i * 4, i * 4 + 4)).join(','))).size };
    });
    assert.ok(image.width > 0 && image.height > 0 && image.colors > 1);
    assert.ok(image.time >= .7 && image.time <= .72);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('browser functional: B/C distinct sources, native subtitles and explicit completed ending', async () => {
  for (const index of [0, 1]) {
    const f = await fixture();
    try {
      await f.page.locator('#graphChoices button').nth(index).click();
      await f.page.waitForFunction(() => document.querySelectorAll('#graphChoices button').length === 1 && !document.getElementById('previewStart').disabled);
      await f.play();
      assert.ok((await f.page.locator('video').getAttribute('src')).includes(ids[index === 0 ? 'B' : 'C']));
      assert.equal(await f.page.locator('track').getAttribute('srclang'), 'en');
      await f.page.waitForFunction(() => !document.querySelector('#graphChoices button').disabled);
      await f.page.locator('#graphChoices button').click();
      await f.page.waitForFunction(() => !document.getElementById('previewStart').disabled && document.getElementById('graphBranches').hidden);
      await f.play();
      await f.page.locator('#graphEnding').waitFor({ state: 'visible' });
      assert.match(await f.page.locator('#graphEnding').innerText(), /^Completed:/);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('browser functional: lost committed acknowledgement checks current without duplicate choice', async () => {
  let lost = false;
  const f = await fixture({ intercept: async (call, server, route) => {
    if (call.url.endsWith('/choices') && !lost) { lost = true; server.handle(call); await route.abort(); return 'handled'; }
  } });
  try {
    await f.page.locator('#graphChoices button').first().click();
    await f.page.locator('#previewRetry').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#previewStart').isDisabled(), true);
    await f.page.locator('#previewRetry').click();
    await f.page.waitForFunction(() => document.querySelectorAll('#graphChoices button').length === 1 && !document.getElementById('previewStart').disabled);
    assert.equal(f.commands().length, 1);
    assert.equal(f.server.receipts.size, 1);
  } finally { await f.close(); }
});

test('browser functional: missing acknowledgement retries same key and save-choice stays serialized', async () => {
  let lost = false;
  const f = await fixture({ intercept: async (call, server, route) => {
    if (call.url.endsWith('/choices') && !lost) { lost = true; await route.abort(); return 'handled'; }
  } });
  try {
    await f.page.locator('#graphChoices button').first().click();
    await f.page.locator('#previewRetry').waitFor({ state: 'visible' });
    await f.page.locator('#previewRetry').click();
    await f.page.waitForFunction(() => !document.getElementById('previewStart').disabled);
    assert.equal(f.commands().length, 2);
    assert.equal(f.commands()[0].options.headers['Idempotency-Key'], f.commands()[1].options.headers['Idempotency-Key']);
    assert.equal(f.commands()[0].options.body, f.commands()[1].options.body);
    await f.play();
    await f.page.evaluate(() => { const video = document.querySelector('video'); video.pause(); video.currentTime = .7; });
    await f.page.waitForFunction(() => document.getElementById('graphSaveState').textContent === 'Progress saved.');
    await f.page.locator('#graphChoices button').first().click();
    await f.page.waitForFunction(() => document.getElementById('graphBranches').hidden);
    const last = f.commands().at(-1);
    assert.equal(JSON.parse(last.options.body).expectedRevision, f.server.states.get('en').revision - 1);
  } finally { await f.close(); }
});

test('browser functional: locale and account changes detach stale native media', async () => {
  const f = await fixture();
  try {
    await f.play();
    await f.page.evaluate(() => { window.oldOttVideo = document.querySelector('video'); });
    await f.page.locator('#previewLocale').selectOption('ja');
    await f.page.waitForFunction(() => document.documentElement.lang === 'ja' && !document.getElementById('previewStart').disabled);
    await f.play();
    const count = f.calls.length;
    await f.page.evaluate(() => { for (const type of ['error', 'loadedmetadata', 'timeupdate', 'pause']) window.oldOttVideo.dispatchEvent(new Event(type)); });
    assert.equal(f.calls.length, count);
    assert.equal(await f.page.locator('track').getAttribute('srclang'), 'ja');
    await f.page.evaluate(() => { localStorage.setItem('lumina_auth', JSON.stringify({ accessToken: 'different', user: { id: 'different' } })); window.dispatchEvent(new StorageEvent('storage', { key: 'lumina_auth' })); });
    await f.page.locator('#previewPlayer').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('video').getAttribute('src'), null);
    assert.equal(await f.page.locator('#graphChoices button').count(), 0);
  } finally { await f.close(); }
});

test('browser functional: owner revocation denies session and never supplies fallback movie', async () => {
  const f = await fixture({ intercept: call => call.url.endsWith('/playback-session') ? failure(404) : undefined });
  try {
    await f.page.locator('#previewStart').click();
    await f.page.locator('#previewPlayer').waitFor({ state: 'hidden' });
    assert.equal(f.media.length, 0);
    assert.equal(await f.page.locator('video').getAttribute('src'), null);
    assert.doesNotMatch(await f.page.locator('#previewState').innerText(), /PRIVATE_DIAGNOSTIC|OTT_/);
  } finally { await f.close(); }
});

for (const locale of locales) for (const width of [390, 400, 1280]) {
  test(`browser visual: ${locale} ${width} native clip and three authored fixture choices`, async () => {
    assert.match(artifacts || '', /^E:[/\\]/i, 'explicit E-only screenshot directory');
    const f = await fixture({ width, locale, server: graphServer({ longLabels: true }) });
    try {
      await f.play();
      await f.page.waitForFunction(() => document.querySelector('video').paused && document.querySelector('video').currentTime >= .7 && !document.getElementById('previewStart').disabled);
      const metrics = await f.page.evaluate(() => {
        const boxes = ['previewTitle', 'previewState', 'privateVideo', 'previewDuration', 'previewSubtitles', 'previewStart', 'graphBranchTitle', 'graphChoices'].map(id => {
          const element = document.getElementById(id); const r = element.getBoundingClientRect();
          return { id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height,
            overflow: element.scrollWidth > element.clientWidth + 1, text: element.textContent };
        });
        const video = document.querySelector('video');
        const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
        const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 16, 16);
        const pixels = context.getImageData(0, 0, 16, 16).data;
        const colors = new Set(Array.from({ length: 256 }, (_, i) => Array.from(pixels.slice(i * 4, i * 4 + 4)).join(','))).size;
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, boxes, videoWidth: video.videoWidth, videoHeight: video.videoHeight,
          sourcePositionSeconds: video.currentTime, decodedColors: colors, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
          choiceCount: document.querySelectorAll('#graphChoices button').length,
          fixtureCaption: 'LOCAL QA ONLY: retained synthetic MP4 and authored route fixtures, not a public film, production media, translation approval, or real server/PG delivery.' };
      });
      assert.equal(metrics.choiceCount, 3);
      assert.ok(metrics.videoWidth > 0 && metrics.videoHeight > 0);
      assert.ok(metrics.decodedColors > 1 && metrics.decodedFrames > 0);
      assert.ok(metrics.sourcePositionSeconds >= .7 && metrics.sourcePositionSeconds <= .72);
      assert.ok(metrics.pageWidth <= width);
      for (const box of metrics.boxes) { assert.ok(box.left >= 0 && box.right <= width + 1 && box.height > 0, JSON.stringify(box)); assert.equal(box.overflow, false, box.id); }
      const video = metrics.boxes.find(box => box.id === 'privateVideo');
      assert.ok(video.bottom <= metrics.boxes.find(box => box.id === 'previewStart').top);
      assert.ok(metrics.boxes.find(box => box.id === 'previewStart').bottom <= metrics.boxes.find(box => box.id === 'graphChoices').top);
      for (const choice of await f.page.locator('#graphChoices button').all()) {
        await choice.scrollIntoViewIfNeeded();
        assert.equal(await choice.evaluate(element => { const r = element.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === element || element.contains(hit); }), true);
      }
      await f.page.evaluate(() => scrollTo(0, 0));
      await mkdir(artifacts, { recursive: true });
      const prefix = path.join(artifacts, `${locale}-${width}-ott-graph`);
      await f.page.screenshot({ path: prefix + '.png', fullPage: true });
      await writeFile(prefix + '.json', JSON.stringify(metrics, null, 2));
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}

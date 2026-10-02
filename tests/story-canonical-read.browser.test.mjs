import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const enabled = process.env.STORY_CANONICAL_READ_BROWSER_QA === '1';
const repo = new URL('../', import.meta.url);
const artifacts = 'E:/Codex/LuminaStage/qa-artifacts/20261002-canonical-read';
const temp = 'E:/Codex/LuminaStage/qa-temp/20261002-canonical-read';
const origin = 'https://canonical-read-fixture.invalid';
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const words = { ko: '아스터는 함께 문을 열었다. 두 사람은 안으로 들어갔다.', en: 'Aster opened the door together. They entered the room.',
  ja: 'アスターは一緒に扉を開けた。二人は部屋に入った。', 'zh-Hans': '阿斯特一起推开了门。两人走进房间。', 'zh-Hant': '阿斯特一起推開了門。兩人走進房間。' };
const copy = value => JSON.parse(JSON.stringify(value));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function projection(locale, overrides = {}) {
  return { progressId: id(2), status: 'active', revision: 3, storyVersion: 1, currentAct: 1, currentBeatPosition: 0,
    part: { id: id(5), actNumber: 1 }, scene: { id: id(4), sceneKey: 'canonical-read', title: { value: words[locale] },
      beats: Array.from({ length: 6 }, (_, index) => ({ id: id(10 + index), position: index + 1, type: 'narration',
        content: { value: ` ${index + 1}: ${words[locale]}\n\n<em>Literal</em> e\u0301 \u{1f642}\r\n`, locale, fallback: false } })) },
    choices: Array.from({ length: 3 }, (_, index) => ({ id: id(30 + index), label: { value: `Choice ${index + 1}` }, available: true })), ...overrides };
}

function preview(current, beat, locale) {
  const identity = { userId: id(1), progressId: current.progressId, workId: id(3), ownerUserId: id(6), releaseId: id(7),
    releaseChecksum: 'a'.repeat(64), manuscriptVersionId: id(8), manuscriptHash: 'b'.repeat(64), partId: current.part.id,
    sceneId: current.scene.id, beatId: beat.id, beatPosition: beat.position, actNumber: current.currentAct,
    locale, sourceChecksum: hash(`source:${beat.id}:${locale}`), sourceTextHash: hash(beat.content.value),
    routeNodeId: id(9), routeHash: 'c'.repeat(64), storyVersion: current.storyVersion, progressRevision: current.revision };
  return { contract: 'story-canonical-read-review-v1', identity, sourceChecksum: identity.sourceChecksum,
    sourceTextHash: identity.sourceTextHash, scopeChecksum: hash(JSON.stringify(identity)), expectedRevision: identity.progressRevision,
    confirmationRecorded: false, readerMemoryApplied: false };
}

function receipt(value, replay = false) {
  const pin = value.identity;
  return { contract: 'story-canonical-read-receipt-v1', receiptId: id(100 + pin.beatPosition),
    ...Object.fromEntries(['progressId', 'workId', 'sceneId', 'beatId', 'sourceChecksum', 'sourceTextHash', 'locale', 'routeNodeId', 'progressRevision'].map(key => [key, pin[key]])),
    scopeChecksum: value.scopeChecksum, invalidatedAt: null, confirmedAt: '2026-10-01T16:00:00.000Z', readerMemoryApplied: false, idempotentReplay: replay };
}

// Actual reader HTML/controllers/styles, controlled authenticated API; no production access or AI.
test('canonical source read confirmations: actual reader and scoped error/retry controls', { skip: !enabled, timeout: 240000 }, async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'E:/Codex/LuminaStage/qa-browsers';
  process.env.TEMP = temp; process.env.TMP = temp; process.env.TMPDIR = temp;
  await mkdir(temp, { recursive: true }); await mkdir(artifacts, { recursive: true });
  const html = await readFile(new URL('story-stage/index.html', repo), 'utf8');
  const resources = new Map();
  for (const path of ['/styles.css', '/styles/story-stage.css', '/pages/story-canonical-read.js', '/pages/story-stage.js']) {
    resources.set(path, await readFile(new URL(path.slice(1), repo), 'utf8'));
  }
  const { chromium } = createRequire(import.meta.url)('C:/Users/kim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), { headless: true,
    env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp } });
  const evidence = [];
  async function fixture({ locale = 'en', width = 390, mode = 'normal' } = {}) {
    const page = await context.newPage(); const calls = [], errors = [], saved = new Map();
    let current = projection(locale), failed = false, artReady = false;
    const pending = gate(), started = gate();
    if (mode === 'fallback') current.scene.beats[0].content.fallback = true;
    if (mode === 'missing-locale') current.scene.beats[0].content.locale = 'ko';
    if (mode === 'legacy') current.scene.beats.forEach(beat => { delete beat.id; });
    if (mode === 'generated') { current.scene.isGenerated = true; current.scene.deliveryState = 'ready'; }
    if (['art-refresh', 'art-inflight'].includes(mode)) { current.scene.visualGenerationAvailable = true; current.scene.visualManifest = { background: { state: 'fallback' } }; }
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(({ user, locale, mode }) => {
      window.fixtureLocale = locale; window.fixtureUser = user; window.fixtureApiFallbackCalls = 0;
      window.luminaI18n = { getLocale: () => window.fixtureLocale };
      window.isLoggedIn = () => Boolean(window.fixtureUser);
      window.getAuth = () => window.fixtureUser ? { user: { id: window.fixtureUser }, accessToken: 'synthetic-reader-token' } : null;
      window.apiFetch = async (path, options = {}) => {
        if (options.signal) window.fixtureApiFallbackCalls++;
        const response = await fetch(`https://api.lumina-stage.com${path}`, { method: options.method || 'GET',
          headers: { Authorization: 'Bearer synthetic-reader-token', 'Content-Type': 'application/json' },
          body: options.body ? JSON.stringify(options.body) : undefined });
        const body = await response.json();
        if (!response.ok) throw Object.assign(new Error('Private fixture diagnostic'), { status: response.status, body });
        return body;
      };
      if (mode === 'no-uuid') Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
      if (mode === 'timeout') {
        const nativeTimer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => nativeTimer(fn, ms === 45000 ? 400 : ms, ...args);
      }
      if (['art-refresh', 'art-inflight'].includes(mode)) {
        const nativeTimer = window.setTimeout;
        window.setTimeout = (fn, ms, ...args) => nativeTimer(fn, ms === 12000 ? 650 : ms, ...args);
      }
    }, { user: id(1), locale, mode });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === '/story-stage') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        if (resources.has(url.pathname)) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: resources.get(url.pathname) });
        if (route.request().resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
        return route.abort();
      }
      if (url.origin !== 'https://api.lumina-stage.com') return route.abort();
      const method = route.request().method();
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
      const body = method === 'POST' ? route.request().postDataJSON() : null;
      const call = { path: url.pathname, method, locale: url.searchParams.get('locale'), body, headers: route.request().headers() };
      calls.push(call);
      let result, status = 200;
      const requestedLocale = url.searchParams.get('locale') || locale;
      if (url.pathname === '/api/v1/stories') result = { items: [], nextCursor: null };
      else if (url.pathname.endsWith('/current-scene')) {
        if ((mode === 'art-refresh' && failed) || (mode === 'art-inflight' && artReady)) current.scene = { ...current.scene, visualGenerationAvailable: false, visualManifest: { background: { state: 'ready' } } };
        if (requestedLocale !== current.scene.beats[0].content.locale && !['fallback', 'missing-locale'].includes(mode)) current = projection(requestedLocale);
        result = current;
      } else if (url.pathname.endsWith('/progress-state')) result = { canFullReset: false, canActReset: false };
      else if (url.pathname.endsWith('/scene-visual')) result = { status: 'processing' };
      else if (url.pathname.includes('/canonical-read/')) {
        const beatId = url.pathname.split('/canonical-read/')[1].split('/')[0];
        const beat = current.scene.beats.find(value => value.id === beatId);
        assert.ok(beat, 'Only a displayed known source beat may be requested');
        const pin = preview(current, beat, body?.locale || requestedLocale);
        if (method === 'GET') {
          result = copy(pin);
          if (mode === 'changed-source') { result.sourceTextHash = 'd'.repeat(64); result.identity.sourceTextHash = result.sourceTextHash; }
          if (mode === 'foreign') result.identity.userId = id(90);
          if (mode === 'mixed-route' && beat.position === 2) result.identity.routeNodeId = id(91);
          if (mode === 'stale-revision') { result.identity.progressRevision++; result.expectedRevision++; }
        } else {
          assert.equal(body.locale, pin.identity.locale);
          assert.equal(body.expectedScopeChecksum, pin.scopeChecksum);
          assert.equal(body.expectedSourceTextHash, hash(beat.content.value));
          assert.equal(body.expectedRevision, current.revision);
          assert.equal(body.displayedAndRead, true);
          assert.deepEqual(Object.keys(body).sort(), ['displayedAndRead', 'expectedRevision', 'expectedScopeChecksum', 'expectedSourceTextHash', 'idempotencyKey', 'locale']);
          assert.match(body.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
          assert.equal(call.headers.authorization, 'Bearer synthetic-reader-token');
          if (mode === 'art-inflight' && beat.position === 1 && !artReady) {
            saved.set(body.idempotencyKey, receipt(pin));
            artReady = true; started.resolve(); await pending.promise;
          }
          if (['late-locale', 'late-account', 'late-page', 'timeout', 'double-click'].includes(mode)) { started.resolve(); await pending.promise; }
          result = receipt(pin, saved.has(body.idempotencyKey));
          saved.set(body.idempotencyKey, result);
          if (['unknown', 'art-refresh'].includes(mode) && beat.position === 2 && !failed) { failed = true; status = 500; result = { code: 'PRIVATE_DIAGNOSTIC' }; }
          if (mode === 'bad-receipt') result.beatId = id(90);
          if (mode === 'denied') { status = 401; result = { code: 'PRIVATE_DIAGNOSTIC' }; }
        }
      } else if (url.pathname.endsWith('/beat')) {
        assert.equal(body.expectedRevision, current.revision);
        current = { ...current, currentBeatPosition: body.position, revision: current.revision + 1 };
        result = current;
      } else throw new Error(`Unexpected controlled API path ${url.pathname}`);
      await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'private, no-store' }, body: JSON.stringify(result) }).catch(() => {});
    });
    await page.goto(`${origin}/story-stage?sessionId=${id(2)}&workId=${id(3)}`);
    await page.evaluate(() => document.body.classList.remove('is-booting'));
    await page.locator('.story-player-copy').waitFor();
    const readPosts = () => calls.filter(value => value.method === 'POST' && value.path.endsWith('/confirm'));
    return { page, calls, errors, saved, readPosts, pending, started, current: () => current,
      async close() { pending.resolve(); await page.close(); } };
  }
  try {
    for (const width of [390, 400, 1280]) for (const locale of locales) {
      const f = await fixture({ width, locale });
      try {
        assert.equal(f.readPosts().length, 0, 'Opening a page must never record a read');
        assert.equal(await f.page.locator('.story-player-copy em').count(), 0, 'Source markup stays literal');
        await f.page.locator('[data-story-canonical-read]').click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-canonical-read]')?.disabled && document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false', null, { timeout: 6000 }).catch(async error => {
          await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ width, locale, errors: f.errors,
            calls: f.calls.map(value => ({ path: value.path, method: value.method, locale: value.locale })),
            status: await f.page.locator('[data-story-canonical-read-status]').textContent(),
            paragraphs: await f.page.locator('.story-player-copy p').allTextContents() }, null, 2));
          throw error;
        });
        assert.equal(f.readPosts().length, 2);
        assert.equal(f.current().revision, 3, 'Confirmation never advances story revision or cursor');
        const button = f.page.locator('[data-story-canonical-read]');
        await button.scrollIntoViewIfNeeded();
        const fit = await button.evaluate(node => {
          const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { left: rect.left, right: rect.right, width: innerWidth, fits: node.scrollWidth <= node.clientWidth,
            uncovered: node === hit || node.contains(hit) };
        });
        assert.ok(fit.left >= 0 && fit.right <= width + 1 && fit.fits && fit.uncovered, JSON.stringify(fit));
        assert.deepEqual(f.errors, []);
        const screenshot = join(artifacts, `read-${width}-${locale}.png`);
        await f.page.locator('.story-reader-pane').screenshot({ path: screenshot });
        await f.page.locator('[data-story-beat="next"]').click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-beat-counter]')?.textContent === '2 / 3');
        assert.equal(f.readPosts().length, 2, 'Normal navigation must not automatically confirm the next page');
        assert.equal(await f.page.locator('[data-story-canonical-read]:enabled').count(), 1);
        evidence.push({ width, locale, sourceExact: true, explicitlyConfirmed: 2, cursorUnchanged: true, controlFit: fit,
          screenshot, navigationPreserved: true, actualLogin: false, liveApi: false, realAi: false });
      } finally { await f.close(); }
    }
    for (const mode of ['fallback', 'missing-locale', 'legacy', 'generated']) {
      const f = await fixture({ mode });
      try { assert.equal(await f.page.locator('[data-story-canonical-read]').count(), 0); assert.equal(f.readPosts().length, 0);
        evidence.push({ mode, refusedWithoutHidingProse: true }); } finally { await f.close(); }
    }
    for (const mode of ['changed-source', 'foreign', 'mixed-route', 'stale-revision', 'no-uuid']) {
      const f = await fixture({ mode });
      try { await f.page.locator('[data-story-canonical-read]').click();
        await f.page.waitForFunction(() => document.querySelector('[data-story-canonical-read-refresh]') !== null);
        assert.equal(f.readPosts().length, 0); assert.equal(await f.page.locator('[data-story-beat="next"]:enabled').count(), 1);
        evidence.push({ mode, preflightRefusedAllWrites: true, navigationAvailable: true }); } finally { await f.close(); }
    }
    for (const mode of ['unknown', 'art-refresh', 'art-inflight', 'bad-receipt', 'denied']) {
      const f = await fixture({ mode });
      try { await f.page.locator('[data-story-canonical-read]').click();
        await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') !== 'true');
        if (mode === 'denied') { assert.equal(await f.page.locator('[data-story-canonical-read]').count(), 0);
          assert.equal(f.readPosts().length, 1); assert.equal(await f.page.evaluate(() => window.fixtureApiFallbackCalls), 0); }
        else {
          if (mode === 'art-inflight') await f.started.promise;
          if (['art-refresh', 'art-inflight'].includes(mode)) {
            await f.page.waitForFunction(() => document.querySelector('.story-action-status')?.textContent === '');
            assert.ok(f.calls.filter(value => value.path.endsWith('/current-scene')).length >= 3,
              'Artwork polling and its automatic scene refresh must actually finish');
          }
          if (mode === 'art-inflight') f.pending.resolve();
          assert.equal(await f.page.locator('[data-story-canonical-read]:enabled').count(), 1);
          const previous = copy(f.readPosts());
          await f.page.locator('[data-story-canonical-read]').click();
          await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false');
          const retry = f.readPosts().slice(previous.length);
          assert.equal(retry.length, mode === 'art-inflight' ? 2 : 1);
          assert.deepEqual(retry[0].body, previous.at(-1).body, 'Ambiguous replay must retain exact body/key');
          if (['unknown', 'art-refresh', 'art-inflight'].includes(mode)) assert.equal(await f.page.locator('[data-story-canonical-read]:disabled').count(), 1);
          if (mode === 'art-inflight') assert.equal(f.saved.size, 2, 'Committed member replay retains its original server key');
        }
        assert.equal(await f.page.locator('#storyStageRoot').innerText().then(value => value.includes('PRIVATE_DIAGNOSTIC')), false);
        evidence.push({ mode, noAutomaticPostReplay: true, exactManualRetry: mode !== 'denied' });
      } finally { await f.close(); }
    }
    for (const mode of ['late-locale', 'late-account', 'late-page', 'timeout', 'double-click']) {
      const f = await fixture({ mode });
      try {
        await f.page.locator('[data-story-canonical-read]').click(); await f.started.promise;
        if (mode === 'late-locale') await f.page.evaluate(() => { window.fixtureLocale = 'ja'; window.dispatchEvent(new Event('lumina:localechange')); });
        if (mode === 'late-account') await f.page.evaluate(() => { window.fixtureUser = null; window.dispatchEvent(new Event('lumina:authchange')); });
        if (mode === 'late-page') await f.page.evaluate(() => { history.pushState({}, '', '/story-stage'); window.dispatchEvent(new Event('popstate')); });
        if (mode === 'double-click') await f.page.evaluate(() => document.querySelector('[data-story-canonical-read]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
        if (mode === 'timeout') await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false');
        f.pending.resolve();
        if (mode === 'double-click') {
          await f.page.waitForFunction(() => document.querySelector('#storyStageRoot').getAttribute('aria-busy') === 'false');
          assert.equal(f.readPosts().length, 2, 'Duplicate click cannot start another batch');
        } else {
          await f.page.waitForTimeout(100);
          assert.equal(f.readPosts().length, 1, 'No later page members dispatched after cancellation');
          if (mode === 'late-locale') assert.equal(await f.page.locator('[data-story-canonical-read]:enabled').count(), 1);
          if (mode === 'late-account') assert.equal(await f.page.locator('.story-player-copy').count(), 0);
          if (mode === 'timeout') assert.equal(await f.page.locator('[data-story-canonical-read]:enabled').count(), 1);
        }
        evidence.push({ mode, lateResponseFenced: mode !== 'double-click', duplicateClicksSerialized: mode === 'double-click' });
      } finally { await f.close(); }
    }
  } finally { await context.close(); await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
  assert.equal(evidence.length, 34);
});

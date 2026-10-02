import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.OTT_UI_PLAYWRIGHT || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const api = 'https://api.lumina-stage.com/api/v1/ott';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const artifacts = process.env.OTT_PUBLIC_BROWSER_ARTIFACTS;
const capture = (page, name) => artifacts ? page.screenshot({ path: join(artifacts, name), fullPage: false }) : Promise.resolve();
const item = {
  slug: 'public-title', title: { ko: '<img src=x onerror=alert(1)>작품' },
  synopsis: { ko: '공개 줄거리' }, creatorName: { ko: '제작자' },
  publishedAt: '2026-09-29T00:00:00Z',
  viewing: { available: true, watchPath: '/api/v1/ott/public-title/watch' },
};

function watch(locale) {
  const node = (key, choices, ending = null) => ({
    key, clip: { startMs: 0, endMs: 5000 }, choices, ending,
    subtitles: [{ startMs: 0, endMs: 5000, text: `<b>${locale} caption</b>` }],
    browserPlayback: { sessionPath: `/api/v1/ott/public-title/nodes/${key}/playback-session`, method: 'POST' },
  });
  return {
    entryNodeKey: 'intro',
    nodes: [node('intro', [
      { key: 'a', label: `<img src=x onerror=alert(1)> ${locale}`, targetNodeKey: 'branch' },
      { key: 'b', label: `${locale} second`, targetNodeKey: 'branch' },
      { key: 'c', label: `${locale} third`, targetNodeKey: 'branch' },
    ]), node('branch', [], { key: 'end', label: `${locale} ending` })],
  };
}

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside root');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png' };
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
    } catch { response.writeHead(404).end('not found'); }
  });
}

test('public fullscreen request cannot reopen a closed player after late resolution or rejection', async () => {
  const server = staticServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('https://api.lumina-stage.com/**', route => route.fulfill({ status: 200, json: { items: [] } }));
    await page.route('**/*.mp4', route => route.fulfill({ status: 404 }));
    await page.route(`${api}**`, route => {
      const url = new URL(route.request().url());
      const body = value => route.fulfill({ status: 200, json: value,
        headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' } });
      if (url.pathname === '/api/v1/ott/public-title') return body(item);
      if (url.pathname.endsWith('/watch')) return body(watch('ko'));
      if (url.pathname.endsWith('/playback-session')) return body({ playback: {
        path: '/api/v1/ott/public-title/nodes/intro/delivery',
        expiresAt: new Date(Date.now() + 1800000).toISOString(), mode: 'secure_http_only_cookie',
      } });
      return route.fulfill({ status: 200, body: '' });
    });
    await page.addInitScript(() => {
      sessionStorage.setItem('ls_splashed', '1');
      localStorage.setItem('lumina_locale', 'ko-KR');
      HTMLMediaElement.prototype.load = function () { setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0); };
      HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () {};
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get() { return this.__time || 0; }, set(value) { this.__time = value; } });
    });
    await page.goto(`${base}/ott?title=public-title`, { waitUntil: 'domcontentloaded' });
    await page.locator('#ottStartViewing').waitFor();
    for (const outcome of ['reject', 'resolve']) {
      await page.locator('#ottStartViewing').click();
      await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/intro/delivery'));
      await page.evaluate(outcome => {
        const wrap = document.querySelector('.ott-video-wrap');
        let nativeElement = null;
        let resolve, reject;
        const pending = new Promise((ok, fail) => { resolve = ok; reject = fail; });
        window.__fullscreenCalls = 0;
        window.__fullscreenExits = 0;
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => nativeElement });
        document.exitFullscreen = async () => {
          window.__fullscreenExits++; nativeElement = null;
          document.dispatchEvent(new Event('fullscreenchange'));
        };
        wrap.requestFullscreen = () => { window.__fullscreenCalls++; return pending; };
        window.__finishFullscreen = async () => {
          if (outcome === 'resolve') { nativeElement = wrap; resolve(); document.dispatchEvent(new Event('fullscreenchange')); }
          else reject(new Error('late denial'));
          await new Promise(ok => setTimeout(ok, 0));
        };
      }, outcome);
      await page.locator('#ottToggleFullscreen').click();
      assert.equal(await page.locator('#ottToggleFullscreen').isDisabled(), true);
      await page.locator('#ottToggleFullscreen').dispatchEvent('click');
      await page.locator('#ottBackToList').click();
      await page.locator('#ottStartViewing').waitFor({ state: 'visible' });
      await page.evaluate(() => window.__finishFullscreen());
      assert.equal(await page.locator('.ott-video-wrap.is-pseudo-fullscreen').count(), 0);
      assert.equal(await page.evaluate(() => document.fullscreenElement), null);
      assert.equal(await page.evaluate(() => document.body.classList.contains('ott-fullscreen-active')), false);
      assert.equal(await page.locator('#ottStartViewing').isVisible(), true);
      assert.equal(await page.evaluate(() => window.__fullscreenCalls), 1);
      if (outcome === 'resolve') assert.equal(await page.evaluate(() => window.__fullscreenExits), 1);
    }
    await page.locator('#ottStartViewing').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/intro/delivery'));
    await page.locator('#ottToggleFullscreen').click();
    await page.evaluate(() => window.__finishFullscreen());
    await page.locator('#ottDemoVideo').evaluate(video => video.dispatchEvent(new Event('ended')));
    await page.locator('#ottPublicChoices button').first().waitFor();
    await page.evaluate(() => { document.exitFullscreen = async () => { throw new Error('exit denied'); }; });
    await page.locator('#ottChoiceBack').click();
    assert.equal(await page.locator('#ottPublicChoices button').first().isVisible(), true, 'A rejected native exit must keep viewing and its choices reachable');
    assert.equal(await page.locator('#ottDemo').isVisible(), true);
    await page.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null }); });
    await page.locator('#ottChoiceBack').click();
    await page.locator('#ottStartViewing').waitFor({ state: 'visible' });
    await page.close();
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    server.unref();
  }
});

test('public watch follows safe nodes, renews its cookie session, localizes captions, and recovers', async () => {
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  if (artifacts) await mkdir(artifacts, { recursive: true });
  let browser;
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const sessions = [];
    let failBranchOnce = true;
    let failNextJapaneseWatch = false;
    await page.route(`${api}**`, (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const body = (value, status = 200) => route.fulfill({ status, contentType: 'application/json',
        headers: { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(value) });
      if (path === '/api/v1/ott') return body({ items: [item] });
      if (path === '/api/v1/ott/public-title') return body(item);
      if (path === '/api/v1/ott/public-title/watch') {
        if (failNextJapaneseWatch && url.searchParams.get('locale') === 'ja') {
          failNextJapaneseWatch = false;
          return body({ error: 'temporary' }, 503);
        }
        return body(watch(url.searchParams.get('locale')));
      }
      const match = /^\/api\/v1\/ott\/public-title\/nodes\/(intro|branch)\/playback-session$/.exec(path);
      if (match) {
        sessions.push(match[1]);
        if (match[1] === 'branch' && failBranchOnce) {
          failBranchOnce = false;
          return body({ error: 'temporary' }, 503);
        }
        return body({ playback: { path: `/api/v1/ott/public-title/nodes/${match[1]}/delivery`,
          expiresAt: new Date(Date.now() + 1800).toISOString(), mode: 'secure_http_only_cookie' } });
      }
      return route.fulfill({ status: 404 });
    });
    await page.route(`${api}/public-title/nodes/*/delivery`, (route) => route.fulfill({ status: 200, body: '' }));
    await page.addInitScript(() => {
      sessionStorage.setItem('ls_splashed', '1');
      localStorage.setItem('lumina_locale', 'ko-KR');
      window.__sessionCredentials = [];
      const originalFetch = window.fetch;
      window.fetch = (input, options) => {
        if (String(input).includes('/playback-session')) window.__sessionCredentials.push(options?.credentials);
        return originalFetch(input, options);
      };
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
        configurable: true, get() { return this.__time || 0; }, set(value) { this.__time = value; },
      });
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 5; } });
      HTMLMediaElement.prototype.load = function () { setTimeout(() => {
        this.__metadataCount = (this.__metadataCount || 0) + 1;
        this.dispatchEvent(new Event('loadedmetadata'));
      }, 0); };
      HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () {};
    });
    await page.goto(`${base}/ott`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ott-card-art').waitFor();
    await capture(page, 'ott-public-catalog-390.png');
    await page.locator('.ott-card-art').click();
    await page.locator('#ottStartViewing').waitFor();
    assert.equal(await page.locator('.ott-detail-copy img').count(), 0);
    await capture(page, 'ott-public-detail-390.png');
    await page.locator('#ottStartViewing').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/intro/delivery'));
    await capture(page, 'ott-public-watch-390.png');
    assert.equal(await page.locator('#ottDemoVideo').evaluate((video) => video.crossOrigin), 'use-credentials');
    assert.equal(await page.locator('#ottDemoVideo').evaluate((video) => video.playsInline), true);
    await page.waitForFunction(() => window.__sessionCredentials.length >= 2, null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => window.__sessionCredentials.slice(0, 2)), ['include', 'include']);
    assert.ok(sessions.filter((key) => key === 'intro').length >= 2);
    await page.locator('#ottDemoVideo').evaluate((video) => { video.currentTime = 1; video.dispatchEvent(new Event('timeupdate')); });
    assert.equal(await page.locator('#ottCaptionDisplay').innerText(), '<b>ko caption</b>');
    assert.equal(await page.locator('#ottCaptionDisplay b').count(), 0);
    for (const [selected, code] of [['en-US', 'en'], ['ja-JP', 'ja'], ['zh-CN', 'zh-Hans'], ['zh-Hant', 'zh-Hant'], ['ko-KR', 'ko']]) {
      await page.evaluate((value) => window.luminaI18n.setLocale(value), selected);
      await page.waitForFunction((value) => document.getElementById('ottCaptionDisplay').textContent === `<b>${value} caption</b>`, code);
    }
    await page.locator('#ottDemoVideo').evaluate((video) => { video.currentTime = 4.9; video.dispatchEvent(new Event('timeupdate')); });
    await page.locator('#ottPublicChoices button').first().waitFor();
    await capture(page, 'ott-public-choices-390.png');
    assert.equal(await page.locator('#ottPublicChoices button').count(), 3);
    assert.equal(await page.locator('#ottPublicChoices img').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#ottPublicChoices button')), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelectorAll('#ottPublicChoices button')[1]), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#ottPublicChoices button')), true);
    for (const [selected, code] of [['en-US', 'en'], ['ja-JP', 'ja'], ['zh-CN', 'zh-Hans'], ['zh-Hant', 'zh-Hant'], ['ko-KR', 'ko']]) {
      await page.evaluate((value) => window.luminaI18n.setLocale(value), selected);
      await page.waitForFunction((value) => document.querySelector('#ottPublicChoices button')?.textContent.includes(value), code);
      assert.equal(await page.locator('#ottPublicChoices button').count(), 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#ottPublicChoices').evaluate((list) => [...list.querySelectorAll('button')].every((button) => {
        const bounds = button.getBoundingClientRect();
        const overlay = document.getElementById('ottChoiceOverlay').getBoundingClientRect();
        return bounds.left >= overlay.left && bounds.right <= overlay.right && bounds.top >= overlay.top && bounds.bottom <= overlay.bottom;
      })), true);
    }
    await page.locator('#ottPublicChoices button').first().click();
    await page.locator('#ottVideoError').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottVideoRetry');
    await capture(page, 'ott-public-error-390.png');
    await page.locator('#ottVideoRetry').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/branch/delivery'));
    await page.setViewportSize({ width: 568, height: 320 });
    await page.locator('.ott-video-wrap').evaluate((wrap) => {
      wrap.requestFullscreen = () => Promise.reject(new Error('fullscreen unavailable'));
    });
    await page.locator('#ottToggleFullscreen').click();
    await page.locator('#ottDemoVideo').evaluate((video) => video.dispatchEvent(new Event('error')));
    await page.locator('#ottVideoError').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottVideoRetry');
    await capture(page, 'ott-public-error-fullscreen-568.png');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottFullscreenExit');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottVideoRetry');
    const beforeRetryMetadata = await page.locator('#ottDemoVideo').evaluate(video => video.__metadataCount || 0);
    await page.locator('#ottVideoRetry').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/branch/delivery'));
    await page.waitForFunction(count => document.getElementById('ottDemoVideo').__metadataCount > count, beforeRetryMetadata);
    await page.locator('#ottDemoVideo').evaluate((video) => { video.currentTime = 4.9; video.dispatchEvent(new Event('timeupdate')); });
    await page.locator('#ottPublicEnding').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ottPublicEnding').innerText(), 'ko ending');
    await page.locator('#ottRestart').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/intro/delivery'));
    await page.locator('#ottDemoVideo').evaluate((video) => { video.currentTime = 4.9; video.dispatchEvent(new Event('timeupdate')); });
    await capture(page, 'ott-public-choices-fullscreen-568.png');
    failNextJapaneseWatch = true;
    const failedMobileTranslation = page.waitForResponse((response) =>
      response.url().includes('/public-title/watch?locale=ja') && response.status() === 503);
    await page.evaluate(() => window.luminaI18n.setLocale('ja-JP'));
    await failedMobileTranslation;
    assert.equal(await page.locator('.ott-video-wrap.is-pseudo-fullscreen').count(), 1);
    assert.equal(await page.locator('#ottNoChoices').isVisible(), false);
    assert.equal(await page.locator('#ottChoicePrompt').innerText(), '次のシーンを選んでください。');
    await capture(page, 'ott-public-choices-translation-failure-fullscreen-568.png');
    await page.evaluate(() => window.luminaI18n.setLocale('ko-KR'));
    await page.waitForFunction(() => document.querySelector('#ottPublicChoices button')?.textContent.includes('ko'));
    await page.locator('#ottPublicChoices button').last().scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#ottPublicChoices button').last().evaluate((button) => {
      const box = button.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
    }), true);
    await page.locator('#ottRestart').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#ottRestart').evaluate((button) => {
      const box = button.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }), true);
    await page.locator('#ottChoiceBack').click();
    assert.equal(await page.locator('#ottStartViewing').isVisible(), true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${base}/ott`, { waitUntil: 'domcontentloaded' });
    await page.locator('.ott-card-art').waitFor();
    await capture(page, 'ott-public-catalog-1280.png');
    await page.locator('.ott-card-art').click();
    await page.locator('#ottStartViewing').waitFor();
    await capture(page, 'ott-public-detail-1280.png');
    await page.locator('#ottStartViewing').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').src.endsWith('/intro/delivery'));
    await capture(page, 'ott-public-watch-1280.png');
    await page.locator('#ottToggleFullscreen').click();
    const nativeFullscreen = await page.evaluate(() => document.fullscreenElement === document.querySelector('.ott-video-wrap'));
    assert.equal(nativeFullscreen || await page.locator('.ott-video-wrap.is-pseudo-fullscreen').count() === 1, true);
    await page.locator('#ottDemoVideo').evaluate((video) => { video.currentTime = 4.9; video.dispatchEvent(new Event('timeupdate')); });
    await page.locator('#ottPublicChoices button').first().waitFor();
    await capture(page, nativeFullscreen ? 'ott-public-choices-native-fullscreen-1280.png' : 'ott-public-choices-fallback-fullscreen-1280.png');
    failNextJapaneseWatch = true;
    const failedTranslation = page.waitForResponse((response) =>
      response.url().includes('/public-title/watch?locale=ja') && response.status() === 503);
    await page.evaluate(() => window.luminaI18n.setLocale('ja-JP'));
    await failedTranslation;
    assert.equal(await page.evaluate(() => document.fullscreenElement === document.querySelector('.ott-video-wrap') ||
      document.querySelector('.ott-video-wrap').classList.contains('is-pseudo-fullscreen')), true);
    assert.equal(await page.locator('#ottFullscreenExit').isVisible(), true);
    assert.equal(await page.locator('#ottChoiceBack').isVisible(), true);
    assert.equal(await page.locator('#ottNoChoices').isVisible(), false);
    assert.equal(await page.locator('#ottChoicePrompt').innerText(), '次のシーンを選んでください。');
    await capture(page, 'ott-public-choices-translation-failure-fullscreen-1280.png');
    await page.evaluate(() => window.luminaI18n.setLocale('ko-KR'));
    await page.waitForFunction(() => document.querySelector('#ottPublicChoices button')?.textContent.includes('ko'));
    await page.locator('#ottFullscreenExit').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottChoiceBack');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'ottFullscreenExit');
    await page.locator('#ottFullscreenExit').click();
    await page.route(`${api}/public-title`, (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...item, viewing: { available: false } }) }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.ott-boundary').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ottStartViewing').count(), 0);
    assert.equal(await page.locator('.ott-boundary').isVisible(), true);
    await page.close();
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    server.unref();
  }
});

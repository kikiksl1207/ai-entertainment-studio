import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

test('mobile choice overlay keeps every action reachable in five languages', async () => {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (pathname.startsWith('/api/')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end('{"items":[]}');
      }
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside root');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' });
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    await page.route('https://api.lumina-stage.com/api/v1/ott', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '{"items":[]}',
    }));
    await page.route('**/*.mp4', (route) => route.fulfill({
      status: 200, contentType: 'video/mp4', headers: { 'content-length': '1024' }, body: '',
    }));
    await page.addInitScript(() => {
      sessionStorage.setItem('ls_splashed', '1');
      localStorage.setItem('lumina_locale', 'ko-KR');
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/ott`, { waitUntil: 'domcontentloaded' });
    await page.locator('#ottOpenDemo').click();
    await page.locator('#ottDemoVideo').evaluate((video) => video.dispatchEvent(new Event('ended')));
    await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible' });
    for (const language of ['ko-KR', 'en-US', 'ja-JP', 'zh-CN', 'zh-Hant']) {
      await page.evaluate((value) => window.luminaI18n.setLocale(value), language);
      const state = await page.locator('#ottChoiceOverlay').evaluate((overlay) => {
        const viewport = overlay.getBoundingClientRect();
        const content = overlay.querySelector('.ott-choice-content').getBoundingClientRect();
        return { contentTop: content.top, overlayTop: viewport.top, contentBottom: content.bottom,
          overlayBottom: viewport.bottom, scrollable: overlay.scrollHeight > overlay.clientHeight };
      });
      assert.ok(state.contentTop >= state.overlayTop - 1, `${language}: prompt clipped above player: ${JSON.stringify(state)}`);
      assert.ok(state.contentBottom <= state.overlayBottom + 1 || state.scrollable,
        `${language}: lower actions clipped without scrolling: ${JSON.stringify(state)}`);
    }
    await page.locator('#ottRestart').click();
    await page.setViewportSize({ width: 480, height: 220 });
    await page.locator('.ott-video-wrap').evaluate((wrap) => {
      wrap.requestFullscreen = () => Promise.reject(new Error('native fullscreen unavailable'));
    });
    await page.locator('#ottToggleFullscreen').click();
    await page.locator('#ottDemoVideo').evaluate((video) => video.dispatchEvent(new Event('ended')));
    await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.ott-video-wrap').evaluate((wrap) => wrap.classList.contains('is-pseudo-fullscreen')), true);
    assert.equal(await page.locator('#ottChoiceOverlay').evaluate((overlay) => overlay.scrollHeight > overlay.clientHeight), true);
    for (const selector of ['#ottChoicePrompt', '#ottRestart']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      assert.equal(await page.locator(selector).evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const overlay = document.getElementById('ottChoiceOverlay').getBoundingClientRect();
        return bounds.top >= overlay.top - 1 && bounds.bottom <= overlay.bottom + 1;
      }), true, `${selector} reachable in virtual fullscreen`);
    }
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    server.unref();
  }
});

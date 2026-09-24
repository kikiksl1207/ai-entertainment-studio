import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.OTT_PUBLIC_BROWSER_ARTIFACTS || 'E:\\CodexMovedCache\\qa-public-ott-20260922';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' };

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (pathname === '/api/v1/ott') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end('{"items":[]}');
      }
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside root');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      if (extname(path) === '.mp4') {
        const data = await readFile(path);
        const headers = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' };
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
          response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': end - start + 1 });
          return response.end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
        }
        response.writeHead(200, { ...headers, 'content-length': data.length });
        return response.end(request.method === 'HEAD' ? undefined : data);
      }
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

test('public discovery works at desktop and mobile widths and captures verified screenshots', async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
        : {}),
    });
    for (const width of [390, 400, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      await page.addInitScript(() => {
        sessionStorage.setItem('ls_splashed', '1');
        localStorage.setItem('lumina_locale', 'ko-KR');
      });

      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.locator('.hero-product-links a[href="/story-stage"]').waitFor();
      await page.locator('.hero-product-links a[href="/ott"]').waitFor();
      await page.locator('.hero-product-links a[href="/lumina-pick"]').waitFor();
      const tileLabels = await page.locator('.hero-product-links strong').allTextContents();
      assert.deepEqual(tileLabels, ['스토리', '영상 작품', '루미나 픽']);
      const tileStyle = await page.locator('.hero-product-links a').first().evaluate((element) => {
        const style = getComputedStyle(element);
        const secondary = getComputedStyle(element.querySelector('span'));
        return { background: style.backgroundColor, border: style.borderColor, color: style.color, secondaryColor: secondary.color, secondarySize: secondary.fontSize };
      });
      assert.match(tileStyle.background, /^rgba?\((?:255,\s*){2}255,/);
      assert.notEqual(tileStyle.background, 'rgb(255, 255, 255)');
      assert.match(tileStyle.color, /^rgb\((?:24[0-9]|25[0-5]),/);
      assert.equal(Number.parseFloat(tileStyle.secondarySize) >= 12, true);
      if (width < 500) {
        const tabs = await page.locator('.mobile-tab').evaluateAll((nodes) => nodes.map((node) => node.dataset.tabKey));
        assert.deepEqual(tabs, ['index', 'characters', 'story', 'ott', 'lumina-feed', 'lumina-pick']);
      }
      if (width === 390) {
        const expectedLabels = {
          'ko-KR': ['홈', '아티스트', '스토리', 'OTT', '피드', '루미나 픽'],
          'en-US': ['Home', 'Artists', 'Story', 'OTT', 'Feed', 'Lumina Pick'],
          'ja-JP': ['ホーム', 'アーティスト', '物語', 'OTT', 'フィード', 'ルミナピック'],
          'zh-CN': ['首页', '艺人', '故事', 'OTT', '动态', 'Lumina Pick'],
          'zh-Hant': ['首頁', '藝人', '故事', 'OTT', '動態', 'Lumina Pick'],
        };
        for (const [locale, expected] of Object.entries(expectedLabels)) {
          await page.evaluate((nextLocale) => window.luminaI18n.setLocale(nextLocale), locale);
          assert.deepEqual(await page.locator('.mobile-tab span').allTextContents(), expected);
        }
        await page.evaluate(() => window.luminaI18n.setLocale('ko-KR'));
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: join(artifacts, `home-${width}.png`), fullPage: false });

      await page.goto(`${base}/ott`, { waitUntil: 'networkidle' });
      await page.locator('#ottDemoVideo').waitFor();
      assert.equal(await page.locator('#ottCatalog').isVisible(), false);
      assert.equal(await page.locator('video').count(), 1);
      assert.equal(await page.locator('audio, [data-private-preview]').count(), 0);
      assert.equal(await page.locator('[data-ott-branch]').count(), 3);
      assert.equal(await page.locator('#ottChoiceOverlay').isVisible(), false);
      assert.equal(await page.locator('video').evaluate((video) => video.videoWidth === 1280 && video.videoHeight === 720), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: join(artifacts, `ott-${width}.png`), fullPage: false });
      await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
    await page.goto(`${base}/ott`, { waitUntil: 'domcontentloaded' });
    const video = page.locator('#ottDemoVideo');
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').duration > 0);
    await video.evaluate((element) => element.play());
    await video.evaluate((element) => {
      element.currentTime = element.duration - 2.5;
      element.dispatchEvent(new Event('timeupdate'));
    });
    await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await video.evaluate((element) => element.ended), false);
    assert.equal(await page.locator('[data-ott-branch]:visible').count(), 3);
    assert.equal(await page.locator('[data-ott-branch="ignore"]').isDisabled(), true);
    assert.equal(await page.locator('[data-ott-branch="hesitate"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => {
      const second = document.querySelector('[data-ott-branch="hesitate"]').getBoundingClientRect();
      const tabbar = document.querySelector('.mobile-tabbar').getBoundingClientRect();
      return second.bottom <= tabbar.top;
    }), true);
    await page.screenshot({ path: join(artifacts, 'ott-choice-400.png'), fullPage: false });
    await page.locator('[data-ott-branch="embrace"]').click();
    assert.match(await video.evaluate((element) => element.currentSrc), /02-branch-embrace-original\.mp4$/);
    await page.locator('#ottChoiceOverlay').waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await page.locator('[data-ott-branch="ignore"]').isDisabled(), true);
    await page.locator('#ottRestart').click();
    await page.waitForFunction(() => document.getElementById('ottDemoVideo').currentSrc.endsWith('/01-common-to-choice.mp4'));

    await page.route('**/03-branch-ignore.mp4', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-ott-branch="ignore"]').isEnabled(), true);
    assert.equal(await page.locator('[data-ott-branch="hesitate"]').isDisabled(), true);
    await page.route('**/04-branch-hesitate.mp4', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: '' }));
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-ott-branch="ignore"]').isEnabled(), true);
    assert.equal(await page.locator('[data-ott-branch="hesitate"]').isEnabled(), true);
    await page.close();
  } finally {
    await browser?.close();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    server.unref();
  }
});

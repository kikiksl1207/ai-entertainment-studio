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
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

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
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(await readFile(path));
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
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  try {
    for (const width of [390, 400, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));

      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.locator('.hero-product-links a[href="/story-stage"]').waitFor();
      await page.locator('.hero-product-links a[href="/ott"]').waitFor();
      await page.locator('.hero-product-links a[href="/lumina-pick"]').waitFor();
      if (width < 500) {
        const tabs = await page.locator('.mobile-tab').evaluateAll((nodes) => nodes.map((node) => node.dataset.tabKey));
        assert.deepEqual(tabs, ['index', 'characters', 'story', 'ott', 'lumina-feed']);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: join(artifacts, `home-${width}.png`), fullPage: false });

      await page.goto(`${base}/ott`, { waitUntil: 'networkidle' });
      await page.getByText('지금 공개된 OTT 작품이 없습니다.').waitFor();
      assert.equal(await page.locator('video, audio, [data-private-preview]').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: join(artifacts, `ott-${width}.png`), fullPage: false });
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

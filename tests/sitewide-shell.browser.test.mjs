import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.SITEWIDE_BROWSER_ARTIFACTS || 'E:\\Codex\\LuminaStage\\qa-sitewide-shell-20260928';
const browserExecutable = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const paths = ['/', '/characters', '/story-stage', '/ott', '/lumina-feed', '/lumina-pick'];
const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];
const widths = [1280, 390, 400];
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      let path = normalize(join(root, pathname.replace(/^\/+/, '')));
      if (!path.startsWith(normalize(root))) throw new Error('outside repo');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(path));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
}

test('six public sections keep the same navigation order and fit desktop/mobile in five locales', { timeout: 180_000 }, async () => {
  await mkdir(artifacts, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://shell.qa.test:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      args: ['--host-resolver-rules=MAP shell.qa.test 127.0.0.1', '--no-proxy-server'],
      ...(browserExecutable ? { executablePath: browserExecutable } : {}) });
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 } });
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin === base) return route.continue();
        if (url.origin === 'https://api.lumina-stage.com') return route.fulfill({ status: 200,
          contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"items":[],"providers":[]}' });
        return route.abort();
      });
      await page.addInitScript(() => sessionStorage.setItem('ls_splashed', '1'));
      for (const path of paths) {
        await page.goto(base + path, { waitUntil: 'domcontentloaded' });
        await page.locator('body.is-ready').waitFor({ timeout: 10_000 });
        for (const locale of locales) {
          await page.evaluate((value) => window.luminaI18n.setLocale(value), locale);
          const layout = await page.evaluate(() => {
            const links = [...document.querySelectorAll('.main-nav > a')];
            const mobile = [...document.querySelectorAll('.mobile-tabbar > a')];
            const header = document.querySelector('.site-header, header.site-header');
            const footer = document.querySelector('footer');
            const rect = (el) => el?.getBoundingClientRect().toJSON();
            return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
              links: links.map((el) => new URL(el.href).pathname), mobile: mobile.map((el) => new URL(el.href).pathname),
              header: rect(header), footer: rect(footer), lang: document.documentElement.lang,
              regionalLocale: window.luminaI18n.getRegionalLocale() };
          });
          assert.deepEqual(layout.links, paths, `desktop menu ${path} ${locale}`);
          assert.deepEqual(layout.mobile, paths, `mobile menu ${path} ${locale}`);
          assert.equal(layout.regionalLocale, locale, `language state ${path}`);
          assert.equal(layout.lang, locale, `document language ${path}`);
          assert.ok(layout.documentWidth <= width + 1, `horizontal clipping ${path} ${locale} ${width}: ${JSON.stringify(layout)}`);
          if (layout.header) assert.ok(layout.header.left >= -1 && layout.header.right <= width + 1,
            `header clipping ${path} ${locale} ${width}`);
        }
        if (width !== 400) {
          await page.evaluate(() => window.luminaI18n.setLocale('ko-KR'));
          if (path === '/') await page.waitForFunction(() => getComputedStyle(document.getElementById('splashScreen')).opacity === '0');
          await page.screenshot({ path: join(artifacts, `${path === '/' ? 'home' : path.slice(1)}-${width}.png`) });
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

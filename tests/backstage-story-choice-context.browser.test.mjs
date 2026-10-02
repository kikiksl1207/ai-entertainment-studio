import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const artifacts = process.env.STORY_UI_ARTIFACTS;
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const bootstrap = `
const mode = new URL(location.href).searchParams.get('mode');
window.testPosts = [];
let batch = { id: '871b05c3-63dc-4f35-b3c6-8e22d27582af', status: mode === 'changed' ? 'retry_authorized' : 'review_required',
  reviewContextReady: mode !== 'legacy', partKeys: mode === 'legacy' ? [] : ['part-1','part-9','part-17','part-33','part-65','part-129','part-257','part-265'] };
window.LuminaBackstageApi = { fetch: async (url, options = {}) => {
  if (url.endsWith('/submissions')) return { items: [], publishedWorks: [
    { id: 'work', status: 'published', slug: 'the-killer-inherits-the-dead-test' }
  ] };
  if (options.method === 'POST') {
    window.testPosts.push({ url, body: options.body });
    if (url.endsWith('/review')) {
      batch = { ...batch, status: 'retry_authorized' };
      return { status: 'retry_authorized', retryRequiresSeparateRequest: true };
    }
    throw Object.assign(new Error('Diagnostic not for readers'), { body: { error: { code: 'STORY_CHOICE_PREPARATION_CONTEXT_CHANGED' } } });
  }
  if (url.endsWith('/choice-status')) return { status: 'preparing_choices', preparedParts: 257, totalParts: 265,
    slug: 'the-killer-inherits-the-dead-test', preparationBatch: batch };
  return { status: 'unavailable', active: false };
} };
`;

function server() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><html lang="ko"><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/backstage.css"><link rel="stylesheet" href="/backstage-story-publication.css">
        </head><body><div id="backstageDashboardView"><nav class="sidebar-nav"><a href="#story-publication">스토리 공개</a></nav>
        <main class="dashboard-main" data-active-section="story-publication"><div id="storyPublicationStatusCards" class="story-publication-status-grid"></div>
        <div id="storyPublicationSubmissionList"></div><p id="storyPublicationState" role="status"></p></main></div>
        <script>${bootstrap}</script><script src="/backstage-story-publication.js"></script>
        <script>document.querySelector('.sidebar-nav a').click();</script></body></html>`);
      return;
    }
    if (['/backstage.css', '/backstage-story-publication.css', '/backstage-story-publication.js'].includes(path)) {
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' })
        .end(await readFile(root + path));
    } else response.writeHead(404).end();
  });
}

test('exact-scope recovery, legacy blocking and changed-source errors fit PC and mobile without automatic paid requests',
  { timeout: 120000 }, async () => {
    const site = server();
    await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      if (artifacts) await mkdir(artifacts, { recursive: true });
      browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
      for (const width of [390, 400, 1280]) for (const mode of ['recorded', 'legacy', 'changed']) {
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
          ? route.continue() : route.abort());
        await page.goto(`http://127.0.0.1:${site.address().port}/?mode=${mode}`);
        const card = page.locator('[data-story-choice-card]');
        await card.waitFor();
        const prepare = card.locator('[data-story-prepare-choices]');
        if (mode !== 'changed') {
          const formLayout = await card.locator('[data-story-choice-review]').evaluate(review => ({
            mode: getComputedStyle(review).display, width: review.getBoundingClientRect().width,
            textWidth: review.querySelector('textarea').getBoundingClientRect().width,
          }));
          assert.equal(formLayout.mode, 'grid');
          assert.ok(formLayout.textWidth >= formLayout.width - 2, `compressed review input ${width}/${mode}`);
        }
        if (mode === 'legacy') {
          assert.match(await card.innerText(), /옛 작업 범위를 먼저 확인/);
          assert.equal(await card.locator('[data-story-choice-scope]').count(), 0);
          assert.equal(await card.locator('[data-story-choice-review-note]').isDisabled(), true);
          assert.equal(await card.locator('[data-story-choice-review-confirm]').isDisabled(), true);
          assert.equal(await card.locator('[data-story-review-batch]').isDisabled(), true);
          assert.equal(await prepare.isDisabled(), true);
          assert.deepEqual(await page.evaluate(() => window.testPosts), []);
        } else {
          assert.equal(await card.locator('[data-story-choice-scope]').innerText(), '작업 파트: 1,9,17,33,65,129,257,265');
          if (mode === 'recorded') {
            assert.equal(await prepare.isDisabled(), true);
            await card.locator('[data-story-choice-review-note]').fill('제공자 응답과 청구 기록을 확인했으며 재사용할 결과가 없습니다.');
            await card.locator('[data-story-choice-review-confirm]').check();
            await card.locator('[data-story-review-batch]').click();
            await page.locator('#storyPublicationState').getByText('다음 AI 배치는 별도로 요청해야 합니다.', { exact: false }).waitFor();
            assert.equal(await prepare.isDisabled(), false);
            const posts = await page.evaluate(() => window.testPosts);
            assert.equal(posts.length, 1);
            assert.match(posts[0].url, /\/review$/);
          } else {
            await prepare.click();
            await card.locator('[data-story-choice-status]').getByText('현재 원고·승인 설정과 달라졌습니다.', { exact: false }).waitFor();
            assert.doesNotMatch(await card.innerText(), /Diagnostic not for readers/);
            const posts = await page.evaluate(() => window.testPosts);
            assert.equal(posts.length, 1);
            assert.match(posts[0].url, /\/prepare-choices$/);
          }
        }
        const layout = await page.evaluate(() => ({ pageWidth: document.documentElement.scrollWidth,
          boxes: [...document.querySelectorAll('[data-story-choice-card], [data-story-choice-card] small, [data-story-choice-card] button, [data-story-choice-card] textarea')]
            .map(element => element.getBoundingClientRect().toJSON()) }));
        assert.ok(layout.pageWidth <= width, `page overflow ${width}/${mode}: ${JSON.stringify(layout)}`);
        assert.ok(layout.boxes.every(box => box.left >= -1 && box.right <= width + 1),
          `recovery controls clipped ${width}/${mode}: ${JSON.stringify(layout)}`);
        assert.deepEqual(errors, []);
        if (artifacts && width !== 400) await card.screenshot({ path: `${artifacts}/choice-context-${mode}-${width}.png` });
        await page.close();
      }
    } finally {
      await browser?.close();
      await new Promise(resolve => site.close(resolve));
    }
  });

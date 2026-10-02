import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const executablePath = process.env.STORY_UI_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const artifacts = process.env.STORY_AUTHOR_REVIEW_ARTIFACTS;

const bootstrap = `
window.testCalls = [];
window.LuminaBackstageApi = { fetch: async (url, options = {}) => {
  window.testCalls.push({ url, method: options.method || 'GET' });
  const privateWork = localStorage.getItem('privateIntake') === 'true';
  if (url.endsWith('/submissions')) return { items: [{
    id: 'source-submission', title: '내 이름을 먹지 않은 괴물', originalLocale: 'ko',
    sourceClass: 'new_manuscript', status: privateWork ? 'awaiting_author_review' : 'received',
    promotedWorkId: privateWork ? 'private-work' : null, totalBytes: 201000,
    createdAt: '2026-09-30T04:00:00.000Z', files: [
      { originalFilename: '01_독자공개_전체원고.md', category: 'manuscript', fileSizeBytes: 200000, extension: 'md',
        checksumSha256: 'e5c3e0719995380e2544062a83dceb43c4811ff7c9029ca81b15ba4a3c1b4bff' },
      { originalFilename: '03_장면_이미지_프롬프트.md', category: 'manuscript', fileSizeBytes: 1000, extension: 'md',
        checksumSha256: 'ba2763caa77bb52bd56a216b1852b2be9241314019015624a65ab128df25e033' }
    ]
  }], publishedWorks: [] };
  if (url.endsWith('/publish-approved') || url.endsWith('/promote')) {
    return { jobId: 'private-job', status: 'queued', totalParts: 32, processedParts: 0 };
  }
  if (url.endsWith('/private-job/process')) {
    localStorage.setItem('privateIntake', 'true');
    return { jobId: 'private-job', status: 'awaiting_author_review', workId: 'private-work',
      releaseId: null, processedParts: 0, totalParts: 32, work: null,
      writerReview: { manuscriptVersionId: 'private-manuscript', manuscriptHash: 'a'.repeat(64),
        analysisStarted: false, nextAction: 'analyze_and_approve',
        studioUrl: 'https://not-a-studio.invalid/ignore-server-url' } };
  }
  return { status: 'unavailable', active: false };
} };
`;

function server() {
  return createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html>
        <html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="/backstage.css"><link rel="stylesheet" href="/backstage-story-publication.css">
        </head><body><div id="backstageDashboardView"><nav class="sidebar-nav">
        <a href="#story-publication">스토리 공개</a></nav>
        <main class="dashboard-main" data-active-section="story-publication">
        <div class="story-publication-upload-grid"><form class="story-publication-upload-card"
        data-story-upload-form="monster"><h3>내 이름을 먹지 않은 괴물</h3>
        <label class="story-upload-file-control">최종 원고
        <input type="file" accept=".md" multiple></label>
        <div class="story-upload-action"><p class="form-status" data-story-upload-status role="status"></p>
        <button class="primary-action" type="submit">원고 접수</button></div></form></div>
        <div id="storyPublicationSubmissionList"></div><p id="storyPublicationState" role="status"></p>
        <div id="storyPublicationStatusCards" class="story-publication-status-grid"></div>
        </main></div><script>${bootstrap}</script><script src="/backstage-story-publication.js"></script>
        <script>document.querySelector('.sidebar-nav a').click();</script></body></html>`);
      return;
    }
    if (['/backstage.css', '/backstage-story-publication.css', '/backstage-story-publication.js'].includes(path)) {
      response.writeHead(200, { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' })
        .end(await readFile(root + path));
      return;
    }
    response.writeHead(404).end();
  });
}

async function withinViewport(page, width) {
  const layout = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    boxes: [...document.querySelectorAll('[data-story-upload-form], [data-submission-id], .story-preview-link')]
      .map(element => ({ className: element.className, ...element.getBoundingClientRect().toJSON() }))
  }));
  assert.ok(layout.pageWidth <= width, `page overflow at ${width}: ${JSON.stringify(layout)}`);
  assert.ok(layout.boxes.every(box => box.left >= -1 && box.right <= width + 1),
    `review content outside viewport at ${width}: ${JSON.stringify(layout)}`);
}

for (const width of [390, 400, 1280]) {
  for (const action of ['upload', 'promote']) {
    test(`private ${action} stops at author review and survives reload at ${width}px`, { timeout: 60_000 }, async () => {
      const site = server();
      await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
      let browser;
      try {
        browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
        const page = await browser.newPage({ viewport: { width, height: 850 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${site.address().port}/`);
        const card = page.locator('[data-submission-id="source-submission"]');
        await card.getByText('최종 원고가 맞음을 확인했습니다.').waitFor();
        if (action === 'upload') {
          const form = page.locator('[data-story-upload-form="monster"]');
          await form.locator('input[type="file"]').setInputFiles([
            { name: 'manuscript.md', mimeType: 'text/markdown', buffer: Buffer.from('synthetic source') },
            { name: 'prompts.md', mimeType: 'text/markdown', buffer: Buffer.from('synthetic prompts') }
          ]);
          await form.locator('button[type="submit"]').click();
          await form.locator('[data-story-upload-status]').getByText('작가 스튜디오 열기').waitFor();
          assert.equal(await form.locator('input[type="file"]').evaluate(input => input.files.length), 0);
          assert.equal(await form.locator('button').getAttribute('aria-busy'), null);
        } else {
          for (const input of await card.locator('[data-story-confirmation]').all()) await input.check();
          await card.locator('[data-story-promote]').click();
          await card.locator('[data-story-submission-status]').getByText('작가 스튜디오 열기').waitFor();
          assert.equal(await card.locator('[data-story-promote]').isDisabled(), true);
          assert.equal(await card.locator('.status-badge').innerText(), '작가 검토 대기');
          assert.equal(await card.locator('.story-publication-confirmations').getAttribute('disabled'), '');
          assert.match(await card.locator('.story-submission-facts').innerText(), /비공개 작품 연결 완료/);
        }
        const calls = await page.evaluate(() => window.testCalls);
        assert.equal(calls.filter(call => call.url.endsWith('/process')).length, 1);
        assert.equal(calls.filter(call => call.method === 'POST').length, 2);
        assert.ok(calls.every(call => !/analysis|consent|prepare-choices|approve/.test(call.url.replace('publish-approved', 'intake'))));
        assert.equal(await page.locator('#storyPublicationState a').getAttribute('href'), '/creator-studio');
        assert.doesNotMatch(await page.locator('#storyPublicationState').innerText(), /공개했습니다|승격했습니다/);
        await withinViewport(page, width);
        if (artifacts) {
          await mkdir(artifacts, { recursive: true });
          await page.screenshot({ path: `${artifacts}/${action}-${width}.png` });
        }
        await page.reload();
        await card.locator('.status-badge').getByText('작가 검토 대기').waitFor();
        assert.equal(await card.locator('[data-story-promote]').isDisabled(), true);
        assert.equal(await card.locator('[data-story-submission-status] a').getAttribute('href'), '/creator-studio');
        assert.match(await card.locator('[data-story-submission-status]').innerText(), /비공개 원고로 접수/);
        assert.equal(await page.evaluate(() => window.testCalls.filter(call => call.method === 'POST').length), 0);
        await withinViewport(page, width);
        assert.deepEqual(errors, []);
        if (artifacts) await card.screenshot({ path: `${artifacts}/reloaded-${action}-${width}.png` });
        await page.close();
      } finally {
        await browser?.close();
        await new Promise(resolve => site.close(resolve));
      }
    });
  }
}

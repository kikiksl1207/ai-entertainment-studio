import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { runtime } from './backstage-moderation-test-support.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const begin = html.indexOf('<section class="section-block" id="moderation">');
const end = html.indexOf('</section>', begin);
assert.ok(begin >= 0 && end > begin);
const section = html.slice(begin, end + '</section>'.length).replace('class="section-block"', 'class="section-block is-active"');
const artifacts = process.env.BACKSTAGE_MODERATION_ARTIFACTS;
const api = 'http://moderation.qa.test';
const postId = '11111111-1111-4111-8111-111111111111';
const reportId = '22222222-2222-4222-8222-222222222222';

async function open(browser, width, state) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.route(`${api}/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="backstage-shell" id="backstageDashboardView"><div class="dashboard-main" data-active-section="moderation">${section}</div></main></body></html>` });
    state.calls.push({ path, method: request.method() });
    const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path.endsWith('/community/reports')) {
      if (state.hold) await new Promise(resolve => { state.release = resolve; state.started?.(); });
      if (state.fail) return reply({ message: 'PRIVATE_ERROR_NEVER_RENDER' }, 503);
      return reply({ items: [{ id: reportId, postId, reason: 'spam', status: 'submitted', detail: 'Synthetic report detail', reporter: { id: 'synthetic-viewer', profile: { displayName: 'Synthetic Viewer' } } }] });
    }
    if (path.endsWith('/community/posts')) return reply({ items: [{ id: postId, status: 'published', reportCount: 1, author: { profile: { displayName: 'Synthetic Author' } } }] });
    return reply({ items: [] });
  });
  await page.addInitScript(() => {
    window.LUMINA_API_BASE = 'http://moderation.qa.test';
    localStorage.setItem('lumina_backstage_auth', JSON.stringify({ accessToken: 'synthetic-operator-session', user: { id: 'synthetic-operator', adminRole: 'super_admin', adminPermissions: ['*'] } }));
  });
  await page.goto(`${api}/`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 246, 251)');
  await page.addScriptTag({ content: `const dashboardView = document.getElementById('backstageDashboardView');\n${runtime}` });
  return page;
}

async function browserRun(run) {
  if (artifacts) await mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try { await run(browser); } finally { await browser.close(); }
}

test('actual moderation section shows a real-shaped report and scrollable action cells at PC and mobile widths', { timeout: 45000 }, async () => {
  await browserRun(async browser => {
    for (const width of [390, 400, 1280]) {
      const state = { calls: [] }, page = await open(browser, width, state);
      try {
        await page.evaluate(() => loadModerationSection());
        assert.equal(await page.locator('#moderation h2').innerText(), '크리에이터 콘텐츠');
        assert.match(await page.locator('#moderationReportRows').innerText(), /피드 글|피드 게시글/);
        assert.match(await page.locator('#moderationReportRows').innerText(), /11111111/);
        assert.match(await page.locator('#moderationRows').innerText(), /Synthetic Author/);
        assert.equal(await page.locator('#moderationReportRows [role=alert]').count(), 0);
        const detail = JSON.parse(decodeURIComponent(await page.locator('#moderationReportRows [data-detail]').getAttribute('data-detail')));
        assert.equal(detail.meta.postId, postId);
        assert.equal(detail.meta.reportId, reportId);
        const layout = await page.locator('#moderationReportRows').evaluate(root => {
          const wrap = root.closest('.table-wrap'); wrap.scrollLeft = wrap.scrollWidth;
          const cell = root.querySelector('tr td:last-child').getBoundingClientRect(), box = wrap.getBoundingClientRect();
          return { width: document.documentElement.scrollWidth, viewport: innerWidth, lastVisible: cell.left >= box.left - 1 && cell.right <= box.right + 1 };
        });
        assert.ok(layout.width <= width && layout.lastVisible, JSON.stringify(layout));
        assert.equal(state.calls.length, 4);
        assert.ok(state.calls.every(call => call.method === 'GET'));
        if (artifacts) await page.screenshot({ path: join(artifacts, `moderation-${width}.png`), fullPage: true });
      } finally { await page.close(); }
    }
  });
});

test('report failure stays separate from successful content and a late previous operator response is discarded', { timeout: 30000 }, async () => {
  await browserRun(async browser => {
    const state = { fail: true, calls: [] }, page = await open(browser, 390, state);
    try {
      await page.evaluate(() => loadModerationSection());
      assert.match(await page.locator('#moderationReportRows [role=alert]').innerText(), /불러오지 못했습니다/);
      assert.match(await page.locator('#moderationRows').innerText(), /Synthetic Author/);
      assert.doesNotMatch(await page.locator('#moderation').innerText(), /PRIVATE_ERROR_NEVER_RENDER|접수된 범용 신고가 없습니다/);
      if (artifacts) await page.screenshot({ path: join(artifacts, 'moderation-390-error.png'), fullPage: true });
      state.fail = false; state.hold = true;
      let start;
      const started = new Promise(resolve => { start = resolve; }); state.started = start;
      await page.evaluate(() => { window.pendingRead = loadModerationSection(); });
      await started;
      await page.evaluate(() => {
        localStorage.setItem('lumina_backstage_auth', JSON.stringify({ accessToken: 'different-session', user: { id: 'different-operator', adminRole: 'super_admin', adminPermissions: ['*'] } }));
        document.getElementById('moderationReportRows').textContent = 'NEW_OPERATOR_VIEW';
      });
      state.release();
      await page.evaluate(() => window.pendingRead);
      assert.equal(await page.locator('#moderationReportRows').innerText(), 'NEW_OPERATOR_VIEW');
      assert.ok(state.calls.every(call => call.method === 'GET'));
    } finally { state.release?.(); await page.close(); }
  });
});

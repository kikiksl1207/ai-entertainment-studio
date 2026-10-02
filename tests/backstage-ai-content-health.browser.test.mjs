import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8').replace(/^\uFEFF/, '');

function segment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source segment: ${start}`);
  return source.slice(from, to);
}

const runtime = [
  'const tableMeta = { aiAssetRows: { type: "AI assets", labels: Array(7).fill("") }, aiPostRows: { type: "AI content", labels: Array(6).fill("") } };',
  'async function backstageFetch(path, options) { return window.mockBackstageFetch(path, options); }',
  segment('function adminApiPath(path)', 'async function verifyAdminAccess()'),
  segment('function renderRows(targetId, rows, statusIndex)', 'function renderSettlementChildren('),
  segment('function normalizePage(data)', 'function readSectionSearch('),
  segment('function renderLoadingRow(targetId,', 'function renderFallbackNote('),
  segment('function backstageErrorStatus(error)', 'function artistKnowledgeQueueErrorMessage('),
  segment('function escapeHtml(value', 'function firstRoleName('),
  segment('function countLabel(count', 'async function loadAdminsSection()'),
  segment('async function loadAiContentSection()', 'async function loadModerationSection()'),
].join('\n');

const sectionStart = html.indexOf('<section class="section-block" id="ai-content">');
const sectionEnd = html.indexOf('</section>', sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
const section = html.slice(sectionStart, sectionEnd + '</section>'.length)
  .replace('class="section-block"', 'class="section-block is-active"');

test('AI content tables start with a loading state, not static sample rows', () => {
  const initial = segment('function renderBackstageTables()', 'function setActiveSection(');
  assert.match(initial, /renderLoadingRow\("aiAssetRows"/);
  assert.match(initial, /renderLoadingRow\("aiPostRows"/);
  assert.doesNotMatch(initial, /renderRows\("aiAssetRows", backstageRows\.aiAssets/);
  assert.doesNotMatch(initial, /renderRows\("aiPostRows", backstageRows\.aiPosts/);
});

async function openFixture(browser, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.setContent(`<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="backstage-shell"><div class="dashboard-main" data-active-section="ai-content">${section}</div></main></body></html>`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 246, 251)');
  await page.addScriptTag({ content: runtime });
  return page;
}

async function rows(page) {
  return page.evaluate(() => ({
    assets: [...document.querySelectorAll('#aiAssetRows tr')].map(row => row.innerText),
    posts: [...document.querySelectorAll('#aiPostRows tr')].map(row => row.innerText),
    errors: document.querySelectorAll('#aiAssetRows [role="alert"], #aiPostRows [role="alert"]').length,
  }));
}

test('AI content loads all 25 artists across pages and remains usable at 390px', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await openFixture(browser);
    await page.evaluate(() => {
      window.calls = [];
      window.mockBackstageFetch = async (path, options) => {
        window.calls.push({ path, options });
        const cursor = new URL(path, 'https://example.test').searchParams.get('cursor');
        if (!cursor) return { items: Array.from({ length: 20 }, (_, i) => ({ id: `artist-${i + 1}`, slug: `artist-${i + 1}`, displayName: `Artist ${i + 1}`, status: 'active', slots: {}, profiles: { contentReady: true, publicReady: false }, counts: {}, missing: [] })), hasMore: true, nextCursor: 'artist-20' };
        return { items: Array.from({ length: 5 }, (_, i) => ({ id: `artist-${i + 21}`, slug: `artist-${i + 21}`, displayName: `Artist ${i + 21}`, status: 'active', slots: {}, profiles: { contentReady: true, publicReady: false }, counts: {}, missing: [] })), hasMore: false, nextCursor: null };
      };
    });
    await page.evaluate(() => loadAiContentSection());
    const result = await rows(page);
    assert.equal(result.assets.length, 25);
    assert.equal(result.posts.length, 25);
    assert.match(result.assets.at(-1), /Artist 25/);
    assert.match(result.posts.at(-1), /Artist 25/);
    assert.match(result.posts.at(-1), /문구 있음\s+미등록/);
    assert.match(result.posts.at(-1), /페르소나 있음/);
    assert.equal(result.errors, 0);
    const calls = await page.evaluate(() => window.calls);
    assert.deepEqual(calls.map(call => call.path), [
      '/admin/api/v1/backstage/operations/ai-content-health?take=20',
      '/admin/api/v1/backstage/operations/ai-content-health?take=20&cursor=artist-20',
    ]);
    assert.ok(calls.every(call => call.options.auth === true));
    const layout = await page.evaluate(() => {
      const wrap = document.querySelector('#aiAssetRows').closest('.table-wrap');
      wrap.scrollLeft = wrap.scrollWidth;
      const lastCell = document.querySelector('#aiAssetRows tr:last-child td:last-child').getBoundingClientRect();
      const wrapBox = wrap.getBoundingClientRect();
      return { pageWidth: document.documentElement.scrollWidth, viewport: innerWidth,
        wrapWidth: wrap.clientWidth, tableWidth: wrap.scrollWidth,
        lastCellVisible: lastCell.left >= wrapBox.left - 1 && lastCell.right <= wrapBox.right + 1 };
    });
    assert.ok(layout.pageWidth <= 390, JSON.stringify(layout));
    assert.ok(layout.tableWidth > layout.wrapWidth, JSON.stringify(layout));
    assert.ok(layout.lastCellVisible, JSON.stringify(layout));
    await page.close();
  } finally {
    await browser.close();
  }
});

test('failed later page and repeated cursor show errors, never partial or sample rows', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await openFixture(browser);
    for (const mode of ['failure', 'repeated', 'missing', 'malformed']) {
      await page.evaluate(mode => {
        window.calls = [];
        window.mockBackstageFetch = async path => {
          window.calls.push(path);
          if (path.includes('&cursor=')) {
            if (mode === 'failure') throw new Error('network unavailable');
            if (mode === 'malformed') return { items: [] };
            return { items: [{ id: 'artist-21', slug: 'artist-21', displayName: 'Artist 21', slots: {}, profiles: {}, counts: {}, missing: [] }], hasMore: true, nextCursor: mode === 'repeated' ? 'artist-20' : null };
          }
          return { items: [{ id: 'artist-1', slug: 'artist-1', displayName: 'Artist 1', slots: {}, profiles: {}, counts: {}, missing: [] }], hasMore: true, nextCursor: 'artist-20' };
        };
      }, mode);
      await page.evaluate(() => loadAiContentSection());
      const result = await rows(page);
      assert.equal(result.errors, 2, mode);
      assert.equal(result.assets.length, 1, mode);
      assert.equal(result.posts.length, 1, mode);
      assert.match(result.assets[0], /불러오지 못했습니다/);
      assert.doesNotMatch(result.assets[0], /Artist 1|하윤아/);
      assert.equal(await page.evaluate(() => window.calls.length), 2, mode);
    }
    await page.close();
  } finally {
    await browser.close();
  }
});

test('page boundary rejects endless pagination instead of displaying an incomplete list', { timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await openFixture(browser);
    await page.evaluate(() => {
      window.calls = 0;
      window.mockBackstageFetch = async () => {
        window.calls += 1;
        return { items: [{ id: `artist-${window.calls}`, slug: `artist-${window.calls}`, displayName: `Artist ${window.calls}`, slots: {}, profiles: {}, counts: {}, missing: [] }], hasMore: true, nextCursor: `artist-${window.calls}` };
      };
    });
    await page.evaluate(() => loadAiContentSection());
    assert.equal(await page.evaluate(() => window.calls), 100);
    const result = await rows(page);
    assert.equal(result.errors, 2);
    assert.equal(result.assets.length, 1);
    await page.close();
  } finally {
    await browser.close();
  }
});

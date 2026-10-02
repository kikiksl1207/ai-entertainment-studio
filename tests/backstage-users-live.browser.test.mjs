import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../backstage/index.html', import.meta.url), 'utf8');

function segment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source segment: ${start}`);
  return source.slice(from, to);
}

const sectionStart = html.indexOf('<section class="section-block" id="users">');
const sectionEnd = html.indexOf('</section>', sectionStart);
assert.ok(sectionStart >= 0 && sectionEnd > sectionStart);
const usersSection = html.slice(sectionStart, sectionEnd + '</section>'.length);

const runtime = [
  'const sectionState = { users: { cursor: null, hasMore: false, rows: [], riskRows: [] } };',
  'const tableMeta = { userRows: { labels: Array(11).fill("") }, userRiskRows: { labels: Array(6).fill("") } };',
  'function adminApiPath(path) { return `/admin/api/v1${path}`; }',
  'async function backstageFetch(path, options) { return window.mockBackstageFetch(path, options); }',
  'function readSectionSearch() { return document.querySelector("#users .search-box input")?.value.trim() || ""; }',
  'function normalizePage(value) { return { items: value?.items || [], hasMore: Boolean(value?.hasMore), nextCursor: value?.nextCursor || null }; }',
  'function backstageErrorStatus(error) { return Number(error?.status || 0); }',
  'function formatCount(value) { return String(value ?? 0); }',
  'function krw(value) { return String(value ?? 0); }',
  'function formatDate(value) { return String(value ?? "-"); }',
  'function localizeWorkflowStatus(value) { return String(value ?? "-"); }',
  'function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;"); }',
  'function renderRows(id, rows) { document.getElementById(id).innerHTML = rows.map(item => `<tr><td>${item.row[0]}</td></tr>`).join(""); }',
  segment('function setLoadMore(sectionId, hasMore)', 'function backstageErrorStatus(error)'),
  segment('function renderUsersStatus(', 'async function loadCreatorsSection()'),
  segment('document.addEventListener("click", (event) => {', 'document.addEventListener("keydown", (event) => {'),
  segment('document.addEventListener("keydown", (event) => {', 'detailCloseButton.addEventListener'),
  segment('document.querySelectorAll("[data-load-more]").forEach', 'fanMissionForm?.addEventListener'),
].join('\n');

// These browser responses are synthetic API fixtures, not production-account evidence.
test('persisted-account UI: totals, server search/pagination, recovery and no sample fallback on desktop/mobile',
  { timeout: 60_000 }, async () => {
    const browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    try {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.setContent(`<!doctype html><html lang="ko"><head><style>.is-hidden { display: none; }</style></head><body>${usersSection}</body></html>`);
      await page.addScriptTag({ content: runtime });
      await page.evaluate(() => { window.mockBackstageFetch = async () => { throw new Error('offline'); }; });
      await page.evaluate(() => loadUsersSection());
      assert.match(await page.locator('#userRows').innerText(), /회원 목록을 불러오지 못했습니다/);
      assert.equal(await page.locator('#userRows [role="alert"]').count(), 1);
      assert.match(await page.locator('[data-users-status]').innerText(), /전체 가입 계정 확인 불가/);
      assert.match(await page.locator('[data-users-status]').innerText(), /테스트 계정 포함, 계정 분류 정보 없음/);
      assert.equal(await page.locator('[data-users-retry]').count(), 1);

      await page.locator('#users .search-box input').fill('old-filter');
      await page.evaluate(() => {
        window.calls = [];
        window.mockBackstageFetch = async (path, options) => {
          window.calls.push({ path, options });
          const from = path.includes('cursor=') ? 21 : 1;
          return { items: Array.from({ length: 20 }, (_, index) => ({
            id: `00000000-0000-4000-8000-${String(from + index).padStart(12, '0')}`,
            displayName: `합성 계정 ${from + index}`, email: `fixture${from + index}@example.test`, status: 'active',
          })), totalAccounts: 47, filteredAccounts: 47,
            nextCursor: `00000000-0000-4000-8000-${String(from + 19).padStart(12, '0')}`, hasMore: true };
        };
      });
      await page.locator('[data-users-show-all]').click();
      await page.waitForFunction(() => document.querySelector('#userRows')?.textContent?.includes('합성 계정 20'));
      assert.equal(await page.locator('#users .search-box input').inputValue(), '');
      assert.deepEqual(await page.evaluate(() => window.calls), [{
        path: '/admin/api/v1/backstage/operations/users-overview?take=20', options: { auth: true },
      }]);
      assert.equal(await page.locator('#userRows [role="alert"]').count(), 0);
      assert.equal(await page.locator('#userRows tr').count(), 20);
      assert.match(await page.locator('[data-users-status]').innerText(), /전체 가입 계정 47개.*검색 결과 47개.*현재 20개 표시/);

      // Editing the search box without submitting must not mix a new filter into an old cursor page.
      await page.locator('#users .search-box input').fill('not-submitted');
      await page.evaluate(() => {
        window.successFetch = window.mockBackstageFetch;
        window.mockBackstageFetch = async (path, options) => {
          window.calls.push({ path, options });
          throw new Error('page offline');
        };
      });
      await page.locator('[data-load-more="users"]').click();
      await page.waitForFunction(() => document.querySelector('[data-users-status]')?.textContent?.includes('기존 목록을 유지'));
      assert.equal(await page.locator('#userRows tr').count(), 20);
      assert.equal(await page.locator('#userRows [role="alert"]').count(), 0);
      const failedPath = await page.evaluate(() => window.calls.at(-1).path);
      assert.match(failedPath, /cursor=00000000-0000-4000-8000-000000000020/);
      assert.doesNotMatch(failedPath, /query=/);
      await page.evaluate(() => { window.mockBackstageFetch = window.successFetch; });
      await page.locator('[data-users-retry]').click();
      await page.waitForFunction(() => document.querySelector('#userRows')?.textContent?.includes('합성 계정 40'));
      assert.equal(await page.locator('#userRows tr').count(), 40);
      assert.equal(await page.locator('[data-users-retry]').count(), 0);
      assert.equal(await page.evaluate(() => window.calls.at(-1).path), failedPath);

      await page.evaluate(() => {
        window.mockBackstageFetch = async (path, options) => {
          window.calls.push({ path, options });
          return { items: [{ id: '00000000-0000-4000-8000-000000000047', displayName: '합성 검색 결과', status: 'active' }],
            totalAccounts: 47, filteredAccounts: 1, nextCursor: null, hasMore: false };
        };
      });
      await page.locator('#users .search-box input').fill('fixture@example.test');
      await page.locator('#users .search-box input').press('Enter');
      await page.waitForFunction(() => document.querySelector('#userRows')?.textContent?.includes('합성 검색 결과'));
      assert.equal(await page.locator('#userRows tr').count(), 1);
      assert.match(await page.locator('[data-users-status]').innerText(), /전체 가입 계정 47개.*검색 결과 1개.*현재 1개 표시/);
      assert.match(await page.evaluate(() => window.calls.at(-1).path), /query=fixture%40example.test/);
      assert.doesNotMatch(await page.evaluate(() => window.calls.at(-1).path), /cursor=/);
      assert.equal(await page.locator('[data-load-more="users"]').isVisible(), false);

      await page.evaluate(() => { window.mockBackstageFetch = async () => ({ items: [], totalAccounts: 47, filteredAccounts: 0 }); });
      await page.locator('#users .search-box .secondary-action').click();
      await page.waitForFunction(() => document.querySelector('[data-users-status]')?.textContent?.includes('검색 결과 0개'));
      assert.match(await page.locator('#userRows').innerText(), /표시할 유저가 없습니다/);

      for (const [status, expected] of [[401, /세션이 만료/], [403, /조회 권한이 없습니다/]]) {
        await page.evaluate((status) => { window.mockBackstageFetch = async () => { throw Object.assign(new Error('denied'), { status }); }; }, status);
        await page.evaluate(() => loadUsersSection());
        assert.match(await page.locator('#userRows').innerText(), expected);
        assert.match(await page.locator('[data-users-status]').innerText(), /전체 가입 계정 확인 불가/);
      }

      // An obsolete search response cannot overwrite a newer unfiltered request.
      await page.evaluate(() => {
        window.mockBackstageFetch = () => new Promise((resolve) => { window.resolveOld = resolve; });
        window.oldLoad = loadUsersSection();
      });
      await page.evaluate(() => {
        window.mockBackstageFetch = async () => ({ items: [], totalAccounts: 47, filteredAccounts: 47 });
      });
      await page.locator('[data-users-show-all]').click();
      await page.waitForFunction(() => document.querySelector('[data-users-status]')?.textContent?.includes('검색 결과 47개'));
      await page.evaluate(async () => { window.resolveOld({ items: [{ id: 'stale', displayName: 'stale' }], totalAccounts: 1, filteredAccounts: 1 }); await window.oldLoad; });
      assert.doesNotMatch(await page.locator('#userRows').innerText(), /stale/);
      assert.match(await page.locator('[data-users-status]').innerText(), /전체 가입 계정 47개/);
      await page.close();
      }
    } finally {
      await browser.close();
    }
  });

test('initial user table rendering has no sample rows', () => {
  const initial = segment('function renderBackstageTables()', 'function setActiveSection(');
  assert.match(initial, /renderLoadingRow\("userRows"\)/);
  assert.match(initial, /renderLoadingRow\("userRiskRows"\)/);
  assert.doesNotMatch(initial, /renderRows\("userRows", backstageRows\.users/);
});

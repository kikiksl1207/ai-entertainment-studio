import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');

function segment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing source segment: ${start}`);
  return source.slice(from, to);
}

const runtime = [
  segment('function normalizePage(', 'function localizeReportStatus('),
  segment('function setLoadMore(', 'function renderFallbackNote('),
  segment('function backstageErrorStatus(', 'function backstageUserFacingError('),
  segment('function renderUsersStatus(', 'async function loadCreatorsSection()'),
  segment('document.addEventListener("click", (event) => {', '  const detailButton = event.target.closest("[data-detail]");') + '});',
  'this.load = loadUsersSection; this.more = loadUsersPage;',
].join('\n');

function element() {
  return {
    dataset: {}, children: [], innerHTML: '', value: '', disabled: false,
    setAttribute() {},
    set textContent(value) { this.text = value; this.children = []; },
    get textContent() { return this.text || ''; },
    append(...values) { this.children.push(...values); },
  };
}

// Deferred in-memory API fixtures and a minimal DOM, not HTTP/browser/production evidence.
function harness() {
  const roots = { userRows: element(), userRiskRows: element() };
  const input = element();
  const button = element();
  button.classList = { toggle(_name, hidden) { button.hidden = hidden; } };
  let status;
  const section = {
    querySelector(selector) {
      if (selector === '[data-users-status]') return status;
      if (selector === '.section-title') return { after(node) { status = node; } };
      assert.fail(`Unexpected section selector: ${selector}`);
    },
  };
  const calls = [];
  const listeners = {};
  const context = {
    URLSearchParams,
    getBackstageAuth: () => ({ accessToken: 'synthetic-access', user: { id: 'synthetic-operator' } }),
    dashboardView: { classList: { contains: () => false } },
    canAccessBackstageSection: sectionId => sectionId === 'users',
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false } },
    tableMeta: { userRows: { labels: Array(11) }, userRiskRows: { labels: Array(6) } },
    document: {
      getElementById(id) { return id === 'users' ? section : roots[id]; },
      createElement: element,
      querySelector(selector) {
        if (selector === '#users .search-box input') return input;
        if (selector === '[data-load-more="users"]') return button;
        assert.fail(`Unexpected document selector: ${selector}`);
      },
      addEventListener(name, callback) { listeners[name] = callback; },
    },
    adminApiPath(path) { return `/admin/api/v1${path}`; },
    backstageFetch(path, options) {
      return new Promise((resolve, reject) => calls.push({ path, options, resolve, reject }));
    },
    formatCount: value => String(value ?? 0),
    krw: value => String(value ?? 0),
    formatDate: value => String(value ?? '-'),
    localizeWorkflowStatus: value => String(value ?? '-'),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    renderRows(id, rows) { roots[id].innerHTML = rows.map(item => item.row.join('|')).join('\n'); },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:users-recovery' });
  return {
    calls, roots, input, button,
    load: context.load, more: context.more,
    get state() { return context.sectionState.users; },
    get status() { return status; },
    retry() {
      listeners.click({ target: { closest(selector) { return selector === '[data-users-retry]' ? {} : null; } } });
    },
  };
}

const firstPage = () => ({
  items: [
    { id: 'fixture-1', displayName: 'Synthetic 1', status: 'active', openReportCount: 1 },
    { id: 'fixture-2', displayName: 'Synthetic 2', status: 'active' },
  ],
  totalAccounts: 3, filteredAccounts: 3, nextCursor: 'fixture-2', hasMore: true,
});

async function seed(h) {
  const pending = h.load();
  h.calls.at(-1).resolve(firstPage());
  await pending;
  assert.equal(h.state.rows.length, 2);
  assert.equal(h.state.riskRows.length, 1);
}

function controls(h) {
  return h.status.children.filter(value => typeof value === 'object').map(value => Object.keys(value.dataset)[0]);
}

for (const status of [401, 403]) {
  test(`append ${status} clears cached user/risk rows, totals and continuation cursor`, async () => {
    const h = harness();
    await seed(h);
    const pending = h.more();
    h.calls.at(-1).reject(Object.assign(new Error('Synthetic denied response'), { status }));
    await pending;

    assert.equal(h.state.rows.length, 0, 'Denied access must not retain user rows');
    assert.equal(h.state.riskRows.length, 0, 'Denied access must not retain risk rows');
    assert.equal(h.state.cursor, null);
    assert.equal(h.state.hasMore, false);
    assert.equal(h.state.totalAccounts, undefined);
    assert.equal(h.state.filteredAccounts, undefined);
    assert.equal(h.state.loading, false);
    assert.equal(h.state.error, true);
    assert.equal(h.button.hidden, true);
    assert.match(h.roots.userRows.innerHTML, /role="alert"/);
    assert.match(h.roots.userRiskRows.innerHTML, /role="alert"/);
    assert.doesNotMatch(h.roots.userRows.innerHTML + h.roots.userRiskRows.innerHTML, /Synthetic/);
    assert.match(h.status.textContent, /전체 가입 계정 확인 불가.*검색 결과 확인 불가.*현재 0개 표시/);
    assert.match(h.status.textContent, status === 401 ? /세션이 만료/ : /조회 권한이 없습니다/);
    assert.deepEqual(controls(h), ['usersRetry']);
  });

  test(`retry after append ${status} starts at first page and does not retain old accounts`, async () => {
    const h = harness();
    h.input.value = 'approved-filter';
    await seed(h);
    const denied = h.more();
    h.calls.at(-1).reject(Object.assign(new Error('Synthetic denied response'), { body: { statusCode: status } }));
    await denied;
    h.retry();
    const retry = h.calls.at(-1);
    const params = new URL(retry.path, 'https://fixture.invalid').searchParams;
    assert.equal(params.get('cursor'), null, 'Authorization recovery must not reuse the denied cursor');
    assert.equal(params.get('query'), 'approved-filter');
    assert.equal(retry.options.auth, true);
    assert.deepEqual(Object.keys(retry.options), ['auth']);
    retry.resolve({ items: [{ id: 'fixture-new', displayName: 'Recovered account' }],
      totalAccounts: 1, filteredAccounts: 1, nextCursor: null, hasMore: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state.rows.length, 1);
    assert.equal(h.state.rows[0].meta.userId, 'fixture-new');
    assert.equal(h.state.riskRows.length, 0);
    assert.match(h.status.textContent, /전체 가입 계정 1개.*현재 1개 표시/);
    assert.doesNotMatch(h.roots.userRows.innerHTML, /Synthetic/);
    assert.deepEqual(controls(h), []);
  });

  test(`obsolete append ${status} cannot erase a newer user list`, async () => {
    const h = harness();
    await seed(h);
    const obsolete = h.more();
    const oldCall = h.calls.at(-1);
    const current = h.load();
    h.calls.at(-1).resolve({ items: [{ id: 'fixture-current', displayName: 'Current account' }],
      totalAccounts: 1, filteredAccounts: 1, hasMore: false });
    await current;
    oldCall.reject(Object.assign(new Error('Synthetic obsolete denied response'), { status }));
    await obsolete;
    assert.equal(h.state.rows.length, 1);
    assert.equal(h.state.rows[0].meta.userId, 'fixture-current');
    assert.equal(h.state.totalAccounts, 1);
    assert.equal(h.state.error, false);
    assert.match(h.roots.userRows.innerHTML, /Current account/);
    assert.deepEqual(controls(h), []);
  });
}

for (const status of [0, 400, 500]) {
  test(`append ${status} retains recoverable rows and retries the same submitted query/cursor`, async () => {
    const h = harness();
    h.input.value = 'submitted-filter';
    await seed(h);
    h.input.value = 'not-submitted';
    const oldRows = h.roots.userRows.innerHTML;
    const oldRiskRows = h.roots.userRiskRows.innerHTML;
    const pending = h.more();
    const failedCall = h.calls.at(-1);
    failedCall.reject(Object.assign(new Error('Synthetic transient response'), { status }));
    await pending;
    assert.equal(h.state.rows.length, 2);
    assert.equal(h.state.riskRows.length, 1);
    assert.equal(h.state.totalAccounts, 3);
    assert.equal(h.state.cursor, 'fixture-2');
    assert.equal(h.roots.userRows.innerHTML, oldRows);
    assert.equal(h.roots.userRiskRows.innerHTML, oldRiskRows);
    assert.deepEqual(controls(h), ['usersRetry', 'usersReload']);
    h.retry();
    assert.equal(h.calls.at(-1).path, failedCall.path);
    h.calls.at(-1).resolve({ items: [{ id: 'fixture-3', displayName: 'Synthetic 3' }],
      totalAccounts: 3, filteredAccounts: 3, hasMore: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.state.rows.length, 3);
    assert.equal(h.state.error, false);
  });
}

test('empty persisted list stays empty and explicitly unclassified without fallback accounts', async () => {
  const h = harness();
  const pending = h.load();
  h.calls.at(-1).resolve({ items: [], totalAccounts: 0, filteredAccounts: 0, hasMore: false });
  await pending;
  assert.equal(h.state.rows.length, 0);
  assert.equal(h.state.riskRows.length, 0);
  assert.match(h.roots.userRows.innerHTML, /표시할 유저가 없습니다/);
  assert.match(h.status.textContent, /전체 가입 계정 0개.*계정 분류 정보 없음.*검색 결과 0개/);
  assert.equal(h.state.error, false);
});

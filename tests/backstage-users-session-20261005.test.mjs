import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const operatorA = '10000000-0000-4000-8000-000000000001';
const operatorB = '10000000-0000-4000-8000-000000000002';

export function sourceExcerpts(text = source) {
  const anchors = [
    ['authConstants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
    ['statusClasses', 'const statusClassMap = {', 'const backstageRows = {'],
    ['authStorageAndSection', 'function getBackstageAuth(', 'function saveActiveSection('],
    ['loginStatus', 'function setStatus(', 'function setLoading('],
    ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
    ['authRefresh', 'function normalizeAuthPayload(', 'function applyAdminContext('],
    ['paths', 'function publicApiPath(', 'async function verifyAdminAccess('],
    ['rows', 'function statusBadge(', 'function renderSettlementChildren('],
    ['pageAndSearch', 'function normalizePage(', 'function currentSettlementPeriod('],
    ['won', 'function won(', 'function settlementDeductions('],
    ['loadingAndErrors', 'function setLoadMore(', 'function renderFallbackNote('],
    ['errorStatus', 'function backstageErrorStatus(', 'function backstageUserFacingError('],
    ['firstValue', 'function firstValue(', 'function splitTargetUsers('],
    ['escaping', 'function escapeHtml(', 'function firstRoleName('],
    ['adminContext', 'function currentAdminRoleName(', 'function syncCurrentAdminContext('],
    ['existingReadAccess', 'function canAccessBackstageSection(', 'function applyPermissionVisibility('],
    ['countFormat', 'function formatCount(', 'function renderSummaryKpis('],
    ['dateAndMoneyFormat', 'function formatDate(', 'function localizeAdminRole('],
    ['workflowStatus', 'function localizeWorkflowStatus(', 'function localizeArtistKnowledgeStatus('],
    ['usersStatus', 'function renderUsersStatus(', '// Classification is a sidecar:'],
    ['classificationDisplay', 'function userClassificationText(', 'function userClassificationSession('],
    ['usersLoaders', 'async function loadUsersSection(', 'async function loadCreatorsSection('],
    ['showLogin', 'function showLogin(', 'function showDashboard('],
    ['closeConfirm', 'function closeConfirmModal(', 'async function runPreparedAction('],
    ['logoutHandler', 'logoutButton.addEventListener("click", () => {', 'refreshButton.addEventListener('],
  ];
  return anchors.map(([name, start, end]) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing actual source anchor: ${name}`);
    const body = text.slice(from, to);
    return { name, start, end, line: text.slice(0, from).split('\n').length,
      sha256: createHash('sha256').update(body).digest('hex'), body };
  });
}

const runtime = sourceExcerpts().map(item => item.body).join('\n') + `
this.api = { load: loadUsersSection, more: loadUsersPage,
  auth: getBackstageAuth, setAuth: setBackstageAuth,
  permissions: currentAdminPermissions, canRead: canAccessBackstageSection };
`;

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.disabled = false;
    this.hidden = false;
    this.value = '';
    this.isConnected = false;
    this.classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name);
        return force;
      },
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = String(value); this.html = ''; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.html = String(value); this.text = ''; this.children = [];
    const match = this.html.match(/<select id="([^"]+)">/);
    if (match) { const select = new Element('select'); select.id = match[1]; this.append(select); }
  }
  get innerHTML() { return this.html || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...values) {
    for (const value of values) {
      const child = typeof value === 'string' ? new Element('#text') : value;
      if (typeof value === 'string') child.textContent = value;
      child.parent = this; child.connect(this.isConnected); this.children.push(child);
    }
  }
  connect(value) { this.isConnected = value; this.children.forEach(child => child.connect(value)); }
  after(node) { this.insertSibling(node, 1); }
  before(node) { this.insertSibling(node, 0); }
  insertSibling(node, offset) {
    assert.ok(this.parent, 'Fixture insertion requires an attached parent');
    node.parent = this.parent; node.connect(this.isConnected);
    this.parent.children.splice(this.parent.children.indexOf(this) + offset, 0, node);
  }
  get lastElementChild() { return this.children.at(-1); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return null;
  }
  querySelector(selector) {
    if (selector === 'select') return this.find(node => node.tagName === 'select');
    if (selector === '[data-users-status]') return this.find(node => 'usersStatus' in node.dataset);
    if (selector === '[data-user-classification-heading]') return this.find(node => 'userClassificationHeading' in node.dataset);
    if (selector === '.section-title') return this.find(node => node.classes.has('section-title'));
    if (selector === '#userRows') return this.find(node => node.id === 'userRows');
    if (selector === 'thead tr') return this.find(node => node.tagName === 'tr' && node.parent?.tagName === 'thead');
    assert.fail(`Unmodeled fixture selector: ${selector}`);
  }
  closest(selector) {
    assert.equal(selector, 'table');
    for (let node = this; node; node = node.parent) if (node.tagName === 'table') return node;
    return null;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { assert.ok(this.listeners.has('click')); this.listeners.get('click')({ target: this }); }
}

// Actual client auth/storage/fetch/refresh/logout code; only DOM and transport are in memory.
function harness() {
  const storage = new Map(); const tokens = new Map(); const calls = []; const attempts = [];
  const section = new Element('section'); section.id = 'users'; section.connect(true);
  const title = new Element('header'); title.className = 'section-title'; section.append(title);
  const roots = { userRows: new Element('tbody'), userRiskRows: new Element('tbody') };
  for (const [id, body] of Object.entries(roots)) {
    body.id = id;
    const table = new Element('table'); const head = new Element('thead'); const row = new Element('tr');
    for (let index = 0; index < 11; index++) row.append(new Element('th'));
    head.append(row); table.append(head, body); section.append(table);
  }
  const input = new Element('input'); const more = new Element('button');
  const dashboardView = new Element(); const loginView = new Element();
  loginView.classList.add('is-hidden');
  const dashboardMain = new Element(); dashboardMain.setAttribute('data-active-section', 'users');
  const logoutButton = new Element('button'); const passwordInput = new Element('input');
  const loginStatus = new Element('p'); const googleButtonFallback = new Element('button');
  let providerAttempts = 0;
  const context = {
    URLSearchParams, window: { LUMINA_API_BASE: 'https://synthetic.invalid' },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    document: {
      documentElement: { lang: 'en' },
      getElementById: id => id === 'users' ? section : section.find(node => node.id === id),
      createElement: tag => new Element(tag),
      querySelectorAll(selector) {
        assert.equal(selector, 'tr.is-selected');
        return [];
      },
      querySelector(selector) {
        if (selector === '#users .search-box input') return input;
        if (selector === '[data-load-more="users"]') return more;
        if (selector === '.dashboard-main') return dashboardMain;
        assert.fail(`Unmodeled document selector: ${selector}`);
      },
    },
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false } },
    tableMeta: { userRows: { labels: Array(12).fill(''), type: 'synthetic-user' },
      userRiskRows: { labels: Array(6).fill(''), type: 'synthetic-risk' } },
    dashboardView, loginView, logoutButton, passwordInput, loginStatus, googleButtonFallback,
    operatorEmail: new Element(),
    selectedDetail: null, userClassificationDetail: null, pendingActionPreview: null,
    detailPanel: new Element(), detailType: new Element(), detailTitle: new Element(),
    detailList: new Element(), detailMemo: new Element('textarea'), detailHistoryList: new Element(),
    detailForm: new Element(), confirmModal: new Element(), confirmType: new Element(),
    confirmTitle: new Element(), confirmMessage: new Element(), confirmPayload: new Element(),
    prepareGoogleLoginButton() {
      providerAttempts++;
      // Exercise actual showLogin's unavailable-provider branch without a provider or network.
      return Promise.reject(new Error('Synthetic provider unavailable'));
    },
    fetch(url, options) {
      attempts.push({ url, options });
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://synthetic.invalid');
      assert.ok(['/admin/api/v1/backstage/operations/users-overview', '/api/v1/auth/refresh'].includes(parsed.pathname));
      if (parsed.pathname.endsWith('/users-overview')) {
        assert.equal(options.method, 'GET');
        if (!options.headers.Authorization) return Promise.resolve({ status: 401, ok: false,
          json: async () => ({ message: 'Synthetic authentication required' }) });
        assert.ok(tokens.has(options.headers.Authorization), 'Actual fetch must send a registered synthetic bearer token');
      } else {
        assert.equal(options.method, 'POST');
        assert.deepEqual(Object.keys(JSON.parse(options.body)), ['refreshToken']);
        assert.equal(JSON.parse(options.body).refreshToken, 'synthetic-refresh-a');
      }
      return new Promise((resolve, reject) => calls.push({ url, options, reject,
        respond(body, status = 200) { resolve({ status, ok: status >= 200 && status < 300,
          json: async () => plain(body) }); } }));
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-users-session-excerpts' });
  const setAuth = (id = operatorA, token = 'synthetic-access-a') => {
    const auth = { accessToken: token, refreshToken: id === operatorA ? 'synthetic-refresh-a' : 'synthetic-refresh-b',
      user: { id, adminPermissions: ['*'] } };
    tokens.set(`Bearer ${token}`, id); context.api.setAuth(auth); return auth;
  };
  setAuth();
  assert.equal(context.api.canRead('users'), true);
  return { context, calls, attempts, storage, roots, section, input, more, dashboardView, loginView,
    setAuth, load: context.api.load, append: context.api.more,
    get state() { return context.sectionState.users; },
    get status() { return section.querySelector('[data-users-status]'); },
    get filter() { return section.find(node => node.id === 'usersClassificationFilter'); },
    logout() {
      logoutButton.click();
      assert.equal(dashboardView.classList.contains('is-hidden'), true);
      assert.equal(loginView.classList.contains('is-hidden'), false);
      assert.equal(storage.has('lumina_backstage_auth'), false);
      assert.equal(providerAttempts, 1);
    },
    allowRotatedToken(token) { tokens.set(`Bearer ${token}`, operatorA); },
    revokeRead() {
      const auth = context.api.auth();
      context.api.setAuth({ ...plain(auth), user: { ...plain(auth.user), adminPermissions: ['audit:read'] } });
      assert.equal(context.api.auth().user.id, operatorA);
      assert.equal(context.api.canRead('users'), false);
    },
  };
}

const baselineState = { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null };
const testState = { classification: 'test', revision: 1, source: 'explicit_admin', updatedAt: '2026-10-05T00:00:00.000Z' };
function page(prefix = 'seed', final = false) {
  return { items: [
    { id: `${prefix}-1`, displayName: `${prefix} test-looking unclassified`, status: 'active',
      testAccountClassification: baselineState },
    { id: `${prefix}-2`, displayName: `${prefix} explicit test`, status: 'active', openReportCount: 1,
      testAccountClassification: testState },
  ], totalAccounts: 100, filteredAccounts: 4,
  summary: { globalTestAccounts: 17, globalUnclassifiedAccounts: 83, filteredTestAccounts: 2, filteredUnclassifiedAccounts: 2 },
  hasMore: !final, nextCursor: final ? null : `${prefix}-2` };
}

function snapshot(h) {
  const state = h.state;
  return plain({ rows: state.rows, riskRows: state.riskRows, cursor: state.cursor, hasMore: state.hasMore,
    totalAccounts: state.totalAccounts, filteredAccounts: state.filteredAccounts,
    classificationCounts: state.classificationCounts, classificationSupported: state.classificationSupported,
    error: state.error, userHtml: h.roots.userRows.innerHTML, riskHtml: h.roots.userRiskRows.innerHTML,
    statusText: h.status.textContent, statusControls: h.status.children.map(child => child.dataset),
    filter: { value: h.filter.value, disabled: h.filter.disabled },
    more: { disabled: h.more.disabled, hidden: h.more.classList.contains('is-hidden') } });
}

async function seed(h) {
  const pending = h.load('synthetic-query', 'all');
  h.calls.at(-1).respond(page()); await pending;
  assert.equal(h.state.rows.length, 2); assert.equal(h.state.riskRows.length, 1);
  assert.equal(h.state.cursor, 'seed-2'); assert.equal(h.state.totalAccounts, 100);
  assert.equal(h.filter.disabled, false);
}

function assertNotPublished(h, before, id) {
  assert.deepEqual(snapshot(h), before, `${id}: obsolete completion must not publish rows, counts, cursor, status or controls`);
  assert.doesNotMatch(h.roots.userRows.innerHTML + h.roots.userRiskRows.innerHTML, /obsolete-/);
}

// New IDs are independent; no existing 46-case tracking or frozen oracle is changed.
let caseId = 0;
for (const invalidation of ['logout', 'different-operator']) {
  for (const scenario of [
    { append: false, status: 200 }, { append: true, status: 200 },
    { append: false, status: 500 }, { append: true, status: 403 },
  ]) {
    const id = `AUS-SESSION-${String(++caseId).padStart(2, '0')}`;
    test(`${id} ${invalidation}: delayed ${scenario.append ? 'append' : 'first-page'} ${scenario.status} is not published`, async () => {
      const h = harness(); if (scenario.append) await seed(h);
      const pending = scenario.append ? h.append() : h.load('synthetic-query', 'all');
      const obsolete = h.calls.at(-1);
      if (invalidation === 'logout') { h.logout(); assert.equal(h.context.api.auth(), null); }
      else { h.setAuth(operatorB, 'synthetic-access-b'); assert.equal(h.context.api.auth().user.id, operatorB); }
      const before = snapshot(h);
      obsolete.respond(scenario.status === 200 ? page('obsolete') : { message: 'Synthetic obsolete error' }, scenario.status);
      await pending;
      assertNotPublished(h, before, id);
    });
  }
}

test('AUS-SESSION-09 actual logout with shared auth fallback still blocks a delayed append', async () => {
  const h = harness(); await seed(h);
  h.storage.set('lumina_auth', JSON.stringify(h.context.api.auth()));
  const pending = h.append(); const obsolete = h.calls.at(-1);
  h.logout();
  assert.equal(h.context.api.auth().user.id, operatorA, 'Actual shared fallback intentionally remains');
  assert.equal(h.storage.has('lumina_auth'), true, 'No all-store logout rewrite');
  const before = snapshot(h);
  obsolete.respond(page('obsolete')); await pending;
  assertNotPublished(h, before, 'AUS-SESSION-09');
});

test('AUS-SESSION-10 same-operator token rotation accepts healthy rows, totals and two-page cursor behavior', async () => {
  const h = harness(); const pending = h.load('synthetic-query', 'all');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer synthetic-access-a');
  h.setAuth(operatorA, 'synthetic-access-a-rotated');
  h.calls[0].respond(page()); await pending;
  assert.equal(h.state.rows.length, 2); assert.equal(h.state.cursor, 'seed-2');
  assert.equal(h.state.totalAccounts, 100); assert.equal(h.state.filteredAccounts, 4);
  assert.deepEqual(plain(h.state.classificationCounts), page().summary);
  assert.equal(h.state.rows[0].meta.testAccountClassification.classification, 'unclassified', 'Name is never classification evidence');
  assert.match(h.roots.userRows.innerHTML, /seed test-looking unclassified/);
  const second = h.append(); const call = h.calls.at(-1);
  const query = new URL(call.url).searchParams;
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-access-a-rotated');
  assert.equal(query.get('query'), 'synthetic-query'); assert.equal(query.get('cursor'), 'seed-2');
  assert.equal(query.get('classification'), 'all');
  call.respond(page('healthy-next', true)); await second;
  assert.equal(h.state.rows.length, 4); assert.equal(h.state.riskRows.length, 2);
  assert.equal(h.state.cursor, null); assert.equal(h.state.hasMore, false);
  assert.equal(h.state.totalAccounts, 100); assert.equal(h.state.filteredAccounts, 4);
  assert.equal(h.filter.disabled, false); assert.equal(h.more.classList.contains('is-hidden'), true);
});

test('AUS-SESSION-11 actual intermediate 401 refresh keeps the same operator and accepts append', async () => {
  const h = harness(); await seed(h); const pending = h.append();
  const original = h.calls.at(-1); original.respond({ message: 'Synthetic access expired' }, 401); await tick();
  const refresh = h.calls.at(-1); assert.equal(new URL(refresh.url).pathname, '/api/v1/auth/refresh');
  h.allowRotatedToken('synthetic-access-a-refreshed');
  refresh.respond({ accessToken: 'synthetic-access-a-refreshed', refreshToken: 'synthetic-refresh-a-next' }); await tick();
  const retry = h.calls.at(-1);
  assert.equal(retry.url, original.url); assert.equal(retry.options.headers.Authorization, 'Bearer synthetic-access-a-refreshed');
  retry.respond(page('healthy-refreshed', true)); await pending;
  assert.equal(h.context.api.auth().user.id, operatorA);
  assert.equal(h.state.rows.length, 4); assert.equal(h.state.riskRows.length, 2);
  assert.equal(h.state.totalAccounts, 100); assert.equal(h.state.filteredAccounts, 4);
  assert.equal(h.state.cursor, null); assert.equal(h.state.error, false);
  assert.equal(h.calls.length, 4, 'Only seed, original GET, refresh and one GET retry');
});

test('AUS-SESSION-12 same-operator rotation plus general append failure retains data and manual retry cursor', async () => {
  const h = harness(); await seed(h); const before = snapshot(h);
  const pending = h.append(); const failed = h.calls.at(-1);
  h.setAuth(operatorA, 'synthetic-access-a-rotated');
  failed.respond({ message: 'Synthetic transient error' }, 500); await pending;
  for (const key of ['rows', 'riskRows', 'cursor', 'hasMore', 'totalAccounts', 'filteredAccounts', 'classificationCounts', 'userHtml', 'riskHtml']) {
    assert.deepEqual(snapshot(h)[key], before[key], `Healthy same-operator error preserves ${key}`);
  }
  assert.equal(h.state.error, true);
  assert.ok(h.status.children.some(child => 'usersRetry' in child.dataset));
  const retry = h.append(); const call = h.calls.at(-1);
  assert.equal(call.url, failed.url); assert.equal(call.options.headers.Authorization, 'Bearer synthetic-access-a-rotated');
  call.respond(page('healthy-retry', true)); await retry;
  assert.equal(h.state.rows.length, 4); assert.equal(h.state.cursor, null); assert.equal(h.state.error, false);
});

async function assertInitialBlocked(h, append, id) {
  const before = snapshot(h); const attempts = h.attempts.length; const calls = h.calls.length;
  const pending = append ? h.append() : h.load('blocked-query', 'all');
  // Settle a wrongly dispatched original-loader request so reproduction never hangs.
  if (h.calls.length > calls) h.calls.at(-1).respond({ message: 'Synthetic blocked initial request' }, 403);
  await pending;
  assert.equal(h.attempts.length, attempts, `${id}: denied initial ${append ? 'append' : 'first-page'} must not dispatch`);
  assertNotPublished(h, before, id);
}

test('AUS-SESSION-13 missing local auth blocks initial first-page and append without UI changes', async () => {
  for (const append of [false, true]) {
    const h = harness(); await seed(h); h.context.api.setAuth(null);
    assert.equal(h.context.api.auth(), null);
    await assertInitialBlocked(h, append, 'AUS-SESSION-13');
  }
});

test('AUS-SESSION-14 locally revoked users-read blocks initial first-page and append', async () => {
  for (const append of [false, true]) {
    const h = harness(); await seed(h); h.revokeRead();
    await assertInitialBlocked(h, append, 'AUS-SESSION-14');
  }
});

test('AUS-SESSION-15 hidden dashboard with shared auth fallback blocks initial first-page and append', async () => {
  for (const append of [false, true]) {
    const h = harness(); await seed(h);
    h.storage.set('lumina_auth', JSON.stringify(h.context.api.auth()));
    h.context.api.setAuth(null); h.dashboardView.classList.add('is-hidden');
    assert.equal(h.context.api.auth().user.id, operatorA);
    await assertInitialBlocked(h, append, 'AUS-SESSION-15');
  }
});

test('AUS-SESSION-16 local users-read revocation suppresses delayed append success and error controls', async () => {
  for (const status of [200, 403]) {
    const h = harness(); await seed(h);
    const pending = h.append(); const obsolete = h.calls.at(-1);
    h.revokeRead(); const before = snapshot(h);
    obsolete.respond(status === 200 ? page('obsolete') : { message: 'Synthetic obsolete denial' }, status);
    await pending;
    assertNotPublished(h, before, 'AUS-SESSION-16');
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../backstage.css', import.meta.url), 'utf8');
function segment(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}
const runtime = [
  segment('function normalizePage(', 'function readSectionSearch('),
  segment('function setLoadMore(', 'function renderFallbackNote('),
  segment('function backstageErrorStatus(', 'function backstageUserFacingError('),
  segment('function renderUsersStatus(', 'async function loadCreatorsSection()'),
  `this.api = { norm: normalizeUserClassification, counts: userClassificationCounts,
    command: userClassificationCommand, key: newUserClassificationKey, text: userClassificationText,
    sync: syncUserClassificationPanel, read: loadUserClassification, save: saveUserClassification,
    fetch: fetchUserClassification, load: loadUsersSection, more: loadUsersPage,
    get detail() { return userClassificationDetail; } };`,
].join('\n');

// In-memory DOM and deferred fetch fixtures only. No browser, server, login or database.
class Element {
  constructor() {
    this.dataset = {}; this.children = []; this.controls = {}; this.listeners = {};
    this.isConnected = true; this.disabled = false; this.checked = false; this.value = '';
    this.classList = { contains: () => false, toggle() {} };
  }
  set innerHTML(value) {
    this.html = value;
    if (value.includes('data-classification-target')) {
      for (const name of ['target', 'reason', 'confirm', 'save', 'refresh']) this.controls[name] = new Element();
      const options = value.match(/<select data-classification-target>(.*?)<\/select>/s)[1];
      this.controls.target.innerHTML = options;
      this.controls.save.disabled = true;
    } else if (value.includes('id="usersClassificationFilter"')) {
      this.controls.select = new Element();
    } else if (value.includes('<option')) {
      this.value = value.match(/<option value="([^"]+)" selected/)?.[1] || value.match(/<option value="([^"]+)"/)?.[1] || '';
    }
  }
  get innerHTML() { return this.html || ''; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text || ''; }
  querySelector(selector) {
    if (selector === 'select') return this.controls.select;
    return this.controls[selector.match(/data-classification-(\w+)/)?.[1]] || null;
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  fire(name) { return this.listeners[name]?.(); }
  append(...values) { this.children.push(...values); }
  after(node) { this.afterNode = node; }
  remove() { this.isConnected = false; }
  setAttribute() {}
}
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const state = (classification = 'unclassified', revision = 0) => ({ classification, revision,
  source: classification === 'test' || revision ? 'explicit_admin' : 'unclassified',
  updatedAt: revision ? '2026-10-05T01:00:00.000Z' : null });
const read = (userId = 'fixture-a', current = state(), history = []) => ({
  contract: 'admin-test-account-classification-v1', userId, readOnly: true, state: current, history,
  policy: { realCustomerInference: false, permissionChanges: false },
});
const receipt = (userId = 'fixture-a', classification = 'test', revision = 1, reasonCode = 'manual_confirmation') => ({
  contract: 'admin-test-account-classification-command-v1', userId, idempotentReplay: false,
  receipt: { classification, revision, reasonCode }, current: state(classification, revision), permissionChanges: false,
});
const summary = { globalTestAccounts: 17, globalUnclassifiedAccounts: 83, filteredTestAccounts: 1, filteredUnclassifiedAccounts: 1 };
const page = (extra = {}) => ({ items: [
  { id: 'fixture-a', displayName: 'Test-looking name', email: 'qa@example.invalid', testAccountClassification: state() },
  { id: 'fixture-b', displayName: 'Ordinary-looking name', testAccountClassification: state('test', 1), openReportCount: 1 },
], totalAccounts: 100, filteredAccounts: 2, summary, hasMore: false, ...extra });

function harness(permissions = ['*'], { actualRows = false } = {}) {
  const roots = { userRows: new Element(), userRiskRows: new Element() };
  const input = new Element(); const more = new Element(); let status;
  const calls = []; const listCalls = [];
  const section = { querySelector(selector) {
    if (selector === '[data-users-status]') return status;
    if (selector === '.section-title') return { after(node) { status = node; } };
    return null;
  } };
  let uuid = 0;
  const context = {
    URLSearchParams, Uint8Array,
    BACKSTAGE_API_BASE: 'https://synthetic.invalid',
    window: { crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` } },
    document: {
      documentElement: { lang: 'en' },
      getElementById(id) { return id === 'users' ? section : id === 'usersClassificationFilter' ? status?.afterNode?.controls.select : roots[id]; },
      createElement: () => new Element(),
      querySelector(selector) { return selector.includes('data-load-more') ? more : input; },
    },
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false } },
    tableMeta: { userRows: { labels: Array(12) }, userRiskRows: { labels: Array(6) } },
    selectedDetail: null, detailForm: new Element(), detailPanel: new Element(),
    auth: { accessToken: 'synthetic-token', user: { id: 'fixture-operator' } }, permissions,
    activeSection: 'users',
    getBackstageAuth: () => context.auth,
    currentAdminPermissions: () => context.permissions,
    dashboardView: new Element(),
    canAccessBackstageSection: sectionId => sectionId === 'users'
      && context.permissions.some(value => ['*', 'users:read', 'users:write', 'community:read'].includes(value)),
    getCurrentSection: () => context.activeSection,
    adminApiPath: path => `/admin/api/v1${path}`,
    readSectionSearch: () => input.value,
    formatCount: value => String(value), krw: value => String(value), formatDate: value => String(value ?? '-'),
    localizeWorkflowStatus: value => String(value ?? '-'),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    renderRows: (id, rows) => { roots[id].innerHTML = rows.map(item => item.row.join('|')).join('\n'); },
    fetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, options, resolve, reject })),
    backstageFetch: (path, options) => new Promise((resolve, reject) => listCalls.push({ path, options, resolve, reject })),
  };
  const rowRuntime = actualRows ? [segment('const statusClassMap = {', 'const backstageRows = {'),
    segment('function creatorsNativeIsTable(', 'function creatorsNativeIsDetail('),
    segment('function escapeHtml(', 'function firstRoleName('),
    segment('function statusBadge(', 'function renderSettlementChildren(')].join('\n') : '';
  runInNewContext(rowRuntime + '\n' + runtime, context, { filename: 'backstage.js:classification-synthetic' });
  return { context, calls, listCalls, roots, input, api: context.api,
    get status() { return status; }, get state() { return context.sectionState.users; },
    open(userId = 'fixture-a', tableId = 'userRows') {
      context.selectedDetail = { tableId, meta: { userId }, row: ['Synthetic'] };
      context.api.sync(context.selectedDetail);
      return context.api.detail;
    },
    async respond(call, data, status = 200) {
      call.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });
      await tick();
    },
    async ready(userId = 'fixture-a', current = state()) {
      const detail = this.open(userId);
      await this.respond(calls.at(-1), read(userId, current));
      assert.equal(detail.phase, 'ready');
      return detail;
    },
  };
}

test('strict normalization defaults to unclassified, never infers from identity or malformed flags', () => {
  const h = harness();
  for (const value of [undefined, null, {}, { displayName: 'test QA', email: 'fixture@test.invalid' },
    { classification: 'real_customer' }, { ...state('test', 1), source: 'unclassified' },
    state('test', 0), { ...state(), source: 'explicit_admin' },
    { ...state(), updatedAt: '2026-10-05T01:00:00.000Z' },
    { ...state('unclassified', 1), source: 'unclassified' },
    { ...state('test', 1), updatedAt: null }, { ...state('unclassified', 1), updatedAt: null },
    { ...state('test', 1), updatedAt: '2026-02-30T01:00:00.000Z' },
    { ...state('test', 1), updatedAt: '2026-10-05T24:00:00.000Z' },
    { ...state(), revision: '0' }, { ...state(), revision: -1 }, { ...state(), revision: Infinity },
    { ...state(), updatedAt: '2026-10-05' }]) {
    const normalized = h.api.norm(value);
    assert.equal(normalized.classification, 'unclassified');
    assert.equal(normalized.available, false);
    assert.equal(normalized.revision, null);
  }
  assert.equal(h.api.norm(state('test', 2)).available, true);
  assert.equal(h.api.norm(state('unclassified', 3)).source, 'explicit_admin');
  assert.equal(h.api.norm({ ...state('test', 1), updatedAt: '2026-10-05T10:00:00+09:00' }).available, true);
});

test('classification counts require actual numeric API counts and per-item classification fields', () => {
  const h = harness();
  assert.deepEqual(plain(h.api.counts(page())), summary);
  for (const value of [undefined, null, NaN, Infinity, -1, '0']) {
    assert.equal(h.api.counts(page({ summary: { ...summary, globalTestAccounts: value } })), null);
  }
  assert.equal(h.api.counts(page({ items: [{ displayName: 'test', email: 'qa@test.invalid' }] })), null);
  assert.equal(h.api.counts({ items: [], totalAccounts: 0 }), null);
  const zero = Object.fromEntries(Object.keys(summary).map(key => [key, 0]));
  assert.deepEqual(plain(h.api.counts(page({ items: [], totalAccounts: 0, filteredAccounts: 0, summary: zero }))), zero);
  for (const value of [page({ totalAccounts: 99 }), page({ filteredAccounts: 3 }),
    page({ totalAccounts: undefined }), page({ filteredAccounts: undefined }),
    page({ filteredAccounts: 19, summary: { ...summary, filteredTestAccounts: 18 } }),
    page({ filteredAccounts: 85, summary: { ...summary, filteredUnclassifiedAccounts: 84 } }),
    page({ totalAccounts: 0, filteredAccounts: 1, summary: { globalTestAccounts: 0, globalUnclassifiedAccounts: 0, filteredTestAccounts: 0, filteredUnclassifiedAccounts: 1 } })]) {
    assert.equal(h.api.counts(value), null, 'Incomplete or arithmetically impossible counters must be unavailable');
  }
});

test('list uses contracted query, preserves totals and does not relabel unclassified as real customers', async () => {
  const h = harness();
  const pending = h.api.load('synthetic search', 'all');
  const params = new URL(h.listCalls[0].path, 'https://synthetic.invalid');
  assert.equal(params.pathname, '/admin/api/v1/backstage/operations/users-overview');
  assert.equal(params.searchParams.get('query'), 'synthetic search');
  assert.equal(params.searchParams.get('classification'), 'all');
  h.listCalls[0].resolve(page()); await pending;
  assert.equal(h.state.totalAccounts, 100);
  assert.equal(h.state.filteredAccounts, 2);
  assert.equal(h.state.rows[0].row[10], 'Unclassified');
  assert.equal(h.state.rows[1].row[10], 'Test account');
  assert.match(h.status.textContent, /Global test 17.*Global unclassified 83.*Filtered test 1.*Filtered unclassified 1/);
  assert.match(h.status.textContent, /Unclassified does not mean a real customer/);
});

test('users and risk text cells encode malicious identity/report/status strings while keeping real buttons, badges, numbers and metadata', async () => {
  const h = harness(['*'], { actualRows: true });
  const image = '<img src=x onerror="globalThis.__qaText = 1">';
  const script = '<script>globalThis.__qaText = 2</script>';
  const svg = "<svg onload='globalThis.__qaText = 3'>";
  const frame = '<iframe src="https://malicious.invalid">';
  const items = [
    { id: 'fixture-text-1', displayName: image, email: script, loginType: frame, status: svg,
      lastSeenAt: image, latestReportReason: image, recentAction: { action: script }, openReportCount: 1,
      walletBalanceLumina: 1234, paidAmountKrw: 4000, testAccountClassification: state() },
    { id: 'fixture-text-2', publicHandle: svg, email: image, loginTypes: [frame], status: image,
      recentAction: script, openReportCount: 1, testAccountClassification: state() },
    { id: 'fixture-text-3', nickname: script, email: svg, socialProvider: image, status: script,
      latestReportReason: frame, recentAction: image, openReportCount: 1, testAccountClassification: state() },
  ];
  const pending = h.api.load();
  h.listCalls[0].resolve(page({ items, filteredAccounts: 3,
    summary: { ...summary, filteredTestAccounts: 0, filteredUnclassifiedAccounts: 3 } }));
  await pending;
  assert.equal(h.state.error, false);
  const userMarkup = h.roots.userRows.innerHTML;
  const riskMarkup = h.roots.userRiskRows.innerHTML;
  for (const value of [image, script, svg, frame]) {
    assert.ok(userMarkup.includes(h.context.escapeHtml(value)), 'User-controlled display text must be encoded before the actual renderRows innerHTML');
    assert.ok(riskMarkup.includes(h.context.escapeHtml(value)), 'Risk display text must be encoded before the actual renderRows innerHTML');
  }
  assert.doesNotMatch(userMarkup + riskMarkup, /<(?:img|script|svg|iframe)\b/i);
  assert.equal((userMarkup.match(/<button class="row-action"/g) || []).length, 3);
  assert.equal((riskMarkup.match(/<button class="row-action"/g) || []).length, 3);
  assert.match(userMarkup, /<span class="status-badge is-review">/);
  assert.match(userMarkup, /<td>1234L<\/td><td>4000<\/td>/);
  const detailPayload = userMarkup.match(/data-detail="([^"]+)"/)[1];
  const detail = JSON.parse(decodeURIComponent(detailPayload));
  assert.equal(detail.meta.userId, 'fixture-text-1');
  assert.equal(detail.meta.status, svg, 'Metadata remains raw JSON inside the existing URI-encoded payload');
  assert.equal(detail.row[0], h.context.escapeHtml(image));
  assert.equal(h.context.__qaText, undefined, 'This is a string-rendering fixture, not a real script-execution test');
});

test('established endpoint supports every classification; absent legacy fields stay unavailable and 404 never redirects', async () => {
  for (const classification of ['all', 'test', 'unclassified']) {
    const h = harness(); const pending = h.api.load('', classification);
    const url = new URL(h.listCalls[0].path, 'https://synthetic.invalid');
    assert.equal(url.pathname, '/admin/api/v1/backstage/operations/users-overview');
    assert.equal(url.searchParams.get('classification'), classification);
    const items = page().items.filter(item => classification === 'all' || item.testAccountClassification.classification === classification);
    const filteredSummary = { ...summary, filteredTestAccounts: items.filter(item => item.testAccountClassification.classification === 'test').length,
      filteredUnclassifiedAccounts: items.filter(item => item.testAccountClassification.classification === 'unclassified').length };
    h.listCalls[0].resolve(page({ items, filteredAccounts: items.length, summary: filteredSummary })); await pending;
    assert.equal(h.listCalls.length, 1); assert.equal(h.state.error, false);
    assert.equal(h.state.classificationSupported, true);
    assert.equal(h.state.rows.length, items.length);
    const legacy = h.api.load('', classification);
    h.listCalls[1].resolve(page({ items: [{ id: 'fixture-old', email: 'test@example.invalid' }], summary: undefined }));
    await legacy;
    assert.equal(h.state.rows[0].row[10], 'Unclassified · Unavailable');
    assert.equal(h.state.classificationCounts, null);
    assert.equal(h.context.document.getElementById('usersClassificationFilter').disabled, true);
    const denied = h.api.load('', classification);
    h.listCalls[2].reject(Object.assign(new Error('Synthetic missing endpoint'), { status: 404 })); await denied;
    assert.equal(h.listCalls.length, 3, 'No endpoint fallback or implicit all-filter request');
    assert.equal(h.state.error, true); assert.equal(h.state.rows.length, 0);
  }
});

test('failed replacement search cannot inherit classification availability from a previous response', async () => {
  for (const error of [Object.assign(new Error('Synthetic server failure'), { status: 500 }), new TypeError('Synthetic network failure')]) {
    const h = harness();
    const first = h.api.load('first query');
    h.listCalls[0].resolve(page()); await first;
    assert.equal(h.state.classificationSupported, true);
    const replacement = h.api.load('replacement query');
    assert.equal(h.state.classificationSupported, false);
    h.listCalls[1].reject(error); await replacement;
    assert.equal(h.state.error, true);
    assert.equal(h.state.classificationSupported, false);
    assert.equal(h.state.classificationCounts, undefined);
    assert.equal(h.state.rows.length, 0);
    assert.equal(h.context.document.getElementById('usersClassificationFilter').disabled, true);
    assert.match(h.status.textContent, /Classification counts unavailable/);
    assert.equal(h.state.search, 'replacement query');
  }
});

for (const status of [401, 403]) {
  test(`list append ${status} preserves existing authorization-recovery clearing`, async () => {
    const h = harness(); const pending = h.api.load();
    h.listCalls[0].resolve(page({ hasMore: true, nextCursor: 'fixture-b' })); await pending;
    const more = h.api.more(); h.listCalls[1].reject(Object.assign(new Error('Synthetic denied'), { status })); await more;
    assert.equal(h.state.rows.length, 0); assert.equal(h.state.riskRows.length, 0);
    assert.equal(h.state.totalAccounts, undefined); assert.equal(h.state.filteredAccounts, undefined);
    assert.equal(h.state.classificationCounts, null); assert.equal(h.state.cursor, null);
  });
  test(`detail GET ${status} erases state/history and enables no write`, async () => {
    const h = harness(); const detail = h.open();
    await h.respond(h.calls[0], {}, status);
    assert.equal(detail.phase, 'error'); assert.equal(detail.current, null);
    assert.equal(detail.history.length, 0);
    await h.api.save(detail, 'test', 'qa_owned', true);
    assert.equal(h.calls.length, 1);
  });
}

test('opening and changing controls only reads; explicit confirmation and wildcard permission gate writes', async () => {
  const h = harness(); const detail = await h.ready();
  assert.deepEqual(h.calls.map(call => call.options.method), ['GET']);
  const controls = detail.node.controls;
  assert.equal(controls.confirm.checked, false); assert.equal(controls.save.disabled, true);
  controls.confirm.checked = true; controls.confirm.fire('change');
  assert.equal(controls.save.disabled, false);
  controls.reason.value = 'fixture'; controls.reason.fire('change');
  assert.equal(controls.confirm.checked, false); assert.equal(controls.save.disabled, true);
  await h.api.save(detail, 'test', 'fixture', false);
  assert.equal(h.calls.length, 1);
  for (const permissions of [['users:write'], ['users:read'], ['super_admin'], ['users:*'], []]) {
    const restricted = harness(permissions); const panel = restricted.open(); await tick();
    assert.equal(restricted.calls.length, 0, 'Role names and non-wildcard permissions cannot authorize classification');
    await restricted.api.save(panel, 'test', 'qa_owned', true);
    assert.equal(restricted.calls.length, 0);
  }
});

test('POST body is exact, key is fresh ASCII, receipt does not fabricate list counts/history', async () => {
  const h = harness(); const detail = await h.ready('fixture/a');
  const pending = h.api.save(detail, 'test', 'qa_owned', true);
  const post = h.calls[1];
  assert.match(post.url, /\/users\/fixture%2Fa\/test-account-classification$/);
  assert.deepEqual(JSON.parse(post.options.body), { classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned' });
  assert.deepEqual(Object.keys(post.options.headers).sort(), ['Authorization', 'Content-Type', 'Idempotency-Key']);
  assert.match(post.options.headers['Idempotency-Key'], /^[\x21-\x7e]{8,120}$/);
  await h.respond(post, receipt('fixture/a', 'test', 1, 'qa_owned')); await pending;
  assert.equal(detail.phase, 'saved'); assert.equal(detail.current.classification, 'test');
  assert.equal(detail.history, null); assert.equal(h.state.classificationCounts, null);
  await h.api.save(detail, 'unclassified', 'clear', true);
  assert.equal(h.calls.length, 2, 'Next command requires a fresh explicit read');
  const refresh = h.api.read(detail); await h.respond(h.calls[2], read('fixture/a', state('test', 1))); await refresh;
  const clear = h.api.save(detail, 'unclassified', 'clear', true);
  assert.deepEqual(JSON.parse(h.calls[3].options.body), { classification: 'unclassified', expectedRevision: 1, reasonCode: 'clear' });
  assert.notEqual(h.calls[3].options.headers['Idempotency-Key'], post.options.headers['Idempotency-Key']);
  await h.respond(h.calls[3], receipt('fixture/a', 'unclassified', 2, 'clear')); await clear;
});

test('command and key input validation rejects coercion, freeform reasons and non-ASCII/reused keys', async () => {
  const h = harness();
  for (const [classification, revision, reason] of [['real', 0, 'clear'], ['test', '0', 'qa_owned'],
    ['test', -1, 'fixture'], ['test', Infinity, 'fixture'], ['test', 0, 'free text'],
    ['test', 0, 'clear'], ['unclassified', 0, 'qa_owned']]) assert.equal(h.api.command(classification, revision, reason), null);
  assert.deepEqual(plain(h.api.command('unclassified', 4, 'clear')), { classification: 'unclassified', expectedRevision: 4, reasonCode: 'clear' });
  const detail = await h.ready();
  await assert.rejects(h.api.fetch(detail, 'POST', { classification: 'test', expectedRevision: 0, reasonCode: 'qa_owned', note: 'not allowed' }, 'valid-key'));
  for (const key of ['', 'short', 'x'.repeat(121), 'nonascii-\u00e9', 'has space']) {
    await assert.rejects(h.api.fetch(detail, 'POST', h.api.command('test', 0, 'qa_owned'), key));
  }
  assert.equal(h.calls.length, 1);
  h.context.window.crypto.randomUUID = () => 'fixed-ascii-key';
  h.api.key(); assert.throws(() => h.api.key());
  h.context.window.crypto = {}; assert.throws(() => h.api.key());
});

for (const status of [0, 401, 403, 409, 500]) {
  test(`POST ${status} never repeats; manual GET required, exact failed payload stays blocked across reopen/session refresh`, async () => {
    const h = harness(); const detail = await h.ready();
    const pending = h.api.save(detail, 'test', 'manual_confirmation', true);
    if (status) await h.respond(h.calls[1], {}, status);
    else { h.calls[1].reject(new Error('Synthetic response loss')); await tick(); }
    await pending;
    assert.equal(detail.phase, 'error'); assert.equal(detail.current, null);
    assert.equal(detail.message, status === 409 ? 'conflict' : status === 401 ? 'session' : status === 403 ? 'denied' : 'uncertain');
    await h.api.save(detail, 'test', 'fixture', true);
    assert.equal(h.calls.length, 2);
    h.context.auth.accessToken = 'synthetic-refreshed-token';
    const reopened = h.open(); await h.respond(h.calls[2], read());
    await h.api.save(reopened, 'test', 'manual_confirmation', true);
    assert.equal(h.calls.length, 3);
    const next = h.api.save(reopened, 'test', 'fixture', true);
    assert.equal(h.calls.length, 4);
    assert.notEqual(h.calls[3].options.headers['Idempotency-Key'], h.calls[1].options.headers['Idempotency-Key']);
    await h.respond(h.calls[3], receipt('fixture-a', 'test', 1, 'fixture')); await next;
  });
}

test('late GET/POST for another account cannot change the current panel or list', async () => {
  const h = harness(); const obsoleteRead = h.open('fixture-a'); const oldGet = h.calls[0];
  const current = h.open('fixture-b'); await h.respond(h.calls[1], read('fixture-b'));
  await h.respond(oldGet, read('fixture-a', state('test', 9)));
  assert.equal(current.current.classification, 'unclassified'); assert.equal(current.current.revision, 0);
  assert.equal(obsoleteRead.node.isConnected, false);
  const post = h.api.save(current, 'test', 'qa_owned', true); const oldPost = h.calls[2];
  const epoch = h.state.classificationEpoch;
  const latest = h.open('fixture-c'); await h.respond(h.calls[3], read('fixture-c'));
  await h.respond(oldPost, receipt('fixture-b', 'test', 1, 'qa_owned')); await post;
  assert.equal(latest.current.classification, 'unclassified');
  assert.equal(h.state.classificationEpoch, epoch);
  assert.equal(h.api.detail.userId, 'fixture-c');
});

test('session, permission, section and closed-panel changes suppress late state and new commands', async () => {
  for (const mutate of [h => { h.context.auth.accessToken = 'changed'; }, h => { h.context.permissions = ['users:write']; },
    h => { h.context.activeSection = 'creators'; }, h => { h.context.selectedDetail = null; },
    h => { h.context.detailPanel.classList.contains = () => true; }]) {
    const h = harness(); const detail = h.open(); mutate(h);
    await h.respond(h.calls[0], read('fixture-a', state('test', 5)));
    assert.equal(detail.current, null);
    await h.api.save(detail, 'test', 'fixture', true); assert.equal(h.calls.length, 1);
  }
  const h = harness(); const detail = await h.ready();
  const pending = h.api.save(detail, 'test', 'qa_owned', true);
  const epoch = h.state.classificationEpoch;
  h.context.auth.accessToken = 'changed';
  await h.respond(h.calls[1], receipt('fixture-a', 'test', 1, 'qa_owned')); await pending;
  assert.equal(detail.current, null); assert.equal(h.state.classificationEpoch, epoch);
  const refresh = h.api.read(detail); await h.respond(h.calls[2], read()); await refresh;
  await h.api.save(detail, 'test', 'qa_owned', true); assert.equal(h.calls.length, 3);
});

test('obsolete write ticket cannot overwrite a newer manual read on the same panel after session change', async () => {
  const h = harness(); const detail = await h.ready();
  const pending = h.api.save(detail, 'test', 'qa_owned', true); const oldPost = h.calls[1];
  h.context.auth.accessToken = 'new-session';
  await h.api.save(detail, 'test', 'fixture', true);
  assert.equal(detail.phase, 'error');
  const refresh = h.api.read(detail);
  await h.respond(h.calls[2], read('fixture-a', state('unclassified', 2))); await refresh;
  const epoch = h.state.classificationEpoch;
  await h.respond(oldPost, receipt('fixture-a', 'test', 1, 'qa_owned')); await pending;
  assert.equal(detail.current.classification, 'unclassified');
  assert.equal(detail.current.revision, 2); assert.equal(detail.phase, 'ready');
  assert.equal(h.state.classificationEpoch, epoch);
});

test('malformed read/receipt fail closed and old contracts remain unavailable', async () => {
  for (const data of [{}, { ...read(), userId: 'fixture-other' }, { ...read(), readOnly: false },
    { ...read(), policy: { permissionChanges: true, realCustomerInference: false } },
    { ...read(), history: [{ id: 'fake', revision: 99, classification: 'test', reasonCode: 'qa_owned', createdAt: 'invalid' }] }]) {
    const h = harness(); const detail = h.open(); await h.respond(h.calls[0], data);
    assert.equal(detail.current, null); assert.equal(detail.phase, 'error');
  }
  for (const data of [{}, { ...receipt(), permissionChanges: true }, { ...receipt(), userId: 'fixture-other' },
    { ...receipt(), receipt: { classification: 'test', revision: 9, reasonCode: 'manual_confirmation' } }]) {
    const h = harness(); const detail = await h.ready(); const pending = h.api.save(detail, 'test', 'manual_confirmation', true);
    await h.respond(h.calls[1], data); await pending;
    assert.equal(detail.current, null); assert.equal(detail.phase, 'error'); assert.equal(h.calls.length, 2);
  }
});

test('a list request started before a classification command cannot restore stale counts', async () => {
  const h = harness(); const detail = await h.ready();
  const list = h.api.load(); const oldList = h.listCalls[0];
  const save = h.api.save(detail, 'test', 'fixture', true);
  await h.respond(h.calls[1], receipt('fixture-a', 'test', 1, 'fixture')); await save;
  oldList.resolve(page()); await list;
  assert.equal(h.state.classificationCounts, null); assert.equal(h.state.classificationStale, true);
});

test('detail snapshot uses the dedicated classification as the sole userRows source and preserves risk/other rows', () => {
  const calls = [];
  const panel = { classList: { remove: value => calls.push(value) } };
  const context = { selectedDetail: null, detailPanel: panel, detailType: {}, detailTitle: {}, detailList: {}, detailMemo: { value: 'prior memo' },
    sectionState: {}, document: { querySelector(selector) {
      assert.equal(selector, '.dashboard-main');
      return { getAttribute(name) { assert.equal(name, 'data-active-section'); return 'users'; } };
    } },
    renderDetailForm: detail => calls.push(['form', detail]),
    renderDetailHistory: detail => calls.push(['history', detail]),
    updateDetailActions: detail => calls.push(['actions', detail]),
    syncUserClassificationPanel: detail => { calls.push(['classification', detail]); context.dedicated = context.current; },
  };
  runInNewContext(segment('let creatorsNativeReadProof =', 'function syncCurrentAdminContext(') + '\n'
    + segment('function getCurrentSection(', 'function saveActiveSection(') + '\n'
    + segment('function renderDetailPanel(', 'function openQuickAction(') + '\nthis.render = renderDetailPanel;', context);
  for (const current of ['test revision 1', 'unclassified revision 2']) {
    context.current = current;
    const row = Array.from({ length: 12 }, (_, index) => `value-${index}`);
    const labels = row.map((_, index) => `label-${index}`);
    row[10] = 'stale classification snapshot'; labels[10] = 'Account classification';
    const detail = { tableId: 'userRows', type: 'User detail', row, labels };
    const original = JSON.stringify(detail); calls.length = 0;
    context.render(detail);
    assert.doesNotMatch(context.detailList.innerHTML, /stale classification snapshot|<dt>Account classification<\/dt>/);
    assert.equal((context.detailList.innerHTML.match(/<dd>/g) || []).length, 11);
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11]) {
      assert.ok(context.detailList.innerHTML.includes(`<dt>label-${index}</dt><dd>value-${index}</dd>`));
    }
    assert.equal(context.dedicated, current);
    assert.equal(context.detailTitle.textContent, row[2]); assert.equal(context.detailType.textContent, detail.type);
    assert.equal(context.detailMemo.value, ''); assert.equal(context.selectedDetail, detail);
    assert.equal(JSON.stringify(detail), original);
    assert.deepEqual(calls, ['is-hidden', ['form', detail], ['history', detail], ['actions', detail], ['classification', detail]]);
  }
  for (const tableId of ['userRiskRows', 'creatorRows', undefined]) {
    for (const length of [6, 12]) {
      const row = Array.from({ length }, (_, index) => `other-value-${index}`);
      const detail = { tableId, row };
      context.render(detail);
      assert.equal((context.detailList.innerHTML.match(/<dd>/g) || []).length, length);
      for (const value of row) assert.ok(context.detailList.innerHTML.includes(`<dd>${value}</dd>`));
    }
  }
});

test('detail snapshot preserves the exact renderDetailPanel anchor outside the users-only skip', () => {
  const original = `function renderDetailPanel(detail) {
  if (!detailPanel || !detail) return;
  selectedDetail = detail;
  detailPanel.classList.remove("is-hidden");
  detailType.textContent = detail.type || "Detail";
  detailTitle.textContent = detail.row?.[2] || detail.row?.[0] || "상세 정보";
  detailList.innerHTML = detail.row.map((value, index) => {
    const label = detail.labels?.[index] || \`항목 \${index + 1}\`;
    return \`<div><dt>\${label}</dt><dd>\${value}</dd></div>\`;
  }).join("");
  renderDetailForm(detail);
  renderDetailHistory(detail);
  detailMemo.value = "";
  updateDetailActions(detail);
  syncUserClassificationPanel(detail);
}

`;
  const guardedPanel = segment('function renderDetailPanel(', 'function openQuickAction(').replaceAll('\r\n', '\n');
  const readonlyGuard = '  if (!detailPanel || !detail || creatorsNativeReadonlyRestricted(detail)) return;';
  assert.equal(guardedPanel.split(readonlyGuard).length, 2, 'Exactly the independently tested creator read-only guard is restored for the historical anchor');
  const panel = guardedPanel.replace(readonlyGuard, '  if (!detailPanel || !detail) return;');
  const titleChange = '  detailTitle.textContent = typeof detail.titleText === "string"\n    ? detail.titleText : detail.row?.[2] || detail.row?.[0] || "상세 정보";';
  assert.equal(panel.split(titleChange).length, 2, 'Only the separately tested textContent title handoff can differ');
  assert.equal(panel.replace(titleChange, '  detailTitle.textContent = detail.row?.[2] || detail.row?.[0] || "상세 정보";')
    .replace('    if (detail.tableId === "userRows" && index === 10) return "";\n', ''), original);
});

test('five locale labels and scoped 44px responsive CSS are present; rendering is not claimed', () => {
  const h = harness(); const titles = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    h.context.document.documentElement.lang = locale;
    titles.add(h.api.text('title'));
    for (const key of ['test', 'unclassified', 'confirm', 'save', 'noInference', 'noPermissions']) assert.notEqual(h.api.text(key), key);
  }
  assert.equal(titles.size, 5);
  assert.match(css, /\.user-classification-panel button \{[^}]*min-height: 44px/);
  assert.match(css, /\.user-classification-panel select[^}]*height: 44px/);
  assert.match(css, /user-classification-refresh[^}]*width: 44px; height: 44px/);
  assert.match(css, /@media \(max-width: 480px\).*user-classification-panel/);
  assert.ok(segment('function renderDetailPanel(', 'function openQuickAction(').includes('syncUserClassificationPanel(detail)'));
});

// Hidden-dashboard regression additions; existing harness and assertions stay unchanged.
test('hidden dashboard: pending GET cannot populate current state or history or enable commands', async () => {
  const h = harness(); const detail = h.open(); const pendingGet = h.calls[0];
  const auth = plain(h.context.auth);
  h.context.dashboardView.classList.contains = name => name === 'is-hidden';
  const current = state('test', 1);
  const history = [{ id: 'fixture-hidden-history', revision: 1, classification: 'test', reasonCode: 'qa_owned', createdAt: current.updatedAt }];
  await h.respond(pendingGet, read('fixture-a', current, history));
  assert.deepEqual(plain(h.context.auth), auth, 'Shared-auth fallback can keep exactly the same session');
  assert.equal(detail.current, null, 'Hidden dashboard must invalidate the pending classification read');
  assert.equal(detail.history.length, 0, 'Hidden dashboard must not publish classification history');
  assert.match(detail.node.innerHTML, /<fieldset disabled>/);
  detail.node.controls.confirm.checked = true; detail.node.controls.confirm.fire('change');
  assert.equal(detail.node.controls.save.disabled, true);
  assert.equal(h.calls.length, 1);
});

for (const status of [200, 409, 0]) {
  test(`hidden dashboard: pending POST ${status || 'network failure'} cannot stale a cleared list or enable commands`, async () => {
    const h = harness(); const detail = await h.ready();
    const pending = h.api.save(detail, 'test', 'qa_owned', true); const post = h.calls[1];
    const auth = plain(h.context.auth);
    h.context.dashboardView.classList.contains = name => name === 'is-hidden';
    // Model showLogin's already-cleared member view, without editing or executing that loader.
    h.context.sectionState.users = { cursor: null, hasMore: false, rows: [], riskRows: [], search: '',
      classification: 'all', classificationSupported: false };
    h.roots.userRows.innerHTML = ''; h.roots.userRiskRows.innerHTML = ''; h.status.textContent = '';
    const newState = h.state;
    const view = () => plain({ state: h.state, userHtml: h.roots.userRows.innerHTML,
      riskHtml: h.roots.userRiskRows.innerHTML, status: h.status.textContent });
    const before = view();
    if (status) await h.respond(post, status === 200 ? receipt('fixture-a', 'test', 1, 'qa_owned') : {}, status);
    else { post.reject(new Error('Synthetic hidden-dashboard response loss')); await tick(); }
    await pending;
    assert.deepEqual(plain(h.context.auth), auth);
    assert.equal(h.state, newState);
    assert.deepEqual(view(), before, 'Obsolete POST must not mark new-list counts/epoch/stale or repaint its status/rows');
    assert.equal(detail.current, null);
    assert.equal(detail.history.length, 0);
    assert.match(detail.node.innerHTML, /<fieldset disabled>/);
    detail.node.controls.confirm.checked = true; detail.node.controls.confirm.fire('change');
    assert.equal(detail.node.controls.save.disabled, true);
    assert.equal(h.calls.length, 2, 'No automatic repeat or hidden follow-up request');
  });
}

for (const method of ['GET', 'POST']) {
  test(`hidden dashboard: initial manual ${method} dispatches no fetch and changes no list state`, async () => {
    const h = harness(); const detail = await h.ready(); const calls = h.calls.length;
    const auth = plain(h.context.auth); const before = plain(h.state);
    h.context.dashboardView.classList.contains = name => name === 'is-hidden';
    const pending = method === 'GET' ? h.api.read(detail) : h.api.save(detail, 'test', 'qa_owned', true);
    // Settle any original regression dispatch so the selected test cannot hang or cancel.
    if (h.calls.length > calls) await h.respond(h.calls.at(-1),
      method === 'GET' ? read('fixture-a', state('test', 1)) : receipt('fixture-a', 'test', 1, 'qa_owned'));
    await pending;
    assert.deepEqual(plain(h.context.auth), auth);
    assert.equal(h.calls.length, calls, `Hidden dashboard must not dispatch a new ${method}`);
    assert.deepEqual(plain(h.state), before);
    assert.equal(detail.current, null); assert.equal(detail.history.length, 0);
    assert.match(detail.node.innerHTML, /<fieldset disabled>/);
    detail.node.controls.confirm.checked = true; detail.node.controls.confirm.fire('change');
    assert.equal(detail.node.controls.save.disabled, true);
  });
}

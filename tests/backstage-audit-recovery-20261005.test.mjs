import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function excerpt(start, end) {
  const from = source.indexOf(start); const to = source.indexOf(end, from + start.length);
  assert.ok(from > 0 && to > from, start);
  return source.slice(from, to);
}
const runtime = [
  excerpt('function creatorsNativeIsTable(', 'function creatorsNativeIsDetail('),
  excerpt('function readActionHistory(', 'function writeActionHistory('),
  excerpt('function localHistoryRows(', 'function setStatus('),
  excerpt('function formatHistoryTime(', 'function renderDetailHistory('),
  excerpt('function normalizePage(', 'function readSectionSearch('),
  excerpt('function escapeHtml(', 'function firstRoleName('),
  excerpt('function statusBadge(', 'function renderSettlementChildren('),
  excerpt('function setLoadMore(', 'function renderFallbackNote('),
  excerpt('function backstageErrorStatus(', 'function backstageUserFacingError('),
  excerpt('function canAccessBackstageSection(', 'function applyPermissionVisibility('),
  excerpt('async function loadAuditSection(', 'function loadSection('),
  'this.api = { load: loadAuditSection, more: loadAuditPage };',
].join('\n');

class Element {
  constructor() { this.dataset = {}; this.children = []; this.attributes = {}; this.html = ''; this.disabled = false;
    this.classList = { toggle() {} }; }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  set textContent(value) { this.text = value; }
  get textContent() { return this.text || ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  querySelector(selector) { return selector === '[data-audit-error]' ? this.children.find(child => Object.hasOwn(child.dataset, 'auditError')) || null : null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
function harness() {
  const root = new Element(); const more = new Element(); const calls = []; const fallbacks = [];
  const context = { URLSearchParams, backstageAuthEpoch: 0,
    BACKSTAGE_HISTORY_KEY: 'fixture-audit-history', history: [], localReads: 0,
    localStorage: { getItem: () => { context.localReads++; return JSON.stringify(context.history); } },
    document: { getElementById: id => id === 'logRows' ? root : null, createElement: () => new Element(), querySelector: () => more },
    sectionState: { logs: { rows: [], cursor: null, hasMore: false } },
    tableMeta: { logRows: { type: 'Audit fixture', labels: ['Time', 'Actor', 'Action', 'Target', 'Reason'] } },
    statusClassMap: {}, auth: { accessToken: 'fixture-token-a', user: { id: 'fixture-actor-a',
      adminUser: { status: 'active', permissions: ['audit:read'] } } }, section: 'logs',
    getBackstageAuth: () => context.auth, getCurrentSection: () => context.section,
    dashboardView: { classList: { contains: () => false } },
    adminApiPath: path => `/admin/api/v1${path}`,
    backstageFetch: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })),
    renderBackstageTables: () => { fallbacks.push('all-tables'); root.innerHTML = 'sample audit rows'; },
    renderFallbackNote: () => fallbacks.push('fallback-note'),
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:audit-recovery-synthetic' });
  return { context, root, more, calls, fallbacks, api: context.api,
    get state() { return context.sectionState.logs; },
    async seed() {
      const first = context.api.load(); calls.at(-1).resolve(page('first')); await first;
      const second = context.api.more(); calls.at(-1).resolve(page('second')); await second;
      assert.equal(this.state.rows.length, 2); return this.state;
    },
  };
}
const error = status => Object.assign(new Error('Synthetic audit failure'), { status });
const page = (label, extra = {}) => ({ items: [{ id: `fixture-${label}`, actorUserId: 'fixture-actor-a',
  actorUser: { emailMasked: 'fixture-***' }, createdAt: '2026-10-05T01:00:00.000Z',
  action: `fixture.${label}`, targetType: 'fixture', targetId: `target-${label}`, metadata: { reason: `reason-${label}` } }],
  hasMore: true, nextCursor: `cursor-${label}`, ...extra });
const plain = value => JSON.parse(JSON.stringify(value));

for (const status of [401, 403]) {
  test(`append final ${status} clears protected audit rows/cursor without repainting other tables`, async () => {
    const h = harness(); await h.seed(); const pending = h.api.more(); h.calls.at(-1).reject(error(status)); await pending;
    assert.equal(h.state.rows.length, 0); assert.equal(h.state.cursor, null); assert.equal(h.state.hasMore, false);
    assert.equal(h.state.loading, false); assert.equal(h.state.error, true);
    assert.deepEqual(h.fallbacks, []); assert.doesNotMatch(h.root.innerHTML, /fixture\.(first|second)|sample audit/);
    assert.match(h.root.innerHTML, /role="alert"/);
    const deniedCalls = h.calls.length; await h.api.more(); assert.equal(h.calls.length, deniedCalls, 'Old cursor is unusable after denial');
    const clean = h.api.load(); const request = new URL(h.calls.at(-1).path, 'https://fixture.invalid');
    assert.equal(request.searchParams.get('cursor'), null);
    h.calls.at(-1).resolve(page('recovered', { hasMore: false, nextCursor: null })); await clean;
    assert.equal(h.state.rows.length, 1); assert.match(h.root.innerHTML, /fixture\.recovered/);
  });
}

for (const [label, failure] of [['500', () => error(500)], ['network', () => new TypeError('Synthetic offline')]]) {
  test(`append ${label} retains exact cached rows/cursor and permits the same manual retry`, async () => {
    const h = harness(); await h.seed(); const rows = h.state.rows; const markup = h.root.innerHTML; const cursor = h.state.cursor;
    const pending = h.api.more(); const path = h.calls.at(-1).path; h.calls.at(-1).reject(failure()); await pending;
    assert.equal(h.state.rows, rows); assert.equal(h.state.cursor, cursor); assert.equal(h.state.hasMore, true);
    assert.ok(h.root.innerHTML.startsWith(markup)); assert.deepEqual(h.fallbacks, []);
    assert.equal(h.state.loading, false); assert.equal(h.state.error, true);
    assert.ok(h.root.querySelector('[data-audit-error]'), 'Preserved rows have a visible failure notice');
    const retry = h.api.more(); assert.equal(h.calls.at(-1).path, path);
    assert.equal(h.root.querySelector('[data-audit-error]'), null);
    h.calls.at(-1).resolve(page('retry', { hasMore: false, nextCursor: null })); await retry;
    assert.equal(h.state.rows.length, 3); assert.equal(h.state.rows[0], rows[0]); assert.equal(h.state.error, false);
  });
}

test('initial failure shows only an audit error and never samples/unrelated tables', async () => {
  for (const failure of [error(500), new TypeError('Synthetic offline')]) {
    const h = harness(); const pending = h.api.load(); h.calls[0].reject(failure); await pending;
    assert.deepEqual(h.fallbacks, []); assert.equal(h.state.rows.length, 0); assert.equal(h.state.cursor, null);
    assert.equal(h.state.hasMore, false); assert.equal(h.state.loading, false); assert.match(h.root.innerHTML, /role="alert"/);
    assert.doesNotMatch(h.root.innerHTML, /sample audit/);
  }
});

test('older success cannot resurrect a denied replacement audit page', async () => {
  const h = harness(); const old = h.api.load(); const oldCall = h.calls[0];
  const current = h.api.load(); h.calls[1].reject(error(403)); await current;
  const state = h.state; const markup = h.root.innerHTML;
  oldCall.resolve(page('obsolete')); await old;
  assert.equal(h.state, state); assert.equal(h.root.innerHTML, markup); assert.equal(h.state.rows.length, 0); assert.equal(h.state.cursor, null);
});

test('older failures cannot overwrite a newer loaded page or clear its in-flight loading flag', async () => {
  for (const failure of [error(401), error(500), new TypeError('Synthetic offline')]) {
    const h = harness(); const old = h.api.load(); const oldCall = h.calls[0]; const newer = h.api.load();
    const state = h.state; const markup = h.root.innerHTML;
    oldCall.reject(failure); await old;
    assert.equal(h.state, state); assert.equal(h.state.loading, true); assert.equal(h.root.innerHTML, markup);
    assert.deepEqual(h.fallbacks, []);
    h.calls[1].resolve(page('current')); await newer;
    assert.match(h.root.innerHTML, /fixture\.current/); assert.equal(h.state.error, false);
  }
});

test('one active append cannot issue duplicate cursor requests', async () => {
  const h = harness(); await h.seed(); const pending = h.api.more(); const count = h.calls.length;
  const duplicate = h.api.more(); const observed = h.calls.length;
  if (observed > count) { h.calls.at(-1).resolve(page('duplicate')); await duplicate; }
  assert.equal(observed, count); assert.equal(h.state.loading, true);
  await duplicate;
  h.calls.at(-1).resolve(page('single')); await pending;
  assert.equal(h.state.rows.length, 3); assert.equal(h.state.loading, false);
});

test('late responses after leaving the audit section do not repaint the shared log table', async () => {
  for (const succeeds of [true, false]) {
    const h = harness(); await h.seed(); const pending = h.api.more(); const call = h.calls.at(-1);
    h.context.section = 'overview'; h.root.innerHTML = 'current overview audit table';
    const rows = h.state.rows; const cursor = h.state.cursor;
    if (succeeds) call.resolve(page('obsolete')); else call.reject(error(401));
    await pending;
    assert.equal(h.root.innerHTML, 'current overview audit table'); assert.equal(h.state.rows, rows); assert.equal(h.state.cursor, cursor);
    assert.deepEqual(h.fallbacks, []);
  }
});

test('late responses for a changed operator do not publish the previous operator audit page', async () => {
  for (const succeeds of [true, false]) {
    const h = harness(); const pending = h.api.load(); const call = h.calls[0]; const markup = h.root.innerHTML;
    h.context.auth = { accessToken: 'fixture-token-b', user: { id: 'fixture-actor-b' } };
    if (succeeds) call.resolve(page('previous-actor')); else call.reject(error(403));
    await pending;
    assert.equal(h.root.innerHTML, markup); assert.equal(h.state.rows.length, 0); assert.equal(h.state.cursor, null);
    assert.deepEqual(h.fallbacks, []);
  }
});

test('malicious audit action/target/reason and settlement status text cannot become renderer HTML', async () => {
  const h = harness();
  const image = '<img src=x onerror="fixture()">'; const svg = "<svg onload='fixture()'>";
  const script = '<script>fixture()</script>';
  const fixture = page('malicious', { hasMore: false, nextCursor: null });
  fixture.items = [
    { ...fixture.items[0], action: image, targetType: svg, metadata: { reason: script } },
    { ...fixture.items[0], action: 'story_ai_continuation.settle', targetType: 'story', metadata: { status: image, failureCode: script } },
    { ...fixture.items[0], action: 'fixture.legacy', reason: script },
    { ...fixture.items[0], action: 'fixture.target-fallback', targetId: '<svg>&xy-rest', metadata: {} },
  ];
  const original = plain(fixture);
  const pending = h.api.load(); h.calls[0].resolve(fixture); await pending;
  assert.equal(h.state.rows[0][2], '&lt;img src=x onerror=&quot;fixture()&quot;&gt;');
  assert.equal(h.state.rows[0][3], '&lt;svg onload=&#039;fixture()&#039;&gt;');
  assert.equal(h.state.rows[0][4], '&lt;script&gt;fixture()&lt;/script&gt;');
  assert.ok(h.state.rows[1][4].startsWith('&lt;img'));
  assert.ok(h.state.rows[1][4].includes('&lt;script&gt;fixture()&lt;/script&gt;'));
  assert.equal(h.state.rows[2][4], '&lt;script&gt;fixture()&lt;/script&gt;');
  assert.equal(h.state.rows[3][4], '&lt;svg&gt;&amp;xy');
  assert.doesNotMatch(h.root.innerHTML, /<(?:img|svg|script)\b/i);
  assert.equal((h.root.innerHTML.match(/<button class="row-action"/g) || []).length, 4);
  assert.deepEqual(plain(fixture), original);
});

test('local audit history is encoded once without re-encoding server rows or changing 20/40 merge limits', async () => {
  const h = harness();
  const image = '<img src=x onerror="fixture()">'; const svg = "<svg onload='fixture()'>";
  const script = '<script>fixture()</script>'; const frame = '<iframe src="fixture.invalid">';
  h.context.history = Array.from({ length: 25 }, (_, index) => ({ createdAt: '2026-10-05T01:00:00.000Z',
    actor: `local-actor-${index}`, actionLabel: `local-action-${index}`, target: `local-target-${index}`, note: `local-note-${index}` }));
  Object.assign(h.context.history[0], { actor: image, actionLabel: svg, target: script, note: frame });
  Object.assign(h.context.history[1], { actionLabel: undefined, status: svg, note: undefined, message: image });
  const originalHistory = plain(h.context.history);
  const fixture = page('server');
  fixture.items = Array.from({ length: 20 }, (_, index) => ({ ...fixture.items[0], action: `fixture.server-${index}`, metadata: { reason: script } }));
  const originalServer = plain(fixture);
  const first = h.api.load(); h.calls[0].resolve(fixture); await first;
  const extra = page('additional', { hasMore: false, nextCursor: null });
  extra.items = Array.from({ length: 10 }, (_, index) => ({ ...extra.items[0], action: `fixture.additional-${index}` }));
  const append = h.api.more(); h.calls[1].resolve(extra); await append;
  const markup = h.root.innerHTML;
  assert.doesNotMatch(markup, /<(?:img|svg|script|iframe)\b/i);
  for (const encoded of ['&lt;img src=x onerror=&quot;fixture()&quot;&gt;', '&lt;svg onload=&#039;fixture()&#039;&gt;',
    '&lt;script&gt;fixture()&lt;/script&gt;', '&lt;iframe src=&quot;fixture.invalid&quot;&gt;']) assert.ok(markup.includes(encoded));
  assert.doesNotMatch(markup, /&amp;lt;|&amp;gt;/);
  assert.equal(h.state.rows[0][4], '&lt;script&gt;fixture()&lt;/script&gt;');
  assert.equal(h.state.rows.length, 30); assert.equal(h.context.localReads, 2, 'One local history read per rendered response');
  assert.equal((markup.match(/<tr data-table-id="logRows">/g) || []).length, 40);
  assert.equal((markup.match(/<button class="row-action"/g) || []).length, 40);
  assert.ok(markup.includes('local-note-19')); assert.ok(!markup.includes('local-note-20'));
  assert.ok(!markup.includes('fixture.additional-0'), 'Existing local-first 40-row visible cap remains unchanged');
  assert.deepEqual(plain(h.context.history), originalHistory); assert.deepEqual(plain(fixture), originalServer);
});

test('healthy append keeps endpoint, masked actor, cached row identity and source/page references', async () => {
  const h = harness(); await h.seed(); const state = h.state; const row = state.rows[0];
  const fixture = page('healthy', { hasMore: false, nextCursor: null }); const original = plain(fixture);
  const pending = h.api.more(); const call = h.calls.at(-1); const query = new URL(call.path, 'https://fixture.invalid');
  assert.equal(query.pathname, '/admin/api/v1/audit-events'); assert.equal(query.searchParams.get('take'), '20');
  assert.equal(query.searchParams.get('cursor'), 'cursor-second');
  assert.deepEqual(Object.keys(call.options).sort(), ['auth', 'isCurrent']);
  assert.equal(call.options.auth, true); assert.equal(call.options.isCurrent(), true);
  call.resolve(fixture); await pending;
  assert.equal(h.state, state); assert.equal(h.state.rows[0], row); assert.equal(h.state.rows.length, 3);
  assert.equal(h.state.rows[2][1], 'fixture-***'); assert.deepEqual(plain(fixture), original);
  assert.equal(h.state.cursor, null); assert.equal(h.state.hasMore, false);
});

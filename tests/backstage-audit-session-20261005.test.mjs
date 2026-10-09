import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function excerpt(name, next) {
  const pattern = value => new RegExp(`^(?:async )?function ${value}\\(`, 'm');
  const start = source.search(pattern(name));
  assert.ok(start >= 0, `Missing actual function: ${name}`);
  const offset = source.slice(start + 1).search(pattern(next));
  assert.ok(offset >= 0, `Missing next function: ${next}`);
  return source.slice(start, start + 1 + offset);
}
const authConstants = ['BACKSTAGE_AUTH_KEY', 'SHARED_AUTH_KEYS'].map(name => {
  const line = source.match(new RegExp(`^const ${name} = [^;\\r\\n]+;`, 'm'));
  assert.ok(line, `Missing auth key declaration: ${name}`);
  return line[0];
}).join('\n');
const runtime = [authConstants,
  excerpt('creatorsNativeIsTable', 'creatorsNativeIsDetail'),
  excerpt('getBackstageAuth', 'setBackstageAuth'),
  excerpt('normalizeAuthPayload', 'refreshBackstageAuthOnce'),
  excerpt('canAccessBackstageSection', 'applyPermissionVisibility'),
  excerpt('normalizePage', 'readSectionSearch'),
  excerpt('adminApiPath', 'verifyAdminAccess'),
  excerpt('escapeHtml', 'firstRoleName'),
  excerpt('statusBadge', 'renderSettlementChildren'),
  excerpt('setLoadMore', 'renderFallbackNote'),
  excerpt('backstageErrorStatus', 'backstageUserFacingError'),
  excerpt('loadAuditSection', 'loadAuditPage'),
  excerpt('loadAuditPage', 'loadSection'),
  `for (const [name, fn] of Object.entries({ rows: renderRows, loading: renderLoadingRow, error: renderErrorRow, more: setLoadMore })) {
     const wrapped = (...args) => { publications.push({ kind: name, args }); return fn(...args); };
     if (name === 'rows') renderRows = wrapped;
     if (name === 'loading') renderLoadingRow = wrapped;
     if (name === 'error') renderErrorRow = wrapped;
     if (name === 'more') setLoadMore = wrapped;
   }
   this.api = { section: loadAuditSection, page: loadAuditPage, auth: getBackstageAuth, allowed: canAccessBackstageSection };`,
].join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const encode = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
})[char]);
function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value),
    toggle(value, enabled) { if (enabled) values.add(value); else values.delete(value); } };
}
function node(tagName) {
  let markup = '';
  const element = { tagName, dataset: {}, attributes: {}, children: [], textContent: '', classList: classes(),
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; element.children = []; },
    append(child) { element.children.push(child); child.parent = element; },
    remove() { if (element.parent) element.parent.children = element.parent.children.filter(child => child !== element); },
    setAttribute(name, value) { element.attributes[name] = value; },
    querySelector(selector) { assert.equal(selector, '[data-audit-error]'); return element.children.find(child => Object.hasOwn(child.dataset, 'auditError')) || null; } };
  return element;
}
const operator = (id = 'synthetic-operator-a', extra = {}) => ({ accessToken: 'synthetic-access-a',
  refreshToken: 'synthetic-refresh-a', user: { id, adminPermissions: ['audit:read'],
    adminUser: { status: 'active', permissions: ['audit:read'] } }, ...extra });
const oldRows = () => [['synthetic-time', 'masked-old', 'old-action', 'user', 'old-reason']];
const state = () => ({ cursor: 'synthetic:cursor/+==', hasMore: true, rows: oldRows(), loading: false, error: false });
const event = extra => ({ id: 'synthetic-event', createdAt: '2026-10-05T01:00:00.000Z',
  actorUser: { emailMasked: 's***@example.invalid', email: 'unselected-raw@example.invalid' }, action: 'user.synthetic_read',
  targetType: 'user', reason: 'Synthetic & <reason>', ...extra });
const response = extra => ({ items: [event()], nextCursor: 'synthetic-next', hasMore: true, ...extra });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Real auth normalization/store fallback and logs-menu helper; no real token verification or HTTP.
function harness({ auth = operator(), hidden = false, initialState = state(), automatic = null } = {}) {
  const storage = new Map();
  const log = node('tbody');
  log.innerHTML = '<tr><td>synthetic-existing-list</td></tr>';
  const dashboard = node('section');
  if (hidden) dashboard.classList.add('is-hidden');
  const more = node('button');
  const requests = [];
  const publications = [];
  let section = 'logs';
  const context = {
    dashboardView: dashboard, sectionState: { logs: initialState }, publications, URLSearchParams,
    localStorage: { getItem: key => storage.get(key) ?? null },
    getCurrentSection: () => section,
    currentAdminRoleName: () => assert.fail('Logs menu must not add local role gating'),
    currentAdminPermissions: () => assert.fail('Logs menu must not add local permission gating'),
    localHistoryRows: () => [], tableMeta: { logRows: { type: 'Synthetic logs', labels: ['time', 'actor', 'action', 'target', 'reason'] } },
    statusClassMap: {},
    document: {
      getElementById: id => { assert.equal(id, 'logRows'); return log; },
      querySelector: selector => { assert.equal(selector, '[data-load-more="logs"]'); return more; },
      createElement: tag => { assert.ok(['tr', 'td'].includes(tag)); return node(tag); },
    },
    backstageFetch: (path, options) => {
      const pending = deferred();
      requests.push({ path, options, ...pending });
      if (automatic) pending.resolve(automatic);
      return pending.promise;
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:audit-session-synthetic', timeout: 1000 });
  const put = (key, value) => { if (value == null) storage.delete(key); else storage.set(key, JSON.stringify(value)); };
  put('lumina_backstage_auth', auth);
  return { api: context.api, context, log, more, dashboard, requests, publications,
    putPrimary: value => put('lumina_backstage_auth', value), putFallback: value => put('lumina_auth', value),
    setSection: value => { section = value; },
    rowsSnapshot() { const current = context.sectionState.logs; return plain({ rows: current.rows, cursor: current.cursor, hasMore: current.hasMore, error: current.error }); } };
}
function assertRequest(request, cursor = null) {
  const expected = new URLSearchParams({ take: '20' });
  if (cursor) expected.set('cursor', cursor);
  assert.equal(request.path, `/admin/api/v1/audit-events?${expected}`);
  assert.deepEqual(Object.keys(request.options).sort(), ['auth', 'isCurrent']);
  assert.equal(request.options.auth, true);
  assert.equal(typeof request.options.isCurrent, 'function');
  assert.equal(request.options.isCurrent(), true);
}
function settle(request, status) {
  if (status === 200) request.resolve(response());
  else request.reject(Object.assign(new Error('synthetic-error'), { status }));
}
function snapshotDom(h) { return plain({ markup: h.log.innerHTML, alerts: h.log.children.map(row => ({
  dataset: row.dataset, cells: row.children.map(cell => ({ text: cell.textContent, attributes: cell.attributes })) })),
  moreHidden: h.more.classList.contains('is-hidden'), moreDisabled: h.more.disabled ?? null }); }

test('initial missing usable auth or operator identity is a no-op before loading/reset/fetch on both entry points', async () => {
  for (const auth of [null, { user: { id: 'synthetic-operator-a' } }, operator('', { user: {} })]) {
    for (const entry of ['section', 'page']) {
      const h = harness({ auth, automatic: response() });
      const originalState = h.context.sectionState.logs;
      const before = h.rowsSnapshot();
      const dom = snapshotDom(h);
      await h.api[entry](false);
      assert.equal(h.requests.length, 0, `Invalid initial session must not fetch: ${entry}`);
      assert.equal(h.publications.length, 0, `Invalid initial session must not publish loading: ${entry}`);
      assert.equal(h.context.sectionState.logs, originalState);
      assert.deepEqual(h.rowsSnapshot(), before);
      assert.deepEqual(snapshotDom(h), dom);
    }
  }
});

test('initial hidden dashboard with same-operator shared auth fallback is a no-op on section and page', async () => {
  for (const entry of ['section', 'page']) {
    const h = harness({ auth: null, hidden: true, automatic: response() });
    h.putFallback(operator());
    assert.equal(h.api.auth().user.id, 'synthetic-operator-a');
    assert.equal(h.api.allowed('logs'), true);
    const originalState = h.context.sectionState.logs;
    const before = h.rowsSnapshot();
    const dom = snapshotDom(h);
    await h.api[entry](false);
    assert.equal(h.requests.length, 0, `Hidden dashboard must not fetch: ${entry}`);
    assert.equal(h.publications.length, 0, `Hidden dashboard must not publish loading: ${entry}`);
    assert.equal(h.context.sectionState.logs, originalState);
    assert.deepEqual(h.rowsSnapshot(), before);
    assert.deepEqual(snapshotDom(h), dom);
  }
});

test('in-flight response after auth loss cannot publish 200/403/500 results', async () => {
  for (const status of [200, 403, 500]) {
    const h = harness();
    const pending = h.api.page(true);
    assert.equal(h.requests.length, 1);
    assertRequest(h.requests[0], 'synthetic:cursor/+==');
    h.putPrimary(null);
    const before = h.rowsSnapshot();
    const dom = snapshotDom(h);
    h.publications.length = 0;
    settle(h.requests[0], status);
    await pending;
    assert.deepEqual(h.rowsSnapshot(), before);
    assert.deepEqual(snapshotDom(h), dom);
    assert.equal(h.publications.length, 0);
    assert.equal(h.context.sectionState.logs.loading, false);
  }
});

test('in-flight hidden dashboard cannot resurrect rows/errors via same-operator fallback after primary logout', async () => {
  for (const status of [200, 403, 500]) {
    const h = harness();
    h.putFallback(operator());
    const pending = h.api.page(true);
    assert.equal(h.requests.length, 1);
    h.putPrimary(null);
    h.dashboard.classList.add('is-hidden');
    assert.equal(h.api.auth().user.id, 'synthetic-operator-a');
    const before = h.rowsSnapshot();
    const dom = snapshotDom(h);
    h.publications.length = 0;
    settle(h.requests[0], status);
    await pending;
    assert.deepEqual(h.rowsSnapshot(), before, `Hidden session cannot publish state: ${status}`);
    assert.deepEqual(snapshotDom(h), dom);
    assert.equal(h.publications.length, 0);
    assert.equal(h.context.sectionState.logs.loading, false);
  }
});

test('different operator, switched logs section, or replaced logs state cannot publish stale success/errors', async () => {
  for (const boundary of ['different-hidden-operator', 'different-visible-operator', 'section', 'state']) {
    for (const status of [200, 403, 500]) {
      const h = harness();
      const old = h.context.sectionState.logs;
      const pending = h.api.page(true);
      assert.equal(h.requests.length, 1);
      if (boundary.startsWith('different')) h.putPrimary(operator('synthetic-operator-b'));
      if (boundary === 'different-hidden-operator') h.dashboard.classList.add('is-hidden');
      if (boundary === 'section') h.setSection('overview');
      if (boundary === 'state') h.context.sectionState.logs = state();
      const before = h.rowsSnapshot();
      const dom = snapshotDom(h);
      h.publications.length = 0;
      settle(h.requests[0], status);
      await pending;
      assert.deepEqual(h.rowsSnapshot(), before);
      assert.deepEqual(snapshotDom(h), dom);
      assert.equal(h.publications.length, 0);
      assert.equal(old.loading, false);
    }
  }
});

test('same operator may rotate tokens or retain refresh-only auth and publish the normal page', async () => {
  for (const rotated of [operator('synthetic-operator-a', { accessToken: 'synthetic-access-b', refreshToken: 'synthetic-refresh-b' }),
    { refreshToken: 'synthetic-refresh-only', user: { userId: 'synthetic-operator-a', adminPermissions: ['audit:read'],
      adminUser: { status: 'active', permissions: ['audit:read'] } } }]) {
    const h = harness();
    const pending = h.api.section();
    assert.equal(h.requests.length, 1);
    assertRequest(h.requests[0]);
    h.putPrimary(rotated);
    assert.equal(h.api.allowed('logs'), true);
    const item = event();
    h.requests[0].resolve(response({ items: [item] }));
    await pending;
    const current = h.context.sectionState.logs;
    assert.equal(current.rows.length, 1);
    assert.deepEqual(Array.from(current.rows[0]).slice(1), [item.actorUser.emailMasked, item.action, item.targetType, encode(item.reason)]);
    assert.equal(current.cursor, 'synthetic-next');
    assert.equal(current.hasMore, true);
    assert.equal(current.error, false);
    assert.equal(current.loading, false);
    assert.equal(h.more.classList.contains('is-hidden'), false);
    assert.ok(h.log.innerHTML.includes(encode(item.reason)));
    assert.doesNotMatch(h.log.innerHTML, /unselected-raw/);
  }
});

test('current audit-read viewer preserves server 401/403 clearing of rows and paging', async () => {
  for (const status of [401, 403]) {
    const h = harness({ auth: operator() });
    assert.equal(h.api.allowed('logs'), true);
    const pending = h.api.page(true);
    assert.equal(h.requests.length, 1, 'Client audit permission does not override current server rejection');
    assertRequest(h.requests[0], 'synthetic:cursor/+==');
    h.requests[0].reject(Object.assign(new Error('synthetic-denied'), { body: { statusCode: status } }));
    await pending;
    const current = h.context.sectionState.logs;
    assert.deepEqual(Array.from(current.rows), []);
    assert.equal(current.cursor, null);
    assert.equal(current.hasMore, false);
    assert.equal(current.error, true);
    assert.equal(current.loading, false);
    assert.match(h.log.innerHTML, /role="alert"/);
    assert.doesNotMatch(h.log.innerHTML, /masked-old|synthetic-existing-list/);
    assert.equal(h.more.classList.contains('is-hidden'), true);
  }
});

test('current 500 preserves rows/cursor and retries the same cursor, removing old inline error without duplicates', async () => {
  const h = harness();
  const original = h.context.sectionState.logs;
  const rows = original.rows;
  const before = plain(rows);
  const pending = h.api.page(true);
  assertRequest(h.requests[0], original.cursor);
  h.requests[0].reject(Object.assign(new Error('synthetic-500'), { status: 500 }));
  await pending;
  assert.equal(original.rows, rows);
  assert.deepEqual(plain(original.rows), before);
  assert.equal(original.cursor, 'synthetic:cursor/+==');
  assert.equal(original.hasMore, true);
  assert.equal(original.error, true);
  assert.equal(original.loading, false);
  assert.equal(h.log.children.length, 1);
  assert.equal(h.log.children[0].children[0].attributes.role, 'alert');
  assert.equal(h.log.children[0].children[0].colSpan, 5);
  assert.equal(h.more.classList.contains('is-hidden'), false);
  const retry = h.api.page(true);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].path, h.requests[0].path);
  assertRequest(h.requests[1], 'synthetic:cursor/+==');
  assert.equal(h.log.children.length, 0);
  h.requests[1].resolve(response({ hasMore: false, nextCursor: null }));
  await retry;
  assert.equal(original.rows.length, 2);
  assert.equal(original.rows[0], rows[0]);
  assert.equal(original.error, false);
  assert.equal(original.cursor, null);
  assert.equal(original.hasMore, false);
  assert.equal(original.loading, false);
  assert.equal(h.log.children.length, 0);
  assert.equal((h.log.innerHTML.match(/data-table-id="logRows"/g) || []).length, 2);
  assert.equal(h.more.classList.contains('is-hidden'), true);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function excerpt(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `Missing actual source: ${start}`);
  assert.equal(source.indexOf(start, from + start.length), -1, `Ambiguous source: ${start}`);
  return source.slice(from, to);
}
const constants = ['BACKSTAGE_AUTH_KEY', 'SHARED_AUTH_KEYS', 'BACKSTAGE_SECTION_KEY'].map(name => {
  const match = source.match(new RegExp(`^const ${name} = [^;\\r\\n]+;`, 'm'));
  assert(match, name); return match[0];
}).join('\n');
const runtime = [constants, 'let backstageAuthEpoch = 0;',
  excerpt('function getBackstageAuth(', 'function readDetailDrafts('),
  excerpt('function normalizeAuthPayload(', 'async function refreshBackstageAuthOnce('),
  excerpt('function applyAdminContext(', 'function loadGoogleSDK('),
  excerpt('function firstValue(', 'function splitTargetUsers('),
  excerpt('function currentAdminRoleName(', '// BEGIN creators-native-readonly-20261009'),
  excerpt('function syncCurrentAdminContext(', 'function canAccessBackstageSection('),
  excerpt('function canAccessBackstageSection(', 'function formatCount('),
  excerpt('function normalizePage(', 'function readSectionSearch('),
  excerpt('function adminApiPath(', 'async function verifyAdminAccess('),
  excerpt('function escapeHtml(', 'function firstRoleName('),
  excerpt('function statusBadge(', 'function renderSettlementChildren('),
  excerpt('function setLoadMore(', 'function renderFallbackNote('),
  excerpt('function backstageErrorStatus(', 'function backstageUserFacingError('),
  excerpt('async function loadAuditSection(', 'function loadSection('),
  excerpt('async function loadAdminsSection(', 'function renderUsersStatus('),
  'this.api = { section: loadAuditSection, page: loadAuditPage, allowed: canAccessBackstageSection,',
  '  visibility: applyPermissionVisibility, apply: applyAdminContext, auth: getBackstageAuth, setAuth: setBackstageAuth,',
  '  sync: syncCurrentAdminContext, admins: loadAdminsSection };',
].join('\n');

class Element {
  constructor(id = '') {
    this.id = id; this.children = []; this.dataset = {}; this.attributes = {}; this.classes = new Set();
    this.classList = { contains: value => this.classes.has(value), add: value => this.classes.add(value),
      remove: value => this.classes.delete(value), toggle: (value, enabled = !this.classes.has(value)) => {
        if (enabled) this.classes.add(value); else this.classes.delete(value);
      } };
    this.innerHTML = '';
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector(selector) {
    if (selector === '[data-admins-status]') return null;
    assert.equal(selector, '[data-audit-error]');
    return this.children.find(node => Object.hasOwn(node.dataset, 'auditError')) || null;
  }
}
const viewer = (permissions = ['audit:read'], extra = {}) => ({
  accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh',
  user: { id: 'synthetic-owner-a', adminUser: { id: 'synthetic-admin-a', status: 'active',
    roleName: 'accounting_admin', permissions }, ...extra },
});
const page = (label = 'new', extra = {}) => ({ items: [{ createdAt: '2026-10-09T01:00:00.000Z',
  actorUser: { emailMasked: 's***@example.invalid' }, action: `synthetic.${label}`,
  targetType: 'fixture', reason: 'safe & <text>' }], hasMore: true, nextCursor: 'synthetic:cursor/+==', ...extra });
const state = () => ({ rows: [['old-time', 'masked-old', 'synthetic.old', 'fixture', 'old-reason']],
  cursor: 'old:cursor/+==', hasMore: true, loading: false, error: false });
const failure = status => Object.assign(new Error('Synthetic audit failure'), { status });

// Actual auth/permission/menu/load/render functions; only storage, DOM and transport are synthetic.
function harness(auth = viewer(), automatic = null) {
  const storage = new Map(), requests = [];
  const table = new Element('logRows'), more = new Element(), dashboard = new Element(), main = new Element();
  main.setAttribute('data-active-section', 'logs'); table.innerHTML = 'synthetic-existing-table';
  const sections = ['overview', 'logs', 'admins'].map(id => new Element(id));
  const links = sections.map(section => { const node = new Element(); node.setAttribute('href', `#${section.id}`); return node; });
  const context = { URLSearchParams, dashboardView: dashboard, sectionState: { logs: state(), admins: { rows: [], auditRows: [] } },
    tableMeta: { logRows: { type: 'Synthetic audit', labels: ['time', 'actor', 'action', 'target', 'reason'] } },
    statusClassMap: {}, localHistoryRows: () => [], creatorsNativeIsTable: () => false,
    creatorsNativeReadonlyCurrent: () => false, syncCreatorsNativeReadonlyView: () => {},
    localizeAdminStatus: value => value, localizeAdminRole: value => value, formatDate: value => value || '-',
    summarizePermissions: value => JSON.stringify(value), formatAuditAction: value => value,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key) },
    document: {
      getElementById: id => id === 'logRows' ? table : sections.find(section => section.id === id) || null,
      querySelector: selector => {
        if (selector === '.dashboard-main') return main;
        assert.equal(selector, '[data-load-more="logs"]'); return more;
      },
      querySelectorAll: selector => {
        if (selector === '.sidebar-nav a') return links;
        if (selector === '.section-block') return sections;
        assert.equal(selector, '#admins .text-action, #adminRows .row-action'); return [];
      },
      createElement: () => new Element(),
    },
    backstageFetch: (path, options) => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ path, options, resolve, reject });
      if (automatic) resolve(typeof automatic === 'function' ? automatic(path) : automatic);
      return promise;
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:audit-permission-synthetic', timeout: 1000 });
  const put = value => {
    if (value == null) storage.delete('lumina_backstage_auth');
    else storage.set('lumina_backstage_auth', JSON.stringify(value));
  };
  put(auth);
  return { context, api: context.api, requests, table, more, dashboard, main, sections, links, put,
    snapshot: () => plain({ rows: context.sectionState.logs.rows, cursor: context.sectionState.logs.cursor,
      hasMore: context.sectionState.logs.hasMore, error: context.sectionState.logs.error,
      html: table.innerHTML, children: table.children.map(node => node.dataset) }) };
}
const assertRequest = (request, cursor = null) => {
  const query = new URL(request.path, 'https://synthetic.invalid');
  assert.equal(query.pathname, '/admin/api/v1/audit-events'); assert.equal(query.searchParams.get('take'), '20');
  assert.equal(query.searchParams.get('cursor'), cursor);
  assert.deepEqual(Object.keys(request.options).sort(), ['auth', 'isCurrent']);
  assert.equal(request.options.auth, true); assert.equal(typeof request.options.isCurrent, 'function');
  assert.equal(request.options.isCurrent(), true);
};

test('active accounting without audit rights never dispatches initial GET', async () => {
  const h = harness(viewer(['payments:read']), page());
  await h.api.section();
  assert.equal(h.requests.length, 0);
});

test('whole product source parses without mounting or accessing a real transport', () => {
  assert.doesNotThrow(() => new Script(source));
});

for (const permission of ['audit:read', 'audit:write', 'audit:*', '*']) {
  test(`active me grant ${permission} permits the actual logs menu`, () => {
    const h = harness(viewer([permission])); assert.equal(h.api.allowed('logs'), true);
    h.api.visibility(); assert.equal(h.links[1].classList.contains('is-hidden'), false);
  });
}
for (const permissions of [[], ['payments:read'], ['creators:read'], ['artists:write'], ['audit:delete'],
  ['audit'], ['audit:READ'], ['audit:read '], [' audit:read']]) {
  test(`unrelated or malformed grant ${JSON.stringify(permissions)} hides logs`, () => {
    const h = harness(viewer(permissions)); assert.equal(h.api.allowed('logs'), false);
    h.api.visibility(); assert.equal(h.links[1].classList.contains('is-hidden'), true);
    assert.equal(h.sections[1].classList.contains('is-permission-hidden'), true);
  });
}

test('role names and cached union aliases never manufacture an effective audit grant', () => {
  const h = harness(viewer([], { adminRole: 'super_admin', adminPermissions: ['*'], permissions: ['*'],
    roles: { admin: { permissions: ['*'] } } }));
  const auth = h.api.auth(); auth.user.adminUser.role = { name: 'super_admin', permissions: ['*'] }; h.put(auth);
  assert.equal(h.api.allowed('logs'), false); assert.equal(h.api.allowed('overview'), true);
});

test('invalid me status or permission array is closed even with a matching raw alias', async () => {
  for (const admin of [null, { status: 'active' }, { status: 'active', permissions: 'audit:read' },
    { status: 'active', permissions: ['audit:read', 1] }, { status: 'suspended', permissions: ['*'] },
    { status: 'revoked', permissions: ['*'] }, { permissions: ['*'] }]) {
    const h = harness(viewer([], { adminUser: admin, adminPermissions: ['*'] }), page());
    assert.equal(h.api.allowed('logs'), false); const before = h.snapshot(), original = h.context.sectionState.logs;
    await h.api.section(); await h.api.page(false);
    assert.equal(h.requests.length, 0); assert.equal(h.context.sectionState.logs, original);
    assert.deepEqual(h.snapshot(), before);
  }
});

test('actual me application replaces stale broad grants instead of reviving them', () => {
  const h = harness(viewer(['*']));
  h.api.apply({ user: { id: 'synthetic-owner-a' }, admin: { id: 'synthetic-admin-a', status: 'active',
    role: 'accounting_admin', permissions: ['payments:read'] } });
  assert.deepEqual(plain(h.api.auth().user.adminUser.permissions), ['payments:read']);
  assert.equal(h.api.allowed('logs'), false);
  h.api.apply({ admin: { status: 'active', role: 'super_admin', permissions: [] } });
  assert.equal(h.api.allowed('logs'), false);
});

test('bootstrap me with null admin id and a real star grant remains a normal permitted read', async () => {
  const h = harness();
  h.api.apply({ admin: { id: null, status: 'active', role: 'super_admin', permissions: ['*'],
    source: 'bootstrap_admin_emails' } });
  assert.equal(h.api.auth().user.adminUser.id, null); assert.equal(h.api.allowed('logs'), true);
  const pending = h.api.section(); assertRequest(h.requests[0]);
  h.requests[0].resolve(page('bootstrap')); await pending;
  assert.equal(h.context.sectionState.logs.rows.length, 1);
});

test('overview and unrelated legacy role/menu behavior stay unchanged', () => {
  const h = harness(null); assert.equal(h.api.allowed('overview'), true);
  assert.equal(h.api.allowed('logs'), false);
  const auth = viewer([]); auth.user.adminUser.roleName = 'super_admin'; h.put(auth);
  assert.equal(h.api.allowed('admins'), true); assert.equal(h.api.allowed('logs'), false);
});

test('denied initial and direct page admission preserve state and do not paint loading', async () => {
  for (const entry of ['section', 'page']) {
    const h = harness(viewer(['payments:read']), page()), before = h.snapshot(), original = h.context.sectionState.logs;
    await h.api[entry](false); assert.equal(h.requests.length, 0);
    assert.equal(h.context.sectionState.logs, original); assert.deepEqual(h.snapshot(), before);
    assert.equal(original.loading, false);
  }
});

test('current initial and append preserve GET cursor, masking, encoding and row identity', async () => {
  const h = harness(); const initial = h.api.section(); assert.equal(h.requests.length, 1);
  assertRequest(h.requests[0]); h.requests[0].resolve(page('first')); await initial;
  const row = h.context.sectionState.logs.rows[0], current = h.context.sectionState.logs;
  assert.equal(row[1], 's***@example.invalid'); assert.equal(row[4], 'safe &amp; &lt;text&gt;');
  const append = h.api.page(); assertRequest(h.requests[1], 'synthetic:cursor/+==');
  const duplicate = h.api.page(); await duplicate; assert.equal(h.requests.length, 2);
  h.requests[1].resolve(page('second', { hasMore: false, nextCursor: null })); await append;
  assert.equal(h.context.sectionState.logs, current); assert.equal(current.rows[0], row);
  assert.equal(current.rows.length, 2); assert.equal(current.cursor, null); assert.equal(current.hasMore, false);
  assert.equal(current.loading, false); assert.equal(h.more.classList.contains('is-hidden'), true);
  assert.doesNotMatch(h.table.innerHTML, /<text>/);
});

for (const status of [200, 403, 500]) {
  test(`permission revocation retires both commit and error publication ${status}`, async () => {
    const h = harness(), pending = h.api.page(); assert.equal(h.requests.length, 1);
    h.put(viewer(['payments:read'])); const before = h.snapshot();
    assert.equal(h.requests[0].options.isCurrent(), false);
    if (status === 200) h.requests[0].resolve(page('late')); else h.requests[0].reject(failure(status));
    await pending; assert.deepEqual(h.snapshot(), before); assert.equal(h.context.sectionState.logs.loading, false);
  });
  test(`a changed still-readable me grant snapshot retires old response ${status}`, async () => {
    const h = harness(viewer(['*'])), pending = h.api.page();
    h.put(viewer(['audit:read'])); const before = h.snapshot();
    assert.equal(h.api.allowed('logs'), true); assert.equal(h.requests[0].options.isCurrent(), false);
    if (status === 200) h.requests[0].resolve(page('old-grant')); else h.requests[0].reject(failure(status));
    await pending; assert.deepEqual(h.snapshot(), before);
  });
}

test('account, active-admin row, status, hidden tab and replaced-state guards stay current', async () => {
  for (const boundary of ['account', 'admin-row', 'status', 'logout', 'section', 'hidden', 'state']) {
    for (const status of [200, 500]) {
      const h = harness(), old = h.context.sectionState.logs, pending = h.api.page();
      if (boundary === 'account') h.put(viewer(['audit:read'], { id: 'synthetic-owner-b' }));
      if (boundary === 'admin-row') { const auth = h.api.auth(); auth.user.adminUser.id = 'synthetic-admin-b'; h.put(auth); }
      if (boundary === 'status') { const auth = h.api.auth(); auth.user.adminUser.status = 'revoked'; h.put(auth); }
      if (boundary === 'logout') h.put(null);
      if (boundary === 'section') h.main.setAttribute('data-active-section', 'overview');
      if (boundary === 'hidden') h.dashboard.classList.add('is-hidden');
      if (boundary === 'state') h.context.sectionState.logs = state();
      const before = h.snapshot(); assert.equal(h.requests[0].options.isCurrent(), false);
      if (status === 200) h.requests[0].resolve(page('stale')); else h.requests[0].reject(failure(status));
      await pending; assert.deepEqual(h.snapshot(), before); assert.equal(old.loading, false);
    }
  }
});

test('same me authority survives same-account token rotation and refresh-only storage', async () => {
  for (const accessToken of ['synthetic-new-access', null]) {
    const h = harness(), pending = h.api.page(); const auth = h.api.auth(); auth.accessToken = accessToken;
    auth.refreshToken = 'synthetic-new-refresh'; h.put(auth);
    assert.equal(h.requests[0].options.isCurrent(), true); h.requests[0].resolve(page('current')); await pending;
    assert.equal(h.context.sectionState.logs.rows.length, 2);
  }
});

function realTransport(h, fetch, refresh) {
  h.context.BACKSTAGE_API_BASE = 'https://synthetic.invalid';
  h.context.fetch = fetch; h.context.refreshBackstageAuthOnce = refresh;
  runInNewContext(excerpt('async function backstageFetch(', 'window.LuminaBackstageApi ='), h.context);
}

test('real transport callback rejects a retired 401 before refresh, JSON or replay', async () => {
  const h = harness(); let resolve, refreshes = 0, jsonReads = 0, fetches = 0;
  realTransport(h, () => { fetches++; return new Promise(yes => { resolve = yes; }); },
    () => { refreshes++; assert.fail('Retired audit must not refresh'); });
  const pending = h.api.page(); assert.equal(fetches, 1);
  h.put(viewer(['payments:read'])); const before = h.snapshot();
  resolve({ status: 401, ok: false, json: async () => { jsonReads++; return {}; } }); await pending;
  assert.equal(refreshes, 0); assert.equal(jsonReads, 0); assert.equal(fetches, 1);
  assert.deepEqual(h.snapshot(), before);
});

test('real transport callback rejects revocation during initial refresh before its first GET', async () => {
  const auth = viewer(); auth.accessToken = null;
  const h = harness(auth); let resolve, refreshes = 0, fetches = 0;
  realTransport(h, () => { fetches++; assert.fail('Revoked refreshed audit must not dispatch'); },
    () => { refreshes++; return new Promise(yes => { resolve = yes; }); });
  const pending = h.api.page(); assert.equal(refreshes, 1);
  h.put(viewer(['payments:read'])); const before = h.snapshot();
  resolve({ ...auth, accessToken: 'synthetic-refreshed' }); await pending;
  assert.equal(fetches, 0); assert.equal(h.api.allowed('logs'), false); assert.deepEqual(h.snapshot(), before);
});

test('real transport retains one same-account current 401 refresh and GET replay', async () => {
  const h = harness(), calls = []; let refreshes = 0;
  realTransport(h, async (url, options) => {
    calls.push({ url, options });
    return { status: calls.length === 1 ? 401 : 200, ok: calls.length !== 1, json: async () => page('refreshed') };
  }, async () => {
    refreshes++; const auth = h.api.auth(); auth.accessToken = 'synthetic-refreshed'; h.api.setAuth(auth); return auth;
  });
  await h.api.section(); assert.equal(refreshes, 1); assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://synthetic.invalid/admin/api/v1/audit-events?take=20');
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.body, undefined);
  }
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-refreshed');
  assert.equal(h.context.sectionState.logs.rows.length, 1); assert.equal(h.context.sectionState.logs.error, false);
});

for (const status of [401, 403]) {
  test(`current server ${status} clears audit rows and cursor without granting or repeating`, async () => {
    const h = harness(), pending = h.api.page(); h.requests[0].reject(failure(status)); await pending;
    const current = h.context.sectionState.logs;
    assert.equal(current.rows.length, 0); assert.equal(current.cursor, null); assert.equal(current.hasMore, false);
    assert.equal(current.error, true); assert.match(h.table.innerHTML, /role="alert"/);
    await h.api.page(); assert.equal(h.requests.length, 1);
  });
}

for (const error of [failure(500), new TypeError('Synthetic offline')]) {
  test(`current ${error.status || 'network'} failure preserves manual retry and has no automatic repeat`, async () => {
    const h = harness(), rows = h.context.sectionState.logs.rows, cursor = h.context.sectionState.logs.cursor;
    const pending = h.api.page(); h.requests[0].reject(error); await pending;
    assert.equal(h.context.sectionState.logs.rows, rows); assert.equal(h.context.sectionState.logs.cursor, cursor);
    assert.equal(h.requests.length, 1); assert(h.table.querySelector('[data-audit-error]'));
    const retry = h.api.page(); assert.equal(h.requests[1].path, h.requests[0].path);
    h.requests[1].resolve(page('retry', { hasMore: false, nextCursor: null })); await retry;
    assert.equal(h.table.querySelector('[data-audit-error]'), null); assert.equal(h.context.sectionState.logs.rows.length, 2);
  });
}

const rosterRow = (extra = {}) => ({ id: 'synthetic-admin-a', userId: 'synthetic-owner-a', status: 'active',
  user: { id: 'synthetic-owner-a', email: 'synthetic-current@example.invalid' },
  role: { name: 'super_admin', permissions: ['*'] }, ...extra });

test('roster follow-up: actual admins visit keeps authoritative me audit access', async () => {
  const row = rosterRow(); assert.equal(Object.hasOwn(row, 'permissions'), false);
  const auth = viewer(['*'], { email: row.user.email }); auth.user.adminUser.roleName = 'super_admin';
  const h = harness(auth, path => path === '/admin/api/v1/admin-users' ? [row] : []);
  const before = plain(h.api.auth()); h.main.setAttribute('data-active-section', 'admins');
  await h.api.admins(); assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests.map(request => request.path), ['/admin/api/v1/admin-users',
    '/admin/api/v1/admin-roles', '/admin/api/v1/audit-events?take=10&targetType=admin_user']);
  assert.equal(h.context.sectionState.admins.rows.length, 1);
  assert.equal(h.api.allowed('logs'), true);
  assert.deepEqual(plain(h.api.auth()), before);
  h.main.setAttribute('data-active-section', 'logs');
  const pending = h.api.section(); await pending;
  assert.equal(h.requests.length, 4); assertRequest(h.requests[3]);
});

test('roster follow-up: definitions never add authority or replace missing me', () => {
  for (const adminUser of [null, { id: 'synthetic-admin-a', status: 'active', permissions: [], roleName: 'accounting_admin' }]) {
    const h = harness(viewer([], { email: 'synthetic-current@example.invalid', adminUser, adminPermissions: ['*'] }));
    const before = plain(h.api.auth()); h.api.sync([rosterRow()]);
    assert.deepEqual(plain(h.api.auth()), before); assert.equal(h.api.allowed('logs'), false);
  }
});

test('roster follow-up: bootstrap null admin id survives a matching roster definition', () => {
  const h = harness(viewer(['*'], { email: 'synthetic-current@example.invalid' }));
  h.api.apply({ admin: { id: null, status: 'active', role: 'super_admin', permissions: ['*'], source: 'bootstrap_admin_emails' } });
  const before = plain(h.api.auth()); h.api.sync([rosterRow()]);
  assert.deepEqual(plain(h.api.auth()), before); assert.equal(h.api.auth().user.adminUser.id, null);
  assert.equal(h.api.allowed('logs'), true);
});

for (const status of [200, 500]) {
  test(`roster follow-up: synced roster keeps pending authority but a later me denial retires ${status}`, async () => {
    const h = harness(viewer(['*'], { email: 'synthetic-current@example.invalid' }));
    const pending = h.api.page(); assertRequest(h.requests[0], 'old:cursor/+==');
    h.api.sync([rosterRow()]); assert.equal(h.requests[0].options.isCurrent(), true);
    h.api.apply({ admin: { id: 'synthetic-admin-a', status: 'active', role: 'accounting_admin', permissions: ['payments:read'] } });
    const before = h.snapshot(); assert.equal(h.requests[0].options.isCurrent(), false);
    if (status === 200) h.requests[0].resolve(page('late-roster')); else h.requests[0].reject(failure(status));
    await pending; assert.deepEqual(h.snapshot(), before);
  });
}

for (const status of ['suspended', 'revoked']) {
  test(`authority follow-up: exact current roster ${status} denies without granting`, async () => {
    const h = harness();
    h.api.apply({ user: { id: 'synthetic-owner-a' }, admin: { id: 'synthetic-admin-a', status: 'active',
      role: 'accounting_admin', permissions: ['audit:read'] } });
    const before = plain(h.api.auth());
    h.api.sync([rosterRow({ status, permissions: ['*'], role: { name: 'super_admin', permissions: ['*'] } })]);
    assert.equal(h.api.allowed('logs'), false);
    assert.deepEqual(plain(h.api.auth()), {
      ...before, user: { ...before.user, adminUser: { ...before.user.adminUser, status } },
    });
    assert.equal(h.links[1].classList.contains('is-hidden'), true);
    await h.api.section(); await h.api.page(false);
    assert.equal(h.requests.length, 0);
    h.api.sync([rosterRow()]);
    assert.equal(h.api.auth().user.adminUser.status, status);
    assert.equal(h.api.allowed('logs'), false);
  });
}

test('authority follow-up: active, unrelated and bootstrap roster cannot replace me', () => {
  for (const row of [rosterRow(), rosterRow({ status: 'pending' }),
    rosterRow({ status: 'suspended', userId: 'synthetic-owner-b' }),
    rosterRow({ status: 'revoked', id: 'synthetic-admin-b' }),
    rosterRow({ status: 'suspended', userId: null }), null]) {
    const h = harness(), before = plain(h.api.auth()); h.api.sync([row]);
    assert.deepEqual(plain(h.api.auth()), before); assert.equal(h.api.allowed('logs'), true);
  }
  for (const adminUser of [null, { id: null, status: 'active', permissions: ['*'] }]) {
    const h = harness(viewer(['*'], { adminUser })), before = plain(h.api.auth());
    h.api.sync([rosterRow({ status: 'suspended' }), rosterRow({ id: null, status: 'revoked' })]);
    assert.deepEqual(plain(h.api.auth()), before);
    assert.equal(h.api.allowed('logs'), adminUser !== null);
  }
});

for (const status of [200, 500]) {
  test(`authority follow-up: exact roster denial retires a pending ${status} publication`, async () => {
    for (const denied of ['suspended', 'revoked']) {
      const h = harness(), pending = h.api.page();
      h.api.sync([rosterRow({ status: denied })]);
      const before = h.snapshot(); assert.equal(h.requests[0].options.isCurrent(), false);
      if (status === 200) h.requests[0].resolve(page('late-denied')); else h.requests[0].reject(failure(status));
      await pending; assert.deepEqual(h.snapshot(), before); assert.equal(h.context.sectionState.logs.loading, false);
    }
  });
}

// Both transport and refresh are real excerpts; the wire response has no /admin/me context.
function nativeRefreshTransport(h, fetch) {
  h.context.BACKSTAGE_API_BASE = 'https://synthetic.invalid'; h.context.fetch = fetch;
  runInNewContext([
    excerpt('function publicApiPath(', 'function adminApiPath('),
    excerpt('async function refreshBackstageAuthOnce(', 'function applyAdminContext('),
    excerpt('async function backstageFetch(', 'window.LuminaBackstageApi ='),
  ].join('\n'), h.context);
}
const nativeUser = { id: 'synthetic-owner-a', email: 'synthetic-current@example.invalid' };
const nativePayload = () => ({ user: { ...nativeUser }, accessToken: 'synthetic-rotated-access',
  refreshToken: 'synthetic-rotated-refresh' });
const wire = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

for (const mode of ['401', 'refresh-only']) {
  test(`authority follow-up: actual native ${mode} refresh closes missing me without audit replay`, async () => {
    const auth = viewer(); if (mode === 'refresh-only') auth.accessToken = null;
    const h = harness(auth), calls = [];
    nativeRefreshTransport(h, async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/auth/refresh')) return wire(200, nativePayload());
      assert.equal(mode, '401'); assert.equal(calls.length, 1);
      return wire(401, {});
    });
    await h.api.section();
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), mode === '401'
      ? ['/admin/api/v1/audit-events', '/api/v1/auth/refresh'] : ['/api/v1/auth/refresh']);
    assert.equal(calls.at(-1).options.method, 'POST');
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { refreshToken: 'synthetic-refresh' });
    assert.deepEqual(plain(h.api.auth().user), nativeUser);
    assert.equal(h.api.allowed('logs'), false); assert.equal(h.context.sectionState.logs.loading, false);
    assert.equal(h.context.sectionState.logs.error, true);
    assert.deepEqual(plain(h.context.sectionState.logs.rows), []);
    assert.equal(h.context.sectionState.logs.cursor, null); assert.equal(h.context.sectionState.logs.hasMore, false);
    assert.match(h.table.innerHTML, /role="alert"/);
    assert.match(h.table.innerHTML, /\uB2E4\uC2DC \uB85C\uADF8\uC778/);
    assert.match(h.table.innerHTML, /권한을 다시 확인/);
    assert.doesNotMatch(h.table.innerHTML, /세션이 만료/);
    assert.equal(h.more.classList.contains('is-hidden'), true);
    await h.api.page(); await h.api.section(); assert.equal(calls.length, mode === '401' ? 2 : 1);
  });
}

test('authority follow-up: actual native refresh clears old append rows and cursor', async () => {
  const h = harness(), calls = [];
  nativeRefreshTransport(h, async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/auth/refresh') ? wire(200, nativePayload()) : wire(401, {});
  });
  await h.api.page();
  assert.equal(calls.length, 2); assert.equal(h.context.sectionState.logs.error, true);
  assert.deepEqual(plain(h.context.sectionState.logs.rows), []);
  assert.equal(h.context.sectionState.logs.cursor, null); assert.equal(h.context.sectionState.logs.hasMore, false);
  assert.equal(h.context.sectionState.logs.loading, false);
  assert.match(h.table.innerHTML, /\uB2E4\uC2DC \uB85C\uADF8\uC778/);
});

test('authority follow-up: native refresh response cannot publish across retired owners or views', async () => {
  for (const boundary of ['account', 'logout', 'epoch', 'section', 'hidden', 'state', 'roster-denial']) {
    const h = harness(), old = h.context.sectionState.logs, calls = [];
    let resolve;
    nativeRefreshTransport(h, async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/auth/refresh') ? new Promise(yes => { resolve = yes; }) : wire(401, {});
    });
    const pending = h.api.page();
    for (let tick = 0; tick < 20 && !resolve; tick++) await Promise.resolve();
    assert.equal(typeof resolve, 'function', 'Actual refresh must reach the synthetic response gate');
    if (boundary === 'account') h.api.setAuth(viewer(['audit:read'], { id: 'synthetic-owner-b' }));
    if (boundary === 'logout') h.api.setAuth(null);
    if (boundary === 'epoch') { h.api.setAuth(null); h.api.setAuth(viewer()); }
    if (boundary === 'section') h.main.setAttribute('data-active-section', 'overview');
    if (boundary === 'hidden') h.dashboard.classList.add('is-hidden');
    if (boundary === 'state') h.context.sectionState.logs = state();
    if (boundary === 'roster-denial') h.api.sync([rosterRow({ status: 'revoked' })]);
    const before = h.snapshot(), authBefore = plain(h.api.auth());
    resolve(wire(200, nativePayload())); await pending;
    assert.deepEqual(h.snapshot(), before); assert.deepEqual(plain(h.api.auth()), authBefore);
    assert.equal(old.loading, false); assert.equal(calls.length, 2);
  }
});

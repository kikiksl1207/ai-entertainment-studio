import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.env.BACKSTAGE_ADMINS_TEST_SOURCE || new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const actorA = '10000000-0000-4000-8000-000000000001';
const actorB = '10000000-0000-4000-8000-000000000002';
const emailA = 'synthetic-operator-a@example.invalid';
const emailB = 'synthetic-operator-b@example.invalid';
const paths = ['/admin/api/v1/admin-users', '/admin/api/v1/admin-roles', '/admin/api/v1/audit-events'];

export function sourceExcerpts(text = source) {
  const anchors = [
    ['constants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
    ['selection', 'let selectedDetail =', 'const sectionState ='],
    ['statusClasses', 'const statusClassMap = {', 'const backstageRows = {'],
    ['tableMeta', 'const tableMeta = {', 'const sectionLoaders = {'],
    ['authAndSection', 'function getBackstageAuth(', 'function readDetailDrafts('],
    ['localHistory', 'function readActionHistory(', 'function setStatus('],
    ['loginStatus', 'function setStatus(', 'function setLoading('],
    ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
    ['normalizeRefresh', 'function normalizeAuthPayload(', 'function applyAdminContext('],
    ['paths', 'function publicApiPath(', 'async function verifyAdminAccess('],
    ['rows', 'function statusBadge(', 'function renderSettlementChildren('],
    ['page', 'function normalizePage(', 'function readSectionSearch('],
    ['loadingErrorFallback', 'function setLoadMore(', 'function artistKnowledgeQueueErrorMessage('],
    ['historyTime', 'function formatHistoryTime(', 'function renderDetailHistory('],
    ['firstValue', 'function firstValue(', 'function splitTargetUsers('],
    ['escape', 'function escapeHtml(', 'function firstRoleName('],
    ['allTableFallback', 'function renderBackstageTables(', 'function setActiveSection('],
    ['contextPermissions', 'function currentAdminRoleName(', 'function formatCount('],
    ['date', 'function formatDate(', 'function krw('],
    ['adminFormatters', 'function localizeAdminRole(', 'function localizeWorkflowStatus('],
    ['adminsLoader', 'async function loadAdminsSection(', 'function renderUsersStatus('],
    ['closeConfirm', 'function closeConfirmModal(', 'async function runPreparedAction('],
    ['showLogin', 'function showLogin(', 'function showDashboard('],
    ['logout', 'logoutButton.addEventListener("click", () => {', 'refreshButton.addEventListener('],
  ];
  return anchors.map(([name, start, end]) => {
    const from = text.indexOf(start); const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing actual source: ${name}`);
    const body = text.slice(from, to);
    return { name, start, end, line: text.slice(0, from).split('\n').length,
      sha256: createHash('sha256').update(body).digest('hex'), body };
  });
}
const excerpts = sourceExcerpts();
const runtime = excerpts.map(item => item.body).join('\n') + `
let userClassificationDetail = null;
this.api = { load: loadAdminsSection, auth: getBackstageAuth, setAuth: setBackstageAuth,
  canAccess: canAccessBackstageSection, permissions: currentAdminPermissions, norm: normalizePage };
`;

class Element {
  constructor() {
    this.dataset = {}; this.children = []; this.classes = new Set(); this.attributes = new Map();
    this.listeners = new Map(); this.disabled = false; this.hidden = false; this.value = '';
    this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name),
      remove: name => this.classes.delete(name), toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name); return force;
      } };
  }
  set textContent(value) { this.text = String(value); this.html = ''; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) { this.html = String(value); this.text = ''; this.children = []; }
  get innerHTML() { return this.html || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children.map(child => {
    if (typeof child !== 'string') return child;
    const node = new Element(); node.textContent = child; return node;
  })); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { assert.ok(this.listeners.has('click')); this.listeners.get('click')({ target: this }); }
  querySelector(selector) {
    if (selector === '.section-title') return this.heading;
    const match = selector.match(/^\[data-([\w-]+)\]$/);
    assert.ok(match, `Unmodeled node selector: ${selector}`);
    const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    return this.children.find(child => key in child.dataset) || null;
  }
}

function data(prefix = 'healthy') {
  return { users: [actorA, actorB].map((userId, index) => ({ id: `${prefix}-admin-${index}`, userId,
    user: { id: userId, email: index ? emailB : emailA }, role: { name: 'super_admin', permissions: ['*'] },
    status: 'active', updatedAt: '2026-10-05T01:00:00.000Z' })),
  roles: [{ name: 'super_admin', permissions: ['*'] }],
  events: { items: [
    { id: `${prefix}-audit-masked`, action: 'admin_user.update', targetType: 'admin_user',
      actorUser: { emailMasked: 's***@example.invalid' }, actorUserId: actorA },
    { id: `${prefix}-audit-id`, action: 'admin_user.create', targetType: 'admin_user', actorUserId: 'synthetic-actor-id' },
    { id: `${prefix}-audit-system`, action: 'admin_user.create', targetType: 'admin_user', actorUser: null },
  ], hasMore: false } };
}

function harness() {
  const storage = new Map(); const tokens = new Map(); const calls = []; const warnings = [];
  const targets = [...new Set([...excerpts.find(item => item.name === 'allTableFallback').body
    .matchAll(/render(?:Rows|LoadingRow)\("([^"]+)"/g)].map(match => match[1]))];
  const tables = Object.fromEntries(targets.map(id => { const node = new Element();
    node.innerHTML = `<tr><td>synthetic-live-${id}</td></tr>`; return [id, node]; }));
  const nodes = Object.fromEntries(['dashboardView', 'loginView', 'logoutButton', 'passwordInput', 'loginStatus',
    'googleButtonFallback', 'operatorEmail', 'detailPanel', 'detailType', 'detailTitle', 'detailList', 'detailMemo',
    'detailHistoryList', 'detailForm', 'confirmModal', 'confirmType', 'confirmTitle', 'confirmMessage', 'confirmPayload',
    'usersClassificationFilter', 'usersStatus', 'more'].map(id => [id, new Element()]));
  nodes.loginView.classList.add('is-hidden'); nodes.detailPanel.classList.add('is-hidden');
  nodes.confirmModal.classList.add('is-hidden');
  const dashboardMain = new Element(); dashboardMain.setAttribute('data-active-section', 'admins');
  const sections = Object.fromEntries(['admins', 'users', 'overview'].map(id => {
    const section = new Element(); section.id = id; section.heading = new Element();
    section.heading.after = node => section.append(node); return [id, section];
  }));
  sections.users.append(Object.assign(nodes.usersStatus, { dataset: { usersStatus: '' } }));
  const links = Object.keys(sections).map(id => { const link = new Element(); link.setAttribute('href', `#${id}`); return link; });
  const adminButtons = [new Element(), new Element()];
  const sampleRows = Object.fromEntries(['admins', 'adminRequests', 'overviewQueue', 'risk', 'creators', 'creatorImageRequests',
    'aiCreators', 'contentAnomalies', 'reportCancels', 'studioSettlement', 'settlement', 'settlementConversions', 'aiSettlement', 'logs']
    .map(key => [key, [[`SYNTHETIC-SAMPLE-${key}`, 'synthetic', 'active', 'synthetic', 'synthetic', 'Read']]]));
  const context = { ...nodes,
    window: { LUMINA_API_BASE: 'https://synthetic.invalid' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key) },
    document: {
      createElement: () => new Element(),
      getElementById: id => sections[id] || tables[id] || nodes[id] || null,
      querySelector(selector) {
        if (selector === '.dashboard-main') return dashboardMain;
        if (selector === '[data-load-more="users"]') return nodes.more;
        assert.fail(`Unmodeled document selector: ${selector}`);
      },
      querySelectorAll(selector) {
        if (selector === '#creators .text-action') return [];
        if (selector === '.sidebar-nav a') return links;
        if (selector === '.section-block') return Object.values(sections);
        if (selector === '#admins .text-action, #adminRows .row-action') return adminButtons;
        if (selector === 'tr.is-selected') return [];
        assert.fail(`Unmodeled document selector list: ${selector}`);
      },
    },
    sectionState: { admins: { rows: [], auditRows: [] }, users: { rows: [], riskRows: [] } },
    backstageRows: sampleRows,
    console: { warn: (...args) => warnings.push(plain(args)) },
    prepareGoogleLoginButton() { return Promise.reject(new Error('Synthetic unavailable provider; no network')); },
    fetch(url, options) {
      const parsed = new URL(url); assert.equal(parsed.origin, 'https://synthetic.invalid');
      assert.ok(paths.includes(parsed.pathname), 'Only the three existing read routes are allowlisted');
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
      const bearer = options.headers.Authorization || null;
      if (bearer) assert.ok(tokens.has(bearer), 'Only registered synthetic bearer tokens can reach RAM transport');
      if (parsed.pathname === paths[2]) {
        assert.equal(parsed.searchParams.get('take'), '10'); assert.equal(parsed.searchParams.get('targetType'), 'admin_user');
      }
      return new Promise((resolve, reject) => calls.push({ url, path: parsed.pathname, options, bearer, responded: false,
        respond(body, status = 200) { assert.equal(this.responded, false); this.responded = true;
          resolve({ status, ok: status >= 200 && status < 300, json: async () => plain(body) }); },
        reject(error) { assert.equal(this.responded, false); this.responded = true; reject(error); },
      }));
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-admins-session-recovery' });
  const api = context.api;
  const setAuth = (actor = actorA, token = 'synthetic-a', permissions = ['*']) => {
    const auth = { accessToken: token, user: { id: actor, email: actor === actorA ? emailA : emailB, adminPermissions: permissions } };
    if (token) tokens.set(`Bearer ${token}`, actor); api.setAuth(auth); return auth;
  };
  setAuth();
  const h = { context, api, storage, calls, tables, nodes, dashboardMain, sections, warnings, setAuth,
    get state() { return context.sectionState.admins; },
    begin() {
      const count = calls.length; const pending = api.load(); return { pending, calls: calls.slice(count) };
    },
    async finish(operation, fixture = data(), failures = {}) {
      assert.equal(operation.calls.length, 3, 'A healthy initial request must actually dispatch the triple');
      for (const call of operation.calls) {
        const key = paths.indexOf(call.path); const failure = failures[key];
        if (failure instanceof Error) call.reject(failure);
        else call.respond([fixture.users, fixture.roles, fixture.events][key], failure || 200);
      }
      await operation.pending; await tick();
    },
    async seed() {
      const operation = h.begin(); await h.finish(operation);
      assert.equal(h.state.rows.length, 2); assert.equal(h.state.auditRows.length, 3);
      assert.match(tables.adminRows.innerHTML, /synthetic-operator-a/);
      assert.equal(api.auth().user.adminUser.id, 'healthy-admin-0', 'Actual context sync must be active, not stubbed');
    },
    logout(shared = false) {
      if (shared) storage.set('lumina_auth', JSON.stringify(api.auth()));
      nodes.logoutButton.click();
      assert.equal(nodes.dashboardView.classList.contains('is-hidden'), true);
      assert.equal(nodes.loginView.classList.contains('is-hidden'), false);
      assert.equal(storage.has('lumina_backstage_auth'), false);
      assert.equal(Boolean(api.auth()), shared);
    },
  };
  return h;
}

function unrelated(h) { return Object.fromEntries(Object.entries(h.tables)
  .filter(([id]) => !['adminRows', 'adminRequestRows'].includes(id)).map(([id, node]) => [id, node.innerHTML])); }
function snapshot(h) {
  return plain({ state: h.state, auth: h.api.auth(), rows: h.tables.adminRows.innerHTML, audit: h.tables.adminRequestRows.innerHTML,
    note: h.sections.admins.querySelector('[data-admins-status]')?.textContent || '',
    unrelated: unrelated(h), warnings: h.warnings });
}
function cachedData(h) { return plain({ rows: h.state.rows, auditRows: h.state.auditRows }); }
function assertNoSamples(h) { assert.doesNotMatch(Object.values(h.tables).map(node => node.innerHTML).join('\n'), /SYNTHETIC-SAMPLE-/); }

test('ADMINS-READ-01 actual triple routes/normalization/context and masked audit fallbacks preserve healthy contract', async () => {
  const h = harness(); const before = unrelated(h); const operation = h.begin();
  assert.deepEqual(operation.calls.map(call => call.path), paths); await h.finish(operation);
  assert.equal(h.state.rows.length, 2); assert.equal(h.state.auditRows.length, 3);
  assert.equal(h.api.auth().user.adminUser.id, 'healthy-admin-0');
  assert.deepEqual(plain(h.state.auditRows.map(row => row[4])), ['s***@example.invalid', 'syntheti', 'system']);
  assert.equal(h.state.rows[0].meta.userId, actorA); assert.deepEqual(plain(h.state.rows[0].meta.permissions), ['*']);
  assert.match(h.tables.adminRows.innerHTML, /data-detail=/); assertNoSamples(h);
  assert.deepEqual(unrelated(h), before);
});

test('ADMINS-READ-02 optional non-auth failure is explicit and never replaces audit history with role definitions', async () => {
  for (const unavailable of ['audit', 'roles']) {
    const h = harness(); const operation = h.begin(); const fixture = data();
    if (unavailable === 'audit') { await h.finish(operation, fixture, { 2: 404 });
      assert.equal(h.state.auditRows.length, 0);
      assert.match(h.tables.adminRequestRows.innerHTML, /확인하지 못/);
      assert.doesNotMatch(h.tables.adminRequestRows.innerHTML, /ROLE-|최근 운영자 권한 이력이 없습니다/); }
    else { await h.finish(operation, fixture, { 1: 404 }); assert.equal(h.state.auditRows.length, 3); }
    assert.equal(h.state.rows.length, 2); assertNoSamples(h);
    assert.equal(h.state.error, true);
    assert.match(h.sections.admins.querySelector('[data-admins-status]')?.textContent || '', /갱신하지 못/);
  }
});

test('ADMINS-READ-03 same-actor token rotation accepts current triple and preserves the rotated auth', async () => {
  const h = harness(); const operation = h.begin(); h.setAuth(actorA, 'synthetic-a-rotated');
  await h.finish(operation);
  assert.equal(h.state.rows.length, 2); assert.equal(h.api.auth().accessToken, 'synthetic-a-rotated');
  assert.equal(h.api.auth().user.id, actorA);
});

for (const [id, missing] of [['04', 'permission'], ['05', 'session/token'], ['06', 'id']]) {
  test(`ADMINS-READ-${id} initial missing ${missing} dispatches zero requests`, async () => {
    for (const condition of missing === 'session/token' ? ['session', 'token'] : [missing]) {
    const h = harness();
    if (condition === 'permission') { h.setAuth(actorA, 'synthetic-a', ['audit:read']); assert.equal(h.api.canAccess('admins'), false); }
    if (condition === 'session') { h.api.setAuth(null); assert.equal(h.api.auth(), null); }
    if (condition === 'token') h.setAuth(actorA, null);
    if (condition === 'id') { h.api.setAuth({ accessToken: 'synthetic-a', user: { adminPermissions: ['*'], email: emailA } }); }
    const before = snapshot(h); const operation = h.begin();
    // Settle any erroneous original dispatch without calling an external service.
    if (operation.calls.length) await h.finish(operation, data('unauthorized'));
    else await operation.pending;
    assert.equal(operation.calls.length, 0, 'Guard before any network attempt or list mutation');
    assert.deepEqual(snapshot(h), before);
    }
  });
}

const invalidations = ['logout', 'shared-hidden', 'different-actor', 'menu', 'replaced-state', 'permission-revoked'];
for (const [index, invalidation] of invalidations.entries()) {
  test(`ADMINS-READ-${String(index + 7).padStart(2, '0')} late success after ${invalidation} cannot publish state/auth/DOM`, async () => {
    const h = harness(); await h.seed();
    assert.equal(h.api.canAccess('admins'), true); assert.equal(h.nodes.dashboardView.classList.contains('is-hidden'), false);
    assert.equal(h.dashboardMain.getAttribute('data-active-section'), 'admins');
    const operation = h.begin(); assert.equal(operation.calls.length, 3, 'Never invalidate before initial dispatch');
    if (invalidation === 'logout') h.logout();
    if (invalidation === 'shared-hidden') { h.logout(true); assert.equal(h.api.auth().user.id, actorA); }
    if (invalidation === 'different-actor') h.setAuth(actorB, 'synthetic-b');
    if (invalidation === 'menu') h.dashboardMain.setAttribute('data-active-section', 'overview');
    if (invalidation === 'replaced-state') h.context.sectionState.admins = { rows: [{ row: ['synthetic-new-state'] }], auditRows: [] };
    if (invalidation === 'permission-revoked') { h.setAuth(actorA, 'synthetic-a', ['audit:read']); assert.equal(h.api.canAccess('admins'), false); }
    const before = snapshot(h); await h.finish(operation, data('obsolete'));
    assert.deepEqual(snapshot(h), before, 'Captured state, actor, active menu, visibility and current read access must all still match');
    assertNoSamples(h);
  });
}

for (const status of [200, 500]) {
  test(`ADMINS-READ-${status === 200 ? '13' : '14'} older ${status} cannot overwrite a completed newer query`, async () => {
    const h = harness(); const older = h.begin(); const newer = h.begin();
    await h.finish(newer, data('newer')); const before = snapshot(h);
    assert.equal(h.api.auth().user.adminUser.id, 'newer-admin-0', 'Newer actual context is established first');
    await h.finish(older, data('older'), status === 500 ? { 0: 500 } : {});
    assert.deepEqual(snapshot(h), before); assertNoSamples(h);
  });
}

test('ADMINS-READ-15 late primary 500 after actual shared-fallback logout cannot restore any sample table', async () => {
  const h = harness(); await h.seed(); const operation = h.begin(); h.logout(true);
  const before = snapshot(h); await h.finish(operation, data('obsolete-error'), { 0: 500 });
  assert.deepEqual(snapshot(h), before); assertNoSamples(h);
});

for (const [id, endpoint, status] of [['16', 0, 401], ['17', 0, 403]]) {
  test(`ADMINS-READ-${id} current ${paths[endpoint]} ${status} clears protected rows without unrelated fallback`, async () => {
    const h = harness(); await h.seed(); const before = unrelated(h); const operation = h.begin();
    await h.finish(operation, data('denied'), { [endpoint]: status });
    assert.deepEqual(cachedData(h), { rows: [], auditRows: [] }, 'An authorization denial is not an optional role/audit fallback');
    assert.doesNotMatch(h.tables.adminRows.innerHTML + h.tables.adminRequestRows.innerHTML, /synthetic-operator-|s\*\*\*@example\.invalid|data-detail=/);
    assert.deepEqual(unrelated(h), before); assertNoSamples(h);
    assert.equal(h.calls.length, 6, 'No automatic list retry');
    assert.match(h.sections.admins.querySelector('[data-admins-status]')?.textContent || '', /권한/);
  });
}

for (const [id, endpoint, status] of [['18', 1, 403], ['19', 2, 401]]) {
  test(`ADMINS-READ-${id} optional ${paths[endpoint]} ${status} exposes denial without invented audit rows`, async () => {
    const h = harness(); const before = unrelated(h); const operation = h.begin();
    await h.finish(operation, data('optional-unavailable'), { [endpoint]: status });
    assert.equal(h.state.rows.length, 2);
    if (endpoint === 1) assert.equal(h.state.auditRows.length, 3);
    else assert.equal(h.state.auditRows.length, 0);
    assert.equal(h.state.error, true);
    assert.match(h.sections.admins.querySelector('[data-admins-status]')?.textContent || '', /조회 권한/);
    assert.doesNotMatch(h.tables.adminRequestRows.innerHTML, /ROLE-/);
    assert.deepEqual(unrelated(h), before); assertNoSamples(h); assert.equal(h.calls.length, 3);
  });
}

test('ADMINS-READ-20 current primary 500 preserves actual cached lists and only an explicit requery replaces them', async () => {
  const h = harness(); await h.seed(); const beforeData = cachedData(h); const beforeOther = unrelated(h);
  const operation = h.begin(); await h.finish(operation, data('failed'), { 0: 500 });
  assert.deepEqual(cachedData(h), beforeData, 'Preserve actual loaded rows/audit data, not static sample data or emptied state');
  assert.match(h.tables.adminRows.innerHTML, /synthetic-operator-a/); assert.match(h.tables.adminRequestRows.innerHTML, /s\*\*\*@example\.invalid/);
  assert.deepEqual(unrelated(h), beforeOther); assertNoSamples(h); assert.equal(h.calls.length, 6);
  assert.match(h.sections.admins.querySelector('[data-admins-status]')?.textContent || '', /갱신하지 못/);
  const manual = h.begin(); assert.equal(h.calls.length, 9, 'Only this explicit call dispatches the next triple');
  await h.finish(manual, data('manual-requery'));
  assert.equal(h.api.auth().user.adminUser.id, 'manual-requery-admin-0'); assert.equal(h.state.rows[0].meta.adminUserId, 'manual-requery-admin-0');
  assert.equal(h.sections.admins.querySelector('[data-admins-status]')?.textContent || '', '');
  assert.deepEqual(unrelated(h), beforeOther); assertNoSamples(h);
});

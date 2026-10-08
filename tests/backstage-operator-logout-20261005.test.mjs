import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.env.BACKSTAGE_OPERATOR_LOGOUT_SOURCE || new URL('../backstage.js', import.meta.url), 'utf8');
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
        if (selector === '.sidebar-nav a') return links;
        if (selector === '.section-block') return Object.values(sections);
        if (selector === '#admins .text-action, #adminRows .row-action') return adminButtons;
        if (selector === 'tr.is-selected') return [];
        if (selector === '#creators .text-action') return [];
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


const operatorObservations = [];
const operatorSourceHash = createHash('sha256').update(source).digest('hex');
const operatorView = h => ({
  rowCount: h.state.rows.length, auditCount: h.state.auditRows.length,
  rows: h.tables.adminRows?.innerHTML || '', audit: h.tables.adminRequestRows?.innerHTML || '',
  owner: h.context.operatorEmail?.textContent || '',
  dashboardHidden: h.nodes.dashboardView.classList.contains('is-hidden'),
  loginHidden: h.nodes.loginView.classList.contains('is-hidden'),
  requestCount: h.calls.length,
  note: h.sections.admins.querySelector('[data-admins-status]')?.textContent || '',
});
async function loadedOperatorHarness() {
  const h = harness();
  await h.seed();
  h.nodes.operatorEmail.textContent = emailA;
  return h;
}
function operatorCleanup(h, previous) {
  const surfaces = ['adminRows', 'adminRequestRows'].map(id => h.tables[id]?.innerHTML || '');
  return {
    freshState: h.state !== previous,
    rowsEmpty: h.state.rows.length === 0,
    auditEmpty: h.state.auditRows.length === 0,
    noAccountHtml: surfaces.every(html => !/data-detail=|synthetic-operator-|s\*\*\*@example\.invalid|healthy-audit/.test(html)),
    promptOnly: surfaces.every(html => (html.match(/<tr\b/g) || []).length === 1),
    ownerEmpty: h.context.operatorEmail?.textContent === '',
    dashboardHidden: h.nodes.dashboardView.classList.contains('is-hidden'),
    loginShown: !h.nodes.loginView.classList.contains('is-hidden'),
  };
}
after(() => {
  if (!process.env.BACKSTAGE_OPERATOR_LOGOUT_EVIDENCE) return;
  writeFileSync(process.env.BACKSTAGE_OPERATOR_LOGOUT_EVIDENCE, JSON.stringify({
    sourceHash: operatorSourceHash,
    sourceExcerpts: sourceExcerpts(source).map(({body, ...metadata}) => metadata),
    observations: operatorObservations,
    scope: 'Actual showLogin, logout listener and pending admins loader with modeled DOM and RAM transport',
    limits: ['No real browser, server, database, JWT/provider logout or production proof',
      'Visibility-only reopen with unchanged auth isolates the admin-state identity guard'],
  }, null, 2) + '\n', {flag: 'wx'});
});

test('OPERATOR-LOGOUT-01 actual showLogin and logout listener clear loaded admin RAM, hidden DOM and owner label', async () => {
  const results = [];
  for (const entry of ['showLogin', 'logout-listener']) {
    const h = await loadedOperatorHarness(); const previous = h.state; const before = operatorView(h);
    const authBefore = JSON.stringify(h.api.auth());
    if (entry === 'showLogin') h.context.showLogin();
    else h.logout();
    if (entry === 'showLogin') assert.equal(JSON.stringify(h.api.auth()), authBefore);
    else { assert.equal(h.api.auth(), null); assert.equal(h.nodes.passwordInput.value, ''); }
    const result = {entry, ...operatorCleanup(h, previous)};
    operatorObservations.push({condition: 'loaded-admin-cleanup', entry, before, after: operatorView(h), checks: result});
    results.push(result);
  }
  assert.deepEqual(results, ['showLogin', 'logout-listener'].map(entry => ({
    entry, freshState: true, rowsEmpty: true, auditEmpty: true, noAccountHtml: true,
    promptOnly: true, ownerEmpty: true, dashboardHidden: true, loginShown: true,
  })));
});

test('OPERATOR-LOGOUT-02 replacement invalidates pending old-state success and failure without republishing', async () => {
  const results = [];
  for (const status of [200, 500]) {
    const h = await loadedOperatorHarness();
    const authBefore = JSON.stringify(h.api.auth());
    const operation = h.begin(); const oldState = h.state;
    assert.equal(operation.calls.length, 3);
    h.context.showLogin();
    // Reopen only presentation; identity, permission and active menu stay unchanged.
    h.nodes.dashboardView.classList.remove('is-hidden');
    h.nodes.loginView.classList.add('is-hidden');
    assert.equal(JSON.stringify(h.api.auth()), authBefore);
    assert.equal(h.dashboardMain.getAttribute('data-active-section'), 'admins');
    const current = h.state; const before = snapshot(h);
    await h.finish(operation, data('obsolete-after-show-login'), status === 500 ? {0: 500} : {});
    const result = {
      status, freshState: current !== oldState, sameCurrentState: h.state === current,
      noRepublish: JSON.stringify(snapshot(h)) === JSON.stringify(before),
      rowsEmpty: h.state.rows.length === 0, auditEmpty: h.state.auditRows.length === 0,
      ownerEmpty: h.nodes.operatorEmail.textContent === '',
    };
    operatorObservations.push({condition: 'pending-old-state', status, checks: result, after: operatorView(h)});
    results.push(result);
  }
  assert.deepEqual(results, [200, 500].map(status => ({
    status, freshState: true, sameCurrentState: true, noRepublish: true,
    rowsEmpty: true, auditEmpty: true, ownerEmpty: true,
  })));
});

test('OPERATOR-LOGOUT-03 absent optional owner and operator table nodes are safe while RAM still clears', async () => {
  const results = [];
  for (const absent of [null, undefined]) {
    const h = await loadedOperatorHarness(); const previous = h.state;
    // Actual DOM lookup absence leaves declared optional bindings null/falsy.
    h.context.operatorEmail = absent;
    h.context.detailPanel = null;
    for (const key of ['detailType', 'detailTitle', 'detailList', 'detailMemo', 'detailHistoryList', 'detailForm']) {
      h.context[key] = null;
    }
    delete h.tables.adminRows;
    delete h.tables.adminRequestRows;
    assert.equal(h.context.document.getElementById('adminRows'), null);
    assert.equal(h.context.document.getElementById('adminRequestRows'), null);
    assert.doesNotThrow(() => h.context.showLogin());
    const result = {
      absence: absent === null ? 'null' : 'undefined',
      freshState: h.state !== previous,
      rowsEmpty: h.state.rows.length === 0, auditEmpty: h.state.auditRows.length === 0,
      dashboardHidden: h.nodes.dashboardView.classList.contains('is-hidden'),
      loginShown: !h.nodes.loginView.classList.contains('is-hidden'),
    };
    operatorObservations.push({condition: 'optional-dom-absence', checks: result});
    results.push(result);
  }
  assert.deepEqual(results, ['null', 'undefined'].map(absence => ({
    absence, freshState: true, rowsEmpty: true, auditEmpty: true, dashboardHidden: true, loginShown: true,
  })));
});

test('OPERATOR-LOGOUT-04 drafts, action history and unrelated state/data survive both actual entry points', async () => {
  const results = [];
  for (const entry of ['showLogin', 'logout-listener']) {
    const h = await loadedOperatorHarness();
    const keys = ['lumina_backstage_detail_drafts', 'lumina_backstage_action_history', 'synthetic-unrelated-persistent'];
    for (const key of keys) h.storage.set(key, JSON.stringify({key, value: 'synthetic-retained-record'}));
    const saved = Object.fromEntries(keys.map(key => [key, h.storage.get(key)]));
    const states = {};
    for (const key of ['overview', 'creators', 'logs']) {
      states[key] = h.context.sectionState[key] = { rows: [['synthetic-kept-' + key]], cursor: 'kept-' + key };
    }
    const stateData = plain(states);
    const others = Object.fromEntries(Object.entries(h.tables)
      .filter(([id]) => !['adminRows', 'adminRequestRows', 'userRows', 'userRiskRows'].includes(id))
      .map(([id, node]) => [id, node.innerHTML]));
    if (entry === 'showLogin') h.context.showLogin();
    else h.logout();
    const result = {
      entry, persistedRecords: keys.every(key => h.storage.get(key) === saved[key]),
      stateIdentity: Object.entries(states).every(([key, value]) => h.context.sectionState[key] === value),
      stateData: JSON.stringify(plain(Object.fromEntries(Object.keys(states).map(key => [key, h.context.sectionState[key]])))) === JSON.stringify(stateData),
      unrelatedDom: Object.entries(others).every(([id, html]) => h.tables[id].innerHTML === html),
    };
    operatorObservations.push({condition: 'retained-records-and-unrelated-state', checks: result});
    results.push(result);
  }
  assert.deepEqual(results, ['showLogin', 'logout-listener'].map(entry => ({
    entry, persistedRecords: true, stateIdentity: true, stateData: true, unrelatedDom: true,
  })));
});


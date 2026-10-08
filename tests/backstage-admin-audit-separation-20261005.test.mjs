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


import { after } from 'node:test';
import { writeFileSync } from 'node:fs';

const separationObservations = [];
const noRole = value => !/ROLE-\d+|권한 기준/.test(value);
const errorWords = /실패|오류|못했습니다|다시 조회/;
const noteText = h => h.sections.admins.textContent;
const historyHtml = h => h.tables.adminRequestRows.innerHTML;
const rowsPlain = h => plain(h.state.auditRows);
const same = (left, right) => JSON.stringify(plain(left)) === JSON.stringify(plain(right));

function retainUnrelated(h) {
  const keys = ['lumina_backstage_detail_drafts', 'lumina_backstage_action_history', 'synthetic-separation-retained'];
  for (const key of keys) h.storage.set(key, JSON.stringify({key, value: 'synthetic-retained'}));
  const saved = Object.fromEntries(keys.map(key => [key, h.storage.get(key)]));
  const states = {};
  for (const key of ['users', 'overview', 'creators', 'logs']) {
    states[key] = h.context.sectionState[key] = { rows: [['synthetic-kept-' + key]], cursor: 'kept' };
  }
  const dataBefore = plain(states);
  const domBefore = unrelated(h);
  return () => keys.every(key => h.storage.get(key) === saved[key])
    && Object.entries(states).every(([key, state]) => h.context.sectionState[key] === state)
    && same(Object.fromEntries(Object.keys(states).map(key => [key, h.context.sectionState[key]])), dataBefore)
    && same(unrelated(h), domBefore);
}

function record(condition, variant, actual, checks) {
  separationObservations.push({condition, variant, actual: plain(actual), checks});
  return checks;
}

after(() => {
  const target = process.env.BACKSTAGE_AUDIT_SEPARATION_OBSERVATIONS;
  if (target) writeFileSync(target, JSON.stringify({
    sourceHash: createHash('sha256').update(source).digest('hex'),
    observations: separationObservations,
    scope: 'Actual source excerpts with unchanged existing admins RAM DOM/transport harness; no browser/server/DB',
  }, null, 2) + '\n', {flag: 'wx'});
});

test('ADMIN-AUDIT-SEPARATION-01 empty real audit success never turns role definitions into history', async () => {
  const h = harness(); const retained = retainUnrelated(h); const fixture = data('empty-real-audit');
  fixture.events = {items: [], hasMore: false};
  const operation = h.begin(); await h.finish(operation, fixture);
  const checks = record('empty-real-history', 'roles-present-audit200empty',
    {history: rowsPlain(h), html: historyHtml(h), note: noteText(h)}, {
      emptyActualHistory: h.state.auditRows.length === 0,
      noRoleFallback: noRole(JSON.stringify(rowsPlain(h)) + historyHtml(h)),
      explicitEmpty: /권한 이력이 없습니다/.test(historyHtml(h)),
      noFalseError: noteText(h) === '',
      primaryValid: h.state.rows.length === 2 && h.api.auth().user.adminUser.id === 'empty-real-audit-admin-0',
      triple: same(operation.calls.map(call => call.path), paths),
      retained: retained(),
    });
  assert.deepEqual(checks, Object.fromEntries(Object.keys(checks).map(key => [key, true])));
});

test('ADMIN-AUDIT-SEPARATION-02 audit500/network are errors, preserve real cache and initial500 is not empty success', async () => {
  const results = [];
  for (const [variant, seeded, failure] of [
    ['cached-500', true, 500],
    ['cached-network', true, new Error('Synthetic audit transport unavailable')],
    ['initial-500', false, 500],
  ]) {
    const h = harness(); if (seeded) await h.seed();
    const previous = rowsPlain(h); const retained = retainUnrelated(h);
    const operation = h.begin(); await h.finish(operation, data('audit-error'), {2: failure});
    const note = noteText(h); const html = historyHtml(h);
    results.push(record('audit-transient-error', variant, {history: rowsPlain(h), html, note}, {
      exactPreviousActualCache: same(rowsPlain(h), previous),
      noRoleFallback: noRole(JSON.stringify(rowsPlain(h)) + html),
      explicitAuditError: /권한 이력|감사/.test(note) && errorWords.test(note),
      notEmptySuccess: !/권한 이력이 없습니다/.test(html + note),
      visibleCacheOrReloadError: seeded ? /s\*\*\*@example\.invalid/.test(html) : errorWords.test(html),
      primaryValid: h.state.rows.length === 2 && h.api.auth().user.adminUser.id === 'audit-error-admin-0',
      triple: same(operation.calls.map(call => call.path), paths),
      noAutomaticRetry: h.calls.length === (seeded ? 6 : 3),
      retained: retained(),
    }));
  }
  assert.deepEqual(results, results.map(checks => Object.fromEntries(Object.keys(checks).map(key => [key, true]))));
});

test('ADMIN-AUDIT-SEPARATION-03 audit401403 clear historical cache only with explicit denial and valid primary retained', async () => {
  const results = [];
  for (const status of [401, 403]) {
    const h = harness(); await h.seed(); const retained = retainUnrelated(h);
    const operation = h.begin(); await h.finish(operation, data('audit-denied'), {2: status});
    const note = noteText(h); const html = historyHtml(h);
    results.push(record('audit-authorization-denial', status, {history: rowsPlain(h), html, note}, {
      cacheCleared: h.state.auditRows.length === 0,
      noRoleOrPreviousHistory: noRole(JSON.stringify(rowsPlain(h)) + html) && !/s\*\*\*@example\.invalid|healthy-audit/.test(html),
      explicitAuditDenial: /권한 이력|감사/.test(note) && /조회 권한|인증|거절|접근/.test(note),
      notEmptySuccess: !/권한 이력이 없습니다/.test(html + note),
      primaryValid: h.state.rows.length === 2 && h.state.rows[0].meta.adminUserId === 'audit-denied-admin-0',
      actorRetained: h.api.auth().user.id === actorA && h.api.auth().accessToken === 'synthetic-a',
      triple: same(operation.calls.map(call => call.path), paths),
      retained: retained(),
    }));
  }
  assert.deepEqual(results, results.map(checks => Object.fromEntries(Object.keys(checks).map(key => [key, true]))));
});

test('ADMIN-AUDIT-SEPARATION-04 roles500403 show role status without losing valid actual primary and audit events', async () => {
  const results = [];
  for (const status of [500, 403]) {
    const h = harness(); await h.seed(); const retained = retainUnrelated(h);
    const fixture = data('roles-unavailable'); const operation = h.begin();
    await h.finish(operation, fixture, {1: status});
    const note = noteText(h); const html = historyHtml(h);
    results.push(record('roles-unavailable', status, {history: rowsPlain(h), html, note}, {
      actualAuditPreserved: h.state.auditRows.length === 3
        && same(plain(h.state.auditRows.map(row => row[4])), ['s***@example.invalid', 'syntheti', 'system'])
        && h.state.auditRows.every(row => row[0] === 'roles-un'),
      noFakeRoleEvent: noRole(JSON.stringify(rowsPlain(h)) + html),
      explicitRoleStatus: /권한 기준|역할/.test(note) && (status === 403 ? /조회 권한|인증|거절|접근/.test(note) : errorWords.test(note)),
      noFalseAuditError: !/권한 이력을 (?:갱신|확인)하지 못/.test(note),
      primaryValid: h.state.rows.length === 2 && h.api.auth().user.adminUser.id === 'roles-unavailable-admin-0',
      triple: same(operation.calls.map(call => call.path), paths),
      retained: retained(),
    }));
  }
  assert.deepEqual(results, results.map(checks => Object.fromEntries(Object.keys(checks).map(key => [key, true]))));
});

test('ADMIN-AUDIT-SEPARATION-05 normal masked events, current actor/triple and stale actor no-publish preserve records', async () => {
  const results = [];
  {
    const h = harness(); const retained = retainUnrelated(h); const operation = h.begin();
    h.setAuth(actorA, 'synthetic-a-rotated'); await h.finish(operation);
    results.push(record('normal-and-actor-boundary', 'same-actor-token-rotation',
      {history: rowsPlain(h), note: noteText(h)}, {
        maskedActualEvents: same(plain(h.state.auditRows.map(row => row[4])), ['s***@example.invalid', 'syntheti', 'system']),
        noRawActorOrRoleHistory: !/synthetic-operator-a@example\.invalid|ROLE-\d+/.test(historyHtml(h)),
        actualMetadata: h.state.rows[0].meta.userId === actorA && same(h.state.rows[0].meta.permissions, ['*']),
        currentActorAndToken: h.api.auth().user.id === actorA && h.api.auth().accessToken === 'synthetic-a-rotated',
        actualContextSync: h.api.auth().user.adminUser.id === 'healthy-admin-0',
        noFalseStatus: noteText(h) === '',
        triple: same(operation.calls.map(call => call.path), paths),
        retained: retained(),
      }));
  }
  for (const variant of ['old-actor-success', 'old-actor-aux-errors']) {
    const h = harness(); await h.seed(); const retained = retainUnrelated(h);
    const operation = h.begin(); h.setAuth(actorB, 'synthetic-b');
    const before = snapshot(h); const state = h.state;
    await h.finish(operation, data('obsolete'), variant.endsWith('errors') ? {1: 403, 2: 500} : {});
    results.push(record('normal-and-actor-boundary', variant, {after: snapshot(h)}, {
      noStalePublish: same(snapshot(h), before),
      capturedStateIdentity: h.state === state,
      actorStillB: h.api.auth().user.id === actorB && h.api.auth().accessToken === 'synthetic-b',
      triple: same(operation.calls.map(call => call.path), paths),
      noAutomaticRetry: h.calls.length === 6,
      retained: retained(),
    }));
  }
  assert.deepEqual(results, results.map(checks => Object.fromEntries(Object.keys(checks).map(key => [key, true]))));
});


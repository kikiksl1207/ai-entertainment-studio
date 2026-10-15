'use strict';
// Author UNRUN. Whole selected functions, actual permission clearing and users loader.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const vm = require('node:vm');
const PINS = {
  baseline: { 'backstage.js': 'a2ec8324573b8113b1f1f861f08dc46fd4b5e2de18e0dfd7b16be562a759c240',
    'backstage/index.html': '0c45de8ceb7aad1018297dace7b8d5d4a250e76470429e85803141dd97d133e8' },
  focused: { 'backstage.js': '23d49705138ce5d8a5b249ddead30104deb4c5d1186d4ae069b976d7b6fc688d',
    'backstage/index.html': 'dc74c52e61e45883335132281f737601984d7e1852ce2d83ef87d6b1fe5de234' },
};
const phase = process.env.ADMIN_KNOWN_DENIAL_PHASE || 'focused';
assert(Object.hasOwn(PINS, phase));
const override = process.env.ADMIN_KNOWN_DENIAL_SOURCE_ROOT;
const rawPins = [process.env.ADMIN_KNOWN_DENIAL_JS_SHA, process.env.ADMIN_KNOWN_DENIAL_HTML_SHA];
if (override !== undefined || rawPins.some(pin => pin !== undefined)) {
  assert.equal(typeof override, 'string'); assert(override.length > 0);
  assert(path.isAbsolute(override) || path.win32.isAbsolute(override));
  assert(!/^(?:\\\\|\/\/)/.test(override), 'remote source is not admitted');
  assert(rawPins.every(pin => typeof pin === 'string' && /^[a-f0-9]{64}$/.test(pin)), 'explicit raw pair required');
}
const root = path.resolve(override || path.join(__dirname, '..'));
if (override !== undefined) assert(!['E:/Codex/LuminaStage/ai-entertainment-studio-git', 'E:/Codex/LuminaStage/story-completion-20261003']
  .some(shared => path.resolve(shared).toLowerCase() === root.toLowerCase()));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readSource(file, allowHTMLBOM, rawPin) {
  const bytes = fs.readFileSync(path.join(root, file));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(Buffer.from(text).equals(bytes));
  if (!allowHTMLBOM) assert(!text.startsWith('\uFEFF'), 'JS BOM is not admitted');
  const lf = text.replace(/\r\n/g, '\n'); assert(!lf.includes('\r'));
  if (text.includes('\r')) assert.equal(text, lf.replace(/\n/g, '\r\n'));
  assert.equal(sha(Buffer.from(lf)), PINS[phase][file], file);
  if (rawPin) assert.equal(sha(bytes), rawPin, 'explicit raw input pin');
  return lf;
}
const source = readSource('backstage.js', false, process.env.ADMIN_KNOWN_DENIAL_JS_SHA);
const html = readSource('backstage/index.html', true, process.env.ADMIN_KNOWN_DENIAL_HTML_SHA);
for (const id of ['users', 'userRows', 'userRiskRows']) assert(html.includes(`id="${id}"`));
assert(html.includes('data-load-more="users"'));
function excerpt(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start + from.length);
  assert(start >= 0 && end > start, 'actual source excerpt admission: ' + from);
  return source.slice(start, end);
}
// Baseline has no new helper: include its original role functions, not a helper shim.
const roleStart = source.includes('function currentAdminKnownDenied(')
  ? 'function currentAdminKnownDenied(' : 'function currentAdminRoleName(';
const runtime = [
  excerpt('const BACKSTAGE_API_BASE =', 'const loginView ='),
  excerpt('const statusClassMap = {', 'const backstageRows = {'),
  excerpt('function getBackstageAuth(', 'function saveActiveSection('),
  excerpt('function normalizeAuthPayload(', 'async function refreshBackstageAuthOnce('),
  excerpt('function publicApiPath(', 'async function verifyAdminAccess('),
  excerpt('function statusBadge(', 'function renderSettlementChildren('),
  excerpt('function normalizePage(', 'function currentSettlementPeriod('),
  excerpt('function won(', 'function settlementDeductions('),
  excerpt('function setLoadMore(', 'function renderFallbackNote('),
  excerpt('function backstageErrorStatus(', 'function backstageUserFacingError('),
  excerpt('function firstValue(', 'function splitTargetUsers('),
  excerpt('function escapeHtml(', 'function firstRoleName('),
  excerpt('function closeConfirmModal(', 'async function runPreparedAction('),
  excerpt(roleStart, 'function syncCurrentAdminContext('),
  excerpt('function syncCurrentAdminContext(', 'function formatCount('),
  excerpt('function formatCount(', 'function renderSummaryKpis('),
  excerpt('function formatDate(', 'function localizeAdminRole('),
  excerpt('function localizeWorkflowStatus(', 'function localizeArtistKnowledgeStatus('),
  excerpt('function renderUsersStatus(', '// Classification is a sidecar:'),
  excerpt('// Classification is a sidecar:', 'function userClassificationSession('),
  excerpt('async function loadUsersSection(', 'async function loadCreatorsSection('),
].join('\n') + `
this.api = { load: loadUsersSection, more: loadUsersPage, sync: syncCurrentAdminContext,
  canRead: canAccessBackstageSection, apply: applyPermissionVisibility,
  auth: getBackstageAuth, setAuth: setBackstageAuth,
  role: currentAdminRoleName, permissions: currentAdminPermissions,
  attachClassification(node) { userClassificationDetail = { node }; },
  classification() { return userClassificationDetail; },
  seedUncertainCommand() { userClassificationFailedCommands.set('synthetic-failed-scope', new Set(['synthetic-command']));
    userClassificationUsedKeys.add('synthetic-used-key'); },
  uncertainCommandPreserved() { return userClassificationFailedCommands.get('synthetic-failed-scope')?.has('synthetic-command') === true
    && userClassificationUsedKeys.has('synthetic-used-key'); }
};`;
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const caseOptions = { timeout: 10000, concurrency: false };
const actorA = '10000000-0000-4000-8000-000000000001';
const actorB = '10000000-0000-4000-8000-000000000002';
const adminA = '20000000-0000-4000-8000-000000000001';
const adminB = '20000000-0000-4000-8000-000000000002';

class Element {
  constructor(tag = 'div') {
    this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = new Map();
    this.listeners = new Map(); this.classes = new Set(); this.hidden = false; this.disabled = false;
    this.value = ''; this.isConnected = false; this.parent = null;
    this.classList = { contains: key => this.classes.has(key),
      add: (...keys) => keys.forEach(key => this.classes.add(key)),
      remove: (...keys) => keys.forEach(key => this.classes.delete(key)),
      toggle: (key, force = !this.classes.has(key)) => { if (force) this.classes.add(key); else this.classes.delete(key); return force; } };
  }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.text = String(value); this.html = ''; this.clearChildren(); }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.html = String(value); this.text = ''; this.clearChildren();
    const match = this.html.match(/<select id="([^"]+)">/);
    if (match) { const select = new Element('select'); select.id = match[1]; this.append(select); }
  }
  get innerHTML() { return this.html || ''; }
  clearChildren() { for (const child of this.children) { child.connect(false); child.parent = null; } this.children = []; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (let child of nodes) {
    if (typeof child === 'string') { const text = child; child = new Element('#text'); child.textContent = text; }
    child.parent = this; child.connect(this.isConnected); this.children.push(child);
  } }
  connect(value) { this.isConnected = value; this.children.forEach(child => child.connect(value)); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; this.connect(false); }
  after(node) { this.insertSibling(node, 1); }
  before(node) { this.insertSibling(node, 0); }
  insertSibling(node, offset) { assert(this.parent); node.parent = this.parent; node.connect(this.isConnected);
    this.parent.children.splice(this.parent.children.indexOf(this) + offset, 0, node); }
  get lastElementChild() { return this.children.at(-1); }
  find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find(predicate); if (found) return found; } return null; }
  querySelector(selector) {
    if (selector === 'select') return this.find(node => node.tagName === 'select');
    if (selector === '.section-title') return this.find(node => node.classes.has('section-title'));
    if (selector === '#userRows') return this.find(node => node.id === 'userRows');
    if (selector === '[data-users-status]') return this.find(node => 'usersStatus' in node.dataset);
    if (selector === '[data-user-classification-heading]') return this.find(node => 'userClassificationHeading' in node.dataset);
    if (selector === 'thead tr') return this.find(node => node.tagName === 'tr' && node.parent?.tagName === 'thead');
    assert.fail('unmodeled synthetic element selector');
  }
  closest(selector) { assert.equal(selector, 'table'); for (let node = this; node; node = node.parent) if (node.tagName === 'table') return node; return null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
}

function fixture(grant = 'super') {
  const storage = new Map(), calls = [], problems = [];
  const section = new Element('section'); section.id = 'users'; section.className = 'section-block'; section.connect(true);
  const title = new Element('header'); title.className = 'section-title'; section.append(title);
  const roots = { userRows: new Element('tbody'), userRiskRows: new Element('tbody') };
  for (const [id, body] of Object.entries(roots)) {
    body.id = id; const table = new Element('table'), head = new Element('thead'), row = new Element('tr');
    for (let i = 0; i < 11; i++) row.append(new Element('th'));
    head.append(row); table.append(head, body); section.append(table);
  }
  const dashboardView = new Element(), input = new Element('input'), more = new Element('button');
  const main = new Element(); main.setAttribute('data-active-section', 'users');
  const link = new Element('a'); link.setAttribute('href', '#users');
  const detailPanel = new Element(), detailForm = new Element(), confirmModal = new Element();
  const reject = () => { problems.push('unexpected synthetic boundary'); throw new Error('unexpected synthetic boundary'); };
  const context = {
    URLSearchParams, window: { LUMINA_API_BASE: 'https://synthetic.invalid' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    document: { documentElement: { lang: 'en' }, createElement: tag => new Element(tag),
      getElementById: id => id === 'users' ? section : section.find(node => node.id === id),
      querySelector(selector) {
        if (selector === '#users .search-box input') return input;
        if (selector === '[data-load-more="users"]') return more;
        if (selector === '.dashboard-main') return main;
        return reject();
      },
      querySelectorAll(selector) {
        if (selector === '.sidebar-nav a') return [link];
        if (selector === '.section-block') return [section];
        if (selector === '#creators .text-action' || selector === '#admins .text-action, #adminRows .row-action') return [];
        return reject();
      } },
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false }, creators: {} },
    tableMeta: { userRows: { labels: Array(12).fill('synthetic-column'), type: 'synthetic-user' },
      userRiskRows: { labels: Array(6).fill('synthetic-column'), type: 'synthetic-risk' } },
    dashboardView, detailPanel, detailForm, confirmModal, selectedDetail: null, pendingActionPreview: null,
    // Only transport is synthetic; source access/currentness/clearing predicates are never replaced.
    backstageFetch(url, opts) {
      const parsed = new URL(url, 'https://synthetic.invalid');
      if (parsed.origin !== 'https://synthetic.invalid' || parsed.pathname !== '/admin/api/v1/backstage/operations/users-overview'
        || opts?.auth !== true || Object.keys(opts).join(',') !== 'auth' || calls.length >= 4) return reject();
      if (parsed.searchParams.get('take') !== '20' || parsed.searchParams.get('classification') !== 'all'
        || [...parsed.searchParams.keys()].some(key => !['take', 'classification', 'query', 'cursor'].includes(key))) return reject();
      return new Promise((resolve, rejectCall) => calls.push({ query: parsed.searchParams, done: false,
        respond(body) { assert(!this.done); this.done = true; resolve(plain(body)); },
        fail(status) { assert(!this.done); this.done = true; rejectCall(Object.assign(new Error('Synthetic read failure'), { status })); } }));
    },
    fetch: reject,
  };
  vm.runInNewContext(runtime, context, { filename: 'selected/backstage.js:whole-users-functions', timeout: 5000 });
  const authFor = (actor = actorA, mode = grant) => ({ accessToken: 'synthetic-memory-access',
    user: { id: actor, adminUser: { id: actor === actorA ? adminA : adminB, status: 'active',
      role: { name: mode === 'super' ? 'super_admin' : 'synthetic-role', permissions: mode === 'wildcard' ? ['*'] : [] },
      permissions: mode === 'wildcard' ? ['*'] : [] } } });
  context.api.setAuth(authFor());
  context.api.apply();
  const healthy = () => assert.equal(problems.length, 0);
  const ui = () => ({ user: roots.userRows.innerHTML, risk: roots.userRiskRows.innerHTML,
    status: section.querySelector('[data-users-status]')?.textContent ?? '',
    permissionHidden: section.classList.contains('is-permission-hidden'), linkHidden: link.classList.contains('is-hidden'),
    moreHidden: more.classList.contains('is-hidden'), moreDisabled: more.disabled,
    filterDisabled: section.find(node => node.id === 'usersClassificationFilter')?.disabled ?? null });
  const snapshot = () => plain({ state: context.sectionState.users, ui: ui() });
  const attachDetail = tableId => {
    const node = new Element(); node.textContent = 'synthetic-private-classification'; section.append(node);
    context.api.attachClassification(node); context.api.seedUncertainCommand();
    context.selectedDetail = { tableId, meta: { userId: 'synthetic-selected-user' } };
    context.detailForm.innerHTML = 'synthetic-private-detail'; context.detailForm.dataset.draftKey = 'synthetic-draft';
    context.pendingActionPreview = { targetType: 'synthetic-unsent-user-preview' };
    context.confirmModal.classList.remove('is-hidden'); context.detailPanel.classList.remove('is-hidden');
    context.detailForm.classList.remove('is-hidden'); return node;
  };
  const deny = status => context.api.sync([{ userId: actorA, id: adminA, status }]);
  return { context, api: context.api, calls, section, roots, input, more, link, storage, authFor,
    healthy, ui, snapshot, attachDetail, deny,
    get state() { return context.sectionState.users; },
    get filter() { return section.find(node => node.id === 'usersClassificationFilter'); },
    async seed(prefix = 'synthetic-seed') {
      const pending = context.api.load('synthetic-submitted', 'all'); assert.equal(calls.length, 1);
      calls[0].respond(page(prefix)); await pending; healthy();
      assert.equal(context.sectionState.users.rows.length, 2); assert.equal(context.sectionState.users.riskRows.length, 1);
      assert.equal(context.sectionState.users.totalAccounts, 10); assert.equal(context.sectionState.users.filteredAccounts, 4);
      assert.equal(context.sectionState.users.classificationSupported, true);
      assert(roots.userRows.innerHTML.includes(prefix));
    } };
}

function page(prefix = 'synthetic-page', final = false) {
  return { items: [
    { id: final ? '30000000-0000-4000-8000-000000000003' : '30000000-0000-4000-8000-000000000001',
      displayName: prefix + '-test-looking-unclassified', status: 'active',
      testAccountClassification: { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null } },
    { id: final ? '30000000-0000-4000-8000-000000000004' : '30000000-0000-4000-8000-000000000002',
      displayName: prefix + '-explicit-test', status: 'active', openReportCount: 1,
      testAccountClassification: { classification: 'test', revision: 1, source: 'explicit_admin', updatedAt: '2026-10-15T00:00:00.000Z' } },
  ], totalAccounts: 10, filteredAccounts: 4,
  summary: { globalTestAccounts: 3, globalUnclassifiedAccounts: 7, filteredTestAccounts: 2, filteredUnclassifiedAccounts: 2 },
  hasMore: !final, nextCursor: final ? null : '30000000-0000-4000-8000-000000000002' };
}
function assertCleared(f, oldState, classificationNode) {
  assert.notEqual(f.state, oldState, 'old pending state must be retired');
  assert.equal(f.state.rows.length, 0); assert.equal(f.state.riskRows.length, 0);
  assert.equal(f.state.cursor, null); assert.equal(f.state.hasMore, false);
  assert(f.state.totalAccounts == null && f.state.filteredAccounts == null, 'unknown totals, not fabricated zero');
  assert(f.state.classificationCounts == null); assert.equal(f.state.classificationSupported, false);
  assert(!f.ui().user.includes('synthetic-seed')); assert(!f.ui().risk.includes('synthetic-seed'));
  assert.equal(f.ui().status, ''); assert.equal(f.ui().permissionHidden, true); assert.equal(f.ui().linkHidden, true);
  assert.equal(f.ui().moreHidden, true); assert.equal(f.filter.disabled, true);
  assert.equal(f.api.classification(), null); assert.equal(classificationNode.isConnected, false);
  assert.equal(f.context.selectedDetail, null); assert(f.context.detailPanel.classList.contains('is-hidden'));
  assert(f.context.detailForm.classList.contains('is-hidden')); assert.equal(f.context.detailForm.innerHTML, '');
  assert.equal(f.context.detailForm.dataset.draftKey, '');
  assert.equal(f.context.pendingActionPreview, null); assert(f.context.confirmModal.classList.contains('is-hidden'));
  assert(f.api.uncertainCommandPreserved(), 'do not erase failed/sent classification uncertainty'); f.healthy();
}

test('01 matched known-inactive admin denies cached super or wildcard users access', caseOptions, async () => {
  for (const grant of ['super', 'wildcard']) for (const status of ['suspended', 'revoked']) {
    const f = fixture(grant); assert.equal(f.api.canRead('users'), true); await f.seed();
    const oldState = f.state, beforeAuth = plain(f.api.auth()), requests = f.calls.length;
    const classificationNode = f.attachDetail(grant === 'super' ? 'userRows' : 'userRiskRows');
    f.deny(status);
    assert.equal(f.api.canRead('users'), false, 'regression: known denied admin still grants users');
    assert.equal(f.api.role(), null); assert.equal(f.api.permissions().length, 0);
    for (const section of ['overview', 'admins', 'creators', 'users', 'logs']) assert.equal(f.api.canRead(section), false);
    assertCleared(f, oldState, classificationNode);
    const afterAuth = f.api.auth();
    assert(afterAuth.accessToken === beforeAuth.accessToken, 'same synthetic token passes through without printing it');
    assert(afterAuth.user.id === beforeAuth.user.id, 'operator identity unchanged');
    assert.deepEqual(plain(afterAuth.user.adminUser.role), beforeAuth.user.adminUser.role, 'stored role/grants unchanged');
    assert.deepEqual(plain(afterAuth.user.adminUser.permissions), beforeAuth.user.adminUser.permissions);
    assert.equal(afterAuth.user.adminUser.status, status); assert.equal(f.calls.length, requests);
  }
});

test('02 known denial retires pending first or append outcomes without private commits', caseOptions, async () => {
  for (const append of [false, true]) for (const outcome of ['success', 401, 503]) {
    const f = fixture('wildcard'); if (append) await f.seed();
    const pending = append ? f.api.more(true) : f.api.load('synthetic-submitted', 'all');
    const call = f.calls.at(-1); assert(call); const oldState = f.state;
    const node = f.attachDetail('userRows'); f.deny('revoked'); assertCleared(f, oldState, node);
    const afterDenial = f.snapshot(), requestCount = f.calls.length;
    if (outcome === 'success') call.respond(page('synthetic-obsolete', true)); else call.fail(outcome);
    await pending; await flush();
    assert.deepEqual(f.snapshot(), afterDenial, 'late success/error must not resurrect rows, totals, cursor or controls');
    assert.equal(f.calls.length, requestCount); assert(f.api.uncertainCommandPreserved()); f.healthy();
  }
});

test('03 unrelated roster and stale actors cannot change valid or legacy current authority', caseOptions, async () => {
  const f = fixture('super'); await f.seed(); const before = f.snapshot(), auth = plain(f.api.auth());
  f.api.sync([{ userId: actorB, id: adminA, status: 'revoked' }, { userId: actorA, id: adminB, status: 'suspended' }]);
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(plain(f.api.auth()), auth); assert(f.api.canRead('users'));
  const cursor = f.state.cursor, pending = f.api.more(true), rotated = plain(f.api.auth());
  rotated.accessToken = 'synthetic-memory-rotation'; f.api.setAuth(rotated);
  assert.equal(f.calls.length, 2); const query = f.calls[1].query;
  assert.deepEqual([...query.keys()].sort(), ['classification', 'cursor', 'query', 'take']);
  assert(query.get('cursor') === cursor); assert.equal(query.get('query'), 'synthetic-submitted');
  f.calls[1].respond(page('synthetic-current', true)); await pending;
  assert.equal(f.state.rows.length, 4); assert.equal(f.state.riskRows.length, 2);
  assert.equal(f.state.totalAccounts, 10); assert.equal(f.state.filteredAccounts, 4);
  assert.deepEqual(plain(f.state.classificationCounts), { globalTestAccounts: 3, globalUnclassifiedAccounts: 7,
    filteredTestAccounts: 2, filteredUnclassifiedAccounts: 2 });
  assert.equal(f.state.cursor, null); assert.equal(f.state.hasMore, false); assert.equal(f.state.classificationSupported, true);
  assert.equal(f.api.canRead('users'), true); f.healthy();

  const swapped = fixture(), obsolete = swapped.api.load('synthetic-old', 'all'); const oldCall = swapped.calls[0];
  swapped.api.setAuth(swapped.authFor(actorB)); const current = swapped.api.load('synthetic-new', 'all');
  swapped.calls[1].respond(page('synthetic-replacement', true)); await current; const replacement = swapped.snapshot();
  oldCall.respond(page('synthetic-wrong-actor', true)); await obsolete;
  assert.deepEqual(swapped.snapshot(), replacement); assert(swapped.api.auth().user.id === actorB); swapped.healthy();

  for (const mode of ['missing', 'unknown']) {
    const denied = fixture('none'); if (mode === 'missing') denied.api.setAuth(null);
    assert.equal(denied.api.canRead('users'), false);
    const snapshot = denied.snapshot(); await denied.api.load('synthetic-blocked'); await denied.api.more(true);
    denied.api.sync([{ userId: actorB, id: adminB, status: 'active', role: { name: 'super_admin', permissions: ['*'] } }]);
    assert.equal(denied.api.canRead('users'), false); assert.equal(denied.calls.length, 0);
    assert.deepEqual(denied.snapshot(), snapshot); denied.healthy();
  }
  const legacy = fixture(); legacy.api.setAuth({ accessToken: 'synthetic-legacy-access', user: { id: actorA, adminPermissions: ['users:read'] } });
  assert.equal(legacy.api.canRead('users'), true); await legacy.seed('synthetic-legacy');
  const legacyAuth = plain(legacy.api.auth()), legacyState = legacy.snapshot();
  legacy.api.sync([{ userId: actorA, id: adminA, status: 'revoked' }]);
  assert.equal(legacy.api.canRead('users'), true); assert.deepEqual(plain(legacy.api.auth()), legacyAuth);
  assert.deepEqual(legacy.snapshot(), legacyState); legacy.healthy();
});

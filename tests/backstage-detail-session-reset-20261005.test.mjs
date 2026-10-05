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
const subject = '20000000-0000-4000-8000-000000000001';
const marker = 'synthetic-private-A';

export function sourceExcerpts(text = source) {
  const anchors = [
    ['constants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
    ['selection', 'let selectedDetail =', 'const sectionState ='],
    ['statusClasses', 'const statusClassMap = {', 'const backstageRows = {'],
    ['storageSectionDraftHistory', 'function getBackstageAuth(', 'function setStatus('],
    ['loginStatus', 'function setStatus(', 'function setLoading('],
    ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
    ['authNormalizationRefresh', 'function normalizeAuthPayload(', 'function applyAdminContext('],
    ['paths', 'function publicApiPath(', 'async function verifyAdminAccess('],
    ['rows', 'function statusBadge(', 'function renderSettlementChildren('],
    ['pageSearch', 'function normalizePage(', 'function currentSettlementPeriod('],
    ['won', 'function won(', 'function settlementDeductions('],
    ['loadingErrors', 'function setLoadMore(', 'function renderFallbackNote('],
    ['errorStatus', 'function backstageErrorStatus(', 'function backstageUserFacingError('],
    ['userFacingError', 'function backstageUserFacingError(', 'function artistKnowledgeQueueErrorMessage('],
    ['historyRenderAndAppend', 'function formatHistoryTime(', 'function renderDetailPanel('],
    ['detailPanel', 'function renderDetailPanel(', 'function openQuickAction('],
    ['detailFormHelpersAndRender', 'function detailInput(', 'function getActionProfile('],
    ['actionProfileAndDetailConsumers', 'function getActionProfile(', 'function firstValue('],
    ['firstValue', 'function firstValue(', 'function splitTargetUsers('],
    ['escape', 'function escapeHtml(', 'function firstRoleName('],
    ['tablesAndActiveSection', 'function renderBackstageTables(', 'function currentAdminRoleName('],
    ['currentAdmin', 'function currentAdminRoleName(', 'function syncCurrentAdminContext('],
    ['existingAccessAndVisibility', 'function canAccessBackstageSection(', 'function formatCount('],
    ['countFormat', 'function formatCount(', 'function renderSummaryKpis('],
    ['dateMoney', 'function formatDate(', 'function localizeAdminRole('],
    ['workflowStatus', 'function localizeWorkflowStatus(', 'function localizeArtistKnowledgeStatus('],
    ['apiSummary', 'function summarizeApiResult(', 'async function runAssetUploadRequest('],
    ['actionSummaryAndRowUpdate', 'function actionChangeLabel(', 'function clearDetailValidationErrors('],
    ['confirmCloseAndPreparedAction', 'function closeConfirmModal(', 'function renderBackstageTables('],
    ['usersAndClassification', 'function renderUsersStatus(', 'async function loadCreatorsSection('],
    ['sectionLoadLoginDashboard', 'function loadSection(', 'function markBackstageReady('],
    ['detailClose', 'detailCloseButton.addEventListener("click", () => {', 'document.querySelectorAll("[data-detail-action]")'],
    ['detailBackdropClose', 'detailPanel.addEventListener("click", (event) => {', 'detailForm?.addEventListener("input"'],
    ['logout', 'logoutButton.addEventListener("click", () => {', 'refreshButton.addEventListener('],
  ];
  return anchors.map(([name, start, end]) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `Missing exact product excerpt: ${name}`);
    const body = text.slice(from, to);
    return { name, start, end, line: text.slice(0, from).split('\n').length,
      sha256: createHash('sha256').update(body).digest('hex'), body };
  });
}

const runtime = sourceExcerpts().map(item => item.body).join('\n') + `
const sectionLoaders = { users: loadUsersSection };
this.api = { showLogin, showDashboard, auth: getBackstageAuth, setAuth: setBackstageAuth,
  run: runPreparedAction, closeConfirm: closeConfirmModal,
  stagePreview(preview) {
    pendingActionPreview = preview;
    confirmType.textContent = preview.menu;
    confirmTitle.textContent = preview.target;
    confirmMessage.textContent = preview.warning;
    confirmPayload.innerHTML = renderConfirmSummary(preview);
    confirmRunButton.disabled = false;
    confirmModal.classList.remove('is-hidden');
  },
  get preview() { return pendingActionPreview; },
  select: selectDetailButton, saveDraft: saveDetailDraft, draftKey: detailDraftKey,
  historyKey: detailHistoryKey, formData: collectDetailFormData,
  read: loadUserClassification, save: saveUserClassification, current: userClassificationCurrent,
  get selected() { return selectedDetail; }, get classification() { return userClassificationDetail; },
  get failedCommands() { return userClassificationFailedCommands; }, get usedKeys() { return userClassificationUsedKeys; }
};`;

// A small stateful DOM: parsed fields are data only, never executed as HTML or scripts.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName; this.children = []; this.dataset = {}; this.attributes = new Map();
    this.listeners = new Map(); this.classes = new Set(); this.disabled = false;
    this.hidden = false; this.value = ''; this.checked = false; this.isConnected = false;
    this.classList = {
      contains: name => this.classes.has(name), add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name);
        return force;
      },
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  clearChildren() { this.children.forEach(child => { child.connect(false); child.parent = null; }); this.children = []; }
  set textContent(value) { this.clearChildren(); this.text = String(value); this.html = ''; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.clearChildren(); this.html = String(value); this.text = '';
    if (this.tagName === 'select') {
      this.value = this.html.match(/<option value="([^"]*)" selected/)?.[1]
        ?? this.html.match(/<option value="([^"]*)"/)?.[1] ?? '';
      return;
    }
    for (const match of this.html.matchAll(/<(input|select|textarea|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) {
      const [, tag, attrs, body = ''] = match;
      const child = new Element(tag);
      for (const attr of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
        const [, key, content = ''] = attr;
        if (key.startsWith('data-')) child.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = content;
        else if (key === 'disabled' || key === 'checked') child[key] = true;
        else if (key === 'class') child.className = content;
        else { child.setAttribute(key, content); if (['name', 'type', 'value', 'id'].includes(key)) child[key] = content; }
      }
      if (tag === 'select') child.innerHTML = body;
      if (tag === 'textarea') child.value = body;
      if (tag === 'button') child.textContent = body;
      this.append(child);
    }
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
  insertSibling(node, offset) {
    assert.ok(this.parent, 'Only attached DOM siblings can be inserted');
    node.parent = this.parent; node.connect(this.isConnected);
    this.parent.children.splice(this.parent.children.indexOf(this) + offset, 0, node);
  }
  after(node) { this.insertSibling(node, 1); }
  before(node) { this.insertSibling(node, 0); }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null; this.connect(false);
  }
  get lastElementChild() { return this.children.at(-1); }
  walk() { return [this, ...this.children.flatMap(child => child.walk())]; }
  matches(selector) {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    const data = selector.match(/^\[data-([\w-]+)\]$/);
    if (data) return data[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase()) in this.dataset;
    if (selector === 'tr.is-selected') return this.tagName === 'tr' && this.classes.has('is-selected');
    if (selector === 'thead tr') return this.tagName === 'tr' && this.parent?.tagName === 'thead';
    if (['select', 'table', 'tr', 'input', 'textarea'].includes(selector)) return this.tagName === selector;
    assert.fail(`Unmodeled element selector: ${selector}`);
  }
  querySelectorAll(selector) {
    if (selector === 'input, select, textarea') return this.walk().filter(node => ['input', 'select', 'textarea'].includes(node.tagName));
    return this.walk().filter(node => node !== this && node.matches(selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parent) if (node.matches(selector)) return node; return null; }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || []; listeners.push(listener); this.listeners.set(name, listeners);
  }
  fire(name, event = { target: this }) {
    assert.ok(this.listeners.has(name), `No actual ${name} handler registered`);
    this.listeners.get(name).forEach(listener => listener(event));
  }
}

const baseline = { classification: 'unclassified', revision: 0, source: 'unclassified', updatedAt: null };
const classified = { classification: 'test', revision: 1, source: 'explicit_admin', updatedAt: '2026-10-05T01:00:00.000Z' };
const history = [{ id: 'synthetic-classification-history', revision: 1, classification: 'test', reasonCode: 'fixture', createdAt: classified.updatedAt }];
const read = (state = baseline, entries = []) => ({ contract: 'admin-test-account-classification-v1',
  userId: subject, readOnly: true, state, history: entries,
  policy: { realCustomerInference: false, permissionChanges: false } });
const receipt = { contract: 'admin-test-account-classification-command-v1', userId: subject,
  idempotentReplay: false, receipt: { classification: 'test', revision: 1, reasonCode: 'fixture' },
  current: classified, permissionChanges: false };
const emptyPage = { items: [], totalAccounts: 0, filteredAccounts: 0, hasMore: false, nextCursor: null,
  summary: { globalTestAccounts: 0, globalUnclassifiedAccounts: 0, filteredTestAccounts: 0, filteredUnclassifiedAccounts: 0 } };

function harness() {
  const tree = new Element(); tree.connect(true);
  const nodes = {};
  const add = (name, tag = 'div', parent = tree) => {
    const node = new Element(tag); node.id = name; nodes[name] = node; parent.append(node); return node;
  };
  const dashboardView = add('dashboardView', 'section');
  const loginView = add('loginView', 'section'); loginView.classList.add('is-hidden');
  const dashboardMain = add('dashboardMain', 'main', dashboardView); dashboardMain.setAttribute('data-active-section', 'users');
  const users = add('users', 'section', dashboardMain); users.className = 'section-block is-active';
  const title = add('usersHeading', 'header', users); title.className = 'section-title';
  const roots = {};
  for (const id of ['userRows', 'userRiskRows']) {
    const table = add(`${id}Table`, 'table', users); const thead = add(`${id}Head`, 'thead', table);
    const headRow = add(`${id}HeadRow`, 'tr', thead);
    for (let i = 0; i < 11; i++) headRow.append(new Element('th'));
    roots[id] = add(id, 'tbody', table);
  }
  const detailPanel = add('backstageDetailPanel', 'aside', dashboardView); detailPanel.className = 'detail-panel is-hidden';
  const detailCard = add('detailCard', 'div', detailPanel);
  const detailType = add('detailType', 'span', detailCard); detailType.textContent = 'Detail';
  const detailTitle = add('detailTitle', 'h2', detailCard); detailTitle.textContent = 'Select an item';
  const detailCloseButton = add('detailCloseButton', 'button', detailCard);
  const detailList = add('detailList', 'dl', detailCard);
  const detailForm = add('detailForm', 'div', detailCard); detailForm.className = 'detail-form is-hidden';
  const detailHistoryList = add('detailHistoryList', 'div', detailCard);
  const detailMemo = add('detailMemo', 'textarea', detailCard);
  const actions = Object.fromEntries(['memo', 'hold', 'danger'].map(action => {
    const button = add(`detail-${action}`, 'button', detailCard); button.dataset.detailAction = action; return [action, button];
  }));
  const input = add('synthetic-search', 'input', users); const more = add('synthetic-more', 'button', users);
  const nav = add('synthetic-users-link', 'a', dashboardView); nav.setAttribute('href', '#users');
  const logoutButton = add('logoutButton', 'button', dashboardView);
  const passwordInput = add('passwordInput', 'input', loginView); passwordInput.value = 'synthetic-password';
  const loginStatus = add('loginStatus', 'p', loginView);
  const googleButtonFallback = add('googleButtonFallback', 'button', loginView); googleButtonFallback.hidden = true;
  const operatorEmail = add('operatorEmail', 'span', dashboardView);
  const emailInput = add('emailInput', 'input', loginView);
  const todayLabel = add('todayLabel', 'span', dashboardView);
  const detailHelp = add('detailHelp', 'p', detailCard); detailHelp.className = 'detail-help';
  detailHelp.textContent = 'Synthetic generic help';
  // The actual confirmation modal is outside the dashboard, so hiding only the dashboard cannot hide it.
  const confirmModal = add('backstageConfirmModal'); confirmModal.className = 'confirm-modal is-hidden';
  const confirmType = add('confirmType', 'span', confirmModal);
  const confirmTitle = add('confirmTitle', 'h2', confirmModal);
  const confirmMessage = add('confirmMessage', 'p', confirmModal);
  const confirmPayload = add('confirmPayload', 'div', confirmModal);
  const confirmRunButton = add('confirmRunButton', 'button', confirmModal);
  const storage = new Map(); const tokens = new Map(); const calls = [];
  const actionRequests = []; const reloads = []; let uuid = 0; let providerAttempts = 0;
  const context = {
    URLSearchParams, Uint8Array,
    window: { LUMINA_API_BASE: 'https://synthetic.invalid', crypto: {
      randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key) },
    document: {
      documentElement: { lang: 'en' }, createElement: tag => new Element(tag),
      getElementById: id => tree.walk().find(node => node.id === id) || null,
      querySelector(selector) {
        if (selector === '.dashboard-main') return dashboardMain;
        if (selector === '#users .search-box input') return input;
        if (selector === '[data-load-more="users"]') return more;
        if (selector === '.detail-help') return detailHelp;
        if (selector === 'tr.is-selected') return tree.walk().find(node => node.matches(selector)) || null;
        const action = selector.match(/^\[data-detail-action="(memo|hold|danger)"\]$/)?.[1];
        if (action) return actions[action];
        assert.fail(`Unmodeled document selector: ${selector}`);
      },
      querySelectorAll(selector) {
        if (selector === 'tr.is-selected') return tree.walk().filter(node => node.matches(selector));
        if (selector === '.section-block') return [users];
        if (selector === '.sidebar-nav a') return [nav];
        if (selector === '#admins .text-action, #adminRows .row-action') return [];
        assert.fail(`Unmodeled document selector list: ${selector}`);
      },
    },
    sectionState: { users: { rows: [], riskRows: [], cursor: null, hasMore: false } },
    tableMeta: { userRows: { type: 'Synthetic user', labels: Array(12).fill('Synthetic field') },
      userRiskRows: { type: 'Synthetic risk', labels: Array(6).fill('Synthetic field') } },
    backstageRows: Object.fromEntries(['admins', 'adminRequests', 'overviewQueue', 'risk', 'creators',
      'creatorImageRequests', 'aiCreators', 'contentAnomalies', 'reportCancels', 'studioSettlement',
      'settlement', 'settlementConversions', 'aiSettlement', 'logs'].map(key => [key, []])),
    dashboardView, loginView, detailPanel, detailType, detailTitle, detailList, detailForm,
    detailHistoryList, detailMemo, detailCloseButton, logoutButton, passwordInput, loginStatus,
    googleButtonFallback, operatorEmail, emailInput, todayLabel,
    confirmModal, confirmType, confirmTitle, confirmMessage, confirmPayload, confirmRunButton,
    console: { debug: (...args) => actionRequests.debug.push(plain(args)) },
    runBackstageRequest(request) {
      assert.equal(request.method, 'GET', 'Prepared-action fixtures never dispatch a mutation');
      assert.equal(request.path, '/synthetic/read-only');
      const auth = context.api.auth(); assert.ok(auth?.accessToken);
      assert.ok(tokens.has(`Bearer ${auth.accessToken}`), 'Synthetic request still needs actual RAM auth');
      return new Promise((resolve, reject) => actionRequests.push({ request: plain(request), operatorId: auth.user.id, resolve, reject }));
    },
    reloadCurrentSectionAfterAction() {
      // A stateful await boundary, not an actual reload or a no-op; the caller must revalidate afterward.
      return new Promise((resolve, reject) => reloads.push({ resolve, reject, operatorId: context.api.auth()?.user?.id }));
    },
    prepareGoogleLoginButton() {
      providerAttempts++;
      return Promise.reject(new Error('Synthetic unavailable provider; no network'));
    },
    fetch(url, options) {
      const parsed = new URL(url); assert.equal(parsed.origin, 'https://synthetic.invalid');
      assert.ok(parsed.pathname === '/admin/api/v1/backstage/operations/users-overview'
        || parsed.pathname === `/admin/api/v1/users/${subject}/test-account-classification`, 'Transport allowlist');
      assert.ok(tokens.has(options.headers.Authorization), 'Actual auth must supply a registered synthetic bearer');
      if (parsed.pathname.endsWith('/users-overview')) assert.equal(options.method, 'GET');
      else assert.ok(['GET', 'POST'].includes(options.method));
      return new Promise((resolve, reject) => calls.push({ url, options, reject,
        respond(body, status = 200) { resolve({ status, ok: status >= 200 && status < 300, json: async () => plain(body) }); } }));
    },
  };
  actionRequests.debug = [];
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-detail-session-excerpts' });
  const api = context.api;
  const setAuth = (id = operatorA, token = 'synthetic-access-a') => {
    const auth = { accessToken: token, user: { id, adminPermissions: ['*'] } };
    tokens.set(`Bearer ${token}`, id); api.setAuth(auth); return auth;
  };
  setAuth();
  // Use the exact product section storage key rather than assuming its spelling.
  const sectionKey = source.match(/const BACKSTAGE_SECTION_KEY = "([^"]+)"/)[1]; storage.set(sectionKey, 'users');
  const detail = { tableId: 'userRows', type: `${marker}-type`, labels: Array(12).fill('Synthetic field'),
    titleText: `${marker}-title`, row: [`${marker}-name`, `${marker}-contact`, `${marker}-login`, '0', '0', '0', '-', '0', '-', 'active', 'Unclassified', 'Review'],
    meta: { userId: subject, status: 'active' } };
  detail.labels[9] = '\uC0C1\uD0DC';
  const draftsKey = source.match(/const BACKSTAGE_DRAFT_KEY = "([^"]+)"/)[1];
  const historyKey = source.match(/const BACKSTAGE_HISTORY_KEY = "([^"]+)"/)[1];
  storage.set(draftsKey, JSON.stringify({ [api.draftKey(detail)]: { reason: `${marker}-draft`, email: `${marker}-contact` } }));
  storage.set(historyKey, JSON.stringify([{ detailKey: api.historyKey(detail), createdAt: classified.updatedAt,
    actor: 'synthetic-operator-A', actionLabel: 'synthetic-history', status: 'recorded', note: `${marker}-history` }]));
  const h = { context, api, tree, nodes, roots, actions, storage, calls, actionRequests, reloads,
    detail, setAuth, draftsKey, historyKey,
    get state() { return context.sectionState.users; },
    get classificationCalls() { return calls.filter(call => call.url.endsWith('/test-account-classification')); },
    open() {
      const row = new Element('tr'); const button = new Element('button');
      button.dataset.detail = encodeURIComponent(JSON.stringify(detail)); row.append(button); roots.userRows.append(row);
      api.select(button);
      assert.equal(api.selected?.meta.userId, subject, 'Actual metadata parser must open the synthetic user');
      assert.equal(detailForm.querySelectorAll('input, select, textarea').length, 5, 'Actual form fields must be modeled');
      assert.equal(api.formData().reason, `${marker}-draft`, 'Actual draft restoration must be exercised');
      assert.match(detailHistoryList.innerHTML, new RegExp(`${marker}-history`), 'Actual history renderer must be exercised');
      detailMemo.value = `${marker}-memo`;
      return api.classification;
    },
    async ready() {
      const classification = h.open(); const call = h.classificationCalls.at(-1);
      assert.equal(call.options.method, 'GET'); call.respond(read()); await tick();
      assert.equal(classification.phase, 'ready'); return classification;
    },
    async logout() {
      logoutButton.fire('click'); await tick();
      assert.equal(dashboardView.classList.contains('is-hidden'), true);
      assert.equal(loginView.classList.contains('is-hidden'), false);
      assert.equal(storage.has('lumina_backstage_auth'), false);
      assert.equal(passwordInput.value, ''); assert.match(loginStatus.textContent, /로그아웃/);
      assert.equal(providerAttempts, 1); assert.equal(googleButtonFallback.hidden, false);
    },
    async reenter(id = operatorA) {
      if (id !== operatorA || !api.auth()) setAuth(id, id === operatorA ? 'synthetic-access-a' : 'synthetic-access-b');
      api.showDashboard();
      const list = calls.at(-1); assert.ok(list.url.endsWith('classification=all'));
      assert.equal(new URL(list.url).pathname, '/admin/api/v1/backstage/operations/users-overview');
      list.respond(emptyPage); await tick();
      assert.equal(dashboardView.classList.contains('is-hidden'), false);
      assert.equal(loginView.classList.contains('is-hidden'), true);
      assert.equal(h.state.totalAccounts, 0); assert.equal(h.state.filteredAccounts, 0);
      assert.deepEqual(plain(h.state.classificationCounts), emptyPage.summary);
    },
  };
  return h;
}

function listSnapshot(h) {
  return plain({ state: h.state, rows: h.roots.userRows.innerHTML, risk: h.roots.userRiskRows.innerHTML,
    status: h.context.document.getElementById('users').querySelector('[data-users-status]')?.textContent });
}
function assertDetached(h, old) {
  assert.equal(h.api.classification, null, 'No previous-session classification context may remain authoritative');
  assert.equal(old.node.isConnected, false, 'Old classification controls must be detached');
}

test('DETAIL-SESSION-01 showLogin clears selection, closes the aside and releases selected row CSS', async () => {
  const h = harness(); h.open(); await h.logout();
  assert.deepEqual({ selected: h.api.selected, closed: h.context.detailPanel.classList.contains('is-hidden'),
    selectedRows: h.context.document.querySelectorAll('tr.is-selected').length },
  { selected: null, closed: true, selectedRows: 0 });
});

test('DETAIL-SESSION-02 showLogin scrubs sensitive type, title, rows, memo and rendered history', async () => {
  const h = harness(); h.open(); await h.logout();
  const retained = Object.entries({ type: h.context.detailType.textContent, title: h.context.detailTitle.textContent,
    rows: h.context.detailList.innerHTML, memo: h.context.detailMemo.value, history: h.context.detailHistoryList.innerHTML })
    .filter(([, value]) => value.includes(marker)).map(([name]) => name);
  assert.deepEqual(retained, [], 'Old sensitive fields must be empty or generic, not merely dashboard-hidden');
});

test('DETAIL-SESSION-03 showLogin removes the old editable form and draft binding', async () => {
  const h = harness(); h.open(); await h.logout();
  assert.deepEqual({ hidden: h.context.detailForm.classList.contains('is-hidden'),
    draftKey: h.context.detailForm.dataset.draftKey || '', data: h.api.formData(),
    sensitiveMarkup: h.context.detailForm.innerHTML.includes(marker) },
  { hidden: true, draftKey: '', data: null, sensitiveMarkup: false });
});

test('DETAIL-SESSION-04 showLogin removes the sidecar node and clears its context', async () => {
  const h = harness(); const old = await h.ready(); await h.logout(); assertDetached(h, old);
});

test('DETAIL-SESSION-05 failed command tombstones and used keys survive logout and prevent an identical resend', async () => {
  const h = harness(); const old = await h.ready();
  const pending = h.api.save(old, 'test', 'fixture', true); h.classificationCalls.at(-1).respond({}, 500); await pending;
  assert.equal(old.message, 'uncertain');
  const commands = h.api.failedCommands; const keys = h.api.usedKeys;
  const beforeCommands = plain([...commands].map(([key, values]) => [key, [...values]]));
  const beforeKeys = [...keys]; const beforeDrafts = h.storage.get(h.draftsKey); const beforeHistory = h.storage.get(h.historyKey);
  assert.equal(commands.size, 1); assert.equal(keys.size, 1);
  await h.logout();
  assert.equal(h.api.failedCommands, commands); assert.equal(h.api.usedKeys, keys);
  assert.deepEqual(plain([...commands].map(([key, values]) => [key, [...values]])), beforeCommands);
  assert.deepEqual([...keys], beforeKeys);
  assert.equal(h.storage.get(h.draftsKey), beforeDrafts); assert.equal(h.storage.get(h.historyKey), beforeHistory);
  await h.reenter(); const fresh = await h.ready(); const callCount = h.calls.length;
  await h.api.save(fresh, 'test', 'fixture', true);
  assert.equal(h.calls.length, callCount, 'Reset must not weaken the uncertain-command duplicate guard');
  assert.equal(fresh.message, 'duplicate');
});

test('DETAIL-SESSION-06 actual showDashboard for a different operator does not reveal the previous detail', async () => {
  const h = harness(); await h.ready(); await h.logout(); await h.reenter(operatorB);
  assert.equal(h.api.auth().user.id, operatorB);
  assert.equal(h.context.detailPanel.parent, h.context.dashboardView, 'Model the actual aside inside the dashboard');
  assert.equal(h.context.detailPanel.classList.contains('is-hidden'), true, 'Reentry must not expose operator A detail');
  assert.equal(h.api.selected, null);
  assert.doesNotMatch(h.context.detailTitle.textContent + h.context.detailList.innerHTML, new RegExp(marker));
});

test('DETAIL-SESSION-07 a stale form cannot save into the previous detail draft after showLogin', async () => {
  const h = harness(); await h.ready(); await h.logout();
  const before = h.storage.get(h.draftsKey);
  const oldReason = h.context.detailForm.querySelectorAll('input, select, textarea').find(field => field.name === 'reason');
  if (oldReason) oldReason.value = 'synthetic-stale-edit';
  h.api.saveDraft();
  assert.equal(h.storage.get(h.draftsKey), before, 'Actual saveDetailDraft must stop using the old active binding');
});

test('DETAIL-SESSION-08 pending GET cannot revive current/history after shared-auth same-operator dashboard reentry', async () => {
  const h = harness(); const old = h.open(); const get = h.classificationCalls.at(-1);
  h.storage.set('lumina_auth', JSON.stringify(h.api.auth()));
  await h.logout(); assert.equal(h.api.auth().user.id, operatorA, 'Actual shared fallback remains deliberately unchanged');
  await h.reenter(); const before = listSnapshot(h);
  get.respond(read(classified, history)); await tick();
  assert.deepEqual(listSnapshot(h), before, 'Old detail read must not modify the new users list');
  assert.equal(h.api.current(old), false, 'A previously selected detail cannot become current again');
  assertDetached(h, old);
});

for (const status of [200, 409]) {
  test(`DETAIL-SESSION-${status === 200 ? '09' : '10'} pending POST ${status} cannot publish detail/list after same-operator reentry`, async () => {
    const h = harness(); const old = await h.ready(); const pending = h.api.save(old, 'test', 'fixture', true);
    const post = h.classificationCalls.at(-1); assert.equal(post.options.method, 'POST');
    assert.deepEqual(JSON.parse(post.options.body), { classification: 'test', expectedRevision: 0, reasonCode: 'fixture' });
    h.storage.set('lumina_auth', JSON.stringify(h.api.auth()));
    const commands = h.api.failedCommands; const keys = h.api.usedKeys;
    const tombstones = plain([...commands].map(([key, values]) => [key, [...values]])); const used = [...keys];
    await h.logout(); await h.reenter(); const before = listSnapshot(h);
    post.respond(status === 200 ? receipt : { message: 'Synthetic conflict' }, status); await pending;
    assert.deepEqual(listSnapshot(h), before, 'Old POST completion must not stale counts or render the new list');
    assertDetached(h, old);
    assert.deepEqual(plain([...commands].map(([key, values]) => [key, [...values]])), tombstones);
    assert.deepEqual([...keys], used);
    assert.equal(h.classificationCalls.filter(call => call.options.method === 'POST').length, 1, 'No automatic repeat');
  });
}

test('DETAIL-SESSION-11 initial missing selection is safe and actual users reset/login behavior remains intact', async () => {
  const h = harness(); assert.equal(h.api.selected, null); assert.equal(h.api.classification, null);
  h.context.sectionState.users = { rows: [{ row: ['synthetic-old-list'] }], riskRows: [], cursor: 'synthetic-cursor',
    hasMore: true, search: 'synthetic-query', classification: 'test', classificationSupported: true, totalAccounts: 7 };
  await h.logout();
  assert.deepEqual(plain(h.state), { cursor: null, hasMore: false, rows: [], riskRows: [], search: '',
    classification: 'all', classificationSupported: false });
  assert.equal(h.api.selected, null); assert.equal(h.api.classification, null);
  assert.equal(h.context.detailPanel.classList.contains('is-hidden'), true);
  assert.doesNotMatch(h.roots.userRows.innerHTML, /synthetic-old-list/);
  assert.equal(h.calls.length, 0, 'showLogin itself performs no API call');
  await h.reenter(); assert.deepEqual(plain(h.state.classificationCounts), emptyPage.summary);
});

test('DETAIL-SESSION-12 actual close button and backdrop still clear selection without discarding command guards', async () => {
  for (const target of ['detailCloseButton', 'detailPanel']) {
    const h = harness(); await h.ready(); const commands = h.api.failedCommands; const keys = h.api.usedKeys;
    h.context[target].fire('click');
    assert.equal(h.api.selected, null); assert.equal(h.context.detailPanel.classList.contains('is-hidden'), true);
    assert.equal(h.context.document.querySelectorAll('tr.is-selected').length, 0);
    assert.equal(h.api.failedCommands, commands); assert.equal(h.api.usedKeys, keys);
  }
});

const preparedPreview = {
  menu: 'Synthetic report read', actionGroup: 'Synthetic detail QA', targetType: 'report',
  target: `${marker}-prepared-target`, note: `${marker}-prepared-note`, requestedAction: 'read',
  warning: 'Synthetic read-only fixture', canRunLocally: false, canRunApi: true,
  apiRequest: { method: 'GET', path: '/synthetic/read-only' }, bodyPreview: { form: {} },
};

test('DETAIL-SESSION-13 showLogin closes an existing confirmation and clears its prepared target before reentry', async () => {
  const h = harness(); await h.ready(); h.api.stagePreview(plain(preparedPreview));
  assert.equal(h.context.confirmModal.parent, h.tree, 'Actual confirm modal is not inside the hidden dashboard');
  await h.logout();
  assert.deepEqual({ preview: h.api.preview, closed: h.context.confirmModal.classList.contains('is-hidden') },
    { preview: null, closed: true }, 'Old confirmation must be non-visible and have no runnable target');
  await h.reenter(operatorB);
  assert.equal(h.api.preview, null); assert.equal(h.context.confirmModal.classList.contains('is-hidden'), true);
  await h.api.run(); assert.equal(h.actionRequests.length, 0, 'No prepared target can dispatch after reset');
});

function actionSnapshot(h) {
  return plain({ message: h.context.confirmMessage.textContent, payload: h.context.confirmPayload.innerHTML,
    runLabel: h.context.confirmRunButton.textContent, disabled: h.context.confirmRunButton.disabled,
    hidden: h.context.confirmModal.classList.contains('is-hidden'), help: h.nodes.detailHelp.textContent,
    history: h.storage.get(h.historyKey), detailHistory: h.context.detailHistoryList.innerHTML,
    selected: h.api.selected, detailRows: h.context.detailList.innerHTML,
    classification: h.api.classification ? { userId: h.api.classification.userId, phase: h.api.classification.phase } : null,
    classificationCallCount: h.classificationCalls.length, list: listSnapshot(h), reloadCount: h.reloads.length });
}

// Observe rejections immediately: the original null dereference must be evidence, not an unhandled rejection.
function observe(promise) { return promise.then(() => null, error => ({ name: error.name, message: error.message })); }
async function settleAction(h, request, outcome, observed) {
  if (outcome === 200) request.resolve({ items: [{ id: 'synthetic-read-result' }] });
  else request.reject(outcome === 403 ? Object.assign(new Error('Synthetic read forbidden'), { status: 403 })
    : new TypeError('Synthetic read network failure'));
  await tick();
  // Settle only in-memory reload work so a buggy success path cannot leave the focused test pending.
  for (const reload of h.reloads) reload.resolve();
  await tick(); return observed;
}

let actionId = 0;
for (const invalidation of ['close', 'logout-reentry', 'different-operator']) {
  for (const outcome of [200, 403, 'network']) {
    const id = `PREPARED-SESSION-${String(++actionId).padStart(2, '0')}`;
    test(`${id} ${invalidation}: late ${outcome} cannot throw or write previous action UI/history`, async () => {
      const h = harness(); await h.ready();
      const preview = { ...plain(preparedPreview), detailKey: h.api.historyKey(h.detail) };
      h.api.stagePreview(preview); const observed = observe(h.api.run());
      assert.equal(h.actionRequests.length, 1, 'Only one synthetic read is accepted');
      const request = h.actionRequests[0];
      if (invalidation === 'close') h.api.closeConfirm();
      else if (invalidation === 'logout-reentry') {
        h.storage.set('lumina_auth', JSON.stringify(h.api.auth()));
        await h.logout(); await h.reenter();
      } else h.setAuth(operatorB, 'synthetic-access-b');
      const before = actionSnapshot(h);
      const error = await settleAction(h, request, outcome, observed);
      const after = actionSnapshot(h);
      const changed = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
      assert.deepEqual({ error, changed }, { error: null, changed: [] },
        'Received requests are not cancelled/rolled back; only stale client effects must be suppressed');
      assert.equal(h.actionRequests.length, 1, 'No retry policy change or automatic repeat');
    });
  }
}

test('PREPARED-SESSION-10 healthy same-operator token rotation permits normal synthetic-read completion', async () => {
  const h = harness(); await h.ready(); h.api.stagePreview({ ...plain(preparedPreview), detailKey: h.api.historyKey(h.detail) });
  const observed = observe(h.api.run()); h.setAuth(operatorA, 'synthetic-access-a-rotated');
  const error = await settleAction(h, h.actionRequests[0], 200, observed);
  assert.equal(error, null); assert.equal(h.actionRequests.length, 1); assert.equal(h.reloads.length, 1);
  assert.match(h.context.confirmMessage.textContent, /조회가 완료/);
  assert.equal(h.context.confirmRunButton.disabled, true);
  assert.equal(JSON.parse(h.storage.get(h.historyKey))[0].target, preparedPreview.target);
  assert.equal(h.api.selected.row[9], '\uBCF4\uAD00', 'Actual optimistic report status updates only the synthetic DOM');
  assert.equal(h.api.auth().user.id, operatorA);
});

test('PREPARED-SESSION-11 close during awaited reload cannot mutate the selected detail afterward', async () => {
  const h = harness(); await h.ready(); h.api.stagePreview({ ...plain(preparedPreview), detailKey: h.api.historyKey(h.detail) });
  const observed = observe(h.api.run()); h.actionRequests[0].resolve({ items: [] }); await tick();
  assert.equal(h.reloads.length, 1, 'Exercise the separate await-after-reload boundary');
  h.api.closeConfirm(); const before = actionSnapshot(h);
  h.reloads[0].resolve(); const error = await observed;
  assert.deepEqual({ error, snapshot: actionSnapshot(h) }, { error: null, snapshot: before },
    'Closing during reload must suppress the later row/status/classification redraw');
});

test('PREPARED-EXTRA-01 different operator during awaited reload cannot redraw old detail afterward', async () => {
  const h = harness(); await h.ready(); h.api.stagePreview({ ...plain(preparedPreview), detailKey: h.api.historyKey(h.detail) });
  const observed = observe(h.api.run()); h.actionRequests[0].resolve({ items: [] }); await tick();
  assert.equal(h.reloads.length, 1);
  h.setAuth(operatorB, 'synthetic-access-b'); const before = actionSnapshot(h);
  h.reloads[0].resolve(); const error = await observed;
  const after = actionSnapshot(h);
  const changed = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual({ error, changed }, { error: null, changed: [] },
    'Actor continuity must be checked again after the separate reload await');
});

test('PREPARED-EXTRA-02 generic user-read 403 cannot reenable a previous operator command', async () => {
  const h = harness(); await h.ready();
  h.api.stagePreview({ ...plain(preparedPreview), targetType: 'user', detailKey: h.api.historyKey(h.detail) });
  const observed = observe(h.api.run()); h.setAuth(operatorB, 'synthetic-access-b');
  const before = actionSnapshot(h);
  const error = await settleAction(h, h.actionRequests[0], 403, observed);
  const after = actionSnapshot(h);
  const changed = Object.keys(before).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual({ error, changed }, { error: null, changed: [] },
    'Exercise actual generic failure text and retry-button branch, not only report local-record fallback');
});

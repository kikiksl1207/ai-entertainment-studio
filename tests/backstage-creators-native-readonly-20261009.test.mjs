import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { sourceWithoutCreatorsNativeReadonlyDelta } from './support/backstage-creators-native-readonly-inverse-20261009.mjs';
import { sourceWithoutLoginWidthDelta } from './support/backstage-login-width-inverse-20261009.mjs';
import { sourceWithoutCreatorsReadDelta } from './support/backstage-creators-read-inverse-compat-20261009.mjs';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/backstage-creators-native-readonly-delta-20261009.json', import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const MAIN = '/admin/api/v1/backstage/operations/creators';
const ME = '/admin/api/v1/me';
const REFRESH = '/api/v1/auth/refresh';
const page = (items = []) => ({ items, hasMore: false, nextCursor: null });
const tables = ['creatorRows', 'creatorImageRequestRows', 'artistKnowledgeUrlRows', 'aiCreatorRows'];
const options = { timeout: 2000 };

function extract(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
  assert(first >= 0 && last > first, `Source anchors: ${start}`);
  assert.equal(source.indexOf(start, first + 1), -1);
  return source.slice(first, last);
}
const parts = [
  extract('const BACKSTAGE_API_BASE =', 'const loginView ='),
  extract('function getBackstageAuth()', 'function getSavedSection()'),
  extract('async function backstageFetch(', 'window.LuminaBackstageApi ='),
  extract('function normalizeAuthPayload(', 'function loadGoogleSDK()'),
  extract('function publicApiPath(', 'async function verifyAdminAccess()'),
  extract('async function verifyAdminAccess()', 'function statusBadge('),
  extract('function currentAdminRoleName()', 'function syncCurrentAdminContext('),
  extract('function canAccessBackstageSection(', 'function applyPermissionVisibility()'),
  extract('function normalizePage(', 'function readSectionSearch('),
  extract('function firstValue(', 'function splitTargetUsers('),
  extract('function normalizeArtistSlugValue(', 'function slugSafePart('),
  extract('function creatorNameParts(', 'function firstRoleName('),
  extract('function backstageErrorStatus(', 'function formatHistoryTime('),
  extract('async function loadCreatorsSection()', 'async function loadAiContentSection()'),
  extract('function renderRows(', 'function renderSettlementChildren('),
  extract('function renderDetailPanel(', 'function openQuickAction('),
  extract('function openQuickAction(', 'function applyTableSearch('),
  extract('function handleInlineAction(', 'function detailInput('),
  extract('function saveDetailDraft()', 'function renderDetailForm('),
  extract('function renderDetailForm(', 'function getActionProfile('),
  extract('function getActionProfile(', 'function updateDetailActions('),
  extract('function buildActionRequest(', 'function resolveExecutableEndpoint('),
  extract('function resolveExecutableEndpoint(', 'function summarizeApiResult('),
  extract('function buildActionPreview(', 'function settlementStatusLabel('),
  extract('function appendActionHistory(', 'function renderDetailPanel('),
  extract('async function runBackstageRequest(', 'async function reloadCurrentSectionAfterAction()'),
  extract('function closeConfirmModal()', 'async function runPreparedAction()'),
  extract('async function runPreparedAction()', 'function renderBackstageTables()'),
];

function auth(owner = 'a', permissions = ['creators:read'], role = 'sales_admin', suffix = 'original') {
  return { accessToken: `synthetic-access-${owner}-${suffix}`, refreshToken: `synthetic-refresh-${owner}-${suffix}`,
    user: { id: `synthetic-owner-${owner}`, adminRole: role, adminPermissions: permissions,
      adminUser: { id: `synthetic-admin-${owner}`, status: 'active', roleName: role,
        permissions, role: { name: role, permissions } } } };
}
function me(owner = 'a', permissions = ['creators:read'], role = 'sales_admin') {
  return { user: { id: `synthetic-owner-${owner}` },
    admin: { id: `synthetic-admin-${owner}`, status: 'active', role, permissions } };
}
function body(label = 'current') {
  return { applications: page([{ id: `synthetic-application-${label}`, userId: 'synthetic-applicant',
    status: 'submitted', realName: null, applicantName: null, displayName: `Synthetic public ${label}`,
    stageName: `Synthetic public ${label}`, contactAccessAllowed: false, contactMasked: true,
    contactEmail: 's***@example.invalid', user: { id: 'synthetic-applicant', email: null, artists: [] } }]),
    activeCreators: [], aiArtists: [], permissions: { contactAccessAllowed: false } };
}
function classes() {
  const values = new Set();
  return { contains: name => values.has(name), add: name => values.add(name), remove: name => values.delete(name),
    toggle(name, on) { if (on) values.add(name); else values.delete(name); } };
}
function node() { return { classList: classes(), innerHTML: '', textContent: '', value: '', hidden: false, disabled: false, dataset: {} }; }
async function tick() { for (let i = 0; i < 32; i++) await Promise.resolve(); }

// Native extracted frontend code only; all response identities, storage, DOM and transport stay in memory.
function harness({ permissions = ['creators:read'], role = 'sales_admin' } = {}) {
  const initial = auth('a', permissions, role);
  const stores = new Map([['lumina_backstage_auth', JSON.stringify(initial)]]), requests = [], persisted = [], errors = [];
  const nodes = new Map(tables.map(id => [id, node()])), controls = [node(), node(), node()];
  controls[1].hidden = true;
  const detailPanel = node(), detailForm = node(), confirmModal = node();
  const status = { section: 'creators', hidden: false, form: { summary: 'Synthetic approved summary', reviewStatus: 'approved' }, updates: 0, history: 0 };
  const context = {
    window: {}, console: { debug() {}, warn() {} },
    localStorage: { getItem: key => stores.get(key) ?? null, setItem(key, value) { stores.set(key, value); persisted.push(key); }, removeItem: key => stores.delete(key) },
    dashboardView: { classList: { contains: name => name === 'is-hidden' && status.hidden } },
    getCurrentSection: () => status.section,
    sectionState: { creators: { rows: [] }, logs: { rows: [] } }, selectedDetail: null, pendingActionPreview: null,
    document: { getElementById: id => nodes.get(id) ?? null,
      querySelectorAll: selector => selector === '#creators .text-action' ? controls : [], querySelector: () => null },
    tableMeta: Object.fromEntries(tables.map(id => [id, { type: 'Synthetic creators', labels: [] }])),
    detailPanel, detailForm, confirmModal, detailMemo: { value: 'Synthetic review note' },
    detailType: node(), detailTitle: node(), detailList: node(), detailHistoryList: node(),
    confirmRunButton: node(), confirmMessage: node(), confirmPayload: node(),
    renderLoadingRow(id, label = 'loading') { nodes.get(id).innerHTML = label; },
    renderErrorRow(id, label) { nodes.get(id).innerHTML = label; errors.push({ id, label }); },
    statusBadge: value => String(value), renderSettlementChildren: () => '',
    backstageRows: new Proxy({}, { get() { throw new Error('Preview substitution forbidden'); } }),
    renderFallbackNote() { throw new Error('Preview substitution forbidden'); },
    localizeWorkflowStatus: value => value, localizeCreatorImageType: value => value,
    localizeCreatorImageStatus: value => value, localizeModerationStatus: value => value,
    creatorImageRequester: () => 'Synthetic requester', creatorImageCostLabel: () => 'Synthetic cost',
    creatorImageRevisionLabel: () => 'Synthetic revision', countLabel: value => String(value), missingSummary: () => 'Synthetic missing',
    compactText: value => String(value ?? ''), localizeArtistKnowledgeStatus: value => value,
    localizeArtistKnowledgeType: value => value, formatDate: () => 'synthetic-date',
    collectDetailFormData: () => status.form, detailHistoryKey: () => 'synthetic-history-key',
    readDetailDrafts: () => ({}), writeDetailDrafts() { persisted.push('draft'); },
    readActionHistory: () => [], writeActionHistory() { persisted.push('history'); status.history++; },
    currentOperatorLabel: () => 'Synthetic operator', actionChangeLabel: () => 'Synthetic action', renderDetailHistory() {},
    updateDetailActions() {}, syncUserClassificationPanel() {}, selectedCreatorArtist: () => null,
    renderConfirmSummary: () => 'Synthetic result', summarizeApiResult: () => 'Synthetic result',
    reloadCurrentSectionAfterAction: async () => {}, updateSelectedRowStatus() { status.updates++; },
    fetch(url, requestOptions) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { path: new URL(url).pathname, method: requestOptions?.method || 'GET', done: false,
        respond(data, code = 200, jsonPending = null) { this.done = true; resolve({ status: code, ok: code >= 200 && code < 300, json: () => jsonPending || Promise.resolve(data) }); },
        fail(error) { this.done = true; reject(error); } };
      requests.push(request); return promise;
    },
  };
  const run = code => vm.runInContext(code, sandbox, { timeout: 500 });
  const sandbox = vm.createContext(context);
  for (const part of parts) run(part);
  const h = { requests, persisted, errors, nodes, controls, detailPanel, detailForm, status, context, run,
    getAuth: () => JSON.parse(stores.get('lumina_backstage_auth') || 'null'),
    setAuth(value) { run(`setBackstageAuth(${JSON.stringify(value)})`); },
    state: () => plain(context.sectionState.creators),
    load: () => run('loadCreatorsSection()'),
    pending(preview) { context.pendingActionPreview = preview; },
    select(detail) { context.selectedDetail = detail; },
    respondMain(start = 0, data = body(), code = 200) {
      for (const request of requests.slice(start).filter(item => !item.done)) {
        if (request.path === MAIN) request.respond(data, code);
        else if (request.path.includes('creator-image-requests') || request.path.includes('artist-knowledge-urls')) request.respond(page());
      }
    },
    async bootstrap(data = me('a', permissions, role)) {
      const pending = run('verifyAdminAccess()'); pending.catch(() => {});
      await tick(); requests.find(item => !item.done && item.path === ME).respond(data);
      await tick(); requests.find(item => !item.done && item.path.includes('audit-events'))?.respond(page());
      await pending;
    },
  };
  return h;
}
const urlDetail = () => ({ tableId: 'artistKnowledgeUrlRows', type: 'Synthetic creators', labels: [],
  row: ['Synthetic artist', 'submitted', 'url', 'Synthetic summary', '-', '-', 'Review'],
  meta: { knowledgeUrlId: 'synthetic-knowledge', status: 'submitted' } });

test('exact current inverse restores df5f, cbb and1843 without changing old pins', options, () => {
  assert.equal(sha(source), '4780764cf1325e73798af337b3b7bb074dadf96a2a892e94dbd0b36dfc2c342f');
  assert.equal(sha(sourceWithoutCreatorsNativeReadonlyDelta(source)), 'df5f352bae0df49a066035feba1feb9806ff24c2cf35d5e263a8233ed2bf3863');
  assert.equal(sha(sourceWithoutLoginWidthDelta(source)), 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341');
  assert.equal(sha(sourceWithoutCreatorsReadDelta(source)), '1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409');
});

test('inverse rejects edit/outside/fixture drift and allows only CRLF normalization', options, () => {
  assert.equal(sourceWithoutCreatorsNativeReadonlyDelta(source.replace(/\n/g, '\r\n')), sourceWithoutCreatorsNativeReadonlyDelta(source));
  for (const bad of [`x${source}`, `${source}x`, source.replace('let creatorsNativeReadProof = null;', 'let creatorsNativeReadProof = {};')]) {
    assert.throws(() => sourceWithoutCreatorsNativeReadonlyDelta(bad), { code: 'ERR_ASSERTION' });
  }
  const bad = plain(fixture); bad.edits[0].after += 'x';
  assert.throws(() => sourceWithoutCreatorsNativeReadonlyDelta(source, bad), { code: 'ERR_ASSERTION' });
  assert.throws(() => sourceWithoutCreatorsNativeReadonlyDelta(source, { ...fixture, extra: true }), { code: 'ERR_ASSERTION' });
});

test('stored active admin/grants or a cached union alone cannot create new admission', options, () => {
  const h = harness();
  assert.equal(h.run('canAccessBackstageSection("creators", false)'), false);
  assert.equal(h.run('canAccessBackstageSection("creators")'), false);
  const next = h.getAuth(); next.user.permissions = ['creators:*']; h.setAuth(next);
  assert.equal(h.run('canAccessBackstageSection("creators")'), false);
});

test('native same-owner active read/write/resource-wildcard grants add only readonly admission', options, async () => {
  for (const permission of ['creators:read', 'creators:write', 'creators:*']) {
    const h = harness({ permissions: [permission] }); await h.bootstrap();
    assert.equal(h.run('canAccessBackstageSection("creators", false)'), false);
    assert.equal(h.run('canAccessBackstageSection("creators")'), true);
    assert.equal(h.run('creatorsNativeReadonlyCurrent()'), true);
  }
  const existing = harness({ permissions: ['*'] }); await existing.bootstrap();
  assert.equal(existing.run('canAccessBackstageSection("creators", false)'), true);
  assert.equal(existing.run('creatorsNativeReadonlyCurrent()'), false);
});

test('singular/debut/unrelated grants and role label do not count as a new plural grant', options, async () => {
  for (const permission of ['creator:write', 'debut:write', 'users:read']) {
    const h = harness({ permissions: [permission] }); await h.bootstrap();
    assert.equal(h.run('creatorsNativeReadonlyCurrent()'), false);
    assert.equal(h.run('canAccessBackstageSection("creators")'), false);
  }
  const legacy = harness({ permissions: ['creator:read'] }); await legacy.bootstrap();
  assert.equal(legacy.run('canAccessBackstageSection("creators", false)'), true);
  assert.equal(legacy.run('creatorsNativeReadonlyCurrent()'), false);
});

test('wrong-owner/inactive/malformed native proof and later identity/grants changes cannot admit', options, async () => {
  const wrong = harness(); await assert.rejects(wrong.bootstrap(me('b')));
  assert.equal(wrong.run('creatorsNativeReadonlyCurrent()'), false);
  for (const kind of ['inactive', 'malformed']) {
    const h = harness(), data = me();
    if (kind === 'inactive') data.admin.status = 'inactive'; else data.admin.permissions = [42];
    await h.bootstrap(data); assert.equal(h.run('creatorsNativeReadonlyCurrent()'), false);
  }
  const h = harness(); await h.bootstrap(); const next = h.getAuth();
  next.user.adminUser.permissions = []; h.setAuth(next);
  assert.equal(h.run('creatorsNativeReadonlyCurrent()'), false);
});

test('new entry with mixed native write grants still calls main only and leaves auxiliaries restricted', options, async () => {
  const h = harness({ permissions: ['creators:read', 'artists:write', 'assets:write'] }); await h.bootstrap();
  h.requests.length = 0; const pending = h.load(); h.respondMain(); await pending;
  assert.deepEqual(h.requests.map(item => [item.path, item.method]), [[MAIN, 'GET']]);
  assert.equal(h.state().nativeReadonly, true);
  assert.equal(h.state().imageStatus, 'restricted'); assert.equal(h.state().knowledgeStatus, 'restricted');
});

test('native denied-contact projection and confirmed empty stay native; malformed evidence is unknown', options, async () => {
  const h = harness(); await h.bootstrap(); h.requests.length = 0;
  let pending = h.load(); h.respondMain(); await pending;
  const row = h.state().rows[0];
  assert.equal(row.meta.realName, null); assert.equal(row.meta.email, null);
  assert.equal(row.row[0], '-'); assert.equal(row.row[3], '-'); assert.equal(row.row[4], 's***@example.invalid');
  pending = h.load(); h.respondMain(0, { applications: page(), activeCreators: [], aiArtists: [], permissions: { contactAccessAllowed: false } }); await pending;
  assert.equal(h.state().status, 'ready'); assert.deepEqual(h.state().rows, []);
  pending = h.load(); const bad = body(); delete bad.permissions; h.respondMain(0, bad); await pending;
  assert.equal(h.state().status, 'unknown'); assert.equal(h.state().loading, false);
});

test('readonly rows have no actionable payload and controls preserve original hidden state', options, async () => {
  const h = harness(); await h.bootstrap(); const pending = h.load(); h.respondMain(); await pending;
  assert.doesNotMatch(h.nodes.get('creatorRows').innerHTML, /data-detail|row-action/);
  assert(h.controls.every(button => button.hidden && button.disabled));
  h.setAuth(auth('a', ['creators:read', 'artists:write'], 'content_admin'));
  const reload = h.load(); h.respondMain(); await reload;
  assert.equal(h.state().nativeReadonly, false);
  assert.deepEqual(h.controls.map(button => button.hidden), [false, true, false]);
});

test('readonly native detail/form/request/preview/execute/draft/history direct paths do nothing', options, async () => {
  const h = harness(); await h.bootstrap(); const pending = h.load(); h.respondMain(); await pending;
  h.select(urlDetail()); h.detailForm.dataset.draftKey = 'synthetic-draft'; h.detailForm.innerHTML = 'old form';
  const beforeWrites = h.persisted.length, beforeRequests = h.requests.length;
  h.run('renderDetailPanel(selectedDetail); renderDetailForm(selectedDetail); saveDetailDraft();');
  assert.equal(h.detailForm.innerHTML, '');
  assert.equal(h.run('buildActionRequest(selectedDetail, "danger")'), null);
  assert.equal(h.run('resolveExecutableEndpoint("GET /admin/api/v1/creator-image-requests", selectedDetail, "memo")'), null);
  assert.equal(h.run('buildActionPreview("danger")'), null);
  h.pending({ targetType: 'artistKnowledgeUrl', canRunApi: true, apiRequest: { method: 'POST', path: '/admin/api/v1/backstage/operations/artist-knowledge-urls/synthetic-knowledge/approve' } });
  await h.run('runPreparedAction()'); h.run('appendActionHistory(pendingActionPreview);');
  h.run('openQuickAction({}); handleInlineAction({});');
  h.status.section = 'users';
  await h.run('runPreparedAction()'); h.run('appendActionHistory(pendingActionPreview);');
  assert.equal(h.persisted.length, beforeWrites); assert.equal(h.requests.length, beforeRequests);
});

test('readonly success/catch/JSON cannot apply after owner/epoch/grant/section changes', options, async () => {
  for (const kind of ['owner', 'epoch', 'grants', 'section', 'hidden']) {
    for (const fail of [false, true]) {
      const h = harness(); await h.bootstrap(); h.requests.length = 0; const pending = h.load();
      if (kind === 'owner') h.setAuth(auth('b'));
      if (kind === 'epoch') { h.setAuth(null); h.setAuth(auth()); }
      if (kind === 'grants') { const next = h.getAuth(); next.user.adminUser.permissions = []; h.setAuth(next); }
      if (kind === 'section') h.status.section = 'users';
      if (kind === 'hidden') h.status.hidden = true;
      const before = plain(h.context.sectionState), beforeErrors = h.errors.length;
      if (fail) h.requests[0].fail(new Error('Synthetic failure')); else h.respondMain();
      await pending; assert.deepEqual(plain(h.context.sectionState), before); assert.equal(h.errors.length, beforeErrors);
    }
  }
  const h = harness(); await h.bootstrap(); h.requests.length = 0; const pending = h.load();
  let finish; const json = new Promise(resolve => { finish = resolve; }); h.requests[0].respond(null, 200, json);
  await tick(); h.status.section = 'users'; const before = h.state(); finish(body('late')); await pending;
  assert.deepEqual(h.state(), before);
});

test('newest readonly read wins over older success and failure', options, async () => {
  for (const fail of [false, true]) {
    const h = harness(); await h.bootstrap(); h.requests.length = 0;
    const old = h.load(), current = h.load(); h.requests[1].respond(body('newest')); await current;
    const before = h.state(); if (fail) h.requests[0].fail(new Error('Synthetic old failure')); else h.requests[0].respond(body('old'));
    await old; assert.deepEqual(h.state(), before);
  }
});

test('normal native refresh reuses exact same-owner me proof without auxiliary requests', options, async () => {
  const h = harness(); await h.bootstrap(); h.requests.length = 0; const pending = h.load();
  h.requests[0].respond({}, 401); await tick(); assert.equal(h.requests.at(-1).path, REFRESH);
  h.requests.at(-1).respond({ user: { id: 'synthetic-owner-a', status: 'active' }, accessToken: 'synthetic-rotated-access', refreshToken: 'synthetic-rotated-refresh' });
  await tick(); assert.equal(h.requests.at(-1).path, MAIN); h.requests.at(-1).respond(body('refreshed'));
  await tick(); assert.equal(h.requests.at(-1).path, ME); h.requests.at(-1).respond(me()); await pending;
  assert.equal(h.state().status, 'ready'); assert.equal(h.state().nativeReadonly, true);
  assert.deepEqual(h.requests.map(item => item.path), [MAIN, REFRESH, MAIN, ME]);
});

test('changed verified grants after native refresh end as unknown/error without old grant restoration', options, async () => {
  const h = harness(); await h.bootstrap(); h.requests.length = 0; const pending = h.load();
  h.requests[0].respond({}, 401); await tick();
  h.requests.at(-1).respond({ user: { id: 'synthetic-owner-a', status: 'active' }, accessToken: 'synthetic-new-access', refreshToken: 'synthetic-new-refresh' });
  await tick(); h.requests.at(-1).respond(body()); await tick(); h.requests.at(-1).respond(me('a', ['creators:write'])); await pending;
  assert.equal(h.state().status, 'unknown'); assert.equal(h.state().loading, false);
  assert.equal(h.getAuth().user.adminUser, undefined); assert.equal(h.run('creatorsNativeReadonlyCurrent()'), false);
  assert.equal(h.run('buildActionRequest(null, "danger")'), null);
});

test('existing writer pending previews stop after epoch/grants/section change and late responses apply nothing', options, async () => {
  for (const kind of ['epoch', 'grants', 'section']) {
    const h = harness({ role: 'content_admin', permissions: ['creators:read', 'artists:write'] }); await h.bootstrap();
    h.select(urlDetail()); const preview = h.run('buildActionPreview("danger")'); assert(preview?.canRunApi); h.pending(preview);
    if (kind === 'epoch') { h.setAuth(null); h.setAuth(auth('a', ['creators:read', 'artists:write'], 'content_admin')); }
    if (kind === 'grants') h.setAuth(auth('a', ['creators:read'], 'sales_admin'));
    if (kind === 'section') h.status.section = 'users';
    const start = h.requests.length; await h.run('runPreparedAction()'); assert.equal(h.requests.length, start);
  }
  for (const fail of [false, true]) {
    const h = harness({ role: 'content_admin', permissions: ['creators:read', 'artists:write'] }); await h.bootstrap();
    h.select(urlDetail()); const preview = h.run('buildActionPreview("danger")'); h.pending(preview);
    const pending = h.run('runPreparedAction()'); const request = h.requests.at(-1);
    h.setAuth(auth('a', ['creators:read'], 'sales_admin')); const before = h.persisted.length;
    if (fail) request.fail(new Error('Synthetic late failure')); else request.respond({}); await pending;
    assert.equal(h.persisted.length, before); assert.equal(h.status.updates, 0);
  }
});

test('existing native writer remains non-readonly and its original URL approve request is unchanged', options, async () => {
  const h = harness({ role: 'content_admin', permissions: ['creators:read', 'artists:write'] }); await h.bootstrap();
  assert.equal(h.run('canAccessBackstageSection("creators", false)'), true);
  assert.equal(h.run('creatorsNativeReadonlyCurrent()'), false);
  h.select(urlDetail()); const request = h.run('buildActionRequest(selectedDetail, "danger")');
  assert.equal(request.method, 'POST'); assert.equal(request.path, '/admin/api/v1/backstage/operations/artist-knowledge-urls/synthetic-knowledge/approve');
  const preview = h.run('buildActionPreview("danger")'); assert(preview.canRunApi); h.pending(preview);
  const pending = h.run('runPreparedAction()'); h.requests.at(-1).respond({}); await pending;
  assert.equal(h.status.updates, 1); assert.equal(h.status.history, 1);
});

test('other menu predicates/row actions and local memo remain on their original path', options, async () => {
  const h = harness(); await h.bootstrap(); h.status.section = 'users';
  h.context.sectionState.creators.nativeReadonly = true;
  assert.equal(h.run('canAccessBackstageSection("users")'), false);
  h.nodes.set('userRows', node()); h.run('renderRows("userRows", [["Synthetic user", "View"]], -1)');
  assert.match(h.nodes.get('userRows').innerHTML, /data-detail/);
  h.select({ tableId: 'userRows', type: 'Synthetic users', row: ['Synthetic user'], meta: {} });
  const preview = h.run('buildActionPreview("memo")'); assert(preview.canRunLocally); h.pending(preview);
  await h.run('runPreparedAction()'); assert.equal(h.status.history, 1);
});

test('first native me verification also accepts a normal same-owner refresh before recording proof', options, async () => {
  const h = harness(), pending = h.run('verifyAdminAccess()'); pending.catch(() => {});
  await tick(); h.requests[0].respond({}, 401); await tick();
  assert.equal(h.requests.at(-1).path, REFRESH);
  h.requests.at(-1).respond({ user: { id: 'synthetic-owner-a', status: 'active' }, accessToken: 'synthetic-initial-rotated-access', refreshToken: 'synthetic-initial-rotated-refresh' });
  await tick(); assert.equal(h.requests.at(-1).path, ME); h.requests.at(-1).respond(me());
  await tick(); h.requests.at(-1).respond(page()); await pending;
  assert.equal(h.run('creatorsNativeReadonlyCurrent()'), true);
});

test('existing writer command keeps its native normal-refresh retry without new me requests', options, async () => {
  const h = harness({ role: 'content_admin', permissions: ['creators:read', 'artists:write'] }); await h.bootstrap();
  h.requests.length = 0; h.select(urlDetail()); const preview = h.run('buildActionPreview("danger")'); h.pending(preview);
  const pending = h.run('runPreparedAction()'); h.requests[0].respond({}, 401); await tick();
  assert.equal(h.requests.at(-1).path, REFRESH);
  h.requests.at(-1).respond({ user: { id: 'synthetic-owner-a', status: 'active' }, accessToken: 'synthetic-writer-rotated-access', refreshToken: 'synthetic-writer-rotated-refresh' });
  await tick(); assert.equal(h.requests.at(-1).method, 'POST'); h.requests.at(-1).respond({}); await pending;
  assert.equal(h.status.history, 1); assert.equal(h.status.updates, 1);
  assert.deepEqual(h.requests.map(item => item.method), ['POST', 'POST', 'POST']);
  assert.equal(h.requests.filter(item => item.path === ME).length, 0);
});

test('new readonly main 401/403/500 remains unknown rather than empty or preview', options, async () => {
  for (const code of [401, 403, 500]) {
    const h = harness(); await h.bootstrap(); h.requests.length = 0; const pending = h.load();
    h.requests[0].respond({}, code);
    if (code === 401) { await tick(); assert.equal(h.requests.at(-1).path, REFRESH); h.requests.at(-1).respond({}, 401); }
    await pending; assert.equal(h.state().status, 'unknown'); assert.equal(h.state().loading, false);
    assert.deepEqual(h.state().rows, []); assert(h.errors.length > 0);
  }
});

test('native loader/admission anchors and mobile/creator legacy literal pins remain intact', options, () => {
  assert(source.includes('async function loadCreatorsSection() {'));
  assert.equal(source.split('async function loadCreatorsSection() {').length - 1, 1);
  assert.match(source, /function canAccessBackstageSection\(sectionId, allowNativeReadonly = true\)/);
  const mobile = readFileSync(new URL('./support/backstage-login-width-inverse-20261009.mjs', import.meta.url), 'utf8');
  assert(mobile.includes('df5f352bae0df49a066035feba1feb9806ff24c2cf35d5e263a8233ed2bf3863'));
  assert(mobile.includes('cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341'));
});

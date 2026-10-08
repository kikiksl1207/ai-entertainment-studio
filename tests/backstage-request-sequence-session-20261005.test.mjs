import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const actorA = '10000000-0000-4000-8000-000000000001';
const actorB = '10000000-0000-4000-8000-000000000002';
const artistId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const uploadUrl = 'https://synthetic-upload.invalid/qa-object';
const intentPath = '/admin/api/v1/assets/upload-intents';
const confirmPath = `/admin/api/v1/assets/${assetId}/confirm-upload`;
const linkPath = `/admin/api/v1/artists/${artistId}/assets`;
const stepA = '/admin/api/v1/qa/step-a';
const stepB = '/admin/api/v1/qa/step-b';
const batchRequest = () => ({ method: 'BATCH', steps: [
  { method: 'GET', path: stepA }, { method: 'GET', path: stepB },
] });
const file = Object.freeze({ name: 'synthetic-only.png', type: 'image/png', size: 3 });
const uploadRequest = () => ({ method: 'UPLOAD_ASSET', path: intentPath, artistId, file,
  body: { fileName: file.name, mimeType: file.type, fileSizeBytes: file.size, visibility: 'public' },
  linkBody: { usageType: 'synthetic-fixture', isPrimary: false, sortOrder: 0 } });
const intent = (mode = 'put') => ({ asset: { id: assetId }, upload: { url: uploadUrl, method: 'PUT',
  mode, requiredHeaders: { 'content-type': 'image/png', 'x-synthetic-fixture': 'sequence-only' } } });

export function sourceExcerpts(text = source) {
  const anchors = [
    ['constants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
    ['selection', 'let selectedDetail =', 'const sectionState ='],
    ['authStorage', 'function getBackstageAuth(', 'function getSavedSection('],
    ...(text.includes('// BEGIN creators-native-readonly-20261009') ? [
      ['currentSection', 'function getSavedSection(', 'function readDetailDrafts('],
      ['firstValue', 'function firstValue(', 'function splitTargetUsers('],
      ['creatorsNativeHelpers', 'function currentAdminRoleName(', 'function syncCurrentAdminContext('],
      ['nativeSectionAccess', 'function canAccessBackstageSection(', 'function applyPermissionVisibility('],
    ] : []),
    ['normalizeRefresh', 'function normalizeAuthPayload(', 'function applyAdminContext('],
    ['paths', 'function publicApiPath(', 'async function verifyAdminAccess('],
    ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
    ['loginStatus', 'function setStatus(', 'function setLoading('],
    ['escape', 'function escapeHtml(', 'function firstRoleName('],
    ['loadingRows', 'function setLoadMore(', 'function renderFallbackNote('],
    ['errorText', 'function backstageErrorStatus(', 'function artistKnowledgeQueueErrorMessage('],
    ['resultSummary', 'function summarizeApiResult(', 'async function runAssetUploadRequest('],
    ['requestHelpers', 'async function runAssetUploadRequest(', 'async function reloadCurrentSectionAfterAction('],
    ['actionLabel', 'function actionChangeLabel(', 'function optimisticStatusForPreview('],
    ['confirmSummary', 'function renderConfirmSummary(', 'function clearDetailValidationErrors('],
    ['closeAndPrepared', 'function closeConfirmModal(', 'function renderBackstageTables('],
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

const runtime = sourceExcerpts().map(item => item.body).join('\n') + `
let userClassificationDetail = null;
this.api = { request: runBackstageRequest, upload: runAssetUploadRequest, run: runPreparedAction,
  close: closeConfirmModal, auth: getBackstageAuth, setAuth: setBackstageAuth,
  stage(request) {
    pendingActionPreview = { canRunApi: true, canRunLocally: false, apiRequest: request,
      menu: 'Synthetic sequence', actionGroup: 'Synthetic QA', targetType: 'syntheticSequence',
      target: 'synthetic-sequence-target', note: 'RAM-only request chain', requestedAction: 'synthetic-request',
      bodyPreview: { form: {} } };
    confirmPayload.innerHTML = renderConfirmSummary(pendingActionPreview);
    confirmMessage.textContent = 'Synthetic prepared';
    confirmRunButton.disabled = false;
    confirmModal.classList.remove('is-hidden');
  }, get preview() { return pendingActionPreview; }
};`;

class Element {
  constructor() {
    this.dataset = {}; this.value = ''; this.textContent = ''; this.innerHTML = '';
    this.disabled = false; this.hidden = false; this.classes = new Set(); this.listeners = new Map();
    this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name),
      remove: name => this.classes.delete(name), toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name); return force;
      } };
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { assert.ok(this.listeners.has('click')); this.listeners.get('click')({ target: this }); }
}

// Actual client auth/fetch/request/prepared/logout functions; every HTTP response is deferred RAM data.
function harness() {
  const storage = new Map(); const tokens = new Map(); const calls = [];
  const effects = { history: [], updates: [], reloads: 0, debug: [], providerAttempts: 0 };
  const nodes = Object.fromEntries(['dashboardView', 'loginView', 'detailPanel', 'detailType', 'detailTitle',
    'detailList', 'detailMemo', 'detailHistoryList', 'detailForm', 'confirmModal', 'confirmType', 'confirmTitle', 'confirmMessage',
    'confirmPayload', 'confirmRunButton', 'logoutButton', 'passwordInput', 'loginStatus', 'googleButtonFallback',
    'userRows', 'userRiskRows', 'usersClassificationFilter', 'usersStatus', 'operatorEmail', 'more', 'help'].map(name => [name, new Element()]));
  nodes.loginView.classList.add('is-hidden'); nodes.detailPanel.classList.add('is-hidden');
  nodes.confirmModal.classList.add('is-hidden');
  const context = {
    window: { LUMINA_API_BASE: 'https://synthetic-api.invalid' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key) },
    document: {
      getElementById(id) {
        if (id === 'users') return { querySelector(selector) { assert.equal(selector, '[data-users-status]'); return nodes.usersStatus; } };
        return nodes[id] || null;
      },
      querySelector(selector) {
        if (selector === '.detail-help') return nodes.help;
        if (selector === '.dashboard-main') return { getAttribute(name) {
          assert.equal(name, 'data-active-section'); return 'users';
        } };
        if (selector === '[data-load-more="users"]') return nodes.more;
        assert.fail(`Unmodeled DOM selector: ${selector}`);
      },
      querySelectorAll(selector) { assert.equal(selector, 'tr.is-selected'); return []; },
    },
    ...nodes, sectionState: { users: { rows: [], riskRows: [] } }, tableMeta: { userRows: { labels: [] }, userRiskRows: { labels: [] } },
    console: { debug: (...args) => effects.debug.push(plain(args)) },
    appendActionHistory(preview, result) { effects.history.push({ preview: plain(preview), result: plain(result) }); },
    updateSelectedRowStatus(preview) { effects.updates.push(plain(preview)); },
    async reloadCurrentSectionAfterAction() { effects.reloads++; },
    prepareGoogleLoginButton() {
      effects.providerAttempts++; return Promise.reject(new Error('Synthetic provider unavailable; no network'));
    },
    fetch(url, options) {
      // Never delegate to Node/global fetch. Unlisted transport is denied even for synthetic credentials.
      const parsed = new URL(url); const isPut = url === uploadUrl;
      assert.equal(parsed.origin, isPut ? 'https://synthetic-upload.invalid' : 'https://synthetic-api.invalid');
      assert.ok(isPut || [stepA, stepB, intentPath, confirmPath, linkPath].includes(parsed.pathname), 'RAM transport allowlist');
      assert.equal(options.method, isPut ? 'PUT' : [stepA, stepB].includes(parsed.pathname) ? 'GET' : 'POST');
      const auth = context.api.auth(); const bearer = options.headers?.Authorization || null;
      if (bearer) assert.ok(tokens.has(bearer), 'Only registered synthetic bearer tokens are accepted');
      if (isPut) { assert.equal(options.body, file); assert.equal(bearer, null, 'Presigned PUT must not gain admin bearer auth'); }
      else if (options.method === 'POST') assert.ok(options.headers['Content-Type'] === 'application/json');
      return new Promise((resolve, reject) => calls.push({ url, path: parsed.pathname, options,
        actorAtDispatch: auth?.user?.id || auth?.user?.userId || null, bearer, responded: false,
        respond(body, status = 200) {
          assert.equal(this.responded, false); this.responded = true;
          resolve({ status, ok: status >= 200 && status < 300, headers: { get(name) { assert.equal(name, 'etag'); return 'synthetic-etag'; } },
            json: async () => plain(body) });
        },
        reject(error) { assert.equal(this.responded, false); this.responded = true; reject(error); },
      }));
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-request-sequence-session' });
  const api = context.api;
  const setAuth = (actor = actorA, token = 'synthetic-a') => {
    const auth = { accessToken: token, user: { id: actor, adminPermissions: ['*'] } };
    tokens.set(`Bearer ${token}`, actor); api.setAuth(auth); return auth;
  };
  setAuth();
  return { context, api, calls, nodes, effects, storage, setAuth,
    start(request, direct = false) {
      api.stage(request);
      const operation = { settled: false, value: null, error: null };
      const promise = direct ? api.request(request) : api.run();
      promise.then(value => { operation.value = value; operation.settled = true; },
        error => { operation.error = { name: error.name, message: error.message }; operation.settled = true; });
      return operation;
    },
    invalidate(mode) {
      if (mode === 'close') api.close();
      else if (mode === 'logout') {
        storage.set('lumina_auth', JSON.stringify(api.auth())); nodes.logoutButton.click();
        assert.equal(nodes.dashboardView.classList.contains('is-hidden'), true);
        assert.equal(api.preview, null);
        assert.equal(api.auth().user.id, actorA, 'Actual shared fallback remains; no all-store auth rewrite');
      } else { assert.equal(mode, 'operator-change'); setAuth(actorB, 'synthetic-b'); }
    },
  };
}

function respondHealthy(call) {
  call.respond(call.path === intentPath ? intent() : { id: `synthetic-${call.path.split('/').at(-1)}`, ok: true });
}
async function drain(h, operation) {
  for (let attempt = 0; attempt < 32 && !operation.settled; attempt++) {
    for (const call of h.calls) if (!call.responded) respondHealthy(call);
    await tick();
  }
  assert.equal(operation.settled, true, 'In-memory sequence must settle without a server or hanging request');
  return operation;
}
function callSummary(h) {
  return h.calls.map(({ path, options, actorAtDispatch, bearer, responded }) => ({ path,
    method: options.method, actorAtDispatch, bearer, responded }));
}
function uiSnapshot(h) {
  return plain({ message: h.nodes.confirmMessage.textContent, payload: h.nodes.confirmPayload.innerHTML,
    runLabel: h.nodes.confirmRunButton.textContent, disabled: h.nodes.confirmRunButton.disabled,
    help: h.nodes.help.textContent, effects: h.effects });
}
async function pause(h, boundary) {
  if (boundary === 'batch-first' || boundary === 'upload-intent') return;
  assert.equal(h.calls[0].path, intentPath); h.calls[0].respond(intent()); await tick();
  assert.equal(h.calls[1].url, uploadUrl);
  if (boundary === 'upload-put') return;
  assert.equal(boundary, 'upload-confirm'); h.calls[1].respond({}); await tick();
  assert.equal(h.calls[2].path, confirmPath);
}

test('REQUEST-SEQ-01 healthy BATCH completes ordered steps with actual auth and result shape', async () => {
  const h = harness(); const operation = h.start(batchRequest()); await drain(h, operation);
  assert.equal(operation.error, null);
  assert.deepEqual(h.calls.map(call => call.path), [stepA, stepB]);
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer synthetic-a', 'Bearer synthetic-a']);
  assert.equal(h.effects.history.length, 1); assert.equal(h.effects.reloads, 1); assert.equal(h.effects.updates.length, 1);
});

test('REQUEST-SEQ-02 healthy UPLOAD_ASSET completes intent PUT confirm link with unchanged bodies', async () => {
  const h = harness(); const request = uploadRequest(); const operation = h.start(request); await drain(h, operation);
  assert.equal(operation.error, null);
  assert.deepEqual(h.calls.map(call => call.path), [intentPath, '/qa-object', confirmPath, linkPath]);
  assert.deepEqual(JSON.parse(h.calls[0].options.body), request.body);
  assert.deepEqual(plain(h.calls[1].options.headers), intent().upload.requiredHeaders);
  assert.deepEqual(JSON.parse(h.calls[2].options.body), { objectETag: 'synthetic-etag' });
  assert.deepEqual(JSON.parse(h.calls[3].options.body), { ...request.linkBody, assetId });
  assert.equal(h.effects.history.length, 1); assert.equal(h.effects.reloads, 1);
});

let caseId = 2;
for (const boundary of ['batch-first', 'upload-intent', 'upload-put', 'upload-confirm']) {
  for (const invalidation of ['close', 'logout', 'operator-change']) {
    const id = `REQUEST-SEQ-${String(++caseId).padStart(2, '0')}`;
    test(`${id} ${boundary}: ${invalidation} prevents every subsequent subrequest`, async () => {
      const h = harness(); const operation = h.start(boundary === 'batch-first' ? batchRequest() : uploadRequest());
      await pause(h, boundary); const alreadyAccepted = h.calls.length;
      assert.ok(alreadyAccepted >= 1, 'An already received request exists and is not cancelled or rolled back');
      assert.equal(h.calls.at(-1).responded, false, 'Invalidate during the exact awaited request');
      h.invalidate(invalidation); const beforeUi = uiSnapshot(h);
      await drain(h, operation);
      assert.equal(operation.error, null, 'The outer stale guard must consume any invalidation result safely');
      assert.deepEqual(uiSnapshot(h), beforeUi, 'Existing outer guard still suppresses late client effects');
      assert.deepEqual({ requestCount: h.calls.length, newRequests: callSummary(h).slice(alreadyAccepted) },
        { requestCount: alreadyAccepted, newRequests: [] }, 'Session continuity must be checked before each next request, not only final UI');
      assert.ok(h.calls.slice(0, alreadyAccepted).every(call => call.responded), 'Accepted requests are allowed to finish');
    });
  }
}

test('REQUEST-SEQ-15 same-operator token rotation between BATCH steps remains accepted', async () => {
  const h = harness(); const operation = h.start(batchRequest()); h.setAuth(actorA, 'synthetic-a-rotated');
  await drain(h, operation);
  assert.equal(operation.error, null); assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer synthetic-a', 'Bearer synthetic-a-rotated']);
  assert.equal(h.effects.history.length, 1); assert.equal(h.effects.updates.length, 1);
});

test('REQUEST-SEQ-16 same-operator token rotation during PUT keeps confirm and link healthy', async () => {
  const h = harness(); const operation = h.start(uploadRequest()); await pause(h, 'upload-put');
  h.setAuth(actorA, 'synthetic-a-rotated'); await drain(h, operation);
  assert.equal(operation.error, null); assert.equal(h.calls.length, 4);
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer synthetic-a', null, 'Bearer synthetic-a-rotated', 'Bearer synthetic-a-rotated']);
  assert.equal(h.effects.history.length, 1);
});

for (const failure of [500, 'network']) {
  test(`REQUEST-SEQ-${failure === 500 ? '17' : '18'} failed PUT ${failure} never retries or sends confirm/link`, async () => {
    const h = harness(); const operation = h.start(uploadRequest()); await pause(h, 'upload-put');
    if (failure === 500) h.calls[1].respond({}, 500); else h.calls[1].reject(new TypeError('Synthetic PUT network failure'));
    await drain(h, operation);
    assert.equal(operation.error, null);
    assert.deepEqual(h.calls.map(call => call.path), [intentPath, '/qa-object']);
    assert.equal(h.effects.history.length, 1, 'Keep the existing generic outer failure-record behavior');
    assert.equal(h.nodes.confirmRunButton.disabled, false, 'No automatic retry; existing explicit retry UI is preserved');
    assert.equal(h.effects.reloads, 0); assert.equal(h.effects.updates.length, 0);
  });
}

test('REQUEST-SEQ-19 omitted optional predicate preserves same-operator internal BATCH contract and results', async () => {
  const h = harness(); const operation = h.start(batchRequest(), true);
  h.api.close(); h.setAuth(actorA, 'synthetic-a-rotated'); await drain(h, operation);
  assert.equal(operation.error, null);
  assert.deepEqual(plain(operation.value), { ok: true, results: [{ id: 'synthetic-step-a', ok: true }, { id: 'synthetic-step-b', ok: true }] });
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer synthetic-a', 'Bearer synthetic-a-rotated']);
  assert.equal(h.effects.history.length, 0, 'Direct helper calls are distinct from the prepared UI sequence');
});

test('REQUEST-SEQ-22 omitted optional predicate still rejects cross-operator continuation', async () => {
  const h = harness(); const operation = h.start(batchRequest(), true);
  h.api.close(); h.setAuth(actorB, 'synthetic-b'); await drain(h, operation);
  assert.notEqual(operation.error, null);
  assert.equal(operation.error.message, '요청한 운영자 세션이 변경되었습니다.');
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer synthetic-a']);
  assert.equal(h.api.auth().user.id, actorB);
  assert.equal(h.api.auth().accessToken, 'synthetic-b');
  assert.equal(h.effects.history.length, 0);
  assert.equal(h.effects.reloads, 0);
  assert.equal(h.effects.updates.length, 0);
});

test('REQUEST-SEQ-20 metadata-only upload keeps the existing intent and link return contract', async () => {
  const h = harness(); const operation = h.start(uploadRequest(), true);
  h.calls[0].respond(intent('metadata_only')); await drain(h, operation);
  assert.equal(operation.error, null);
  assert.deepEqual(h.calls.map(call => call.path), [intentPath, linkPath]);
  assert.deepEqual(plain(operation.value), { intent: intent('metadata_only'), link: { id: 'synthetic-assets', ok: true } });
});

test('REQUEST-SEQ-21 nested BATCH forwards the prepared current predicate into UPLOAD_ASSET', async () => {
  const h = harness(); const request = { method: 'BATCH', steps: [{ method: 'BATCH', steps: [uploadRequest()] },
    { method: 'GET', path: stepB }] };
  const operation = h.start(request); await pause(h, 'upload-put'); const accepted = h.calls.length;
  h.setAuth(actorB, 'synthetic-b'); const beforeUi = uiSnapshot(h); await drain(h, operation);
  assert.equal(operation.error, null); assert.deepEqual(uiSnapshot(h), beforeUi);
  assert.deepEqual({ requestCount: h.calls.length, newRequests: callSummary(h).slice(accepted) },
    { requestCount: accepted, newRequests: [] }, 'Predicate propagation must survive recursive BATCH and upload delegation');
});

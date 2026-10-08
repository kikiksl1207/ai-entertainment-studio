import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.env.BACKSTAGE_REFRESH_TEST_SOURCE || new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const actorA = '10000000-0000-4000-8000-000000000001';
const actorB = '10000000-0000-4000-8000-000000000002';
const readPath = '/admin/api/v1/admin-users';
const refreshPath = '/api/v1/auth/refresh';

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
this.api = { fetch: backstageFetch, refresh: refreshBackstageAuthOnce, auth: getBackstageAuth,
  setAuth: setBackstageAuth, normalize: normalizeAuthPayload, run: runPreparedAction, close: closeConfirmModal,
  stage() {
    pendingActionPreview = { canRunApi: true, canRunLocally: false,
      apiRequest: { method: 'GET', path: '/admin/api/v1/admin-users', body: { syntheticIgnoredGetBody: true } },
      menu: 'Synthetic read', actionGroup: 'Synthetic QA', targetType: 'syntheticRead',
      target: 'synthetic-only', note: 'RAM-only', requestedAction: 'read', bodyPreview: { form: {} } };
    confirmRunButton.disabled = false; confirmModal.classList.remove('is-hidden');
  }
};`;

class Element {
  constructor() {
    this.dataset = {}; this.value = ''; this.textContent = ''; this.innerHTML = ''; this.disabled = false;
    this.hidden = false; this.classes = new Set(); this.listeners = new Map();
    this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name),
      remove: name => this.classes.delete(name), toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name); else this.classes.delete(name); return force;
      } };
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { assert.ok(this.listeners.has('click')); this.listeners.get('click')({ target: this }); }
}

function harness() {
  const storage = new Map(); const tokens = new Map(); const refreshTokens = new Set(); const calls = [];
  const effects = { history: [], updates: [], reloads: 0, providerAttempts: 0 };
  const nodes = Object.fromEntries(['dashboardView', 'loginView', 'detailPanel', 'detailType', 'detailTitle', 'detailList',
    'detailMemo', 'detailHistoryList', 'detailForm', 'confirmModal', 'confirmType', 'confirmTitle', 'confirmMessage',
    'confirmPayload', 'confirmRunButton', 'logoutButton', 'passwordInput', 'loginStatus', 'googleButtonFallback',
    'userRows', 'userRiskRows', 'usersClassificationFilter', 'usersStatus', 'operatorEmail', 'more', 'help'].map(name => [name, new Element()]));
  nodes.loginView.classList.add('is-hidden'); nodes.confirmModal.classList.add('is-hidden');
  const context = { ...nodes, window: { LUMINA_API_BASE: 'https://synthetic-refresh.invalid' },
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
    sectionState: { users: { rows: [], riskRows: [] } },
    tableMeta: { userRows: { labels: [] }, userRiskRows: { labels: [] } },
    console: { debug() {} },
    appendActionHistory(preview, result) { effects.history.push({ preview: plain(preview), result: plain(result) }); },
    updateSelectedRowStatus(preview) { effects.updates.push(plain(preview)); },
    async reloadCurrentSectionAfterAction() { effects.reloads++; },
    prepareGoogleLoginButton() { effects.providerAttempts++; return Promise.reject(new Error('Synthetic provider unavailable')); },
    fetch(url, options) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://synthetic-refresh.invalid'); assert.equal(parsed.search, '');
      assert.ok([readPath, refreshPath].includes(parsed.pathname), 'Deny all transport outside the two RAM routes');
      const bearer = options.headers?.Authorization || null;
      if (parsed.pathname === readPath) {
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        assert.ok(tokens.has(bearer), 'Only registered synthetic bearer tokens may reach the read route');
      } else {
        assert.equal(options.method, 'POST'); assert.equal(bearer, null);
        assert.equal(options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body), ['refreshToken']);
        assert.ok(refreshTokens.has(body.refreshToken), 'Only registered synthetic refresh tokens are accepted');
      }
      return new Promise((resolve, reject) => calls.push({ path: parsed.pathname, options, bearer, responded: false,
        respond(body, status = 200) { assert.equal(this.responded, false); this.responded = true;
          resolve({ status, ok: status >= 200 && status < 300, json: async () => plain(body) }); },
        reject(error) { assert.equal(this.responded, false); this.responded = true; reject(error); },
      }));
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-auth-refresh-boundary' });
  const api = context.api;
  function payload(actor = actorA, accessToken = 'ram-access-a', refreshToken = 'ram-refresh-a') {
    if (accessToken) tokens.set(`Bearer ${accessToken}`, actor);
    if (refreshToken) refreshTokens.add(refreshToken);
    return { accessToken, refreshToken, user: { id: actor, adminPermissions: ['*'] } };
  }
  const setAuth = (actor = actorA, accessToken = 'ram-access-a', refreshToken = 'ram-refresh-a') => {
    const auth = payload(actor, accessToken, refreshToken); api.setAuth(auth); return auth;
  };
  setAuth();
  const observe = promise => {
    const operation = { settled: false, value: null, error: null };
    promise.then(value => { operation.value = value; operation.settled = true; },
      error => { operation.error = { name: error.name, status: error.status, message: error.message }; operation.settled = true; });
    return operation;
  };
  const h = { api, context, nodes, storage, calls, effects, payload, setAuth,
    start(options = {}) { return observe(api.fetch(readPath, { auth: true, ...options })); },
    prepared() { api.stage(); return observe(api.run()); },
    directRefresh() { return observe(api.refresh()); },
    logout(shared = false) {
      if (shared) storage.set('lumina_auth', JSON.stringify(api.auth()));
      nodes.logoutButton.click();
      assert.equal(nodes.dashboardView.classList.contains('is-hidden'), true);
      assert.equal(storage.has('lumina_backstage_auth'), false);
      assert.equal(Boolean(api.auth()), shared);
    },
    async drain(operation) {
      for (let attempt = 0; attempt < 24 && !operation.settled; attempt++) {
        for (const call of calls) if (!call.responded) {
          if (call.path === readPath) call.respond({ items: [{ id: 'synthetic-read-only' }], hasMore: false });
          else {
            const refreshToken = JSON.parse(call.options.body).refreshToken;
            const actor = refreshToken.includes('-b') ? actorB : actorA;
            call.respond(payload(actor, actor === actorA ? 'ram-returned-a' : 'ram-returned-b', refreshToken));
          }
        }
        await tick();
      }
      assert.equal(operation.settled, true, 'Deferred RAM operation must settle without hanging or an external service');
    },
  };
  return h;
}

const authSnapshot = h => plain({ auth: h.api.auth(), storage: [...h.storage.entries()] });
const effectsSnapshot = h => plain({ message: h.nodes.confirmMessage.textContent, payload: h.nodes.confirmPayload.innerHTML,
  disabled: h.nodes.confirmRunButton.disabled, label: h.nodes.confirmRunButton.textContent, effects: h.effects });
async function awaitRefresh(h, operation) {
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, readPath);
  h.calls[0].respond({ message: 'Synthetic expired access' }, 401); await tick();
  assert.equal(operation.settled, false); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].path, refreshPath);
  assert.equal(JSON.parse(h.calls[1].options.body).refreshToken, 'ram-refresh-a');
}

test('AUTH-REFRESH-01 actual normalization/get/set/clear/shared fallback and prepared GET body contract', async () => {
  const h = harness(); h.api.setAuth(null);
  h.storage.set('lumina_auth', JSON.stringify({ access_token: 'ram-access-a', refresh_token: 'ram-refresh-a', viewer: { id: actorA } }));
  assert.equal(h.api.auth().accessToken, 'ram-access-a'); assert.equal(h.api.auth().user.id, actorA);
  assert.equal(h.storage.has('lumina_backstage_auth'), false);
  const operation = h.prepared(); await h.drain(operation);
  assert.equal(operation.error, null); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.body, undefined);
  assert.equal(h.effects.history.length, 1); assert.equal(h.effects.reloads, 1);
});

test('AUTH-REFRESH-02 healthy 401 performs exactly one refresh and one GET retry with unchanged contract', async () => {
  for (const shape of ['camel', 'snake']) {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation);
  if (shape === 'snake') {
    const payload = h.payload(actorA, 'ram-returned-a');
    h.calls[1].respond({ access_token: payload.accessToken, refresh_token: payload.refreshToken, viewer: payload.user });
  }
  await h.drain(operation);
  assert.equal(operation.error, null); assert.deepEqual(h.calls.map(call => call.path), [readPath, refreshPath, readPath]);
  assert.deepEqual(h.calls.map(call => call.bearer), ['Bearer ram-access-a', null, 'Bearer ram-returned-a']);
  assert.equal(h.api.auth().user.id, actorA); assert.equal(h.api.auth().accessToken, 'ram-returned-a');
  assert.ok(h.calls.filter(call => call.path === readPath).every(call => call.options.body === undefined));
  }
});

test('AUTH-REFRESH-03 same-A access-token rotation before and during refresh stays healthy', async () => {
  const h = harness(); const operation = h.start(); h.setAuth(actorA, 'ram-access-a-rotated');
  await awaitRefresh(h, operation); h.setAuth(actorA, 'ram-access-a-rotated-again'); await h.drain(operation);
  assert.equal(operation.error, null); assert.equal(h.calls.length, 3); assert.equal(h.api.auth().user.id, actorA);
  assert.equal(h.calls[2].bearer, 'Bearer ram-returned-a');
});

test('AUTH-REFRESH-04 current 403 does not refresh or retry and preserves auth/error status', async () => {
  const h = harness(); const before = authSnapshot(h); const operation = h.start();
  h.calls[0].respond({ message: 'Synthetic denied' }, 403); await h.drain(operation);
  assert.equal(operation.error.status, 403); assert.equal(h.calls.length, 1); assert.deepEqual(authSnapshot(h), before);
});

test('AUTH-REFRESH-05 failed refresh HTTP/network does not retry refresh or original GET', async () => {
  for (const mode of ['http', 'network']) {
    const h = harness(); const before = authSnapshot(h); const operation = h.start(); await awaitRefresh(h, operation);
    if (mode === 'http') h.calls[1].respond({ message: 'Synthetic refresh failed' }, 500);
    else h.calls[1].reject(new Error('Synthetic RAM transport failure'));
    await h.drain(operation); assert.equal(operation.error.status, 401); assert.equal(h.calls.length, 2);
    assert.deepEqual(authSnapshot(h), before);
  }
});

test('AUTH-REFRESH-06 retry returning 401 stops after one refresh without recursive automatic attempts', async () => {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation);
  h.calls[1].respond(h.payload(actorA, 'ram-returned-a')); await tick();
  assert.equal(h.calls.length, 3); h.calls[2].respond({ message: 'Synthetic retry denied' }, 401); await h.drain(operation);
  assert.equal(operation.error.status, 401); assert.equal(h.calls.length, 3);
});

test('AUTH-REFRESH-07 refresh-only initial session obtains one access token before its first GET', async () => {
  const h = harness(); h.setAuth(actorA, null); const operation = h.start();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, refreshPath); await h.drain(operation);
  assert.equal(operation.error, null); assert.deepEqual(h.calls.map(call => call.path), [refreshPath, readPath]);
  assert.equal(h.calls[1].options.body, undefined); assert.equal(h.calls[1].bearer, 'Bearer ram-returned-a');
});

test('AUTH-REFRESH-08 A original GET 401 after B replacement cannot refresh B or resend A request', async () => {
  const h = harness(); const operation = h.start(); assert.equal(h.calls[0].bearer, 'Bearer ram-access-a');
  h.setAuth(actorB, 'ram-access-b', 'ram-refresh-b'); const before = authSnapshot(h);
  h.calls[0].respond({ message: 'Synthetic late A expiry' }, 401); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h) }, { calls: 1, auth: before },
    'Do not start B refresh/retry for an obsolete A request; the first received GET may finish');
});

test('AUTH-REFRESH-09 pending A refresh after B login cannot overwrite B or dispatch a retry', async () => {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation);
  h.setAuth(actorB, 'ram-access-b', 'ram-refresh-b'); const before = authSnapshot(h); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h) }, { calls: 2, auth: before });
});

test('AUTH-REFRESH-10 actual logout with shared A fallback rejects held refresh persistence and retry', async () => {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation); h.logout(true);
  assert.equal(h.api.auth().user.id, actorA, 'Shared fallback is real; do not clear unrelated stores in the fixture');
  const before = authSnapshot(h); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h) }, { calls: 2, auth: before });
});

test('AUTH-REFRESH-11 logout then same-A reentry cannot accept a pre-logout held refresh', async () => {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation); h.logout();
  h.setAuth(actorA); h.nodes.dashboardView.classList.remove('is-hidden'); const before = authSnapshot(h);
  await h.drain(operation); assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h) }, { calls: 2, auth: before },
    'Same ID/token values do not erase a real logout/session generation change');
});

test('AUTH-REFRESH-12 same-A newer refresh credential cannot be overwritten by an older direct refresh', async () => {
  const h = harness(); const operation = h.directRefresh(); assert.equal(h.calls[0].path, refreshPath);
  h.setAuth(actorA, 'ram-access-a-new-session', 'ram-refresh-a-new-session'); const before = authSnapshot(h);
  await h.drain(operation); assert.equal(h.calls.length, 1); assert.deepEqual(authSnapshot(h), before);
});

test('AUTH-REFRESH-13 options.isCurrent becoming false during refresh blocks persistence and retry', async () => {
  const h = harness(); let current = true; const operation = h.start({ isCurrent: () => current });
  await awaitRefresh(h, operation); current = false; const before = authSnapshot(h); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h) }, { calls: 2, auth: before });
});

test('AUTH-REFRESH-14 actual prepared close forwards current predicate and blocks the internal late-401 refresh', async () => {
  const h = harness(); const operation = h.prepared(); assert.equal(h.calls.length, 1);
  h.api.close(); const beforeAuth = authSnapshot(h); const beforeEffects = effectsSnapshot(h);
  h.calls[0].respond({ message: 'Synthetic expired access after close' }, 401); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h), effects: effectsSnapshot(h) },
    { calls: 1, auth: beforeAuth, effects: beforeEffects });
});

test('AUTH-REFRESH-15 malformed refresh 200 null/missing/non-string token is failure, not old-token success', async () => {
  const results = [];
  for (const body of [null, { user: { id: actorA } }, { accessToken: 42, refreshToken: 'ram-refresh-a' }]) {
    const h = harness(); const before = authSnapshot(h); const operation = h.start(); await awaitRefresh(h, operation);
    h.calls[1].respond(body); await h.drain(operation);
    results.push({ calls: h.calls.length, status: operation.error?.status || null, unchanged: JSON.stringify(authSnapshot(h)) === JSON.stringify(before) });
  }
  assert.deepEqual(results, Array.from({ length: 3 }, () => ({ calls: 2, status: 401, unchanged: true })),
    'Validate the received token payload before merging any previous session token');
});

test('AUTH-REFRESH-16 actual UPLOAD_ASSET delegation forwards the same predicate to intent confirm and link', async () => {
  const excerpts = sourceExcerpts(); const calls = []; let predicateChecks = 0;
  const predicate = () => { predicateChecks++; return true; };
  const assetId = '30000000-0000-4000-8000-000000000001';
  const artistId = '20000000-0000-4000-8000-000000000001';
  const intentPath = '/admin/api/v1/assets/upload-intents';
  const expectedPaths = [intentPath, `/admin/api/v1/assets/${assetId}/confirm-upload`, `/admin/api/v1/artists/${artistId}/assets`];
  const putUrl = 'https://synthetic-upload.invalid/predicate-only';
  const file = Object.freeze({ name: 'synthetic.png', type: 'image/png', size: 3 });
  const context = {
    async backstageFetch(path, options) {
      assert.equal(path, expectedPaths[calls.length]); assert.equal(options.method, 'POST'); assert.equal(options.auth, true);
      assert.equal(options.isCurrent, predicate, 'All three API phases must carry the initiating caller predicate');
      calls.push({ path, options });
      return path === intentPath ? { asset: { id: assetId }, upload: { url: putUrl, method: 'PUT' } } : { synthetic: true };
    },
    async fetch(url, options) {
      assert.equal(url, putUrl); assert.equal(options.method, 'PUT'); assert.equal(options.body, file);
      return { ok: true, headers: { get(name) { assert.equal(name, 'etag'); return 'synthetic-etag'; } } };
    },
  };
  // Wiring-only RAM spies; no shared refresh implementation or external transport is replaced in the first 15 tests.
  runInNewContext(excerpts.find(item => item.name === 'paths').body + '\n'
    + excerpts.find(item => item.name === 'requestHelpers').body + '\nthis.request = runBackstageRequest;', context);
  const result = await context.request({ method: 'UPLOAD_ASSET', path: intentPath, artistId, file,
    body: { fileName: file.name }, linkBody: { usageType: 'synthetic-fixture' } }, predicate);
  assert.deepEqual(calls.map(call => call.path), expectedPaths); assert.ok(predicateChecks >= 5);
  assert.deepEqual(plain(calls[1].options.body), { objectETag: 'synthetic-etag' });
  assert.deepEqual(plain(calls[2].options.body), { usageType: 'synthetic-fixture', assetId });
  assert.equal(result.link.synthetic, true);
});

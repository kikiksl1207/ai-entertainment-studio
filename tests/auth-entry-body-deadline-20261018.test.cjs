'use strict';

// Bounded synthetic regression for the registered combined application source.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { TextDecoder } = require('node:util');
const vm = require('node:vm');
const { restoreOwnedFeedLightboxLifetimeDelta } = require('./support/auth-login-failclosed-inverse-20261017.cjs');

const sourceRoot = path.resolve(__dirname, '..');
const version = 'candidate';
const bytes = readFileSync(path.join(path.resolve(sourceRoot), 'app.js'));
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const canonicalApp = decoded.replace(/\r\n/g, '\n');
const app = restoreOwnedFeedLightboxLifetimeDelta(canonicalApp);
assert.equal(decoded.startsWith('\uFEFF'), false);
assert.equal(Buffer.from(decoded).equals(bytes), true);
assert.equal(app.includes('\r'), false);
assert.equal(decoded === canonicalApp || decoded === canonicalApp.replace(/\n/g, '\r\n'), true);
assert.equal(Buffer.byteLength(app), 430667);
assert.equal(createHash('sha256').update(app).digest('hex'),
  'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2', 'FROZEN_APP_SHA256');

function uniqueMarker(pattern, label) {
  const matches = [...app.matchAll(pattern)];
  assert.equal(matches.length, 1, 'UNIQUE_SOURCE_MARKER:' + label);
  return matches[0].index;
}
const start = uniqueMarker(/^const API_BASE = /gm, 'API_BASE');
const end = uniqueMarker(/^const I18N_LOCALES = /gm, 'I18N_LOCALES');
const apiStart = uniqueMarker(/^async function apiFetch\(/gm, 'apiFetch');
assert.ok(start < apiStart && apiStart < end, 'ACTUAL_API_PREFIX_BOUNDARIES');
// Evaluate the unchanged complete API prefix, including its real auth helpers.
const actual = new vm.Script(app.slice(start, end) +
  '\nglobalThis.__qaApi = { apiFetch, apiBase: API_BASE };', { filename: 'actual-app-api-prefix.js' });

const DRAIN_STEPS = 64;
const DEADLINE = 8000;
const VM_LIMIT_MS = 1000;
const TEST_LIMIT_MS = 5000;
const PAYLOAD = Object.freeze({ kind: 'synthetic-entry-body', value: 7 });
const EXTRA_HEADERS = Object.freeze({ 'X-QA-Request': 'synthetic-only' });
const SUCCESS_BODY = Object.freeze({ accepted: true, kind: 'synthetic-response' });
const CLEANUP_BODY = Object.freeze({ kind: 'fixture-cleanup-only' });
const ENTRY_ROUTES = ['/api/v1/auth/login', '/api/v1/auth/register'];
async function drain() {
  for (let index = 0; index < DRAIN_STEPS; index++) await Promise.resolve();
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // An unused synthetic body can be aborted before json() is called.
  promise.catch(() => {});
  return { promise, resolve, reject };
}
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}
function entryOptions(extra = {}) {
  return Object.freeze({ method: 'POST', auth: false, throwOnError: true,
    body: PAYLOAD, headers: EXTRA_HEADERS, ...extra });
}

function fixture({ route, status = 200, options = entryOptions() }) {
  const effects = { fixtureFaults: 0, writes: 0, removes: 0, events: 0 };
  const calls = [], created = [], fired = [], cleared = [];
  const active = new Map();
  const headers = deferred(), body = deferred();
  const bodyState = { jsonCalls: 0, aborts: 0, settled: false, forcedReleases: 0 };
  const inputSnapshot = JSON.stringify(options);
  let signal, abortListener, headersSettled = false, operation;
  const checked = callback => (...args) => {
    try { return callback(...args); }
    catch (error) { effects.fixtureFaults++; throw error; }
  };
  const forbidden = label => checked(() => { throw new Error('FORBIDDEN_FIXTURE_EFFECT:' + label); });
  function resolveBody(value) {
    if (!bodyState.settled) { bodyState.settled = true; body.resolve(value); }
  }
  function rejectBody(error) {
    if (!bodyState.settled) { bodyState.settled = true; body.reject(error); }
  }
  function failHeaders(error) {
    if (!headersSettled) { headersSettled = true; headers.reject(error); }
  }
  const response = {
    status, ok: status >= 200 && status < 300,
    json: checked(() => {
      bodyState.jsonCalls++;
      assert.equal(bodyState.jsonCalls, 1, 'ONE_JSON_READ');
      return body.promise;
    }),
  };
  const context = vm.createContext({
    AbortController, Event,
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem: checked(key => { assert.equal(key, 'lumina_auth'); return null; }),
      setItem: checked(() => { effects.writes++; throw new Error('STORAGE_WRITE'); }),
      removeItem: checked(() => { effects.removes++; throw new Error('STORAGE_REMOVE'); }),
    },
    dispatchEvent: checked(() => { effects.events++; throw new Error('AUTH_EVENT'); }),
    console: { info() {}, warn() {}, error() {}, log() {} },
    setTimeout: checked((callback, delay) => {
      assert.equal(typeof callback, 'function');
      assert.equal(delay, DEADLINE, 'ONLY_EXISTING_8000MS_TIMER');
      assert.equal(created.length, 0, 'NO_REPLACEMENT_OR_ADDITIONAL_DEADLINE');
      const id = created.length + 1;
      const timer = { id, callback, delay };
      created.push(timer); active.set(id, timer);
      return id;
    }),
    clearTimeout: checked(id => { cleared.push(id); active.delete(id); }),
    setInterval: forbidden('interval'),
    fetch: checked((url, request) => {
      calls.push({ url, options: request });
      assert.equal(calls.length, 1, 'ONE_REQUEST_NO_REPLAY_OR_REFRESH');
      signal = request.signal;
      assert.ok(signal && typeof signal.addEventListener === 'function', 'REQUEST_ABORT_SIGNAL');
      assert.equal(signal.aborted, false, 'REQUEST_STARTS_UNABORTED');
      abortListener = () => {
        bodyState.aborts++;
        const error = new DOMException('Synthetic response aborted', 'AbortError');
        failHeaders(error);
        rejectBody(error);
      };
      signal.addEventListener('abort', abortListener, { once: true });
      return headers.promise;
    }),
    __qaRoute: route, __qaOptions: options,
  });
  context.window = context;
  actual.runInContext(context, { timeout: VM_LIMIT_MS });

  function begin() {
    assert.equal(operation, undefined, 'ONE_OPERATION_PER_FIXTURE');
    operation = { done: false, kind: 'pending', value: undefined, error: undefined };
    const promise = vm.runInContext('__qaApi.apiFetch(__qaRoute, __qaOptions)', context,
      { timeout: VM_LIMIT_MS });
    promise.then(value => {
      operation.value = value; operation.kind = 'fulfilled'; operation.done = true;
    }, error => {
      operation.error = error; operation.kind = 'rejected'; operation.done = true;
    });
    return operation;
  }
  function openHeaders() {
    if (!headersSettled) { headersSettled = true; headers.resolve(response); }
  }
  function deadline() {
    assert.equal(created.length, 1, 'EXACTLY_ONE_DEADLINE');
    assert.equal(created[0].delay, DEADLINE, 'UNCHANGED_8000MS_DEADLINE');
    return created[0].id;
  }
  function fireIfActive(id) {
    const timer = active.get(id);
    if (!timer) return false;
    active.delete(id); fired.push(id); timer.callback();
    return true;
  }
  function assertRequest() {
    assert.equal(calls.length, 1, 'ONE_REQUEST_NO_REPLAY_OR_REFRESH');
    const request = calls[0].options;
    assert.equal(calls[0].url, context.__qaApi.apiBase + route, 'UNCHANGED_EXACT_REQUEST_URL');
    assert.equal(request.method, options.method === undefined ? 'GET' : options.method);
    assert.equal(request.body, options.body ? JSON.stringify(options.body) : undefined, 'UNCHANGED_PAYLOAD');
    const expectedHeaders = {};
    if (options.body) expectedHeaders['Content-Type'] = 'application/json';
    Object.assign(expectedHeaders, options.headers || {});
    assert.deepEqual(plain(request.headers), expectedHeaders, 'UNCHANGED_HEADERS_NO_CREDENTIALS');
    assert.deepEqual(Object.keys(request).sort(), ['body', 'headers', 'method', 'signal']);
    assert.equal(request.signal, signal);
    assert.equal(JSON.stringify(options), inputSnapshot, 'CALLER_OPTIONS_NOT_MUTATED');
    assert.equal(effects.writes + effects.removes + effects.events, 0, 'NO_AUTH_OR_SETTINGS_EFFECTS');
    assert.equal(effects.fixtureFaults, 0, 'STICKY_FIXTURE_FAULT');
    deadline();
  }
  function assertFinished() {
    assert.equal(operation.done, true, 'OPERATION_FINISHED_WITHOUT_FORCED_RELEASE');
    assert.equal(active.size, 0, 'NO_ACTIVE_TIMER_AFTER_COMPLETION');
    assert.equal(cleared.at(-1), deadline(), 'FINALLY_CLEARED_ORIGINAL_TIMER');
    assert.equal(bodyState.forcedReleases, 0, 'NO_CLEANUP_AS_TIMEOUT_WITNESS');
    assertRequest();
  }
  async function dispose() {
    try {
      // Capture assertions before this point; never await an unfinished product promise.
      openHeaders();
      if (!bodyState.settled) { bodyState.forcedReleases++; resolveBody(CLEANUP_BODY); }
      await drain();
      if (operation) assert.equal(operation.done, true, 'FIXTURE_BOUNDED_CLEANUP_SETTLED');
      assert.equal(active.size, 0, 'FIXTURE_FINAL_TIMER_CLEANUP');
      assert.equal(effects.fixtureFaults, 0, 'STICKY_FIXTURE_FAULT');
    } finally {
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
      active.clear();
    }
  }
  return { effects, calls, created, fired, cleared, active, bodyState, begin, openHeaders,
    resolveBody, rejectBody, failHeaders, deadline, fireIfActive, assertRequest, assertFinished,
    dispose, signal: () => signal };
}

async function use(state, options, callback) {
  const f = fixture(options);
  state.scenarios++;
  try { return await callback(f); }
  finally {
    try { await f.dispose(); }
    finally { state.fixtureFaults += f.effects.fixtureFaults; }
  }
}
function group(name, label, expectedScenarios, callback) {
  test(name, { timeout: TEST_LIMIT_MS, concurrency: false }, async t => {
    const state = { fixtureFaults: 0, semanticOriginalWitness: false, scenarios: 0 };
    try {
      await callback(state);
      assert.equal(state.scenarios, expectedScenarios, 'FINITE_GROUP_SCENARIO_COUNT');
    } finally {
      t.diagnostic(JSON.stringify({ contract: 'auth-entry-body-deadline-v1', variant: version,
        case: label, semanticOriginalWitness: state.semanticOriginalWitness,
        fixtureFaults: state.fixtureFaults }));
    }
  });
}

const regressionCases = [
  { name: 'pending login success body remains within the existing deadline', label: 'login-success',
    route: ENTRY_ROUTES[0], status: 200 },
  { name: 'pending login error body remains within the existing deadline', label: 'login-error',
    route: ENTRY_ROUTES[0], status: 400 },
  { name: 'pending register success body remains within the existing deadline', label: 'register-success',
    route: ENTRY_ROUTES[1], status: 200 },
  { name: 'pending register error body remains within the existing deadline', label: 'register-error',
    route: ENTRY_ROUTES[1], status: 400 },
];
assert.equal(regressionCases.length, 4);
for (const scenario of regressionCases) {
  group(scenario.name, scenario.label, 1, async state => {
    await use(state, scenario, async f => {
      const op = f.begin();
      const id = f.deadline();
      assert.equal(f.active.has(id), true, 'DEADLINE_ACTIVE_BEFORE_HEADERS');
      f.openHeaders(); await drain();
      f.assertRequest();
      assert.equal(f.bodyState.jsonCalls, 1, 'ACTUAL_API_REACHED_PENDING_JSON');
      assert.equal(op.done, false, 'JSON_REMAINS_PENDING_BEFORE_DEADLINE');
      assert.equal(f.signal().aborted, false);
      const retained = f.active.has(id);
      const didFire = f.fireIfActive(id);
      await drain();
      const expectedOutcome = scenario.status === 200
        ? op.kind === 'rejected' && op.error?.name === 'AbortError'
        : op.kind === 'rejected' && op.error?.status === 400 &&
          Object.keys(op.error.body || {}).length === 0 &&
          typeof op.error.message === 'string' && op.error.message.endsWith('(400)');
      const timeoutPreserved = retained && didFire && f.fired.length === 1 &&
        f.signal().aborted && f.bodyState.aborts === 1 && f.bodyState.settled &&
        op.done && expectedOutcome && f.active.size === 0 && f.calls.length === 1 &&
        f.cleared.at(-1) === id;
      const originalGap = !retained && !didFire && !f.signal().aborted &&
        f.bodyState.aborts === 0 && !f.bodyState.settled && !op.done &&
        f.fired.length === 0 && f.calls.length === 1;
      state.semanticOriginalWitness = version === 'original' && originalGap;
      f.assertRequest();
      assert.equal(f.bodyState.forcedReleases, 0, 'WITNESS_PRECEDES_FIXTURE_RELEASE');
      assert.equal(timeoutPreserved, true, 'AUTH_ENTRY_BODY_DEADLINE');
      f.assertFinished();
    });
  });
}

const completedCases = [
  { label: '200-json', status: 200, kind: 'success', value: SUCCESS_BODY },
  { label: '201-json', status: 201, kind: 'success', value: SUCCESS_BODY },
  { label: '204-no-json', status: 204, kind: 'null', jsonCalls: 0 },
  { label: '400-message', status: 400, kind: 'status', value: { message: 'Synthetic rejection' },
    message: 'Synthetic rejection' },
  { label: '422-nested-message', status: 422, kind: 'status',
    value: { error: { message: 'Synthetic nested rejection' } }, message: 'Synthetic nested rejection' },
  { label: '401-no-public-refresh', status: 401, kind: 'status',
    value: { message: 'Synthetic unauthorized' }, message: 'Synthetic unauthorized' },
  { label: '400-quiet-no-json', status: 400, kind: 'null', quiet: true, jsonCalls: 0 },
  { label: '401-quiet-no-refresh', status: 401, kind: 'null', quiet: true, jsonCalls: 0 },
  { label: '200-invalid-json', status: 200, kind: 'json-error' },
  { label: '200-invalid-json-quiet', status: 200, kind: 'null', quiet: true, invalidJson: true },
  { label: '400-invalid-json-status', status: 400, kind: 'invalid-error-status' },
  { label: 'headers-transport-error', status: 200, kind: 'transport-error' },
  { label: 'headers-transport-error-quiet', status: 200, kind: 'null', quiet: true, transport: true },
  { label: 'headers-deadline', status: 200, kind: 'headers-deadline' },
];
assert.equal(completedCases.length, 14);
group('completed entry responses preserve payloads outcomes and cleanup', 'completed-entry', 28, async state => {
  for (const route of ENTRY_ROUTES) for (const scenario of completedCases) {
    await use(state, { route, status: scenario.status, options: entryOptions({
      throwOnError: !scenario.quiet,
    }) }, async f => {
      const op = f.begin();
      const id = f.deadline();
      const jsonError = new SyntaxError('Synthetic malformed JSON');
      const transportError = new Error('Synthetic header transport rejection');
      assert.equal(f.active.has(id), true, 'ORIGINAL_DEADLINE_STARTS_BEFORE_HEADERS');
      if (scenario.kind === 'headers-deadline') {
        assert.equal(f.fireIfActive(id), true);
      } else if (scenario.kind === 'transport-error' || scenario.transport) {
        f.failHeaders(transportError);
      } else {
        f.openHeaders(); await drain();
        if (scenario.jsonCalls !== 0) {
          assert.equal(op.done, false, 'NORMAL_JSON_IS_EXPLICITLY_RELEASED');
          assert.equal(f.bodyState.jsonCalls, 1);
          if (scenario.kind === 'json-error' || scenario.kind === 'invalid-error-status' || scenario.invalidJson) {
            f.rejectBody(jsonError);
          } else f.resolveBody(scenario.value);
        }
      }
      await drain();
      assert.equal(op.done, true, scenario.label + ':FINISHED');
      if (scenario.kind === 'success') {
        assert.equal(op.kind, 'fulfilled');
        assert.deepEqual(plain(op.value), scenario.value, 'UNCHANGED_SUCCESS_JSON');
      } else if (scenario.kind === 'null') {
        assert.equal(op.kind, 'fulfilled'); assert.equal(op.value, null);
      } else if (scenario.kind === 'status' || scenario.kind === 'invalid-error-status') {
        assert.equal(op.kind, 'rejected'); assert.equal(op.error.status, scenario.status);
        assert.deepEqual(plain(op.error.body), scenario.value || {}, 'UNCHANGED_ERROR_BODY');
        if (scenario.message) assert.equal(op.error.message, scenario.message);
        else assert.equal(op.error.message.endsWith('(' + scenario.status + ')'), true);
      } else if (scenario.kind === 'json-error') {
        assert.equal(op.kind, 'rejected'); assert.equal(op.error, jsonError);
      } else if (scenario.kind === 'transport-error') {
        assert.equal(op.kind, 'rejected'); assert.equal(op.error, transportError);
      } else {
        assert.equal(scenario.kind, 'headers-deadline');
        assert.equal(op.kind, 'rejected'); assert.equal(op.error.name, 'AbortError');
      }
      const noHeaders = scenario.kind === 'headers-deadline' || scenario.kind === 'transport-error' || scenario.transport;
      assert.equal(f.bodyState.jsonCalls, noHeaders ? 0 : (scenario.jsonCalls === 0 ? 0 : 1));
      f.assertFinished();
      const aborted = scenario.kind === 'headers-deadline';
      assert.equal(f.signal().aborted, aborted);
      assert.equal(f.bodyState.aborts, aborted ? 1 : 0);
      assert.equal(f.fired.length, aborted ? 1 : 0);
      assert.equal(f.fireIfActive(id), false, 'NO_LATE_ABORT_AFTER_FINAL_CLEANUP');
      await drain();
      f.assertFinished();
    });
  }
});

const scopeCases = [
  { label: 'login-get', route: ENTRY_ROUTES[0], options: { method: 'GET', auth: false } },
  { label: 'register-get', route: ENTRY_ROUTES[1], options: { method: 'GET', auth: false } },
  { label: 'login-default-get', route: ENTRY_ROUTES[0], options: { auth: false } },
  { label: 'login-auth-true', route: ENTRY_ROUTES[0], options: { method: 'POST', auth: true, body: PAYLOAD } },
  { label: 'register-auth-true', route: ENTRY_ROUTES[1], options: { method: 'POST', auth: true, body: PAYLOAD } },
  { label: 'other-post', route: '/api/v1/qa-synthetic', options: { method: 'POST', auth: false, body: PAYLOAD } },
  { label: 'login-trailing-slash', route: '/api/v1/auth/login/', options: { method: 'POST', auth: false } },
  { label: 'register-query', route: '/api/v1/auth/register?qa=synthetic', options: { method: 'POST', auth: false } },
  { label: 'login-case-sensitive', route: '/api/v1/auth/Login', options: { method: 'POST', auth: false } },
  { label: 'register-suffix', route: '/api/v1/auth/register-extra', options: { method: 'POST', auth: false } },
  { label: 'login-put', route: ENTRY_ROUTES[0], options: { method: 'PUT', auth: false } },
  { label: 'login-lowercase-post', route: ENTRY_ROUTES[0], options: { method: 'post', auth: false } },
  { label: 'public-ott-success', route: '/api/v1/ott', options: { method: 'GET', auth: false }, retained: true },
  { label: 'public-ott-error', route: '/api/v1/ott', status: 400,
    options: { method: 'GET', auth: false }, retained: true },
  { label: 'public-ott-defaults', route: '/api/v1/ott', options: {}, retained: true },
  { label: 'ott-extra-header', route: '/api/v1/ott', options: { method: 'GET', auth: false, headers: EXTRA_HEADERS } },
  { label: 'ott-auth-true', route: '/api/v1/ott', options: { method: 'GET', auth: true } },
  { label: 'ott-object-body', route: '/api/v1/ott', options: { method: 'GET', auth: false, body: PAYLOAD } },
  { label: 'ott-null-body', route: '/api/v1/ott', options: { method: 'GET', auth: false, body: null } },
  { label: 'ott-post', route: '/api/v1/ott', options: { method: 'POST', auth: false } },
  { label: 'ott-trailing-slash', route: '/api/v1/ott/', options: { method: 'GET', auth: false } },
  { label: 'ott-query', route: '/api/v1/ott?qa=synthetic', options: { method: 'GET', auth: false } },
];
assert.equal(scopeCases.length, 22);
group('non-target routes and public OTT preserve their deadline scope', 'scope-controls', 22, async state => {
  for (const scenario of scopeCases) {
    const options = Object.freeze({ ...scenario.options, throwOnError: true });
    await use(state, { ...scenario, options }, async f => {
      const op = f.begin();
      const id = f.deadline();
      assert.equal(f.active.has(id), true, 'NON_TARGET_HEADER_FETCH_STILL_HAS_8000MS_DEADLINE');
      f.openHeaders(); await drain();
      assert.equal(f.bodyState.jsonCalls, 1);
      assert.equal(op.done, false);
      f.assertRequest();
      const retained = scenario.retained === true;
      assert.equal(f.active.has(id), retained, scenario.label + ':EXACT_BODY_DEADLINE_SCOPE');
      assert.equal(f.fireIfActive(id), retained, 'ONLY_ACTIVE_CAPTURED_TIMER_CAN_FIRE');
      await drain();
      if (retained) {
        assert.equal(f.signal().aborted, true);
        assert.equal(f.bodyState.aborts, 1);
        assert.equal(op.done, true);
        assert.equal(op.kind, 'rejected');
        if (scenario.status === 400) {
          assert.equal(op.error.status, 400); assert.deepEqual(plain(op.error.body), {});
        } else assert.equal(op.error.name, 'AbortError');
      } else {
        assert.equal(f.signal().aborted, false);
        assert.equal(f.bodyState.aborts, 0);
        assert.equal(op.done, false, 'NON_TARGET_BODY_TIMEOUT_NOT_BROADENED');
        f.resolveBody(SUCCESS_BODY); await drain();
        assert.equal(op.kind, 'fulfilled'); assert.deepEqual(plain(op.value), SUCCESS_BODY);
      }
      assert.equal(f.fired.length, retained ? 1 : 0);
      f.assertFinished();
      assert.equal(f.fireIfActive(id), false);
      await drain();
      f.assertFinished();
    });
  }
});

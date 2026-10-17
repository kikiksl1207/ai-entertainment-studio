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

function check(condition, marker) { assert.equal(Boolean(condition), true, marker); }
const sourceRoot = path.resolve(__dirname, '..');
const version = 'candidate';
const bytes = readFileSync(path.join(path.resolve(sourceRoot), 'app.js'));
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const canonicalApp = decoded.replace(/\r\n/g, '\n');
const app = restoreOwnedFeedLightboxLifetimeDelta(canonicalApp);
check(!decoded.startsWith('\uFEFF') && Buffer.from(decoded).equals(bytes), 'SOURCE_UTF8_ROUNDTRIP');
check(!app.includes('\r') && (decoded === canonicalApp || decoded === canonicalApp.replace(/\n/g, '\r\n')), 'UNIFORM_SOURCE_ENDINGS');
check(Buffer.byteLength(app) === 430667 && createHash('sha256').update(app).digest('hex') ===
  'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2', 'FROZEN_APP_SHA256');
function marker(pattern, label) {
  const matches = [...app.matchAll(pattern)];
  check(matches.length === 1, 'UNIQUE_ACTUAL_SOURCE_MARKER:' + label);
  return matches[0].index;
}
const start = marker(/^const API_BASE = /gm, 'API_BASE');
const end = marker(/^const I18N_LOCALES = /gm, 'I18N_LOCALES');
const apiStart = marker(/^async function apiFetch\(/gm, 'apiFetch');
const refreshStart = marker(/^async function refreshAuthOnce\(/gm, 'refreshAuthOnce');
check(start < apiStart && apiStart < refreshStart && refreshStart < end, 'ACTUAL_API_PREFIX_BOUNDARIES');
const actual = new vm.Script(app.slice(start, end) + '\nglobalThis.__qaApi = {' +
  'apiFetch, refreshAuthOnce, getAuth, setAuth, apiBase: API_BASE,' +
  'flightPresent: () => _refreshInFlight !== null,' +
  'completedPresent: () => _refreshCompleted !== null };', { filename: 'actual-app-api-prefix.js' });

const DRAIN_STEPS = 64, VM_LIMIT_MS = 1000, TEST_LIMIT_MS = 5000;
const REFRESH_ROUTE = '/api/v1/auth/refresh', PRIVATE_ROUTE = '/api/v1/qa-private';
const AUTH_A = Object.freeze({ accessToken: 'synthetic-access-before', refreshToken: 'synthetic-refresh-before',
  user: Object.freeze({ id: 'synthetic-principal-a' }) });
const AUTH_B = Object.freeze({ accessToken: 'synthetic-access-other', refreshToken: 'synthetic-refresh-other',
  user: Object.freeze({ id: 'synthetic-principal-b' }) });
const ACCESS = 'synthetic-access-after', REFRESH = 'synthetic-refresh-after';
const ALT_ACCESS = 'synthetic-access-lower-priority', ALT_REFRESH = 'synthetic-refresh-lower-priority';
const PRIVATE_BODY = Object.freeze({ kind: 'synthetic-private-request' });
const PRIVATE_HEADERS = Object.freeze({ 'X-QA-Request': 'synthetic-only' });
const PRIVATE_OPTIONS = Object.freeze({ method: 'POST', auth: true, throwOnError: true,
  body: PRIVATE_BODY, headers: PRIVATE_HEADERS });
const cleanData = () => ({ accessToken: ACCESS, refreshToken: REFRESH, user: AUTH_A.user });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
async function drain() { for (let i = 0; i < DRAIN_STEPS; i++) await Promise.resolve(); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function fixture({ data = cleanData(), initial = AUTH_A, privateRequest = false, status = 200 } = {}) {
  const storage = new Map([['lumina_auth', JSON.stringify(initial)]]);
  const effects = { fixtureFaults: 0, writes: 0, removes: 0, events: [], calls: [] };
  const active = new Map(), timers = [], cleared = [];
  const headers = deferred(), body = deferred(), operations = [];
  let headersDone = false, bodyDone = false, jsonCalls = 0, aborts = 0, signal, abortListener;
  const checked = callback => (...args) => {
    try { return callback(...args); }
    catch (error) { effects.fixtureFaults++; throw error; }
  };
  function complete(value = data) {
    if (!bodyDone) { bodyDone = true; body.resolve(value); }
  }
  function rejectBody(error) {
    if (!bodyDone) { bodyDone = true; body.reject(error); }
  }
  function failHeaders(error) {
    if (!headersDone) { headersDone = true; headers.reject(error); }
  }
  const response = { status, ok: status >= 200 && status < 300,
    json: checked(() => { jsonCalls++; check(jsonCalls === 1, 'ONE_REFRESH_JSON_READ'); return body.promise; }) };
  function openHeaders() {
    if (!headersDone) { headersDone = true; headers.resolve(response); }
  }
  const context = vm.createContext({
    AbortController, Event,
    CustomEvent: class { constructor(type) { this.type = type; } },
    localStorage: {
      getItem: checked(key => { check(key === 'lumina_auth', 'ONLY_SYNTHETIC_AUTH_READ'); return storage.get(key) || null; }),
      setItem: checked((key, value) => {
        check(key === 'lumina_auth', 'NO_SETTINGS_WRITE');
        JSON.parse(value); effects.writes++; storage.set(key, value);
      }),
      removeItem: checked(key => {
        check(key === 'lumina_auth', 'NO_OTHER_STORAGE_REMOVAL');
        effects.removes++; storage.delete(key);
      }),
    },
    dispatchEvent: checked(event => {
      check(['lumina:authchange', 'lumina:auth-expired'].includes(event.type), 'ONLY_EXISTING_AUTH_EVENTS');
      effects.events.push(event.type); return true;
    }),
    // Suppress all product logging; assertions below print booleans, never fixture values.
    console: { warn() {}, info() {}, log() {}, error() {} },
    setTimeout: checked((callback, delay) => {
      check(typeof callback === 'function' && [0, 3000, 8000].includes(delay), 'EXISTING_TIMER_KIND');
      check(timers.length < 8, 'FINITE_TIMER_BUDGET');
      const timer = { id: timers.length + 1, callback, delay };
      timers.push(timer); active.set(timer.id, timer);
      return timer.id;
    }),
    clearTimeout: checked(id => { cleared.push(id); active.delete(id); }),
    fetch: checked((url, options) => {
      const route = String(url).slice(context.__qaApi.apiBase.length);
      check(String(url) === context.__qaApi.apiBase + route, 'ACTUAL_API_BASE');
      effects.calls.push({ route, options });
      check(effects.calls.length <= (privateRequest ? 3 : 1), 'FINITE_REQUEST_BUDGET');
      if (route === REFRESH_ROUTE) {
        check(effects.calls.filter(call => call.route === REFRESH_ROUTE).length === 1, 'NO_SECOND_REFRESH');
        signal = options.signal;
        check(signal && !signal.aborted && typeof signal.addEventListener === 'function', 'REFRESH_ABORT_SIGNAL');
        abortListener = () => {
          aborts++;
          const error = new DOMException('Synthetic refresh response aborted', 'AbortError');
          failHeaders(error); rejectBody(error);
        };
        signal.addEventListener('abort', abortListener, { once: true });
        return headers.promise;
      }
      check(privateRequest && route === PRIVATE_ROUTE, 'ONLY_SYNTHETIC_PRIVATE_ROUTE');
      const replay = effects.calls.filter(call => call.route === PRIVATE_ROUTE).length > 1;
      return Promise.resolve({ status: replay ? 200 : 401, ok: replay,
        json: async () => replay ? { accepted: true } : { message: 'Synthetic private rejection' } });
    }),
  });
  context.window = context;
  actual.runInContext(context, { timeout: VM_LIMIT_MS });
  function invoke(kind = 'refresh', captured) {
    check(operations.length < 3, 'FINITE_OPERATION_BUDGET');
    context.__qaCaptured = captured;
    context.__qaPrivateOptions = PRIVATE_OPTIONS;
    const expression = kind === 'private'
      ? '__qaApi.apiFetch("/api/v1/qa-private", __qaPrivateOptions)'
      : '__qaApi.refreshAuthOnce(__qaCaptured)';
    const op = { done: false, kind: 'pending', value: undefined, error: undefined };
    operations.push(op);
    const promise = vm.runInContext(expression, context, { timeout: VM_LIMIT_MS });
    promise.then(value => { op.done = true; op.kind = 'fulfilled'; op.value = value; },
      error => { op.done = true; op.kind = 'rejected'; op.error = error; });
    return op;
  }
  function fire(id) {
    const timer = active.get(id);
    if (!timer) return false;
    active.delete(id); timer.callback(); return true;
  }
  function fireDelay(delay) {
    for (const timer of [...active.values()].filter(value => value.delay === delay)) fire(timer.id);
  }
  async function flushFlight() { await drain(); fireDelay(0); await drain(); }
  function switchAuth(value) {
    context.__qaNextAuth = value;
    vm.runInContext('__qaApi.setAuth(__qaNextAuth)', context, { timeout: VM_LIMIT_MS });
  }
  function auth() { return JSON.parse(storage.get('lumina_auth') || 'null'); }
  const count = route => effects.calls.filter(call => call.route === route).length;
  const expired = () => effects.events.filter(name => name === 'lumina:auth-expired').length;
  function common() {
    check(operations.every(op => op.done), 'ALL_TRACKED_OPERATIONS_FINISHED');
    check(!context.__qaApi.flightPresent(), 'REFRESH_MUTEX_RELEASED');
    check([...active.values()].every(timer => timer.delay === 3000), 'NO_DEADLINE_OR_MUTEX_TIMER_LEFT');
    check(timers.filter(timer => timer.delay === 8000).every(timer => cleared.includes(timer.id)), 'FINALLY_CLEARED_EVERY_DEADLINE');
    check(effects.fixtureFaults === 0, 'STICKY_FIXTURE_FAULT');
    for (const call of effects.calls) {
      const request = call.options;
      check(same(Object.keys(request).sort(), ['body', 'headers', 'method', 'signal']), 'UNCHANGED_FETCH_OPTION_KEYS');
      check(request.method === 'POST' && request.signal && typeof request.signal.addEventListener === 'function', 'UNCHANGED_METHOD_AND_SIGNAL');
      if (call.route === REFRESH_ROUTE) {
        check(same(request.headers, { 'Content-Type': 'application/json' }), 'REFRESH_HAS_NO_AUTHORIZATION_HEADER');
        const originalRefresh = initial.refreshToken || initial.refresh_token || initial.tokens?.refreshToken || initial.tokens?.refresh_token;
        check(request.body === JSON.stringify({ refreshToken: originalRefresh }), 'UNCHANGED_REFRESH_REQUEST_BODY');
      } else {
        check(request.body === JSON.stringify(PRIVATE_BODY), 'UNCHANGED_PRIVATE_REQUEST_BODY');
        check(request.headers['Content-Type'] === 'application/json' &&
          request.headers['X-QA-Request'] === 'synthetic-only' &&
          same(Object.keys(request.headers).sort(), ['Authorization', 'Content-Type', 'X-QA-Request']), 'UNCHANGED_PRIVATE_HEADERS');
      }
    }
    if (count(PRIVATE_ROUTE)) check(effects.calls[0].options.headers.Authorization ===
      'Bearer ' + initial.accessToken, 'PRIVATE_REQUEST_CAPTURES_ORIGINAL_SESSION');
    check(same(PRIVATE_OPTIONS, { method: 'POST', auth: true, throwOnError: true,
      body: PRIVATE_BODY, headers: PRIVATE_HEADERS }), 'CALLER_OPTIONS_NOT_MUTATED');
  }
  async function dispose() {
    try {
      openHeaders(); complete(); await flushFlight();
      fireDelay(3000); await drain();
      common();
      check(active.size === 0, 'FIXTURE_FINAL_TIMER_CLEANUP');
      check(!context.__authExpiredNotified, 'EXPIRY_DEBOUNCE_RELEASED');
    } finally {
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
      active.clear();
    }
  }
  return { effects, active, timers, invoke, openHeaders, complete, rejectBody, failHeaders,
    fire, flushFlight, switchAuth, auth, count, expired, common, dispose,
    completedPresent: () => context.__qaApi.completedPresent(),
    jsonCalls: () => jsonCalls, aborts: () => aborts, signal: () => signal };
}
async function use(state, options, callback) {
  const f = fixture(options); state.scenarios++;
  try { return await callback(f); }
  finally { try { await f.dispose(); } finally { state.fixtureFaults += f.effects.fixtureFaults; } }
}
function group(name, label, expectedCount, callback) {
  test(name, { timeout: TEST_LIMIT_MS, concurrency: false }, async t => {
    const state = { scenarios: 0, fixtureFaults: 0, semanticOriginalWitness: false };
    try {
      await callback(state);
      check(state.scenarios === expectedCount, 'FINITE_GROUP_SCENARIO_COUNT');
    } finally {
      t.diagnostic(JSON.stringify({ contract: 'auth-refresh-token-shape-v1', variant: version,
        case: label, semanticOriginalWitness: state.semanticOriginalWitness, fixtureFaults: state.fixtureFaults }));
    }
  });
}

const ALIASES = ['top', 'nested', 'snake'];
function selectedData(field, alias, value) {
  const data = { user: AUTH_A.user };
  if (field === 'access') data.refreshToken = REFRESH;
  else data.accessToken = ACCESS;
  const top = field === 'access' ? 'accessToken' : 'refreshToken';
  const snake = field === 'access' ? 'access_token' : 'refresh_token';
  const alternate = field === 'access' ? ALT_ACCESS : ALT_REFRESH;
  if (alias === 'top') { data[top] = value; data.tokens = { [top]: alternate }; data[snake] = alternate; }
  else if (alias === 'nested') { data[top] = ''; data.tokens = { [top]: value }; data[snake] = alternate; }
  else { data[top] = false; data.tokens = { [top]: 0 }; data[snake] = value; }
  return data;
}
function rejectedWithoutPersistence(f, op, privateRequest) {
  return op.done && (privateRequest ? op.kind === 'rejected' && op.error?.status === 401
    : op.kind === 'fulfilled' && op.value === null) &&
    f.auth() === null && f.effects.writes === 0 && f.effects.removes === 1 && f.expired() === 1 &&
    f.effects.events.filter(name => name === 'lumina:authchange').length === 1 &&
    !f.completedPresent() && f.count(REFRESH_ROUTE) === 1 &&
    f.count(PRIVATE_ROUTE) === (privateRequest ? 1 : 0);
}
function originalAcceptance(f, op, privateRequest) {
  return op.done && op.kind === 'fulfilled' && op.value !== null &&
    f.auth() !== null && f.effects.writes === 1 && f.effects.removes === 0 && f.expired() === 0 &&
    f.completedPresent() && f.count(REFRESH_ROUTE) === 1 &&
    f.count(PRIVATE_ROUTE) === (privateRequest ? 2 : 0);
}
async function rejectionMatrix(state, cases, privateRequest = false) {
  const rejections = [], originalGaps = [];
  for (const data of cases) await use(state, { data, privateRequest }, async f => {
    const op = f.invoke(privateRequest ? 'private' : 'refresh');
    await drain();
    check(f.count(REFRESH_ROUTE) === 1 && !op.done, 'REAL_REFRESH_REACHED_SYNTHETIC_HEADERS');
    f.openHeaders(); await drain();
    check(f.jsonCalls() === 1 && !op.done, 'REAL_REFRESH_REACHED_SYNTHETIC_BODY');
    f.complete(); await f.flushFlight();
    f.common();
    check(f.aborts() === 0 && !f.signal().aborted, 'SHAPE_WITNESS_IS_NOT_TIMEOUT');
    rejections.push(rejectedWithoutPersistence(f, op, privateRequest));
    originalGaps.push(originalAcceptance(f, op, privateRequest));
  });
  state.semanticOriginalWitness = version === 'original' && originalGaps.every(Boolean);
  check(rejections.length === cases.length && rejections.every(Boolean), 'AUTH_REFRESH_TOKEN_SHAPE');
}

const NON_STRING_ACCESS = [{ synthetic: true }, ['synthetic-only'], 7, true];
const WHITESPACE_ACCESS = [' ', '\t', '\r\n'];
const BAD_REFRESH = [{ synthetic: true }, ['synthetic-only'], 7, true, ' \t\r\n'];
group('selected non-string access credentials are rejected before persistence', 'access-type', 12, async state => {
  await rejectionMatrix(state, NON_STRING_ACCESS.flatMap(value => ALIASES.map(alias => selectedData('access', alias, value))));
});
group('selected whitespace access credentials are rejected before persistence', 'access-whitespace', 9, async state => {
  await rejectionMatrix(state, WHITESPACE_ACCESS.flatMap(value => ALIASES.map(alias => selectedData('access', alias, value))));
});
group('selected malformed refresh credentials are rejected before persistence', 'refresh-type', 15, async state => {
  await rejectionMatrix(state, BAD_REFRESH.flatMap(value => ALIASES.map(alias => selectedData('refresh', alias, value))));
});
group('malformed selected credentials never authorize a private replay', 'no-private-replay', 8, async state => {
  const cases = [...NON_STRING_ACCESS, ' \t'].map((value, index) => selectedData('access', ALIASES[index % 3], value));
  cases.push(...[{ synthetic: true }, 7, ' \t'].map((value, index) => selectedData('refresh', ALIASES[index], value)));
  await rejectionMatrix(state, cases, true);
});

const validCases = [
  { data: cleanData() },
  { data: { tokens: { accessToken: ACCESS, refreshToken: REFRESH }, user: AUTH_A.user } },
  { data: { access_token: ACCESS, refresh_token: REFRESH, user: AUTH_A.user } },
  { data: { ...cleanData(), tokens: { accessToken: ALT_ACCESS, refreshToken: ALT_REFRESH },
    access_token: ALT_ACCESS, refresh_token: ALT_REFRESH } },
  { data: { accessToken: false, refreshToken: false, tokens: { accessToken: ACCESS, refreshToken: REFRESH },
    access_token: ALT_ACCESS, refresh_token: ALT_REFRESH, user: AUTH_A.user } },
  { data: { accessToken: ACCESS, user: AUTH_A.user }, expectedRefresh: AUTH_A.refreshToken },
  // The final alias preserves each selected falsy value instead of collapsing it to undefined.
  ...[null, false, 0, ''].map(refreshToken => ({
    data: { accessToken: ACCESS, refresh_token: refreshToken, user: AUTH_A.user }, expectedRefresh: AUTH_A.refreshToken,
  })),
  { data: { accessToken: ACCESS, refreshToken: REFRESH } },
  { data: { accessToken: ACCESS, refreshToken: REFRESH, user: { userId: AUTH_A.user.id } } },
  { data: { accessToken: ACCESS, refreshToken: REFRESH, user: { userId: '17' } },
    initial: { ...AUTH_A, user: { id: 17 } } },
  { data: { accessToken: ' synthetic-padded-access ', refreshToken: '\tsynthetic-padded-refresh\t', user: AUTH_A.user },
    expectedAccess: ' synthetic-padded-access ', expectedRefresh: '\tsynthetic-padded-refresh\t' },
  { data: { accessToken: '', refreshToken: '', tokens: { accessToken: ACCESS, refreshToken: REFRESH }, user: AUTH_A.user } },
];
check(validCases.length === 15, 'FINITE_VALID_CONTROL_MATRIX');
group('valid refresh aliases and falsy refresh fallback preserve session policy', 'valid-controls', 15, async state => {
  for (const scenario of validCases) await use(state, scenario, async f => {
    const op = f.invoke(); f.openHeaders(); await drain();
    check(f.jsonCalls() === 1 && !op.done, 'VALID_REFRESH_BODY_IS_CONTROLLED');
    check([...f.active.values()].filter(timer => timer.delay === 8000).length === 1, 'EXISTING_BODY_DEADLINE_RETAINED');
    f.complete(); await f.flushFlight();
    const expected = { accessToken: scenario.expectedAccess || ACCESS,
      refreshToken: scenario.expectedRefresh || REFRESH, user: scenario.data.user || (scenario.initial || AUTH_A).user };
    check(op.kind === 'fulfilled' && same(op.value, expected) && same(f.auth(), expected), 'VALID_RESPONSE_PRESERVED_WITHOUT_TRIMMING');
    check(f.effects.writes === 1 && f.effects.removes === 0 && f.expired() === 0 && f.completedPresent(), 'VALID_SESSION_ROTATED_ONCE');
    check(f.count(REFRESH_ROUTE) === 1 && f.count(PRIVATE_ROUTE) === 0, 'VALID_REFRESH_HAS_NO_EXTRA_REQUEST');
    check(f.aborts() === 0 && !f.signal().aborted, 'NO_ABORT_AFTER_VALID_COMPLETION');
    f.common();
  });
});

function policyRejected(f, op, requests = 1) {
  check(op.kind === 'fulfilled' && op.value === null && f.auth() === null, 'EXISTING_REJECTION_RETURNS_NULL_AND_CLEARS_AUTH');
  check(f.effects.writes === 0 && f.effects.removes === 1 && f.expired() === 1 && !f.completedPresent(), 'EXISTING_CLEAR_AUTH_POLICY');
  check(f.count(REFRESH_ROUTE) === requests && f.count(PRIVATE_ROUTE) === 0, 'EXISTING_REJECTION_REQUEST_COUNT');
  f.common();
}
group('refresh session guards mutex and deadlines preserve isolation', 'session-controls', 13, async state => {
  for (const data of [{ refreshToken: REFRESH, user: AUTH_A.user },
    { ...cleanData(), user: AUTH_B.user }]) await use(state, { data }, async f => {
    const op = f.invoke(); f.openHeaders(); f.complete(); await f.flushFlight(); policyRejected(f, op);
  });
  await use(state, { status: 401 }, async f => {
    const op = f.invoke(); f.openHeaders(); await f.flushFlight();
    check(f.jsonCalls() === 0, 'DENIED_REFRESH_DOES_NOT_PARSE_JSON'); policyRejected(f, op);
  });
  await use(state, {}, async f => {
    const op = f.invoke(); f.openHeaders(); await drain();
    f.rejectBody(new SyntaxError('Synthetic malformed refresh JSON')); await f.flushFlight(); policyRejected(f, op);
  });
  await use(state, {}, async f => {
    const op = f.invoke(); f.failHeaders(new Error('Synthetic refresh transport failure'));
    await f.flushFlight(); policyRejected(f, op);
  });
  await use(state, { initial: { accessToken: AUTH_A.accessToken, user: AUTH_A.user } }, async f => {
    const op = f.invoke(); await f.flushFlight(); policyRejected(f, op, 0);
    check(f.timers.every(timer => timer.delay === 3000), 'NO_REFRESH_DEADLINE_WITHOUT_STORED_REFRESH');
  });
  await use(state, {}, async f => {
    const first = f.invoke(), second = f.invoke();
    await drain(); check(f.count(REFRESH_ROUTE) === 1, 'CONCURRENT_CALLERS_SHARE_REFRESH');
    f.openHeaders(); await drain(); f.complete(); await f.flushFlight();
    check(first.kind === 'fulfilled' && second.kind === 'fulfilled' && same(first.value, second.value), 'SHARED_REFRESH_RESULT');
    const cached = f.invoke('refresh', AUTH_A); await f.flushFlight();
    check(cached.kind === 'fulfilled' && same(cached.value, first.value), 'COMPLETED_SESSION_CACHE_PRESERVED');
    check(f.count(REFRESH_ROUTE) === 1 && f.effects.writes === 1 && f.expired() === 0, 'MUTEX_AND_CACHE_DO_NOT_DUPLICATE_REQUESTS');
    f.common();
  });
  await use(state, {}, async f => {
    const op = f.invoke(); f.openHeaders(); await drain();
    const deadlines = f.timers.filter(timer => timer.delay === 8000);
    check(deadlines.length === 1 && f.jsonCalls() === 1 && !op.done, 'PENDING_REFRESH_HAS_ORIGINAL_DEADLINE');
    check(f.fire(deadlines[0].id), 'FIRE_ONLY_ACTIVE_EXISTING_DEADLINE');
    await f.flushFlight();
    check(f.aborts() === 1 && f.signal().aborted, 'EXISTING_REFRESH_BODY_ABORT'); policyRejected(f, op);
  });
  const staleCases = [
    { beforeHeaders: true, data: cleanData(), next: AUTH_B },
    { beforeHeaders: true, data: selectedData('access', 'top', { synthetic: true }), next: AUTH_B },
    { beforeHeaders: false, data: cleanData(), next: AUTH_B },
    { beforeHeaders: false, data: selectedData('refresh', 'nested', { synthetic: true }), next: AUTH_B },
    { beforeHeaders: false, data: cleanData(), next: { ...AUTH_A, accessToken: 'synthetic-same-user-new-session' } },
  ];
  for (const scenario of staleCases) await use(state, { data: scenario.data }, async f => {
    const op = f.invoke();
    if (!scenario.beforeHeaders) {
      f.openHeaders(); await drain(); check(f.jsonCalls() === 1 && !op.done, 'STALE_BODY_ALREADY_PENDING');
    }
    f.switchAuth(scenario.next);
    const writesAtSwitch = f.effects.writes;
    f.openHeaders(); f.complete(); await f.flushFlight();
    check(op.kind === 'fulfilled' && op.value === null && same(f.auth(), scenario.next), 'STALE_RESPONSE_CANNOT_REPLACE_CURRENT_SESSION');
    check(f.effects.writes === writesAtSwitch && f.effects.removes === 0 && f.expired() === 0 &&
      !f.completedPresent(), 'STALE_RESPONSE_CANNOT_CLEAR_PERSIST_OR_NOTIFY');
    check(f.jsonCalls() === (scenario.beforeHeaders ? 0 : 1), 'STALE_HEADER_AND_BODY_BOUNDARIES_PRESERVED');
    check(f.count(REFRESH_ROUTE) === 1 && f.count(PRIVATE_ROUTE) === 0 && f.aborts() === 0, 'STALE_RESPONSE_DOES_NOT_RETRY');
    f.common();
  });
});

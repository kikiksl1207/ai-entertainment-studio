import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { createContext, runInContext } from 'node:vm';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const ts = require('typescript');
const FUNCTIONS = [
  'authRequestSession', 'authRequestSessionCurrent', 'apiFetch', 'getAuth',
  'setAuth', 'clearAuth', 'getRefreshToken', 'authLogin', 'authLogout',
];
const VARIABLES = ['API_BASE', '_refreshCompleted', 'AUTH_STORAGE_KEY'];
const CURRENT_LOGIN_SHA256 = 'c97351201e7dcd319b759dcbe97e7b9bf37e568fad1e81d53865f10d086e9ba9';
const ORIGINAL_LOGIN_SHA256 = '47f5a5297b9dacfb0d045c97165de7a6ee3206ff073b5c17d11193c2a6732dfd';
const SESSION_CAPTURE = '  const session = authRequestSession();\n';
const SESSION_GATE = [
  '  if (!authRequestSessionCurrent(session)) {',
  '    throw new Error("Login response no longer matches the current session");',
  '  }',
  '',
].join('\n');
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
let programs;

function extractDeclarations(source, names) {
  const file = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'SOURCE_PARSE_CLEAN');
  const wanted = new Set(names);
  const found = new Map();
  for (const node of file.statements) {
    const declaredNames = ts.isFunctionDeclaration(node) && node.name
      ? [node.name.text]
      : ts.isVariableStatement(node)
        ? node.declarationList.declarations.map(item => ts.isIdentifier(item.name) ? item.name.text : '')
        : [];
    for (const name of declaredNames) {
      if (!wanted.has(name)) continue;
      assert.equal(found.has(name), false, 'SOURCE_UNIQUE_NAMED_DECLARATION');
      if (ts.isVariableStatement(node)) {
        assert.equal(node.declarationList.declarations.length, 1, 'SOURCE_SINGLE_VARIABLE_DECLARATION');
      }
      found.set(name, node.getText(file));
    }
  }
  for (const name of wanted) assert.equal(found.has(name), true, 'SOURCE_NAMED_DECLARATION_REQUIRED');
  assert.equal(found.size, wanted.size, 'SOURCE_EXACT_BOUNDARY');
  return found;
}

function removeExactlyOnce(text, span, marker) {
  const at = text.indexOf(span);
  assert.equal(at >= 0 && text.indexOf(span, at + span.length) === -1, true, marker);
  return text.slice(0, at) + text.slice(at + span.length);
}

before(() => {
  const bytes = readFileSync(new URL('../app.js', import.meta.url));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.equal(text.startsWith('\uFEFF'), false, 'SOURCE_NO_BOM');
  assert.equal(Buffer.from(text).equals(bytes), true, 'SOURCE_UTF8_ROUNDTRIP');
  const source = text.replace(/\r\n/g, '\n');
  assert.equal(!source.includes('\r') && (text === source || text === source.replace(/\n/g, '\r\n')), true, 'SOURCE_UNIFORM_LINE_ENDINGS');
  const declarations = extractDeclarations(source, [...FUNCTIONS, ...VARIABLES]);
  const currentLogin = declarations.get('authLogin');
  assert.equal(Buffer.byteLength(currentLogin, 'utf8'), 984, 'CURRENT_LOGIN_EXACT_BYTES');
  assert.equal(sha256(currentLogin), CURRENT_LOGIN_SHA256, 'CURRENT_LOGIN_EXACT_IDENTITY');
  assert.equal(currentLogin.startsWith('async function authLogin(email, password) {\n' + SESSION_CAPTURE), true, 'OWNED_CAPTURE_AT_ENTRY');
  assert.equal(currentLogin.includes(SESSION_GATE + '  setAuth({ accessToken: token, refreshToken: refresh, user });'), true, 'OWNED_GATE_BEFORE_WRITE');
  // Only the two owned spans are removed; an independent old-function pin is the oracle.
  let originalLogin = removeExactlyOnce(currentLogin, SESSION_CAPTURE, 'OWNED_CAPTURE_UNIQUE');
  originalLogin = removeExactlyOnce(originalLogin, SESSION_GATE, 'OWNED_GATE_UNIQUE');
  assert.equal(Buffer.byteLength(currentLogin, 'utf8') - Buffer.byteLength(originalLogin, 'utf8'), 166, 'OWNED_DELTA_EXACT_BYTES');
  assert.equal(Buffer.byteLength(originalLogin, 'utf8'), 818, 'ORIGINAL_LOGIN_EXACT_BYTES');
  assert.equal(sha256(originalLogin), ORIGINAL_LOGIN_SHA256, 'ORIGINAL_LOGIN_INDEPENDENT_IDENTITY');
  assert.equal(extractDeclarations(originalLogin, ['authLogin']).get('authLogin'), originalLogin, 'ORIGINAL_LOGIN_EXACT_AST_FUNCTION');
  programs = Object.freeze({
    candidate: [...declarations.values()].join('\n'),
    original: [...declarations].map(([name, declaration]) => name === 'authLogin' ? originalLogin : declaration).join('\n'),
  });
});

function canonical(label) {
  return {
    accessToken: 'synthetic-access-' + label,
    refreshToken: 'synthetic-refresh-' + label,
    user: { id: 'synthetic-user-' + label },
  };
}

function loginBody(label) {
  const auth = canonical(label);
  return { user: auth.user, tokens: { accessToken: auth.accessToken, refreshToken: auth.refreshToken } };
}

function loginPlan(id, label) {
  return {
    id, route: '/api/v1/auth/login',
    body: { email: label + '@invalid.test', password: 'synthetic-password-' + label },
    response: loginBody(label), authorized: false,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function observeLogin(promise, expected) {
  return promise.then(
    result => ({ state: 'fulfilled', rejection: 'none', matchesResponse: isDeepStrictEqual(clone(result), expected) }),
    error => ({ state: 'rejected', matchesResponse: false,
      rejection: error?.name === 'Error' && error?.message === 'Login response no longer matches the current session'
        ? 'current-session-changed' : 'unexpected' }),
  );
}

function requireNormalCompletion(outcome, marker) {
  assert.equal(outcome.state, 'fulfilled', marker + '_FULFILLED');
  assert.equal(outcome.rejection, 'none', marker + '_NO_REJECTION');
  assert.equal(outcome.matchesResponse, true, marker + '_NORMAL_BODY');
}

function requireCurrentnessRejection(outcome, marker) {
  assert.equal(outcome.state, 'rejected', marker + '_REJECTED');
  assert.equal(outcome.rejection, 'current-session-changed', marker + '_EXACT_REASON');
  assert.equal(outcome.matchesResponse, false, marker + '_NO_SUCCESS_RETURN');
}

function fixture(mode, plans) {
  assert.equal(Object.hasOwn(programs, mode), true, 'FIXTURE_EXPLICIT_PROGRAM_MODE');
  const productionProgram = programs[mode];
  const key = 'lumina_auth';
  const store = new Map([[key, JSON.stringify(canonical('existing'))]]);
  const calls = plans.map(plan => ({ ...plan, gate: deferred(), state: 'waiting', jsonReads: 0 }));
  const faults = [];
  const timers = new Map();
  const counts = { writes: 0, removes: 0, events: 0, loginLogs: 0, refreshCalls: 0,
    uiUpdates: 0, mypageCalls: 0, aborts: 0 };
  let cursor = 0;
  let timerId = 0;
  let api;
  function check(value, code) {
    if (!value) { faults.push(code); throw new Error(code); }
  }
  const context = createContext({
    localStorage: {
      getItem(name) { check(name === key, 'FIXTURE_STORAGE_KEY'); return store.get(name) ?? null; },
      setItem(name, value) {
        check(name === key && typeof value === 'string', 'FIXTURE_STORAGE_WRITE');
        store.set(name, value); counts.writes++;
      },
      removeItem(name) { check(name === key, 'FIXTURE_STORAGE_REMOVE'); store.delete(name); counts.removes++; },
    },
    window: { dispatchEvent(event) { check(event.type === 'lumina:authchange', 'FIXTURE_EVENT'); counts.events++; return true; } },
    Event: class { constructor(type) { this.type = type; } },
    AbortController: class {
      constructor() { this.signal = { aborted: false }; }
      abort() { this.signal.aborted = true; counts.aborts++; }
    },
    setTimeout(callback, delay) {
      check(typeof callback === 'function' && delay === 8000, 'FIXTURE_DEADLINE');
      timers.set(++timerId, callback); return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      const call = calls[cursor++];
      check(Boolean(call) && call.state === 'waiting', 'FIXTURE_EXACT_REQUEST_COUNT');
      check(url === api.base + call.route && options.method === 'POST', 'FIXTURE_ROUTE_METHOD');
      check(isDeepStrictEqual(JSON.parse(options.body), call.body), 'FIXTURE_SYNTHETIC_BODY');
      const expectedHeaders = { 'Content-Type': 'application/json' };
      if (call.authorized) expectedHeaders.Authorization = 'Bearer synthetic-access-existing';
      check(isDeepStrictEqual(clone(options.headers), expectedHeaders), 'FIXTURE_REQUEST_HEADERS');
      check(options.signal?.aborted === false, 'FIXTURE_SIGNAL');
      call.state = 'pending';
      return call.gate.promise;
    },
    refreshAuthOnce() { counts.refreshCalls++; check(false, 'FIXTURE_UNEXPECTED_REFRESH'); },
    updateAuthUI() { counts.uiUpdates++; },
    initMypagePage() { counts.mypageCalls++; },
    console: { info() { counts.loginLogs++; } },
  }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(productionProgram, context, { timeout: 1000, filename: 'currentness-production.js' });
  // This fixture seeds the existing completed-refresh relation, not a refresh operation.
  api = runInContext(`({ authLogin, authLogout, getAuth, base: API_BASE, key: AUTH_STORAGE_KEY,
    seedCompletedRefresh(auth) {
      const session = authRequestSession();
      setAuth(auth);
      _refreshCompleted = { session, auth };
      return authRequestSessionCurrent(session);
    }
  })`, context, { timeout: 1000, filename: 'currentness-fixture-bindings.js' });
  assert.equal(api.key, key, 'FIXTURE_CANONICAL_KEY');
  return {
    api,
    counts,
    isCanonical(expected) { return isDeepStrictEqual(clone(api.getAuth()), expected); },
    pending(id) { return calls.find(call => call.id === id)?.state === 'pending'; },
    release(id) {
      const call = calls.find(item => item.id === id);
      check(call?.state === 'pending', 'FIXTURE_RELEASE_ONLY_PENDING');
      call.state = 'released';
      call.gate.resolve({
        ok: true, status: 200,
        async json() { call.jsonReads++; return clone(call.response); },
      });
    },
    assertComplete() {
      assert.equal(faults.length, 0, 'FIXTURE_NO_FAULTS');
      assert.equal(cursor, calls.length, 'FIXTURE_ALL_REQUESTS_ISSUED');
      assert.equal(calls.every(call => call.state === 'released' && call.jsonReads === 1), true, 'FIXTURE_ALL_NORMAL_RESPONSES_READ');
      assert.equal(timers.size, 0, 'FIXTURE_ALL_DEADLINES_CLEARED');
      assert.equal(counts.aborts, 0, 'FIXTURE_NO_ABORT');
      assert.equal(counts.refreshCalls, 0, 'FIXTURE_NO_REFRESH');
    },
  };
}

async function afterNewerCompletedLogin(mode) {
  const h = fixture(mode, [loginPlan('earlier', 'a'), loginPlan('newer', 'b')]);
  const earlier = observeLogin(h.api.authLogin('a@invalid.test', 'synthetic-password-a'), loginBody('a'));
  assert.equal(h.pending('earlier'), true, 'LOGIN_EARLIER_PENDING');
  assert.equal(h.isCanonical(canonical('existing')), true, 'LOGIN_PENDING_PRESERVES_EXISTING');
  const newer = observeLogin(h.api.authLogin('b@invalid.test', 'synthetic-password-b'), loginBody('b'));
  assert.equal(h.pending('newer'), true, 'LOGIN_NEWER_PENDING');
  h.release('newer');
  requireNormalCompletion(await newer, 'LOGIN_NEWER_COMPLETED');
  assert.equal(h.isCanonical(canonical('b')), true, 'LOGIN_NEWER_CANONICAL_STORED');
  assert.equal(h.pending('earlier'), true, 'LOGIN_EARLIER_STILL_PENDING_AFTER_NEWER_SUCCESS');
  assert.equal(h.counts.writes === 1 && h.counts.removes === 0 && h.counts.events === 1, true, 'LOGIN_NEWER_EXACT_EFFECTS');
  h.release('earlier');
  const outcome = await earlier;
  h.assertComplete();
  return { h, outcome };
}

async function afterCompletedLogout(mode) {
  const h = fixture(mode, [loginPlan('earlier', 'a'), {
    id: 'logout', route: '/api/v1/auth/logout', body: { refreshToken: 'synthetic-refresh-existing' },
    response: { ok: true }, authorized: true,
  }]);
  const earlier = observeLogin(h.api.authLogin('a@invalid.test', 'synthetic-password-a'), loginBody('a'));
  assert.equal(h.pending('earlier'), true, 'LOGOUT_EARLIER_PENDING');
  assert.equal(h.isCanonical(canonical('existing')), true, 'LOGOUT_PENDING_PRESERVES_EXISTING');
  const logout = h.api.authLogout();
  assert.equal(h.pending('logout'), true, 'LOGOUT_NORMAL_REQUEST_PENDING');
  h.release('logout');
  await logout;
  assert.equal(h.isCanonical(null), true, 'LOGOUT_COMPLETED_CANONICAL_ABSENT');
  assert.equal(h.pending('earlier'), true, 'LOGOUT_EARLIER_STILL_PENDING_AFTER_LOGOUT');
  assert.equal(h.counts.writes === 0 && h.counts.removes === 1 && h.counts.events === 1 &&
    h.counts.uiUpdates === 1 && h.counts.mypageCalls === 1, true, 'LOGOUT_COMPLETED_EXACT_EFFECTS');
  h.release('earlier');
  const outcome = await earlier;
  h.assertComplete();
  return { h, outcome };
}

test('control: one normal email login completes and stores canonical auth', async () => {
  const h = fixture('candidate', [loginPlan('earlier', 'a')]);
  const pending = observeLogin(h.api.authLogin('a@invalid.test', 'synthetic-password-a'), loginBody('a'));
  assert.equal(h.pending('earlier'), true, 'CONTROL_RESPONSE_PENDING');
  assert.equal(h.isCanonical(canonical('existing')), true, 'CONTROL_PENDING_PRESERVES_EXISTING');
  assert.equal(h.counts.writes, 0, 'CONTROL_PENDING_HAS_NO_WRITE');
  h.release('earlier');
  requireNormalCompletion(await pending, 'CONTROL_COMPLETION');
  h.assertComplete();
  assert.equal(h.isCanonical(canonical('a')), true, 'CONTROL_COMPLETED_STORED');
  assert.deepEqual(h.counts, { writes: 1, removes: 0, events: 1, loginLogs: 1,
    refreshCalls: 0, uiUpdates: 0, mypageCalls: 0, aborts: 0 }, 'CONTROL_EXACT_EFFECTS');
});

test('currentness: earlier email response preserves newer completed successful login', async () => {
  const old = await afterNewerCompletedLogin('original');
  requireNormalCompletion(old.outcome, 'ORIGINAL_EARLIER_LOGIN_COMPLETION');
  assert.equal(old.h.isCanonical(canonical('a')), true, 'ORIGINAL_SEMANTIC_OVERWRITE_AFTER_NEWER_LOGIN');
  assert.deepEqual(old.h.counts, { writes: 2, removes: 0, events: 2, loginLogs: 2,
    refreshCalls: 0, uiUpdates: 0, mypageCalls: 0, aborts: 0 }, 'ORIGINAL_NEWER_LOGIN_EXACT_MUTATIONS');

  const current = await afterNewerCompletedLogin('candidate');
  requireCurrentnessRejection(current.outcome, 'CANDIDATE_EARLIER_LOGIN_CURRENTNESS');
  assert.equal(current.h.isCanonical(canonical('b')), true, 'CURRENTNESS_EMAIL_PRESERVE_NEWER_COMPLETED_LOGIN');
  assert.deepEqual(current.h.counts, { writes: 1, removes: 0, events: 1, loginLogs: 2,
    refreshCalls: 0, uiUpdates: 0, mypageCalls: 0, aborts: 0 }, 'CANDIDATE_NEWER_LOGIN_EFFECTS_PRESERVED');
});

test('currentness: earlier email response preserves completed explicit logout', async () => {
  const old = await afterCompletedLogout('original');
  requireNormalCompletion(old.outcome, 'ORIGINAL_EARLIER_LOGIN_AFTER_LOGOUT');
  assert.equal(old.h.isCanonical(canonical('a')), true, 'ORIGINAL_SEMANTIC_RESURRECTION_AFTER_LOGOUT');
  assert.deepEqual(old.h.counts, { writes: 1, removes: 1, events: 2, loginLogs: 1,
    refreshCalls: 0, uiUpdates: 1, mypageCalls: 1, aborts: 0 }, 'ORIGINAL_LOGOUT_EXACT_MUTATIONS');

  const current = await afterCompletedLogout('candidate');
  requireCurrentnessRejection(current.outcome, 'CANDIDATE_EARLIER_LOGIN_AFTER_LOGOUT');
  assert.equal(current.h.isCanonical(null), true, 'CURRENTNESS_EMAIL_PRESERVE_COMPLETED_LOGOUT');
  assert.deepEqual(current.h.counts, { writes: 0, removes: 1, events: 1, loginLogs: 1,
    refreshCalls: 0, uiUpdates: 1, mypageCalls: 1, aborts: 0 }, 'CANDIDATE_LOGOUT_EFFECTS_PRESERVED');
});

test('control: completed refresh correspondence allows normal pending email login', async () => {
  const h = fixture('candidate', [loginPlan('earlier', 'a')]);
  const pending = observeLogin(h.api.authLogin('a@invalid.test', 'synthetic-password-a'), loginBody('a'));
  assert.equal(h.pending('earlier'), true, 'REFRESH_CONTROL_EMAIL_PENDING');
  const refreshed = { ...canonical('existing'), accessToken: 'synthetic-access-existing-refreshed',
    refreshToken: 'synthetic-refresh-existing-refreshed' };
  assert.equal(h.api.seedCompletedRefresh(refreshed), true, 'REFRESH_CONTROL_EXISTING_CORRESPONDENCE');
  assert.equal(h.isCanonical(refreshed), true, 'REFRESH_CONTROL_CANONICAL_ROTATED');
  assert.equal(h.pending('earlier'), true, 'REFRESH_CONTROL_EMAIL_STILL_PENDING');
  assert.equal(h.counts.writes === 1 && h.counts.removes === 0 && h.counts.events === 1, true, 'REFRESH_CONTROL_SEED_EFFECTS');
  h.release('earlier');
  requireNormalCompletion(await pending, 'REFRESH_CONTROL_COMPLETION');
  h.assertComplete();
  assert.equal(h.isCanonical(canonical('a')), true, 'REFRESH_CONTROL_LOGIN_STORED');
  assert.deepEqual(h.counts, { writes: 2, removes: 0, events: 2, loginLogs: 1,
    refreshCalls: 0, uiUpdates: 0, mypageCalls: 0, aborts: 0 }, 'REFRESH_CONTROL_EXACT_EFFECTS');
});

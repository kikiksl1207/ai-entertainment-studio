// AUTHOR UNRUN. Four portable groups from the admitted 4BF registration witness.
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
  'setAuth', 'clearAuth', 'getRefreshToken', 'authLogin', 'authLogout', 'authRegister',
];
const VARIABLES = ['API_BASE', '_refreshCompleted', 'AUTH_STORAGE_KEY'];
const CURRENT_APP_SHA256 = '7ee22fe15e52d715473fe8b0f26b344d3f66377a0827854bab2f80dd83463d36';
const ORIGINAL_APP_SHA256 = '298e13c1933080e9e31b7ceee67589f6d3cf35a564c5e5b16133537745b8f997';
const CURRENT_APP_BLOB = '4cf6cb0e00ef0ceb4c7276e56e5d8e4bbda24195';
const ORIGINAL_APP_BLOB = '548c1db86d704dc1e505ead64b8670cece27e00e';
const CURRENT_REGISTER_SHA256 = '67f4e5c2072c815d4c0d0ef324694c046a66e8ab330eec4fa246b6c63b0f64e3';
const ORIGINAL_REGISTER_SHA256 = '39bf8a80b789035467b0e73dc80ddbbde3537d44123a160a94b8d66bab87e30d';
const SESSION_CAPTURE = '  const session = authRequestSession();\n';
const SESSION_GATE = '  if (!authRequestSessionCurrent(session)) return data;\n';
const REFERRAL_INITIAL = 'SYNTHETIC-REF-INITIAL';
const REFERRAL_CURRENT = 'SYNTHETIC-REF-CURRENT';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blobSha1 = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
let programs;

function extractDeclarations(source, names) {
  const file = ts.createSourceFile('app.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'SOURCE_PARSE_CLEAN');
  const wanted = new Set(names);
  const found = new Map();
  for (const node of file.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && wanted.has(node.name.text)) {
      assert.equal(found.has(node.name.text), false, 'SOURCE_UNIQUE_FUNCTION');
      found.set(node.name.text, node.getText(file));
    } else if (ts.isVariableStatement(node)) {
      for (const item of node.declarationList.declarations) {
        if (!ts.isIdentifier(item.name) || !wanted.has(item.name.text)) continue;
        assert.equal(node.declarationList.declarations.length, 1, 'SOURCE_SINGLE_VARIABLE_DECLARATION');
        assert.equal(found.has(item.name.text), false, 'SOURCE_UNIQUE_VARIABLE');
        found.set(item.name.text, node.getText(file));
      }
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
  const currentBytes = Buffer.from(source);
  assert.equal(currentBytes.length, 430162, 'CURRENT_APP_EXACT_LF_BYTES');
  assert.equal(sha256(currentBytes), CURRENT_APP_SHA256, 'CURRENT_APP_EXACT_LF_IDENTITY');
  assert.equal(blobSha1(currentBytes), CURRENT_APP_BLOB, 'CURRENT_APP_EXACT_LF_BLOB');

  const declarations = extractDeclarations(source, [...FUNCTIONS, ...VARIABLES]);
  assert.equal(declarations.size, 13, 'SOURCE_THIRTEEN_REAL_DECLARATIONS');
  const currentRegister = declarations.get('authRegister');
  assert.equal(Buffer.byteLength(currentRegister), 1039, 'CURRENT_REGISTER_EXACT_BYTES');
  assert.equal(sha256(currentRegister), CURRENT_REGISTER_SHA256, 'CURRENT_REGISTER_EXACT_IDENTITY');
  assert.equal(currentRegister.startsWith('async function authRegister(email, password, displayName, referralCode) {\n' + SESSION_CAPTURE), true, 'OWNED_CAPTURE_AT_ENTRY');
  assert.equal(currentRegister.includes('    throwOnError: true\n  });\n' + SESSION_GATE), true, 'OWNED_GATE_IMMEDIATELY_AFTER_AWAIT');
  assert.equal(currentRegister.indexOf(SESSION_GATE) < currentRegister.indexOf('  const token ='), true, 'OWNED_GATE_BEFORE_ALIASES_AND_WRITES');

  // Only the two owned lines are inverted; whole-source and independent function pins bind the oracle.
  let originalRegister = removeExactlyOnce(currentRegister, SESSION_CAPTURE, 'OWNED_CAPTURE_UNIQUE');
  originalRegister = removeExactlyOnce(originalRegister, SESSION_GATE, 'OWNED_GATE_UNIQUE');
  assert.equal(Buffer.byteLength(currentRegister) - Buffer.byteLength(originalRegister), 96, 'OWNED_DELTA_EXACT_BYTES');
  assert.equal(Buffer.byteLength(originalRegister), 943, 'ORIGINAL_REGISTER_EXACT_BYTES');
  assert.equal(sha256(originalRegister), ORIGINAL_REGISTER_SHA256, 'ORIGINAL_REGISTER_INDEPENDENT_IDENTITY');
  assert.equal(extractDeclarations(originalRegister, ['authRegister']).get('authRegister'), originalRegister, 'ORIGINAL_REGISTER_EXACT_AST_FUNCTION');

  const at = source.indexOf(currentRegister);
  assert.equal(at >= 0 && source.indexOf(currentRegister, at + currentRegister.length) === -1, true, 'SOURCE_REGISTER_SPAN_UNIQUE');
  const originalSource = source.slice(0, at) + originalRegister + source.slice(at + currentRegister.length);
  const originalBytes = Buffer.from(originalSource);
  assert.equal(originalBytes.length, 430066, 'ORIGINAL_APP_EXACT_LF_BYTES');
  assert.equal(sha256(originalBytes), ORIGINAL_APP_SHA256, 'ORIGINAL_APP_EXACT_OWNED_INVERSE');
  assert.equal(blobSha1(originalBytes), ORIGINAL_APP_BLOB, 'ORIGINAL_APP_EXACT_LF_BLOB');
  programs = Object.freeze({
    candidate: [...declarations.values()].join('\n'),
    original: [...declarations].map(([name, declaration]) => name === 'authRegister' ? originalRegister : declaration).join('\n'),
  });
});

function canonical(label) {
  return {
    accessToken: 'synthetic-access-' + label,
    refreshToken: 'synthetic-refresh-' + label,
    user: { id: 'synthetic-user-' + label },
  };
}

function authBody(label) {
  const auth = canonical(label);
  return { user: auth.user, tokens: { accessToken: auth.accessToken, refreshToken: auth.refreshToken },
    accessToken: auth.accessToken, refreshToken: auth.refreshToken };
}

function registerPlan() {
  return {
    id: 'register', route: '/api/v1/auth/register',
    body: { email: 'a@invalid.test', password: 'synthetic-password-a',
      displayName: 'Synthetic A', referralCode: REFERRAL_INITIAL },
    response: authBody('a'), authorized: false,
  };
}

function loginPlan() {
  return {
    id: 'newer', route: '/api/v1/auth/login',
    body: { email: 'b@invalid.test', password: 'synthetic-password-b' },
    response: authBody('b'), authorized: false,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function observe(promise) {
  return promise.then(
    result => ({ state: 'fulfilled', rejection: 'none', result }),
    () => ({ state: 'rejected', rejection: 'unexpected' }),
  );
}

function requireNormalCompletion(outcome, h, id, marker) {
  assert.equal(outcome.state, 'fulfilled', marker + '_FULFILLED');
  assert.equal(outcome.rejection, 'none', marker + '_NO_REJECTION');
  h.assertResponse(outcome.result, id, marker);
}

function requireEffects(h, effects, marker) {
  assert.deepEqual(h.counts, { writes: 0, removes: 0, events: 0, referralRemoves: 0,
    registerLogs: 1, loginLogs: 0, maskCalls: 1, refreshCalls: 0,
    uiUpdates: 0, mypageCalls: 0, aborts: 0, ...effects }, marker);
}

function fixture(mode, plans) {
  assert.equal(Object.hasOwn(programs, mode), true, 'FIXTURE_EXPLICIT_PROGRAM_MODE');
  const productionProgram = programs[mode];
  const key = 'lumina_auth';
  const referralKey = 'lumina_ref';
  const store = new Map([[key, JSON.stringify(canonical('existing'))], [referralKey, REFERRAL_INITIAL]]);
  const calls = plans.map(plan => ({ ...plan, gate: deferred(), state: 'waiting', jsonReads: 0, returnedBody: null }));
  const faults = [];
  const timers = new Map();
  const counts = { writes: 0, removes: 0, events: 0, referralRemoves: 0,
    registerLogs: 0, loginLogs: 0, maskCalls: 0, refreshCalls: 0,
    uiUpdates: 0, mypageCalls: 0, aborts: 0 };
  let cursor = 0;
  let timerId = 0;
  let api;
  function check(value, code) {
    if (!value) { faults.push(code); throw new Error(code); }
  }
  const context = createContext({
    localStorage: {
      getItem(name) {
        check(name === key || name === referralKey, 'FIXTURE_STORAGE_KEY');
        return store.get(name) ?? null;
      },
      setItem(name, value) {
        check(name === key && typeof value === 'string', 'FIXTURE_STORAGE_WRITE');
        store.set(name, value); counts.writes++;
      },
      removeItem(name) {
        check(name === key || name === referralKey, 'FIXTURE_STORAGE_REMOVE');
        store.delete(name);
        if (name === key) counts.removes++;
        else counts.referralRemoves++;
      },
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
    maskEmail(email) {
      check(email === 'a@invalid.test', 'FIXTURE_SYNTHETIC_MASK_INPUT');
      counts.maskCalls++;
      return 'synthetic-masked-address';
    },
    refreshAuthOnce() { counts.refreshCalls++; check(false, 'FIXTURE_UNEXPECTED_REFRESH'); },
    updateAuthUI() { counts.uiUpdates++; },
    initMypagePage() { counts.mypageCalls++; },
    console: { info(message, details) {
      check(typeof message === 'string', 'FIXTURE_LOG_MESSAGE');
      const data = clone(details);
      if (Object.hasOwn(data, 'hasPassword')) {
        check(isDeepStrictEqual(data, { email: 'synthetic-masked-address', hasPassword: true,
          hasDisplayName: true, hasReferral: true }), 'FIXTURE_REGISTER_LOG');
        counts.registerLogs++;
      } else {
        check(isDeepStrictEqual(data, { hasUser: true, hasAccessToken: true, hasRefreshToken: true }), 'FIXTURE_LOGIN_LOG');
        counts.loginLogs++;
      }
    } },
  }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(productionProgram, context, { timeout: 1000, filename: 'pinned-registration-production.js' });
  // Seed only the existing completed-refresh relation; no refresh implementation runs.
  api = runInContext(`({ authRegister, authLogin, authLogout, getAuth, base: API_BASE, key: AUTH_STORAGE_KEY,
    seedCompletedRefresh(auth) {
      const session = authRequestSession();
      setAuth(auth);
      _refreshCompleted = { session, auth };
      return authRequestSessionCurrent(session);
    }
  })`, context, { timeout: 1000, filename: 'registration-fixture-bindings.js' });
  assert.equal(api.key, key, 'FIXTURE_CANONICAL_KEY');
  return {
    api,
    counts,
    isCanonical(expected) { return isDeepStrictEqual(clone(api.getAuth()), expected); },
    referral() { return store.get(referralKey) ?? null; },
    replaceReferral() {
      check(store.get(referralKey) === REFERRAL_INITIAL, 'FIXTURE_REFERRAL_SEED_PREIMAGE');
      store.set(referralKey, REFERRAL_CURRENT);
    },
    pending(id) { return calls.find(call => call.id === id)?.state === 'pending'; },
    release(id) {
      const call = calls.find(item => item.id === id);
      check(call?.state === 'pending', 'FIXTURE_RELEASE_ONLY_PENDING');
      call.state = 'released';
      call.returnedBody = clone(call.response);
      call.gate.resolve({
        ok: true, status: 200,
        async json() { call.jsonReads++; return call.returnedBody; },
      });
    },
    assertResponse(result, id, marker) {
      const call = calls.find(item => item.id === id);
      assert.equal(call?.state, 'released', marker + '_RELEASED');
      assert.equal(result, call.returnedBody, marker + '_SAME_RETURNED_BODY');
      assert.deepEqual(clone(result), call.response, marker + '_EXACT_NORMAL_BODY');
    },
    assertComplete() {
      assert.equal(faults.length, 0, 'FIXTURE_NO_FAULTS');
      assert.equal(cursor, calls.length, 'FIXTURE_ALL_REQUESTS_ISSUED');
      assert.equal(calls.filter(call => call.route === '/api/v1/auth/register').length, 1, 'FIXTURE_ONE_REGISTER_POST');
      assert.equal(calls.every(call => call.state === 'released' && call.jsonReads === 1), true, 'FIXTURE_ALL_NORMAL_RESPONSES_READ');
      assert.equal(timers.size, 0, 'FIXTURE_ALL_DEADLINES_CLEARED');
      assert.equal(counts.aborts, 0, 'FIXTURE_NO_ABORT');
      assert.equal(counts.refreshCalls, 0, 'FIXTURE_NO_REFRESH');
    },
  };
}

function startRegistration(h) {
  return observe(h.api.authRegister('a@invalid.test', 'synthetic-password-a', 'Synthetic A', REFERRAL_INITIAL));
}

function requireInitialPending(h, marker) {
  assert.equal(h.pending('register'), true, marker + '_REGISTER_PENDING');
  assert.equal(h.isCanonical(canonical('existing')), true, marker + '_EXISTING_CANONICAL');
  assert.equal(h.referral(), REFERRAL_INITIAL, marker + '_EXISTING_REFERRAL');
  requireEffects(h, {}, marker + '_NO_PENDING_MUTATION');
}

async function afterNewerCompletedLogin(mode) {
  const h = fixture(mode, [registerPlan(), loginPlan()]);
  const earlier = startRegistration(h);
  requireInitialPending(h, 'LOGIN');
  const newer = observe(h.api.authLogin('b@invalid.test', 'synthetic-password-b'));
  assert.equal(h.pending('newer'), true, 'LOGIN_NEWER_PENDING');
  h.release('newer');
  requireNormalCompletion(await newer, h, 'newer', 'LOGIN_NEWER_COMPLETED');
  assert.equal(h.isCanonical(canonical('b')), true, 'LOGIN_NEWER_CANONICAL_STORED');
  assert.equal(h.pending('register'), true, 'LOGIN_REGISTER_STILL_PENDING_AFTER_NEWER_SUCCESS');
  requireEffects(h, { writes: 1, events: 1, loginLogs: 1 }, 'LOGIN_NEWER_EXACT_EFFECTS');
  h.replaceReferral();
  assert.equal(h.referral(), REFERRAL_CURRENT, 'LOGIN_CURRENT_REFERRAL_SEEDED');
  h.release('register');
  const outcome = await earlier;
  requireNormalCompletion(outcome, h, 'register', 'LOGIN_EARLIER_COMPLETION');
  h.assertComplete();
  return h;
}

async function afterCompletedLogout(mode) {
  const h = fixture(mode, [registerPlan(), {
    id: 'logout', route: '/api/v1/auth/logout', body: { refreshToken: 'synthetic-refresh-existing' },
    response: { ok: true }, authorized: true,
  }]);
  const earlier = startRegistration(h);
  requireInitialPending(h, 'LOGOUT');
  const logout = h.api.authLogout();
  assert.equal(h.pending('logout'), true, 'LOGOUT_NORMAL_REQUEST_PENDING');
  h.release('logout');
  assert.equal(await logout, undefined, 'LOGOUT_NORMAL_FULFILLED');
  assert.equal(h.isCanonical(null), true, 'LOGOUT_COMPLETED_CANONICAL_ABSENT');
  assert.equal(h.pending('register'), true, 'LOGOUT_REGISTER_STILL_PENDING_AFTER_LOGOUT');
  requireEffects(h, { removes: 1, events: 1, uiUpdates: 1, mypageCalls: 1 }, 'LOGOUT_COMPLETED_EXACT_EFFECTS');
  h.replaceReferral();
  assert.equal(h.referral(), REFERRAL_CURRENT, 'LOGOUT_CURRENT_REFERRAL_SEEDED');
  h.release('register');
  const outcome = await earlier;
  requireNormalCompletion(outcome, h, 'register', 'LOGOUT_EARLIER_COMPLETION');
  h.assertComplete();
  return h;
}

test('control: one normal registration stores canonical auth', async () => {
  const h = fixture('candidate', [registerPlan()]);
  const pending = startRegistration(h);
  requireInitialPending(h, 'CONTROL');
  h.release('register');
  const outcome = await pending;
  requireNormalCompletion(outcome, h, 'register', 'CONTROL_COMPLETION');
  h.assertComplete();
  assert.equal(h.isCanonical(canonical('a')), true, 'CONTROL_COMPLETED_STORED');
  assert.equal(h.referral(), null, 'CONTROL_REFERRAL_CLEARED');
  requireEffects(h, { writes: 1, events: 1, referralRemoves: 1 }, 'CONTROL_EXACT_EFFECTS');
});

test('currentness: earlier registration preserves newer completed login', async () => {
  const old = await afterNewerCompletedLogin('original');
  requireEffects(old, { writes: 2, events: 2, referralRemoves: 1, loginLogs: 1 }, 'ORIGINAL_LOGIN_EXACT_MUTATIONS');
  assert.equal(old.isCanonical(canonical('a')), true, 'ORIGINAL_LOGIN_REPLACED_WITH_REGISTER_AUTH');
  assert.equal(old.referral(), null, 'ORIGINAL_LOGIN_REMOVED_CURRENT_REFERRAL');

  const current = await afterNewerCompletedLogin('candidate');
  requireEffects(current, { writes: 1, events: 1, loginLogs: 1 }, 'CANDIDATE_LOGIN_EXACT_EFFECTS');
  assert.equal(current.referral(), REFERRAL_CURRENT, 'CANDIDATE_LOGIN_CURRENT_REFERRAL_PRESERVED');
  assert.equal(current.isCanonical(canonical('b')), true, 'REGISTER_PRESERVE_NEWER_COMPLETED_LOGIN');
});

test('currentness: earlier registration preserves completed explicit logout', async () => {
  const old = await afterCompletedLogout('original');
  requireEffects(old, { writes: 1, removes: 1, events: 2, referralRemoves: 1,
    uiUpdates: 1, mypageCalls: 1 }, 'ORIGINAL_LOGOUT_EXACT_MUTATIONS');
  assert.equal(old.isCanonical(canonical('a')), true, 'ORIGINAL_LOGOUT_RESTORED_REGISTER_AUTH');
  assert.equal(old.referral(), null, 'ORIGINAL_LOGOUT_REMOVED_CURRENT_REFERRAL');

  const current = await afterCompletedLogout('candidate');
  requireEffects(current, { removes: 1, events: 1, uiUpdates: 1, mypageCalls: 1 }, 'CANDIDATE_LOGOUT_EXACT_EFFECTS');
  assert.equal(current.referral(), REFERRAL_CURRENT, 'CANDIDATE_LOGOUT_CURRENT_REFERRAL_PRESERVED');
  assert.equal(current.isCanonical(null), true, 'REGISTER_PRESERVE_COMPLETED_LOGOUT');
});

test('control: completed refresh correspondence allows normal registration', async () => {
  const h = fixture('candidate', [registerPlan()]);
  const pending = startRegistration(h);
  requireInitialPending(h, 'REFRESH_CONTROL');
  const refreshed = { ...canonical('existing'), accessToken: 'synthetic-access-existing-refreshed',
    refreshToken: 'synthetic-refresh-existing-refreshed' };
  assert.equal(h.api.seedCompletedRefresh(refreshed), true, 'REFRESH_CONTROL_EXISTING_CORRESPONDENCE');
  assert.equal(h.isCanonical(refreshed), true, 'REFRESH_CONTROL_CANONICAL_ROTATED');
  assert.equal(h.pending('register'), true, 'REFRESH_CONTROL_REGISTER_STILL_PENDING');
  assert.equal(h.referral(), REFERRAL_INITIAL, 'REFRESH_CONTROL_REFERRAL_UNCHANGED');
  requireEffects(h, { writes: 1, events: 1 }, 'REFRESH_CONTROL_SEED_EFFECTS');
  h.release('register');
  const outcome = await pending;
  requireNormalCompletion(outcome, h, 'register', 'REFRESH_CONTROL_COMPLETION');
  h.assertComplete();
  assert.equal(h.isCanonical(canonical('a')), true, 'REFRESH_CONTROL_REGISTER_STORED');
  assert.equal(h.referral(), null, 'REFRESH_CONTROL_REFERRAL_CLEARED');
  requireEffects(h, { writes: 2, events: 2, referralRemoves: 1 }, 'REFRESH_CONTROL_EXACT_EFFECTS');
});

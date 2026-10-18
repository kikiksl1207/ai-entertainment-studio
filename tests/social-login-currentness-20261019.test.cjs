'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextDecoder, isDeepStrictEqual } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.js');
const FUNCTIONS = Object.freeze(['authRequestSession', 'authRequestSessionCurrent', 'refreshAuthOnce',
  'getAuth', 'setAuth', 'clearAuth', 'getRefreshToken', 'authLogin', 'authLogout', 'applyAuthResponse',
  'completeAuthReturnIntent', 'handleKakaoCallback', 'handleNaverCallback', 'handleGoogleTokenResponse']);
const VARIABLES = Object.freeze(['_refreshInFlight', '_refreshCompleted', 'AUTH_STORAGE_KEY', '_authReturnIntent']);
const PROVIDERS = Object.freeze(['kakao', 'naver', 'google']);
const CALLBACK = Object.freeze({ kakao: 'handleKakaoCallback', naver: 'handleNaverCallback',
  google: 'handleGoogleTokenResponse' });
const TRANSITIONS = Object.freeze(['newer-other-user', 'newer-same-user-new-pair', 'completed-logout']);
const LABEL = Object.freeze({ kakao: 'Kakao', naver: 'Naver', google: 'Google' });
const KEY = 'lumina_auth';
const API = 'https://qa.example.invalid';
const ORIGIN = 'https://qa.example.invalid';
const INTENT = Object.freeze({ href: '/synthetic-return', label: 'Synthetic return' });
const ORACLE = {
  "deltaKeys": ["sets", "removes", "authEvents", "close", "ui", "page", "wallet", "returns", "navigation", "alerts", "expired", "warn", "error"],
  "acceptedDelta": { "sets": 1, "removes": 0, "authEvents": 1, "close": 1, "ui": 1, "page": 1, "wallet": 1, "returns": 1, "navigation": 1, "alerts": 0, "expired": 0, "warn": 0, "error": 0 },
  "rejectedDelta": { "sets": 0, "removes": 0, "authEvents": 0, "close": 0, "ui": 0, "page": 0, "wallet": 0, "returns": 0, "navigation": 0, "alerts": 0, "expired": 0, "warn": 0, "error": 0 },
  "acceptedEvents": ["auth:set", "auth:event", "ui:close", "ui:update", "page:init", "wallet:load", "timer:return", "timer:run-return", "navigation:assign"],
  "preludes": {
    "kakao": { "events": ["session:remove:oauth_provider", "history:replace", "api:social"], "counts": [1, 1, 1] },
    "naver": { "events": ["session:remove:naver_oauth_state", "session:remove:oauth_provider", "history:replace", "api:social"], "counts": [2, 2, 1] },
    "google": { "events": ["api:social"], "counts": [0, 0, 0] }
  },
  "transitionEvents": {
    "newer-other-user": ["api:login", "auth:set", "auth:event"],
    "newer-same-user-new-pair": ["api:login", "auth:set", "auth:event"],
    "completed-logout": ["api:logout", "auth:remove", "auth:event", "ui:update", "page:init"],
    "normal-current": [],
    "normal-refresh": ["timer:refresh-deadline", "fetch:refresh", "json:refresh", "auth:set", "auth:event", "timer:clear-refresh-deadline", "timer:refresh-release", "timer:run-refresh-release"]
  },
  "requestCounts": {
    "newer-other-user": [1, 1, 0, 0, 0],
    "newer-same-user-new-pair": [1, 1, 0, 0, 0],
    "completed-logout": [1, 0, 1, 0, 0],
    "normal-current": [1, 0, 0, 0, 0],
    "normal-refresh": [1, 0, 0, 1, 1]
  }
};
const CASES = Object.freeze([
  ...PROVIDERS.flatMap(provider => TRANSITIONS.map(transition => ({ provider, transition, outcome: 'PROTECTED' }))),
  ...PROVIDERS.map(provider => ({ provider, transition: 'normal-current', outcome: 'NORMAL_CURRENT' })),
  ...PROVIDERS.map(provider => ({ provider, transition: 'normal-refresh', outcome: 'NORMAL_REFRESH' }))
].map(row => Object.freeze({ ...row,
  title: 'social currentness ' + LABEL[row.provider] + ' ' + row.transition + ' ' + row.outcome })));
const plain = value => JSON.parse(JSON.stringify(value));
function must(condition, label) { assert.equal(Boolean(condition), true, label); }
function same(actual, expected, label) { must(isDeepStrictEqual(plain(actual), plain(expected)), label); }
function packet(auth) { return { user: auth.user, tokens: { accessToken: auth.accessToken, refreshToken: auth.refreshToken } }; }
function auth(user, pair) {
  return { accessToken: 'synthetic-access-' + pair, refreshToken: 'synthetic-refresh-' + pair,
    user: { id: 'synthetic-user-' + user, displayName: 'Synthetic ' + user } };
}
function deferred() {
  let resolve, released = false;
  const promise = new Promise(done => { resolve = done; });
  return { promise, release(value) { if (!released) { released = true; resolve(value); } } };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('SYNTHETIC_SETTLEMENT_DEADLINE')), 400);
    })]);
  } finally { clearTimeout(timer); }
}

function extract(source, ts) {
  const tree = ts.createSourceFile(APP, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  must(tree.parseDiagnostics.length === 0, 'SOURCE_PARSE_DIAGNOSTICS');
  const slices = FUNCTIONS.map(name => {
    const found = tree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    must(found.length === 1 && found[0].body, 'ONE_TOP_LEVEL_FUNCTION_' + name);
    return found[0].getText(tree);
  });
  const declarations = VARIABLES.map(name => {
    const found = tree.statements.filter(node => ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(decl => ts.isIdentifier(decl.name) && decl.name.text === name));
    must(found.length === 1 && found[0].declarationList.declarations.length === 1, 'ONE_TOP_LEVEL_VARIABLE_' + name);
    return found[0].getText(tree);
  });
  // Only selected genuine declarations execute; no app init, SDK loader or whole-app boot.
  const bundle = declarations.join('\n') + '\n' + slices.join('\n') +
    '\n_authReturnIntent = __syntheticIntent;\n' +
    'globalThis.__subjects = Object.freeze({' + FUNCTIONS.join(',') +
    ', state: () => ({ refresh: _refreshCompleted, flight: _refreshInFlight, intent: _authReturnIntent })' +
    ', identities: () => [' + FUNCTIONS.join(',') + '] });';
  return new vm.Script(bundle, { filename: 'genuine-social-subjects.js' });
}

async function scenario(row, script) {
  const provider = row.provider, transition = row.transition;
  const a = auth('A', 'A-one'), other = auth('B', 'B-one'), pair = auth('A', 'A-two');
  const rotated = auth('A', 'A-rotated'), social = auth('S', 'S-one');
  const initial = plain(a), untouched = 'synthetic-unrelated-sentinel';
  const store = new Map([[KEY, JSON.stringify(a)], ['unrelated', untouched]]);
  const session = new Map();
  if (provider !== 'google') session.set('oauth_provider', provider);
  if (provider === 'naver') session.set('naver_oauth_state', 'synthetic-state');
  const socialPacket = packet(social), exchange = deferred(), events = [], faults = [];
  const c = { sets: 0, removes: 0, authEvents: 0, close: 0, ui: 0, page: 0, wallet: 0,
    returns: 0, navigation: 0, alerts: 0, expired: 0, warn: 0, error: 0, info: 0,
    social: 0, login: 0, logout: 0, fetch: 0, json: 0, abort: 0,
    sessionGets: 0, sessionRemoves: 0, history: 0, settled: 0 };
  const guard = fn => (...args) => {
    try { return fn(...args); } catch (error) { faults.push(error); throw error; }
  };
  const timers = new Map();
  let nextTimer = 0, subjects, tracked, firstError, receipt;
  const location = { origin: ORIGIN, pathname: '/',
    search: provider === 'kakao' ? '?code=synthetic-code' : '',
    hash: provider === 'naver' ? '#access_token=synthetic-provider-token&state=synthetic-state' : '',
    assign: guard(href => { same(href, INTENT.href, 'RETURN_TARGET'); c.navigation++; events.push('navigation:assign'); }) };
  const schedule = guard((callback, ms) => {
    must(typeof callback === 'function' && [0, 80, 8000].includes(ms), 'TIMER_BOUNDARY');
    must(timers.size < 4 && nextTimer < 8, 'TIMER_COUNT_CAP');
    const label = ms === 8000 ? 'refresh-deadline' : ms === 0 ? 'refresh-release' : 'return';
    if (ms === 80) { c.returns++; }
    events.push('timer:' + label);
    const id = ++nextTimer; timers.set(id, { callback, ms, label }); return id;
  });
  const clear = guard(id => {
    const item = timers.get(id); must(Boolean(item), 'KNOWN_TIMER_CLEAR');
    events.push('timer:clear-' + item.label); timers.delete(id);
  });
  function flush(ms) {
    const ready = [...timers.entries()].filter(([, item]) => item.ms === ms);
    must(ready.length <= 1, 'FINITE_TIMER_FLUSH');
    for (const [id, item] of ready) {
      timers.delete(id); events.push('timer:run-' + item.label); item.callback();
    }
  }
  const request = guard((route, options) => {
    if (route === '/api/v1/auth/social/login') {
      must(++c.social === 1, 'ONE_SOCIAL_EXCHANGE'); events.push('api:social');
      const body = provider === 'kakao'
        ? { provider, code: 'synthetic-code', redirectUri: ORIGIN }
        : { provider, token: 'synthetic-provider-token' };
      same(options, { method: 'POST', body, throwOnError: true }, 'SOCIAL_REQUEST_BODY_AND_FLAGS');
      return exchange.promise;
    }
    if (route === '/api/v1/auth/login') {
      must(TRANSITIONS.slice(0, 2).includes(transition) && ++c.login === 1, 'ONE_GENUINE_EMAIL_LOGIN');
      events.push('api:login');
      same(options, { method: 'POST', body: { email: 'qa@example.invalid', password: 'synthetic-password' },
        throwOnError: true }, 'EMAIL_REQUEST_BODY_AND_FLAGS');
      return Promise.resolve(packet(transition === 'newer-other-user' ? other : pair));
    }
    if (route === '/api/v1/auth/logout') {
      must(transition === 'completed-logout' && ++c.logout === 1, 'ONE_GENUINE_LOGOUT');
      events.push('api:logout');
      same(options, { method: 'POST', auth: true, body: { refreshToken: a.refreshToken } }, 'LOGOUT_REQUEST_BODY_AND_FLAGS');
      return Promise.resolve(null);
    }
    throw new Error('UNADMITTED_API_BOUNDARY');
  });
  class SyntheticAbortController {
    constructor() { this.signal = Object.freeze({ syntheticSignal: true }); }
    abort() { c.abort++; }
  }
  const fetchRefresh = guard((url, options) => {
    must(transition === 'normal-refresh' && ++c.fetch === 1, 'ONE_FIXED_REFRESH_FETCH');
    events.push('fetch:refresh');
    same(url, API + '/api/v1/auth/refresh', 'REFRESH_URL');
    same(options, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: a.refreshToken }), signal: { syntheticSignal: true } }, 'REFRESH_REQUEST_BODY_AND_FLAGS');
    return Promise.resolve({ ok: true, status: 200, json: guard(async () => {
      must(++c.json === 1, 'ONE_REFRESH_JSON'); events.push('json:refresh'); return packet(rotated);
    }) });
  });
  const context = vm.createContext({ API_BASE: API, __syntheticIntent: INTENT, URLSearchParams,
    apiFetch: request, fetch: fetchRefresh, AbortController: SyntheticAbortController,
    setTimeout: schedule, clearTimeout: clear,
    Event: class { constructor(type) { this.type = type; } },
    window: { location, dispatchEvent: guard(event => {
      same(event.type, 'lumina:authchange', 'GENUINE_AUTH_EVENT'); c.authEvents++; events.push('auth:event'); return true;
    }) },
    history: { replaceState: guard((state, title, pathname) => {
      same([state, title, pathname], [{}, '', '/'], 'OAUTH_HISTORY_CLEANUP');
      c.history++; events.push('history:replace'); location.search = ''; location.hash = '';
    }) },
    sessionStorage: {
      getItem: guard(key => {
        must(['oauth_provider', 'naver_oauth_state'].includes(key), 'SESSION_READ_KEY');
        c.sessionGets++; return session.get(key) ?? null;
      }),
      removeItem: guard(key => {
        must(['oauth_provider', 'naver_oauth_state'].includes(key), 'SESSION_REMOVE_KEY');
        c.sessionRemoves++; session.delete(key); events.push('session:remove:' + key);
      })
    },
    localStorage: {
      getItem: guard(key => { same(key, KEY, 'CANONICAL_READ_KEY'); return store.get(key) ?? null; }),
      setItem: guard((key, value) => {
        same(key, KEY, 'CANONICAL_SET_KEY'); must(typeof value === 'string', 'CANONICAL_SERIALIZATION');
        JSON.parse(value); c.sets++; store.set(key, value); events.push('auth:set');
      }),
      removeItem: guard(key => { same(key, KEY, 'CANONICAL_REMOVE_KEY'); c.removes++; store.delete(key); events.push('auth:remove'); })
    },
    closeAuthModal: () => { c.close++; events.push('ui:close'); },
    updateAuthUI: () => { c.ui++; events.push('ui:update'); },
    initMypagePage: () => { c.page++; events.push('page:init'); },
    loadWallet: async () => { c.wallet++; events.push('wallet:load'); },
    notifyAuthExpired: () => { c.expired++; }, alert: () => { c.alerts++; }, maskEmail: () => 'synthetic-masked',
    console: { info: () => { c.info++; }, warn: () => { c.warn++; }, error: () => { c.error++; } }
  }, { codeGeneration: { strings: false, wasm: false } });
  const canonical = () => store.has(KEY) ? JSON.parse(store.get(KEY)) : null;
  const counterSnapshot = () => Object.fromEntries(ORACLE.deltaKeys.map(key => [key, c[key]]));
  try {
    script.runInContext(context, { timeout: 1000 }); subjects = context.__subjects;
    const identities = subjects.identities(), captured = subjects.authRequestSession();
    must(FUNCTIONS.every((name, i) => subjects[name] === identities[i]), 'GENUINE_FUNCTION_IDENTITIES');
    same(canonical(), initial, 'INITIAL_SYNTHETIC_FIXTURE');
    const promise = subjects[CALLBACK[provider]](...(provider === 'google' ? [{ access_token: 'synthetic-provider-token' }] : []));
    must(promise && typeof promise.then === 'function', 'GENUINE_CALLBACK_PROMISE');
    tracked = Promise.resolve(promise).then(value => { c.settled++; return { value }; }, error => { c.settled++; return { error }; });
    must(c.social === 1 && c.settled === 0, 'DEFERRED_SOCIAL_STARTED_AND_UNSETTLED');
    const prelude = ORACLE.preludes[provider];
    same(events, prelude.events, 'OAUTH_PRELUDE_ORDER');
    same([c.sessionGets, c.sessionRemoves, c.history], prelude.counts, 'OAUTH_PRELUDE_COUNTS');
    must(session.size === 0, 'OAUTH_MARKERS_CONSUMED');
    same([location.search, location.hash], ['', ''], 'OAUTH_LOCATION_CLEANUP');
    same([c.sets, c.removes, c.authEvents, c.ui], [0, 0, 0, 0], 'NO_PREMATURE_AUTH_COMPLETION');
    let before = initial;
    if (TRANSITIONS.slice(0, 2).includes(transition)) {
      before = transition === 'newer-other-user' ? other : pair;
      const result = await bounded(subjects.authLogin('qa@example.invalid', 'synthetic-password'));
      same(result, packet(before), 'GENUINE_EMAIL_RETURN');
      same(canonical(), before, 'NEW_EMAIL_COMPLETED_CANONICAL');
      must(before.accessToken !== a.accessToken && before.refreshToken !== a.refreshToken, 'DISTINCT_NEW_PAIR');
      must((before.user.id === a.user.id) === (transition === 'newer-same-user-new-pair'), 'OTHER_USER_VS_SAME_USER');
    } else if (transition === 'completed-logout') {
      const result = await bounded(subjects.authLogout());
      must(result === undefined, 'GENUINE_LOGOUT_RETURN'); before = null;
      must(!store.has(KEY) && canonical() === null, 'GENUINE_LOGOUT_REMOVED_CANONICAL');
    } else if (transition === 'normal-refresh') {
      const result = await bounded(subjects.refreshAuthOnce()); before = rotated;
      same(result, rotated, 'GENUINE_REFRESH_RETURN'); same(canonical(), rotated, 'GENUINE_REFRESH_WRITE');
      const state = subjects.state();
      must(state.refresh?.session === captured && state.refresh.auth === result, 'GENUINE_REFRESH_CONTINUITY_RECORD');
      must(subjects.authRequestSession() !== captured, 'REAL_SYNTHETIC_ROTATION_CHANGED_PAIR');
      flush(0); must(subjects.state().flight === null, 'REFRESH_FLIGHT_SETTLED');
    } else { must(transition === 'normal-current', 'KNOWN_TRANSITION'); }
    same(canonical(), before, 'BEFORE_LATE_CANONICAL');
    const current = subjects.authRequestSessionCurrent(captured);
    must(current === !TRANSITIONS.includes(transition), 'UNCHANGED_HELPER_CURRENTNESS_BEFORE_RELEASE');
    const beforeCounters = counterSnapshot(), beforeEvents = events.slice();
    exchange.release(socialPacket);
    const completed = await bounded(tracked);
    if (completed.error) throw completed.error;
    must(completed.value === undefined && c.settled === 1, 'CALLBACK_ONCE_SETTLED_RETURN');
    flush(80);
    const accepts = !TRANSITIONS.includes(transition);
    same(canonical(), accepts ? social : before, 'FULL_CANONICAL_AFTER_LATE');
    must(store.get('unrelated') === untouched && store.size === (canonical() === null ? 1 : 2), 'UNRELATED_FIXTURE_PRESERVED');
    same(subjects.state().intent, accepts ? null : INTENT, 'RETURN_INTENT_LIFETIME');
    must(subjects.state().intent === (accepts ? null : INTENT), 'RETURN_INTENT_REFERENCE_LIFETIME');
    must(subjects.state().refresh === null && subjects.state().flight === null, 'REFRESH_STATE_FINAL');
    must(c.abort === 0 && timers.size === 0, 'NO_ABORT_OR_PENDING_TIMER');
    must(c.alerts === 0 && c.expired === 0 && c.warn === 0 && c.error === 0, 'NO_FAILURE_NOTIFICATION');
    same(events.slice(beforeEvents.length), accepts ? ORACLE.acceptedEvents : [], 'LATE_EFFECT_ORDER');
    const delta = Object.fromEntries(ORACLE.deltaKeys.map(key => [key, c[key] - beforeCounters[key]]));
    same(delta, accepts ? ORACLE.acceptedDelta : ORACLE.rejectedDelta, 'LATE_EFFECT_EXACT_DELTA');
    same(events, [...prelude.events, ...ORACLE.transitionEvents[transition], ...(accepts ? ORACLE.acceptedEvents : [])], 'FULL_EFFECT_ORDER');
    same([c.social, c.login, c.logout, c.fetch, c.json], ORACLE.requestCounts[transition], 'TOTAL_REQUEST_COUNTS');
    same([c.sessionGets, c.sessionRemoves, c.history], prelude.counts, 'OAUTH_PRELUDE_NOT_REPEATED');
    same([location.search, location.hash], ['', ''], 'OAUTH_CLEANUP_RETAINED');
    must(c.info === 1 + (c.login ? 1 : 0) + (c.fetch ? 1 : 0) + (accepts ? 2 : 0), 'CONSOLE_INFO_COUNT');
    must(FUNCTIONS.every((name, i) => subjects.identities()[i] === identities[i]), 'FUNCTIONS_NOT_REPLACED');
    if (faults.length) throw faults[0];
    const preserved = isDeepStrictEqual(canonical(), before);
    if (TRANSITIONS.includes(transition)) must(preserved, 'OBSERVED_SEMANTIC_RESULT');
    receipt = { contract: 'social-currentness-default-v1', provider, transition, outcome: row.outcome,
      protected: TRANSITIONS.includes(transition) ? preserved : null, currentBeforeLate: current,
      final: accepts ? 'social' : transition === 'completed-logout' ? 'null' : transition,
      requests: [c.social, c.login, c.logout, c.fetch, c.json],
      oauth: [c.sessionGets, c.sessionRemoves, c.history], lateDelta: delta,
      orderVerified: true, bodiesVerified: true, identitiesStable: true, settled: c.settled, pendingTimers: timers.size };
  } catch (error) { firstError = error; }
  finally {
    // Release once even after an assertion fault; preserve the first error object.
    try {
      exchange.release(socialPacket);
      if (tracked) { const completed = await bounded(tracked); if (completed.error) throw completed.error; }
      flush(0); flush(80);
      must(timers.size === 0 && (!tracked || c.settled === 1), 'FINITE_CLEANUP_SETTLED');
      if (faults.length) throw faults[0];
    } catch (error) { if (!firstError) firstError = error; }
  }
  if (firstError) throw firstError;
  return receipt;
}

let script;
before(() => {
  must(CASES.length === 15, 'EXACT_CASE_COUNT');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(APP));
  const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
  script = extract(source, ts);
}, { timeout: 1000 });

for (const row of CASES) {
  test(row.title, { concurrency: false, timeout: 1000 }, async t => {
    const receipt = await scenario(row, script);
    t.diagnostic('WITNESS ' + JSON.stringify(receipt));
  });
}

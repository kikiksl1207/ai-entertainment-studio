import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { actorA, actorB, excerpts, plain, sha256, sourcePath, sourceHash, tick } from './backstage-admin-context-gap-harness-20261005.mjs';

export { actorA, actorB, sourceHash, tick };
const source = readFileSync(sourcePath, 'utf8');
assert.equal(sha256(source), sourceHash, 'Consumer and core excerpts must use identical source bytes');
const anchors = [
  ['googleError', 'function googleLoginErrorMessage(', 'async function backstageFetch('],
  ['googleCredential', 'async function handleGoogleCredentialResponse(', 'async function handleGoogleLogin('],
  ['bootstrap', 'async function bootstrapBackstage(', 'document.querySelectorAll(".sidebar-nav a").forEach((link) => {'],
  ['showDashboard', 'function showDashboard(', 'function markBackstageReady('],
];
export const consumerExcerpts = anchors.map(([name, start, end]) => {
  const from = source.indexOf(start); const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing actual consumer: ${name}`);
  const body = source.slice(from, to);
  return { name, line: source.slice(0, from).split('\n').length, sha256: sha256(body), body };
});
const runtime = [...excerpts, ...consumerExcerpts].map(item => item.body).join('\n') + `
this.api = { auth: getBackstageAuth, setAuth: setBackstageAuth, verify: verifyAdminAccess,
  login: handleLogin, google: handleGoogleCredentialResponse, bootstrap: bootstrapBackstage,
  canAccess: canAccessBackstageSection };
`;
export function consumerHarness() {
  const storage = new Map(); const tokens = new Map(); const calls = []; const events = [];
  const snapshotActor = () => {
    const raw = storage.get('lumina_backstage_auth');
    return raw ? JSON.parse(raw).user?.id || null : null;
  };
  const classes = initial => {
    const values = new Set(initial);
    return { contains: value => values.has(value), add: value => values.add(value),
      remove: value => values.delete(value), toggle: (value, on) => on ? values.add(value) : values.delete(value) };
  };
  const control = () => ({ textContent: '', disabled: false, classList: classes([]), setAttribute() {} });
  const loginStatus = control();
  let statusText = '';
  Object.defineProperty(loginStatus, 'textContent', { get: () => statusText,
    set: text => { statusText = text; events.push({ event: 'status', actor: snapshotActor(), text }); } });
  const emailInput = { value: 'actor-a@example.invalid' };
  let NativePromise;
  const context = createContext({
    window: { LUMINA_API_BASE: 'https://ram-consumer-boundary.invalid' },
    emailInput, passwordInput: { value: 'synthetic-not-a-secret' },
    loginStatus, loginButton: control(), googleButton: control(), googleButtonFallback: control(),
    loginView: { classList: classes([]) }, dashboardView: { classList: classes(['is-hidden']) },
    operatorEmail: control(),
    document: { getElementById: id => ({ id }), querySelectorAll: () => [], querySelector: () => null },
    setActiveSection: section => events.push({ event: 'dashboard-consumer', actor: snapshotActor(), section }),
    renderBackstageTables() {}, updateTodayLabel() {}, loadSection() {},
    showLogin: () => events.push({ event: 'show-login-boundary', actor: snapshotActor() }),
    console: { warn: message => events.push({ event: 'google-warning', message }) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        storage.set(key, String(value));
        if (key === 'lumina_backstage_auth') events.push({ event: 'auth-write', actor: snapshotActor() });
      },
      removeItem(key) {
        storage.delete(key);
        if (key === 'lumina_backstage_auth') events.push({ event: 'auth-cleared' });
      },
    },
    fetch(url, options) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://ram-consumer-boundary.invalid');
      const path = parsed.pathname + parsed.search;
      assert.ok(['/api/v1/auth/login', '/api/v1/auth/social/login',
        '/admin/api/v1/me', '/admin/api/v1/audit-events?take=1'].includes(path), 'Deny every other route');
      let actor;
      if (path === '/api/v1/auth/login') {
        assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert.equal(body.password, 'synthetic-not-a-secret');
        assert.ok(['actor-a@example.invalid', 'actor-b@example.invalid'].includes(body.email));
        actor = body.email === 'actor-a@example.invalid' ? actorA : actorB;
      } else if (path === '/api/v1/auth/social/login') {
        assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, undefined);
        assert.deepEqual(JSON.parse(options.body), { provider: 'google', token: 'synthetic-google-a' });
        actor = actorA;
      } else {
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        actor = tokens.get(options.headers.Authorization);
      }
      assert.ok(actor, 'Registered synthetic credentials only');
      const call = { path, actor, responded: false };
      calls.push(call); events.push({ event: 'request', path, actor });
      return new NativePromise(resolve => {
        call.respond = (body, status = 200) => {
          assert.equal(call.responded, false); call.responded = true; call.status = status;
          events.push({ event: 'response', path, actor, status });
          resolve({ status, ok: status >= 200 && status < 300, json: () => NativePromise.resolve(plain(body)) });
        };
      });
    },
  });
  NativePromise = runInContext('Promise', context);
  runInContext(runtime, context, { filename: 'actual-backstage-consumer-excerpts.js' });
  const api = context.api;
  const authFor = actor => {
    const accessToken = actor === actorA ? 'ram-consumer-a' : 'ram-consumer-b';
    tokens.set(`Bearer ${accessToken}`, actor);
    return { accessToken, refreshToken: actor === actorA ? 'ram-refresh-a' : 'ram-refresh-b',
      user: { id: actor, email: actor === actorA ? 'actor-a@example.invalid' : 'actor-b@example.invalid' } };
  };
  const meFor = actor => ({ user: authFor(actor).user,
    admin: { id: actor === actorA ? 'synthetic-admin-a' : 'synthetic-admin-b', status: 'active',
      role: actor === actorA ? 'super_admin' : 'cs_admin',
      permissions: actor === actorA ? ['*'] : ['users:read', 'audit:read'], source: 'admin_users' } });
  api.setAuth(authFor(actorA)); events.length = 0;
  const observe = promise => {
    const operation = { settled: false, error: null };
    promise.then(() => { operation.settled = true; }, error => {
      operation.error = { status: error.status, code: error.code || null }; operation.settled = true;
    });
    return operation;
  };
  return { api, calls, events, authFor, meFor,
    start(kind = 'login', actor = actorA) {
      if (kind === 'verify') return observe(api.verify());
      if (kind === 'bootstrap') return observe(api.bootstrap());
      if (kind === 'google') return observe(api.google({ credential: 'synthetic-google-a' }));
      emailInput.value = actor === actorA ? 'actor-a@example.invalid' : 'actor-b@example.invalid';
      return observe(api.login({ preventDefault() {} }));
    },
    async request(path, actor) {
      for (let i = 0; i < 12; i++) {
        const call = calls.find(item => item.path === path && item.actor === actor && !item.responded);
        if (call) return call;
        await tick();
      }
      assert.fail(`No pending RAM request: ${path} ${actor}`);
    },
    async drain(operation) {
      for (let i = 0; i < 12 && !operation.settled; i++) await tick();
      assert.equal(operation.settled, true, 'All owned RAM operations must settle');
    },
    snapshot() { return { auth: plain(api.auth()), canAccessAdmins: api.canAccess('admins'),
      calls: calls.map(({ path, actor, status }) => ({ path, actor, status: status ?? null })),
      events: plain(events), statusText }; },
  };
}

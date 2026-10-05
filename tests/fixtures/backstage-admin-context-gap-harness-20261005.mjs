import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

export const actorA = '20000000-0000-4000-8000-000000000001';
export const actorB = '20000000-0000-4000-8000-000000000002';
export const tick = () => new Promise(resolve => setImmediate(resolve));
export const plain = value => JSON.parse(JSON.stringify(value));
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const sourcePath = process.env.BACKSTAGE_CONTEXT_GAP_SOURCE || new URL('../../backstage.js', import.meta.url);
const bytes = readFileSync(sourcePath);
export const sourceHash = sha256(bytes);
const source = bytes.toString('utf8');

const anchors = [
  ['constants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
  ['sectionState', 'const sectionState =', 'const GOOGLE_CLIENT_ID ='],
  ['statusClasses', 'const statusClassMap =', 'const backstageRows ='],
  ['tableMeta', 'const tableMeta =', 'const sectionLoaders ='],
  ['storage', 'function getBackstageAuth(', 'function getSavedSection('],
  ['section', 'function getSavedSection(', 'function saveActiveSection('],
  ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
  ['normalizeRefreshApply', 'function extractAuthPayload(', 'function loadGoogleSDK('],
  ['loginStatus', 'function setStatus(', 'function googleLoginErrorMessage('],
  ['loginHandler', 'async function handleLogin(', 'async function bootstrapBackstage('],
  ['pathsVerify', 'function publicApiPath(', 'function statusBadge('],
  ['render', 'function statusBadge(', 'function readSectionSearch('],
  ['loading', 'function renderLoadingRow(', 'function renderErrorRow('],
  ['errorStatus', 'function backstageErrorStatus(', 'function backstageUserFacingError('],
  ['firstValue', 'function firstValue(', 'function splitTargetUsers('],
  ['escapeHtml', 'function escapeHtml(', 'function firstRoleName('],
  ['permissions', 'function currentAdminRoleName(', 'function formatCount('],
  ['adminFormatting', 'function formatDate(', 'function localizeWorkflowStatus('],
  ['adminLoader', 'async function loadAdminsSection(', 'function renderUsersStatus('],
];
export const excerpts = anchors.map(([name, start, end]) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing actual excerpt: ${name}`);
  const body = source.slice(from, to);
  return { name, line: source.slice(0, from).split('\n').length, sha256: sha256(body), body };
});
const runtime = excerpts.map(item => item.body).join('\n') + `
this.api = { auth: getBackstageAuth, setAuth: setBackstageAuth, fetch: backstageFetch,
  refresh: refreshBackstageAuthOnce, apply: applyAdminContext, verify: verifyAdminAccess,
  loadAdmins: loadAdminsSection, login: handleLogin, canAccess: canAccessBackstageSection,
  state: () => sectionState.admins };
`;

export function harness({ holdPath = '/admin/api/v1/me', expired = false, visible = true } = {}) {
  const storage = new Map();
  const credentials = new Map();
  const refreshCredentials = new Map();
  const calls = [];
  const trace = [];
  const classes = new Set(visible ? [] : ['is-hidden']);
  const nodes = new Map();
  const note = { textContent: '' };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, innerHTML: '',
      querySelector: selector => selector === '[data-admins-status]' ? note : null });
    return nodes.get(id);
  };
  const readSite = () => {
    const stack = new Error().stack;
    if (stack.includes('at applyAdminContext')) return 'applyAdminContext';
    if (stack.includes('at syncCurrentAdminContext')) return 'syncCurrentAdminContext';
    if (stack.includes('at checkCurrent')) return 'backstageFetch.checkCurrent';
    if (stack.includes('at isCurrent')) return 'consumer-or-refresh.isCurrent';
    return 'other';
  };
  let NativePromise;
  const control = () => ({ disabled: false, textContent: '',
    classList: { toggle() {} }, setAttribute() {} });
  const context = createContext({
    window: { LUMINA_API_BASE: 'https://ram-context-gap.invalid' },
    dashboardView: { classList: { contains: name => classes.has(name) } },
    emailInput: { value: 'actor-b@example.invalid' },
    passwordInput: { value: 'synthetic-not-a-secret' },
    loginButton: control(), googleButton: control(), googleButtonFallback: control(), loginStatus: control(),
    showDashboard: () => trace.push({ event: 'dashboard-shown' }),
    document: {
      getElementById: node,
      querySelector: selector => selector === '.dashboard-main'
        ? { getAttribute: () => 'admins' } : null,
      querySelectorAll: () => [],
    },
    localStorage: {
      getItem(key) {
        const raw = storage.get(key) ?? null;
        if (key === 'lumina_backstage_auth') trace.push({ event: 'auth-read',
          site: readSite(), actor: raw ? JSON.parse(raw).user?.id : null });
        return raw;
      },
      setItem(key, value) {
        storage.set(key, String(value));
        if (key === 'lumina_backstage_auth') {
          const auth = JSON.parse(value);
          trace.push({ event: 'auth-write', site: readSite(), actor: auth.user?.id,
            credentialActor: credentials.get(`Bearer ${auth.accessToken || auth.access_token}`) || null,
            role: auth.user?.adminUser?.role?.name || auth.user?.adminRole || null });
        }
      },
      removeItem: key => storage.delete(key),
    },
    fetch(url, options) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://ram-context-gap.invalid', 'No real transport permitted');
      const path = parsed.pathname + parsed.search;
      const allowed = ['/api/v1/auth/login', '/admin/api/v1/me', '/admin/api/v1/audit-events?take=1',
        '/admin/api/v1/admin-users', '/admin/api/v1/admin-roles',
        '/admin/api/v1/audit-events?take=10&targetType=admin_user', '/api/v1/auth/refresh'];
      assert.ok(allowed.includes(path), `Deny-network route: ${path}`);
      let actor;
      if (path === '/api/v1/auth/login') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, undefined);
        assert.deepEqual(JSON.parse(options.body), { email: 'actor-b@example.invalid', password: 'synthetic-not-a-secret' });
        actor = actorB;
      } else if (path === '/api/v1/auth/refresh') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, undefined);
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body), ['refreshToken']);
        actor = refreshCredentials.get(body.refreshToken);
      } else {
        assert.equal(options.method, 'GET');
        assert.equal(options.body, undefined);
        actor = credentials.get(options.headers.Authorization);
      }
      assert.ok(actor, 'Only registered synthetic RAM credentials may initiate requests');
      const call = { path, actor, responded: false, jsonStarted: false };
      calls.push(call);
      trace.push({ event: 'request', path, actor });
      return new NativePromise(resolve => {
        call.respond = (body, status = 200) => {
          assert.equal(call.responded, false);
          call.responded = true;
          call.status = status;
          resolve({ status, ok: status >= 200 && status < 300,
            json: () => { call.jsonStarted = true; return NativePromise.resolve(plain(body)); } });
        };
        call.deferJson = (status = 200) => {
          assert.equal(call.responded, false);
          call.responded = true;
          call.status = status;
          let release;
          const bodyPromise = new NativePromise(resolveJson => { release = resolveJson; });
          resolve({ status, ok: status >= 200 && status < 300,
            json: () => { call.jsonStarted = true; return bodyPromise; } });
          return body => {
            assert.equal(call.jsonStarted, true, 'Actual response.json must already be awaiting');
            trace.push({ event: 'json-release', path });
            release(plain(body));
          };
        };
        if (path === '/api/v1/auth/refresh') {
          credentials.set('Bearer ram-a-refreshed', actorA);
          call.respond({ accessToken: 'ram-a-refreshed', refreshToken: 'ram-refresh-a',
            user: { id: actorA, email: 'actor-a@example.invalid' } });
        } else if (expired && path === '/admin/api/v1/me' && calls.filter(c => c.path === path).length === 1) {
          call.respond({ message: 'Synthetic expired access' }, 401);
        } else if (path !== holdPath && path !== '/api/v1/auth/login') {
          // This models denial only. It is not a live backend or a JWT authorization test.
          const denied = actor === actorB;
          call.respond(denied ? { message: 'Synthetic nonadmin denied' } : { items: [] }, denied ? 403 : 200);
        }
      });
    },
  });
  NativePromise = runInContext('Promise', context);
  runInContext(runtime, context, { filename: 'actual-backstage-context-excerpts.js' });
  const api = context.api;
  const authFor = (actor = actorA, access = actor === actorA ? 'ram-access-a' : 'ram-access-b') => {
    credentials.set(`Bearer ${access}`, actor);
    const refresh = actor === actorA ? 'ram-refresh-a' : 'ram-refresh-b';
    refreshCredentials.set(refresh, actor);
    return { access_token: access, refresh_token: refresh,
      viewer: { id: actor, email: actor === actorA ? 'actor-a@example.invalid' : 'actor-b@example.invalid',
        adminRole: actor === actorA ? 'super_admin' : null,
        adminPermissions: actor === actorA ? ['*'] : [] } };
  };
  const setActor = (actor = actorA, access) => {
    const raw = authFor(actor, access);
    // Real storage/normalization functions accept the actual API field aliases.
    api.setAuth({ ...raw, user: raw.viewer });
  };
  setActor();
  trace.length = 0;
  const observe = promise => {
    const operation = { settled: false, error: null };
    promise.then(() => { operation.settled = true; trace.push({ event: 'consumer-settled' }); },
      error => { operation.error = { status: error.status, code: error.code || null };
        operation.settled = true; trace.push({ event: 'consumer-rejected', ...operation.error }); });
    return operation;
  };
  const h = { api, calls, trace, nodes, storage, setActor, authFor,
    startVerify: () => observe(api.verify()),
    startAdmins: () => observe(api.loadAdmins()),
    startLogin: () => observe(api.login({ preventDefault() {} })),
    async pendingJson(path = holdPath, actor = actorA) {
      for (let i = 0; i < 8; i++) {
        const pending = calls.find(call => call.path === path && call.actor === actor && !call.responded);
        if (pending) {
          const release = pending.deferJson();
          await tick();
          assert.equal(pending.jsonStarted, true);
          return release;
        }
        await tick();
      }
      assert.fail('No pending RAM JSON request');
    },
    releaseAndSchedule(release, body, actor = actorB, access) {
      release(body);
      // Independent native auth completion. No product function is wrapped or rewritten.
      // JSON .catch runs, this reaction queues auth, then fetch checks A and resolves.
      NativePromise.resolve().then(() => queueMicrotask(() => {
        trace.push({ event: 'independent-auth-microtask', actor });
        setActor(actor, access);
        trace.push({ event: 'auth-switch-complete', actor });
      }));
    },
    async drain(operation) {
      for (let i = 0; i < 12 && !operation.settled; i++) await tick();
      assert.equal(operation.settled, true, 'No unresolved RAM requests may remain');
    },
    snapshot() {
      const auth = plain(api.auth());
      return { auth, canAccessAdmins: api.canAccess('admins'), state: plain(api.state()),
        calls: calls.map(({ path, actor, status }) => ({ path, actor, status: status ?? null })), trace: plain(trace) };
    },
  };
  return h;
}

export const adminContextA = {
  user: { id: actorA, email: 'actor-a@example.invalid' },
  admin: { id: 'synthetic-admin-a', status: 'active', role: 'super_admin', permissions: ['*'],
    lastAccessAt: null, source: 'admin_users' },
};
export const adminListA = { items: [{ id: 'synthetic-admin-a', userId: actorA,
  user: { id: actorA, email: 'actor-a@example.invalid' }, status: 'active',
  role: { name: 'super_admin', permissions: ['*'] } }] };

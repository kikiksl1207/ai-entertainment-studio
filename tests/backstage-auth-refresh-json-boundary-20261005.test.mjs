import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(process.env.BACKSTAGE_REFRESH_JSON_TEST_SOURCE || new URL('../backstage.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const actorA = '10000000-0000-4000-8000-000000000001';
const actorB = '10000000-0000-4000-8000-000000000002';
const readPath = '/admin/api/v1/admin-users';
const refreshPath = '/api/v1/auth/refresh';
const publicPath = '/api/v1/qa-public-read';

export function sourceExcerpts(text = source) {
  const anchors = [
    ['constants', 'const BACKSTAGE_API_BASE =', 'const loginView ='],
    ['authStorage', 'function getBackstageAuth(', 'function getSavedSection('],
    ['normalizeRefresh', 'function normalizeAuthPayload(', 'function applyAdminContext('],
    ['paths', 'function publicApiPath(', 'async function verifyAdminAccess('],
    ['fetch', 'async function backstageFetch(', 'window.LuminaBackstageApi ='],
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
this.api = { fetch: backstageFetch, refresh: refreshBackstageAuthOnce,
  auth: getBackstageAuth, setAuth: setBackstageAuth, normalize: normalizeAuthPayload };
`;

function harness() {
  const storage = new Map(); const tokens = new Map(); const refreshTokens = new Set(); const calls = [];
  const dashboardClasses = new Set();
  const context = {
    window: { LUMINA_API_BASE: 'https://synthetic-json.invalid' },
    dashboardView: { classList: { contains: name => dashboardClasses.has(name) } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key) },
    fetch(url, options) {
      const parsed = new URL(url); assert.equal(parsed.origin, 'https://synthetic-json.invalid'); assert.equal(parsed.search, '');
      assert.ok([readPath, refreshPath, publicPath].includes(parsed.pathname), 'Deny all other transport');
      const bearer = options.headers?.Authorization || null;
      if (parsed.pathname === refreshPath) {
        assert.equal(options.method, 'POST'); assert.equal(bearer, null);
        assert.equal(options.headers['Content-Type'], 'application/json');
        const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body), ['refreshToken']);
        assert.ok(refreshTokens.has(body.refreshToken), 'Refresh credentials must be registered synthetic RAM tokens');
      } else {
        assert.equal(options.method, 'GET'); assert.equal(options.body, undefined);
        if (parsed.pathname === publicPath) assert.equal(bearer, null);
        else assert.ok(tokens.has(bearer), 'Read bearer must be registered synthetic RAM data');
      }
      return new Promise(resolve => {
        const call = { path: parsed.pathname, options, bearer, responded: false, jsonStarted: false,
          respond(body, status = 200) {
            assert.equal(this.responded, false); this.responded = true;
            resolve({ status, ok: status >= 200 && status < 300, json: async () => { this.jsonStarted = true; return plain(body); } });
          },
          respondDeferredJson(status = 200) {
            assert.equal(this.responded, false); this.responded = true; let release; let completed = false;
            const json = new Promise(resolveJson => { release = resolveJson; });
            resolve({ status, ok: status >= 200 && status < 300, json: () => { this.jsonStarted = true; return json; } });
            return body => { assert.equal(this.jsonStarted, true, 'Invalidation must occur inside actual response.json await');
              assert.equal(completed, false); completed = true; release(plain(body)); };
          },
        };
        calls.push(call);
      });
    },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:actual-auth-refresh-json-boundary' });
  const api = context.api;
  const payload = (actor = actorA, accessToken = 'ram-access-a', refreshToken = 'ram-refresh-a') => {
    if (accessToken) tokens.set(`Bearer ${accessToken}`, actor);
    if (refreshToken) refreshTokens.add(refreshToken);
    return { accessToken, refreshToken, user: { id: actor, adminPermissions: ['*'] } };
  };
  const setAuth = (actor = actorA, accessToken = 'ram-access-a', refreshToken = 'ram-refresh-a') => {
    const auth = payload(actor, accessToken, refreshToken); api.setAuth(auth); return auth;
  };
  setAuth();
  const observe = promise => {
    const operation = { settled: false, value: null, error: null };
    promise.then(value => { operation.value = value; operation.settled = true; },
      error => { operation.error = { name: error.name, status: error.status, code: error.code }; operation.settled = true; });
    return operation;
  };
  const h = { context, api, storage, calls, payload, setAuth,
    start() { return observe(api.fetch(readPath, { auth: true })); },
    refresh() { return observe(api.refresh()); },
    publicRead() { return observe(api.fetch(publicPath, { auth: false })); },
    async drain(operation) {
      for (let attempt = 0; attempt < 24 && !operation.settled; attempt++) {
        for (const call of calls) if (!call.responded) {
          assert.notEqual(call.path, refreshPath, 'Tests must explicitly own every refresh response');
          call.respond({ items: [{ id: 'synthetic-read-result' }], hasMore: false });
        }
        await tick();
      }
      assert.equal(operation.settled, true, 'RAM requests must settle; no external service or sleeping needed');
    },
  };
  return h;
}

const authSnapshot = h => plain({ auth: h.api.auth(), storage: [...h.storage.entries()] });
async function awaitRefresh(h, operation) {
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, readPath);
  h.calls[0].respond({ message: 'Synthetic expired access' }, 401); await tick();
  assert.equal(operation.settled, false); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].path, refreshPath);
  assert.equal(JSON.parse(h.calls[1].options.body).refreshToken, 'ram-refresh-a');
}

test('AUTH-JSON-01 returned refresh user mismatching initiating A cannot persist or retry', async () => {
  const h = harness(); const before = authSnapshot(h); const operation = h.start(); await awaitRefresh(h, operation);
  h.calls[1].respond(h.payload(actorB, 'ram-returned-b', 'ram-refresh-b')); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h), status: operation.error?.status || null },
    { calls: 2, auth: before, status: 401 });
});

test('AUTH-JSON-02 switch A to B inside ordinary GET response.json suppresses old result with session error', async () => {
  const h = harness(); const operation = h.start(); const complete = h.calls[0].respondDeferredJson(); await tick();
  assert.equal(h.calls[0].jsonStarted, true); assert.equal(operation.settled, false);
  h.setAuth(actorB, 'ram-access-b', 'ram-refresh-b'); const before = authSnapshot(h);
  complete({ items: [{ id: 'synthetic-obsolete-a' }] }); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h), value: operation.value, error: operation.error },
    { calls: 1, auth: before, value: null, error: { name: 'Error', status: 409, code: 'BACKSTAGE_SESSION_CHANGED' } });
});

test('AUTH-JSON-03 switch A to B inside refresh response.json cannot overwrite B or issue GET retry', async () => {
  const h = harness(); const operation = h.start(); await awaitRefresh(h, operation);
  const complete = h.calls[1].respondDeferredJson(); await tick();
  assert.equal(h.calls[1].jsonStarted, true); assert.equal(operation.settled, false);
  h.setAuth(actorB, 'ram-access-b', 'ram-refresh-b'); const before = authSnapshot(h);
  complete(h.payload(actorA, 'ram-returned-a')); await h.drain(operation);
  assert.deepEqual({ calls: h.calls.length, auth: authSnapshot(h), status: operation.error?.status || null, code: operation.error?.code || null },
    { calls: 2, auth: before, status: 409, code: 'BACKSTAGE_SESSION_CHANGED' });
});

test('AUTH-JSON-04 ordinary same-A JSON completion accepts data and preserves access rotation', async () => {
  const h = harness(); const operation = h.start(); const complete = h.calls[0].respondDeferredJson(); await tick();
  assert.equal(h.calls[0].jsonStarted, true); h.setAuth(actorA, 'ram-access-a-rotated'); const before = authSnapshot(h);
  const body = { items: [{ id: 'synthetic-current-a' }], hasMore: false }; complete(body); await h.drain(operation);
  assert.equal(operation.error, null); assert.deepEqual(plain(operation.value), body);
  assert.equal(h.calls.length, 1); assert.deepEqual(authSnapshot(h), before);
});

test('AUTH-JSON-05 explicit unauthenticated public read without any stable user ID stays normal', async () => {
  const h = harness(); h.api.setAuth(null); assert.equal(h.api.auth(), null); const before = authSnapshot(h);
  const operation = h.publicRead(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].bearer, null);
  const body = { syntheticPublic: true }; h.calls[0].respond(body); await h.drain(operation);
  assert.equal(operation.error, null); assert.deepEqual(plain(operation.value), body); assert.equal(h.calls.length, 1);
  assert.deepEqual(authSnapshot(h), before);
});

test('AUTH-JSON-06 concurrent old refresh JSON cannot overwrite an already accepted new refresh credential', async () => {
  const h = harness(); const first = h.refresh(); const second = h.refresh(); assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(call => call.path === refreshPath && JSON.parse(call.options.body).refreshToken === 'ram-refresh-a'));
  const completeFirst = h.calls[0].respondDeferredJson(); const completeSecond = h.calls[1].respondDeferredJson(); await tick();
  assert.ok(h.calls.every(call => call.jsonStarted));
  completeFirst(h.payload(actorA, 'ram-accepted-access-a', 'ram-accepted-refresh-a')); await h.drain(first);
  assert.equal(first.error, null); assert.equal(h.api.auth().accessToken, 'ram-accepted-access-a');
  assert.equal(h.api.auth().refreshToken, 'ram-accepted-refresh-a'); const before = authSnapshot(h);
  completeSecond(h.payload(actorA, 'ram-late-old-access-a', 'ram-refresh-a')); await h.drain(second);
  assert.equal(second.error, null); assert.equal(second.value, null); assert.equal(h.calls.length, 2);
  assert.deepEqual(authSnapshot(h), before, 'Two refresh calls are allowed; this asserts ownership, not deduplication');
});

test('AUTH-JSON-07 whitespace-only new access token is rejected without retaining it as a new session', async () => {
  const h = harness(); const before = authSnapshot(h); const operation = h.refresh(); assert.equal(h.calls.length, 1);
  h.calls[0].respond({ accessToken: ' \t\r\n ', refreshToken: 'ram-refresh-a', user: { id: actorA } }); await h.drain(operation);
  assert.equal(operation.error, null); assert.equal(operation.value, null); assert.equal(h.calls.length, 1);
  assert.deepEqual(authSnapshot(h), before);
});

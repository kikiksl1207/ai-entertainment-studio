import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('const API_BASE ='), app.indexOf('const I18N_LOCALES ='));
const authA = { accessToken: 'a-old', refreshToken: 'a-refresh', user: { id: 'user-a' } };
const authB = { accessToken: 'b-token', refreshToken: 'b-refresh', user: { id: 'user-b' } };
const rotatedA = { accessToken: 'a-new', refreshToken: 'a-rotated', user: { id: 'user-a' } };

function response(status, body = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(fetch) {
  const values = new Map([['lumina_auth', JSON.stringify(authA)]]);
  const requests = [];
  const events = [];
  const context = {
    AbortController, Event,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: () => 1, clearTimeout() {},
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    window: { dispatchEvent: event => events.push(event.type) },
    console: { warn() {}, info() {} },
    fetch: async (url, options) => {
      requests.push({ path: new URL(url).pathname, options });
      return fetch(new URL(url).pathname, options);
    },
  };
  runInNewContext(source, context);
  runInNewContext(app.slice(app.indexOf('async function authLogout()'), app.indexOf('function applyAuthResponse(')), context);
  context.updateAuthUI = () => { events.push('updated-ui'); };
  return { context, requests, events };
}

test('late 401 never refreshes or retries a mutation as a newly logged-in account', async () => {
  const first = deferred();
  const { context, requests, events } = harness(() => first.promise);
  const request = context.apiFetch('/api/v1/users/target/block', { method: 'POST', auth: true, throwOnError: true, body: {} });
  context.setAuth(authB);
  first.resolve(response(401));
  await assert.rejects(request, error => error.status === 401);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer a-old');
  assert.equal(context.getAuth().user.id, 'user-b');
  assert.equal(events.includes('lumina:auth-expired'), false);
});

for (const outcome of ['success', 'rejected', 'malformed', 'transport']) {
  test(`late refresh ${outcome} cannot replace or clear a different account`, async () => {
    const refresh = deferred();
    const started = deferred();
    const { context, requests, events } = harness((path) => {
      if (path === '/api/v1/auth/refresh') { started.resolve(); return refresh.promise; }
      return response(401);
    });
    const request = context.apiFetch('/private', { auth: true, throwOnError: true });
    await started.promise;
    context.setAuth(authB);
    if (outcome === 'transport') refresh.resolve(Promise.reject(new Error('transport failure')));
    else refresh.resolve(response(outcome === 'rejected' ? 401 : 200, outcome === 'malformed' ? {} : rotatedA));
    await assert.rejects(request, error => error.status === 401);
    assert.equal(context.getAuth().user.id, 'user-b');
    assert.equal(requests.filter(item => item.path === '/private').length, 1);
    assert.equal(events.includes('lumina:auth-expired'), false);
  });
}

test('same account logout and re-login is a new session, even with the same user ID', async () => {
  const first = deferred();
  const { context, requests } = harness(() => first.promise);
  const request = context.apiFetch('/mutation', { method: 'POST', auth: true, throwOnError: true });
  context.clearAuth();
  context.setAuth({ ...authA, accessToken: 'a-login-again', refreshToken: 'a-login-refresh' });
  first.resolve(response(401));
  await assert.rejects(request, error => error.status === 401);
  assert.equal(requests.length, 1);
  assert.equal(context.getAuth().accessToken, 'a-login-again');
});

test('concurrent 401s share refresh only for their captured session and preserve retry details', async () => {
  const refresh = deferred();
  const started = deferred();
  const { context, requests } = harness((path, options) => {
    if (path === '/api/v1/auth/refresh') { started.resolve(); return refresh.promise; }
    return options.headers.Authorization === 'Bearer a-new' ? response(200, { saved: true }) : response(401);
  });
  const options = { method: 'POST', auth: true, throwOnError: true, body: { value: 'test' }, headers: { 'Idempotency-Key': 'test-only-key' } };
  const first = context.apiFetch('/mutation-1', options);
  const second = context.apiFetch('/mutation-2', options);
  await started.promise;
  refresh.resolve(response(200, rotatedA));
  const results = await Promise.all([first, second]);
  assert.equal(results.every(result => result.saved), true);
  assert.equal(requests.filter(item => item.path === '/api/v1/auth/refresh').length, 1);
  const retries = requests.filter(item => item.options.headers.Authorization === 'Bearer a-new');
  assert.equal(retries.length, 2);
  for (const retry of retries) {
    assert.equal(retry.options.method, 'POST');
    assert.equal(retry.options.body, JSON.stringify(options.body));
    assert.equal(retry.options.headers['Idempotency-Key'], 'test-only-key');
  }
});

test('current session refresh failure clears only that session and reports expiry', async () => {
  const { context, events, requests } = harness(path => response(path === '/api/v1/auth/refresh' ? 403 : 401));
  await assert.rejects(context.apiFetch('/private', { auth: true, throwOnError: true }), error => error.status === 401);
  assert.equal(context.getAuth(), null);
  assert.equal(events.includes('lumina:auth-expired'), true);
  assert.equal(requests.length, 2);
});

test('refresh cannot rotate into a different user supplied by a malformed response', async () => {
  const { context, requests } = harness(path => response(path === '/api/v1/auth/refresh' ? 200 : 401, authB));
  await assert.rejects(context.apiFetch('/private', { auth: true, throwOnError: true }), error => error.status === 401);
  assert.equal(context.getAuth(), null);
  assert.equal(requests.length, 2);
});

test('public requests never trigger an authenticated retry', async () => {
  const { context, requests } = harness(() => response(401));
  assert.equal(await context.apiFetch('/public'), null);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test('a late 401 from the old token retries after the refresh mutex has been released', async () => {
  const late = deferred();
  const { context, requests } = harness((path, options) => {
    if (path === '/api/v1/auth/refresh') return response(200, rotatedA);
    if (options.headers.Authorization === 'Bearer a-new') return response(200, { saved: true });
    return path === '/late' ? late.promise : response(401);
  });
  const older = context.apiFetch('/late', { auth: true, throwOnError: true });
  await context.apiFetch('/first', { auth: true, throwOnError: true });
  runInNewContext('_refreshInFlight = null;', context);
  late.resolve(response(401));
  assert.equal((await older).saved, true);
  assert.equal(requests.filter(item => item.path === '/api/v1/auth/refresh').length, 1);
});

for (const sameUser of [false, true]) {
  test(`a late logout does not clear a new ${sameUser ? 'same-user' : 'other-user'} login`, async () => {
    const logout = deferred();
    const { context, events } = harness(() => logout.promise);
    const pending = context.authLogout();
    context.setAuth(sameUser ? { ...authA, accessToken: 'new-login', refreshToken: 'new-login-refresh' } : authB);
    logout.resolve(response(204));
    await pending;
    assert.equal(context.getAuth().accessToken, sameUser ? 'new-login' : 'b-token');
    assert.equal(events.includes('updated-ui'), false);
  });
}

test('logout still clears its own session after a normal token rotation', async () => {
  const logout = deferred();
  const { context } = harness(path => path === '/api/v1/auth/refresh' ? response(200, rotatedA) : logout.promise);
  const pending = context.authLogout();
  await context.refreshAuthOnce();
  logout.resolve(response(204));
  await pending;
  assert.equal(context.getAuth(), null);
});

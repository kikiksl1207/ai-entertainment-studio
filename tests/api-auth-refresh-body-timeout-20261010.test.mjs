import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const studio = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const authStart = app.indexOf('const API_BASE =');
const authEnd = app.indexOf('const I18N_LOCALES =');
assert.ok(authStart >= 0 && authEnd > authStart);
const authSource = app.slice(authStart, authEnd);
const authA = { accessToken: 'synthetic-a-old', refreshToken: 'synthetic-a-refresh',
  user: { id: 'synthetic-owner-a', email: 'a@example.invalid' } };
const authB = { accessToken: 'synthetic-b', refreshToken: 'synthetic-b-refresh',
  user: { id: 'synthetic-owner-b', email: 'b@example.invalid' } };
const rotatedA = { ...authA, accessToken: 'synthetic-a-new', refreshToken: 'synthetic-a-next' };

async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

function controlledClock() {
  let now = 0, next = 0;
  const timers = new Map(), fired = [];
  return {
    timers, fired,
    setTimeout(callback, delay = 0) {
      const id = ++next;
      timers.set(id, { callback, delay, due: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    count(delay) { return [...timers.values()].filter(timer => timer.delay === delay).length; },
    advance(delta) {
      const target = now + delta;
      for (;;) {
        const entry = [...timers].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!entry) break;
        const [id, timer] = entry;
        timers.delete(id);
        now = timer.due;
        fired.push({ id, delay: timer.delay });
        timer.callback();
      }
      now = target;
    },
    clear() { timers.clear(); },
  };
}

function delayedJson(signal) {
  let resolve, reject, settled = false;
  const body = { jsonCalls: 0, aborts: 0, cleanupFinishes: 0, signal };
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  const onAbort = () => {
    body.aborts++;
    if (!settled) {
      settled = true;
      reject(new DOMException('Synthetic response body aborted', 'AbortError'));
    }
  };
  signal.addEventListener('abort', onAbort, { once: true });
  body.response = {
    ok: true, status: 200,
    json() {
      body.jsonCalls++;
      if (signal.aborted && !settled) onAbort();
      return promise;
    },
  };
  body.finish = value => {
    signal.removeEventListener('abort', onAbort);
    if (!settled) { settled = true; resolve(value); }
  };
  body.finishForCleanup = () => {
    if (!settled) body.cleanupFinishes++;
    body.finish({});
  };
  body.isSettled = () => settled;
  return body;
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function fixture({ withStudio = false, bootstrapDenied = false } = {}) {
  const clock = controlledClock();
  const storage = new Map([['lumina_auth', JSON.stringify(authA)]]);
  const calls = [], events = [], bodies = [], operations = [];
  const elements = new Map(), listeners = new Map();
  let refreshMode = 'pending', bootstrapMode = bootstrapDenied ? 'denied' : 'allowed';
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(), handlers = new Map();
      elements.set(id, {
        hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
        classList: {
          add: value => classes.add(value), remove: value => classes.delete(value),
          contains: value => classes.has(value),
          toggle: (value, flag) => flag ? classes.add(value) : classes.delete(value),
        },
        addEventListener: (name, callback) => handlers.set(name, callback),
        click: () => handlers.get('click')?.(),
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        querySelectorAll: () => [],
        querySelector: selector => selector === '[data-studio-retry]' ? element('retry') : null,
        replaceChildren() { this.innerHTML = ''; },
        scrollTo() {}, prepend() {}, reset() {},
      });
    }
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {
      body: element('body'), documentElement: { ...element('html'), lang: 'ko' },
      getElementById: element, querySelectorAll: () => [], querySelector: () => null,
      addEventListener() {}, createElement: () => element('created'),
    },
    URL, URLSearchParams, AbortController, DOMException, Event, FormData, Blob, TextEncoder, TextDecoder,
    CustomEvent: class { constructor(type) { this.type = type; } },
    LUMINA_API_BASE: 'https://api.lumina-stage.com',
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    sessionStorage: { getItem() { return null; } },
    location: { hash: '' }, history: { replaceState() {} }, Date, Math,
    console: { warn() {}, info() {}, log() {}, error() {} },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    dispatchEvent(event) {
      events.push(event.type);
      for (const callback of listeners.get(event.type) || []) callback(event);
      return true;
    },
    async fetch(url, options = {}) {
      const path = new URL(url).pathname;
      calls.push({ path, ...options });
      if (path === '/api/v1/auth/refresh') {
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, undefined);
        assert.equal(options.body, JSON.stringify({ refreshToken: authA.refreshToken }));
        if (refreshMode === 'complete') return response(rotatedA);
        const body = delayedJson(options.signal);
        bodies.push(body);
        return body.response;
      }
      assert.equal(options.method || 'GET', 'GET', 'only synthetic authentication POST is admitted');
      if (path === '/api/v1/me/creator-studio') {
        if (bootstrapMode === 'denied') return response({}, 401);
        return response({ access: { enabled: true }, viewer: { userId: authA.user.id },
          artists: [], summary: {}, policy: {} });
      }
      assert.ok(withStudio && [
        '/api/v1/wallet', '/api/v1/me/creator-studio/settlement-preview',
        '/api/v1/me/creator-studio/payout-summary', '/api/v1/me/creator-studio/settlement-conversions',
        '/api/v1/me/creator-studio/knowledge-urls',
      ].includes(path), 'unexpected synthetic route: ' + path);
      return response({ items: [] });
    },
  });
  context.window = context;
  vm.runInContext(authSource, context, { filename: 'actual-app-auth.js' });
  if (withStudio) {
    const marker = '  verify();';
    const index = studio.lastIndexOf(marker);
    assert.ok(index >= 0);
    // Expose manual entry only; shared refresh and all Studio methods remain real.
    vm.runInContext(studio.slice(0, index) +
      '  window.__studioAccess = { verify };' + studio.slice(index + marker.length),
    context, { filename: 'actual-creator-studio.js' });
  }
  function track(promise) {
    const operation = { settled: false, value: undefined, error: undefined };
    promise.then(value => { operation.value = value; operation.settled = true; },
      error => { operation.error = error; operation.settled = true; });
    operations.push(operation);
    return operation;
  }
  function flightPresent() {
    return vm.runInContext('_refreshInFlight !== null', context);
  }
  async function cleanupPending() {
    // RED witnesses are captured before this resolves unfinished synthetic bodies.
    for (const body of bodies) body.finishForCleanup();
    await flush();
    clock.advance(0);
    await flush();
    return {
      bodiesSettled: bodies.every(body => body.isSettled()),
      operationsSettled: operations.every(operation => operation.settled),
      flightCleared: !flightPresent(),
    };
  }
  return {
    context, clock, calls, events, bodies, element, track, flightPresent, cleanupPending,
    auth: () => JSON.parse(storage.get('lumina_auth') || 'null'),
    completeRefresh() { refreshMode = 'complete'; },
    allowBootstrap() { bootstrapMode = 'allowed'; },
    async dispose() { await cleanupPending(); clock.clear(); },
  };
}

function assertCleanup(cleanup) {
  assert.deepEqual(cleanup, { bodiesSettled: true, operationsSettled: true, flightCleared: true },
    'fixture cleanup is a separate observation, not the timeout witness');
}

test('AUTH-REFRESH-BODY-TIMEOUT-RED: 200 headers with unfinished JSON abort at 8 seconds and release refresh for explicit success', async () => {
  const f = fixture();
  try {
    const pending = f.track(f.context.refreshAuthOnce());
    await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.bodies[0].jsonCalls, 1, 'actual refresh reached its response body');
    assert.equal(pending.settled, false);
    f.clock.advance(8000);
    await flush();
    f.clock.advance(0);
    await flush();
    const witness = Object.freeze({
      timerFired: f.clock.fired.filter(timer => timer.delay === 8000).length,
      aborted: f.bodies[0].signal.aborted,
      settled: pending.settled,
      returnedNull: pending.settled && pending.error === undefined && pending.value === null,
      flightCleared: !f.flightPresent(),
      authCleared: f.auth() === null,
      requests: f.calls.length,
    });
    assertCleanup(await f.cleanupPending());
    assert.deepEqual(witness, { timerFired: 1, aborted: true, settled: true, returnedNull: true,
      flightCleared: true, authCleared: true, requests: 1 },
    'body-timeout witness must precede forced fixture completion');
    f.context.setAuth(authA); // Synthetic session only, not a login or grant.
    f.completeRefresh();
    const followup = f.track(f.context.refreshAuthOnce());
    await flush();
    f.clock.advance(0);
    await flush();
    assert.equal(followup.settled, true);
    assert.equal(followup.error, undefined);
    assert.deepEqual(f.auth(), rotatedA);
    assert.equal(f.calls.length, 2, 'no automatic refresh retry');
    assert.equal(f.flightPresent(), false);
    assert.equal(f.clock.count(8000), 0);
  } finally { await f.dispose(); }
});

test('AUTH-REFRESH-BODY-TIMEOUT: complete JSON keeps its timer until completion and concurrent callers share one session refresh', async () => {
  const f = fixture();
  try {
    const first = f.track(f.context.refreshAuthOnce());
    const second = f.track(f.context.refreshAuthOnce());
    await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.bodies[0].jsonCalls, 1);
    f.clock.advance(7999);
    await flush();
    const waiting = Object.freeze({
      timers: f.clock.count(8000), firstSettled: first.settled,
      secondSettled: second.settled, aborted: f.bodies[0].signal.aborted,
    });
    f.bodies[0].finish(rotatedA);
    await flush();
    f.clock.advance(0);
    await flush();
    assertCleanup(await f.cleanupPending());
    assert.deepEqual(waiting, { timers: 1, firstSettled: false, secondSettled: false, aborted: false });
    assert.equal(first.settled && second.settled, true);
    assert.equal(first.error, undefined);
    assert.equal(second.error, undefined);
    assert.equal(first.value.accessToken, rotatedA.accessToken);
    assert.equal(second.value.accessToken, rotatedA.accessToken);
    assert.deepEqual(f.auth(), rotatedA);
    assert.equal(f.clock.count(8000), 0);
    assert.equal(f.flightPresent(), false);
    f.clock.advance(8000);
    await flush();
    assert.equal(f.bodies[0].aborts, 0, 'completed body has no later abort');
    assert.deepEqual(f.auth(), rotatedA);
    assert.equal(f.calls.length, 1);
  } finally { await f.dispose(); }
});

test('AUTH-REFRESH-BODY-TIMEOUT: timeout and late old-session JSON cannot clear or rotate the next account', async () => {
  for (const outcome of ['timeout', 'late-success']) {
    const f = fixture();
    try {
      const old = f.track(f.context.refreshAuthOnce());
      await flush();
      assert.equal(f.bodies[0].jsonCalls, 1);
      f.context.setAuth(authB);
      if (outcome === 'timeout') f.clock.advance(8000);
      else f.bodies[0].finish(rotatedA);
      await flush();
      f.clock.advance(0);
      await flush();
      const witness = Object.freeze({
        settled: old.settled, returnedNull: old.settled && old.error === undefined && old.value === null,
        aborted: f.bodies[0].signal.aborted, flightCleared: !f.flightPresent(),
        auth: f.auth(), expired: f.events.includes('lumina:auth-expired'),
      });
      assertCleanup(await f.cleanupPending());
      assert.deepEqual(witness, { settled: true, returnedNull: true,
        aborted: outcome === 'timeout', flightCleared: true, auth: authB, expired: false });
      f.bodies[0].finish(rotatedA);
      await flush();
      assert.deepEqual(f.auth(), authB, 'late original-session completion cannot affect current auth');
      assert.equal(f.calls.length, 1, 'account switch does not resend or refresh as the next account');
      assert.equal(f.events.includes('lumina:auth-expired'), false);
    } finally { await f.dispose(); }
  }
});

test('AUTH-REFRESH-BODY-TIMEOUT: real Studio shared wait finishes after refresh-body abort and admits only an explicit later retry', async () => {
  const f = fixture({ withStudio: true, bootstrapDenied: true });
  try {
    const verification = f.track(f.context.__studioAccess.verify());
    await flush();
    const count = path => f.calls.filter(call => call.path === path).length;
    assert.equal(count('/api/v1/me/creator-studio'), 1);
    assert.equal(count('/api/v1/auth/refresh'), 1);
    assert.equal(f.bodies[0].jsonCalls, 1, 'real shared helper, not a substituted Studio refresh');
    assert.equal(verification.settled, false);
    assert.equal(f.element('studioShell').hidden, true);
    f.clock.advance(8000);
    await flush();
    f.clock.advance(0);
    await flush();
    const witness = Object.freeze({
      refreshBodyAborted: f.bodies[0].signal.aborted,
      verificationFinished: verification.settled && verification.error === undefined,
      bootstrapAborted: f.calls.find(call => call.path === '/api/v1/me/creator-studio').signal.aborted,
      verificationDeadlineRemaining: f.clock.count(12000),
      flightCleared: !f.flightPresent(), shellHidden: f.element('studioShell').hidden,
      retryVisible: !f.element('studioGateActions').hidden, authCleared: f.auth() === null,
      bootstrapCalls: count('/api/v1/me/creator-studio'), refreshCalls: count('/api/v1/auth/refresh'),
    });
    assertCleanup(await f.cleanupPending());
    assert.deepEqual(witness, { refreshBodyAborted: true, verificationFinished: true,
      bootstrapAborted: true, verificationDeadlineRemaining: 0,
      flightCleared: true, shellHidden: true, retryVisible: true, authCleared: true,
      bootstrapCalls: 1, refreshCalls: 1 },
    'completion at 8 seconds is shared-body timeout, not the 12-second bootstrap timeout');
    f.context.setAuth(authA);
    f.completeRefresh();
    f.allowBootstrap();
    await flush();
    assert.equal(count('/api/v1/me/creator-studio'), 1, 'synthetic auth restoration does not auto-bootstrap');
    f.element('retry').click();
    await flush();
    f.clock.advance(0);
    await flush();
    assert.equal(f.element('studioShell').hidden, false);
    assert.equal(f.element('studioAccessGate').hidden, true);
    assert.equal(count('/api/v1/me/creator-studio'), 2);
    assert.equal(count('/api/v1/auth/refresh'), 1, 'explicit approved read needs no second refresh');
    assert.equal(f.clock.count(12000), 0);
    assert.deepEqual(f.auth(), authA);
  } finally { await f.dispose(); }
});

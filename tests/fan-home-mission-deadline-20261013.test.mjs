import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Before product raw SHA: 0e8d0225235dd4aead7f93906a2a38026e23461bbcdf313c6efd06639eae8af1.
// Synthetic DOM and in-memory transport only; no API, real account or auth token is used.
const source = readFileSync(new URL('../pages/fan-engagement.js', import.meta.url), 'utf8');
const missionId = '11111111-1111-4111-8111-111111111111';
const otherMissionId = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const listUrl = 'https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3';
const postUrl = `https://api.lumina-stage.com/api/v1/fan-engagement/missions/${missionId}/participations`;
const auth = (token = 'synthetic-access-a', id = userId) => ({ user: { id }, accessToken: token });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

function mission(extra = {}) {
  return { id: missionId, missionType: 'daily_signal', resetPolicy: 'daily', status: 'active',
    participation: { status: 'not_started', remainingCount: 1 },
    rewardPreview: { points: 5, cashLike: false },
    action: { type: 'mission_participation', method: 'POST', endpoint: postUrl.replace('https://api.lumina-stage.com', ''),
      requiresAuth: true, bodyHint: { action: 'complete', idempotencyKey: 'client-generated-key' } },
    ...extra };
}
const completed = extra => mission({ participation: { status: 'accepted', remainingCount: 0 }, ...extra });
const receipt = extra => ({ participation: { id: '33333333-3333-4333-8333-333333333333', missionId, status: 'accepted' },
  rewards: { pointsGranted: 99999 }, idempotentReplay: false, ...extra });

function response(url, data, status = 200, readGate) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let consumed = false, cancelled = false;
  return { ok: status >= 200 && status < 300, status, url,
    body: {
      async cancel() { cancelled = true; },
      getReader() {
        return {
          async read() {
            if (readGate) await readGate;
            if (consumed || cancelled) return { done: true };
            consumed = true; return { done: false, value: bytes };
          },
          async cancel() { cancelled = true; }
        };
      }
    } };
}

function harness({ account = auth(), items = [mission()], get, post, cryptoMissing = false,
  readyState = 'complete', missingAuthReader = false } = {}) {
  const windowHandlers = new Map(), rootHandlers = new Map(), documentHandlers = new Map(), timers = new Map();
  const calls = [], attributes = {}, root = { dataset: {}, isConnected: true, innerHTML: '',
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, fn) { rootHandlers.set(name, fn); },
    contains(button) { return button.root === root; } };
  let currentAuth = account, serverItems = items, keyCount = 0, timerId = 0;
  let getHandler = get, postHandler = post;
  const window = {
    crypto: cryptoMissing ? {} : { randomUUID() { return `00000000-0000-4000-8000-${String(++keyCount).padStart(12, '0')}`; } },
    addEventListener(name, fn) { windowHandlers.set(name, fn); }
  };
  const context = vm.createContext({ window,
    document: { visibilityState: 'visible', readyState,
      getElementById(id) { return id === 'homeMissionTeaser' ? root : null; },
      addEventListener(name, handler, options) { documentHandlers.set(name, { handler, once: options?.once }); } },
    getAuth: missingAuthReader ? undefined : () => currentAuth, AbortController, TextDecoder, Uint8Array,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      calls.push({ url, options });
      if (options.method === 'GET') return Promise.resolve(getHandler
        ? getHandler(url, options) : response(url, { generatedAt: '2026-10-12T14:59:00.000Z', items: serverItems }));
      if (postHandler) return Promise.resolve(postHandler(url, options));
      serverItems = [completed()]; return Promise.resolve(response(url, receipt()));
    }
  });
  vm.runInContext(source, context, { filename: 'fan-engagement.js' });
  function button(id) {
    const selector = id === null ? 'data-home-missions-refresh' : `data-mission-participate="${id}"`;
    const opening = [...root.innerHTML.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(text => text.includes(selector));
    if (!opening) return null;
    return { root, disabled: /\sdisabled(?:\s|>)/.test(opening), dataset: { missionParticipate: id },
      closest() { return this; }, hasAttribute(name) { return id === null && name === 'data-home-missions-refresh'; } };
  }
  function click(id = missionId, trusted = true) {
    const target = button(id);
    if (!target) return false;
    rootHandlers.get('click')({ isTrusted: trusted, target, preventDefault() {} }); return true;
  }
  return { root, calls, attributes, button, click, context,
    get keyCount() { return keyCount; },
    get timerCount() { return timers.size; },
    setItems(value) { serverItems = value; },
    setGet(value) { getHandler = value; },
    setPost(value) { postHandler = value; },
    setAuth(value, emit = true) { currentAuth = value; if (emit) windowHandlers.get('lumina:authchange')(); },
    emit(name, event = {}) { windowHandlers.get(name)?.(event); },
    installAuthReader() { context.getAuth = () => currentAuth; },
    domReady() {
      context.document.readyState = 'interactive';
      const item = documentHandlers.get('DOMContentLoaded');
      if (item?.once) documentHandlers.delete('DOMContentLoaded');
      item?.handler();
    },
    expire() { for (const fn of [...timers.values()]) fn(); },
    posts() { return calls.filter(call => call.options.method === 'POST'); }
  };
}

test('HOME-DEADLINE headers ignoring abort restore error and an explicit refresh', async () => {
  const h = harness({ get: () => new Promise(() => {}) });
  await flush();
  assert.equal(h.root.dataset.state, 'loading');
  h.expire();
  await flush();
  assert.equal(h.root.dataset.state, 'error');
  assert.equal(h.button(null).disabled, false);
  assert.equal(h.timerCount, 0);
  assert.equal(h.posts().length, 0);
});

test('HOME-DEADLINE uncertain post preserves its key for manual retry only', async () => {
  const h = harness({ post: () => new Promise(() => {}) });
  await flush();
  h.click();
  await flush();
  h.expire();
  await flush();
  assert.equal(h.attributes['aria-busy'], 'false');
  assert.equal(h.posts().length, 1);
  assert.equal(h.keyCount, 1);
  const key = JSON.parse(h.posts()[0].options.body).idempotencyKey;
  h.setPost(url => { h.setItems([completed()]); return response(url, receipt()); });
  h.click();
  await flush();
  assert.equal(h.posts().length, 2);
  assert.equal(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
  assert.equal(h.keyCount, 1);
  assert.equal(h.button(missionId).disabled, true);
  assert.equal(h.timerCount, 0);
});

test('HOME-DEADLINE stalled response body retires read state without a partial list', async () => {
  const pending = new Promise(() => {});
  const h = harness({ get: url => response(url, { items: [mission()] }, 200, pending) });
  await flush();
  h.expire();
  await flush();
  assert.equal(h.root.dataset.state, 'error');
  assert.equal(h.button(missionId), null);
  assert.equal(h.button(null).disabled, false);
  assert.equal(h.timerCount, 0);
});

test('HOME-DEADLINE owner replacement does not wait for old headers or apply them later', async () => {
  const old = deferred();
  const h = harness({ get: () => old.promise });
  await flush();
  h.setGet(url => response(url, { items: [] }));
  h.setAuth(auth('synthetic-access-b', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
  await flush();
  assert.equal(h.root.dataset.state, 'empty');
  assert.equal(h.timerCount, 0);
  old.resolve(response(listUrl, { items: [mission()] }));
  await flush();
  assert.equal(h.root.dataset.state, 'empty');
  assert.equal(h.button(missionId), null);
  assert.equal(h.posts().length, 0);
});

test('HOME-DEADLINE late old post cannot retire or confirm a newer same-key request', async () => {
  const old = deferred(), next = deferred();
  const h = harness({ post: () => old.promise });
  await flush();
  h.click();
  await flush();
  h.expire();
  await flush();
  h.setPost(() => next.promise);
  h.click();
  await flush();
  assert.equal(h.posts().length, 2);
  old.resolve(response(postUrl, receipt()));
  await flush();
  assert.equal(h.attributes['aria-busy'], 'true');
  assert.equal(h.button(missionId).disabled, true);
  h.setItems([completed()]);
  next.resolve(response(postUrl, receipt()));
  await flush();
  assert.equal(h.attributes['aria-busy'], 'false');
  assert.equal(h.keyCount, 1);
  assert.equal(h.button(missionId).disabled, true);
  assert.equal(h.timerCount, 0);
});

test('HOME-DEADLINE ignored reader cancellation cannot hold a completed payload open', async () => {
  const h = harness({ get: url => {
    const res = response(url, { items: [mission()] });
    const reader = res.body.getReader();
    reader.cancel = () => new Promise(() => {});
    res.body.getReader = () => reader;
    return res;
  } });
  await flush();
  assert.equal(h.root.dataset.state, 'loading');
  h.expire();
  await flush();
  assert.equal(h.root.dataset.state, 'error');
  assert.equal(h.button(missionId), null);
  assert.equal(h.timerCount, 0);
  assert.equal(h.posts().length, 0);
});

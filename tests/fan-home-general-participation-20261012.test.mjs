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

test('initial HOME read waits for the later app script and DOM ready before using current viewer auth', async () => {
  const h = harness({ readyState: 'loading', missingAuthReader: true }); await flush();
  h.emit('focus'); h.emit('lumina:authchange'); await flush();
  assert.equal(h.calls.length, 0);
  h.installAuthReader(); h.domReady(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.headers.Authorization, 'Bearer synthetic-access-a');
  assert.equal(h.button(missionId).disabled, false);
  h.domReady(); await flush(); assert.equal(h.calls.length, 1);
});

test('DOM-ready initialization retains the anonymous lock when the later app reports no session', async () => {
  const h = harness({ account: null, readyState: 'loading', missingAuthReader: true }); await flush();
  assert.equal(h.calls.length, 0); h.installAuthReader(); h.domReady(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.headers.Authorization, undefined);
  assert.equal(h.button(missionId).disabled, true); h.click(); await flush(); assert.equal(h.posts().length, 0);
});

test('a detached HOME does not start a late DOM-ready request', async () => {
  const h = harness({ readyState: 'loading', missingAuthReader: true }); await flush();
  h.root.isConnected = false; h.installAuthReader(); h.domReady(); await flush();
  assert.equal(h.calls.length, 0); assert.equal(h.posts().length, 0);
});

test('HOME reads the exact current-viewer token at the fixed origin without cookies or retry transport', async () => {
  const h = harness(); await flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, listUrl);
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer synthetic-access-a');
  assert.equal(h.calls[0].options.credentials, 'omit'); assert.equal(h.calls[0].options.redirect, 'error');
  assert.equal(h.calls[0].options.cache, 'no-store'); assert.equal(h.button(missionId).disabled, false);
});

test('only a trusted daily click posts complete with one crypto UUID and then refreshes server truth', async () => {
  const h = harness(); await flush(); h.click(missionId, false); await flush();
  assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  const call = h.posts()[0], body = JSON.parse(call.options.body);
  assert.equal(call.url, postUrl); assert.deepEqual(Object.keys(body), ['action', 'idempotencyKey']);
  assert.equal(body.action, 'complete'); assert.match(body.idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-access-a');
  assert.equal(call.options.redirect, 'error'); assert.equal(call.options.credentials, 'omit');
  assert.equal(h.calls.at(-1).options.method, 'GET'); assert.equal(h.button(missionId).disabled, true);
  assert.match(h.root.innerHTML, /is-completed/); assert.doesNotMatch(h.root.innerHTML, /99999/);
});

test('foreign, protocol-relative, other-mission, encoded and query endpoints cannot post', async () => {
  for (const endpoint of ['https://invalid.example/collect', '//invalid.example/collect',
    `/api/v1/fan-engagement/missions/${otherMissionId}/participations`,
    `/api/v1/fan-engagement/missions/${missionId}/participations?override=1`,
    `/api/v1/fan-engagement/missions/%31${missionId.slice(1)}/participations`]) {
    const row = mission(); row.action.endpoint = endpoint;
    const h = harness({ items: [row] }); await flush(); h.click(); await flush();
    assert.equal(h.button(missionId).disabled, true); assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  }
});

test('unsupported type, reset, method, auth, source hint and remaining-count contracts stay locked', async () => {
  const cases = [mission({ missionType: 'vote_concept' }), mission({ missionType: 'fan_proposal' }),
    mission({ missionType: 'unknown' }), mission({ missionType: undefined, type: 'daily_signal' }),
    mission({ resetPolicy: 'daily:extra' }), mission({ resetPolicy: 'weekly' }),
    mission({ resetPolicy: null }), mission({ action: null }),
    mission({ participation: { status: 'not_started', remainingCount: '1' } }),
    mission({ participation: { status: 'not_started', remainingCount: 0 } })];
  for (const delta of [{ method: 'GET' }, { requiresAuth: false }, { type: 'concept_vote' },
    { bodyHint: { action: 'complete', idempotencyKey: 'client-generated-key', sourceType: 'activity' } }]) {
    const row = mission(); row.action = { ...row.action, ...delta }; cases.push(row);
  }
  for (const row of cases) {
    const h = harness({ items: [row] }); await flush(); h.click(); await flush();
    assert.equal(h.button(missionId).disabled, true); assert.equal(h.posts().length, 0);
  }
});

test('unknown participation and non-open mission statuses never enable mutation', async () => {
  for (const row of [mission({ status: 'open' }), mission({ status: 'closed' }), mission({ status: 'future' }),
    mission({ participation: { status: 'unknown', remainingCount: 1 } }),
    mission({ participation: { status: 'pending', remainingCount: 1 } })]) {
    const h = harness({ items: [row] }); await flush(); h.click(); await flush();
    assert.equal(h.button(missionId).disabled, true); assert.equal(h.posts().length, 0);
  }
});

test('anonymous or malformed auth is not replaced by local-storage credentials', async () => {
  for (const account of [null, { accessToken: 'synthetic-without-user' }, auth('synthetic\r\nheader')]) {
    const h = harness({ account }); await flush(); h.click(); await flush();
    assert.equal(h.calls[0].options.headers.Authorization, undefined);
    assert.equal(h.button(missionId).disabled, true); assert.equal(h.posts().length, 0);
  }
});

test('missing canonical UUID never falls back to missionId or fixture slug for participation', async () => {
  for (const row of [mission({ id: 'not-a-uuid' }), mission({ id: undefined, missionId })]) {
    const h = harness({ items: [row] }); await flush(); h.click(row.id || ''); await flush();
    assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  }
});

test('in-flight double clicks share one intent without a second POST or key', async () => {
  const pending = deferred(), h = harness({ post: () => pending.promise }); await flush();
  h.click(); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  assert.equal(h.button(missionId).disabled, true); assert.equal(h.button(null).disabled, true);
  assert.match(h.root.innerHTML, /aria-busy="true"/);
  h.setItems([completed()]); pending.resolve(response(postUrl, receipt())); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.button(missionId).disabled, true);
});

test('timeout is indeterminate: no automatic POST or new key, explicit retry reuses its key', async () => {
  const h = harness({ post: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Synthetic timeout')), { once: true });
  }) }); await flush(); h.click(); await flush(); h.expire(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); assert.match(h.root.innerHTML, /is-indeterminate/);
  const key = JSON.parse(h.posts()[0].options.body).idempotencyKey;
  h.click(null); await flush(); assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  h.setPost(url => { h.setItems([completed()]); return response(url, receipt({ idempotentReplay: true })); });
  h.click(); await flush();
  assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1);
  assert.equal(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
});

test('HTTP 5xx preserves intent and never prints private error response text', async () => {
  const h = harness({ post: url => response(url, { message: 'synthetic-private-detail' }, 503) });
  await flush(); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
  assert.match(h.root.innerHTML, /is-indeterminate/); assert.doesNotMatch(h.root.innerHTML, /synthetic-private-detail/);
  h.click(); await flush(); assert.equal(h.keyCount, 1);
  assert.equal(h.posts()[0].options.body, h.posts()[1].options.body);
});

test('an unresolved intent keeps its key across new server day metadata and same-user token rotation', async () => {
  const h = harness({ post: url => response(url, {}, 503) }); await flush(); h.click(); await flush();
  const key = JSON.parse(h.posts()[0].options.body).idempotencyKey;
  h.setGet(url => response(url, { generatedAt: '2026-10-13T15:01:00.000Z', items: [mission()] }));
  h.setAuth(auth('synthetic-access-rotated')); await flush();
  assert.equal(h.keyCount, 1); assert.equal(h.posts().length, 1);
  h.click(); await flush();
  assert.equal(h.keyCount, 1); assert.equal(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
  assert.equal(h.posts()[1].options.headers.Authorization, 'Bearer synthetic-access-rotated');
});

test('wrong-mission or unknown-status receipts cannot optimistically complete the card', async () => {
  for (const participation of [{ id: otherMissionId, missionId: otherMissionId, status: 'accepted' },
    { id: otherMissionId, missionId, status: 'unknown' }]) {
    const h = harness({ post: url => response(url, receipt({ participation })) }); await flush(); h.click(); await flush();
    assert.match(h.root.innerHTML, /is-indeterminate/); assert.doesNotMatch(h.root.innerHTML, /is-completed/);
    assert.equal(h.keyCount, 1); assert.equal(h.posts().length, 1);
  }
});

test('duplicate rejection is reconciled only from the viewer list with no extra POST or reward', async () => {
  const h = harness({ post: url => {
    h.setItems([completed()]); return response(url, { code: 'ALREADY_PARTICIPATED' }, 400);
  } }); await flush(); h.click(); await flush();
  assert.match(h.root.innerHTML, /is-completed/); assert.equal(h.posts().length, 1);
  assert.equal(h.calls.at(-1).options.method, 'GET'); assert.equal(h.button(missionId).disabled, true);
});

test('silently stale GET token discards the response and leaves only a usable refresh', async () => {
  const pending = deferred(), h = harness({ get: () => pending.promise });
  h.setAuth(auth('synthetic-access-b'), false);
  pending.resolve(response(listUrl, { items: [mission()] })); await flush();
  assert.equal(h.root.dataset.state, 'error'); assert.equal(h.button(missionId), null);
  assert.equal(h.button(null).disabled, false); assert.equal(h.posts().length, 0);
  h.setGet(null); h.click(null); await flush();
  assert.equal(h.calls.at(-1).options.headers.Authorization, 'Bearer synthetic-access-b');
});

test('stale auth during response-body reading cannot install old viewer state', async () => {
  const gate = deferred(), h = harness({ get: url => response(url, { items: [mission()] }, 200, gate.promise) });
  await flush(); h.setAuth(auth('synthetic-access-b'), false); gate.resolve(); await flush();
  assert.equal(h.root.dataset.state, 'error'); assert.equal(h.button(missionId), null);
  assert.equal(h.posts().length, 0);
});

test('a rejected stale GET also releases refresh without installing old viewer data', async () => {
  const pending = deferred(), h = harness({ get: () => pending.promise });
  h.setAuth(auth('synthetic-access-b'), false); pending.reject(new Error('Synthetic stale transport'));
  await flush(); assert.equal(h.root.dataset.state, 'error'); assert.equal(h.button(null).disabled, false);
  assert.equal(h.button(missionId), null); assert.equal(h.posts().length, 0);
});

test('overlapping auth refreshes accept only the latest GET response', async () => {
  const pending = deferred(), h = harness({ get: () => pending.promise });
  h.setGet(null); h.setAuth(auth('synthetic-access-b')); await flush();
  pending.resolve(response(listUrl, { items: [mission({ status: 'closed' })] })); await flush();
  assert.equal(h.button(missionId).disabled, false); h.click(); await flush();
  assert.equal(h.posts()[0].options.headers.Authorization, 'Bearer synthetic-access-b');
});

test('silent token change before a click cannot send an old-viewer POST', async () => {
  const h = harness(); await flush(); h.setAuth(auth('synthetic-access-b'), false); h.click(); await flush();
  assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
});

test('sign-out during POST ignores a late receipt and cannot display another viewer completion', async () => {
  const pending = deferred(), h = harness({ post: () => pending.promise }); await flush(); h.click(); await flush();
  h.setAuth(null); await flush(); pending.resolve(response(postUrl, receipt())); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.button(missionId).disabled, true);
  assert.doesNotMatch(h.root.innerHTML, /is-completed/);
  assert.equal(h.calls.at(-1).options.headers.Authorization, undefined);
});

test('a late old-viewer POST releases refresh even when the new viewer list is empty', async () => {
  const pending = deferred(), h = harness({ post: () => pending.promise }); await flush(); h.click(); await flush();
  h.setItems([]); h.setAuth(null); await flush(); assert.equal(h.root.dataset.state, 'empty');
  pending.resolve(response(postUrl, receipt())); await flush();
  assert.equal(h.root.dataset.state, 'empty'); assert.equal(h.button(null).disabled, false);
  assert.equal(h.posts().length, 1);
});

test('a late POST failure cannot undo newer same-user server completion after token rotation', async () => {
  const pending = deferred(), h = harness({ post: () => pending.promise }); await flush(); h.click(); await flush();
  h.setItems([completed()]); h.setAuth(auth('synthetic-access-rotated')); await flush();
  pending.resolve(response(postUrl, receipt())); await flush();
  h.setItems([mission()]); h.click(null); await flush(); h.setPost(null); h.click(); await flush();
  assert.equal(h.keyCount, 2); assert.equal(h.posts().length, 2);
  assert.notEqual(h.posts()[0].options.body, h.posts()[1].options.body);
});

test('completed daily intent gets a new key only after fresh server not-started state', async () => {
  const h = harness(); await flush(); h.click(); await flush();
  const key = JSON.parse(h.posts()[0].options.body).idempotencyKey;
  h.click(); await flush(); assert.equal(h.posts().length, 1);
  h.setItems([mission()]); h.click(null); await flush(); assert.equal(h.button(missionId).disabled, false);
  h.click(); await flush(); assert.equal(h.keyCount, 2);
  assert.notEqual(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
});

test('once completion stays locked across refreshes and client clock is not reset authority', async () => {
  const h = harness({ items: [mission({ resetPolicy: 'once' })], post: url => {
    h.setItems([completed({ resetPolicy: 'once' })]); return response(url, receipt());
  } }); await flush(); h.context.Date = class { constructor() { throw new Error('Client clock forbidden'); } };
  h.click(); await flush(); h.click(null); await flush(); h.click(); await flush();
  assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1); assert.equal(h.button(missionId).disabled, true);
});

test('failed, malformed, duplicate or oversized list never falls back to fixture missions', async () => {
  for (const [data, status] of [[{}, 503], [{ items: null }, 200], [{ items: [mission(), mission()] }, 200],
    [{ items: [], padding: 'x'.repeat(262145) }, 200]]) {
    const h = harness({ get: url => response(url, data, status) }); await flush();
    assert.equal(h.root.dataset.state, 'error'); assert.equal(h.button(missionId), null);
    assert.equal(h.posts().length, 0); assert.doesNotMatch(h.root.innerHTML, /mock-daily-signal/);
    assert.equal(h.button(null).disabled, false);
  }
  assert.equal(source.match(/\bhomeMissionFixture\b/g).length, 1);
});

test('missing crypto UUID fails closed without a transport mutation', async () => {
  const h = harness({ cryptoMissing: true }); await flush(); h.click(); await flush();
  assert.equal(h.posts().length, 0); assert.equal(h.root.dataset.state, 'error');
});

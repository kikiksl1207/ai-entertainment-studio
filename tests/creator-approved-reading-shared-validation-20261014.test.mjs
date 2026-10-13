import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

// Source-only handoff: the parent owns the first execution of this new suite.
// Load product scripts, never existing test modules or extracted test cases.
const files = ['creator-approved-readonly-transport.js', 'creator-approved-reading-handoff.js',
  'creator-approved-reading-entry.js', 'creator-body-preview.js', 'creator-approved-reading-body.js'];
const sources = files.map(file => readFileSync(new URL('../pages/' + file, import.meta.url), 'utf8'));
const options = { timeout: 2500 }, origin = 'https://www.lumina-stage.com';
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const owner = id(1), work = id(2), nonce = id(10);
const type = { ready: 'lumina-approved-reading-ready-v1', handoff: 'lumina-approved-reading-handoff-v1',
  check: 'lumina-approved-reading-check-v1', checked: 'lumina-approved-reading-checked-v1',
  revoked: 'lumina-approved-reading-revoked-v1' };
const numericPath = '/api/v1/me/creator-studio/stories/' + work +
  '/generation-profile/approved-section-bytes?measurement=json-utf8-v1';
const bodyPath = '/api/v1/me/creator-studio/stories/' + work + '/body-preview?locale=ja';
const plain = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 80; ++i) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function tracked(promise) {
  const result = { done: false, value: undefined, error: undefined };
  result.completion = Promise.resolve(promise).then(value => { result.done = true; result.value = value; },
    error => { result.done = true; result.error = error; });
  return result;
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(name, fn, config) {
      const list = listeners.get(name) || [];
      list.push({ fn, once: config?.once === true }); listeners.set(name, list);
    },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item.fn !== fn)); },
    dispatchEvent(event) {
      for (const item of [...listeners.get(event.type) || []]) {
        if (item.once) this.removeEventListener(event.type, item.fn);
        item.fn(event);
      }
      return true;
    }
  };
}
const packet = () => ({ contract: 'story-author-body-preview-v1', workId: work, locale: 'ja',
  readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(3), revision: 2, storyVersion: 4, status: 'active', currentBeatPosition: 0,
    scene: { id: id(4), title: 'Synthetic scene', isGenerated: false, endingType: null,
      beats: [{ id: id(5), position: 1, type: 'paragraph', content: 'Synthetic saved prose. Exact spacing.' }] },
    choices: [{ id: id(6), label: 'Synthetic original', routeKind: 'writer_original' }] } });
function bodyResponse({ firstChunk } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(packet()));
  const counters = { read: 0, cancel: 0, release: 0 };
  const reader = {
    read() {
      ++counters.read;
      return counters.read === 1 ? (firstChunk?.promise || Promise.resolve({ done: false, value: bytes })) :
        Promise.resolve({ done: true });
    },
    cancel() { ++counters.cancel; return Promise.resolve(); },
    releaseLock() { ++counters.release; }
  };
  return { status: 200, counters, bytes,
    headers: { get: key => ({ 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store' })[key.toLowerCase()] ?? null },
    body: { getReader: () => reader, cancel: reader.cancel },
    text() { assert.fail('No unbounded body fallback'); }, json() { assert.fail('The actual parser must consume bytes'); } };
}
function fixture(t, { reply = bodyResponse() } = {}) {
  let auth = { accessToken: 'synthetic.A.token', user: { id: owner } }, sequence = 0, peakPending = 0;
  const messages = [], calls = [], states = [], timers = new Map(), intervals = new Map(), elements = new Map();
  const numericReply = { status: 200, syntheticNumeric: true };
  const pending = () => [...timers.values()].filter(timer => timer.ms === 3000).length;
  const setTimeout = (fn, ms) => {
    const key = ++sequence; timers.set(key, { fn, ms });
    peakPending = Math.max(peakPending, pending());
    assert(pending() <= 1, 'At most one raw handoff check may be pending');
    return key;
  };
  const clearTimeout = key => timers.delete(key);
  const opener = { closed: false, postMessage(data, destination) {
    assert.equal(destination, origin); messages.push(data);
  } };
  const window = { ...events(), opener, crypto: { randomUUID: () => nonce }, location: { origin,
    reload() { assert.fail('No page reload in this synthetic popup suite'); } },
    setTimeout, clearTimeout,
    localStorage: { getItem(key) { assert.equal(key, 'lumina_auth'); return JSON.stringify(auth); },
      setItem() { assert.fail('No auth/storage writes'); }, removeItem() { assert.fail('No auth/storage writes'); },
      clear() { assert.fail('No auth/storage writes'); } },
    fetch(url, request) {
      assert.equal(request.method, 'GET'); assert.equal(request.credentials, 'omit');
      assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error');
      assert.equal(request.referrerPolicy, 'no-referrer'); assert.equal(Object.hasOwn(request, 'body'), false);
      assert.equal(request.headers.Authorization, 'Bearer synthetic.A.token');
      assert([numericPath, bodyPath].some(path => url === 'https://api.lumina-stage.com' + path),
        'No refresh, generation, catalog, or other endpoint');
      calls.push({ url, request }); return url.endsWith(bodyPath) ? reply : numericReply;
    } };
  for (const name of ['writerManuscriptWork', 'writerManuscriptLocale', 'readingWorkTitle', 'readingConnectionState',
    'readingLocale', 'readingTitle', 'readingStudioLink', 'readingLocaleLabel']) {
    elements.set(name, { ...events(), value: '', textContent: '', setAttribute() {} });
  }
  elements.get('readingLocale').value = 'en';
  const document = { ...events(), readyState: 'complete', documentElement: { lang: 'en' },
    visibilityState: 'visible', getElementById: name => elements.get(name) || null };
  const context = createContext({ window, document, location: window.location, AbortController, Event,
    TextEncoder, TextDecoder, Uint8Array, setTimeout, clearTimeout,
    setInterval(fn, ms) { const key = ++sequence; intervals.set(key, { fn, ms }); return key; },
    clearInterval(key) { intervals.delete(key); } });
  for (let index = 0; index < sources.length; ++index) runInContext(sources[index], context, { filename: files[index] });
  assert.equal(messages.length, 1); assert.equal(messages[0].type, type.ready); assert.equal(calls.length, 0);
  const receive = data => window.dispatchEvent({ type: 'message', origin, source: opener, data: { nonce, ...data } });
  const handoff = { type: type.handoff, context: { ownerId: owner, workId: work,
    workLabel: 'Synthetic handoff work', sourceLocale: 'ja' } };
  receive(handoff);
  const scope = window.LuminaCreatorApprovedReadingScope, selected = scope.snapshot();
  assert(Object.isFrozen(selected)); assert.equal(selected.sourceLocale, 'ja');
  const bodyTransport = window.LuminaCreatorApprovedReadonlyTransport.createBody();
  const bridge = window.LuminaCreatorApprovedReadingBody.create({ transport: bodyTransport, scope,
    locale: () => document.documentElement.lang, visible: () => true, documentTarget: null,
    onChange: state => states.push(state) });
  const checks = () => messages.filter(message => message.type === type.check);
  function ack(check = checks().at(-1), valid = true) {
    assert(check, 'A fresh check must exist'); receive({ type: type.checked, requestId: check.requestId, valid });
  }
  function numeric(signal = new AbortController().signal) {
    const api = window.LuminaCreatorStudioApi;
    return api.fetch(numericPath, { method: 'GET', identity: api.identity(), token: window.getAuth().accessToken,
      _retried: true, cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }, signal });
  }
  const count = path => calls.filter(call => call.url === 'https://api.lumina-stage.com' + path).length;
  function assertFresh() {
    const ids = checks().map(check => check.requestId);
    assert.deepEqual(ids, Array.from({ length: ids.length }, (_, i) => i + 1));
    for (const check of checks()) assert.deepEqual(Object.keys(check).sort(), ['nonce', 'requestId', 'type']);
    assert(peakPending <= 1); assert(pending() <= 1);
  }
  let closed = false;
  function hide() { window.dispatchEvent({ type: 'pagehide' }); }
  function close() {
    if (closed) return; closed = true; hide(); bridge.dispose(); bodyTransport.dispose();
    assert.equal(timers.size, 0); assert.equal(intervals.size, 0); assertFresh();
  }
  t.after(close);
  return { bridge, scope, selected, states, calls, checks, pending, ack, receive, numeric, numericReply, reply,
    count, assertFresh, hide, handoff, window, elements,
    replace(mode) {
      auth = mode === 'owner' ? { accessToken: 'synthetic.B.token', user: { id: id(20) } } :
        { accessToken: 'synthetic.replaced.token', user: { id: owner } };
      window.dispatchEvent({ type: 'lumina:authchange' });
    },
    restore() { auth = { accessToken: 'synthetic.A.token', user: { id: owner } }; window.dispatchEvent({ type: 'lumina:authchange' }); },
    sample() { for (const timer of [...intervals.values()]) timer.fn(); }
  };
}
async function drain(f, results) {
  for (let i = 0; i < 24; ++i) {
    await flush(); f.assertFresh();
    if (results.every(result => result.done)) { await Promise.all(results.map(result => result.completion)); return; }
    assert.equal(f.pending(), 1, 'Unsettled synthetic reads must be waiting on a handoff check');
    f.ack();
  }
  assert.fail('Bounded acknowledgement pump exhausted');
}
async function waitForChunk(f) {
  for (let i = 0; i < 8 && f.reply.counters.read === 0; ++i) {
    await flush();
    if (f.reply.counters.read === 0) { assert.equal(f.pending(), 1); f.ack(); }
  }
  await flush(); assert.equal(f.reply.counters.read, 1); assert.equal(f.pending(), 0);
}
function success(f, body, numeric) {
  assert.equal(body.error, undefined); assert.equal(body.value, true);
  assert.equal(numeric.error, undefined); assert.equal(numeric.value, f.numericReply);
  assert.deepEqual(plain(f.bridge.snapshot().data), packet());
  assert.equal(f.count(bodyPath), 1); assert.equal(f.count(numericPath), 1); f.assertFresh();
}

for (const order of ['body-first', 'numeric-first']) test(`${order}: actual entry queues fresh body/numeric checks, not successful authority`, options, async t => {
  const f = fixture(t), first = tracked(order === 'body-first' ? f.bridge.load() : f.numeric());
  await flush(); assert.equal(f.checks().length, 1); assert.equal(f.pending(), 1); assert.equal(f.calls.length, 0);
  const second = tracked(order === 'body-first' ? f.numeric() : f.bridge.load());
  await flush(); assert.equal(f.checks().length, 1); assert.equal(second.done, false); assert.equal(f.calls.length, 0);
  const original = f.checks()[0]; f.ack(original); await flush();
  assert.equal(f.checks()[1].requestId, 2); assert.equal(f.pending(), 1);
  assert.equal(f.count(order === 'body-first' ? numericPath : bodyPath), 0, 'Queued GET needs its own acknowledgement');
  assert.equal(second.done, false); f.ack(original); await flush();
  assert.equal(second.done, false); assert.equal(f.pending(), 1, 'Earlier successful acknowledgement cannot satisfy the next caller');
  await drain(f, [first, second]);
  success(f, order === 'body-first' ? first : second, order === 'body-first' ? second : first);
  const calls = f.calls.length, checks = f.checks().length;
  f.sample(); f.window.dispatchEvent({ type: 'focus' }); await flush();
  assert.equal(f.calls.length, calls); assert.equal(f.checks().length, checks, 'Sampling cannot restart either read');
});

test('numeric check overlapping an actual streamed body chunk preserves completion without duplicate GET', options, async t => {
  const chunk = deferred(), reply = bodyResponse({ firstChunk: chunk }), f = fixture(t, { reply });
  const body = tracked(f.bridge.load());
  await waitForChunk(f); assert.equal(body.done, false);
  const numeric = tracked(f.numeric()); await flush(); const before = f.checks().length;
  assert.equal(f.pending(), 1); chunk.resolve({ done: false, value: reply.bytes }); await flush();
  assert.equal(f.checks().length, before, 'Post-chunk body validation queues behind numeric validation');
  assert.equal(f.bridge.snapshot().phase, 'loading'); assert.equal(f.bridge.snapshot().data, null);
  await drain(f, [body, numeric]); success(f, body, numeric); assert.equal(reply.counters.release, 1);
  assert.equal(f.states.at(-1).phase, 'ready');
});

test('aborted queued numeric caller cannot GET or borrow the body acknowledgement; a later explicit caller recovers', options, async t => {
  const f = fixture(t), body = tracked(f.bridge.load()); await flush();
  const abort = new AbortController(), numeric = tracked(f.numeric(abort.signal)); await flush();
  abort.abort(); assert.equal(f.checks().length, 1); await drain(f, [body, numeric]);
  assert(numeric.error); assert.equal(f.count(numericPath), 0); assert.equal(body.value, true);
  const next = tracked(f.numeric()), before = f.checks().length; await flush();
  assert.equal(f.checks().length, before + 1); assert.equal(f.count(numericPath), 0);
  await drain(f, [next]); success(f, body, next);
});

test('aborted queued body gate sends no body GET and does not poison the numeric check', options, async t => {
  const f = fixture(t), numeric = tracked(f.numeric()); await flush();
  const body = tracked(f.bridge.load()); await flush(); f.bridge.invalidate(); await flush();
  assert.equal(body.value, false); assert.equal(f.checks().length, 1); assert.equal(f.calls.length, 0);
  await drain(f, [body, numeric]); assert.equal(numeric.value, f.numericReply); assert.equal(f.count(bodyPath), 0);
  const next = tracked(f.bridge.load()); await drain(f, [next]); success(f, next, numeric);
});

test('aborting an active body check releases the queue, but its late true acknowledgement cannot authorize numeric GET', options, async t => {
  const f = fixture(t), body = tracked(f.bridge.load()); await flush(); const old = f.checks()[0];
  const numeric = tracked(f.numeric()); await flush(); f.bridge.invalidate(); await flush();
  assert.equal(body.value, false); assert.equal(f.checks().length, 2); assert.equal(f.calls.length, 0);
  f.ack(old); await flush(); assert.equal(numeric.done, false); assert.equal(f.calls.length, 0);
  await drain(f, [body, numeric]); assert.equal(numeric.value, f.numericReply); assert.equal(f.count(bodyPath), 0);
});

for (const reason of ['work-revoked', 'owner', 'token', 'pagehide']) {
  for (const order of ['body-first', 'numeric-first']) test(`${reason}/${order}: invalidation stops queued reads and late publication`, options, async t => {
    const f = fixture(t), first = tracked(order === 'body-first' ? f.bridge.load() : f.numeric()); await flush();
    const second = tracked(order === 'body-first' ? f.numeric() : f.bridge.load()); await flush();
    const old = f.checks()[0]; assert.equal(f.checks().length, 1); assert.equal(f.calls.length, 0);
    if (reason === 'work-revoked') f.receive({ type: type.revoked });
    else if (reason === 'pagehide') f.hide(); else f.replace(reason);
    await flush(); await Promise.all([first.completion, second.completion]);
    const body = order === 'body-first' ? first : second, numeric = order === 'body-first' ? second : first;
    assert.equal(body.value, false); assert(numeric.error); assert.equal(f.bridge.snapshot().data, null);
    assert.equal(f.scope.snapshot(), null); assert.equal(f.scope.isCurrent(f.selected), false);
    assert.equal(f.pending(), 0); assert.equal(f.checks().length, 1); assert.equal(f.calls.length, 0);
    if (reason === 'owner' || reason === 'token') f.restore();
    f.ack(old); f.receive(f.handoff); f.sample(); await flush();
    assert.equal(f.scope.snapshot(), null); assert.equal(f.calls.length, 0);
    assert.equal(f.states.some(state => state.data !== null), false, 'No stale body publication');
    assert.equal(f.checks().length, 1, 'No automatic validation retry after invalidation');
  });
}

for (const reason of ['work-revoked', 'owner', 'token', 'pagehide']) test(`${reason}: an already-sent body GET cannot publish a late chunk while numeric validation is pending`, options, async t => {
  const chunk = deferred(), reply = bodyResponse({ firstChunk: chunk }), f = fixture(t, { reply });
  const body = tracked(f.bridge.load()); await waitForChunk(f);
  assert.equal(f.count(bodyPath), 1); const numeric = tracked(f.numeric()); await flush();
  const old = f.checks().at(-1), checkCount = f.checks().length; assert.equal(f.pending(), 1);
  if (reason === 'work-revoked') f.receive({ type: type.revoked });
  else if (reason === 'pagehide') f.hide(); else f.replace(reason);
  await flush(); await Promise.all([body.completion, numeric.completion]);
  assert.equal(body.value, false); assert(numeric.error); assert(reply.counters.cancel > 0);
  if (reason === 'owner' || reason === 'token') f.restore();
  chunk.resolve({ done: false, value: reply.bytes }); f.ack(old); f.receive(f.handoff); await flush();
  assert.equal(f.bridge.snapshot().data, null); assert.equal(f.scope.snapshot(), null);
  assert.equal(f.states.some(state => state.data !== null), false);
  assert.equal(f.count(bodyPath), 1); assert.equal(f.count(numericPath), 0);
  assert.equal(f.checks().length, checkCount); assert.equal(f.pending(), 0);
});

test('a false queued acknowledgement cannot reuse an earlier true body check and later explicit numeric validation remains fresh', options, async t => {
  const f = fixture(t), body = tracked(f.bridge.load()); await flush();
  const numeric = tracked(f.numeric()); await flush(); f.ack(); await flush();
  assert.equal(f.checks().at(-1).requestId, 2); f.ack(undefined, false); await flush();
  assert(numeric.error); assert.equal(f.count(numericPath), 0);
  await drain(f, [body, numeric]); assert.equal(body.value, true);
  const later = tracked(f.numeric()); await flush(); assert.equal(f.count(numericPath), 0);
  await drain(f, [later]); success(f, body, later);
});

test('a genuinely rejected validation tail recovers for the next caller without source replacement', options, async t => {
  const f = fixture(t), fault = new Error('Synthetic signal getter failure');
  // Throw before raw validate installs pending: exceptional-signal fault injection only.
  const poisonedSignal = { get aborted() { throw fault; } };
  const numeric = tracked(f.numeric(poisonedSignal)), body = tracked(f.bridge.load());
  await flush(); assert.equal(numeric.error, fault); assert.equal(f.count(numericPath), 0);
  assert.equal(f.checks().length, 1); assert.equal(f.pending(), 1);
  await drain(f, [numeric, body]); assert.equal(body.value, true);
  assert.deepEqual(plain(f.bridge.snapshot().data), packet()); assert.equal(f.count(bodyPath), 1);
  const next = tracked(f.numeric()); await drain(f, [next]); success(f, body, next);
});

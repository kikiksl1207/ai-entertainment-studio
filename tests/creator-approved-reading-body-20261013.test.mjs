import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

// Source plan UNRUN: actual core controller/parser + actual bridge/mount, synthetic data only.
// Parent runs this unit separately: no live API, provider, storage, database or browser fixtures.
const source = readFileSync(new URL('../pages/creator-approved-reading-body.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const maxBytes = 256 * 1024, options = { timeout: 2500 };
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 80; ++i) await Promise.resolve(); };
const packet = (locale = 'ko', workId = id(2)) => ({
  contract: 'story-author-body-preview-v1', workId, locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(3), revision: 2, storyVersion: 4, status: 'active', currentBeatPosition: 0,
    scene: { id: id(4), title: '<em>Synthetic scene</em>', isGenerated: false, endingType: null,
      beats: [{ id: id(5), position: 1, type: 'paragraph', content: 'Synthetic prose.\r\n  Exact spacing. \uD55C\uAE00 \uD83C\uDFAC' },
        { id: id(6), position: 2, type: 'paragraph', content: '<script>synthetic literal</script>' }] },
    choices: [{ id: id(7), label: '<b>Synthetic original</b>', routeKind: 'writer_original' },
      { id: id(8), label: 'Synthetic branch', routeKind: 'generation_required' },
      { id: id(9), label: 'Synthetic rejoin', routeKind: 'rejoin' }] }
});
function response(value = packet(), { status = 200, headers = {}, raw, chunks, reader, stream = true, cancelPending = false } = {}) {
  const bytes = new TextEncoder().encode(raw === undefined ? JSON.stringify(value) : raw);
  const queue = chunks || [bytes], counters = { read: 0, cancel: 0, release: 0, text: 0 };
  const actualReader = reader || {
    async read() { counters.read++; return queue.length ? { done: false, value: queue.shift() } : { done: true }; },
    cancel() { counters.cancel++; return cancelPending ? new Promise(() => {}) : Promise.resolve(); },
    releaseLock() { counters.release++; }
  };
  const normalized = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', vary: 'Authorization', ...headers };
  return { status, counters, headers: { get: key => normalized[key.toLowerCase()] ?? null },
    body: stream ? { getReader: () => actualReader, cancel: () => { counters.cancel++; return cancelPending ? new Promise(() => {}) : Promise.resolve(); } } : null,
    text() { counters.text++; assert.fail('Unbounded text fallback is forbidden'); } };
}
function events() {
  const listeners = new Map();
  return {
    addEventListener(name, fn, config) {
      const list = listeners.get(name) || []; list.push({ fn, once: config?.once === true }); listeners.set(name, list);
    },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item.fn !== fn)); },
    emit(name, event = {}) {
      let result;
      for (const item of [...listeners.get(name) || []]) {
        if (item.once) this.removeEventListener(name, item.fn);
        result = item.fn({ ...event, type: name, target: event.target || this });
      }
      return result;
    },
    count() { return [...listeners.values()].reduce((sum, list) => sum + list.length, 0); }
  };
}
function element(tag) {
  const node = { ...events(), tagName: tag.toUpperCase(), children: [], parentElement: null, dataset: {}, style: {},
    attributes: {}, className: '', hidden: false, disabled: false, lang: '', id: '' };
  let text = '';
  node.append = (...children) => { for (const child of children) { child.parentElement = node; node.children.push(child); } };
  node.replaceChildren = (...children) => {
    for (const child of node.children) child.parentElement = null;
    node.children = []; text = ''; node.append(...children);
  };
  node.setAttribute = (key, value) => { node.attributes[key] = String(value); };
  node.getAttribute = key => node.attributes[key] ?? null;
  node.removeAttribute = key => { delete node.attributes[key]; };
  Object.defineProperty(node, 'textContent', {
    get: () => text + node.children.map(child => child.textContent).join(''),
    set(value) { node.replaceChildren(); text = String(value); }
  });
  Object.defineProperty(node, 'isConnected', { get() { return node._root === true || node.parentElement?.isConnected === true; } });
  return node;
}
const walk = root => [root, ...root.children.flatMap(walk)];
function clock() {
  let now = 0, sequence = 0;
  const pending = new Map();
  const add = (fn, ms, interval = false) => {
    const number = ++sequence; pending.set(number, { fn, ms, time: now + ms, interval }); return number;
  };
  return { Date: { now: () => now }, setTimeout: (fn, ms) => add(fn, ms), clearTimeout: n => pending.delete(n),
    setInterval: (fn, ms) => add(fn, ms, true), clearInterval: n => pending.delete(n), count: () => pending.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...pending].filter(([, job]) => job.time <= end).sort((a, b) => a[1].time - b[1].time)[0];
        if (!entry) break;
        const [number, job] = entry; now = job.time;
        if (job.interval) job.time += job.ms; else pending.delete(number);
        job.fn();
      }
      now = end;
    }
  };
}
function fixture({ send = () => response(), deadlineMs = 30000, dom = false, ui = 'en', sourceLocale = 'ko', validate } = {}) {
  const timers = clock(), calls = [], validations = [], states = [], observers = [];
  let ownerId = id(1), epoch = 7, entryEpoch = 101, token = 'synthetic.token', shown = true, language = ui;
  let selection = Object.freeze({ ownerId, workId: id(2), workLabel: 'Synthetic work', sourceLocale });
  let selectedEntryEpoch = entryEpoch, entryOwnerId = ownerId, disposedTransport = 0, creates = 0, adapter;
  const scope = Object.freeze({ snapshot: () => selection,
    isCurrent: value => selection !== null && value === selection && selectedEntryEpoch === entryEpoch && value.ownerId === entryOwnerId,
    async validate(value, signal) {
      validations.push({ value, signal });
      return validate ? validate(value, signal, validations.length) : scope.isCurrent(value) && !signal.aborted;
    } });
  const transport = Object.freeze({ identity: () => ({ ownerId, epoch }),
    getAuth: () => token === null ? null : { accessToken: token, user: { id: ownerId } },
    isCurrent: value => !!token && value?.ownerId === ownerId && value.epoch === epoch,
    fetch(path, request) { calls.push({ path, request }); return send(path, request); },
    dispose() { disposedTransport++; } });
  const originalApi = Object.freeze({ numericOnly: true }), originalAuth = () => 'synthetic numeric auth';
  const window = { ...events(), getAuth: originalAuth, LuminaCreatorStudioApi: originalApi,
    LuminaCreatorApprovedReadingScope: scope,
    LuminaCreatorApprovedReadonlyTransport: Object.freeze({ createBody() { creates++; return transport; } }),
    fetch() { assert.fail('No global API fetch'); }, postMessage() { assert.fail('No bridge messages'); },
    localStorage: { getItem() { assert.fail('No direct storage read'); }, setItem() { assert.fail('No storage writes'); } },
    history: { pushState() { assert.fail('No history mutation'); }, replaceState() { assert.fail('No history mutation'); } },
    getComputedStyle: node => node.style };
  const root = element('html'), body = element('body'), host = element('section');
  root._root = true; root.lang = ui; host.id = 'readingSavedBody'; root.append(body); body.append(host);
  const document = dom ? { ...events(), readyState: 'loading', documentElement: root, body, visibilityState: 'visible',
    getElementById: name => walk(root).find(node => node.id === name) || null, createElement: element } : null;
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.targets = []; this.connected = true; observers.push(this); }
    observe(target, config) { this.targets.push({ target, config }); }
    disconnect() { this.connected = false; this.targets = []; }
  }
  const context = createContext({ window, ...(document ? { document } : {}), TextEncoder, TextDecoder, Uint8Array, AbortController,
    MutationObserver, Date: timers.Date, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  runInContext(coreSource, context, { filename: 'actual-body-preview-core.js' });
  const core = window.LuminaCreatorBodyPreview, originalCreate = core.createController;
  core.createController = config => { adapter = config; return originalCreate(config); };
  runInContext(source, context, { filename: 'actual-approved-reading-body.js' });
  const api = window.LuminaCreatorApprovedReadingBody;
  if (dom) document.emit('DOMContentLoaded');
  const bridge = dom ? api.mount(host) : api.create({ transport, scope, deadlineMs, locale: () => language,
    visible: () => shown, onChange: value => states.push(value), documentTarget: null });
  const emit = name => window.emit(name);
  const mutate = (target, attributeName) => {
    for (const observer of observers) if (observer.connected && observer.targets.some(item => item.target === target && item.config.attributeFilter.includes(attributeName))) {
      observer.callback([{ target, attributeName }]);
    }
  };
  return { bridge, api, core, adapter, context, timers, calls, validations, states, window, document, root, body, host, transport, scope,
    originalApi, originalAuth, creates: () => creates, transportDisposes: () => disposedTransport,
    observers: () => observers.filter(observer => observer.connected).length,
    button: () => walk(host).find(node => node.tagName === 'BUTTON'),
    click: () => walk(host).find(node => node.tagName === 'BUTTON').emit('click'), emit, mutate,
    ui(value, notify = true) { language = value; root.lang = value; if (notify) emit('lumina:localechange'); },
    visible(value, notify = true) {
      shown = value; if (dom) document.visibilityState = value ? 'visible' : 'hidden';
      if (notify) { if (dom) document.emit('visibilitychange'); else bridge.invalidate(); }
    },
    choose(workId = id(2), source = sourceLocale, owner = ownerId) {
      selectedEntryEpoch = entryEpoch;
      selection = Object.freeze({ ownerId: owner, workId, workLabel: 'Synthetic work', sourceLocale: source });
      emit('creator:approved-reading-scope-changed');
    },
    selection(value) { selection = value; },
    owner(value, nextToken = token, notify = true) {
      ownerId = value; token = nextToken; ++epoch; ++entryEpoch; entryOwnerId = value;
      if (notify) emit('lumina:authchange');
    },
    token(value, notify = true) { token = value; ++epoch; if (notify) emit('lumina:authchange'); },
    revokeEntry() { ++entryEpoch; },
    close: () => bridge.dispose()
  };
}
const cleared = f => {
  assert.equal(f.bridge.snapshot().data, null);
  assert.equal(f.host.textContent.includes('Synthetic prose'), false);
};
const incoming = f => ({ method: 'GET', identity: f.transport.identity(), _retried: true, cache: 'no-store',
  headers: { 'Cache-Control': 'no-store' }, signal: new AbortController().signal });
const route = locale => `/api/v1/me/creator-studio/stories/${id(2)}/body-preview?locale=${locale}`;

test('constructing and sampling do not call fetch validate storage messages or mutate numeric globals', options, () => {
  const f = fixture();
  for (let i = 0; i < 10; ++i) { f.bridge.snapshot(); f.bridge.syncContext(); }
  f.timers.advance(1000);
  assert.equal(f.calls.length, 0); assert.equal(f.validations.length, 0);
  assert.equal(f.window.LuminaCreatorStudioApi, f.originalApi); assert.equal(f.window.getAuth, f.originalAuth);
  assert.equal(typeof f.adapter.fetch, 'function');
  f.close(); assert.equal(f.timers.count(), 0); assert.equal(f.window.count(), 0);
});
test('explicit load reuses the actual core parser with exact private GET headers token and own epoch', options, async () => {
  const f = fixture(); assert.equal(await f.bridge.load(), true); assert.deepEqual(plain(f.bridge.snapshot().data), packet());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, route('ko'));
  const request = f.calls[0].request;
  assert.equal(request.method, 'GET'); assert.equal(request.token, 'synthetic.token'); assert.equal(request._retried, true);
  assert.equal(request.cache, 'no-store'); assert.deepEqual(plain(request.headers), { Accept: 'application/json', 'Cache-Control': 'no-store' });
  assert.deepEqual(plain(request.identity), { ownerId: id(1), epoch: 7 }); assert.equal(request.body, undefined);
  assert.equal(f.validations.every(item => item.value === f.scope.snapshot()), true);
  assert.equal(f.window.LuminaCreatorStudioApi, f.originalApi); f.close();
});
for (const locale of locales) test(`source ${locale} is independent of display locale`, options, async () => {
  const f = fixture({ sourceLocale: locale, ui: locale === 'en' ? 'ja' : 'en', send: () => response(packet(locale)) });
  assert.equal(await f.bridge.load(), true); assert.equal(f.calls[0].path, route(locale));
  assert.equal(f.bridge.snapshot().locale, locale === 'en' ? 'ja' : 'en'); assert.equal(f.bridge.snapshot().data.locale, locale); f.close();
});
test('entry own epoch may differ and revocation cannot be hidden by an unchanged body epoch', options, async () => {
  const f = fixture(); assert.equal(await f.bridge.load(), true);
  f.revokeEntry(); f.bridge.syncContext(); cleared(f); assert.equal(await f.bridge.load(), false); assert.equal(f.calls.length, 1); f.close();
});
test('an authenticated document without a selected work uses the core noWork state without a call', options, async () => {
  const f = fixture(); f.selection(null); f.bridge.syncContext();
  assert.equal(f.bridge.snapshot().messageKey, 'noWork'); assert.equal(await f.bridge.load(), false);
  assert.equal(f.calls.length, 0); assert.equal(f.validations.length, 0); f.close();
});
const wrongPaths = [route('en'), route('ko') + '&owner=' + id(1), route('ko') + '#fragment', route('ko') + '/',
  route('ko').replace('locale=ko', 'locale=zh'), route('ko').replace(id(2), id(99)), route('ko').replace(id(2), '../unsafe'),
  'https://api.invalid.test' + route('ko'), '//api.invalid.test' + route('ko'),
  '/api/v1/me/creator-studio/stories', '/api/v1/auth/refresh', '/api/v1/wallet',
  `/api/v1/me/creator-studio/stories/${id(2)}/generation-profile/approved-section-bytes?measurement=json-utf8-v1`];
for (const [index, path] of wrongPaths.entries()) test(`bridge rejects wrong URL ${index + 1} before validation or transport`, options, async () => {
  const f = fixture(); await assert.rejects(f.adapter.fetch(path, incoming(f)), { kind: 'invalid' });
  assert.equal(f.calls.length, 0); assert.equal(f.validations.length, 0); f.close();
});
const wrongOptions = [value => { value.method = 'POST'; }, value => { value.body = '{}'; },
  value => { value.headers.Accept = 'application/json'; }, value => { value.headers['Cache-Control'] = 'public'; },
  value => { value.token = 'synthetic injected'; }, value => { value.identity.epoch = 101; },
  value => { value.identity.ownerId = id(99); }, value => { value._retried = false; },
  value => { value.cache = 'default'; }, value => { delete value.signal; }];
for (const [index, change] of wrongOptions.entries()) test(`bridge rejects wrong options ${index + 1}`, options, async () => {
  const f = fixture(), request = incoming(f); change(request);
  await assert.rejects(f.adapter.fetch(route('ko'), request), { kind: 'invalid' }); assert.equal(f.calls.length, 0); f.close();
});
for (const [name, change] of [ ['owner', value => { value.ownerId = id(99); }], ['work', value => { value.workId = '../bad'; }],
  ['source', value => { value.sourceLocale = 'zh'; }], ['extra URL', value => { value.url = '/bad'; }],
  ['extra token', value => { value.token = 'synthetic'; }] ]) test(`invalid scope ${name} cannot send`, options, async () => {
  const f = fixture(), value = plain(f.scope.snapshot()); change(value); f.selection(Object.freeze(value));
  f.bridge.syncContext(); assert.equal(await f.bridge.load(), false); assert.equal(f.calls.length, 0); f.close();
});
for (const token of [null, '', ' synthetic ', 'synthetic\nheader', 'x'.repeat(8193)]) test(`invalid auth token case ${String(token?.length)}`, options, async () => {
  const f = fixture(); f.token(token); assert.equal(await f.bridge.load(), false); assert.equal(f.calls.length, 0); f.close();
});
for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'notFound'], [409, 'conflict'], [500, 'server']]) {
  test(`HTTP ${status} retains core error semantics without reading or retrying`, options, async () => {
    const reply = response(null, { status, cancelPending: true }), f = fixture({ send: () => reply });
    assert.equal(await f.bridge.load(), false); assert.equal(f.bridge.snapshot().messageKey, key);
    assert.equal(reply.counters.read, 0); assert.equal(reply.counters.text, 0); assert.equal(f.calls.length, 1); f.close();
  });
}
const invalidHeaders = [ ['content-type', 'text/html'], ['content-type', 'application/json; charset=latin1'],
  ['content-type', null], ['cache-control', 'no-store'], ['cache-control', 'private'], ['cache-control', null],
  ['cache-control', 'private, no-store, public'], ['cache-control', 'private, no-store, public=0'],
  ['content-length', ''], ['content-length', '-1'], ['content-length', '1.5'], ['content-length', String(maxBytes + 1)] ];
for (const [index, [key, value]] of invalidHeaders.entries()) test(`invalid response headers ${index + 1} are never consumed`, options, async () => {
  const reply = response(packet(), { headers: { [key]: value }, cancelPending: true }), f = fixture({ send: () => reply });
  assert.equal(await f.bridge.load(), false); cleared(f); assert.equal(f.bridge.snapshot().messageKey, 'invalid');
  assert.equal(reply.counters.read, 0); assert.equal(reply.counters.text, 0); f.close();
});
test('private no-store JSON accepts absent or unrelated Vary without requiring Authorization', options, async () => {
  for (const vary of [null, 'Origin']) {
    const reply = response(packet(), { headers: { vary } }), f = fixture({ send: () => reply });
    assert.equal(reply.headers.get('vary'), vary); assert.equal(await f.bridge.load(), true);
    assert.deepEqual(plain(f.bridge.snapshot().data), packet());
    assert.equal(reply.counters.text, 0); assert.equal(f.calls.length, 1); f.close();
  }
});
test('200 without getReader is rejected without an unbounded text fallback', options, async () => {
  const reply = response(packet(), { stream: false }), f = fixture({ send: () => reply });
  assert.equal(await f.bridge.load(), false); assert.equal(reply.counters.text, 0); cleared(f); f.close();
});
test('split multibyte UTF-8 preserves exact prose and runs scope validation around every chunk', options, async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(packet())), at = bytes.indexOf(0xed);
  assert(at >= 0);
  const reply = response(packet(), { chunks: [bytes.slice(0, at + 1), bytes.slice(at + 1, at + 2), bytes.slice(at + 2)] });
  const f = fixture({ send: () => reply }); assert.equal(await f.bridge.load(), true);
  assert.equal(f.bridge.snapshot().data.progress.scene.beats[0].content, packet().progress.scene.beats[0].content);
  assert.equal(f.validations.length, 3 + 2 * reply.counters.read); f.close();
});
for (const [index, bytes] of [new Uint8Array([0xc0, 0xaf]), new Uint8Array([0xed, 0xa0, 0x80]), new Uint8Array([0xe2, 0x82])].entries()) {
  test(`invalid UTF-8 ${index + 1} is rejected by core decoder`, options, async () => {
    const f = fixture({ send: () => response(packet(), { chunks: [bytes] }) });
    assert.equal(await f.bridge.load(), false); assert.equal(f.bridge.snapshot().messageKey, 'invalid'); cleared(f); f.close();
  });
}
for (const extra of [0, 1]) test(`stream at 256 KiB plus ${extra} bytes`, options, async () => {
  const raw = JSON.stringify(packet()), padded = raw + ' '.repeat(maxBytes - Buffer.byteLength(raw) + extra);
  const f = fixture({ send: () => response(packet(), { raw: padded, headers: { 'content-length': String(maxBytes) } }) });
  assert.equal(await f.bridge.load(), extra === 0);
  assert.equal(f.bridge.snapshot().messageKey, extra ? 'invalid' : 'body'); f.close();
});
test('multibyte count is bytes not characters even when advertised length is small', options, async () => {
  const value = packet();
  for (const beat of value.progress.scene.beats) beat.content = '\uD55C'.repeat(45000);
  const raw = JSON.stringify(value); assert(raw.length < maxBytes); assert(Buffer.byteLength(raw) > maxBytes);
  const reply = response(value, { raw, headers: { 'content-length': '1' } });
  const f = fixture({ send: () => reply }); assert.equal(await f.bridge.load(), false); cleared(f); f.close();
});
test('malformed chunk cannot bypass the core through the reader proxy', options, async () => {
  for (const chunk of [{ done: false, value: 'text' }, { done: 'false', value: new Uint8Array() }, null, { done: true, value: new Uint8Array([1]) }]) {
    const reader = { read: async () => chunk, cancel: () => new Promise(() => {}), releaseLock() {} };
    const f = fixture({ send: () => response(packet(), { reader }) }); assert.equal(await f.bridge.load(), false);
    assert.equal(f.bridge.snapshot().messageKey, 'invalid'); f.close();
  }
});
test('payload mismatch is handled by the existing parser rather than a second parser', options, async () => {
  for (const change of [value => { value.locale = 'en'; }, value => { value.workId = id(99); }, value => { value.readOnly = false; },
    value => { value.imageGenerationStarted = true; }, value => { value.progress.choices.push({ id: id(99), label: 'Fourth', routeKind: 'branch' }); }]) {
    const value = packet(); change(value); const f = fixture({ send: () => response(value) });
    assert.equal(await f.bridge.load(), false); assert.equal(f.bridge.snapshot().messageKey, 'invalid'); cleared(f); f.close();
  }
});
test('failed pre-header scope validation performs no body GET', options, async () => {
  const f = fixture({ validate: () => false }); assert.equal(await f.bridge.load(), false); assert.equal(f.calls.length, 0); cleared(f); f.close();
});
test('failed post-header validation never consumes a stream', options, async () => {
  const reply = response(), f = fixture({ send: () => reply, validate: (_, __, count) => count < 2 });
  assert.equal(await f.bridge.load(), false); assert.equal(reply.counters.read, 0); cleared(f); f.close();
});
test('a scope change from a header getter is caught before stream consumption', options, async () => {
  let f; const reply = response(), get = reply.headers.get;
  reply.headers.get = key => { if (key === 'content-type') f.choose(id(99)); return get(key); };
  f = fixture({ send: () => reply }); assert.equal(await f.bridge.load(), false); assert.equal(reply.counters.read, 0); cleared(f); f.close();
});
for (const name of ['owner', 'source', 'UI locale', 'hidden', 'token']) test(`${name} change during ignored-abort fetch settles before late headers`, options, async () => {
  const wait = deferred(), reply = response(packet(), { cancelPending: true }), f = fixture({ send: () => wait.promise });
  const task = f.bridge.load(); await flush(); assert.equal(f.calls.length, 1);
  if (name === 'owner') f.owner(id(99));
  if (name === 'source') f.choose(id(2), 'ja');
  if (name === 'UI locale') f.ui('ja');
  if (name === 'hidden') f.visible(false);
  if (name === 'token') f.token('synthetic.rotated');
  assert.equal(await task, false); cleared(f); assert.equal(f.calls[0].request.signal.aborted, true);
  wait.resolve(reply); await flush(); assert.equal(reply.counters.read, 0); assert(reply.counters.cancel > 0); cleared(f); f.close();
});
for (const name of ['owner', 'work', 'UI locale', 'token']) test(`${name} A-B-A cannot restore a pending scope`, options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), task = f.bridge.load(); await flush();
  if (name === 'owner') { f.owner(id(99)); f.owner(id(1)); f.choose(); }
  if (name === 'work') { f.choose(id(99)); f.choose(); }
  if (name === 'UI locale') { f.ui('ja'); f.ui('en'); }
  if (name === 'token') { f.token('synthetic.other'); f.token('synthetic.token'); }
  assert.equal(await task, false); wait.resolve(response()); await flush(); cleared(f); assert.equal(f.calls.length, 1); f.close();
});
test('late chunk after work revocation cannot publish or hang on ignored reader cancellation', options, async () => {
  const wait = deferred(); let reads = 0, cancels = 0;
  const reader = { read() { reads++; return wait.promise; }, cancel() { cancels++; return new Promise(() => {}); }, releaseLock() {} };
  const f = fixture({ send: () => response(packet(), { reader }) }), task = f.bridge.load(); await flush(); assert.equal(reads, 1);
  f.choose(id(99)); assert.equal(await task, false); cleared(f); assert(cancels > 0);
  wait.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(packet())) }); await flush(); cleared(f); f.close();
});
for (const name of ['owner', 'source', 'UI locale', 'hidden', 'token']) test(`${name} change while a body read ignores abort erases and settles`, options, async () => {
  const wait = deferred(); let reads = 0;
  const reader = { read() { ++reads; return wait.promise; }, cancel: () => new Promise(() => {}), releaseLock() {} };
  const f = fixture({ send: () => response(packet(), { reader }) }), task = f.bridge.load(); await flush(); assert.equal(reads, 1);
  if (name === 'owner') f.owner(id(99));
  if (name === 'source') f.choose(id(2), 'ja');
  if (name === 'UI locale') f.ui('ja');
  if (name === 'hidden') f.visible(false);
  if (name === 'token') f.token('synthetic.rotated');
  assert.equal(await task, false); cleared(f);
  wait.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(packet())) }); await flush(); cleared(f); f.close();
});
test('silent token replacement is observed by the owned interval and settles ignored abort', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), task = f.bridge.load(); await flush();
  f.token('synthetic.rotated', false); f.timers.advance(250); assert.equal(await task, false); cleared(f); f.close();
});
test('header deadline is at most 30 seconds and late response cleanup never blocks settlement', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), task = f.bridge.load(); await flush();
  f.timers.advance(29999); assert.equal(f.bridge.snapshot().busy, true); f.timers.advance(1);
  assert.equal(await task, false); cleared(f); assert.equal(f.calls[0].request.signal.aborted, true);
  const late = response(packet(), { cancelPending: true }); wait.resolve(late); await flush(); assert(late.counters.cancel > 0); f.close();
});
test('body deadline shares the header budget rather than restarting at headers', options, async () => {
  const headers = deferred(), chunks = deferred(); let reads = 0;
  const reader = { read() { reads++; return chunks.promise; }, cancel: () => new Promise(() => {}), releaseLock() {} };
  const f = fixture({ send: () => headers.promise }), task = f.bridge.load(); await flush();
  f.timers.advance(20000); headers.resolve(response(packet(), { reader })); await flush(); assert.equal(reads, 1);
  f.timers.advance(10000); assert.equal(await task, false); cleared(f);
  chunks.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(packet())) }); await flush(); cleared(f); f.close();
});
test('a stuck scope validator is within the same overall deadline', options, async () => {
  const f = fixture({ deadlineMs: 20, validate: () => new Promise(() => {}) }), task = f.bridge.load(); await flush();
  f.timers.advance(20); assert.equal(await task, false); assert.equal(f.calls.length, 0); cleared(f); f.close();
});
test('concurrent explicit clicks cannot duplicate a pending body request', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), task = f.bridge.load(); await flush();
  assert.equal(await f.bridge.load(), false); assert.equal(f.calls.length, 1); wait.resolve(response()); assert.equal(await task, true); f.close();
});
test('a reentrant loading notification cannot close or duplicate the first request', options, async () => {
  const f = fixture(); let nested;
  const bridge = f.api.create({ transport: f.transport, scope: f.scope, locale: () => 'en', visible: () => true,
    documentTarget: null, onChange(state) { if (state.phase === 'loading') nested = bridge.load(); } });
  assert.equal(await bridge.load(), true); assert.equal(await nested, false); assert.equal(f.calls.length, 1);
  bridge.dispose(); f.close();
});
test('actual DOM mount has one explicit icon button and literal prose three nonclickable choices', options, async () => {
  const f = fixture({ dom: true }); assert.equal(f.calls.length, 0); assert.equal(f.validations.length, 0); assert.equal(f.creates(), 1);
  assert.equal(await f.click(), true);
  const nodes = walk(f.host), prose = nodes.filter(node => node.className === 'body-preview-beat');
  assert.equal(nodes.filter(node => node.tagName === 'BUTTON').length, 1);
  assert.equal(nodes.filter(node => node.tagName === 'LI').length, 3);
  assert.equal(nodes.some(node => ['SCRIPT', 'EM', 'B', 'A', 'INPUT', 'SELECT'].includes(node.tagName)), false);
  assert.deepEqual(prose.map(node => node.textContent), packet().progress.scene.beats.map(beat => beat.content));
  assert.equal(nodes.find(node => node.className === 'body-preview-source').lang, 'ko'); assert.equal(f.host.lang, 'en');
  assert(f.host.textContent.includes(f.core.copy.en.originOriginal));
  assert.equal(nodes.filter(node => node.tagName === 'LI').every(node => node.count() === 0), true);
  assert.equal(f.button().getAttribute('aria-label'), f.core.copy.en.refresh);
  assert.equal(f.window.LuminaCreatorStudioApi, f.originalApi); assert.equal(f.window.getAuth, f.originalAuth); f.close();
});
for (const locale of locales) test(`DOM ${locale} retains original AI and ending-reached indicators`, options, async () => {
  let value = packet(), f = fixture({ dom: true, ui: locale, send: () => response(value) });
  for (const endingType of ['author_main', 'author_sub', 'ai_generated']) {
    value = packet(); Object.assign(value.progress, { status: 'completed', choices: [], currentBeatPosition: 0 });
    Object.assign(value.progress.scene, { endingType, isGenerated: endingType === 'ai_generated' });
    assert.equal(await f.click(), true);
    const words = f.core.copy[locale];
    assert(f.host.textContent.includes(words.statusCompleted));
    assert(f.host.textContent.includes(words[endingType === 'author_main' ? 'endingOriginal' : endingType === 'author_sub' ? 'endingAlternate' : 'endingGenerated']));
    assert(f.host.textContent.includes(words[endingType === 'ai_generated' ? 'originGenerated' : 'originOriginal']));
    assert.equal(walk(f.host).filter(node => node.tagName === 'LI').length, 0);
  }
  f.close();
});
test('noProgress is truthful and creates no choices or fake completion or automatic trial', options, async () => {
  const value = packet(); value.progress = null;
  const f = fixture({ dom: true, send: () => response(value) }); assert.equal(await f.click(), true);
  assert.equal(f.bridge.snapshot().messageKey, 'noProgress'); assert(f.host.textContent.includes(f.core.copy.en.noProgress));
  assert.equal(walk(f.host).filter(node => node.tagName === 'LI' || node.tagName === 'DL').length, 0);
  f.timers.advance(1000); assert.equal(f.calls.length, 1); f.close();
});
for (const event of ['creator:approved-reading-scope-changed', 'lumina:localechange', 'lumina:authchange', 'lumina:auth-expired', 'storage']) {
  test(`DOM ready text is erased by ${event} without a fresh request`, options, async () => {
    const f = fixture({ dom: true }); await f.click(); f.emit(event); cleared(f); assert.equal(f.calls.length, 1); f.close();
  });
}
test('hidden visible and language A-B-A mutation records erase retained DOM content', options, async () => {
  const f = fixture({ dom: true }); await f.click();
  f.host.hidden = true; f.host.hidden = false; f.mutate(f.host, 'hidden'); cleared(f); assert.equal(f.calls.length, 1);
  await f.click(); f.root.lang = 'ja'; f.root.lang = 'en'; f.mutate(f.root, 'lang'); cleared(f); assert.equal(f.calls.length, 2); f.close();
});
test('ancestor CSS hiding gates the actual mount and does not reload when visible', options, async () => {
  const f = fixture({ dom: true }); await f.click(); f.body.style.display = 'none'; f.mutate(f.body, 'style');
  cleared(f); assert.equal(f.button().disabled, true); assert.equal(await f.bridge.load(), false);
  f.body.style.display = ''; f.mutate(f.body, 'style'); assert.equal(f.calls.length, 1); f.close();
});
test('single mount duplicate script and pagehide remove only owned resources and erase requests', options, async () => {
  const wait = deferred(), f = fixture({ dom: true, send: () => wait.promise }), button = f.button(), eventCount = f.window.count();
  assert.equal(f.api.mount(f.host), f.bridge);
  runInContext(source, f.context); assert.equal(f.button(), button); assert.equal(f.creates(), 1); assert.equal(f.window.count(), eventCount);
  const task = f.click(); await flush(); f.emit('pagehide'); assert.equal(await task, false);
  assert.equal(f.timers.count(), 0); assert.equal(f.observers(), 0); assert.equal(f.window.count(), 0); assert.equal(f.document.count(), 0);
  assert.equal(button.count(), 0); assert.equal(f.host.textContent, ''); assert.equal(f.transportDisposes(), 1);
  assert.equal(f.host.dataset.approvedReadingBodyMounted, undefined);
  wait.resolve(response()); await flush(); assert.equal(f.host.textContent, ''); assert.equal(await f.bridge.load(), false); f.close();
});
test('old writer host is not mounted and invalid deadline bounds are rejected before any request', options, () => {
  const f = fixture(); assert.equal(f.api.mount({ id: 'writerBodyPreview' }), null);
  for (const deadlineMs of [0, 30001, 1.5, NaN]) assert.throws(() => f.api.create({ transport: f.transport, scope: f.scope, deadlineMs }), { kind: 'invalid' });
  assert.equal(f.calls.length, 0); f.close();
});

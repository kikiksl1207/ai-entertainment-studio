'use strict';
// AUTHOR UNRUN. Standalone synthetic VM; no old test module or real authentication is imported.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { TextDecoder, TextEncoder } = require('node:util');
const PROFILE = process.env.OWNER_AUTH_REASON_PROFILE || 'current';
assert(['baseline', 'current'].includes(PROFILE));
const TRANSPORT = 'pages/creator-approved-readonly-transport.js';
const CATALOG = 'pages/creator-approved-reading-catalog.js';
const ENTRY = 'pages/creator-approved-reading-entry.js';
const HTML = 'creator-studio/approved-reading/index.html';
const PINS = {
  baseline: { [TRANSPORT]: 'd2e052cffc269e53549c81b9a50b0f5b34075bc93f0f6d70d005ee29d63afc33',
    [CATALOG]: '69e34934bb77cb38461944062c6732fcdbf8a5406a80f1b5b1e5885e9b704ad5',
    [ENTRY]: 'c0b4a61accec55e12375ce9c5cf76d90a6f7c7d459738079e4e837694690e144',
    [HTML]: 'da077207f5ebe1ffc2b857b1963a69f51ac658cd835fa688264b752a79c494a5' },
  current: { [TRANSPORT]: '7eb37bef05dbecb13bffee73191fcf407ef846b1ee35622c21080c9cacb30fda',
    [CATALOG]: '69da822d55237f040e9b324c6732d7a2e7038ea3dcc3dd45372bec398bd2fa9f',
    [ENTRY]: '6d7505c3818de9ee386cc02f2c25d1cf15977407b05132fd50c89eebb655d17d',
    [HTML]: 'cfe4f556526a3598ac62ce8c979eda7adf61e1f86c6b61e417a72b83b52652f6' },
};
const sourceRoot = path.resolve(process.env.OWNER_AUTH_REASON_SOURCE_ROOT || path.join(__dirname, '..'));
assert(!/(?:^|[\\/])story-completion-20261003(?:[\\/]|$)/i.test(sourceRoot), 'Shared CLEAN is not an admitted source');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const SOURCE = Object.fromEntries(Object.keys(PINS[PROFILE]).map(file => {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  assert(bytes.length > 0 && bytes.length <= 1024 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(Buffer.from(text).equals(bytes));
  if (file.endsWith('.js')) assert(!text.startsWith('\uFEFF'));
  const lf = text.replace(/\r\n/g, '\n'); assert(!lf.includes('\r'));
  if (text.includes('\r')) assert.equal(text, lf.replace(/\n/g, '\r\n'), 'Uniform checkout newline only');
  assert.equal(sha(Buffer.from(lf)), PINS[PROFILE][file], file);
  return [file, text];
}));
const OWNER = '00000000-0000-4000-8000-000000002901';
const OTHER = '00000000-0000-4000-8000-000000002902';
const WORK = '00000000-0000-4000-8000-000000002903';
const TOKEN = 'synthetic.reason-A', NEXT_TOKEN = 'synthetic.reason-B';
const PRIVATE = 'SYNTHETIC_ERROR_FIELD_NOT_FOR_CLIENT_STATE';
const TITLE = 'SYNTHETIC_APPROVED_RECORD_TITLE';
const STAMP = '2026-10-15T00:00:00.000Z';
const REASONS = ['AUTH_TOKEN_EXPIRED', 'AUTH_CONFIG_UNAVAILABLE', 'AUTH_LOOKUP_UNAVAILABLE'];
const RECEIPT_KEYS = ['authority', 'contract', 'nativeFetchInvoked', 'phase', 'responseStatus'];
const STATE_KEYS = ['authReason', 'items', 'nextCursor', 'phase', 'requestReceipt', 'selected'];
const DATA_KEYS = ['nativeFetchInvoked', 'receiptAuthority', 'requestPhase', 'requestReceiptContract', 'responseStatus'];
const COPY = { AUTH_TOKEN_EXPIRED: 'The sign-in sent for this read has expired',
  AUTH_CONFIG_UNAVAILABLE: 'Server authentication settings are unavailable',
  AUTH_LOOKUP_UNAVAILABLE: 'The server cannot check sign-in right now' };
const route = locale => '/api/v1/me/creator-studio/approved-reading-catalog?locale=' + locale + '&limit=12';
const encode = text => new TextEncoder().encode(text);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function drain() { for (let i = 0; i < 64; ++i) await Promise.resolve(); }
function packet() {
  return { contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only', readOnly: true,
    providerCalls: 0, operatingWrites: 0, items: [{ workId: WORK,
      title: { value: TITLE, locale: 'en', fallback: false, bounded: false }, defaultLocale: 'en',
      recordedState: { workStatus: 'draft', approval: 'not_checked' } }], nextCursor: null };
}
function envelope(status, code, locale = 'en', requestId = true) {
  const error = { code, message: code === REASONS[0] ? 'Invalid or expired access token' : 'Authentication temporarily unavailable',
    statusCode: status, path: route(locale) };
  if (requestId) error.requestId = PRIVATE;
  error.timestamp = STAMP;
  return { success: false, error };
}
function response(status = 200, options = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
    vary: 'Origin, Authorization, Accept-Encoding', ...options.headers };
  const chunks = options.chunks || [encode(options.text ?? JSON.stringify(options.value ?? packet()))];
  const stats = { reads: 0, acquires: 0, cancels: 0, releases: 0, unbounded: 0 };
  let index = 0;
  const value = { status, stats, headers: { get(key) {
    if (options.throwHeaders) throw new Error(PRIVATE);
    return headers[key.toLowerCase()] ?? null;
  } }, json() { stats.unbounded++; throw new Error('Unbounded JSON forbidden'); },
  text() { stats.unbounded++; throw new Error('Unbounded text forbidden'); },
  body: { cancel() { stats.cancels++; return Promise.resolve(); }, getReader() {
    stats.acquires++; if (options.throwAcquire) throw new Error(PRIVATE);
    return { read() {
      stats.reads++; const i = index++;
      if (options.read) return options.read(i);
      return Promise.resolve(i < chunks.length ? { done: false, value: chunks[i] } : { done: true });
    }, cancel() { stats.cancels++; return Promise.resolve(); }, releaseLock() { stats.releases++; } };
  } } };
  if (options.noReader) delete value.body.getReader;
  return value;
}
const rejected = (status, code, options = {}) => response(status, { value: envelope(status, code), ...options });
class Clock {
  constructor() { this.now = 0; this.serial = 0; this.tasks = new Map(); }
  set(fn, delay, interval = false) {
    assert.equal(typeof fn, 'function'); assert(Number.isInteger(delay) && delay >= 0 && delay <= 30000);
    const id = ++this.serial; this.tasks.set(id, { fn, at: this.now + delay, interval: interval ? delay : 0 }); return id;
  }
  clear(id) { this.tasks.delete(id); }
  async advance(ms) {
    const target = this.now + ms; let iterations = 0;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert(++iterations <= 128, 'Bounded timer progression');
      const [id, task] = next; this.now = task.at;
      if (task.interval) task.at += task.interval; else this.tasks.delete(id);
      task.fn(); await drain();
    }
    this.now = target; await drain();
  }
}
class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    const list = this.listeners.get(type) || []; list.push({ fn, once: !!options?.once }); this.listeners.set(type, list);
  }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row.fn !== fn)); }
  async fire(type, detail = {}) {
    const event = { type, ...detail };
    await Promise.all((this.listeners.get(type) || []).slice().map(row => {
      if (row.once) this.removeEventListener(type, row.fn); return row.fn(event);
    }));
  }
  dispatchEvent(event) { void this.fire(event.type, event); return true; }
}
class Element extends Hub {
  constructor(tag, document) {
    super(); Object.assign(this, { tagName: tag.toUpperCase(), document, dataset: {}, attrs: {}, children: [],
      value: '', textContent: '', hidden: false, disabled: false, isConnected: false });
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  connect(value) { this.isConnected = value; this.children.forEach(child => child.connect(value)); }
  appendChild(child) { child.parent = this; this.children.push(child); child.connect(this.isConnected); return child; }
  replaceChildren(...children) { this.children.forEach(child => child.connect(false)); this.children = []; children.forEach(child => this.appendChild(child)); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  focus() { this.document.activeElement = this; }
}
function documentFixture() {
  const document = new Hub(), nodes = new Map();
  document.readyState = 'complete'; document.documentElement = {}; document.activeElement = null;
  document.createElement = tag => new Element(tag, document); document.getElementById = id => nodes.get(id) || null;
  // Adapter for this admitted simple HTML only; it is not a DOMParser/layout or browser proof.
  for (const match of SOURCE[HTML].matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    assert(!nodes.has(match[3])); const element = document.createElement(match[1]);
    const attrs = match[2] + ' id="' + match[3] + '"' + match[4];
    for (const attr of attrs.matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) element.setAttribute(attr[1], attr[2]);
    element.hidden = /\bhidden(?:\s|$)/.test(attrs); element.disabled = /\bdisabled(?:\s|$)/.test(attrs);
    element.value = element.getAttribute('value') || ''; element.connect(true); nodes.set(match[3], element);
  }
  assert(nodes.has('readingCatalogLogin') && nodes.has('readingCatalogWorks') && nodes.has('writerApprovedSectionBytes'));
  document.getElementById('readingLocale').value = 'en'; document.nodes = nodes;
  const scripts = [...SOURCE[HTML].matchAll(/<script defer src="([^"?]+)\?[^"\s]+"><\/script>/g)].map(match => match[1]);
  assert.deepEqual(scripts, ['/pages/creator-approved-readonly-transport.js', '/pages/creator-approved-reading-handoff.js',
    '/pages/creator-approved-reading-catalog.js', ...(PROFILE === 'current' ? ['/pages/creator-approved-auth-connection.js'] : []), '/pages/creator-approved-reading-entry.js', '/pages/creator-approved-section-bytes.js',
    '/pages/creator-body-preview.js', '/pages/creator-approved-reading-body.js']);
  return document;
}
function fixture(t, { entry = true, deadlineMs = 30000, legacy = false, missingDataset = false, initialAuth = true } = {}) {
  const window = new Hub(), document = documentFixture(), clock = new Clock(), states = [], calls = [], controllers = [];
  let auth = { accessToken: TOKEN, user: { id: OWNER } }, raw = initialAuth ? JSON.stringify(auth) : null;
  let next = () => response(), storageWrites = 0, authCalls = 0, nativeCalls = 0, logs = 0, navigations = 0;
  class TrackedAbortController extends AbortController {
    constructor() {
      super(); const active = new Map(), signal = this.signal;
      const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
      signal.addEventListener = (type, fn, options) => {
        assert.equal(type, 'abort'); assert(!active.has(fn));
        const wrapper = event => { if (options?.once) active.delete(fn); fn.call(signal, event); };
        active.set(fn, wrapper); add(type, wrapper, options);
      };
      signal.removeEventListener = (type, fn) => { const wrapper = active.get(fn); active.delete(fn); remove(type, wrapper || fn); };
      this.active = active; controllers.push(this);
    }
  }
  window.localStorage = { getItem(key) { assert.equal(key, 'lumina_auth'); return raw; },
    setItem() { storageWrites++; throw new Error('No auth writes'); }, removeItem() { storageWrites++; throw new Error('No auth writes'); },
    clear() { storageWrites++; throw new Error('No auth writes'); } };
  window.sessionStorage = window.localStorage;
  const forbiddenAuth = () => { authCalls++; throw new Error('No auth mutation'); };
  for (const key of ['refreshAuthOnce', 'logout', 'setAuth', 'login', 'register']) window[key] = forbiddenAuth;
  window.opener = null; window.location = { origin: 'https://synthetic.invalid',
    reload() { navigations++; throw new Error('No navigation'); }, assign() { navigations++; throw new Error('No navigation'); } };
  window.open = () => { navigations++; throw new Error('No navigation'); };
  window.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000002904' };
  window.fetch = (url, options) => {
    const language = document.getElementById('readingLocale').value;
    // Count every attempted invocation before validation; swallowed fixture assertions cannot hide a send.
    calls.push({ method: options?.method ?? 'missing', language });
    assert.equal(url, 'https://api.lumina-stage.com' + route(language));
    assert(['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'].includes(language));
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Authorization', 'Cache-Control']);
    assert.equal(options.headers.Accept, 'application/json'); assert.equal(options.headers['Cache-Control'], 'no-store');
    assert(options.headers.Authorization === 'Bearer ' + auth.accessToken, 'Canonical synthetic token passthrough, values not printed');
    return next();
  };
  const context = vm.createContext({ window, document, location: window.location, Event, URL,
    AbortController: TrackedAbortController, TextDecoder, Uint8Array,
    setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: id => clock.clear(id),
    setInterval: (fn, ms) => clock.set(fn, ms, true), clearInterval: id => clock.clear(id),
    fetch() { nativeCalls++; throw new Error('Native network forbidden'); },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(key => [key, () => { logs++; throw new Error('Product logging forbidden'); }])) });
  vm.runInContext(SOURCE[TRANSPORT], context, { timeout: 1000, filename: TRANSPORT });
  vm.runInContext(SOURCE[CATALOG], context, { timeout: 1000, filename: CATALOG });
  const h = { window, document, clock, states, calls, context, entryMounted: false, state: () => states.at(-1),
    use(value) { next = typeof value === 'function' ? value : () => value; },
    setAuth(owner = OWNER, token = TOKEN) { auth = { accessToken: token, user: { id: owner } }; raw = JSON.stringify(auth); },
    missingAuth() { raw = null; }, async event(type, detail) { await window.fire(type, detail); await drain(); },
    async locale(value) { document.getElementById('readingLocale').value = value; await document.getElementById('readingLocale').fire('change'); await drain(); },
    async close() {
      if (entry) await window.fire('pagehide'); else { h.controller.dispose(); h.transport.dispose(); }
      await drain();
      assert.equal(clock.tasks.size, 0); assert(controllers.every(value => value.active.size === 0), 'Abort listeners released');
      assert.equal(storageWrites, 0); assert.equal(authCalls, 0); assert.equal(nativeCalls, 0); assert.equal(logs, 0); assert.equal(navigations, 0);
    } };
  t.after(() => h.close());
  if (missingDataset) delete document.getElementById('readingCatalogState').dataset;
  if (entry) {
    assert.equal(deadlineMs, 30000); assert.equal(legacy, false);
    const library = window.LuminaCreatorApprovedReadingCatalog;
    window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...library, create(options) {
      h.transport = options.transport;
      h.controller = library.create({ ...options, onChange(value) { states.push(value); options.onChange(value); } }); return h.controller;
    } });
    window.LuminaCreatorApprovedReadingHandoff = Object.freeze({ createReceiver() { throw new Error('Standalone cannot use a simulated receiver'); } });
    vm.runInContext(SOURCE[ENTRY], context, { timeout: 1000, filename: ENTRY });
    h.entryMounted = true;
    h.load = () => document.getElementById('readingCatalogLoad').fire('click');
    h.choose = () => document.getElementById('readingCatalogWorks').children[0].children[0].fire('click');
  } else {
    h.transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog();
    const exposed = legacy ? Object.freeze(Object.fromEntries(Object.entries(h.transport).filter(([key]) => key !== 'requestReceipt'))) : h.transport;
    h.controller = window.LuminaCreatorApprovedReadingCatalog.create({ transport: exposed, deadlineMs,
      locale: () => document.getElementById('readingLocale').value, onChange(value) { states.push(value); } });
    h.load = () => h.controller.load(); h.choose = () => h.controller.choose(WORK);
  }
  assert(h.controller && h.transport); assert.equal(calls.length, 0); return h;
}
function receipt(value, status, phase = 'response_status') {
  assert(value); assert(Object.isFrozen(value)); assert.deepEqual(Reflect.ownKeys(value).sort(), RECEIPT_KEYS);
  assert.deepEqual(plain(value), { contract: 'owner-readonly-request-receipt-v1', nativeFetchInvoked: true,
    responseStatus: status, phase, authority: 'client_observation_only' });
  for (const key of RECEIPT_KEYS) { const d = Object.getOwnPropertyDescriptor(value, key); assert(d.enumerable && 'value' in d); }
}
function failureState(h, status, reason = null) {
  assert.equal(h.state().phase, status === 401 ? 'auth_rejected' : 'unavailable');
  assert.equal(h.state().authReason, reason); assert.equal(h.state().items.length, 0); assert.equal(h.state().selected, null);
  assert.equal(h.state().nextCursor, null); assert(Object.isFrozen(h.state()));
}
function privacy(h) {
  const status = h.document.getElementById('readingCatalogState');
  const observed = JSON.stringify({ states: h.states, status: status.textContent, dataset: status.dataset });
  for (const secret of [PRIVATE, STAMP, TOKEN, NEXT_TOKEN, 'Invalid or expired access token',
    'Authentication temporarily unavailable', route('en'), 'https://api.lumina-stage.com']) assert(!observed.includes(secret), 'No raw error data retained');
  const diagnostics = JSON.stringify(h.states.map(value => ({ reason: value.authReason, receipt: value.requestReceipt })));
  for (const secret of [OWNER, OTHER, WORK, TITLE, PRIVATE, TOKEN, NEXT_TOKEN]) assert(!diagnostics.includes(secret));
  if (status.dataset) assert.deepEqual(Object.keys(status.dataset).sort(), h.entryMounted && h.state().requestReceipt ? DATA_KEYS : []);
}
function login(h, visible) {
  const link = h.document.getElementById('readingCatalogLogin');
  assert.equal(link.hidden, !visible); assert.equal(link.getAttribute('href'), '/#login');
  assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener noreferrer'); return link;
}
function settledStream(r, acquired = true) {
  assert.equal(r.stats.unbounded, 0); assert(r.stats.cancels >= 1);
  assert.equal(r.stats.acquires, acquired ? 1 : 0); assert.equal(r.stats.releases, acquired ? 1 : 0);
}

test('01 current filtered error pairs expose only bounded authReason through actual entry', { concurrency: false }, async t => {
  for (const [status, code] of [[401, REASONS[0]], [503, REASONS[1]], [503, REASONS[2]]]) {
    for (const requestId of [false, true]) {
      const h = fixture(t), r = rejected(status, code, { value: envelope(status, code, 'en', requestId) }); h.use(r);
      await h.load(); assert.equal(h.calls.length, 1); assert.equal(h.state().phase, status === 401 ? 'auth_rejected' : 'unavailable');
      assert.equal(h.state().authReason, code, 'AUTH_REASON_CONSUMER_EXACT_PAIR');
      failureState(h, status, code); assert.deepEqual(Reflect.ownKeys(h.state()).sort(), STATE_KEYS);
      receipt(h.state().requestReceipt, status === 401 ? '401' : '5xx');
      assert.equal(h.document.getElementById('readingCatalogState').textContent, COPY[code]);
      const link = login(h, status === 401); await link.fire('click');
      await h.event('focus'); await h.clock.advance(1000); assert.equal(h.calls.length, 1);
      assert.equal(h.states.length, 3, 'No chunk-level or auxiliary notifications'); settledStream(r); privacy(h);
      if (status === 401) {
        h.setAuth(requestId ? OWNER : OTHER, requestId ? NEXT_TOKEN : TOKEN);
        if (requestId) h.controller.sync(); else await h.event('lumina:authchange');
      } else if (code === REASONS[1]) {
        await h.locale('ja'); if (requestId) await h.locale('en');
      } else await h.event('pagehide');
      assert.equal(h.state().authReason, null); assert.equal(h.state().requestReceipt, null);
      assert.equal(h.state().selected, null); assert.equal(h.calls.length, 1); privacy(h);
    }
  }
});

test('02 bounded canonical decoding failure preserves known HTTP kind', { concurrency: false }, async t => {
  const good = envelope(401, REASONS[0]);
  const altered = change => { const value = plain(good); change(value); return JSON.stringify(value); };
  const invalid = [
    { headers: { 'cache-control': 'public, private, no-store' }, noRead: true },
    { headers: { 'cache-control': 'private' }, noRead: true }, { headers: { vary: 'Origin' }, noRead: true },
    { headers: { 'content-type': 'application/json; charset=iso-8859-1' }, noRead: true },
    { headers: { 'content-length': '1025' }, noRead: true }, { headers: { 'content-length': '-1' }, noRead: true },
    { throwHeaders: true, noRead: true }, { noReader: true, noRead: true },
    { text: altered(value => { value.error.code = REASONS[1]; }) },
    { text: altered(value => { value.error.code = 'UNAUTHORIZED'; }) },
    { text: altered(value => { value.error.statusCode = 503; }) },
    { text: altered(value => { value.error.path = '/not-the-request'; }) },
    { text: altered(value => { value.error.message = PRIVATE; }) },
    { text: altered(value => { value.error.requestId = 'x'.repeat(129); }) },
    { text: altered(value => { value.error.timestamp = 'invalid'; }) },
    { text: altered(value => { value.error.details = PRIVATE; }) },
    { text: altered(value => { value.error.messageKey = PRIVATE; }) },
    { text: altered(value => { value.success = true; }) }, { text: JSON.stringify({ code: REASONS[0] }) },
    { text: altered(value => { value.error = [value.error]; }) },
    { text: JSON.stringify(good).replace('"code":', '"code":"AUTH_TOKEN_EXPIRED","code":') },
    { text: ' ' + JSON.stringify(good) }, { text: JSON.stringify(good) + '{}' }, { text: '{bad-json' },
    { chunks: [] }, { read: () => Promise.resolve(null) },
    { read: () => Promise.resolve({ done: false, value: PRIVATE }) },
    { chunks: [new Uint8Array([0xc3, 0x28])] }, { chunks: [encode('\uFEFF' + JSON.stringify(good))] },
    { chunks: [new Uint8Array(1025)] },
    { read: () => Promise.reject(new Error(PRIVATE)) },
  ];
  for (const options of invalid) {
    const h = fixture(t), r = rejected(401, REASONS[0], options); h.use(r); await h.load();
    failureState(h, 401); receipt(h.state().requestReceipt, '401'); assert.equal(h.calls.length, 1);
    assert.equal(h.document.getElementById('readingCatalogState').textContent, 'Check sign-in for this read');
    if (options.noRead) assert.equal(r.stats.reads, 0);
    settledStream(r, !options.noRead); privacy(h);
  }
  for (const [status, code] of [[503, REASONS[0]], [503, 'SERVICE_UNAVAILABLE'], [403, REASONS[0]], [502, REASONS[2]]]) {
    const h = fixture(t), r = rejected(status, code); h.use(r); await h.load();
    failureState(h, status); login(h, false); assert.equal(h.calls.length, 1);
    settledStream(r, status === 503); if (status !== 503) assert.equal(r.stats.reads, 0); privacy(h);
  }
  // Synthetic serializer boundary: escaped data fills the byte cap without extending the closed shape.
  const padded = envelope(503, REASONS[1]); padded.error.requestId = '';
  const space = 1024 - encode(JSON.stringify(padded)).length;
  padded.error.requestId = '\u0001'.repeat(Math.floor(space / 6)) + 'x'.repeat(space % 6);
  assert(padded.error.requestId.length <= 128);
  const limitText = JSON.stringify(padded);
  assert.equal(encode(limitText).length, 1024);
  for (const excess of [false, true]) {
    const h = fixture(t), r = rejected(503, REASONS[1], { text: limitText + (excess ? ' ' : ''),
      headers: { 'content-length': '1024' } }); h.use(r); await h.load();
    failureState(h, 503, excess ? null : REASONS[1]); assert.equal(h.calls.length, 1); settledStream(r); privacy(h);
  }
  const utf8 = envelope(401, REASONS[0]); utf8.error.requestId = '\u4e2d';
  const utf8Bytes = encode(JSON.stringify(utf8)), split = utf8Bytes.indexOf(0xe4) + 1;
  assert(split > 0);
  const multi = fixture(t), multiResponse = rejected(401, REASONS[0], { chunks: [utf8Bytes.slice(0, split), utf8Bytes.slice(split)] });
  multi.use(multiResponse); await multi.load(); failureState(multi, 401, REASONS[0]); settledStream(multiResponse); privacy(multi);
  for (const count of [16, 17]) {
    const h = fixture(t), bytes = encode(JSON.stringify(good));
    const chunks = Array.from({ length: count - 1 }, () => new Uint8Array(0)); chunks.push(bytes);
    const r = rejected(401, REASONS[0], { chunks }); h.use(r); await h.load();
    failureState(h, 401, count === 16 ? REASONS[0] : null); assert.equal(h.calls.length, 1);
    assert.equal(r.stats.reads, 17); settledStream(r); privacy(h);
  }
  for (const [status, deadlineMs] of [[401, 30000], [503, 30000], [401, 100], [503, 100]]) {
    const h = fixture(t, { entry: false, deadlineMs }), hold = deferred();
    const r = rejected(status, status === 401 ? REASONS[0] : REASONS[2], { read: () => hold.promise });
    h.use(r); const loading = h.load(); await drain(); assert.equal(r.stats.reads, 1);
    const end = Math.min(250, deadlineMs); await h.clock.advance(end - 1);
    assert.equal(h.state().phase, 'loading'); await h.clock.advance(1); await loading;
    failureState(h, status); receipt(h.state().requestReceipt, status === 401 ? '401' : '5xx');
    settledStream(r); assert.equal(h.clock.tasks.size, 0); const before = h.states.length;
    hold.resolve({ done: true }); await drain(); assert.equal(h.states.length, before); assert.equal(h.calls.length, 1); privacy(h);
  }
});

test('03 owner token locale epoch and disposal retire every late diagnostic', { concurrency: false }, async t => {
  const changes = ['owner', 'token', 'ownerABA', 'tokenABA', 'locale', 'localeABA', 'missedToken', 'dispose'];
  for (const [index, change] of changes.entries()) for (const lateFails of [false, true]) {
    const h = fixture(t), a = deferred(), stage = index % 3, oldBytes = encode(JSON.stringify(envelope(401, REASONS[0])));
    let old;
    if (stage === 0) h.use(() => a.promise);
    else {
      old = rejected(401, REASONS[0], { read(i) {
        if (stage === 2 && i === 0) return Promise.resolve({ done: false, value: oldBytes });
        return a.promise;
      } }); h.use(old);
    }
    const loadingA = h.load(); await drain(); assert.equal(h.calls.length, 1);
    if (old) assert.equal(old.stats.reads, stage === 2 ? 2 : 1);
    if (change === 'owner' || change === 'ownerABA') {
      h.setAuth(OTHER); await h.event('lumina:authchange');
      if (change === 'ownerABA') { h.setAuth(); await h.event('lumina:authchange'); }
    } else if (change === 'token' || change === 'tokenABA' || change === 'missedToken') {
      h.setAuth(OWNER, NEXT_TOKEN);
      if (change === 'missedToken') h.controller.sync(); else await h.event('lumina:authchange');
      if (change === 'tokenABA') { h.setAuth(); await h.event('lumina:authchange'); }
    } else if (change === 'locale' || change === 'localeABA') {
      await h.locale('ja'); if (change === 'localeABA') await h.locale('en');
    } else await h.event('pagehide');
    await drain(); assert.equal(h.state().authReason, null); assert.equal(h.state().selected, null);
    assert.equal(h.state().items.length, 0); assert.equal(h.state().requestReceipt, null);
    if (change === 'dispose') {
      if (lateFails) a.reject(new Error(PRIVATE)); else if (stage === 0) { old = rejected(401, REASONS[0]); a.resolve(old); }
      else a.resolve({ done: true });
      await loadingA; await drain(); await h.load();
      await h.event('creator:approved-section-auth-state'); login(h, false);
      assert.equal(h.calls.length, 1); assert.equal(h.state().authReason, null); privacy(h); continue;
    }
    const b = deferred(); h.use(() => b.promise); const loadingB = h.load(); await drain();
    assert.equal(h.calls.length, 2); assert.equal(h.state().phase, 'loading'); const notifications = h.states.length;
    if (lateFails) a.reject(new Error(PRIVATE));
    else if (stage === 0) { old = rejected(401, REASONS[0]); a.resolve(old); }
    else a.resolve({ done: true });
    await loadingA; await drain(); assert.equal(h.states.length, notifications); assert.equal(h.state().phase, 'loading');
    await h.load(); assert.equal(h.calls.length, 2, 'Old finally must not unlock newer pending request');
    b.resolve(response()); await loadingB; assert.equal(h.state().phase, 'ready'); assert.equal(h.state().authReason, null);
    assert.equal(h.state().items.length, 1); assert.equal(h.calls.length, 2); login(h, false);
    await h.choose(); assert.equal(h.window.LuminaCreatorApprovedReadingScope.isCurrent(h.window.LuminaCreatorApprovedReadingScope.snapshot()), true);
    assert.equal(h.calls.length, 2); privacy(h);
    if (old) assert(old.stats.cancels >= 1);
  }
});

test('04 successful200 and legacy generic paths retain original read authority', { concurrency: false }, async t => {
  const h = fixture(t); h.use(response()); await h.load(); assert.equal(h.state().phase, 'ready');
  assert.equal(h.state().authReason, null); receipt(h.state().requestReceipt, '200', 'complete');
  await h.choose(); assert.equal(h.calls.length, 1);
  const selected = h.window.LuminaCreatorApprovedReadingScope.snapshot();
  assert.equal(h.window.LuminaCreatorApprovedReadingScope.isCurrent(selected), true); login(h, false);
  // The actual entry bridge rejects a different synthetic work before transport dispatch.
  await assert.rejects(h.window.LuminaCreatorStudioApi.fetch('/api/v1/me/creator-studio/stories/' + OTHER +
    '/generation-profile/approved-section-bytes?measurement=json-utf8-v1', { identity: h.transport.identity() }));
  assert.equal(h.calls.length, 1); privacy(h);
  for (const options of [{ headers: { 'cache-control': 'public, max-age=60' } }, { value: envelope(401, REASONS[0]) }]) {
    const f = fixture(t), r = response(200, options); f.use(r); await f.load();
    failureState(f, 200); assert.equal(f.calls.length, 1); assert.equal(f.state().authReason, null);
    if (options.headers) assert.equal(r.stats.reads, 0); login(f, false); privacy(f);
  }
  const noAuth = fixture(t, { initialAuth: false }); await noAuth.load();
  assert.equal(noAuth.calls.length, 0); assert.equal(noAuth.state().phase, 'unauthenticated');
  assert.equal(noAuth.state().authReason, null); assert.equal(noAuth.state().requestReceipt, null);
  const legacy = fixture(t, { entry: false, legacy: true }); legacy.use(rejected(503, REASONS[2])); await legacy.load();
  failureState(legacy, 503, REASONS[2]); assert.equal(legacy.state().requestReceipt, null); assert.equal(legacy.calls.length, 1); privacy(legacy);
  const optional = fixture(t, { missingDataset: true }); optional.use(rejected(401, REASONS[0])); await optional.load();
  failureState(optional, 401, REASONS[0]); assert.equal(optional.document.getElementById('readingCatalogState').dataset, undefined);
  assert.equal(optional.document.getElementById('readingCatalogState').textContent, COPY[REASONS[0]]); login(optional, true);
  assert.equal(optional.calls.length, 1); await optional.event('pagehide'); login(optional, false);
  assert.equal(optional.state().authReason, null); assert.equal(optional.state().requestReceipt, null); privacy(optional);
  const timeout = fixture(t, { entry: false, deadlineMs: 100 }), never = deferred(); timeout.use(() => never.promise);
  const loading = timeout.load(); await drain(); await timeout.clock.advance(100); await loading;
  assert.equal(timeout.state().phase, 'timeout'); assert.equal(timeout.state().authReason, null); assert.equal(timeout.calls.length, 1);
  never.resolve(response()); await drain(); assert.equal(timeout.state().phase, 'timeout'); privacy(timeout);
});

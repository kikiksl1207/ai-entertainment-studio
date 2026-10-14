'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { TextDecoder, TextEncoder } = require('node:util');
const PINS = Object.freeze({
  'pages/creator-approved-readonly-transport.js': 'd2e052cffc269e53549c81b9a50b0f5b34075bc93f0f6d70d005ee29d63afc33',
  'pages/creator-approved-reading-catalog.js': '69e34934bb77cb38461944062c6732fcdbf8a5406a80f1b5b1e5885e9b704ad5',
  'pages/creator-approved-reading-entry.js': 'f6f97265c7aa22b8939b3bf8236067623e2d60a81dadf4473cfefa546de29e52',
  'creator-studio/approved-reading/index.html': 'da077207f5ebe1ffc2b857b1963a69f51ac658cd835fa688264b752a79c494a5',
});
const sourceRoot = path.resolve(process.env.CATALOG_RECEIPT_SOURCE_ROOT || path.join(__dirname, '..'));
assert(!/(?:^|[\\/])story-completion-20261003(?:[\\/]|$)/i.test(sourceRoot), 'Shared CLEAN cannot be the product source');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function source(file) {
  const bytes = fs.readFileSync(path.join(sourceRoot, file));
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(Buffer.from(text).equals(bytes));
  if (file.endsWith('.js')) assert(!text.startsWith('\uFEFF'), 'JS BOM is not admitted');
  const lf = text.replace(/\r\n/g, '\n'); assert(!lf.includes('\r'));
  if (text.includes('\r')) assert.equal(text, lf.replace(/\n/g, '\r\n'));
  assert.equal(sha(Buffer.from(lf)), PINS[file], file); return text;
}
const SOURCE = Object.fromEntries(Object.keys(PINS).map(file => [file, source(file)]));
const OWNER = '00000000-0000-4000-8000-000000001201';
const OTHER = '00000000-0000-4000-8000-000000001202';
const WORK = '00000000-0000-4000-8000-000000001203';
const TOKEN = 'synthetic.stage-A', NEXT_TOKEN = 'synthetic.stage-B';
const TITLE = 'SYNTHETIC_PRIVATE_WORK_TITLE', SECRET = 'SYNTHETIC_BODY_ERROR_HEADER_NOT_RECEIPT';
const CATALOG = '/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12';
const KEYS = ['authority', 'contract', 'nativeFetchInvoked', 'phase', 'responseStatus'];
const DATA_KEYS = ['nativeFetchInvoked', 'receiptAuthority', 'requestPhase', 'requestReceiptContract', 'responseStatus'];
const CONTRACT = 'owner-readonly-request-receipt-v1';
const plain = value => JSON.parse(JSON.stringify(value));
const expected = (bit, status, phase) => ({ contract: CONTRACT, nativeFetchInvoked: bit,
  responseStatus: status, phase, authority: 'client_observation_only' });
function checkReceipt(value, bit, status, phase) {
  assert(value); assert.deepEqual(Reflect.ownKeys(value).sort(), KEYS); assert(Object.isFrozen(value));
  for (const key of KEYS) {
    const d = Object.getOwnPropertyDescriptor(value, key); assert(d.enumerable && 'value' in d);
  }
  assert.deepEqual(plain(value), expected(bit, status, phase));
  const json = JSON.stringify(value);
  for (const secret of [OWNER, OTHER, WORK, TOKEN, NEXT_TOKEN, TITLE, SECRET, 'Authorization', CATALOG,
    'https://api.lumina-stage.com', '2026-10-15T00:00:00.000Z']) assert(!json.includes(secret), 'Receipt must not contain private/request data');
}
function packet() {
  return { contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only',
    readOnly: true, providerCalls: 0, operatingWrites: 0, items: [{ workId: WORK,
      title: { value: TITLE, locale: 'ko', fallback: false, bounded: false }, defaultLocale: 'ko',
      recordedState: { workStatus: 'draft', approval: 'not_checked' } }], nextCursor: null };
}
function response(status = 200, options = {}) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store',
    vary: 'Authorization', 'x-synthetic-private': SECRET, ...options.headers };
  const chunks = options.chunks || [new TextEncoder().encode(options.text ?? JSON.stringify(options.packet ?? packet()))];
  const stats = { reads: 0, cancels: 0, releases: 0 };
  let index = 0;
  const value = { status, headers: { get: key => headers[key.toLowerCase()] ?? null }, stats,
    body: { cancel() { stats.cancels++; return Promise.resolve(); }, getReader() { return {
      async read() { stats.reads++; return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
      cancel() { stats.cancels++; return Promise.resolve(); }, releaseLock() { stats.releases++; },
    }; } } };
  if (options.noReader) delete value.body.getReader;
  return value;
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function drain() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn, options) {
    const list = this.listeners.get(type) || []; list.push({ fn, once: !!options?.once }); this.listeners.set(type, list);
  }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter(row => row.fn !== fn)); }
  fire(type, detail = {}) {
    const event = { type, ...detail };
    return Promise.all((this.listeners.get(type) || []).slice().map(row => {
      if (row.once) this.removeEventListener(type, row.fn); return row.fn(event);
    }));
  }
  dispatchEvent(event) { void this.fire(event.type, event); return true; }
}
class Element extends Hub {
  constructor(tag, document) {
    super(); this.tagName = tag.toUpperCase(); this.document = document; this.dataset = {}; this.attrs = {};
    this.children = []; this.isConnected = false; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = '';
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  connect(value) { this.isConnected = value; this.children.forEach(child => child.connect(value)); }
  appendChild(child) { child.parent = this; this.children.push(child); child.connect(this.isConnected); return child; }
  replaceChildren(...children) { this.children.forEach(child => child.connect(false)); this.children = []; children.forEach(child => this.appendChild(child)); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.document.activeElement = this; }
}
function documentFixture() {
  const doc = new Hub(); doc.readyState = 'complete'; doc.documentElement = {}; doc.activeElement = null;
  const nodes = new Map();
  doc.createElement = tag => new Element(tag, doc); doc.getElementById = id => nodes.get(id) || null;
  // A deliberately small opening-tag adapter for the pinned, simple public HTML; not a layout engine.
  for (const match of SOURCE['creator-studio/approved-reading/index.html'].matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)\bid="([^"]+)"([^>]*)>/gi)) {
    const element = new Element(match[1], doc), attrs = match[2] + ' id="' + match[3] + '"' + match[4];
    for (const attr of attrs.matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) element.setAttribute(attr[1], attr[2]);
    element.hidden = /\bhidden(?:\s|$)/.test(attrs); element.disabled = /\bdisabled(?:\s|$)/.test(attrs);
    element.value = element.getAttribute('value') || ''; element.connect(true); nodes.set(match[3], element);
  }
  nodes.get('readingLocale').value = 'ko'; return doc;
}
function fixture({ entry = false, noNative = false, metadata } = {}) {
  const window = new Hub(), document = documentFixture(), states = [], calls = [];
  let auth = { accessToken: TOKEN, user: { id: OWNER } }, raw = JSON.stringify(auth), next = () => response();
  let writes = 0, directAuth = 0, timer = 0;
  const timeouts = new Map(), intervals = new Map();
  window.localStorage = { getItem(key) { assert.equal(key, 'lumina_auth'); return raw; },
    setItem() { writes++; throw new Error('Storage writes forbidden'); }, removeItem() { writes++; throw new Error('Storage writes forbidden'); },
    clear() { writes++; throw new Error('Storage writes forbidden'); } };
  const forbiddenAuth = () => { directAuth++; throw new Error('Direct auth calls forbidden'); };
  window.refreshAuthOnce = forbiddenAuth; window.logout = forbiddenAuth;
  window.opener = null; window.location = { origin: 'https://synthetic.invalid', reload() { throw new Error('No navigation'); } };
  window.crypto = { randomUUID: () => '00000000-0000-4000-8000-000000001204' };
  window.fetch = noNative ? null : (url, options) => {
    assert.equal(url, 'https://api.lumina-stage.com' + CATALOG);
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert(options.headers.Authorization === 'Bearer ' + auth.accessToken, 'Canonical synthetic token passed internally');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'Authorization', 'Cache-Control']);
    calls.push({ method: 'GET' }); return next();
  };
  const context = vm.createContext({ window, document, location: window.location, AbortController, TextDecoder, Uint8Array,
    Event, URL, setTimeout(fn) { const id = ++timer; timeouts.set(id, fn); return id; }, clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn) { const id = ++timer; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    fetch() { throw new Error('Host/native network forbidden'); },
    console: { log() { throw new Error('No product logging'); }, warn() { throw new Error('No product logging'); }, error() { throw new Error('No product logging'); } } });
  vm.runInContext(SOURCE['pages/creator-approved-readonly-transport.js'], context, { timeout: 1000 });
  vm.runInContext(SOURCE['pages/creator-approved-reading-catalog.js'], context, { timeout: 1000 });
  const h = { window, document, states, calls, use(value) { next = typeof value === 'function' ? value : () => value; },
    setAuth(owner = OWNER, token = TOKEN) { auth = { accessToken: token, user: { id: owner } }; raw = JSON.stringify(auth); },
    missingAuth() { raw = null; }, state: () => states.at(-1),
    async tick() { for (const fn of intervals.values()) fn(); await drain(); },
    finish() { assert.equal(writes, 0); assert.equal(directAuth, 0); assert.equal(timeouts.size, 0); } };
  if (entry) {
    const library = window.LuminaCreatorApprovedReadingCatalog;
    window.LuminaCreatorApprovedReadingCatalog = Object.freeze({ ...library, create(options) {
      h.transport = options.transport;
      const controller = library.create({ ...options, onChange(value) { states.push(value); options.onChange(value); } });
      h.controller = controller; return controller;
    } });
    // Standalone uses no receiver. Only the unused compatibility-presence guard is supplied.
    window.LuminaCreatorApprovedReadingHandoff = Object.freeze({ createReceiver() { throw new Error('No handoff simulation'); } });
    vm.runInContext(SOURCE['pages/creator-approved-reading-entry.js'], context, { timeout: 1000 });
    h.load = () => document.getElementById('readingCatalogLoad').fire('click');
    h.choose = () => document.getElementById('readingCatalogWorks').children[0].children[0].fire('click');
  } else {
    h.transport = window.LuminaCreatorApprovedReadonlyTransport.createCatalog();
    let exposed = h.transport;
    if (metadata === 'legacy') exposed = Object.freeze(Object.fromEntries(Object.entries(exposed).filter(([key]) => key !== 'requestReceipt')));
    else if (typeof metadata === 'function') exposed = Object.freeze({ ...exposed, requestReceipt: metadata });
    h.controller = window.LuminaCreatorApprovedReadingCatalog.create({ transport: exposed,
      locale: () => document.getElementById('readingLocale').value, onChange(value) { states.push(value); } });
    h.load = () => h.controller.load(); h.choose = () => h.controller.choose(WORK);
  }
  h.options = () => ({ method: 'GET', identity: h.transport.identity(), token: h.transport.getAuth()?.accessToken,
    _retried: true, cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-store' }, signal: new AbortController().signal });
  return h;
}
function dataset(h, receipt = null) {
  const value = h.document.getElementById('readingCatalogState').dataset;
  assert.deepEqual(Object.keys(value).sort(), receipt ? DATA_KEYS : []);
  if (receipt) assert.deepEqual(value, { requestPhase: receipt.phase, responseStatus: receipt.responseStatus,
    nativeFetchInvoked: String(receipt.nativeFetchInvoked), requestReceiptContract: CONTRACT, receiptAuthority: 'client_observation_only' });
}
function empty(h) { assert.equal(h.state().requestReceipt, null); assert.equal(h.state().selected, null); assert.equal(h.state().items.length, 0); }

test('01 actual transport admission records pre-fetch false/none with zero synthetic sends', { concurrency: false }, async () => {
  for (const variant of ['route', 'method', 'headers', 'cache', 'missing_auth', 'missing_native']) {
    const h = fixture({ noNative: variant === 'missing_native' }), options = h.options();
    let route = CATALOG;
    if (variant === 'route') route = '/api/v1/auth/refresh';
    if (variant === 'method') options.method = 'POST';
    if (variant === 'headers') options.headers.Authorization = SECRET;
    if (variant === 'cache') options.cache = 'force-cache';
    if (variant === 'missing_auth') h.missingAuth();
    let error; try { await h.transport.fetch(route, options); } catch (value) { error = value; }
    assert(error); assert.equal(h.calls.length, 0);
    checkReceipt(h.transport.requestReceipt(error), false, 'none', 'pre_fetch');
    h.finish();
  }
});

test('02 actual entry/catalog synthetic401 exposes only inert five-field diagnostics and manual sign-in', { concurrency: false }, async () => {
  const h = fixture({ entry: true }); h.use(response(401)); assert.equal(h.calls.length, 0); dataset(h);
  await h.load(); assert.equal(h.calls.length, 1); assert.equal(h.state().phase, 'auth_rejected');
  checkReceipt(h.state().requestReceipt, true, '401', 'response_status'); dataset(h, expected(true, '401', 'response_status'));
  const login = h.document.getElementById('readingCatalogLogin');
  assert.equal(login.hidden, false); assert.equal(login.getAttribute('href'), '/#login');
  assert.equal(login.getAttribute('target'), '_blank'); assert.equal(login.getAttribute('rel'), 'noopener noreferrer');
  await login.fire('click'); await h.tick(); assert.equal(h.calls.length, 1);
  assert.equal(h.state().selected, null); assert.equal(h.state().items.length, 0);
  assert.deepEqual(h.states.map(value => value.phase), ['idle', 'loading', 'auth_rejected']); h.finish();
});

test('03 403/5xx/other HTTP and rejected native function are unavailable without retry or auth-expiry claims', { concurrency: false }, async () => {
  for (const [status, bucket] of [[403, '403'], [503, '5xx'], [502, '5xx'], [404, 'other']]) {
    const h = fixture(); h.use(response(status)); await h.load(); assert.equal(h.calls.length, 1);
    assert.equal(h.state().phase, 'unavailable'); checkReceipt(h.state().requestReceipt, true, bucket, 'response_status'); h.finish();
  }
  for (const sync of [true, false]) {
    const h = fixture(); h.use(() => { if (sync) throw new Error(SECRET); return Promise.reject(new Error(SECRET)); });
    await h.load(); assert.equal(h.calls.length, 1); assert.equal(h.state().phase, 'unavailable');
    checkReceipt(h.state().requestReceipt, true, 'none', 'native_fetch'); h.finish();
  }
});

test('04 HTTP200 bad cache/media/size/reader admission retains cache stage, never auth_rejected or body reads', { concurrency: false }, async () => {
  for (const options of [{ headers: { 'cache-control': 'public, no-store' } }, { headers: { vary: 'Accept' } },
    { headers: { 'content-type': 'text/plain' } }, { headers: { 'content-length': '8193' } }, { noReader: true }]) {
    const h = fixture(), r = response(200, options); h.use(r); await h.load();
    assert.equal(h.calls.length, 1); assert.equal(h.state().phase, 'unavailable'); assert.equal(r.stats.reads, 0);
    checkReceipt(h.state().requestReceipt, true, '200', 'cache_validation');
    assert.deepEqual(h.states.map(value => value.phase), ['idle', 'loading', 'unavailable']); h.finish();
  }
});

test('05 bounded bytes/UTF8/JSON and exact catalog payload failures distinguish body from catalog validation', { concurrency: false }, async () => {
  for (const [options, phase] of [[{ chunks: [new Uint8Array(8193)] }, 'body_validation'],
    [{ chunks: [new Uint8Array([0xc3, 0x28])] }, 'body_validation'], [{ text: '{not-json' }, 'body_validation'],
    [{ packet: { ...packet(), raw: SECRET } }, 'catalog_validation']]) {
    const h = fixture(); h.use(response(200, options)); await h.load();
    assert.equal(h.calls.length, 1); assert.equal(h.state().phase, 'unavailable');
    checkReceipt(h.state().requestReceipt, true, '200', phase);
    assert.equal(h.state().items.length, 0); assert.equal(h.state().selected, null);
    assert.deepEqual(h.states.map(value => value.phase), ['idle', 'loading', 'unavailable']); h.finish();
  }
});

test('06 complete actual entry selection stays current and does not fetch again or turn receipt into authority', { concurrency: false }, async () => {
  const h = fixture({ entry: true }); await h.load(); assert.equal(h.state().phase, 'ready');
  checkReceipt(h.state().requestReceipt, true, '200', 'complete'); dataset(h, expected(true, '200', 'complete'));
  await h.choose(); assert.equal(h.calls.length, 1); assert.equal(h.state().selected.workId, WORK);
  const selected = h.window.LuminaCreatorApprovedReadingScope.snapshot();
  assert.equal(h.window.LuminaCreatorApprovedReadingScope.isCurrent(selected), true);
  assert.equal(h.document.getElementById('readingCatalogLogin').hidden, true);
  await h.tick(); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.states.map(value => value.phase), ['idle', 'loading', 'ready', 'ready']); h.finish();
});

test('07 owner/token/locale/dispose clear old state and late401 cannot restore receipt or cause another send', { concurrency: false }, async () => {
  for (const change of ['owner', 'token', 'locale', 'dispose']) {
    const h = fixture({ entry: true }), first = response(); h.use(first); await h.load(); await h.choose();
    const pending = deferred(); h.use(() => pending.promise); const loading = h.load();
    assert.equal(h.calls.length, 2); empty(h); dataset(h);
    if (change === 'owner' || change === 'token') {
      h.setAuth(change === 'owner' ? OTHER : OWNER, change === 'token' ? NEXT_TOKEN : TOKEN);
      await h.window.fire('lumina:authchange');
    } else if (change === 'locale') {
      h.document.getElementById('readingLocale').value = 'en'; await h.document.getElementById('readingLocale').fire('change');
    } else await h.window.fire('pagehide');
    await loading; const late = response(401); pending.resolve(late); await drain();
    empty(h); dataset(h); assert.equal(h.calls.length, 2); assert(late.stats.cancels > 0);
    assert.equal(h.document.getElementById('readingCatalogLogin').hidden, true);
    if (change !== 'locale') assert.equal(h.transport.requestReceipt(first), null);
    assert.equal(h.transport.requestReceipt(late), null); h.finish();
  }
  // Prefetch error receipts are observations of that old request, not a new owner's diagnostic.
  for (const change of ['owner', 'token']) {
    const h = fixture(); let oldError;
    try { await h.transport.fetch('/not-an-approved-read', h.options()); } catch (error) { oldError = error; }
    checkReceipt(h.transport.requestReceipt(oldError), false, 'none', 'pre_fetch');
    h.setAuth(change === 'owner' ? OTHER : OWNER, change === 'token' ? NEXT_TOKEN : TOKEN);
    // Deliberately no storage/auth event: the getter must sample and notice the epoch change itself.
    assert.equal(h.transport.requestReceipt(oldError), null, 'Old-owner/token prefetch receipt must be unavailable');
    assert.equal(h.calls.length, 0); h.finish();
  }
});

test('08 legacy/invalid receipt stays null and own-descriptor snapshots never invoke accessor or Proxy gets', { concurrency: false }, async () => {
  let getterReads = 0;
  const getter = { ...expected(true, '200', 'response_status') };
  Object.defineProperty(getter, 'phase', { enumerable: true, get() { getterReads++; return SECRET; } });
  for (const metadata of ['legacy', () => ({ ...expected(true, '200', 'response_status'), token: SECRET }),
    () => getter, () => ({ ...expected(true, '200', 'response_status'), nativeFetchInvoked: new Boolean(true) }),
    () => ({ ...expected(true, '200', 'response_status'), responseStatus: 200 }),
    () => ({ ...expected(true, '200', 'response_status'), authority: 'server_authorized' })]) {
    const h = fixture({ metadata }); await h.load(); assert.equal(h.calls.length, 1);
    assert.equal(h.state().phase, 'ready'); assert.equal(h.state().requestReceipt, null);
    assert.equal(h.state().selected, null); assert.equal(h.state().items.length, 1); h.finish();
  }
  assert.equal(getterReads, 0);
  let proxyGets = 0;
  const proxy = new Proxy(expected(true, '200', 'response_status'), {
    get() { proxyGets++; throw new Error(SECRET); },
  });
  const h = fixture({ metadata: () => proxy }); await h.load();
  assert.equal(h.calls.length, 1); assert.equal(h.state().phase, 'ready');
  checkReceipt(h.state().requestReceipt, true, '200', 'complete');
  assert.equal(proxyGets, 0); h.finish();
});

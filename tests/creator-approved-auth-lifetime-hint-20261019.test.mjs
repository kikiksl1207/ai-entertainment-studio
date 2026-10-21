import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createContext, Script } from 'node:vm';
import { TextDecoder } from 'node:util';

const ASSETS = ['creator-approved-readonly-transport.js', 'creator-approved-reading-catalog.js',
  'creator-approved-reading-entry.js'];
const HTML_SCRIPTS = [ASSETS[0], 'creator-approved-reading-handoff.js', ASSETS[1], 'creator-approved-auth-connection.js', ASSETS[2],
  'creator-approved-section-bytes.js', 'creator-body-preview.js', 'creator-approved-reading-body.js'];
const NS = 'LuminaCreatorApprovedUnverifiedAuthLifetime';
const TIME_NS = 'LuminaCreatorApprovedUnverifiedAuthTime';
const ATTR = 'data-unverified-auth-lifetime';
const TIME_ATTR = 'data-unverified-auth-time';
const ENUM = ['unknown', 'nonpositive', 'under-minute', 'minute-or-longer'];
const METHODS = ['getAuth', 'identity', 'isCurrent', 'fetch', 'requestReceipt', 'dispose'];
const FACTORIES = ['create', 'createCatalog', 'createBody'];
const RECEIPT_KEYS = ['contract', 'nativeFetchInvoked', 'responseStatus', 'phase', 'authority'];
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = 1700000000000;
const sources = new Map();
let htmlIds;
const options = { concurrency: false, timeout: 20000 };
const check = (condition, label) => assert.equal(Boolean(condition), true, label);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const encoded = bytes => Buffer.from(bytes).toString('base64url');
const tokenText = text => 'e30.' + encoded(Buffer.from(text, 'utf8')) + '.c2ln';
const token = claims => tokenText(JSON.stringify(claims));
const auth = (accessToken, id = OWNER) => ({ user: { id }, accessToken });
const rawAuth = (accessToken, id) => JSON.stringify(auth(accessToken, id));
const fail = () => { throw new Error('SYNTHETIC_FIXTURE_FAULT'); };
const decodeSource = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);

before(() => {
  // Reads/compilation fail the independent hook; no catch can turn absent sources into a pass.
  const html = decodeSource(readFileSync(new URL('../creator-studio/approved-reading/index.html', import.meta.url)));
  const tags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const rows = tags.map(match => {
    const src = match[1].match(/\bsrc="([^"]+)"/);
    check(src !== null && /\bdefer\b/.test(match[1]) && !/\basync\b/.test(match[1]) &&
      match[2].trim() === '', 'HTML_LOCAL_DEFERRED_SCRIPTS');
    const route = src[1].match(/^\/pages\/([a-z0-9-]+\.js)\?v=([A-Za-z0-9._-]+)$/);
    check(route !== null, 'HTML_ROOT_RELATIVE_SCRIPT');
    return { name: route[1], version: route[2] };
  });
  check(same(rows.map(row => row.name), HTML_SCRIPTS) && new Set(rows.map(row => row.name)).size === 8,
    'HTML_GENUINE_SCRIPT_ORDER');
  check(rows[0].version === '20261020-explicit-v1' && rows[4].version === '20261022-idle-status-v1', 'HTML_TRANSPORT_ENTRY_VERSION_PAIR');
  htmlIds = [...html.matchAll(/\bid="([A-Za-z][A-Za-z0-9_-]*)"/g)].map(match => match[1]);
  check(new Set(htmlIds).size === htmlIds.length, 'HTML_UNIQUE_FIXTURE_IDS');
  for (const name of ASSETS) {
    sources.set(name, new Script(decodeSource(readFileSync(new URL('../pages/' + name, import.meta.url))),
      { filename: 'pages/' + name }));
  }
});

function world(raw = rawAuth(token({ iat: NOW / 1000, exp: NOW / 1000 + 30 })), setup = () => {}) {
  const counts = { reads: 0, writes: 0, fetch: 0, interval: 0, timeout: 0, clock: 0,
    receiver: true, key: true, listenerAdds: 0 };
  const control = { raw, now: NOW, trace: [], intervals: new Map(), changes: [], nodes: new Map(),
    hook: null, businessFault: null };
  const listeners = new Map();
  const storage = {
    getItem(key) { counts.reads++; counts.receiver &&= this === storage;
      counts.key &&= key === 'lumina_auth'; return control.raw; },
    setItem() { counts.writes++; fail(); }, removeItem() { counts.writes++; fail(); },
    clear() { counts.writes++; fail(); }
  };
  let sequence = 0;
  const w = {
    localStorage: storage, atob: globalThis.atob, TextDecoder, AbortController,
    Date: class extends Date { static now() { counts.clock++; return control.now; } },
    Event: class { constructor(type) { this.type = type; } },
    crypto: { randomUUID: () => OWNER },
    fetch() { counts.fetch++; throw new Error('UNEXPECTED_SYNTHETIC_FETCH'); },
    setInterval(callback, delay) { counts.interval++; control.trace.push(['interval', delay]);
      const id = ++sequence; control.intervals.set(id, callback); return id; },
    clearInterval(id) { control.trace.push(['clearInterval']); control.intervals.delete(id); },
    setTimeout() { counts.timeout++; throw new Error('UNEXPECTED_SYNTHETIC_TIMEOUT'); },
    clearTimeout() {},
    addEventListener(type, callback, opts) { counts.listenerAdds++;
      const list = listeners.get(type) || []; list.push({ callback, once: opts?.once === true });
      listeners.set(type, list); },
    removeEventListener(type, callback) {
      listeners.set(type, (listeners.get(type) || []).filter(row => row.callback !== callback));
    },
    dispatchEvent(event) {
      control.trace.push(['event', event.type]);
      for (const row of [...(listeners.get(event.type) || [])]) {
        if (!(listeners.get(event.type) || []).includes(row)) continue;
        if (row.once) w.removeEventListener(event.type, row.callback);
        row.callback(event);
      }
      return true;
    },
    location: { reload() { control.trace.push(['reload']); } }
  };
  w.window = w;
  setup(w, control, counts);
  const context = createContext(w);
  const run = code => new Script(code, { filename: 'lifetime-synthetic-call' })
    .runInContext(context, { timeout: 1000 });
  const call = fn => {
    w.__fixtureCall = fn;
    try { return run('__fixtureCall()'); } finally { delete w.__fixtureCall; }
  };
  sources.get(ASSETS[0]).runInContext(context, { timeout: 1000 });
  const inspect = (value, namespace = NS) => {
    w.__fixtureOptions = value;
    w.__fixtureNamespace = namespace;
    try { return run('window[__fixtureNamespace].inspect(__fixtureOptions)'); }
    finally { delete w.__fixtureOptions; delete w.__fixtureNamespace; }
  };
  return { w, control, counts, storage, context, run, call, inspect,
    emit(type, fields = {}) { return call(() => w.dispatchEvent({ type, ...fields })); },
    tick() { return call(() => { for (const callback of [...control.intervals.values()]) callback(); }); } };
}

function quiet(h, label) {
  check(h.counts.writes === 0 && h.counts.fetch === 0 && h.counts.interval === 0 &&
    h.counts.timeout === 0 && h.counts.clock === 0 && h.counts.listenerAdds === 0 &&
    h.control.trace.length === 0 && h.counts.receiver && h.counts.key, label);
}

function expectInspect(h, expected, label, value) {
  let result, threw = false;
  try { result = h.inspect(value); } catch (_) { threw = true; }
  check(!threw && typeof result === 'string' && ENUM.includes(result) && result === expected, label);
}

function cappedToken(length) {
  const payload = encoded(Buffer.from('{"iat":0,"exp":60}'));
  let signature = 'c2ln';
  if ((length - payload.length - signature.length - 2) % 4 === 1) signature = 'c2k';
  const result = 'A'.repeat(length - payload.length - signature.length - 2) + '.' + payload + '.' + signature;
  check(result.length === length && result.split('.').every(part => part.length % 4 !== 1), 'CAP_FIXTURE');
  return result;
}

test('auth lifetime hint: finite buckets stay independent and preserve transport identity', options, async () => {
  const boundaries = [
    [0, 0, 'nonpositive'], [1, 0, 'nonpositive'], [-0, 0, 'nonpositive'], [0, -0, 'nonpositive'],
    [-1, -1, 'nonpositive'], [0, Number.MIN_VALUE, 'under-minute'], [0, 0.5, 'under-minute'],
    [0, 59.999999999, 'under-minute'], [0, 60, 'minute-or-longer'], [0, 60.5, 'minute-or-longer'],
    [0, 900, 'minute-or-longer'], [-60, 0, 'minute-or-longer'], [-59, 0, 'under-minute'],
    [-10, -11, 'nonpositive'], [Number.MAX_VALUE, Number.MAX_VALUE, 'nonpositive'],
    [Number.MAX_VALUE, 0, 'nonpositive'], [0, Number.MAX_VALUE, 'minute-or-longer'],
    [-Number.MAX_VALUE, 0, 'minute-or-longer'],
    [-Number.MAX_VALUE, Number.MAX_VALUE, 'unknown'], [Number.MAX_VALUE, -Number.MAX_VALUE, 'unknown']
  ];
  check(boundaries.length === 20, 'FINITE_MATRIX_COUNT');
  for (const [index, [iat, exp, expected]] of boundaries.entries()) {
    const h = world(rawAuth(token({ iat, exp })));
    expectInspect(h, expected, 'FINITE_' + index);
    check(h.counts.reads === 1, 'FINITE_ONE_READ'); quiet(h, 'FINITE_PURE');
  }
  const s = NOW / 1000;
  const independent = [
    [{ iat: s - 100, exp: s - 70 }, 'under-minute', 'expired'],
    [{ iat: s + 10, exp: s + 40 }, 'under-minute', 'future'],
    [{ iat: s - 1000, exp: s - 100 }, 'minute-or-longer', 'expired'],
    [{ iat: s + 10, exp: s + 910 }, 'minute-or-longer', 'future'],
    [{ iat: s - 100, exp: s - 101 }, 'nonpositive', 'expired'],
    [{ iat: s + 100, exp: s + 99 }, 'nonpositive', 'future'],
    [{ exp: s + 1 }, 'unknown', 'future']
  ];
  check(independent.length === 7, 'INDEPENDENCE_MATRIX_COUNT');
  for (const [index, [claims, expected, time]] of independent.entries()) {
    const h = world(rawAuth(token(claims)));
    expectInspect(h, expected, 'INDEPENDENCE_' + index, { now: () => fail() });
    check(h.inspect({ now: NOW }, TIME_NS) === time && h.counts.clock === 0 && h.counts.reads === 2,
      'GENUINE_TIME_NAMESPACE_INDEPENDENT'); quiet(h, 'INDEPENDENCE_PURE');
  }
  const good = token({ iat: 0, exp: 60 }), basic = rawAuth(good), maximum = cappedToken(8192);
  const readers = [
    [basic, true, good], [JSON.stringify({ viewer: { userId: OWNER }, access_token: good }), true, good],
    [JSON.stringify({ user: { id: OWNER }, tokens: { accessToken: good } }), true, good],
    [JSON.stringify({ viewer: { id: OWNER }, tokens: { access_token: good } }), true, good],
    [basic.padEnd(65536, ' '), true, good], [basic.padEnd(65537, ' '), false],
    [rawAuth(maximum), true, maximum], [rawAuth(cappedToken(8193)), false],
    [rawAuth(good, 'invalid'), false], [JSON.stringify({ ...auth(' ' + good), token: good }), false]
  ];
  check(readers.length === 10, 'READER_MATRIX_COUNT');
  for (const [index, [raw, admitted, expectedToken]] of readers.entries()) {
    const h = world(raw);
    expectInspect(h, admitted ? 'minute-or-longer' : 'unknown', 'READER_' + index);
    quiet(h, 'READER_INSPECT_PURE');
    const t = h.call(() => h.w.LuminaCreatorApprovedReadonlyTransport.create());
    try {
      const result = h.call(() => t.getAuth());
      check((result !== null) === admitted && (!admitted || Object.isFrozen(result) &&
        Object.isFrozen(result.user) && result.accessToken === expectedToken && result.user.id === OWNER),
      'GENUINE_SHARED_READER');
      check(h.counts.reads === 2 && h.counts.receiver && h.counts.key && h.counts.writes === 0 &&
        h.counts.fetch === 0, 'READER_DELEGATION_PURE');
    } finally { h.call(() => t.dispose()); }
  }
  for (const factory of FACTORIES) {
    const h = world(basic), published = h.w.LuminaCreatorApprovedReadonlyTransport;
    check(Object.isFrozen(published) && same(Object.keys(published), FACTORIES) &&
      Object.isFrozen(h.w[NS]) && same(Object.keys(h.w[NS]), ['inspect']) &&
      Object.isFrozen(h.w[TIME_NS]) && same(Object.keys(h.w[TIME_NS]), ['inspect']), 'NAMESPACE_CONTRACT');
    const t = h.call(() => published[factory]()), references = METHODS.map(name => t[name]);
    try {
      check(Object.isFrozen(t) && same(Object.keys(t), METHODS), 'SIX_METHODS');
      const initial = h.call(() => t.identity());
      let original;
      await h.call(() => t.fetch('/synthetic-invalid-route', {}).catch(error => { original = error; }));
      const receipt = h.call(() => t.requestReceipt(original));
      const beforeInspect = { reads: h.counts.reads, listeners: h.counts.listenerAdds, trace: h.control.trace.length };
      expectInspect(h, 'minute-or-longer', 'PREFLIGHT_LIFETIME');
      check(h.counts.reads === beforeInspect.reads + 1 && h.counts.listenerAdds === beforeInspect.listeners &&
        h.control.trace.length === beforeInspect.trace && h.counts.fetch === 0 && h.counts.writes === 0 &&
        h.counts.interval === 0 && h.counts.timeout === 0 && h.counts.clock === 0, 'INSTANCE_INSPECTOR_PURE');
      const after = h.call(() => t.identity());
      check(initial.ownerId === OWNER && after.ownerId === OWNER && initial.epoch === after.epoch &&
        h.call(() => t.isCurrent(initial)) && t.requestReceipt(original) === receipt &&
        METHODS.every((name, index) => t[name] === references[index]), 'IDENTITY_METHOD_RECEIPT_RETAINED');
      check(original?.code === 'invalid_request' && Object.isFrozen(receipt) &&
        same(Object.keys(receipt), RECEIPT_KEYS) && receipt.contract === 'owner-readonly-request-receipt-v1' &&
        receipt.nativeFetchInvoked === false && receipt.responseStatus === 'none' &&
        receipt.phase === 'pre_fetch' && receipt.authority === 'client_observation_only', 'EXACT_OLD_RECEIPT');
      h.control.raw = rawAuth(token({ iat: 0, exp: 30 }));
      expectInspect(h, 'under-minute', 'TRANSIENT_INSPECTION');
      h.control.raw = basic;
      check(h.call(() => t.identity()).epoch === initial.epoch && t.requestReceipt(original) === receipt,
        'INSPECTOR_DOES_NOT_SAMPLE_EPOCH');
      h.control.raw = rawAuth(good, OTHER); h.emit('storage', { key: 'lumina_auth' });
      const changed = h.call(() => t.identity());
      check(changed.ownerId === OTHER && changed.epoch !== initial.epoch && !t.isCurrent(initial) &&
        t.requestReceipt(original) === null && h.counts.fetch === 0 && h.counts.writes === 0,
      'ORIGINAL_OWNER_EPOCH_INVALIDATION');
    } finally { h.call(() => t.dispose()); }
  }
  {
    const h = world(null); let injectedReads = 0, ignored = 0;
    const storage = { getItem(key) { injectedReads++; check(this === storage && key === 'lumina_auth',
      'INJECTED_STORAGE_RECEIVER'); return basic; } };
    const supplied = { storage, get now() { ignored++; fail(); },
      get clock() { ignored++; fail(); }, get claims() { ignored++; fail(); } };
    expectInspect(h, 'minute-or-longer', 'ONLY_STORAGE_OPTION', supplied);
    expectInspect(h, 'minute-or-longer', 'FUNCTION_NOW_NOT_CALLED', { storage, now() { ignored++; fail(); } });
    check(injectedReads === 2 && h.counts.reads === 0 && ignored === 0, 'OTHER_OPTIONS_NEVER_READ');
    quiet(h, 'EXPLICIT_STORAGE_PURE');
  }
  {
    const h = world(basic, w => { w.Date = class { static now() { fail(); } }; });
    expectInspect(h, 'minute-or-longer', 'NO_DEFAULT_CLOCK_DEPENDENCY'); quiet(h, 'NO_CLOCK_PURE');
  }
});

test('auth lifetime hint: invalid claims and platform faults remain anonymous unknown', options, () => {
  const good = token({ iat: 0, exp: 60 });
  const withBytes = bytes => 'e30.' + encoded(bytes) + '.c2ln';
  const malformed = [
    null, '', '{', '[]', 'null', 7, '\ufeff' + rawAuth(good),
    rawAuth(good, 'invalid'), JSON.stringify(auth(7)), rawAuth(' ' + good),
    rawAuth('e30.c2ln'), rawAuth(good + '.c2ln'), rawAuth('.e30.c2ln'), rawAuth('e30..c2ln'),
    rawAuth('e30.e30.'), rawAuth('e30.e3+.c2ln'), rawAuth('e30.a.c2ln'),
    rawAuth('a.' + good.split('.')[1] + '.c2ln'), rawAuth('e30.' + good.split('.')[1] + '.c'),
    rawAuth(withBytes([0xc3, 0x28])),
    rawAuth(withBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"iat":0,"exp":60}')]))),
  ];
  const invalidPayloads = [
    '{', 'null', '[]', 'true', '12', '"text"', '{}', '{"iat":0}', '{"exp":60}',
    '{"iat":"0","exp":60}', '{"iat":null,"exp":60}', '{"iat":{},"exp":60}',
    '{"iat":[],"exp":60}', '{"iat":true,"exp":60}', '{"iat":0,"exp":"60"}',
    '{"iat":0,"exp":null}', '{"iat":0,"exp":{}}', '{"iat":0,"exp":[]}',
    '{"iat":0,"exp":false}', '{"iat":1e309,"exp":60}', '{"iat":-1e309,"exp":60}',
    '{"iat":0,"exp":1e309}', '{"iat":0,"exp":-1e309}'
  ];
  check(malformed.length === 21 && invalidPayloads.length === 23, 'INVALID_MATRIX_COUNTS');
  for (const [index, raw] of [...malformed, ...invalidPayloads.map(text => rawAuth(tokenText(text)))].entries()) {
    const h = world(raw); expectInspect(h, 'unknown', 'INVALID_' + index); quiet(h, 'INVALID_PURE');
  }
  const semantics = [
    ['{"iat":0,"exp":59,"exp":60}', 'minute-or-longer'],
    ['{"iat":0,"exp":60,"exp":59}', 'under-minute'],
    ['{"iat":0,"iat":60,"exp":60}', 'nonpositive'],
    ['{"iat":0,"iat":1,"exp":60}', 'under-minute'],
    ['{"iat":0,"exp":60,"label":"\u2603"}', 'minute-or-longer'],
    ['{"iat":0,"exp":60,"label":"\\ud800"}', 'minute-or-longer']
  ];
  check(semantics.length === 6, 'JSON_SEMANTICS_COUNT');
  for (const [index, [text, expected]] of semantics.entries()) {
    const h = world(rawAuth(tokenText(text))); expectInspect(h, expected, 'STANDARD_JSON_' + index);
    quiet(h, 'JSON_SEMANTICS_PURE');
  }
  const invalidOptions = [null, [], 7, 'x', true, () => 0];
  check(invalidOptions.length === 6, 'OPTIONS_MATRIX_COUNT');
  for (const [index, value] of invalidOptions.entries()) {
    const h = world(); expectInspect(h, 'unknown', 'OPTIONS_' + index, value); quiet(h, 'OPTIONS_PURE');
  }
  const storageFaults = [null, {}, { getItem: fail }, { get getItem() { fail(); } }, { getItem() { return {}; } }];
  check(storageFaults.length === 5, 'STORAGE_MATRIX_COUNT');
  for (const [index, storage] of storageFaults.entries()) {
    const h = world(); expectInspect(h, 'unknown', 'STORAGE_' + index, { storage }); quiet(h, 'STORAGE_PURE');
  }
  {
    const h = world(); expectInspect(h, 'unknown', 'OPTIONS_STORAGE_GETTER', { get storage() { fail(); } });
    quiet(h, 'OPTIONS_GETTER_PURE');
  }
  {
    const h = world(undefined, w => Object.defineProperty(w, 'localStorage', { get: fail }));
    expectInspect(h, 'unknown', 'DEFAULT_STORAGE_GETTER'); quiet(h, 'DEFAULT_GETTER_PURE');
  }
  const platforms = [
    h => { h.w.atob = undefined; }, h => { h.w.atob = fail; },
    h => { h.w.TextDecoder = undefined; },
    h => { h.w.TextDecoder = class { constructor() { fail(); } }; },
    h => { h.w.TextDecoder = class { decode() { fail(); } }; },
    h => { h.run('JSON.parse = function () { throw new Error("SYNTHETIC_PARSE_FAULT"); }'); },
    h => { h.run('Number.isFinite = function () { throw new Error("SYNTHETIC_FINITE_FAULT"); }'); }
  ];
  check(platforms.length === 7, 'PLATFORM_MATRIX_COUNT');
  for (const [index, fault] of platforms.entries()) {
    const h = world(); fault(h); expectInspect(h, 'unknown', 'PLATFORM_' + index); quiet(h, 'PLATFORM_PURE');
  }
  for (const missing of ['iat', 'exp', 'both']) {
    const claims = missing === 'iat' ? { exp: 60 } : missing === 'exp' ? { iat: 0 } : {};
    const h = world(rawAuth(token(claims)));
    h.run('Object.prototype.iat = 0; Object.prototype.exp = 60;');
    expectInspect(h, 'unknown', 'OWN_REQUIRED_' + missing); quiet(h, 'INHERITED_PURE');
  }
  {
    const h = world(rawAuth(good)); h.run('Object.prototype.iat = 999; Object.prototype.exp = -999;');
    expectInspect(h, 'minute-or-longer', 'OWN_SHADOWS_INHERITED'); quiet(h, 'OWN_SHADOW_PURE');
  }
  for (const key of ['iat', 'exp']) {
    const h = world(rawAuth(good));
    h.run('const savedParse = JSON.parse; let parses = 0; JSON.parse = function (text) {' +
      'const value = savedParse(text); if (++parses === 2) Object.defineProperty(value, "' + key + '",' +
      '{get() { throw new Error("SYNTHETIC_CLAIM_GETTER"); }}); return value; };');
    expectInspect(h, 'unknown', 'CLAIM_GETTER_' + key); quiet(h, 'CLAIM_GETTER_PURE');
  }
  {
    const h = world(undefined, w => Object.defineProperty(w, NS, { configurable: true, set: fail }));
    check(Object.isFrozen(h.w.LuminaCreatorApprovedReadonlyTransport) &&
      same(Object.keys(h.w.LuminaCreatorApprovedReadonlyTransport), FACTORIES) &&
      h.inspect({ now: NOW }, TIME_NS) === 'future', 'INSTALL_FAULT_PRESERVES_OLD_NAMESPACES');
    quiet(h, 'INSTALL_FAULT_PURE');
  }
  {
    const h = world(); let calls = 0, nativeOptions = false;
    h.w.atob = value => { calls++; return globalThis.atob(value); };
    h.w.TextDecoder = class extends TextDecoder {
      constructor(label, settings) { super(label, settings);
        nativeOptions = label === 'utf-8' && settings?.fatal === true && settings?.ignoreBOM === true; }
    };
    expectInspect(h, 'under-minute', 'GENUINE_PAYLOAD_ONLY_DECODE');
    check(calls === 1 && nativeOptions, 'ONE_PAYLOAD_FATAL_UTF8'); quiet(h, 'DECODING_PURE');
  }
  {
    const h = world(); let decoders = 0;
    h.w.atob = () => '\0'.repeat(6145);
    h.w.TextDecoder = class { constructor() { decoders++; fail(); } };
    expectInspect(h, 'unknown', 'DERIVED_CAP_FAULT');
    check(decoders === 0, 'DERIVED_CAP_BEFORE_DECODER'); quiet(h, 'DERIVED_CAP_PURE');
  }
});

function entryWorld({ standalone = true, disabled = false } = {}) {
  const h = world();
  const { w, control, counts } = h;
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.dataset = {};
      this.children = []; this.hidden = false; this.disabled = false; this.isConnected = true;
      this.attributes = new Map(); this.listeners = new Map(); }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    appendChild(child) { this.children.push(child); child.isConnected = true; return child; }
    replaceChildren() {
      if (control.businessFault === 'render' && this.id === 'readingCatalogWork') throw control.originalError;
      for (const child of this.children) child.isConnected = false;
      this.children = [];
    }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
  }
  const root = new Element('fixture-root');
  root.getAttribute = name => { if (name === ATTR) control.hook?.('get'); return root.attributes.get(name) ?? null; };
  root.setAttribute = (name, value) => { if (name === ATTR) control.hook?.('set');
    root.attributes.set(name, value); control.changes.push(['set', name, value]); };
  root.removeAttribute = name => { if (name === ATTR) control.hook?.('remove');
    root.attributes.delete(name); control.changes.push(['remove', name]); };
  for (const id of htmlIds) control.nodes.set(id, new Element(id));
  check(control.nodes.has('readingCatalogWork') && control.nodes.has('writerApprovedSectionBytes'), 'HTML_FIXTURE_NODES');
  control.nodes.get('readingLocale').value = 'ko';
  const document = { readyState: 'complete', documentElement: root, hidden: false, activeElement: null,
    getElementById: id => control.nodes.get(id) || null, createElement: tag => new Element(tag) };
  w.document = document; w.opener = standalone ? null : {};
  control.originalError = new Error('SYNTHETIC_ORIGINAL_BUSINESS_ERROR');
  const factory = w.LuminaCreatorApprovedReadonlyTransport;
  w.LuminaCreatorApprovedReadonlyTransport = Object.freeze(Object.fromEntries(FACTORIES.map(name => [name, arg => {
    control.trace.push(['factory', name]);
    const actual = factory[name](arg);
    return Object.freeze(Object.fromEntries(METHODS.map(method => [method, (...args) => {
      control.trace.push(['transport', name, method]);
      const result = actual[method](...args);
      if (method === 'identity') control.trace.push(['epoch', result?.epoch ?? null]);
      return result;
    }])));
  }])));
  sources.get(ASSETS[1]).runInContext(h.context, { timeout: 1000 });
  const catalog = w.LuminaCreatorApprovedReadingCatalog;
  w.LuminaCreatorApprovedReadingCatalog = Object.freeze({ parse: catalog.parse, create(config) {
    control.trace.push(['catalog', 'create']);
    const actual = catalog.create({ ...config, onChange(value) {
      control.trace.push(['catalog', 'onChange']); config.onChange(value);
    } });
    return Object.freeze(Object.fromEntries(Object.keys(actual).map(method => [method, (...args) => {
      control.trace.push(['catalog', method]);
      if (control.businessFault === 'sample' && method === 'sync') throw control.originalError;
      return actual[method](...args);
    }])));
  } });
  // Synthetic null-scope seam only; no genuine handoff/owner authentication is claimed.
  w.LuminaCreatorApprovedReadingHandoff = Object.freeze({ createReceiver(config) {
    control.trace.push(['receiver', 'create']);
    return Object.freeze({
      snapshot() { control.trace.push(['receiver', 'snapshot']);
        if (control.businessFault === 'sample') throw control.originalError; return null; },
      start() { control.trace.push(['receiver', 'start']); config.onChange(null); },
      invalidate() { control.trace.push(['receiver', 'invalidate']); },
      dispose() { control.trace.push(['receiver', 'dispose']); },
      validate() { control.trace.push(['receiver', 'validate']); return Promise.resolve(false); }
    });
  } });
  const genuineInspect = w[NS].inspect;
  control.inspections = 0; control.behavior = null;
  if (disabled) delete w[NS];
  else w[NS] = Object.freeze({ inspect(...args) {
    control.inspections++;
    return control.behavior ? control.behavior() : genuineInspect(...args);
  } });
  return Object.assign(h, { root, document,
    start() { return sources.get(ASSETS[2]).runInContext(h.context, { timeout: 1000 }); },
    hint: () => root.attributes.get(ATTR) ?? null,
    sets: () => control.changes.filter(row => row[0] === 'set' && row[1] === ATTR).length,
    verify(label) {
      check(counts.fetch === 0 && counts.writes === 0 && counts.timeout === 0 && counts.interval === 1, label);
      check(control.changes.every(row => (row[1] === ATTR || row[1] === TIME_ATTR) &&
        (row[0] !== 'set' || typeof row[2] === 'string' &&
          (row[1] === ATTR ? ENUM : ['expired', 'future', 'unknown']).includes(row[2]))), label + ':ENUM_ONLY');
      check(control.nodes.get('readingCatalogState').dataset.requestReceiptContract === undefined,
        label + ':NO_INVENTED_RECEIPT');
    } });
}

function parity(a, b, label) { check(same(a.control.trace, b.control.trace), label + ':BUSINESS_TRACE_EPOCH'); }
function once(action) {
  let armed = true;
  return () => { if (armed) { armed = false; action(); } return 'under-minute'; };
}

test('auth lifetime hint: genuine entry lifecycle preserves business and enum-only projection', options, () => {
  let scenarios = 0;
  for (const standalone of [true, false]) {
    {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      check(observed.hint() === 'under-minute' && observed.sets() === 1, 'INITIAL_LIFETIME_PROJECTION');
      const nodes = [...observed.control.nodes.get('readingCatalogWork').children];
      for (const h of [baseline, observed]) { h.document.hidden = true; h.control.now = NOW + 60000; h.tick(); }
      const after = observed.control.nodes.get('readingCatalogWork').children;
      check(observed.hint() === 'under-minute' && observed.sets() === 1 &&
        observed.root.attributes.get(TIME_ATTR) === 'expired' && nodes.length === after.length &&
        nodes.every((node, index) => node === after[index]), 'CLOCK_CROSSING_NOT_LIFETIME');
      for (const h of [baseline, observed]) {
        h.control.raw = rawAuth(token({ iat: NOW / 1000, exp: NOW / 1000 + 120 }));
        h.emit('storage', { key: 'lumina_auth' }); h.tick(); h.emit('focus');
      }
      check(observed.hint() === 'minute-or-longer' && observed.sets() === 2, 'TOKEN_CHANGE_LIFETIME');
      for (const h of [baseline, observed]) {
        h.control.raw = rawAuth(token({ iat: NOW / 1000 + 120, exp: NOW / 1000 + 120 })); h.emit('focus');
      }
      check(observed.hint() === 'nonpositive' && observed.sets() === 3, 'NONPOSITIVE_PROJECTION');
      for (const h of [baseline, observed]) {
        h.control.raw = rawAuth(token({ exp: NOW / 1000 + 120 }));
        h.emit('creator:approved-section-auth-state'); h.emit('focus'); h.tick();
        h.emit('lumina:authchange'); h.emit('lumina:auth-expired');
      }
      check(observed.hint() === 'unknown' && observed.sets() === 4, 'MISSING_IAT_ENUM_ONLY');
      parity(baseline, observed, 'NORMAL');
      const inspections = observed.control.inspections, beforeSets = observed.sets();
      const queued = [baseline, observed].map(h => [...h.control.intervals.values()]);
      let namespaceReads = 0;
      for (const [index, h] of [baseline, observed].entries()) {
        h.emit('pagehide');
        Object.defineProperty(h.w, NS, { configurable: true, get() { namespaceReads++; fail(); } });
        h.call(() => { for (const callback of queued[index]) callback(); });
        h.emit('focus'); h.emit('creator:approved-section-auth-state');
        h.emit('pageshow', { persisted: false }); h.emit('pageshow', { persisted: true });
      }
      check(observed.hint() === null && observed.sets() === beforeSets &&
        observed.control.inspections === inspections && namespaceReads === 0 &&
        observed.control.intervals.size === 0, 'AFTER_PAGEHIDE_NO_LOOKUP_OR_REPUBLICATION');
      parity(baseline, observed, 'DISPOSE'); baseline.verify('CONTROL_QUIET'); observed.verify('NORMAL_QUIET');
    }
    for (const fault of ['inspect', 'namespace', 'method', 'get', 'set', 'remove']) {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      const beforeSets = observed.sets();
      if (fault === 'inspect' || fault === 'remove') observed.control.behavior = fail;
      if (fault === 'namespace') Object.defineProperty(observed.w, NS, { configurable: true, get: fail });
      if (fault === 'method') observed.w[NS] = Object.freeze({ get inspect() { fail(); } });
      if (['get', 'set', 'remove'].includes(fault)) observed.control.hook = operation => {
        if (operation === fault) fail();
      };
      if (fault === 'set') for (const h of [baseline, observed]) {
        h.control.raw = rawAuth(token({ iat: 0, exp: 60 }));
      }
      baseline.emit('focus'); observed.emit('focus');
      const inspections = observed.control.inspections;
      baseline.emit('focus'); observed.emit('focus');
      check(observed.control.inspections === inspections && observed.sets() === beforeSets &&
        (fault === 'remove' ? observed.hint() === 'under-minute' : observed.hint() === null),
      'OBSERVER_FAULT_RETIRES_BEST_EFFORT');
      observed.control.hook = null;
      baseline.emit('pagehide'); observed.emit('pagehide');
      check(observed.hint() === null, 'PAGEHIDE_REPEATS_BEST_EFFORT_REMOVAL');
      parity(baseline, observed, 'FAULT_' + fault); observed.verify('FAULT_BUSINESS_QUIET');
    }
    for (const position of ['inspect-reenter', 'get-reenter', 'namespace-reenter', 'method-reenter',
      'inspect-dispose', 'get-dispose', 'namespace-dispose', 'method-dispose']) {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      const type = position.endsWith('dispose') ? 'pagehide' : 'creator:approved-section-auth-state';
      const fire = once(() => observed.emit(type));
      if (position.startsWith('inspect')) observed.control.behavior = fire;
      else if (position.startsWith('get')) observed.control.hook = operation => { if (operation === 'get') fire(); };
      else {
        const actual = observed.w[NS];
        if (position.startsWith('namespace')) Object.defineProperty(observed.w, NS,
          { configurable: true, get() { fire(); return actual; } });
        else observed.w[NS] = Object.freeze({ get inspect() { fire(); return actual.inspect; } });
      }
      let armed = true;
      const dispatch = baseline.w.dispatchEvent;
      baseline.w.dispatchEvent = event => {
        const result = dispatch(event);
        if (event.type === 'focus' && armed) { armed = false; dispatch({ type }); }
        return result;
      };
      const beforeSets = observed.sets(); baseline.emit('focus'); observed.emit('focus');
      check(observed.hint() === null && observed.sets() === beforeSets, 'INTERLEAVING_BLOCKS_OUTER_PROJECTION');
      observed.control.hook = null;
      const inspections = observed.control.inspections;
      baseline.emit('focus'); observed.emit('focus');
      check(observed.control.inspections === inspections && observed.hint() === null &&
        observed.sets() === beforeSets, 'RETIRED_NO_RETRY');
      baseline.emit('pagehide'); observed.emit('pagehide');
      parity(baseline, observed, 'INTERLEAVING_' + position); observed.verify('INTERLEAVING_QUIET');
    }
    {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      for (const h of [baseline, observed]) h.control.businessFault = 'sample';
      const inspections = observed.control.inspections;
      for (const h of [baseline, observed]) {
        let caught; try { h.emit('focus'); } catch (error) { caught = error; }
        check(caught === h.control.originalError, 'ORIGINAL_SAMPLE_EXCEPTION_IDENTITY');
      }
      check(observed.control.inspections === inspections, 'ORIGINAL_THROW_SKIPS_LIFETIME_TAIL');
      parity(baseline, observed, 'ORIGINAL_SAMPLE_THROW'); observed.verify('ORIGINAL_SAMPLE_QUIET');
      for (const h of [baseline, observed]) { h.control.businessFault = null; h.emit('pagehide'); }
    }
  }
  {
    scenarios++;
    const baseline = entryWorld({ disabled: true }), observed = entryWorld();
    baseline.start(); observed.start();
    for (const h of [baseline, observed]) {
      h.control.businessFault = 'render'; let caught;
      try { h.emit('creator:approved-section-auth-state'); } catch (error) { caught = error; }
      check(caught === h.control.originalError, 'ORIGINAL_RENDER_EXCEPTION_IDENTITY');
    }
    parity(baseline, observed, 'ORIGINAL_RENDER_THROW'); observed.verify('ORIGINAL_RENDER_QUIET');
    for (const h of [baseline, observed]) { h.control.businessFault = null; h.emit('pagehide'); }
  }
  let coercions = 0;
  for (const unexpected of [undefined, 'future', new String('under-minute'),
    { toString() { coercions++; fail(); }, [Symbol.toPrimitive]() { coercions++; fail(); } }, ['under-minute'], 60]) {
    scenarios++;
    const h = entryWorld(); h.control.behavior = () => unexpected; h.start();
    check(h.hint() === 'unknown' && h.sets() === 1, 'UNEXPECTED_VALUE_NOT_COERCED');
    h.verify('UNEXPECTED_ENUM_QUIET'); h.emit('pagehide');
  }
  check(coercions === 0 && scenarios === 39, 'ENTRY_MATRIX_COUNT_NO_COERCION');
});

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createContext, Script } from 'node:vm';
import { TextDecoder } from 'node:util';

const ASSETS = ['creator-approved-readonly-transport.js', 'creator-approved-reading-catalog.js',
  'creator-approved-reading-entry.js'];
const sources = new Map();
const NOW = 1700000000000;
const OWNER = '11111111-1111-4111-8111-111111111111';
const ATTR = 'data-unverified-auth-time';
const NS = 'LuminaCreatorApprovedUnverifiedAuthTime';
const METHODS = ['getAuth', 'identity', 'isCurrent', 'fetch', 'requestReceipt', 'dispose'];
const FACTORIES = ['create', 'createCatalog', 'createBody'];
const RECEIPT_KEYS = ['contract', 'nativeFetchInvoked', 'responseStatus', 'phase', 'authority'];
const options = { concurrency: false, timeout: 20000 };
const check = (condition, label) => assert.equal(Boolean(condition), true, label);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const encoded = bytes => Buffer.from(bytes).toString('base64url');
const tokenText = text => 'e30.' + encoded(Buffer.from(text, 'utf8')) + '.c2ln';
const token = exp => tokenText(JSON.stringify({ exp }));
const auth = accessToken => ({ user: { id: OWNER }, accessToken });
const rawAuth = accessToken => JSON.stringify(auth(accessToken));
const fail = () => { throw new Error('SYNTHETIC_PLATFORM_FAULT'); };

before(() => {
  // Independent Node before-hook: source/read/compile failures are not caught as test success.
  for (const name of ASSETS) {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
      .decode(readFileSync(new URL('../pages/' + name, import.meta.url)));
    sources.set(name, new Script(text, { filename: 'pages/' + name }));
  }
});

function world(raw = rawAuth(token(NOW / 1000 + 1)), setup = () => {}) {
  const counts = { reads: 0, writes: 0, fetch: 0, interval: 0, timeout: 0, clock: 0,
    receiver: true, key: true, listenerAdds: 0 };
  const control = { raw, now: NOW, hook: null, trace: [], intervals: new Map(), changes: [],
    nodes: new Map(), businessFault: null };
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
    Event: class { constructor(type) { this.type = type; } },
    Date: class extends Date { static now() { counts.clock++; return control.now; } },
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
  const run = code => new Script(code, { filename: 'auth-time-synthetic-call' })
    .runInContext(context, { timeout: 1000 });
  const call = fn => {
    w.__fixtureCall = fn;
    try { return run('__fixtureCall()'); } finally { delete w.__fixtureCall; }
  };
  sources.get(ASSETS[0]).runInContext(context, { timeout: 1000 });
  function inspect(value) {
    w.__fixtureOptions = value;
    try { return run('window.LuminaCreatorApprovedUnverifiedAuthTime.inspect(__fixtureOptions)'); }
    finally { delete w.__fixtureOptions; }
  }
  return { w, control, counts, storage, context, run, call, inspect,
    emit(type, fields = {}) { return call(() => w.dispatchEvent({ type, ...fields })); },
    tick() { return call(() => { for (const callback of [...control.intervals.values()]) callback(); }); } };
}

function quiet(h, label) {
  check(h.counts.writes === 0 && h.counts.fetch === 0 && h.counts.interval === 0 &&
    h.counts.timeout === 0 && h.counts.listenerAdds === 0 && h.control.trace.length === 0, label);
  check(h.counts.receiver && h.counts.key, label + ':READ_RECEIVER_KEY');
}

function expectInspect(h, expected, label, ...provided) {
  const supplied = provided.length ? provided[0] : { now: NOW };
  let value, caught = false;
  try { value = h.inspect(supplied); } catch (_) { caught = true; }
  check(!caught && typeof value === 'string' && value === expected &&
    ['expired', 'future', 'unknown'].includes(value), label);
}

function cappedToken(length) {
  const payload = encoded(Buffer.from(JSON.stringify({ exp: NOW / 1000 + 1 })));
  let signature = 'c2ln';
  if ((length - payload.length - signature.length - 2) % 4 === 1) signature = 'c2k';
  const result = 'A'.repeat(length - payload.length - signature.length - 2) + '.' + payload + '.' + signature;
  check(result.length === length && result.split('.').every(part => part.length % 4 !== 1), 'CAP_FIXTURE');
  return result;
}

test('auth time hint: finite boundaries and shared-reader purity', options, async () => {
  const seconds = NOW / 1000;
  const times = [
    [seconds, NOW - 1, 'future'], [seconds, NOW, 'expired'], [seconds, NOW + 1, 'expired'],
    [seconds + 0.25, NOW + 249, 'future'], [seconds + 0.25, NOW + 250, 'expired'],
    [-1, 0, 'expired'], [-0, -1, 'future'], [Number.MAX_VALUE, NOW, 'future'],
    [seconds, Number.MAX_VALUE, 'expired']
  ];
  check(times.length === 9, 'TIME_MATRIX_COUNT');
  for (const [index, [exp, now, expected]] of times.entries()) {
    const h = world(rawAuth(token(exp)));
    expectInspect(h, expected, 'TIME_' + index, { now });
    check(h.counts.reads === 1 && h.counts.clock === 0, 'TIME_SINGLE_READ_NUMERIC_CLOCK');
    quiet(h, 'TIME_PURE');
  }
  const good = token(seconds + 1), expired = token(0), basic = rawAuth(good);
  const maximumToken = cappedToken(8192);
  const readers = [
    [basic, true],
    [JSON.stringify({ user: { userId: OWNER }, access_token: good }), true],
    [JSON.stringify({ viewer: { id: OWNER }, token: good }), true],
    [JSON.stringify({ viewer: { userId: OWNER }, tokens: { accessToken: good } }), true],
    [JSON.stringify({ user: { id: OWNER }, tokens: { access_token: good } }), true],
    [JSON.stringify({ ...auth(good), access_token: expired, token: expired, tokens: { accessToken: expired } }), true],
    [JSON.stringify({ ...auth(good), viewer: { id: 'invalid' } }), true],
    [JSON.stringify({ user: { id: OWNER, userId: 'invalid' }, accessToken: good }), true],
    [JSON.stringify({ ...auth(' ' + good), access_token: good }), false],
    [JSON.stringify({ user: {}, viewer: { id: OWNER }, accessToken: good }), false],
    [JSON.stringify({ accessToken: good }), false],
    [basic.padEnd(65536, ' '), true], [basic.padEnd(65537, ' '), false],
    [rawAuth(maximumToken), true, maximumToken], [rawAuth(cappedToken(8193)), false],
    [' \n' + basic + '\t ', true]
  ];
  check(readers.length === 16, 'READER_MATRIX_COUNT');
  for (const [index, [raw, admitted, expectedToken = good]] of readers.entries()) {
    const h = world(raw);
    expectInspect(h, admitted ? 'future' : 'unknown', 'READ_' + index);
    quiet(h, 'READ_INSPECTOR_PURE');
    const transport = h.call(() => h.w.LuminaCreatorApprovedReadonlyTransport.create());
    const value = h.call(() => transport.getAuth());
    check((value !== null) === admitted && (!admitted || Object.isFrozen(value) && Object.isFrozen(value.user) &&
      value.accessToken === expectedToken && value.user.id === OWNER),
      'READ_DELEGATION_' + index);
    check(h.counts.reads === 2 && h.counts.receiver && h.counts.key && h.counts.writes === 0 &&
      h.counts.fetch === 0, 'READ_DELEGATION_EFFECTS');
    h.call(() => transport.dispose());
  }
  for (const factory of FACTORIES) {
    const h = world();
    const published = h.w.LuminaCreatorApprovedReadonlyTransport;
    check(Object.isFrozen(published) && same(Object.keys(published), FACTORIES), 'FACTORY_CONTRACT');
    check(Object.isFrozen(h.w[NS]) && same(Object.keys(h.w[NS]), ['inspect']), 'INSPECTOR_NAMESPACE');
    const transport = h.call(() => published[factory]());
    check(Object.isFrozen(transport) && same(Object.keys(transport), METHODS), 'SIX_METHODS');
    const before = h.call(() => transport.identity());
    let original;
    await h.call(() => transport.fetch('/synthetic-invalid-route', {}).catch(error => { original = error; }));
    const receipt = h.call(() => transport.requestReceipt(original));
    const hint = h.inspect({ now: NOW });
    const after = h.call(() => transport.identity());
    check(hint === 'future' && before.epoch === after.epoch && transport.requestReceipt(original) === receipt,
      'HINT_PRESERVES_EPOCH_RECEIPT');
    check(original?.code === 'invalid_request' && Object.isFrozen(receipt) && same(Object.keys(receipt), RECEIPT_KEYS) &&
      receipt.contract === 'owner-readonly-request-receipt-v1' && receipt.nativeFetchInvoked === false &&
      receipt.responseStatus === 'none' && receipt.phase === 'pre_fetch' && receipt.authority === 'client_observation_only',
      'EXACT_PREFLIGHT_RECEIPT');
    check(h.counts.fetch === 0 && h.counts.writes === 0, 'NO_NATIVE_REQUEST');
    h.call(() => transport.dispose());
  }
  {
    const h = world(null);
    const injected = { getItem(key) { check(this === injected && key === 'lumina_auth', 'INJECTED_RECEIVER'); return basic; } };
    expectInspect(h, 'future', 'EXPLICIT_STORAGE', { storage: injected, now: NOW });
    check(h.counts.reads === 0, 'EXPLICIT_STORAGE_NO_DEFAULT_READ');
    expectInspect(world(), 'future', 'DEFAULT_CLOCK', undefined);
    const clock = world();
    expectInspect(clock, 'future', 'ONE_DEFAULT_CLOCK', undefined);
    check(clock.counts.clock === 1, 'DEFAULT_CLOCK_ONCE');
  }
  {
    const h = world();
    const transport = h.call(() => h.w.LuminaCreatorApprovedReadonlyTransport.create());
    const initial = h.call(() => transport.identity());
    h.control.raw = rawAuth(token(seconds + 2));
    expectInspect(h, 'future', 'INSPECT_BEFORE_BUSINESS_SAMPLE');
    h.control.raw = basic;
    const restored = h.call(() => transport.identity());
    check(restored.epoch === initial.epoch, 'INSPECT_DID_NOT_SAMPLE_TRANSIENT_MARKER');
    h.call(() => transport.dispose());
  }
});

test('auth time hint: malformed inputs and platform faults stay unknown', options, () => {
  const good = token(NOW / 1000 + 1);
  const withBytes = bytes => 'e30.' + encoded(bytes) + '.c2ln';
  const malformed = [
    null, '', '{', '[]', 'null', 7, '\ufeff' + rawAuth(good),
    JSON.stringify({ user: { id: 'invalid' }, accessToken: good }),
    JSON.stringify(auth(7)), rawAuth(' ' + good), rawAuth('e30.c2ln'), rawAuth(good + '.c2ln'),
    rawAuth('.e30.c2ln'), rawAuth('e30..c2ln'), rawAuth('e30.e30.'), rawAuth('e30.e3+.c2ln'),
    rawAuth('e30.a.c2ln'), rawAuth(withBytes([0xc3, 0x28])),
    rawAuth(withBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"exp":1700000001}')]))),
    rawAuth(tokenText('{')), rawAuth(tokenText('null')), rawAuth(tokenText('[]')),
    rawAuth(tokenText('true')), rawAuth(tokenText('12')), rawAuth(tokenText('"text"')),
    rawAuth(tokenText('{}')), rawAuth(tokenText('{"exp":"1700000001"}')),
    rawAuth(tokenText('{"exp":null}')), rawAuth(tokenText('{"exp":{}}')),
    rawAuth(tokenText('{"exp":[]}')), rawAuth(tokenText('{"exp":true}')),
    rawAuth(tokenText('{"exp":1e309}')), rawAuth(tokenText('{"exp":-1e309}')),
    rawAuth('a.' + good.split('.')[1] + '.c2ln'), rawAuth('e30.' + good.split('.')[1] + '.c')
  ];
  check(malformed.length === 35, 'MALFORMED_MATRIX_COUNT');
  for (const [index, raw] of malformed.entries()) {
    const h = world(raw);
    expectInspect(h, 'unknown', 'MALFORMED_' + index);
    quiet(h, 'MALFORMED_PURE');
  }
  const jsonSemantics = [
    ['{"exp":0,"exp":1700000001}', 'future'], ['{"exp":1700000001,"exp":0}', 'expired'],
    ['{"exp":1700000001,"label":"\u2603"}', 'future'],
    ['{"exp":1700000001,"label":"\\ud800"}', 'future']
  ];
  for (const [index, [text, expected]] of jsonSemantics.entries()) {
    expectInspect(world(rawAuth(tokenText(text))), expected, 'STANDARD_JSON_' + index);
  }
  let functionClockCalls = 0;
  const invalidClocks = [NaN, Infinity, -Infinity, String(NOW), null, true, {}, () => { functionClockCalls++; return NOW; }];
  for (const [index, now] of invalidClocks.entries()) {
    const h = world(); expectInspect(h, 'unknown', 'CLOCK_' + index, { now }); quiet(h, 'CLOCK_PURE');
  }
  check(invalidClocks.length === 8 && functionClockCalls === 0, 'FUNCTION_CLOCK_NEVER_CALLED');
  const invalidOptions = [null, { get storage() { fail(); } }, { get now() { fail(); } }];
  for (const [index, value] of invalidOptions.entries()) expectInspect(world(), 'unknown', 'OPTION_' + index, value);
  const storageFaults = [null, {}, { getItem: fail }];
  for (const [index, storage] of storageFaults.entries()) {
    expectInspect(world(), 'unknown', 'STORAGE_' + index, { storage, now: NOW });
  }
  const defaultStorageFault = world(undefined, w => Object.defineProperty(w, 'localStorage', { get: fail }));
  expectInspect(defaultStorageFault, 'unknown', 'DEFAULT_STORAGE_GETTER');
  const platforms = [
    w => { w.atob = undefined; }, w => { w.atob = fail; },
    w => { w.TextDecoder = undefined; }, w => { w.TextDecoder = class { constructor() { fail(); } }; },
    w => { w.TextDecoder = class { decode() { fail(); } }; },
    w => { w.Date = class { static now() { fail(); } }; },
    (_w, h) => { h.run('JSON.parse = function () { throw new Error("SYNTHETIC_PARSE_FAULT"); }'); }
  ];
  for (const [index, fault] of platforms.entries()) {
    const h = world(); fault(h.w, h);
    expectInspect(h, 'unknown', 'PLATFORM_' + index, undefined); quiet(h, 'PLATFORM_PURE');
  }
  {
    const h = world(rawAuth(tokenText('{}')));
    h.run('Object.prototype.exp = 1700000001');
    expectInspect(h, 'unknown', 'EXP_MUST_BE_OWN');
  }
  {
    const h = world(undefined, w => Object.defineProperty(w, NS, { configurable: true, set: fail }));
    check(Object.isFrozen(h.w.LuminaCreatorApprovedReadonlyTransport) &&
      same(Object.keys(h.w.LuminaCreatorApprovedReadonlyTransport), FACTORIES), 'INSTALL_FAULT_PRESERVES_FACTORY');
  }
  {
    const h = world(); let atobCalls = 0, decoderOptions = false;
    h.w.atob = value => { atobCalls++; return globalThis.atob(value); };
    h.w.TextDecoder = class extends TextDecoder {
      constructor(label, settings) { super(label, settings);
        decoderOptions = label === 'utf-8' && settings?.fatal === true && settings?.ignoreBOM === true; }
    };
    expectInspect(h, 'future', 'PAYLOAD_ONLY_NATIVE_DECODING');
    check(atobCalls === 1 && decoderOptions, 'ONE_PAYLOAD_DECODE_FATAL_UTF8');
  }
  {
    const h = world(); let decoders = 0;
    h.w.atob = () => '\0'.repeat(6145);
    h.w.TextDecoder = class { constructor() { decoders++; fail(); } };
    expectInspect(h, 'unknown', 'DERIVED_DECODE_CAP');
    check(decoders === 0, 'OVERSIZE_REJECTED_BEFORE_UTF8_DECODER');
    quiet(h, 'DERIVED_CAP_PURE');
  }
});

function entryWorld({ standalone = true, disabled = false } = {}) {
  const h = world();
  const { w, control, counts } = h;
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.textContent = ''; this.dataset = {};
      this.children = []; this.hidden = false; this.disabled = false; this.isConnected = true;
      this.attributes = new Map(); this.listeners = new Map(); }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
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
  const root = new Element('root');
  root.getAttribute = name => { control.hook?.('get', name); return root.attributes.get(name) ?? null; };
  root.setAttribute = (name, value) => { control.hook?.('set', name); root.attributes.set(name, value);
    control.changes.push(['set', name, value]); };
  root.removeAttribute = name => { control.hook?.('remove', name); root.attributes.delete(name);
    control.changes.push(['remove', name]); };
  const ids = ['writerManuscriptWork', 'writerManuscriptLocale', 'readingWorkTitle', 'readingConnectionState',
    'readingLocale', 'readingCatalog', 'readingCatalogWork', 'readingCatalogLoad', 'readingCatalogNext',
    'readingCatalogLogin', 'readingCatalogWorks', 'readingCatalogTitle', 'readingCatalogWorkLabel',
    'readingCatalogState', 'readingTitle', 'readingStudioLink', 'readingLocaleLabel', 'writerApprovedSectionBytes'];
  for (const id of ids) control.nodes.set(id, new Element(id));
  control.nodes.get('readingLocale').value = 'ko';
  const document = { readyState: 'complete', documentElement: root, hidden: false, activeElement: null,
    getElementById: id => control.nodes.get(id) || null, createElement: tag => new Element(tag) };
  w.document = document; w.opener = standalone ? null : {};
  control.originalError = new Error('SYNTHETIC_ORIGINAL_BUSINESS_ERROR');
  const originalFactory = w.LuminaCreatorApprovedReadonlyTransport;
  w.LuminaCreatorApprovedReadonlyTransport = Object.freeze(Object.fromEntries(FACTORIES.map(factory => [factory, arg => {
    control.trace.push(['factory', factory]);
    const instance = originalFactory[factory](arg);
    return Object.freeze(Object.fromEntries(METHODS.map(method => [method, (...args) => {
      control.trace.push(['transport', factory, method]);
      const result = instance[method](...args);
      if (method === 'identity') control.trace.push(['epoch', result?.epoch ?? null]);
      return result;
    }])));
  }])));
  sources.get(ASSETS[1]).runInContext(h.context, { timeout: 1000 });
  const actualCatalog = w.LuminaCreatorApprovedReadingCatalog;
  w.LuminaCreatorApprovedReadingCatalog = Object.freeze({ parse: actualCatalog.parse, create(config) {
    control.trace.push(['catalog', 'create']);
    const actual = actualCatalog.create({ ...config, onChange(value) {
      control.trace.push(['catalog', 'onChange']); config.onChange(value);
    } });
    return Object.freeze(Object.fromEntries(Object.keys(actual).map(method => [method, (...args) => {
      control.trace.push(['catalog', method]);
      if (control.businessFault === 'sample' && method === 'sync') throw control.originalError;
      return actual[method](...args);
    }])));
  } });
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
  const actualInspector = w[NS].inspect;
  control.inspections = 0; control.behavior = null;
  if (disabled) delete w[NS];
  else w[NS] = Object.freeze({ inspect(...args) {
    control.inspections++;
    return control.behavior ? control.behavior() : actualInspector(...args);
  } });
  return Object.assign(h, { root, document,
    start() { return sources.get(ASSETS[2]).runInContext(h.context, { timeout: 1000 }); },
    hint: () => root.attributes.get(ATTR) ?? null,
    sets: () => control.changes.filter(row => row[0] === 'set' && row[1] === ATTR).length,
    verify(label) {
      check(counts.fetch === 0 && counts.writes === 0 && counts.timeout === 0 && counts.interval === 1, label);
      check(control.changes.every(row => row[1] === ATTR && (row[0] !== 'set' ||
        ['expired', 'future', 'unknown'].includes(row[2]))), label + ':ONE_ENUM_ATTRIBUTE');
      check(control.nodes.get('readingCatalogState').dataset.requestReceiptContract === undefined,
        label + ':NO_INVENTED_RECEIPT');
    } });
}

function parity(a, b, label) { check(same(a.control.trace, b.control.trace), label + ':BUSINESS_TRACE_EPOCH'); }
function once(action) {
  let armed = true;
  return () => { if (armed) { armed = false; action(); } return 'future'; };
}

test('auth time hint: genuine entry lifetime preserves business trace', options, () => {
  let scenarios = 0;
  for (const standalone of [true, false]) {
    {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      check(observed.hint() === 'future' && observed.sets() === 1, 'INITIAL_RENDER_SAME_VALUE_SUPPRESSION');
      const initialNodes = [...observed.control.nodes.get('readingCatalogWork').children];
      for (const h of [baseline, observed]) { h.document.hidden = true; h.control.now = NOW + 1000; h.tick(); }
      const afterSampleNodes = observed.control.nodes.get('readingCatalogWork').children;
      check(observed.hint() === 'expired' && observed.sets() === 2 && initialNodes.length === afterSampleNodes.length &&
        initialNodes.every((node, index) => node === afterSampleNodes[index]), 'CLOCK_ONLY_SAMPLE_NO_LIST_REBUILD');
      for (const h of [baseline, observed]) { h.emit('focus'); h.emit('creator:approved-section-auth-state');
        h.control.raw = rawAuth(token(NOW / 1000 + 10)); h.emit('storage', { key: 'lumina_auth' });
        h.tick(); h.emit('lumina:authchange'); h.emit('lumina:auth-expired'); }
      check(observed.hint() === 'future' && observed.sets() === 3, 'EXISTING_EVENT_PATHS_ONLY');
      parity(baseline, observed, 'NORMAL');
      const beforeDisposalInspections = observed.control.inspections;
      for (const h of [baseline, observed]) { h.emit('pagehide'); h.tick(); h.emit('focus');
        h.emit('creator:approved-section-auth-state'); h.emit('pageshow', { persisted: false }); }
      check(observed.hint() === null && observed.sets() === 3 && observed.control.intervals.size === 0 &&
        observed.control.inspections === beforeDisposalInspections,
        'DISPOSE_NO_REPUBLICATION');
      parity(baseline, observed, 'DISPOSE'); baseline.verify('BASELINE_QUIET'); observed.verify('OBSERVED_QUIET');
    }
    for (const fault of ['inspect', 'namespace', 'get', 'set', 'remove']) {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      const beforeSets = observed.sets();
      if (fault === 'inspect') observed.control.behavior = fail;
      else if (fault === 'namespace') Object.defineProperty(observed.w, NS, { configurable: true, get: fail });
      else observed.control.hook = operation => {
        if (operation === fault) fail();
      };
      if (fault === 'set') { baseline.control.now = NOW + 1000; observed.control.now = NOW + 1000; }
      if (fault === 'remove') observed.control.behavior = fail;
      baseline.emit('focus'); observed.emit('focus');
      const calls = observed.control.inspections;
      baseline.emit('focus'); observed.emit('focus');
      check(observed.control.inspections === calls && observed.sets() === beforeSets,
        'FAULT_RETIRE_NO_RETRY');
      check(fault === 'remove' ? observed.hint() === 'future' : observed.hint() === null,
        'FAULT_CLEANUP_BEST_EFFORT');
      observed.control.hook = null;
      baseline.emit('pagehide'); observed.emit('pagehide');
      check(observed.hint() === null, 'PAGEHIDE_CLEANUP_CONTINUES');
      parity(baseline, observed, 'FAULT_' + fault); observed.verify('FAULT_BUSINESS_QUIET');
    }
    for (const location of ['inspect-reenter', 'get-reenter', 'inspect-dispose', 'get-dispose']) {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      const disposed = location.endsWith('dispose'), type = disposed ? 'pagehide' : 'creator:approved-section-auth-state';
      const fire = once(() => observed.emit(type));
      if (location.startsWith('inspect')) observed.control.behavior = fire;
      else observed.control.hook = operation => { if (operation === 'get') fire(); };
      // Replay only the same explicit nested business event in the disabled-observer control.
      let baselineArmed = true;
      const old = baseline.w.dispatchEvent;
      baseline.w.dispatchEvent = event => {
        const result = old(event);
        if (event.type === 'focus' && baselineArmed) { baselineArmed = false; old({ type }); }
        return result;
      };
      const beforeSets = observed.sets(); baseline.emit('focus'); observed.emit('focus');
      check(observed.hint() === null && observed.sets() === beforeSets, 'REENTRY_OR_DISPOSE_BLOCKS_OUTER_WRITE');
      observed.control.hook = null;
      const retiredInspections = observed.control.inspections;
      baseline.emit('focus'); observed.emit('focus');
      check(observed.hint() === null && observed.sets() === beforeSets &&
        observed.control.inspections === retiredInspections, 'RETIRED_FRAME_NEVER_REPUBLISHES');
      parity(baseline, observed, 'INTERLEAVING_' + location); observed.verify('INTERLEAVING_QUIET');
    }
    {
      scenarios++;
      const baseline = entryWorld({ standalone, disabled: true }), observed = entryWorld({ standalone });
      baseline.start(); observed.start();
      for (const h of [baseline, observed]) h.control.businessFault = 'sample';
      const before = observed.control.inspections;
      for (const h of [baseline, observed]) {
        let caught;
        try { h.emit('focus'); } catch (error) { caught = error; }
        check(caught === h.control.originalError, 'ORIGINAL_SAMPLE_EXCEPTION_IDENTITY');
      }
      check(observed.control.inspections === before, 'BUSINESS_THROW_SKIPS_OBSERVER_TAIL');
      parity(baseline, observed, 'ORIGINAL_SAMPLE_THROW'); observed.verify('SAMPLE_THROW_QUIET');
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
    parity(baseline, observed, 'ORIGINAL_RENDER_THROW'); observed.verify('RENDER_THROW_QUIET');
  }
  let coercions = 0;
  for (const unexpected of [undefined, new String('future'), { toString() { coercions++; fail(); } }]) {
    scenarios++;
    const h = entryWorld(); h.control.behavior = () => unexpected; h.start();
    check(h.hint() === 'unknown' && h.sets() === 1, 'UNEXPECTED_PRIMITIVE_WHITELIST');
    h.verify('WHITELIST_QUIET');
  }
  check(coercions === 0 && scenarios === 26, 'ENTRY_MATRIX_COUNT_NO_COERCION');
});

'use strict';
// AUTHOR UNRUN. Complete API/auth prefix, not app bootstrap or the OTT consumer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const PINS = Object.freeze({
  baseline: {
    'app.js': ['a1d791ee7ba4fce5e5777777d5326147a1f0a3ae32f90ce38728a9ec40ec9f1b', '83a6937820eee028efdeb9817490fe979b797c56'],
    'ott/index.html': ['da4e55fd982c5f176687dfeb1c8928023b47f9947f6df4287704b6acf4273d86', 'e3a801e08e311c218e9177e106160629074ee084'],
  },
  current: {
    'app.js': ['1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87', '7c3a65b55c3e2f12623d3f782663c2e2233243a5'],
    'ott/index.html': ['0d59c409a225e9c6ac6c0076f78872778fdcc491d9b782d456ccdb9fee7467fc', '7623bb411ca880f9eeffb3e81fb5ef7868d5557f'],
  },
});
const NAMES = Object.freeze([
  '01 exact public catalog retains the original body deadline after headers',
  '02 pending catalog JSON aborts once at 8000ms without retry',
  '03 normal success errors 204 and fetch failure release the existing timer',
  '04 path method auth body and header exclusions keep legacy header settlement',
]);
const phase = process.env.CINEMA_CATALOG_BODY_PHASE || 'current';
assert(Object.hasOwn(PINS, phase));
const explicitRoot = process.env.CINEMA_CATALOG_BODY_SOURCE_ROOT;
const sourceRoot = path.resolve(explicitRoot || path.join(__dirname, '..'));
if (phase === 'baseline') assert(explicitRoot, 'Baseline requires an owned capsule');
if (explicitRoot) {
  assert(/^[eE]:[\\/]/.test(sourceRoot));
  assert.notEqual(sourceRoot.toLowerCase(), path.resolve('E:/Codex/LuminaStage/ai-entertainment-studio-git').toLowerCase());
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blob = bytes => crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function source(file, maximum, rawPin) {
  if (explicitRoot) assert.match(rawPin || '', /^[a-f0-9]{64}$/i);
  const target = fs.realpathSync(path.join(sourceRoot, file));
  assert.equal(path.relative(sourceRoot, target).replace(/\\/g, '/'), file);
  const bytes = fs.readFileSync(target);
  assert(bytes.length > 0 && bytes.length <= maximum);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')));
  assert.equal(sha(lf), PINS[phase][file][0]);
  assert.equal(blob(Buffer.from(lf)), PINS[phase][file][1]);
  if (rawPin) assert.equal(sha(bytes), rawPin.toLowerCase());
  return lf;
}
const app = source('app.js', 512 * 1024, process.env.CINEMA_CATALOG_BODY_APP_SHA);
const html = source('ott/index.html', 128 * 1024, process.env.CINEMA_CATALOG_BODY_HTML_SHA);
const begin = 'const API_BASE =', end = 'const I18N_LOCALES =';
assert.equal(app.split(begin).length, 2);
assert.equal(app.split(end).length, 2);
assert(app.indexOf(begin) < app.indexOf(end));
const prefix = app.slice(app.indexOf(begin), app.indexOf(end));
assert(Buffer.byteLength(prefix) > 8000 && Buffer.byteLength(prefix) < 16 * 1024);
assert.equal(html.split('/app.js?v=').length, 2);
assert(html.includes(phase === 'current' ? '/app.js?v=ott-catalog-body-deadline-20261016' : '/app.js?v=wallet-session-20261011'));
const flush = async () => { for (let i = 0; i < 128; i++) await Promise.resolve(); };
const options = { timeout: 10000, concurrency: false };

function fixture(expected = {}) {
  const faults = [], timers = new Map(), records = [];
  const stats = { attempts: 0, aborts: 0, jsonCalls: 0, jsonSettlements: 0,
    settlements: 0, storageNullReads: 0, storageWrites: 0, forbidden: 0 };
  let now = 0, timerId = 0, active = null;
  function fault(code) { faults.push(code); throw new Error('Fixture admission fault: ' + code); }
  function admit(condition, code) { if (!condition) fault(code); }
  const clock = {
    get size() { return timers.size; },
    deadlines() { return [...timers.values()].map(row => row.at).sort((a, b) => a - b); },
    set(callback, delay, ...args) {
      admit(typeof callback === 'function' && delay === 8000 && args.length === 0, 'timer-contract');
      const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id;
    },
    clear(id) {
      admit(id === undefined || (Number.isSafeInteger(id) && id > 0 && id <= timerId), 'clear-contract');
      timers.delete(id);
    },
    async advance(ms) {
      admit(Number.isSafeInteger(ms) && ms >= 0 && ms <= 16000, 'clock-advance');
      const target = now + ms;
      for (;;) {
        const next = [...timers].filter(([, row]) => row.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = target; await flush();
    },
  };
  function forbidden() { stats.forbidden++; return fault('forbidden-side-effect'); }
  function fetchFixture(url, init) {
    stats.attempts++;
    admit(stats.attempts === 1 && active !== null, 'one-explicit-dispatch-only');
    admit(url === 'https://api.lumina-stage.com' + (expected.path || '/api/v1/ott'), 'exact-url');
    admit(init && Object.keys(init).sort().join(',') === 'body,headers,method,signal', 'fetch-options');
    admit(init.method === (expected.method || 'GET'), 'method');
    admit(init.body === expected.wireBody, 'body');
    admit(JSON.stringify(init.headers) === JSON.stringify(expected.headers || {}), 'headers');
    admit(init.signal instanceof AbortSignal && !init.signal.aborted, 'native-signal');
    const record = active;
    record.signal = init.signal;
    record.onAbort = () => {
      stats.aborts++;
      admit(stats.aborts === 1, 'duplicate-abort');
      const error = new DOMException('Synthetic body aborted', 'AbortError');
      if (!record.headersDelivered) record.rejectHeaders(error);
      else record.failBody(error);
    };
    init.signal.addEventListener('abort', record.onAbort, { once: true });
    return record.headersPromise;
  }
  const context = {
    AbortController, AbortSignal, Promise, URL, Event, CustomEvent,
    setTimeout: clock.set, clearTimeout: clock.clear, fetch: fetchFixture,
    localStorage: {
      getItem(key) {
        stats.storageNullReads++;
        admit(expected.storageNullReads === 1 && key === 'lumina_auth' && stats.storageNullReads === 1, 'null-storage-only');
        return null;
      },
      setItem() { stats.storageWrites++; forbidden(); },
      removeItem() { stats.storageWrites++; forbidden(); },
    },
    window: { dispatchEvent: forbidden },
    console: { log: forbidden, info: forbidden, warn: forbidden, error: forbidden },
  };
  for (const name of ['document', 'navigator', 'sessionStorage', 'WebSocket', 'XMLHttpRequest'])
    Object.defineProperty(context, name, { get: forbidden });
  vm.runInNewContext(prefix, context, { filename: 'actual-api-auth-prefix.js', timeout: 1000 });
  admit(typeof context.apiFetch === 'function', 'actual-prefix-entry');
  function start(requestOptions = { throwOnError: true }) {
    admit(records.length === 0, 'one-operation-per-fixture');
    let resolveHeaders, rejectHeaders;
    const record = { headersDelivered: false, bodyDone: false, settled: false };
    record.headersPromise = new Promise((resolve, reject) => { resolveHeaders = resolve; rejectHeaders = reject; });
    record.rejectHeaders = error => { record.headersDelivered = true; rejectHeaders(error); };
    record.failBody = error => {
      if (record.bodyDone) return;
      record.bodyDone = true;
      if (record.bodyController) record.bodyController.error(error);
    };
    active = record; records.push(record);
    record.promise = context.apiFetch(expected.path || '/api/v1/ott', requestOptions);
    record.promise.then(value => {
      stats.settlements++; record.settled = true; record.value = value;
    }, error => {
      stats.settlements++; record.settled = true; record.error = error;
    });
    record.headers = (status = 200) => {
      admit(!record.headersDelivered && record.signal, 'headers-once-after-fetch');
      const stream = status === 204 ? null : new ReadableStream({ start(controller) { record.bodyController = controller; } });
      const response = new Response(stream, { status });
      const nativeJSON = response.json.bind(response);
      Object.defineProperty(response, 'json', { value() {
        stats.jsonCalls++;
        admit(stats.jsonCalls === 1, 'single-native-json');
        return nativeJSON().then(value => { stats.jsonSettlements++; return value; }, error => {
          stats.jsonSettlements++; throw error;
        });
      } });
      record.headersDelivered = true; if (status === 204) record.bodyDone = true;
      resolveHeaders(response);
    };
    record.completeText = text => {
      admit(record.headersDelivered && record.bodyController && !record.bodyDone, 'complete-body-once');
      record.bodyDone = true;
      record.bodyController.enqueue(new TextEncoder().encode(text)); record.bodyController.close();
    };
    record.complete = value => record.completeText(JSON.stringify(value));
    return record;
  }
  function check() {
    assert.deepEqual(faults, [], 'Latched fixture faults are checked outside product catches');
    assert.equal(stats.forbidden, 0); assert.equal(stats.storageWrites, 0);
  }
  async function finish() {
    // Teardown drains only synthetic promises, including after the baseline's named failure.
    for (const row of records) {
      if (!row.headersDelivered) row.rejectHeaders(new Error('Synthetic teardown before headers'));
      row.failBody(new Error('Synthetic teardown body release'));
    }
    await Promise.allSettled(records.map(row => row.promise)); await flush();
    for (const row of records) if (row.signal) row.signal.removeEventListener('abort', row.onAbort);
    check();
    assert.equal(timers.size, 0, 'Actual apiFetch finally clears all owned virtual deadlines');
    assert.equal(stats.attempts, 1); assert.equal(stats.settlements, 1);
    assert.equal(stats.storageNullReads, expected.storageNullReads || 0);
  }
  return { clock, stats, start, check, finish };
}

test(NAMES[0], options, async () => {
  const f = fixture();
  try {
    const r = f.start(); r.headers(); await flush(); f.check();
    assert.equal(f.stats.jsonCalls, 1, 'Actual native JSON consumption has started');
    assert.equal(f.stats.settlements, 0);
    assert.equal(f.clock.size, 1, 'PUBLIC_OTT_CATALOG_BODY_DEADLINE_CLEARED_AT_HEADERS');
    assert.deepEqual(f.clock.deadlines(), [8000]);
    r.complete({ items: [] });
    assert.deepEqual(await r.promise, { items: [] }); await flush();
    assert.equal(f.clock.size, 0); assert.equal(f.stats.aborts, 0);
  } finally { await f.finish(); }
});

if (phase === 'current') {
  test(NAMES[1], options, async () => {
    for (const throwOnError of [true, false]) {
      const f = fixture();
      try {
        const r = f.start({ throwOnError });
        await f.clock.advance(1000); r.headers(); await flush(); f.check();
        assert.deepEqual(f.clock.deadlines(), [8000], 'Header completion never restarts the deadline');
        await f.clock.advance(6999);
        assert.equal(f.stats.settlements, 0); assert.equal(f.stats.aborts, 0);
        await f.clock.advance(1);
        if (throwOnError) await assert.rejects(r.promise, error => error instanceof DOMException && error.name === 'AbortError');
        else assert.equal(await r.promise, null);
        await flush(); f.check();
        assert.equal(f.stats.attempts, 1); assert.equal(f.stats.aborts, 1);
        assert.equal(f.stats.jsonCalls, 1); assert.equal(f.stats.jsonSettlements, 1);
        assert.equal(f.stats.settlements, 1); assert.equal(f.clock.size, 0);
        await f.clock.advance(8000); assert.equal(f.stats.settlements, 1);
      } finally { await f.finish(); }
    }
  });

  test(NAMES[2], options, async () => {
    for (const kind of ['success', 'error-throw', 'error-null', '204', 'fetch-failure', 'invalid-json']) {
      const f = fixture();
      try {
        const r = f.start({ throwOnError: kind !== 'error-null' });
        if (kind === 'fetch-failure') r.rejectHeaders(new TypeError('Synthetic fetch failure'));
        else {
          r.headers(kind === '204' ? 204 : kind.startsWith('error-') ? 503 : 200);
          await flush(); f.check();
          if (kind === 'success') r.complete({ items: [{ slug: 'synthetic-only' }] });
          if (kind === 'error-throw') r.complete({ message: 'Synthetic unavailable' });
          if (kind === 'invalid-json') r.completeText('{');
        }
        if (kind === 'success') assert.deepEqual(await r.promise, { items: [{ slug: 'synthetic-only' }] });
        else if (kind === 'error-throw') await assert.rejects(r.promise, error => error.status === 503 && error.message === 'Synthetic unavailable');
        else if (kind === 'fetch-failure') await assert.rejects(r.promise, /Synthetic fetch failure/);
        else if (kind === 'invalid-json') await assert.rejects(r.promise, SyntaxError);
        else assert.equal(await r.promise, null);
        await flush(); f.check();
        assert.equal(f.clock.size, 0); assert.equal(f.stats.aborts, 0);
        assert.equal(f.stats.settlements, 1);
        assert.equal(f.stats.jsonCalls, ['204', 'fetch-failure', 'error-null'].includes(kind) ? 0 : 1);
        // Existing non-throwing error handling leaves the unread synthetic body to fixture teardown.
      } finally { await f.finish(); }
    }
  });

  test(NAMES[3], options, async () => {
    const variants = [
      { path: '/api/v1/ott/' }, { path: '/api/v1/ott?limit=1' },
      { path: '/api/v1/ott/synthetic-only' }, { path: '/api/v1/feed' },
      { method: 'POST', options: { method: 'POST' } },
      { method: 'get', options: { method: 'get' } },
      { storageNullReads: 1, options: { auth: true } },
      { options: { auth: null } },
      { options: { body: null } }, { options: { body: false } },
      { options: { body: 0 } }, { options: { body: '' } },
      { headers: { 'Content-Type': 'application/json' }, wireBody: '{}', options: { body: {} } },
      { headers: { Accept: 'application/json' }, options: { headers: { Accept: 'application/json' } } },
    ];
    for (const variant of variants) {
      const f = fixture(variant);
      try {
        const r = f.start({ throwOnError: true, ...variant.options });
        r.headers(); await flush(); f.check();
        assert.equal(f.stats.jsonCalls, 1); assert.equal(f.stats.settlements, 0);
        assert.equal(f.clock.size, 0, 'Excluded requests retain the legacy headers-only deadline');
        await f.clock.advance(16000);
        assert.equal(f.stats.aborts, 0); assert.equal(f.stats.settlements, 0);
        r.complete({ unchanged: true }); assert.deepEqual(await r.promise, { unchanged: true });
        await flush(); assert.equal(f.stats.jsonSettlements, 1);
      } finally { await f.finish(); }
    }
  });
}

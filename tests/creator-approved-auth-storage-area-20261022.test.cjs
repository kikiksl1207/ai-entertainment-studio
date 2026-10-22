'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { TextDecoder } = require('node:util');
const now = Date.now.bind(Date);
const PRODUCT = 'pages/creator-approved-auth-connection.js';
const SUITE = 'tests/creator-approved-auth-storage-area-20261022.test.cjs';
const GROUPS = [
  "01 unrelated session events preserve local refresh",
  "02 opposite native identities and adapter fallback",
  "03 own store clear and ABA still retire",
  "04 unknown areas fail conservatively",
  "05 explicit confirmation and duplicate fences",
  "06 disposal and raw changes do not restore",
  "07 rejected and mismatched replies stay closed",
  "08 timeout never retries old refresh"
];
const FAILS = [GROUPS[0], GROUPS[1]];
const report = { contract: 'owner-auth-storage-area-result-v1', groups: [],
  failedGroups: [], passed: 0, failed: 0, complete: false, inputsStable: false,
  loadedModulesAdmitted: false, resourcesClosed: false, realAuthProof: false,
  generationAuthorized: false, productInstalled: false, realProviderQuote: false,
  mode: 'ci', admissionSupplied: false, nativeGuards: null,
  moduleAllowlistVerified: false, fixtureResourcesClosed: false };
const captured = new Map();
let admission, allowed, api, guards = null;
const check = value => { if (!value) throw new Error('OWNER_AUTH_STORAGE_AREA_NOT_QUALIFIED'); };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const key = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const same = (left, right) => key(left) === key(right);
function ordinary(file) {
  check(typeof file === 'string' && path.isAbsolute(file));
  for (let p = file, first = true;; first = false) {
    const stat = fs.lstatSync(p);
    check(!stat.isSymbolicLink() && (first ? stat.isFile() : stat.isDirectory()));
    const parent = path.dirname(p); if (parent === p) break; p = parent;
  }
  check(same(fs.realpathSync.native(file), file));
}
function capture(row) {
  check(row && Number.isSafeInteger(row.bytes) && row.bytes > 0 &&
    typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256));
  ordinary(row.path); const bytes = fs.readFileSync(row.path);
  check(bytes.length === row.bytes && sha(bytes) === row.sha256);
  const prior = captured.get(key(row.path));
  if (prior) check(prior.bytes.equals(bytes)); else captured.set(key(row.path), { path: row.path, bytes });
  return bytes;
}
function stable() {
  for (const row of captured.values()) { ordinary(row.path); if (!fs.readFileSync(row.path).equals(row.bytes)) return false; }
  return true;
}
const modulesAdmitted = () => Object.keys(require.cache).every(file => allowed.has(key(file)));
function admittedProtocol() {
  check(process.argv.length === 4 && /^[a-f0-9]{64}$/.test(process.argv[3]));
  ordinary(process.argv[2]); const raw = fs.readFileSync(process.argv[2]);
  check(raw.length <= 32768 && sha(raw) === process.argv[3]);
  const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  admission = JSON.parse(decode(raw));
  assert.equal(admission.contract, 'owner-auth-storage-area-admission-v1');
  check(['baseline', 'candidate'].includes(admission.mode));
  check(Number.isSafeInteger(admission.deadlineUtcMs) && admission.deadlineUtcMs > now() && admission.deadlineUtcMs <= now() + 120000);
  check(same(process.cwd(), admission.runRoot) && same(process.argv[2], path.join(admission.runRoot, 'admission.json')));
  check(same(path.dirname(admission.runRoot), path.dirname(admission.expected.path)) && /^owned-first-[a-f0-9]{12}$/.test(path.basename(admission.runRoot)));
  check(Array.isArray(admission.pins) && admission.pins.length > 0 && admission.pins.length <= 32);
  check(new Set(admission.pins.map(row => key(row.path))).size === admission.pins.length);
  const member = row => {
    const matches = admission.pins.filter(item => same(item.path, row.path));
    check(matches.length === 1 && matches[0].path === row.path && matches[0].bytes === row.bytes && matches[0].sha256 === row.sha256);
  };
  admission.pins.forEach(capture);
  [admission.node, admission.preload, admission.guard].forEach(capture);
  [admission.preload, admission.guard, admission.expected].forEach(member);
  check(same(process.execPath, admission.node.path) && process.execArgv.length === 2 && process.execArgv[0] === '--require' && same(process.execArgv[1], admission.preload.path));
  check(admission.node.bytes === 83344536 && admission.node.sha256 === '33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b');
  check(admission.preload.bytes === 420 && admission.preload.sha256 === 'eff655db3067b583cf57208f4f607f6255ac7fa52fe162ba67c8b301eb4cd327');
  check(admission.guard.bytes === 3480 && admission.guard.sha256 === '677eae3cfc1c9ad809557f4db5aa984683b5cd65d65bf92f64ebb1bcee2807eb');
  check(Array.isArray(admission.primary) && admission.primary.length === 2);
  const roles = [admission.node, admission.preload, admission.guard, admission.expected, ...admission.primary];
  check(new Set(roles.map(row => key(row.path))).size === roles.length);
  const source = path.resolve(__dirname, '..', PRODUCT);
  allowed = new Set([key(source), key(__filename), key(admission.preload.path), key(admission.guard.path)]);
  check(new Set(admission.primary.map(row => row.repoPath)).size === 2);
  for (const row of admission.primary) {
    check([PRODUCT, SUITE].includes(row.repoPath)); member(row);
    const bytes = capture(row), staged = path.join(admission.runRoot, row.repoPath);
    check(capture({ ...row, path: staged }).equals(bytes));
    check(same(staged, row.repoPath === PRODUCT ? source : __filename));
  }
  const expectedRaw = capture(admission.expected), expected = JSON.parse(decode(expectedRaw));
  assert.equal(expected.contract, 'owner-auth-storage-area-expected-v1');
  assert.deepEqual(expected.groups, GROUPS); assert.deepEqual(expected.baselineFailures, FAILS);
  check(raw.length + expectedRaw.length + admission.primary.reduce((sum, row) => sum + row.bytes, 0) < 64000);
  captured.set(key(process.argv[2]), { path: process.argv[2], bytes: raw });
  check(modulesAdmitted() && !Object.keys(require.cache).some(file => same(file, source)) && stable());
  const guardModule = Object.values(require.cache).find(module => same(module.filename, admission.guard.path));
  check(guardModule && guardModule.exports.stats); guards = guardModule.exports.stats;
  const prior = Object.getOwnPropertyDescriptor(global, 'window');
  try { global.window = {}; require(source); api = global.window.LuminaCreatorApprovedAuthConnection; }
  finally { if (prior) Object.defineProperty(global, 'window', prior); else delete global.window; }
  check(modulesAdmitted() && stable() && typeof api.create === 'function');
}
function protocol() {
  if (process.argv.length !== 2) {
    admittedProtocol(); report.mode = admission.mode; report.admissionSupplied = true;
    return;
  }
  const source = path.resolve(__dirname, '..', PRODUCT);
  allowed = new Set([key(source), key(__filename)]);
  let bytes = 0;
  for (const file of [source, __filename]) {
    ordinary(file); const raw = fs.readFileSync(file);
    check(raw.length > 0); bytes += raw.length;
    captured.set(key(file), { path: file, bytes: raw });
  }
  check(bytes < 64000);
  check(modulesAdmitted() && !Object.keys(require.cache).some(file => same(file, source)) && stable());
  const prior = Object.getOwnPropertyDescriptor(global, 'window');
  try { global.window = {}; require(source); api = global.window.LuminaCreatorApprovedAuthConnection; }
  finally { if (prior) Object.defineProperty(global, 'window', prior); else delete global.window; }
  check(modulesAdmitted() && stable() && typeof api.create === 'function');
}

const ORIGINAL = JSON.stringify({ user: { id: '11111111-1111-4111-8111-111111111111' },
  accessToken: 'synthetic-old-access', refreshToken: 'synthetic-old-refresh' });
const nextReply = () => {
  const tokens = { accessToken: 'synthetic-next-access', refreshToken: 'synthetic-next-refresh', tokenType: 'Bearer' };
  return { user: { id: '11111111-1111-4111-8111-111111111111' }, tokens,
    accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenType: 'Bearer' };
};
const responseRecords = new WeakMap();
let allFixturesClosed = true;
function response(data = nextReply(), status = 200, waiting = false) {
  const record = { cancelled: 0, controller: null, sent: false, bytes: new TextEncoder().encode(JSON.stringify(data)) };
  const stream = new ReadableStream({ start(controller) {
    record.controller = controller;
    if (!waiting) { record.sent = true; controller.enqueue(record.bytes); controller.close(); }
  }, cancel() { record.cancelled++; } });
  const result = new Response(stream, { status, headers: { 'content-type': 'application/json' } });
  responseRecords.set(result, record); return result;
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function store() {
  let raw = ORIGINAL;
  const api = { getItem(key) { assert.equal(key, 'lumina_auth'); return raw; },
    setItem(key, next) { assert.equal(key, 'lumina_auth'); raw = next; } };
  return { api, read: () => raw, replace: value => { raw = value; } };
}
async function use(options, body) {
  const local = store(), session = store(), target = new EventTarget();
  const prior = Object.getOwnPropertyDescriptor(global, 'window'), bindings = new Map(), timers = new Set();
  const nativeSetTimeout = global.setTimeout, nativeClearTimeout = global.clearTimeout;
  global.setTimeout = (callback, delay, ...args) => {
    const handle = nativeSetTimeout(() => { timers.delete(handle); callback(...args); }, delay);
    timers.add(handle); return handle;
  };
  global.clearTimeout = handle => { timers.delete(handle); return nativeClearTimeout(handle); };
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (name, listener) => { if (!bindings.has(name)) bindings.set(name, new Set()); bindings.get(name).add(listener); add(name, listener); };
  target.removeEventListener = (name, listener) => { bindings.get(name)?.delete(listener); if (bindings.get(name)?.size === 0) bindings.delete(name); remove(name, listener); };
  target.localStorage = local.api; target.sessionStorage = session.api;
  global.window = target;
  const selected = options.directSession ? session : local;
  let selectedApi = selected.api;
  if (options.adapter) selectedApi = { getItem: selected.api.getItem.bind(selected.api), setItem: selected.api.setItem.bind(selected.api) };
  let requests = 0, writes = 0, reply, resolved = false, connection, promise, sentSignal, replyResponse;
  const pending = new Promise(resolve => { reply = resolve; });
  const observed = [];
  // Stores and storage event fields are synthetic Node fixtures, not browser Storage.
  const f = {
    local: local.api, session: session.api, target, selected,
    emit(key, area, kind = 'value') {
      const event = new Event('storage'); Object.defineProperty(event, 'key', { value: key });
      if (kind === 'throw') Object.defineProperty(event, 'storageArea', { get() { throw new Error('synthetic unreadable area'); } });
      else if (kind !== 'missing') Object.defineProperty(event, 'storageArea', { value: area });
      target.dispatchEvent(event);
    },
    fire: type => target.dispatchEvent(new Event(type)),
    start(confirmed = true) { promise = connection.connect(confirmed); return promise; },
    connectAgain: confirmed => connection.connect(confirmed),
    resolve(value) { if (!resolved) { resolved = true; replyResponse = requests ? (value === undefined ? response() : value) : null; reply(replyResponse); } },
    releaseBody() { const record = responseRecords.get(replyResponse); check(record && !record.sent); record.sent = true; record.controller.enqueue(record.bytes); record.controller.close(); },
    get responseState() { const record = responseRecords.get(replyResponse); return { cancelled: record?.cancelled ?? 0, locked: replyResponse?.body?.locked ?? false }; },
    get signal() { return sentSignal; },
    get requests() { return requests; }, get writes() { return writes; },
    state: () => connection.state(), dispose: () => connection.dispose(), observed
  };
  const originalSet = selectedApi.setItem.bind(selectedApi);
  if (options.adapter) selectedApi.setItem = (key, value) => { writes++; originalSet(key, value); };
  else selectedApi.setItem = (key, value) => { writes++; originalSet(key, value); };
  try {
    connection = api.create({ ...(options.defaultStore ? {} : { storage: selectedApi }),
      eventTarget: target, deadlineMs: options.deadlineMs || 2000,
      onChange: state => { observed.push(state.phase); },
      fetch(url, request) {
        requests++; sentSignal = request.signal; assert.equal(url, 'https://api.lumina-stage.com/api/v1/auth/refresh');
        assert.equal(request.method, 'POST'); assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
        assert.equal(request.cache, 'no-store'); assert.deepEqual(JSON.parse(request.body), { refreshToken: 'synthetic-old-refresh' });
        return pending;
      } });
    await body(f);
  } finally {
    try {
      if (connection) connection.dispose();
      f.resolve(); if (promise) await Promise.allSettled([promise]); await flush();
      assert.equal(bindings.size, 0); assert.equal(timers.size, 0);
      if (sentSignal) assert.equal(sentSignal.aborted, true);
      if (replyResponse?.body) {
        assert.equal(replyResponse.body.locked, false);
        const reader = replyResponse.body.getReader();
        try { assert.equal((await reader.read()).done, true); await reader.cancel(); }
        finally { reader.releaseLock(); }
        assert.equal(replyResponse.body.locked, false);
      }
    } catch (error) { allFixturesClosed = false; throw error; }
    finally {
      for (const handle of timers) nativeClearTimeout(handle);
      global.setTimeout = nativeSetTimeout; global.clearTimeout = nativeClearTimeout;
      if (prior) Object.defineProperty(global, 'window', prior); else delete global.window;
    }
  }
}
async function succeeds(f, action) {
  const pending = f.start(); assert.equal(f.requests, 1); action();
  f.resolve(); assert.equal(await pending, true); assert.equal(f.state().phase, 'connected');
  assert.equal(f.writes, 1); assert.notEqual(f.selected.read(), ORIGINAL);
}
async function retires(f, action) {
  const pending = f.start(); assert.equal(f.requests, 1); action(); assert.equal(f.signal.aborted, true); f.resolve();
  assert.equal(await pending, false); await flush(); assert.equal(f.writes, 0);
  assert.equal(f.selected.read(), ORIGINAL); assert.equal(f.state().phase, 'uncertain');
  assert.equal(f.responseState.locked, false); assert.ok(f.responseState.cancelled >= 1);
  assert.equal(await f.connectAgain(true), false); assert.equal(f.requests, 1);
}
const bodies = [
  async () => {
    for (const key of ['lumina_auth', null]) await use({ defaultStore: true }, f => succeeds(f, () => f.emit(key, f.session)));
    await use({ defaultStore: true }, f => succeeds(f, () => f.emit('unrelated-key', f.local)));
    await use({ defaultStore: true }, async f => {
      const pending = f.start(); f.resolve(response(nextReply(), 200, true)); await flush();
      assert.equal(f.responseState.locked, true); f.emit(null, f.session);
      assert.equal(f.signal.aborted, false); f.releaseBody(); assert.equal(await pending, true);
      assert.equal(f.writes, 1); assert.equal(f.responseState.locked, false);
    });
  },
  async () => {
    await use({ directSession: true }, f => succeeds(f, () => f.emit('lumina_auth', f.local)));
    await use({}, f => succeeds(f, () => f.emit(null, f.session)));
    await use({ adapter: true }, f => retires(f, () => f.emit('lumina_auth', f.session)));
    await use({ directSession: true }, f => retires(f, () => f.emit(null, f.session)));
  },
  async () => {
    for (const key of ['lumina_auth', null]) {
      await use({}, f => retires(f, () => f.emit(key, f.local)));
      await use({}, f => retires(f, () => { f.selected.replace(null); f.selected.replace(ORIGINAL); f.emit(key, f.local); }));
    }
    await use({}, f => retires(f, () => { f.selected.replace('synthetic-B'); f.selected.replace(ORIGINAL); f.emit('lumina_auth', f.local); }));
  },
  async () => {
    for (const area of [undefined, null, {}, 1, 'session']) await use({}, f => retires(f, () => f.emit('lumina_auth', area)));
    await use({}, f => retires(f, () => f.emit('lumina_auth', undefined, 'missing')));
    await use({}, f => retires(f, () => f.emit('lumina_auth', undefined, 'throw')));
    await use({}, f => retires(f, () => { Object.defineProperty(f.target, 'sessionStorage', { get() { throw new Error('synthetic denied native storage'); } }); f.emit(null, f.session); }));
    await use({}, f => retires(f, () => { f.target.sessionStorage = f.local; f.emit(null, f.local); }));
    for (const name of ['localStorage', 'sessionStorage']) for (const value of [undefined, null, 1]) {
      await use({}, f => retires(f, () => { f.target[name] = value; f.emit(null, f.session); }));
    }
    await use({}, f => retires(f, () => { Object.defineProperty(f.target, 'localStorage', { get() { throw new Error('synthetic denied local storage'); } }); f.emit(null, f.session); }));
  },
  async () => use({}, async f => {
    assert.equal(await f.start(false), false); assert.equal(await f.connectAgain('true'), false);
    assert.equal(f.requests, 0); assert.equal(f.writes, 0);
    const pending = f.start(true); assert.equal(await f.connectAgain(true), false); assert.equal(f.requests, 1);
    f.resolve(); assert.equal(await pending, true); assert.equal(await f.connectAgain(true), false); assert.equal(f.requests, 1);
  }),
  async () => {
    await use({}, async f => { const pending = f.start(); f.fire('pagehide'); f.resolve(); assert.equal(await pending, false); await flush(); assert.equal(f.state().phase, 'disposed'); assert.equal(f.writes, 0); assert.equal(f.selected.read(), ORIGINAL); });
    await use({}, async f => { const pending = f.start(); f.selected.replace('synthetic-owner-changed'); f.resolve(); assert.equal(await pending, false); await flush(); assert.equal(f.writes, 0); assert.equal(f.selected.read(), 'synthetic-owner-changed'); assert.equal(await f.connectAgain(true), false); assert.equal(f.requests, 1); });
    await use({}, f => retires(f, () => f.fire('lumina:authchange')));
    await use({}, f => retires(f, () => f.fire('lumina:auth-expired')));
    await use({}, async f => {
      const pending = f.start(); const replacement = JSON.stringify({ user: { id: '22222222-2222-4222-8222-222222222222' },
        accessToken: 'synthetic-new-owner-access', refreshToken: 'synthetic-new-owner-refresh' });
      f.selected.replace(replacement); f.resolve(); assert.equal(await pending, false); await flush();
      assert.equal(f.writes, 0); assert.equal(f.selected.read(), replacement); assert.equal(f.signal.aborted, true);
    });
    await use({}, async f => {
      const pending = f.start(); f.resolve(response(nextReply(), 200, true)); await flush();
      assert.equal(f.responseState.locked, true); f.emit('lumina_auth', f.local); assert.equal(f.signal.aborted, true);
      assert.equal(await pending, false); await flush();
      assert.equal(f.responseState.locked, false); assert.ok(f.responseState.cancelled >= 1); assert.equal(f.writes, 0);
      assert.throws(() => f.releaseBody(), TypeError);
    });
  },
  async () => {
    await use({}, async f => { const pending = f.start(); f.resolve(response({}, 401)); assert.equal(await pending, false); assert.equal(f.state().phase, 'rejected'); assert.equal(f.writes, 0); assert.equal(f.selected.read(), ORIGINAL); });
    await use({}, async f => { const pending = f.start(); const reply = nextReply(); reply.user.id = '22222222-2222-4222-8222-222222222222'; f.resolve(response(reply)); assert.equal(await pending, false); assert.equal(f.state().phase, 'uncertain'); assert.equal(f.writes, 0); assert.equal(f.selected.read(), ORIGINAL); });
    await use({}, async f => { const pending = f.start(); f.resolve(response({ tokens: {} })); assert.equal(await pending, false); assert.equal(f.state().phase, 'uncertain'); assert.equal(f.writes, 0); });
  },
  async () => use({ deadlineMs: 25 }, async f => {
    const pending = f.start(); assert.equal(await pending, false); f.resolve(); await flush();
    assert.equal(f.state().phase, 'uncertain'); assert.equal(f.writes, 0); assert.equal(f.selected.read(), ORIGINAL);
    assert.equal(f.signal.aborted, true); assert.equal(f.responseState.locked, false); assert.ok(f.responseState.cancelled >= 1);
    assert.equal(await f.connectAgain(true), false); assert.equal(f.requests, 1);
  })
];
async function main() {
  protocol();
  for (let i = 0; i < GROUPS.length; i++) await test(GROUPS[i], { concurrency: false }, async () => {
    try { await bodies[i](); report.passed++; } catch (error) { report.failed++; report.failedGroups.push(GROUPS[i]); throw error; }
    finally { report.groups.push(GROUPS[i]); }
  });
  report.inputsStable = stable(); report.moduleAllowlistVerified = modulesAdmitted();
  report.fixtureResourcesClosed = allFixturesClosed;
  report.loadedModulesAdmitted = !!admission && report.moduleAllowlistVerified;
  report.resourcesClosed = admission ? allFixturesClosed : null;
  if (guards) {
    report.nativeGuards = { ...guards };
    check(Object.values(guards).every(value => Number.isSafeInteger(value) && value === 0));
  }
  report.complete = report.groups.length === GROUPS.length && report.inputsStable && report.moduleAllowlistVerified && allFixturesClosed && (!admission || now() < admission.deadlineUtcMs);
  if (!report.complete || report.failed) process.exitCode = 1;
  process.stdout.write('OWNER_AUTH_STORAGE_AREA_RESULT ' + JSON.stringify(report) + '\n');
}
main().catch(() => { report.complete = false; process.exitCode = 1; process.stderr.write('OWNER_AUTH_STORAGE_AREA_NOT_QUALIFIED\n'); process.stdout.write('OWNER_AUTH_STORAGE_AREA_RESULT ' + JSON.stringify(report) + '\n'); });

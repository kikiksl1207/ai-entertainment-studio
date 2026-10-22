'use strict';
// AUTHOR UNRUN. Whole standalone consumer; explicit DOM/UI/API doubles only.
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), vm = require('node:vm');
const output = process.stdout;
void process.stderr;
const PLAN = [
  ['current-states', ['success', 'empty', 'forbidden', 'http-error', 'malformed-items', 'json-rejection', 'fetch-rejection', 'active-entry']],
  ['same-owner-success', ['late-headers', 'late-json']],
  ['stale-error-empty', ['http-error', 'forbidden', 'empty', 'json-rejection', 'fetch-rejection', 'malformed-items']],
  ['attempt-identity', ['same-context', 'three-load-aba']],
  ['owner-epoch', ['owner', 'epoch', 'logout', 'provider-rejection']],
  ['request-options', ['captured-identity']],
  ['controlled-reentry', ['after-loading', 'after-current-user', 'current-user-new-load']],
  ['locale-explicit-next', ['locale-rerender', 'auth-event-no-get', 'next-after-stale']],
  ['display-current-cache', ['current-events-refresh']],
  ['display-owner-retirement', ['storage', 'authchange', 'focus', 'locale', 'next-load']],
  ['display-context-retirement', ['logout', 'epoch', 'predicate-throw']],
  ['display-retirement-reentry', ['starts-new-pending']]
];
const GROUPS = PLAN.map(p => p[0]);
const EXPECTED = { contract: 'content-rights-display-retirement-expected-v1', groups: GROUPS,
  baselineFailures: GROUPS.slice(9) };
const REPO = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const BASE = REPO + '/qa/20261022-content-rights-display-retirement';
const SOURCE = 'pages/creator-content-rights.js', ORACLE = 'tests/content-rights-load-request-context.test.cjs';
const CODE = {
  baseline: [4611, '52fc789e2cc87eedb8aa107e209f24a4486f6728f3a463ba7cef3dba7b9bd0be'],
  candidate: [5341, 'f355d477b1bf00c2e78633c48a566d38f5632ef81b59e838947de35ed17f6554']
};
const SUPPORT = [
  [REPO + '/qa/20261021-night-studio-video-workspace/workspace-unit-preload.cjs', 420,
    'eff655db3067b583cf57208f4f607f6255ac7fa52fe162ba67c8b301eb4cd327'],
  [REPO + '/server/scripts/release-qa-guards.cjs', 3480,
    '677eae3cfc1c9ad809557f4db5aa984683b5cd65d65bf92f64ebb1bcee2807eb']
];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const norm = p => path.resolve(p).replace(/\\/g, '/');
const need = (ok, id) => { if (!ok) throw new Error(id); };
const shape = (o, keys) => o && Object.keys(o).sort().join('|') === keys.split(' ').sort().join('|');
const decode = b => new TextDecoder('utf-8', { fatal: true }).decode(b);
const json = b => JSON.parse(decode(b));
function read(p) {
  for (let q = path.resolve(p);;) {
    need(!fs.lstatSync(q).isSymbolicLink(), 'ordinary');
    const next = path.dirname(q); if (next === q) break; q = next;
  }
  need(fs.statSync(p).isFile(), 'file'); return fs.readFileSync(p);
}
function pin(r, primary = false) {
  need(shape(r, 'path bytes sha256' + (primary ? ' repoPath' : '')) && typeof r.path === 'string' &&
    /^[eE]:[\\/]/.test(r.path) && Number.isSafeInteger(r.bytes) && r.bytes > 0 && /^[a-f0-9]{64}$/.test(r.sha256), 'pin-shape');
  const b = read(r.path); need(b.length === r.bytes && hash(b) === r.sha256, 'pin-content'); return b;
}
let admission, supplied = process.argv.length > 2, mode = supplied ? 'invalid' : 'ci';
let root, raw, code, guard, allPinnedText = 0, stableChecks = [], cacheAllow = [norm(__filename)];
let complete = false, inputsStable = false, modules = false, fixturesClosed = true;
let nativeGuards = null, resourcesClosed = null, handles, requests, rejectionListeners;
const errors = [], cases = [], failed = new Set();
function deadline() {
  if (admission) need(Number.isSafeInteger(admission.deadlineUtcMs) && Date.now() < admission.deadlineUtcMs, 'deadline');
}
const cacheOK = () => Object.keys(require.cache).length === cacheAllow.length &&
  Object.keys(require.cache).every(p => cacheAllow.includes(norm(p)));
function setup() {
  root = norm(path.resolve(__dirname, '..')); need(!process.env.NODE_OPTIONS, 'node-options');
  if (!supplied) {
    need(process.argv.length === 2 && process.env.CI === 'true' && process.execArgv.length === 0, 'ci-entry');
    const file = root + '/' + SOURCE, self = read(__filename); raw = read(file); code = decode(raw);
    need(!code.startsWith('\ufeff') && !/\r(?!\n)/.test(code) &&
      (!code.includes('\r') || !/(^|[^\r])\n/.test(code)), 'ci-line-endings');
    code = code.replace(/\r\n/g, '\n');
    need(Object.values(CODE).some(([n, h]) => Buffer.byteLength(code) === n && hash(code) === h), 'ci-whole-code');
    stableChecks = [() => hash(read(file)) === hash(raw), () => hash(read(__filename)) === hash(self)];
    allPinnedText = raw.length + self.length;
  } else {
    need(process.argv.length === 4 && /^[a-f0-9]{64}$/.test(process.argv[3]) &&
      norm(path.dirname(root)) === BASE && /^owned-first-[a-f0-9]{12}$/.test(path.basename(root)) &&
      norm(process.argv[2]) === root + '/admission.json', 'native-entry');
    const ab = read(process.argv[2]); need(ab.length <= 32768 && hash(ab) === process.argv[3], 'admission-hash');
    const a = admission = json(ab);
    need(shape(a, 'contract mode deadlineUtcMs runRoot node preload guard expected primary pins') &&
      a.contract === 'content-rights-display-retirement-admission-v1' && ['baseline', 'candidate'].includes(a.mode) &&
      norm(a.runRoot) === root, 'admission-shape');
    mode = a.mode; deadline(); need(a.deadlineUtcMs <= Date.now() + 120000, 'deadline-range');
    need(Array.isArray(a.primary) && a.primary.length === 2 && Array.isArray(a.pins) && a.pins.length === 6, 'roles');
    const wanted = [mode === 'baseline' ? BASE + '/baseline/' + SOURCE : BASE + '/candidate/' + SOURCE,
      BASE + '/' + ORACLE];
    need(a.primary.every((r, i) => norm(r.path) === wanted[i] && r.repoPath === [SOURCE, ORACLE][i]), 'primary-order');
    need(norm(a.expected.path) === BASE + '/expected.json', 'expected-path');
    for (const [i, role] of ['preload', 'guard'].entries()) {
      const r = a[role], s = SUPPORT[i];
      need(norm(r.path) === s[0] && r.bytes === s[1] && r.sha256 === s[2], 'support-identity');
    }
    need(norm(a.node.path) === 'E:/Program Files/nodejs/node.exe' && norm(process.execPath) === norm(a.node.path) &&
      a.node.bytes === 83344536 && a.node.sha256 === '33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b', 'node-identity');
    const rows = [...a.primary, a.expected, a.preload, a.guard];
    const ctrl = a.pins.find(r => norm(r.path) === BASE + '/run-first.ps1');
    need(ctrl && new Set([...rows, ctrl, a.node].map(r => norm(r.path).toLowerCase())).size === 7 &&
      new Set(a.pins.map(r => norm(r.path).toLowerCase())).size === 6, 'role-uniqueness');
    need(a.pins.every(r => [...rows, ctrl].some(x => norm(x.path) === norm(r.path) && x.bytes === r.bytes && x.sha256 === r.sha256)), 'pin-roles');
    a.pins.forEach(r => pin(r)); pin(a.node);
    need(JSON.stringify(json(pin(a.expected))) === JSON.stringify(EXPECTED), 'expected-contract');
    a.primary.forEach(r => {
      pin(r, true); const b = read(root + '/' + r.repoPath);
      need(b.length === r.bytes && hash(b) === r.sha256, 'staged-primary');
      stableChecks.push(() => hash(read(root + '/' + r.repoPath)) === r.sha256);
    });
    raw = read(root + '/' + SOURCE);
    need(raw.length === CODE[mode][0] && hash(raw) === CODE[mode][1], 'whole-code-identity'); code = decode(raw);
    need(process.execArgv.length === 2 && ['--require', '-r'].includes(process.execArgv[0]) &&
      norm(process.execArgv[1]) === norm(a.preload.path), 'native-preload');
    cacheAllow.push(norm(a.preload.path), norm(a.guard.path));
    guard = require.cache[require.resolve(a.guard.path)]?.exports?.stats;
    need(guard && shape(guard, 'blockedEnvReads blockedNetwork blockedWrites'), 'native-stats');
    allPinnedText = ab.length + a.pins.reduce((n, r) => n + r.bytes, 0);
    stableChecks.push(() => hash(read(process.argv[2])) === process.argv[3],
      () => { a.pins.forEach(r => pin(r)); pin(a.node); return true; });
  }
  need(allPinnedText < 64000 && cacheOK(), 'whole-budget-modules');
  handles = process._getActiveHandles(); requests = process._getActiveRequests();
  rejectionListeners = process.listeners('unhandledRejection');
}
function causeOf(error) {
  const c = { name: typeof error?.name === 'string' ? error.name : 'NonError',
    message: typeof error?.message === 'string' ? error.message :
      typeof error === 'string' ? error : 'Non-Error throw without a string message' };
  if (typeof error?.code === 'string' || typeof error?.code === 'number') c.code = error.code;
  return c;
}
const ENDPOINT = '/api/v1/me/creator-studio/content-rights-contracts';
const OWNER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const WORK = '33333333-3333-4333-8333-333333333333';
const IDS = ['contentRightsState', 'contentRightsList', 'contentRightsNavLabel', 'contentRightsTitle', 'contentRightsIntro',
  'contentRightsRefresh', 'contentRightsPendingNotice', 'legacySettlementIsolation', 'content-rights'];
function fixture(active = false) {
  const f = { owner: OWNER, epoch: 1, locale: 'ko', calls: [], issued: [], tasks: new Set(), buses: [],
    views: new Map(), rejections: [], expectedFaults: [], currentHook: null, userHook: null, loadingHook: null,
    hookRuns: 0, wire: true, partyCalls: 0, context: null, target: null };
  const current = identity => !!identity?.ownerId && identity.ownerId === f.owner && identity.epoch === f.epoch;
  const identity = () => ({ ownerId: f.owner, epoch: f.epoch });
  const track = p => {
    if (p && typeof p.then === 'function') {
      f.tasks.add(p); p.then(() => f.tasks.delete(p), e => { f.tasks.delete(p); f.rejections.push(causeOf(e)); });
    }
    return p;
  };
  function bus() {
    const listeners = new Map();
    const b = {
      addEventListener(k, fn) {
        need(['click', 'lumina:localechange', 'storage', 'lumina:authchange', 'focus'].includes(k), 'fixture-event');
        if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn);
      },
      removeEventListener(k, fn) { listeners.get(k)?.delete(fn); },
      emit(k) { for (const fn of [...(listeners.get(k) || [])]) track(fn({ preventDefault() {} })); },
      count(k) { return k ? (listeners.get(k)?.size || 0) : [...listeners.values()].reduce((n, s) => n + s.size, 0); },
      clear() { listeners.clear(); }
    }; f.buses.push(b); return b;
  }
  function node(id) {
    let text = '';
    return Object.assign(bus(), { innerHTML: '', hidden: false,
      classList: { contains: k => k === 'is-active' && id === 'content-rights' && active },
      get textContent() { return text; }, set textContent(v) { text = v; }
    });
  }
  f.nodes = Object.fromEntries(IDS.map(id => [id, node(id)]));
  let stateText = '';
  Object.defineProperty(f.nodes.contentRightsState, 'textContent', {
    get: () => stateText, set(v) {
      stateText = v;
      if (v === f.locale + ':loading' && f.loadingHook) { const h = f.loadingHook; f.loadingHook = null; h(); }
    }
  });
  f.win = bus(); f.doc = { getElementById: id => f.nodes[id] || null };
  f.status = () => f.nodes.contentRightsState.textContent;
  f.html = () => f.nodes.contentRightsList.innerHTML;
  f.board = () => JSON.stringify([f.status(), f.html()]);
  f.escape = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  f.ui = { t: key => f.locale + ':' + key, esc: f.escape, percent: () => 'fixture-share', date: () => 'fixture-date',
    partyView(item, userId) {
      f.partyCalls++; need(f.views.has(item), 'unregistered-ui-fixture');
      return f.views.get(item).get(userId) || null;
    } };
  // Closed raw-item -> prepared-view tables, NOT a generic partyView algorithm.
  f.data = (name, revisions = 1, owner = f.owner) => {
    const rawVersions = [], viewVersions = [];
    for (let revision = 1; revision <= revisions; revision++) {
      const common = { id: 'fixture-version-' + revision, revision, contentVersionId: name + '-content-' + revision,
        exclusivity: 'nonexclusive', media: ['stream_video'], regions: ['KR'], startsAt: '2026-10-22T00:00:00.000Z',
        endsAt: null, effectiveFrom: '2026-10-22T00:00:00.000Z', approvalState: 'draft',
        saleAllowed: false, aiTransformationAllowed: false, generatedResultReuseAllowed: false };
      rawVersions.push({ ...common, parties: [{ userId: owner, role: 'author', shareBps: 0, agencyIdentifier: null }] });
      viewVersions.push({ ...common, role: 'author', agencyIdentifier: null, ownBps: 0 });
    }
    const item = { id: name, workId: WORK, workType: 'story', versions: rawVersions };
    const view = { id: name, workId: WORK, workType: 'story', versions: viewVersions };
    f.views.set(item, new Map([[owner, view]])); return { items: [item] };
  };
  const fault = (name, message, code) => {
    const e = Object.assign(new Error(message), { name, code }); f.expectedFaults.push(causeOf(e)); return e;
  };
  const stale = () => fault('AbortError', 'Context changed', 'FIXTURE_CONTEXT');
  f.api = {
    identity() { const value = identity(); f.issued.push(value); return value; },
    isCurrent(value) {
      if (f.currentHook) { const h = f.currentHook; f.currentHook = null; h(); }
      return current(value);
    },
    currentUser() {
      if (f.userHook) { const h = f.userHook; f.userHook = null; h(); }
      return f.owner ? { id: f.owner } : null;
    },
    fetch(url, options = {}) {
      const suppliedIdentity = options.identity, captured = suppliedIdentity || identity();
      f.wire = f.wire && url === ENDPOINT && typeof options === 'object' && options !== null &&
        Object.keys(options).every(k => k === 'identity');
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const c = { url, options, suppliedIdentity, captured: { ...captured }, ownerAtCall: f.owner, epochAtCall: f.epoch,
        resolve, reject, done: false, jsonRead: false, jsonDone: true };
      f.calls.push(c);
      if (!current(captured)) { c.done = true; reject(stale()); }
      return promise;
    }
  };
  f.win.LuminaContentRightsUI = f.ui; f.win.LuminaCreatorStudioApi = f.api;
  f.context = vm.createContext({ window: f.win, document: f.doc }, { codeGeneration: { strings: false, wasm: false } });
  const unhandled = e => f.rejections.push(causeOf(e));
  process.on('unhandledRejection', unhandled);
  f.loadSource = () => { new vm.Script(code, { filename: SOURCE }).runInContext(f.context, { timeout: 1000 }); f.target = f.win.LuminaCreatorContentRights; };
  f.load = () => track(f.target.load());
  f.click = () => f.nodes.contentRightsRefresh.emit('click');
  f.tick = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  f.reply = (c, data, kind = 'ok') => {
    need(c && !c.done, 'fixture-response'); c.done = true;
    if (!current(c.captured)) { c.reject(stale()); return; }
    if (kind === 'fetch-rejection') { c.reject(fault('FixtureFetchError', 'synthetic-fetch-failure', 'FIXTURE_FETCH')); return; }
    const status = kind === 'forbidden' ? 403 : kind === 'http-error' ? 500 : 200;
    c.resolve({ ok: status === 200, status, json() {
      c.jsonRead = true;
      if (kind === 'hold') { c.jsonDone = false; return new Promise(resolve => { c.jsonResolve = resolve; }); }
      if (kind === 'json-rejection') return Promise.reject(fault('FixtureJSONError', 'synthetic-json-failure', 'FIXTURE_JSON'));
      return Promise.resolve(data);
    } });
  };
  f.json = (c, data) => { need(c?.jsonRead && !c.jsonDone, 'fixture-json'); c.jsonDone = true; c.jsonResolve(data); };
  f.drain = async () => {
    for (let i = 0; i < 64; i++) {
      for (const c of f.calls) {
        if (!c.done) f.reply(c, { items: [] }); else if (!c.jsonDone) f.json(c, { items: [] });
      }
      await f.tick();
      if (f.calls.every(c => c.done && c.jsonDone) && !f.tasks.size) return;
    }
    throw new Error('fixture-drain-not-closed');
  };
  f.dispose = async () => {
    f.currentHook = f.userHook = f.loadingHook = null;
    try { await f.drain(); await new Promise(resolve => setImmediate(resolve)); }
    finally {
      process.removeListener('unhandledRejection', unhandled); f.buses.forEach(b => b.clear());
      f.views.clear(); f.issued.length = 0; f.owner = null; f.target = f.context = null;
      f.win.LuminaCreatorContentRights = null;
    }
    return !f.tasks.size && !f.rejections.length && f.calls.every(c => c.done && c.jsonDone) &&
      f.buses.every(b => !b.count()) && !f.views.size && !f.issued.length && !f.target && !f.context &&
      !f.currentHook && !f.userHook && !f.loadingHook && !process.listeners('unhandledRejection').includes(unhandled);
  };
  return f;
}
let group;
async function scenario(name, body, active = false) {
  const row = { group, case: name, checks: [], rejections: [], finished: false }; cases.push(row); let f;
  const check = (ok, id, ...cause) => {
    const entry = { id, ok: !!ok }; if (cause.length) entry.cause = causeOf(cause[0]); row.checks.push(entry);
    if (!ok) { failed.add(group); errors.push({ group, case: name, check: id, ...(entry.cause ? { cause: entry.cause } : {}) }); }
  };
  try { deadline(); f = fixture(active); row.rejections = f.rejections; f.loadSource(); await body(f, check); row.finished = true; }
  catch (e) { check(false, 'scenario-exception', e); }
  finally {
    if (f) {
      try { const closed = await f.dispose(); fixturesClosed = fixturesClosed && closed; check(closed, 'fixture-closed'); }
      catch (e) { fixturesClosed = false; check(false, 'cleanup-exception', e); }
      check(f.wire, 'closed-api-contract'); row.gets = f.calls.length;
      if (f.expectedFaults.length) row.expectedFaults = f.expectedFaults;
    } else { fixturesClosed = false; check(false, 'fixture-not-created'); }
  }
}
async function seed(f, check) {
  check(!f.calls.length, 'inactive-entry-no-get'); f.load();
  check(f.status() === 'ko:loading' && f.calls.length === 1, 'explicit-loading');
  f.reply(f.calls[0], f.data('seed')); await f.tick(); need(f.html().includes('seed-content-1') && f.status() === '', 'fixture-seed');
}
async function newest(f, c, name = 'newest') { f.reply(c, f.data(name, 2)); await f.tick(); return f.board(); }
async function exercise() {
  group = GROUPS[0];
  for (const name of PLAN[0][1]) await scenario(name, async (f, check) => {
    check(f.calls.length === (name === 'active-entry' ? 1 : 0), 'entry-activation-rule');
    if (name !== 'active-entry') f.click();
    check(f.status() === 'ko:loading' && f.calls.length === 1, 'one-explicit-loading');
    const data = name === 'empty' ? { items: [] } : name === 'malformed-items' ? { items: {} } : f.data('normal<&', 2);
    f.reply(f.calls[0], data, ['forbidden', 'http-error', 'json-rejection', 'fetch-rejection'].includes(name) ? name : 'ok'); await f.tick();
    const success = name === 'success' || name === 'active-entry';
    check(f.status() === (success ? '' : name === 'empty' ? 'ko:empty' : name === 'forbidden' ? 'ko:forbidden' : 'ko:error'), 'current-outcome');
    check(success ? f.html().includes('normal&lt;&amp;-content-2') && f.html().indexOf('normal&lt;&amp;-content-2') < f.html().indexOf('normal&lt;&amp;-content-1') :
      f.html().includes('content-rights-empty') && !f.html().includes('content-rights-contract'), 'current-render-clear-or-revisions');
    if (success) check(f.html().includes('fixture-share') && f.html().includes('fixture-date') &&
      f.nodes.contentRightsPendingNotice.innerHTML.includes('ko:pendingBody') &&
      f.nodes.legacySettlementIsolation.innerHTML.includes('ko:legacyBody'), 'existing-ui-delegation');
  }, name === 'active-entry');
  group = GROUPS[1];
  for (const name of PLAN[1][1]) await scenario(name, async (f, check) => {
    await seed(f, check); f.load(); const old = f.calls.at(-1);
    if (name === 'late-json') { f.reply(old, null, 'hold'); await f.tick(); check(old.jsonRead, 'old-json-pending'); }
    f.load(); const latest = f.calls.at(-1);
    check(latest !== old && latest.captured.ownerId === old.captured.ownerId && latest.captured.epoch === old.captured.epoch, 'same-owner-epoch-overlap');
    const before = await newest(f, latest);
    if (name === 'late-json') f.json(old, f.data('obsolete')); else f.reply(old, f.data('obsolete'));
    await f.tick(); check(f.board() === before && !f.html().includes('obsolete'), 'older-success-no-commit');
  });
  group = GROUPS[2];
  for (const name of PLAN[2][1]) await scenario(name, async (f, check) => {
    await seed(f, check); f.load(); const old = f.calls.at(-1);
    f.load(); const before = await newest(f, f.calls.at(-1));
    const data = name === 'malformed-items' ? { items: {} } : { items: [] };
    f.reply(old, data, ['http-error', 'forbidden', 'json-rejection', 'fetch-rejection'].includes(name) ? name : 'ok'); await f.tick();
    check(f.board() === before && f.status() === '', 'old-error-empty-no-clear');
  });
  group = GROUPS[3];
  for (const name of PLAN[3][1]) await scenario(name, async (f, check) => {
    await seed(f, check); const start = f.calls.length; f.load(); f.load();
    if (name === 'three-load-aba') f.load();
    const attempts = f.calls.slice(start), count = name === 'same-context' ? 2 : 3;
    check(attempts.length === count && attempts.every(c => c.captured.ownerId === OWNER && c.captured.epoch === 1), 'distinct-identical-context-attempts');
    const before = await newest(f, attempts.at(-1), 'final-a');
    for (const [i, c] of attempts.slice(0, -1).reverse().entries()) {
      f.reply(c, f.data(name === 'three-load-aba' && i === 0 ? 'middle-b' : 'old-a')); await f.tick();
      check(f.board() === before, 'each-older-attempt-no-commit-' + i);
    }
  });
  group = GROUPS[4];
  for (const name of PLAN[4][1]) await scenario(name, async (f, check) => {
    await seed(f, check); f.load(); const old = f.calls.at(-1);
    if (name !== 'provider-rejection') { f.reply(old, null, 'hold'); await f.tick(); check(old.jsonRead, 'headers-before-context-change'); }
    f.epoch++; if (name === 'owner' || name === 'provider-rejection') f.owner = OTHER; else if (name === 'logout') f.owner = null;
    let before = f.board();
    if (name === 'provider-rejection') { f.load(); before = await newest(f, f.calls.at(-1)); f.reply(old, f.data('obsolete', 1, OWNER)); }
    else f.json(old, f.data('obsolete', 1, OWNER));
    await f.tick(); check(f.board() === before && !f.html().includes('obsolete'), 'retired-owner-epoch-no-commit');
    const total = f.calls.length; f.win.emit('lumina:authchange'); await f.tick(); check(f.calls.length === total, 'no-added-auth-event-get');
  });
  group = GROUPS[5];
  await scenario('captured-identity', async (f, check) => {
    f.load(); const c = f.calls[0]; need(c, 'identity-call');
    check(shape(c.options, 'identity') && f.issued.includes(c.suppliedIdentity) && c.suppliedIdentity?.ownerId === OWNER &&
      c.suppliedIdentity?.epoch === 1 && c.ownerAtCall === OWNER && c.epochAtCall === 1 && c.url === ENDPOINT, 'exact-offered-identity-only');
    f.reply(c, f.data('identity')); await f.tick(); check(f.status() === '' && f.html().includes('identity-content-1'), 'identity-request-renders');
  });
  group = GROUPS[6];
  for (const name of PLAN[6][1]) await scenario(name, async (f, check) => {
    await seed(f, check); const start = f.calls.length;
    const reenter = () => { f.hookRuns++; f.load(); };
    if (name === 'after-loading') {
      f.loadingHook = () => { f.currentHook = reenter; }; f.load();
      const calls = f.calls.slice(start);
      check(f.hookRuns === 1, 'controlled-currentness-callback-exercised');
      check(calls.length === 1, 'superseded-before-dispatch');
      if (calls[0]) { const before = await newest(f, calls[0]);
        for (const c of calls.slice(1)) f.reply(c, f.data('obsolete')); await f.tick(); check(f.board() === before, 'reentrant-old-no-final-overwrite'); }
      return;
    }
    f.userHook = name === 'after-current-user' ? () => { f.currentHook = reenter; } : reenter;
    f.load(); const old = f.calls.at(-1); f.reply(old, f.data('obsolete')); await f.tick();
    check(f.hookRuns === 1 && f.calls.length === start + 2, 'controlled-new-load-during-read');
    check(f.status() === 'ko:loading' && !f.html().includes('obsolete'), 'older-return-cannot-overwrite-new-loading');
    const latest = f.calls.at(-1);
    if (latest !== old && !latest.done) { await newest(f, latest); check(f.html().includes('newest-content-2'), 'reentrant-explicit-load-completes'); }
  });
  group = GROUPS[7];
  for (const name of PLAN[7][1]) await scenario(name, async (f, check) => {
    await seed(f, check); const total = f.calls.length;
    if (name === 'locale-rerender') {
      f.locale = 'en'; f.win.emit('lumina:localechange'); await f.tick();
      check(f.calls.length === total && f.html().includes('seed-content-1') && f.html().includes('en:contract') &&
        f.nodes.contentRightsTitle.textContent === 'en:title', 'locale-retains-current-data-without-get'); return;
    }
    f.owner = OTHER; f.epoch++; f.win.emit('lumina:authchange'); await f.tick();
    check(f.calls.length === total, 'auth-event-alone-no-new-request');
    if (name === 'next-after-stale') {
      f.load(); const old = f.calls.at(-1); f.reply(old, null, 'hold'); await f.tick();
      f.epoch++; const before = f.calls.length; f.json(old, f.data('old-context')); await f.tick();
      check(f.calls.length === before, 'late-json-no-automatic-retry-or-auth');
    }
    f.click(); const c = f.calls.at(-1);
    check(f.calls.length === (name === 'next-after-stale' ? total + 2 : total + 1), 'next-explicit-request-allowed');
    await newest(f, c, 'explicit-next'); check(f.html().includes('explicit-next-content-2') && f.status() === '', 'next-current-result');
  });
  group = GROUPS[8];
  await scenario('current-events-refresh', async (f, check) => {
    await seed(f, check); const total = f.calls.length, before = f.html();
    const events = ['storage', 'lumina:authchange', 'focus'];
    for (const event of events) { f.win.emit(event); await f.tick();
      check(f.calls.length === total && f.html() === before, 'current-observation-retains-' + event); }
    f.load(); const c = f.calls.at(-1);
    check(f.calls.length === total + 1 && f.status() === 'ko:loading' && f.html() === before, 'current-refresh-keeps-cache');
    f.reply(c, null, 'hold'); await f.tick();
    for (const event of events) f.win.emit(event);
    f.locale = 'en'; f.win.emit('lumina:localechange'); await f.tick();
    check(c.jsonRead && f.calls.length === total + 1 && f.status() === 'ko:loading' &&
      f.html().includes('seed-content-1') && f.html().includes('en:contract'), 'pending-current-cache-locale-no-get');
    f.json(c, f.data('refreshed')); await f.tick();
    check(f.status() === '' && f.html().includes('refreshed-content-1'), 'current-refresh-completes');
  });
  group = GROUPS[9];
  for (const name of PLAN[9][1]) await scenario(name, async (f, check) => {
    await seed(f, check); const total = f.calls.length; f.owner = OTHER; f.epoch++;
    const event = name === 'locale' ? 'lumina:localechange' : name === 'authchange' ? 'lumina:authchange' : name === 'next-load' ? 'focus' : name;
    if (name === 'locale') f.locale = 'en';
    if (name === 'next-load') f.load(); else f.win.emit(event);
    await f.tick();
    check(f.calls.length === total + (name === 'next-load' ? 1 : 0), 'observation-does-not-dispatch');
    check(!f.html().includes('seed-content-1'), 'accepted-old-owner-display-retired');
    if (name !== 'next-load') f.load(); const c = f.calls.at(-1);
    check(f.calls.length === total + 1 && c?.captured.ownerId === OTHER && c.captured.epoch === f.epoch, 'explicit-current-owner-load');
    f.reply(c, null, 'hold'); await f.tick(); f.win.emit(event); await f.tick();
    check(c.jsonRead && f.calls.length === total + 1 && f.status() === f.locale + ':loading' &&
      !f.html().includes('seed-content-1'), 'retirement-keeps-new-json-pending');
    f.json(c, f.data('display-b')); await f.tick();
    check(f.status() === '' && f.html().includes('display-b-content-1') && !f.html().includes('seed-content-1'), 'pending-new-owner-can-accept');
  });
  group = GROUPS[10];
  for (const name of PLAN[10][1]) await scenario(name, async (f, check) => {
    await seed(f, check); const total = f.calls.length;
    if (name === 'logout') f.owner = null;
    if (name !== 'predicate-throw') f.epoch++;
    else f.currentHook = () => {
      const e = Object.assign(new Error('synthetic-currentness-failure'), { name: 'FixtureCurrentError', code: 'FIXTURE_CURRENT' });
      f.expectedFaults.push(causeOf(e)); throw e;
    };
    f.win.emit('focus'); await f.tick(); f.currentHook = null;
    check(f.calls.length === total, 'context-observation-no-automatic-get');
    check(!f.html().includes('seed-content-1'), 'unconfirmed-display-removed');
    if (!f.owner) { f.owner = OTHER; f.epoch++; }
    f.click(); const c = f.calls.at(-1); f.reply(c, f.data('restored')); await f.tick();
    check(f.calls.length === total + 1 && f.status() === '' && f.html().includes('restored-content-1'), 'explicit-load-after-retirement');
  });
  group = GROUPS[11];
  await scenario('starts-new-pending', async (f, check) => {
    await seed(f, check); f.owner = OTHER; f.epoch++; const start = f.calls.length;
    f.currentHook = () => { f.hookRuns++; f.load(); };
    f.load(); await f.tick(); const calls = f.calls.slice(start);
    check(f.hookRuns === 1 && calls.length === 1 && calls[0]?.captured.ownerId === OTHER, 'controlled-pending-reentry-reached');
    check(f.status() === 'ko:loading' && !f.html().includes('seed-content-1'), 'reentry-clears-stale-not-pending');
    if (calls[0]) { f.reply(calls[0], f.data('reentry-b')); await f.tick();
      check(f.status() === '' && f.html().includes('reentry-b-content-1'), 'reentrant-pending-load-completes'); }
  });
}
(async () => {
  try {
    setup(); await exercise(); deadline(); inputsStable = stableChecks.every(fn => fn()); modules = cacheOK();
    const listeners = process.listeners('unhandledRejection');
    fixturesClosed = fixturesClosed && listeners.length === rejectionListeners.length && listeners.every((fn, i) => fn === rejectionListeners[i]);
    if (supplied) {
      nativeGuards = { ...guard }; need(Object.values(nativeGuards).every(n => Number.isInteger(n) && n === 0), 'guard-counts');
      const same = (now, before) => now.length === before.length && now.every(r => before.includes(r));
      resourcesClosed = fixturesClosed && same(process._getActiveHandles(), handles) && same(process._getActiveRequests(), requests);
    }
    const wanted = PLAN.flatMap(([g, names]) => names.map(c => g + '/' + c));
    complete = cases.length === wanted.length && cases.every((c, i) => c.finished && c.group + '/' + c.case === wanted[i]);
  } catch (e) { errors.push({ group: 'protocol', case: 'qualification', check: 'not-qualified', cause: causeOf(e) }); }
  const failedGroups = GROUPS.filter(g => failed.has(g));
  const result = { contract: 'content-rights-display-retirement-result-v1', mode, admissionSupplied: supplied,
    complete, inputsStable, loadedModulesAdmitted: supplied && modules, resourcesClosed,
    moduleAllowlistVerified: modules, fixtureResourcesClosed: fixturesClosed, nativeGuards,
    generationAuthorized: false, productInstalled: false, realAuthProof: false,
    groups: GROUPS, passed: GROUPS.length - failedGroups.length, failed: failedGroups.length,
    failedGroups, errors, cases, input: raw ? { bytes: raw.length, sha256: hash(raw), allPinnedText } : null };
  output.write('CONTENT_RIGHTS_DISPLAY_RETIREMENT_RESULT ' + JSON.stringify(result) + '\n');
  process.exitCode = !complete || !inputsStable || !modules || !fixturesClosed ||
    (supplied && resourcesClosed !== true) || errors.length > 0 ? 1 : 0;
})();

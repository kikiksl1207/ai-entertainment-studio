'use strict';
// AUTHOR only. A future admitted run loads the entire page in a controlled DOM.
const fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), vm = require('node:vm');
const output = process.stdout;
void process.stderr;
const GROUPS = ['normal-receipt', 'invalid-input', 'focus-cancel', 'focus-owner',
  'focus-availability', 'focus-nested', 'pending-duplicate', 'late-ack'];
const EXPECTED = { contract: 'feed-report-dispatch-expected-v1', groups: GROUPS,
  baselineFailures: GROUPS.slice(2, 6) };
const REPO = 'E:/Codex/LuminaStage/ai-entertainment-studio-git';
const BASE = REPO + '/qa/20261022-feed-report-dispatch-boundary';
const SOURCE = 'pages/feed-report.js', ORACLE = 'tests/feed-report-dispatch.test.cjs';
const CODE = {
  baseline: [6602, 'c78154e4e611054feb7470f23b2c65e056c7c2cd33e4ed0416e0bb7d685218cc'],
  candidate: [6819, 'e43eb9c98a6f3389e5d642f99f20daf3f4ecf6233c87365b0b70e00e5fddf303']
};
const SUPPORT = [
  [REPO + '/qa/20261021-night-studio-video-workspace/workspace-unit-preload.cjs', 420,
    'eff655db3067b583cf57208f4f607f6255ac7fa52fe162ba67c8b301eb4cd327'],
  [REPO + '/server/scripts/release-qa-guards.cjs', 3480,
    '677eae3cfc1c9ad809557f4db5aa984683b5cd65d65bf92f64ebb1bcee2807eb']
];
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const norm = p => path.resolve(p).replace(/\\/g, '/');
const need = (ok, tag) => { if (!ok) throw new Error(tag); };
const shape = (o, keys) => o && Object.keys(o).sort().join('|') === keys.split(' ').sort().join('|');
const read = p => { ordinary(p); return fs.readFileSync(p); };
function ordinary(p) {
  for (let q = path.resolve(p);;) {
    need(!fs.lstatSync(q).isSymbolicLink(), 'ordinary');
    const next = path.dirname(q); if (next === q) break; q = next;
  }
}
function pin(row, primary = false) {
  need(shape(row, 'path bytes sha256' + (primary ? ' repoPath' : '')) &&
    typeof row.path === 'string' && path.isAbsolute(row.path) &&
    Number.isSafeInteger(row.bytes) && row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256), 'pin-shape');
  const b = read(row.path);
  need(b.length === row.bytes && hash(b) === row.sha256, 'pin-content');
  return b;
}
const json = b => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b));
let admission, supplied = process.argv.length > 2, mode = 'ci', raw, code, root;
let stableChecks = [], cacheAllow = [norm(__filename)], guard, allPinnedText = 0;
let complete = false, inputsStable = false, modules = false, fixturesClosed = true;
let nativeGuards = null, resourcesClosed = null, handles, requests;
const errors = [], cases = [], failed = new Set();
function setup() {
  root = norm(path.resolve(__dirname, '..'));
  need(!process.env.NODE_OPTIONS, 'node-options');
  if (!supplied) {
    need(process.argv.length === 2 && process.env.CI === 'true' && process.execArgv.length === 0, 'ci-entry');
    const file = root + '/' + SOURCE, self = read(__filename);
    raw = read(file);
    code = new TextDecoder('utf-8', { fatal: true }).decode(raw);
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
    const ab = read(process.argv[2]);
    need(ab.length <= 32768 && hash(ab) === process.argv[3], 'admission-hash');
    admission = json(ab);
    need(shape(admission, 'contract mode deadlineUtcMs runRoot node preload guard expected primary pins') &&
      admission.contract === 'feed-report-dispatch-admission-v1' &&
      ['baseline', 'candidate'].includes(admission.mode) && norm(admission.runRoot) === root, 'admission-shape');
    mode = admission.mode;
    deadline(); need(admission.deadlineUtcMs <= Date.now() + 120000, 'deadline-range');
    const a = admission;
    need(Array.isArray(a.primary) && a.primary.length === 2 && Array.isArray(a.pins) && a.pins.length === 6, 'roles');
    const wanted = [mode === 'baseline' ? REPO + '/qa/20261022-feed-report-intent-source/snapshot/' + SOURCE : BASE + '/candidate/' + SOURCE,
      BASE + '/' + ORACLE];
    need(a.primary.every((r, i) => norm(r.path) === wanted[i] && r.repoPath === [SOURCE, ORACLE][i]), 'primary-order');
    need(norm(a.expected.path) === BASE + '/expected.json', 'expected-path');
    for (const [i, role] of ['preload', 'guard'].entries()) {
      const r = a[role], s = SUPPORT[i];
      need(norm(r.path) === s[0] && r.bytes === s[1] && r.sha256 === s[2], 'support-identity');
    }
    need(norm(a.node.path) === 'E:/Program Files/nodejs/node.exe' && norm(process.execPath) === norm(a.node.path) &&
      a.node.bytes === 83344536 && a.node.sha256 === '33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b', 'node-identity');
    const rows = [...a.primary, a.expected, ...[a.preload, a.guard]];
    const ctrl = a.pins.find(r => norm(r.path) === BASE + '/run-first.ps1');
    need(ctrl && new Set([...rows, ctrl, a.node].map(r => norm(r.path).toLowerCase())).size === 7 &&
      new Set(a.pins.map(r => norm(r.path).toLowerCase())).size === 6, 'role-uniqueness');
    need(a.pins.every(r => [...rows, ctrl].some(x => norm(x.path) === norm(r.path) && x.bytes === r.bytes && x.sha256 === r.sha256)), 'pin-roles');
    a.pins.forEach(r => pin(r)); pin(a.node);
    need(JSON.stringify(json(pin(a.expected))) === JSON.stringify(EXPECTED), 'expected-contract');
    a.primary.forEach(r => {
      pin(r, true);
      const b = read(root + '/' + r.repoPath);
      need(b.length === r.bytes && hash(b) === r.sha256, 'staged-primary');
      stableChecks.push(() => hash(read(root + '/' + r.repoPath)) === r.sha256);
    });
    raw = read(root + '/' + SOURCE);
    need(raw.length === CODE[mode][0] && hash(raw) === CODE[mode][1], 'whole-code-identity');
    code = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    need(process.execArgv.length === 2 && ['--require', '-r'].includes(process.execArgv[0]) &&
      norm(process.execArgv[1]) === norm(a.preload.path), 'native-preload');
    cacheAllow.push(norm(a.preload.path), norm(a.guard.path));
    guard = require.cache[require.resolve(a.guard.path)]?.exports?.stats;
    need(guard && shape(guard, 'blockedEnvReads blockedNetwork blockedWrites'), 'native-stats');
    allPinnedText = ab.length + a.pins.reduce((n, r) => n + r.bytes, 0);
    stableChecks.push(() => hash(read(process.argv[2])) === process.argv[3],
      () => { a.pins.forEach(r => pin(r)); pin(a.node); return true; });
  }
  need(allPinnedText < 64000, 'whole-text-budget');
  need(cacheOK(), 'module-cache');
  handles = process._getActiveHandles(); requests = process._getActiveRequests();
}
function deadline() {
  if (admission) need(Number.isSafeInteger(admission.deadlineUtcMs) && Date.now() < admission.deadlineUtcMs, 'deadline');
}
const cacheOK = () => Object.keys(require.cache).length === cacheAllow.length &&
  Object.keys(require.cache).every(p => cacheAllow.includes(norm(p)));
const UID = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333', POST2 = '44444444-4444-4444-8444-444444444444';
const RID = '55555555-5555-4555-8555-555555555555', KEY = '66666666-6666-4666-8666-666666666666';
function fixture() {
  const f = { auth: { user: { id: UID }, accessToken: 'fixture-token-a' }, available: true,
    calls: [], tasks: new Set(), buses: [], dialogs: [], store: new Map(), hook: null, context: null, rejected: false, rejections: [] };
  function track(p) {
    if (p && typeof p.then === 'function') {
      f.tasks.add(p); p.then(() => f.tasks.delete(p), error => {
        f.tasks.delete(p); f.rejected = true; f.rejections.push(causeOf(error));
      });
    }
  }
  function bus() {
    const listeners = new Map();
    const b = {
      addEventListener(k, fn) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(fn); },
      removeEventListener(k, fn) { listeners.get(k)?.delete(fn); },
      emit(k, extra = {}) {
        const e = { preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
        for (const fn of [...(listeners.get(k) || [])]) track(fn(e)); return e;
      },
      clear() { listeners.clear(); }, count() { return [...listeners.values()].reduce((n, s) => n + s.size, 0); }
    };
    f.buses.push(b); return b;
  }
  const node = () => Object.assign(bus(), { disabled: false, hidden: false, value: '', textContent: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, focus() {} });
  function dialog() {
    const d = node(), form = node(), reason = node(), detail = node(), send = node(), cancel = node(), msg = node();
    msg.hidden = true; msg.focus = () => { if (msg.textContent === 'sending' && f.hook) { const h = f.hook; f.hook = null; h(); } };
    const controls = [reason, detail, send];
    form.elements = { reason, detail };
    form.querySelectorAll = s => { need(s === 'select, textarea, [type=submit]', 'fixture-selector'); return controls; };
    form.querySelector = s => { need(s === '[type=submit]', 'fixture-submit'); return send; };
    Object.assign(d, { open: false, isConnected: false, form, reason, detail, send, cancel, msg, controls,
      querySelector(s) { const n = { form, '[data-report-cancel]': cancel, '[data-report-message]': msg }[s]; need(n, 'fixture-dialog-selector'); return n; },
      showModal() { this.open = true; }, close() { this.open = false; }, remove() { this.isConnected = false; }
    });
    Object.defineProperty(d, 'innerHTML', { set(s) {
      need(['<form novalidate>', 'name="reason"', 'name="detail"', 'data-report-message', 'data-report-cancel', 'type="submit"'].every(t => s.includes(t)), 'fixture-markup');
    } });
    f.dialogs.push(d); return d;
  }
  f.win = Object.assign(bus(), { location: { pathname: '/feed/' }, feedReportAvailable: () => f.available,
    luminaI18n: { t: k => k.slice('feed.report.'.length), apply() {} } });
  f.doc = Object.assign(bus(), { body: { append(d) { d.isConnected = true; } },
    createElement(tag) { need(tag === 'dialog', 'fixture-element'); return dialog(); } });
  f.open = (post = POST) => {
    const origin = { dataset: { feedReport: post }, disabled: false, isConnected: true, focus() {},
      closest(s) { need(s === '[data-feed-report]', 'fixture-origin'); return this; } };
    f.doc.emit('click', { target: origin });
    const d = f.dialogs.at(-1); need(d?.open, 'fixture-open'); d.reason.value = 'spam'; d.detail.value = '  detail  '; return d;
  };
  f.submit = d => d.form.emit('submit');
  f.reply = (call, change = {}, alreadySubmitted = false) => {
    if (call.done) return;
    call.done = true; call.resolve({ alreadySubmitted, report: { id: RID, postId: call.post,
      reporterUserId: call.user, status: 'submitted', ...change } });
  };
  f.tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  f.drain = async () => { for (const c of f.calls) f.reply(c); await f.tick(); };
  const apiFetch = (url, options) => new Promise(resolve => {
    f.calls.push({ url, options: JSON.parse(JSON.stringify(options)), user: f.auth?.user?.id,
      token: f.auth?.accessToken, post: url.split('/').at(-2), resolve, done: false });
  });
  f.context = vm.createContext({ window: f.win, document: f.doc, getAuth: () => f.auth, apiFetch,
    crypto: { randomUUID: () => KEY }, sessionStorage: {
      getItem: k => f.store.get(k) ?? null, setItem: (k, v) => f.store.set(k, v), removeItem: k => f.store.delete(k)
    } }, { codeGeneration: { strings: false, wasm: false } });
  f.load = () => new vm.Script(code, { filename: SOURCE }).runInContext(f.context, { timeout: 1000 });
  f.dispose = async () => {
    f.hook = null; await f.drain();
    f.buses.forEach(b => b.clear()); f.dialogs.forEach(d => { d.close(); d.remove(); });
    f.store.clear(); f.auth = null; f.context = null;
    return !f.rejected && !f.tasks.size && f.calls.every(c => c.done) &&
      f.buses.every(b => b.count() === 0) && f.dialogs.every(d => !d.open && !d.isConnected) &&
      f.store.size === 0 && f.hook === null && f.context === null;
  };
  return f;
}
let group;
// Synthetic exception metadata only: never copy stack, source, request or auth fields.
function causeOf(error) {
  const cause = {
    name: typeof error?.name === 'string' ? error.name : 'NonError',
    message: typeof error?.message === 'string' ? error.message :
      typeof error === 'string' ? error : 'Non-Error throw without a string message'
  };
  if (typeof error?.code === 'string' || typeof error?.code === 'number') cause.code = error.code;
  return cause;
}
async function scenario(name, body) {
  const row = { group, case: name, checks: [], posts: 0 }, f = fixture(); cases.push(row);
  row.rejections = f.rejections;
  const check = (ok, id, ...causes) => {
    const entry = { id, ok: !!ok };
    if (causes.length) entry.cause = causeOf(causes[0]);
    row.checks.push(entry);
    if (!ok) {
      failed.add(group);
      errors.push({ group, case: name, check: id, ...(entry.cause ? { cause: entry.cause } : {}),
        ...(f.rejections.length ? { rejections: f.rejections } : {}) });
    }
  };
  try { deadline(); f.load(); await body(f, check); }
  catch (error) { check(false, 'scenario-exception', error); }
  finally {
    row.posts = f.calls.length;
    try { const closed = await f.dispose(); fixturesClosed = fixturesClosed && closed; check(closed, 'fixture-closed'); }
    catch (error) { fixturesClosed = false; check(false, 'cleanup-exception', error); }
  }
}
const disabled = d => d.controls.every(c => c.disabled);
const enabled = d => d.controls.every(c => !c.disabled);
const state = d => JSON.stringify([d.open, d.isConnected, d.msg.textContent, d.msg.hidden, d.msg.attrs,
  d.controls.map(c => [c.disabled, c.hidden, c.value])]);
async function exercise() {
  group = GROUPS[0];
  for (const kind of ['submitted', 'duplicate', 'bad-id', 'bad-post', 'bad-owner', 'bad-status']) await scenario(kind, async (f, check) => {
    const d = f.open(); f.submit(d);
    check(f.calls.length === 1 && disabled(d), 'one-post-disabled');
    const c = f.calls[0]; need(c, 'call');
    check(c.url === '/api/v1/lumina-feed/posts/' + POST + '/report' && c.user === UID && c.token === 'fixture-token-a' &&
      JSON.stringify(c.options) === JSON.stringify({ method: 'POST', auth: true, throwOnError: true,
        body: { reason: 'spam', detail: 'detail', requestKey: KEY } }), 'exact-request-current-owner');
    const changes = { 'bad-id': { id: 'invalid' }, 'bad-post': { postId: POST2 }, 'bad-owner': { reporterUserId: OTHER }, 'bad-status': { status: 'invalid' } };
    f.reply(c, changes[kind] || {}, kind === 'duplicate'); await f.tick();
    const valid = !kind.startsWith('bad-');
    check(d.msg.textContent === (valid ? kind : 'error') && d.send.hidden === valid && (valid || enabled(d)), 'receipt-gates-ui');
    check(f.store.size === (valid ? 0 : 1), 'receipt-key-lifetime');
  });
  group = GROUPS[1];
  for (const kind of ['reason', 'detail']) await scenario(kind, async (f, check) => {
    const d = f.open(); if (kind === 'reason') d.reason.value = 'not-a-reason'; else d.detail.value = 'x'.repeat(501);
    f.submit(d); await f.tick(); check(f.calls.length === 0 && d.msg.textContent === 'invalid' && enabled(d), 'invalid-zero-post');
  });
  group = GROUPS[2];
  for (const kind of ['button', 'dialog-cancel']) await scenario(kind, async (f, check) => {
    const d = f.open(); f.hook = () => kind === 'button' ? d.cancel.emit('click') : d.emit('cancel');
    f.submit(d); await f.drain(); check(!d.open && !d.isConnected && f.calls.length === 0, 'cancel-zero-post');
    const next = f.open(); check(next !== d, 'abandoned-flight-cleared');
  });
  group = GROUPS[3];
  for (const kind of ['owner', 'token']) await scenario(kind, async (f, check) => {
    const d = f.open(); f.hook = () => { f.auth = { user: { id: kind === 'owner' ? OTHER : UID }, accessToken: 'fixture-token-b' }; };
    f.submit(d); await f.drain(); check(f.calls.length === 0, 'identity-zero-post');
    check(f.calls.every(c => c.user === f.auth.user.id && c.token === f.auth.accessToken), 'stub-uses-current-identity');
    f.win.emit('lumina:authchange'); check(!d.open, 'auth-event-closes');
    check(f.open().open, 'abandoned-flight-cleared');
  });
  group = GROUPS[4];
  await scenario('availability', async (f, check) => {
    const d = f.open(); f.hook = () => { f.available = false; }; f.submit(d); await f.drain();
    check(f.calls.length === 0 && enabled(d) && !d.send.hidden, 'unavailable-zero-post-restored');
    check(d.msg.textContent === 'unavailable', 'unavailable-message');
    f.available = true; f.submit(d); check(f.calls.length === 1, 'abandoned-flight-retry'); await f.drain();
  });
  group = GROUPS[5];
  await scenario('synchronous-nested-submit', async (f, check) => {
    const d = f.open(); let nested = 0; f.hook = () => { nested++; f.submit(d); }; f.submit(d);
    check(nested === 1 && f.calls.length === 1 && disabled(d), 'nested-one-post'); await f.drain();
    check(d.msg.textContent === 'submitted' && d.send.hidden, 'nested-receipt');
  });
  group = GROUPS[6];
  await scenario('pending-and-retry', async (f, check) => {
    const d = f.open(); f.submit(d); f.submit(d); await f.tick();
    check(f.calls.length === 1 && disabled(d) && d.msg.textContent === 'sending', 'pending-one-post-controls');
    f.reply(f.calls[0], { id: 'invalid' }); await f.tick(); check(enabled(d) && !d.send.hidden, 'error-restores-controls');
    d.detail.value = ' changed detail '; f.submit(d); f.submit(d);
    check(f.calls.length === 2 && f.calls[1].options.body.requestKey === KEY &&
      f.calls[1].options.body.detail === 'changed detail' && disabled(d), 'existing-reason-key-retry');
    await f.drain(); check(d.send.hidden && d.msg.textContent === 'submitted', 'retry-receipt');
  });
  group = GROUPS[7];
  for (const kind of ['view', 'owner', 'token']) await scenario(kind, async (f, check) => {
    const old = f.open(); f.submit(old); const c = f.calls[0]; need(c, 'late-call'); old.cancel.emit('click');
    if (kind !== 'view') { f.auth = { user: { id: kind === 'owner' ? OTHER : UID }, accessToken: 'fixture-token-b' }; f.win.emit('lumina:authchange'); }
    const next = f.open(kind === 'owner' ? POST : POST2); next.detail.value = 'new dialog draft'; const before = state(next);
    f.reply(c); await f.tick();
    check(state(next) === before && next.open && enabled(next) && !next.send.hidden && next.msg.hidden, 'late-ack-no-new-ui-effect');
    check(!old.open && !old.isConnected && f.calls.length === 1, 'old-detached-one-post');
  });
}
(async () => {
  try {
    setup(); await exercise(); deadline();
    inputsStable = stableChecks.every(fn => fn()); modules = cacheOK();
    if (supplied) {
      nativeGuards = { ...guard };
      need(Object.values(nativeGuards).every(n => Number.isInteger(n) && n === 0), 'guard-counts');
      resourcesClosed = fixturesClosed && process._getActiveHandles().length === handles.length &&
        process._getActiveHandles().every(h => handles.includes(h)) && process._getActiveRequests().length === requests.length &&
        process._getActiveRequests().every(r => requests.includes(r));
    }
    complete = GROUPS.every(g => cases.some(c => c.group === g));
  } catch (error) { errors.push({ group: 'protocol', case: 'qualification', check: 'not-qualified', cause: causeOf(error) }); }
  const failedGroups = GROUPS.filter(g => failed.has(g));
  const result = { contract: 'feed-report-dispatch-result-v1', mode, admissionSupplied: supplied,
    complete, inputsStable, loadedModulesAdmitted: supplied && modules, resourcesClosed,
    moduleAllowlistVerified: modules, fixtureResourcesClosed: fixturesClosed, nativeGuards,
    generationAuthorized: false, productInstalled: false, realAuthProof: false,
    groups: GROUPS, passed: GROUPS.length - failedGroups.length, failed: failedGroups.length,
    failedGroups, errors, cases, input: raw ? { bytes: raw.length, sha256: hash(raw), allPinnedText } : null };
  output.write('FEED_REPORT_DISPATCH_RESULT ' + JSON.stringify(result) + '\n');
  process.exitCode = !complete || !inputsStable || !modules || !fixturesClosed ||
    (supplied && resourcesClosed !== true) || errors.length > 0 ? 1 : 0;
})();

'use strict';
const A = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { createHash } = require('node:crypto'), { test } = require('node:test'), { TextDecoder } = require('node:util');
const eq = A.equal, deep = A.deepEqual, realNow = Date.now.bind(Date), immediate = setImmediate;
const SOURCE = 'pages/creator-approved-reading-entry.js', SUITE = 'tests/owner-reader-idle-status.test.cjs';
const GROUPS = ['01 idle labels in five locales', '02 existing phases and button gates',
  '03 explicit actions retain confirmations', '04 passive events never start requests',
  '05 handoff and reading facade gates', '06 disposal and late rendering stay retired'];
const FAILS = [GROUPS[0], GROUPS[5]];
const R = { contract: 'owner-reader-idle-status-result-v1', groups: [], failedGroups: [], passed: 0, failed: 0,
  complete: false, inputsStable: false, loadedModulesAdmitted: false, resourcesClosed: false,
  realAuthProof: false, generationAuthorized: false, productInstalled: false, mode: 'ci', cases: [], nativeGuards: null };
const files = new Map();
let source, admission, allowed, guards;
let cacheGood = true, closed = true;
const check = v => { if (!v) throw new Error('OWNER_READER_IDLE_STATUS_NOT_QUALIFIED'); };
const sha = b => createHash('sha256').update(b).digest('hex');
const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const same = (a, b) => key(a) === key(b);
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => immediate(r)); };
function ordinary(file) {
  check(typeof file === 'string' && path.isAbsolute(file));
  for (let p = file, first = true;; first = false) {
    const s = fs.lstatSync(p); check(!s.isSymbolicLink() && (first ? s.isFile() : s.isDirectory()));
    const up = path.dirname(p); if (up === p) break; p = up;
  }
  check(same(fs.realpathSync.native(file), file));
}
function remember(p, b) { const old = files.get(key(p)); if (old) check(old.b.equals(b)); else files.set(key(p), { p, b }); return b; }
function capture(r) {
  check(r && Number.isSafeInteger(r.bytes) && r.bytes > 0 && typeof r.sha256 === 'string' && /^[a-f0-9]{64}$/.test(r.sha256));
  ordinary(r.path); const b = fs.readFileSync(r.path); check(b.length === r.bytes && sha(b) === r.sha256); return remember(r.path, b);
}
const stable = (paths = [...files.keys()]) => paths.every(p => { const r = files.get(key(p)); ordinary(r.p); return fs.readFileSync(r.p).equals(r.b); });
const cacheOK = () => Object.keys(require.cache).every(p => allowed.has(key(p)));
function protocol() {
  source = path.resolve(__dirname, '..', SOURCE); allowed = new Set([key(source), key(__filename)]);
  const decode = b => new TextDecoder('utf-8', { fatal: true }).decode(b);
  let ab = Buffer.alloc(0), eb = Buffer.alloc(0);
  if (process.argv.length !== 2) {
    check(process.argv.length === 4 && /^[a-f0-9]{64}$/.test(process.argv[3])); ordinary(process.argv[2]);
    ab = fs.readFileSync(process.argv[2]); check(ab.length <= 32768 && sha(ab) === process.argv[3]); remember(process.argv[2], ab);
    const a = admission = JSON.parse(decode(ab)); eq(a.contract, 'owner-reader-idle-status-admission-v1');
    check(['baseline', 'candidate'].includes(a.mode)); R.mode = a.mode;
    check(Number.isSafeInteger(a.deadlineUtcMs) && a.deadlineUtcMs > realNow() && a.deadlineUtcMs <= realNow() + 120000);
    check(same(path.dirname(a.runRoot), path.dirname(a.expected.path)) && /^owned-first-[a-f0-9]{12}$/.test(path.basename(a.runRoot)));
    check(same(process.argv[2], path.join(a.runRoot, 'admission.json')) && same(process.cwd(), a.runRoot));
    check(Array.isArray(a.pins) && a.pins.length > 0 && a.pins.length <= 32 && new Set(a.pins.map(r => key(r.path))).size === a.pins.length);
    const member = r => { const m = a.pins.filter(p => same(p.path, r.path)); check(m.length === 1 && m[0].path === r.path && m[0].bytes === r.bytes && m[0].sha256 === r.sha256); };
    a.pins.forEach(capture); [a.node, a.preload, a.guard].forEach(capture); [a.preload, a.guard, a.expected].forEach(member);
    check(same(a.node.path, process.execPath) && process.execArgv.length === 2 && process.execArgv[0] === '--require' && same(process.execArgv[1], a.preload.path));
    check(a.node.bytes === 83344536 && a.node.sha256 === '33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b');
    check(a.preload.bytes === 420 && a.preload.sha256 === 'eff655db3067b583cf57208f4f607f6255ac7fa52fe162ba67c8b301eb4cd327');
    check(a.guard.bytes === 3480 && a.guard.sha256 === '677eae3cfc1c9ad809557f4db5aa984683b5cd65d65bf92f64ebb1bcee2807eb');
    check(Array.isArray(a.primary) && a.primary.length === 2 && new Set(a.primary.map(r => r.repoPath)).size === 2);
    const roles = [a.node, a.preload, a.guard, a.expected, ...a.primary]; check(new Set(roles.map(r => key(r.path))).size === roles.length);
    for (const r of a.primary) {
      check([SOURCE, SUITE].includes(r.repoPath)); member(r); const b = capture(r), p = path.join(a.runRoot, r.repoPath);
      check(capture({ ...r, path: p }).equals(b) && same(p, r.repoPath === SUITE ? __filename : source));
      if (r.repoPath === SOURCE && a.mode === 'baseline') check(r.bytes === 22958 && r.sha256 === '6d7505c3818de9ee386cc02f2c25d1cf15977407b05132fd50c89eebb655d17d');
    }
    eb = capture(a.expected); const e = JSON.parse(decode(eb));
    eq(e.contract, 'owner-reader-idle-status-expected-v1'); deep(e.groups, GROUPS); deep(e.baselineFailures, FAILS);
    [a.preload.path, a.guard.path].forEach(p => allowed.add(key(p)));
    const loaded = new Map(Object.values(require.cache).map(m => [key(m.filename), m]));
    check(loaded.has(key(a.preload.path)) && loaded.has(key(a.guard.path))); guards = loaded.get(key(a.guard.path)).exports.stats;
  }
  ordinary(source); ordinary(__filename);
  const b = remember(source, fs.readFileSync(source)), self = remember(__filename, fs.readFileSync(__filename));
  check(b.length + self.length + eb.length + ab.length < 64000);
  check(cacheOK() && !Object.keys(require.cache).some(p => same(p, source)) && stable());
}

const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const IDLE = [['작품 조회 전', '인증 확인 전'], ['Works not loaded', 'Sign-in not checked'],
  ['作品未取得', '認証未確認'], ['尚未加载作品', '尚未确认认证'], ['尚未載入作品', '尚未確認驗證']];
const CATALOG = {
  loading: ['조회 중', 'Loading', '取得中', '加载中', '載入中'],
  ready: ['승인 상태: 미확인', 'Approval: not checked', '承認状態: 未確認', '审批状态：未检查', '審批狀態：未檢查'],
  empty: ['등록된 작품 없음', 'No works', '作品なし', '暂无作品', '暫無作品'],
  unauthenticated: ['로그인 필요', 'Sign-in required', 'ログインが必要', '请登录', '請登入'],
  auth_rejected: ['읽기 로그인을 다시 확인해 주세요', 'Check sign-in for this read', '読み取りに使うログインを確認してください', '请确认读取所用的登录', '請確認讀取所用的登入'],
  stale: ['다시 조회 필요', 'Reload required', '再取得が必要', '请重新加载', '請重新載入'],
  timeout: ['응답 시간 초과', 'Request timed out', '応答時間超過', '请求超时', '請求逾時'],
  unavailable: ['조회 실패', 'Unavailable', '取得失敗', '加载失败', '載入失敗']
};
const AUTH_LABELS = {
  connecting: ['인증 연결 중', 'Connecting sign-in', '認証を接続中', '正在连接认证', '正在連接驗證'],
  connected: ['인증 연결됨', 'Sign-in connected', '認証接続済み', '认证已连接', '驗證已連接'],
  rejected: ['인증 연결 거절', 'Connection rejected', '認証接続が拒否されました', '认证连接被拒绝', '驗證連接遭拒'],
  uncertain: ['인증 처리 상태 확인 필요', 'Connection outcome needs review', '認証処理の確認が必要です', '需要确认认证处理状态', '需要確認驗證處理狀態'],
  changed: ['로그인 정보 변경됨', 'Sign-in changed', 'ログイン情報が変更されました', '登录信息已更改', '登入資訊已變更'],
  unavailable: ['인증 연결 불가', 'Connection unavailable', '認証接続不可', '无法连接认证', '無法連接驗證']
};
const EXPIRED = ['읽기에 보낸 로그인 정보가 만료되었습니다', 'The sign-in sent for this read has expired',
  '読み取りに送信したログイン情報の期限が切れています', '本次读取使用的登录信息已过期', '本次讀取使用的登入資訊已過期'];
const ITEM = { workId: 'WORK-STUB', title: { value: 'Fixture work' } };
const SCOPE = { ownerId: 'owner-stub', workId: 'WORK-STUB', workLabel: 'Fixture work', sourceLocale: 'ko' };
const READY = { phase: 'ready', items: [ITEM], nextCursor: 'cursor-stub', selected: null, authReason: null };
const ids = ['writerManuscriptWork', 'writerManuscriptLocale', 'readingWorkTitle', 'readingConnectionState', 'readingLocale',
  'readingCatalog', 'readingCatalogWork', 'readingCatalogLoad', 'readingCatalogNext', 'readingCatalogLogin', 'readingCatalogConnect',
  'readingCatalogRestart', 'readingAuthConnectionState', 'readingCatalogWorks', 'readingCatalogTitle', 'readingCatalogWorkLabel',
  'readingCatalogState', 'writerApprovedSectionBytes', 'readingTitle', 'readingStudioLink', 'readingLocaleLabel'];
function fixture(o) {
  const count = { fetch: 0, nativeFetch: 0, loads: 0, chooses: 0, connects: 0, getAuth: 0, reads: 0, writes: 0,
    confirm: 0, sync: 0, receiverStart: 0, validations: 0, reload: 0, catalogCreate: 0, authCreate: 0 };
  const f = { count, timers: new Map(), now: 0, owner: { ownerId: 'owner-stub' }, raw: 'opaque-fixture-auth', scope: null,
    cat: { phase: 'idle', items: [], nextCursor: null, selected: null }, auth: { phase: 'idle', canConnect: true },
    timeHint: 'unknown', lifetimeHint: 'unknown', dead: new Set(), created: new Set(), loadArgs: [], chooseArgs: [], connectArgs: [], sealed: false };
  class E {
    constructor(root = false) { this.root = root; this.parent = null; this.children = []; this.listeners = new Map(); this.attrs = new Map(); this.dataset = {}; this.disabled = false; this.hidden = false; this.value = ''; this.textContent = ''; }
    addEventListener(t, fn, opts = {}) { const a = this.listeners.get(t) || []; a.push({ fn, once: opts.once }); this.listeners.set(t, a); }
    removeEventListener(t, fn) { this.listeners.set(t, (this.listeners.get(t) || []).filter(r => r.fn !== fn)); }
    dispatchEvent(e) { for (const r of [...(this.listeners.get(e.type) || [])]) { if (r.once) this.removeEventListener(e.type, r.fn); r.fn(e); } return true; }
    fire(type, extra = {}) { return this.dispatchEvent({ type, ...extra }); }
    click() { if (!this.disabled) this.fire('click'); }
    appendChild(c) { c.parent = this; this.children.push(c); return c; }
    replaceChildren() { for (const c of this.children) c.parent = null; this.children = []; }
    contains(c) { return !!c && (c === this || this.children.some(v => v.contains(c))); }
    get isConnected() { return this.root || !!this.parent?.isConnected; }
    focus() { f.doc.activeElement = this; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    removeAttribute(k) { this.attrs.delete(k); }
  }
  f.el = Object.fromEntries(ids.map(id => [id, new E(true)])); f.el.readingLocale.value = o.locale || 'en';
  f.win = new E(); f.doc = new E(); f.doc.readyState = o.loading ? 'loading' : 'complete';
  f.doc.documentElement = new E(true); f.doc.activeElement = null; f.doc.title = '';
  f.doc.getElementById = id => f.el[id] || null; f.doc.createElement = () => new E();
  const dependency = name => { f.created.add(name); return () => f.dead.add(name); };
  f.transport = { getAuth: () => { count.getAuth++; return { synthetic: true }; }, identity: () => f.dead.has('transport') ? null : f.owner,
    isCurrent: who => !f.dead.has('transport') && who === f.owner,
    fetch: async () => { count.fetch++; check(!f.dead.has('transport')); return { ok: true, status: 200 }; }, dispose: dependency('transport') };
  const catalogTransport = { dispose: dependency('catalogTransport') };
  f.publishCatalog = value => { f.cat = value; f.catalogChange(value); };
  f.publishAuth = value => { f.auth = value; f.authChange(value); };
  const catalog = {
    selection: () => f.dead.has('catalog') ? null : f.scope,
    isSelectionCurrent: scope => !f.dead.has('catalog') && scope === f.scope && !!scope,
    sync: () => { count.sync++; },
    load: cursor => { count.loads++; if (!f.dead.has('catalog')) f.loadArgs.push(cursor); },
    choose: id => { count.chooses++; if (!f.dead.has('catalog')) { f.chooseArgs.push(id); f.scope = { ...SCOPE }; f.publishCatalog({ ...f.cat, selected: f.scope }); } },
    dispose: () => { f.dead.add('catalog'); f.scope = null; }
  };
  const connection = { state: () => f.auth, sync: () => { count.sync++; },
    connect: yes => { count.connects++; if (!f.dead.has('auth')) f.connectArgs.push(yes); }, dispose: () => f.dead.add('auth') };
  const receiver = { snapshot: () => f.dead.has('receiver') ? null : f.scope,
    start: () => { count.receiverStart++; }, invalidate: () => { f.scope = null; },
    validate: async signal => { count.validations++; return !f.dead.has('receiver') && !signal?.aborted && (f.validateHook ? f.validateHook() : true); },
    dispose: () => { f.dead.add('receiver'); f.scope = null; } };
  f.win.LuminaCreatorApprovedReadonlyTransport = { create: () => f.transport, createCatalog: () => catalogTransport };
  f.win.LuminaCreatorApprovedReadingCatalog = { create: cfg => { count.catalogCreate++; f.created.add('catalog'); f.catalogChange = cfg.onChange; return catalog; } };
  f.win.LuminaCreatorApprovedAuthConnection = { create: cfg => { count.authCreate++; f.created.add('auth'); f.authChange = cfg.onChange; return connection; } };
  f.win.LuminaCreatorApprovedReadingHandoff = { createReceiver: cfg => { f.created.add('receiver'); f.receiverChange = cfg.onChange; return receiver; } };
  f.win.LuminaCreatorApprovedUnverifiedAuthTime = { inspect: () => f.timeHint };
  f.win.LuminaCreatorApprovedUnverifiedAuthLifetime = { inspect: () => f.lifetimeHint };
  f.win.localStorage = { getItem: () => { count.reads++; return f.raw; }, setItem: () => { count.writes++; throw new Error('fixture write forbidden'); } };
  f.win.confirm = () => { count.confirm++; return f.confirmHook ? f.confirmHook() : false; };
  f.win.crypto = { randomUUID: () => '11111111-1111-4111-8111-111111111111' };
  f.win.opener = o.popup ? {} : null; f.win.location = { reload: () => { count.reload++; } };
  if (o.popup) { f.created.delete('catalogTransport'); f.dead.delete('catalogTransport'); }
  let serial = 0;
  const timer = (fn, ms, repeat) => { const id = ++serial; f.timers.set(id, { fn, ms, at: f.now + ms, repeat }); return id; };
  f.tick = () => { f.now += 1000; for (const [id, t] of [...f.timers]) if (t.at <= f.now) { if (t.repeat) t.at += t.ms; else f.timers.delete(id); t.fn(); } };
  f.globals = { window: f.win, document: f.doc, localStorage: f.win.localStorage,
    Event: class { constructor(type) { this.type = type; } },
    fetch: async () => { count.nativeFetch++; throw new Error('fixture native fetch forbidden'); },
    setInterval: (fn, ms) => timer(fn, ms, true), clearInterval: id => f.timers.delete(id),
    setTimeout: (fn, ms = 0) => timer(fn, ms, false), clearTimeout: id => f.timers.delete(id) };
  f.win.fetch = f.globals.fetch;
  f.locale = value => { f.el.readingLocale.value = value; f.el.readingLocale.fire('change'); };
  f.seal = () => { if (!f.sealed) { f.sealed = true; f.win.fire('pagehide'); } };
  f.dependenciesClosed = () => [...f.created].every(n => f.dead.has(n));
  return f;
}
async function use(o, body) {
  const f = fixture(o), originals = new Map(Object.keys(f.globals).map(n => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const cache = new Map(Object.entries(require.cache)); let error;
  try {
    for (const [n, v] of Object.entries(f.globals)) Object.defineProperty(globalThis, n, { configurable: true, writable: true, value: v });
    check(!admission || realNow() < admission.deadlineUtcMs); check(stable([source, __filename]));
    delete require.cache[require.resolve(source)]; require(source); cacheGood = cacheGood && cacheOK(); await flush(); await body(f);
  } catch (e) { error = e; }
  finally {
    try { f.seal(); await flush(); if (!error) { eq(f.timers.size, 0); eq(f.dependenciesClosed(), true); } } catch (e) { if (!error) error = e; }
    cacheGood = cacheGood && cacheOK();
    R.cases.push({ group: R.groups.length + 1, assertionFailed: !!error, counts: { ...f.count }, timersBeforeCleanup: f.timers.size, dependenciesDisposed: f.dependenciesClosed() });
    f.timers.clear(); for (const n of f.created) f.dead.add(n);
    for (const e of [f.win, f.doc, ...Object.values(f.el)]) e.listeners.clear();
    for (const [n, d] of originals) { if (d) Object.defineProperty(globalThis, n, d); else delete globalThis[n]; }
    for (const n of Object.keys(require.cache)) if (!cache.has(n)) delete require.cache[n];
    for (const [n, m] of cache) require.cache[n] = m;
    const restored = [...originals].every(([n, d]) => { const now = Object.getOwnPropertyDescriptor(globalThis, n); return d ? now && ['value', 'get', 'set', 'configurable', 'writable', 'enumerable'].every(k => now[k] === d[k]) : !now; });
    closed = closed && restored && f.timers.size === 0 && f.dependenciesClosed() && Object.keys(require.cache).length === cache.size && [...cache].every(([n, m]) => require.cache[n] === m);
  } if (error) throw error;
}
async function each(values, fn) { const errors = []; for (const v of values) try { await fn(v); } catch (e) { errors.push(e); } if (errors.length) throw new AggregateError(errors, 'reader fixture scenarios failed'); }
const status = f => [f.el.readingCatalogState.textContent, f.el.readingAuthConnectionState.textContent];
const controls = f => ['readingCatalogLoad', 'readingCatalogNext', 'readingCatalogWork', 'readingCatalogConnect'].map(n => f.el[n].disabled);
const noOperations = f => { for (const n of ['fetch', 'nativeFetch', 'loads', 'chooses', 'connects', 'getAuth', 'reads', 'writes']) eq(f.count[n], 0, n); };
const bodies = [
  () => each(LOCALES, locale => use({ locale }, async f => { deep(status(f), IDLE[LOCALES.indexOf(locale)]); deep(controls(f), [false, true, true, false]); noOperations(f); eq(f.el.writerManuscriptWork.value, ''); eq(f.win.LuminaCreatorApprovedReadingScope.snapshot(), null); })),
  () => each(LOCALES, locale => use({ locale }, async f => {
    const i = LOCALES.indexOf(locale);
    for (const [phase, expected, items, cursor, login] of [
      ['loading', [true, true, true, false], [ITEM], 'cursor-stub', true],
      ['ready', [false, false, false, false], [ITEM], 'cursor-stub', true],
      ['empty', [false, true, true, false], [], null, true],
      ['unauthenticated', [true, true, true, false], [], null, false],
      ['auth_rejected', [true, true, true, false], [], null, false],
      ['stale', [false, true, true, false], [], null, true],
      ['timeout', [false, true, true, false], [], null, true],
      ['unavailable', [false, true, true, false], [], null, true]]) {
      f.publishCatalog({ phase, items, nextCursor: cursor, selected: null }); eq(status(f)[0], CATALOG[phase][i]); deep(controls(f), expected); eq(f.el.readingCatalogLogin.hidden, login);
    }
    f.publishCatalog({ phase: 'auth_rejected', items: [], nextCursor: null, selected: null, authReason: 'AUTH_TOKEN_EXPIRED' }); eq(status(f)[0], EXPIRED[i]);
    if (locale === 'en') for (const [authReason, label] of [['AUTH_CONFIG_UNAVAILABLE', 'Server authentication settings are unavailable'], ['AUTH_LOOKUP_UNAVAILABLE', 'The server cannot check sign-in right now']]) {
      f.publishCatalog({ phase: 'unavailable', items: [], nextCursor: null, selected: null, authReason }); eq(status(f)[0], label);
    }
    f.publishCatalog({ phase: 'unrecognized', items: [], nextCursor: null, selected: null }); eq(status(f)[0], CATALOG.unavailable[i]);
    f.publishCatalog(READY);
    for (const [phase, expected, hidden] of [['connecting', [true, true, true, true], true], ['connected', [false, false, false, true], true],
      ['rejected', [true, true, true, true], false], ['uncertain', [true, true, true, true], false], ['changed', [true, true, true, true], false], ['unavailable', [false, false, false, true], true]]) {
      f.publishAuth({ phase, canConnect: false }); eq(status(f)[1], AUTH_LABELS[phase][i]); deep(controls(f), expected); eq(f.el.readingCatalogRestart.hidden, hidden); eq(f.el.readingCatalogLogin.hidden, hidden);
    }
    f.publishAuth({ phase: 'unrecognized', canConnect: false }); eq(status(f)[1], ''); noOperations(f);
  })),
  async () => {
    await use({}, async f => {
      f.el.readingCatalogLoad.click(); deep(f.loadArgs, [undefined]); f.publishCatalog(READY); f.el.readingCatalogNext.click(); deep(f.loadArgs, [undefined, 'cursor-stub']);
      const old = f.el.readingCatalogWorks.children[0].children[0]; f.el.readingCatalogWork.value = ITEM.workId; f.el.readingCatalogWork.fire('change'); eq(f.count.chooses, 1); old.click(); eq(f.count.chooses, 1);
      f.el.readingCatalogWorks.children[0].children[0].click(); eq(f.count.chooses, 2); eq(f.el.writerManuscriptWork.value, ITEM.workId);
      f.el.writerApprovedSectionBytes.dataset.readAuthRejected = 'true'; f.win.fire('creator:approved-section-auth-state'); eq(f.el.readingCatalogLogin.hidden, false);
      eq(f.count.fetch, 0); eq(f.count.nativeFetch, 0); eq(f.count.connects, 0);
    });
    await each([['cancel', 0], ['string', 0], ['confirm', 1], ['owner', 0], ['epoch', 0], ['raw', 0], ['retire', 0]], ([kind, expected]) => use({}, async f => {
      f.confirmHook = () => { if (kind === 'owner') f.owner = { ownerId: 'other-stub' }; if (kind === 'epoch') f.owner = { ownerId: 'owner-stub' }; if (kind === 'raw') f.raw = 'changed-stub'; if (kind === 'retire') f.seal(); return kind === 'cancel' ? false : kind === 'string' ? 'true' : true; };
      f.el.readingCatalogConnect.click(); eq(f.count.connects, expected); deep(f.connectArgs, expected ? [true] : []); eq(f.count.loads, 0); eq(f.count.fetch, 0); eq(f.count.writes, 0);
    }));
  },
  () => use({ loading: true }, async f => {
    noOperations(f); eq(f.timers.size, 0); f.win.fire('focus'); f.doc.fire('DOMContentLoaded'); f.doc.fire('DOMContentLoaded');
    eq(f.count.catalogCreate, 1); eq(f.count.authCreate, 1); eq(f.timers.size, 1);
    for (const locale of LOCALES) { f.locale(locale); f.win.fire('focus'); for (const type of ['storage', 'lumina:authchange', 'lumina:auth-expired', 'creator:approved-auth-connection-start', 'creator:approved-section-auth-state']) f.win.fire(type); f.tick(); }
    for (const time of ['expired', 'future', 'unknown']) { f.timeHint = time; f.lifetimeHint = 'nonpositive'; f.win.fire('focus'); eq(f.doc.documentElement.getAttribute('data-unverified-auth-time'), time); eq(f.doc.documentElement.getAttribute('data-unverified-auth-lifetime'), 'nonpositive'); }
    noOperations(f); A.ok(f.count.sync > 0); eq(f.scope, null); A.notEqual(status(f)[1], 'Sign-in connected');
  }),
  () => use({ popup: true }, async f => {
    eq(f.el.readingCatalog.hidden, true); eq(f.count.receiverStart, 1); eq(f.count.catalogCreate, 0); eq(f.count.authCreate, 0); noOperations(f);
    const api = f.win.LuminaCreatorStudioApi, gate = f.win.LuminaCreatorApprovedReadingScope;
    const scope = f.scope = { ...SCOPE }; f.receiverChange(scope); eq(gate.snapshot(), scope); eq(gate.isCurrent(scope), true); eq(await gate.validate(scope, { aborted: true }), false); eq(f.count.validations, 0);
    eq(await gate.validate(scope, { aborted: false }), true);
    const p = '/api/v1/me/creator-studio/stories/work-stub/generation-profile/approved-section-bytes?measurement=json-utf8-v1';
    await A.rejects(api.fetch('/wrong', { identity: f.owner })); await A.rejects(api.fetch(p, { identity: { ownerId: 'other' } })); eq(f.count.fetch, 0);
    eq((await api.fetch(p, { identity: f.owner })).status, 200); eq(f.count.fetch, 1);
    f.validateHook = () => { f.scope = null; return true; }; await A.rejects(api.fetch(p, { identity: f.owner })); eq(f.count.fetch, 1);
    f.seal(); eq(gate.snapshot(), null); eq(await gate.validate(scope, {}), false); await A.rejects(api.fetch(p, { identity: f.owner })); eq(f.count.fetch, 1); eq(f.count.nativeFetch, 0);
  }),
  () => each(LOCALES, locale => use({ locale }, async f => {
    f.publishCatalog(READY); f.publishAuth({ phase: 'connected', canConnect: false }); const old = f.el.readingCatalogWorks.children[0].children[0];
    f.seal(); deep(controls(f), [true, true, true, true]); eq(f.timers.size, 0); eq(f.win.LuminaCreatorApprovedReadingScope.snapshot(), null);
    f.publishAuth({ phase: 'connected', canConnect: true }); f.publishCatalog(READY);
    for (const language of LOCALES) { f.locale(language); f.win.fire('creator:approved-section-auth-state'); f.win.fire('focus'); f.win.fire('storage'); f.tick(); deep(controls(f), [true, true, true, true]); deep(status(f), ['', '']); eq(f.el.readingCatalogLogin.hidden, true); eq(f.el.readingCatalogRestart.hidden, true); }
    f.el.readingCatalogLoad.click(); f.el.readingCatalogNext.click(); f.el.readingCatalogConnect.click(); old.click();
    noOperations(f); eq(f.doc.documentElement.getAttribute('data-unverified-auth-time'), null); eq(f.doc.documentElement.getAttribute('data-unverified-auth-lifetime'), null); eq(f.dependenciesClosed(), true);
  }))
];
async function main() {
  protocol();
  for (let i = 0; i < GROUPS.length; i++) await test(GROUPS[i], { concurrency: false }, async () => {
    try { await bodies[i](); R.passed++; } catch (e) { R.failed++; R.failedGroups.push(GROUPS[i]); throw e; } finally { R.groups.push(GROUPS[i]); }
  });
  R.inputsStable = stable(); R.loadedModulesAdmitted = cacheGood && cacheOK(); R.resourcesClosed = closed;
  if (guards) { R.nativeGuards = { ...guards }; check(Object.values(guards).every(v => Number.isSafeInteger(v) && v === 0)); }
  R.complete = R.groups.length === GROUPS.length && R.inputsStable && R.loadedModulesAdmitted && closed && (!admission || realNow() < admission.deadlineUtcMs);
  if (!R.complete || R.failed) process.exitCode = 1;
  process.stdout.write('OWNER_READER_IDLE_STATUS_RESULT ' + JSON.stringify(R) + '\n');
}
main().catch(() => { R.complete = false; process.exitCode = 1; process.stderr.write('OWNER_READER_IDLE_STATUS_NOT_QUALIFIED\n'); process.stdout.write('OWNER_READER_IDLE_STATUS_RESULT ' + JSON.stringify(R) + '\n'); });

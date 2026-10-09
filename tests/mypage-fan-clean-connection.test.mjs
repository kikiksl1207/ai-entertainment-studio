import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../pages/mypage-titles.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/mypage.css', import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const lf = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).replace(/\r\n/g, '\n');
// Read-only CLEAN fragments were pinned after CRLF->LF only, independently of forward products.
const snapshots = Object.freeze({
  app: '4489be417124bd10b57da60da95daec1661528ebc75d0c03891714035dd390b0',
  appAuth: '96dbd8ce9100e2cad2183e936e6070ae55408a753a266ab43f15a2fdf1a926b7',
  appReady: 'c545e18a4623306fa780ed14e70958c39da706a72de7ed4f999a20638988e1e5',
  appI18n: '24be790bfcac2c334bf594f063fba01edda9162b1c9981a510dd6cb4589529ab',
  html: '0ed829c2ddfc02daa836627f97afbbafb138a7aa559447903909a14c3caa56f9',
  css: '1f83fcf68a3f4e0e8e1d114fe25eab2151b9d0ea074a0c9d8ebcca596770453d',
  htmlPrefix: 'aaa394f1cb5af7390bb6d64b0f5cd96ac2ab13008ffa0733cdff6d1854d8187d',
  htmlMiddle: 'f0a5144afddb9d67a6d426ae0a4f7f1bf58f9b5a87800edd7ff4f13fc3697910',
  htmlSuffix: '0d1368956eb9c4578de9196467a69b842d5aba383ff279238f1d4a647eb9ab04',
  cssPrefix: 'ffcebfab87b352c33980117c205bfd5493e21dcab98f7ba88447558bbb45f021',
  cssMiddle: 'fe89818bd3fdfe240fe48472faae0fb037f573f431293f6c8c652fd783eeca86',
  cssSuffix: 'fcf0bbb5a6268cb7dbe76f154d944528a8ca664e072d8542ead5ea38f19ed02f',
});
function baseline(variable, pin, fallback) {
  const file = process.env[variable] ? resolve(process.env[variable]) : fallback;
  if (!file) return null;
  const text = lf(readFileSync(file));
  assert.equal(sha(text), pin, variable + ' CRLF->LF source pin');
  return text;
}
const app = process.env.MYPAGE_FAN_BASELINE_APP
  ? baseline('MYPAGE_FAN_BASELINE_APP', snapshots.app)
  : lf(readFileSync(new URL('../app.js', import.meta.url)));
const beforeHtml = baseline('MYPAGE_FAN_BASELINE_HTML', snapshots.html);
const beforeCss = baseline('MYPAGE_FAN_BASELINE_CSS', snapshots.css);
const inlineScriptStart = '    <script>\n      (function () {\n        let mypageSummary = null;';
const accountCloseStart = '          const accountCloseButton = $("mypageDeleteAccountButton");';
const accountCloseEnd = '\n        }\n\n        let mypageInlineRefreshPromise = null;';
const legacyAccountCloseStub = [
  '          $("mypageDeleteAccountButton")?.addEventListener("click", () => {',
  '            const balance = $("mypageLuminaBalance")?.textContent || "0";',
  '            const confirmed = confirm(`회원 탈퇴를 진행할까요?\\n보유 중인 ${balance}L은 탈퇴와 함께 소멸돼요.`);',
  '            if (confirmed) alert("회원 탈퇴 API 연결 전입니다. 비밀번호 확인 화면이 붙으면 활성화할 수 있어요.");',
  '          });',
].join('\n');
// Only the separately authorized account-close binding is restored to its original stub.
// Pin that exact block first: fan ownership does not exempt adjacent HTML or arbitrary delete handlers.
const authorizedAccountCloseStubPin = 'a3b45442e22b6fa6d6a4856ad5b5317efa1a39dcb648a4ba7703b70a15029615';
function normalizeAccountCloseStub(value) {
  const legacyStart = legacyAccountCloseStub.split('\n')[0];
  const legacyCount = value.split(legacyStart).length - 1;
  const approvedCount = value.split(accountCloseStart).length - 1;
  assert.equal(legacyCount + approvedCount, 1, 'Exactly one original or approved account-close stub');
  if (legacyCount) {
    assert.equal(value.split(legacyAccountCloseStub).length - 1, 1, 'Exact original account-close stub');
    return value;
  }
  const start = value.indexOf(accountCloseStart), end = value.indexOf(accountCloseEnd, start);
  assert(end > start, 'Approved account-close stub end boundary');
  assert.equal(sha(value.slice(start, end)), authorizedAccountCloseStubPin, 'Exact approved account-close binding LF pin');
  return value.slice(0, start) + legacyAccountCloseStub + value.slice(end);
}
function fragment(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert(first >= 0 && last > first, 'Original source fragment boundaries');
  return app.slice(first, last);
}
const authSource = fragment('const API_BASE =', 'const I18N_LOCALES =');
const markReadySource = fragment('function markAppReady() {', 'async function init() {');
const i18nExportSource = fragment('window.luminaI18n = {', '\n  };');
assert.equal(sha(authSource), snapshots.appAuth, 'Consumed auth CRLF->LF source pin');
assert.equal(sha(markReadySource), snapshots.appReady, 'Consumed ready marker CRLF->LF source pin');
assert.equal(sha(i18nExportSource), snapshots.appI18n, 'Consumed i18n export CRLF->LF source pin');
assert.match(authSource, /_retryDepth === 0/);
assert.doesNotMatch(i18nExportSource, /whenReady/);
const tick = async () => { for (let i = 0; i < 48; i++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const auth = id => ({ user: { id }, accessToken: 'synthetic-access-' + id, refreshToken: 'synthetic-refresh-' + id });
const title = (code = 'A', extra = {}) => ({ code, status: 'active', equipped: false, canEquip: true,
  rarity: 'common', copy: { labels: { ko: { displayName: 'Synthetic ' + code } } }, ...extra });
const achievement = extra => ({ code: 'synthetic-earned', status: 'earned', earnedAt: '2026-10-08T00:00:00.000Z',
  progress: { current: 2, target: 2 }, copy: { labels: { ko: { title: 'Synthetic record', description: 'Synthetic description' } } }, ...extra });
function summary(items = [title()]) {
  return { generatedAt: '2026-10-08T00:00:00.000Z',
    points: { balance: 12, lifetimeEarned: 14, cashLike: false, transferable: false, settlementEligible: false, luminaConvertible: false },
    participationSummary: { completedTodayCount: 1, currentStreakDays: 2, totalAcceptedCount: 3 },
    achievements: [achievement()], titles: { items, equipped: items.find(row => row.equipped) || null } };
}
const titleIds = ['mypageTitleChips', 'mypageTitleHeading', 'mypageTitleFilter', 'mypageEquippedTitle', 'mypageTitleEmpty', 'mypageTitleFoot', 'mypageTitlesRetry'];
const valueIds = ['mypageFanBalance', 'mypageFanEarned', 'mypageFanToday', 'mypageFanStreak', 'mypageFanAccepted'];
const fanIds = ['mypageFanHeading', 'mypageFanBalanceLabel', 'mypageFanEarnedLabel', 'mypageFanTodayLabel', 'mypageFanStreakLabel', 'mypageFanAcceptedLabel', 'mypageFanStatus', 'mypageFanRetry', ...valueIds];
const achievementIds = ['mypageAchievementHeading', 'mypageAchievementList', 'mypageAchievementStatus', 'mypageAchievementRetry'];
function events() {
  const handlers = new Map();
  return {
    addEventListener(type, callback) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(callback); },
    removeEventListener(type, callback) { handlers.get(type)?.delete(callback); },
    dispatchEvent(event) { for (const callback of [...(handlers.get(event.type) || [])]) callback(event); return true; },
  };
}
function harness({ account = 'A', ready = true, readiness, native = false, missing, noObserver = false } = {}) {
  const timers = new Map(), observers = new Set(), requests = [], transports = [];
  let time = 0, timerId = 0, language = 'ko', context, document;
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, events()); this.tag = tag; this.children = []; this.parentNode = null;
      this.dataset = {}; this.attributes = {}; this.hidden = false; this.disabled = false; this.text = '';
      const names = new Set();
      const notify = () => { for (const observer of [...observers]) if (observer.target === this) observer.callback(); };
      this.classList = {
        contains: name => names.has(name),
        add: (...values) => { values.forEach(value => names.add(value)); notify(); },
        remove: (...values) => { values.forEach(value => names.delete(value)); notify(); },
        toggle: (name, on = !names.has(name)) => { if (on) names.add(name); else names.delete(name); notify(); return on; },
      };
    }
    get isConnected() { return this === document?.body || this === document?.documentElement || !!this.parentNode?.isConnected; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this.text = String(value); }
    set innerHTML(_) { throw new Error('No raw HTML in isolated fixture'); }
    append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.text = ''; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    querySelectorAll(selector) { return this.children.filter(child => selector === '[data-title-filter]' ? child.dataset.titleFilter : child.dataset.titleCode); }
    closest(selector) { return selector === '[data-title-code]' && this.dataset.titleCode ? this : selector === '[data-title-filter]' && this.dataset.titleFilter ? this : this.parentNode?.closest(selector) || null; }
    focus() { document.activeElement = this; }
    click() {
      if (this.disabled || !this.isConnected) return;
      const event = { type: 'click', target: this, preventDefault() {} };
      for (let node = this; node; node = node.parentNode) node.dispatchEvent(event);
    }
  }
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { assert.deepEqual(clone(options), { attributes: true, attributeFilter: ['class'] }); this.target = target; observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  document = { ...events(), readyState: 'loading', body: new Element('body'), documentElement: new Element('html'), activeElement: null };
  const elements = new Map([...titleIds, ...fanIds, ...achievementIds].map(id => [id, new Element()]));
  if (missing) elements.delete(missing);
  document.body.append(...elements.values());
  const filters = ['all', 'owned', 'locked', 'rare'].map(value => { const button = new Element('button'); button.dataset.titleFilter = value; return button; });
  elements.get('mypageTitleFilter')?.append(...filters);
  document.getElementById = id => elements.get(id) || null;
  document.createElement = tag => new Element(tag);
  document.querySelectorAll = selector => selector === '#mypageTitleFilter [data-title-filter]' ? filters : [];
  if (ready) document.documentElement.classList.add('is-ready');
  const storage = new Map(account ? [['lumina_auth', JSON.stringify(auth(account))]] : []);
  const localStorage = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const window = { ...events(), luminaI18n: { getLocale: () => language, t: key => key } };
  if (readiness) window.luminaI18n.whenReady = readiness;
  const fakeFetch = async (url, options) => {
    assert.match(url, /^https:\/\/api\.lumina-stage\.com\/api\/v1\/(?:me\/fan-engagement\/(?:summary\?locale=[^&]+|title)|auth\/refresh)$/);
    const pending = deferred(); transports.push({ path: new URL(url).pathname, method: options.method, pending });
    return pending.promise;
  };
  context = vm.createContext({ document, window, localStorage, Date, Intl, URL, URLSearchParams, AbortController,
    Event: class { constructor(type) { this.type = type; } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    MutationObserver: noObserver ? undefined : Observer,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: time + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, fetch: fakeFetch,
    console: { info() {}, warn() {}, error() {} },
  });
  // Execute only original auth/session helpers and the original ready marker, not App initialization.
  vm.runInContext(authSource + '\n' + markReadySource, context, { filename: 'pinned-clean-auth-and-marker.js' });
  if (!native) context.apiFetch = (path, options = {}, retryDepth) => {
    assert.match(path, /^\/api\/v1\/me\/fan-engagement\/(?:summary\?locale=[^&]+|title)$/);
    assert.equal(options.auth, true); assert.equal(options.throwOnError, true);
    const pending = deferred(); requests.push({ path, options: clone(options), retryDepth, ...pending }); return pending.promise;
  };
  vm.runInContext(source, context, { filename: 'forward-mypage-titles.js' });
  return { context, document, elements, requests, transports, timers, observers, api: window.LuminaMypageTitles,
    text: id => elements.get(id).textContent, rows: () => elements.get('mypageTitleChips').children,
    auth: id => context.setAuth(id ? auth(id) : null),
    ready(locale = language) { language = locale; vm.runInContext('markAppReady();', context); },
    locale(value) { language = value; window.dispatchEvent({ type: 'lumina:localechange' }); },
    storageAuth(id) { if (id) storage.set('lumina_auth', JSON.stringify(auth(id))); else storage.delete('lumina_auth'); window.dispatchEvent({ type: 'storage', key: 'lumina_auth' }); },
    advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    async response(index, status, body) { transports[index].pending.resolve({ status, ok: status >= 200 && status < 300, json: async () => body }); await tick(); },
  };
}
async function loaded(h, data = summary()) {
  const index = h.requests.length, pending = h.api.load(); await tick();
  assert.equal(h.requests.length, index + 1); h.requests[index].resolve(data); await pending; await tick(); return h;
}
function blank(h) { for (const id of valueIds) assert.equal(h.text(id), ''); }

test('SOURCE: three products preserve CLEAN outside owned HTML/CSS boundaries; no preview catalog renderer', () => {
  const after = html.replace(/\r\n/g, '\n'), style = css.replace(/\r\n/g, '\n');
  const newStart = after.indexOf('              <section class="mypage-fan-summary"');
  const wallet = '            <section class="mypage-panel" data-mypage-panel="wallet" id="wallet">';
  const appTag = '    <script src="/app.js"></script>\n';
  const rest = inlineScriptStart;
  const walletStart = after.indexOf(wallet), appEnd = after.indexOf(appTag) + appTag.length, restStart = after.indexOf(rest);
  assert(newStart > 0 && walletStart > newStart && appEnd > walletStart && restStart > appEnd);
  const prefix = after.slice(0, newStart), middle = after.slice(walletStart, appEnd), suffix = normalizeAccountCloseStub(after.slice(restStart));
  assert.equal(sha(prefix), snapshots.htmlPrefix);
  assert.equal(sha(middle), snapshots.htmlMiddle);
  assert.equal(sha(suffix), snapshots.htmlSuffix);
  if (beforeHtml !== null) {
    const oldStart = beforeHtml.indexOf('              <!-- #204 v1 + #248');
    assert(oldStart > 0);
    assert.equal(prefix, beforeHtml.slice(0, oldStart));
    assert.equal(middle, beforeHtml.slice(beforeHtml.indexOf(wallet), beforeHtml.indexOf(appTag) + appTag.length));
    assert.equal(suffix, beforeHtml.slice(beforeHtml.indexOf(rest)));
  }
  assert.doesNotMatch(after, /renderTitleChipsPreview|data-title-filter="suggested"/);
  assert.equal((after.match(/src="\/pages\/mypage-titles\.js"/g) || []).length, 1);
  for (const id of [...titleIds, ...fanIds, ...achievementIds]) assert.equal((after.match(new RegExp('\\bid="' + id + '"', 'g')) || []).length, 1, id);
  const buttons = style.indexOf('.mypage-title-chips button.mypage-title-chip {'), next = style.indexOf('\n.mypage-title-chip {', buttons) + 1;
  const activity = style.indexOf('.mypage-fan-summary {'), media = style.indexOf('@media (max-width: 640px) {\n  /*', activity);
  assert(buttons > 0 && next > buttons && activity > next && media > activity);
  const cssPrefix = style.slice(0, buttons), cssMiddle = style.slice(next, activity), cssSuffix = style.slice(media);
  assert.equal(sha(cssPrefix), snapshots.cssPrefix);
  assert.equal(sha(cssMiddle), snapshots.cssMiddle);
  assert.equal(sha(cssSuffix), snapshots.cssSuffix);
  const recovered = cssPrefix + cssMiddle + cssSuffix;
  assert.equal(sha(recovered), snapshots.css);
  if (beforeCss !== null) assert.equal(recovered, beforeCss);
  assert.doesNotMatch(source, /\.innerHTML|LuminaAchievementTitles|initI18n\(|setLocale\(|localStorage|fetch\(/);
});

test('SOURCE: exact approved account-close binding restores the original suffix pin; legacy stub is unchanged', () => {
  const after = html.replace(/\r\n/g, '\n'), suffix = after.slice(after.indexOf(inlineScriptStart));
  assert(suffix.includes(accountCloseStart));
  const original = normalizeAccountCloseStub(suffix);
  assert.notEqual(suffix, original);
  assert.equal(sha(original), snapshots.htmlSuffix);
  assert.equal(normalizeAccountCloseStub(original), original);
});

for (const [label, from, to] of [
  ['module path', '/assets/js/mypage-account-close.js', '/assets/js/unapproved-account-close.js'],
  ['session guard', 'sessionCurrent: session => authRequestSessionCurrent(session)', 'sessionCurrent: () => true'],
  ['selected API options', 'apiFetch(path, options)', 'apiFetch(path, options, 0)'],
]) test('SOURCE: account-close normalization rejects unapproved ' + label, () => {
  const after = html.replace(/\r\n/g, '\n'), suffix = after.slice(after.indexOf(inlineScriptStart));
  assert(suffix.includes(from));
  assert.throws(() => normalizeAccountCloseStub(suffix.replace(from, to)), /Exact approved account-close binding LF pin/);
});

test('SOURCE: account-close normalization rejects missing, duplicated, mixed or widened stubs', () => {
  const after = html.replace(/\r\n/g, '\n'), suffix = after.slice(after.indexOf(inlineScriptStart));
  const start = suffix.indexOf(accountCloseStart), end = suffix.indexOf(accountCloseEnd, start);
  const block = suffix.slice(start, end);
  assert.throws(() => normalizeAccountCloseStub(suffix.replace(block, '')), /Exactly one/);
  assert.throws(() => normalizeAccountCloseStub(suffix.replace(block, block + '\n' + block)), /Exactly one/);
  assert.throws(() => normalizeAccountCloseStub(suffix + '\n' + legacyAccountCloseStub), /Exactly one/);
  assert.throws(() => normalizeAccountCloseStub(suffix.replace(accountCloseEnd, '\n          // Unexpected extra binding\n' + accountCloseEnd)), /LF pin/);
  assert.throws(() => normalizeAccountCloseStub(suffix.replace(accountCloseEnd, '\n        }\n')), /end boundary/);
  const original = normalizeAccountCloseStub(suffix);
  assert.throws(() => normalizeAccountCloseStub(original.replace('if (confirmed) alert(', 'if (confirmed) confirm(')), /Exact original/);
});

test('SOURCE: inline changes before and after the approved account-close block still break the original suffix pin', () => {
  const after = html.replace(/\r\n/g, '\n'), suffix = after.slice(after.indexOf(inlineScriptStart));
  for (const [from, to] of [
    ['let mypageSummary = null;', 'let mypageSummary = undefined;'],
    ['window.refreshMypageInlineData = refreshMypageInlineData;', 'window.refreshMypageInlineData = undefined;'],
  ]) {
    assert(suffix.includes(from));
    const changed = normalizeAccountCloseStub(suffix.replace(from, to));
    assert.notEqual(sha(changed), snapshots.htmlSuffix, from);
  }
});

test('SOURCE: account-close normalization preserves the existing CRLF-to-LF comparison policy', () => {
  const after = html.replace(/\r\n/g, '\n'), suffix = after.slice(after.indexOf(inlineScriptStart));
  const fromCRLF = lf(Buffer.from(suffix.replace(/\n/g, '\r\n'), 'utf8'));
  assert.equal(fromCRLF, suffix);
  assert.equal(sha(normalizeAccountCloseStub(fromCRLF)), snapshots.htmlSuffix);
});

test('CLEAN marker readiness delays and coalesces summary until the resolved locale; observer/timer cleanup', async () => {
  const h = harness({ ready: false }), first = h.api.load(), second = h.api.load(); await tick();
  assert.equal(h.requests.length, 0); assert.equal(h.observers.size, 1); assert.equal(h.timers.size, 1);
  h.ready('en'); await tick(); assert.equal(h.requests.length, 1); assert.match(h.requests[0].path, /locale=en$/);
  h.requests[0].resolve(summary()); await Promise.all([first, second]);
  assert.equal(h.observers.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.text('mypageFanBalance'), '12');
});

test('optional native whenReady remains bounded and rejected readiness is not a successful bootstrap', async () => {
  const ready = deferred(), h = harness({ ready: false, readiness: () => ready.promise }), pending = h.api.load(); await tick();
  assert.equal(h.requests.length, 0); assert.equal(h.observers.size, 0);
  ready.resolve(); await tick(); h.requests[0].resolve(summary()); await pending; assert.equal(h.timers.size, 0);
  const failed = harness({ readiness: () => Promise.reject(new Error('Synthetic ready rejection')) }); await failed.api.load();
  assert.equal(failed.requests.length, 0); blank(failed); assert.equal(failed.elements.get('mypageFanRetry').hidden, false);
  const malformed = harness({ readiness: () => undefined }); await malformed.api.load();
  assert.equal(malformed.requests.length, 0); assert.equal(malformed.timers.size, 0);
  const stalled = harness({ readiness: () => new Promise(() => {}) }), waiting = stalled.api.load(); await tick();
  stalled.advance(30000); await waiting; assert.equal(stalled.requests.length, 0); assert.equal(stalled.timers.size, 0);
});

test('CLEAN marker timeout and absent observer fail closed, then explicit retry can recover', async () => {
  const h = harness({ ready: false }), pending = h.api.load(); await tick(); h.advance(30000); await pending;
  assert.equal(h.requests.length, 0); blank(h); assert.equal(h.observers.size, 0); assert.equal(h.timers.size, 0);
  h.ready(); await loaded(h); assert.equal(h.text('mypageFanBalance'), '12');
  const unavailable = harness({ ready: false, noObserver: true }); await unavailable.api.load();
  assert.equal(unavailable.requests.length, 0); assert.equal(unavailable.timers.size, 0);
});

test('logout/new account during readiness retires epoch and permits only the new account GET', async () => {
  const h = harness({ ready: false }), pending = h.api.load(); await tick(); h.auth(null); await tick();
  assert.equal(h.observers.size, 0); assert.equal(h.timers.size, 0); blank(h);
  h.auth('B'); await tick(); assert.equal(h.observers.size, 1); h.ready(); await tick();
  assert.equal(h.requests.length, 1); h.requests[0].resolve(summary([])); await pending; await tick();
  assert.equal(h.text('mypageFanBalance'), '12'); assert.equal(h.rows().length, 0);
});

test('actual legacy CLEAN title shape stays unavailable without wiping valid activity/achievements or inventing flags', async () => {
  const data = summary(); delete data.titles.items[0].equipped; delete data.titles.items[0].canEquip;
  const h = await loaded(harness(), data); assert.equal(h.text('mypageFanBalance'), '12');
  assert.match(h.text('mypageAchievementList'), /Synthetic record/); assert.equal(h.rows().length, 0);
  assert.equal(h.elements.get('mypageTitlesRetry').hidden, false); await h.api.select('A'); assert.equal(h.requests.length, 1);
});

test('malformed lanes remain independent and invalid title flags cannot authorize a PATCH', async () => {
  for (const mutate of [data => { data.titles.items[0].canEquip = 'true'; }, data => { delete data.titles.equipped; },
    data => { data.titles.items.push(clone(data.titles.items[0])); }, data => { data.titles.items[0].status = 'revoked'; }]) {
    const data = summary(); mutate(data); const h = await loaded(harness(), data);
    assert.equal(h.rows().length, 0); assert.equal(h.text('mypageFanBalance'), '12');
    assert.match(h.text('mypageAchievementList'), /Synthetic record/); await h.api.select('A'); assert.equal(h.requests.length, 1);
  }
  const data = summary(); data.points.balance = '12'; const h = await loaded(harness(), data);
  blank(h); assert.equal(h.rows().length, 1); assert.match(h.text('mypageAchievementList'), /Synthetic record/);
  const bad = summary(); bad.achievements[0].earnedAt = 'invalid'; const a = await loaded(harness(), bad);
  assert.equal(a.text('mypageAchievementList'), ''); assert.equal(a.text('mypageFanBalance'), '12'); assert.equal(a.rows().length, 1);
});

test('missing/non-JSON summary and 401/500 never become fake zero or ownership; manual GET recovers', async () => {
  for (const value of [null, {}, { titles: { items: [], equipped: null } }]) {
    const h = await loaded(harness(), value); blank(h); assert.equal(h.text('mypageAchievementList'), '');
  }
  for (const status of [401, 500]) {
    const h = await loaded(harness()), pending = h.api.load(); await tick();
    h.requests.at(-1).reject({ status, message: 'SYNTHETIC_PRIVATE_ERROR' }); await pending;
    blank(h); assert.equal(h.rows().length, 0); assert.equal(h.text('mypageAchievementList'), '');
    assert.doesNotMatch(h.document.body.textContent, /SYNTHETIC_PRIVATE_ERROR/);
    await loaded(h); assert.equal(h.text('mypageFanBalance'), '12');
  }
});

test('verified zero/empty is distinct from failure and ignores catalog suggestions', async () => {
  const h = harness(), data = summary([]); data.achievements = [];
  for (const key of ['balance', 'lifetimeEarned']) data.points[key] = 0;
  for (const key of Object.keys(data.participationSummary)) data.participationSummary[key] = 0;
  h.context.window.LuminaAchievementTitles = { titles: [{ code: 'FAKE_OWNERSHIP' }] };
  await loaded(h, data); for (const id of valueIds) assert.equal(h.text(id), '0');
  assert.equal(h.elements.get('mypageTitleEmpty').hidden, false); assert.equal(h.elements.get('mypageAchievementRetry').hidden, true);
  assert.equal(h.rows().length, 0); assert.doesNotMatch(h.document.body.textContent, /FAKE_OWNERSHIP/);
});

test('explicit PATCH uses depth1 and only a fresh matching summary confirms the equipped title', async () => {
  const h = await loaded(harness()), pending = h.api.select('A'); await tick();
  assert.equal(h.requests[1].options.method, 'PATCH'); assert.deepEqual(h.requests[1].options.body, { titleCode: 'A' });
  assert.equal(h.requests[1].retryDepth, 1); assert.equal(h.requests[1].path, '/api/v1/me/fan-engagement/title');
  await h.api.select('A'); assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ equipped: { code: 'A' } }); await tick();
  assert.equal(h.requests.length, 3); assert.match(h.requests[2].path, /\/summary\?/);
  assert.doesNotMatch(h.text('mypageTitleFoot'), /저장됐/);
  h.requests[2].resolve(summary([title('A', { equipped: true })])); await pending;
  assert.match(h.text('mypageTitleFoot'), /저장됐/); assert.match(h.text('mypageEquippedTitle'), /Synthetic A/);
});

test('lost/failed write acknowledgement locks selection until confirmed fresh GET; no automatic write repeat', async () => {
  const h = await loaded(harness()), pending = h.api.select('A'); await tick(); h.requests[1].reject({ status: 500 }); await tick();
  h.requests[2].reject({ status: 500 }); await pending; await h.api.select('A'); assert.equal(h.requests.length, 3);
  assert(h.rows().every(row => row.disabled)); await loaded(h, summary([title('A', { equipped: true })]));
  assert.match(h.text('mypageEquippedTitle'), /Synthetic A/); assert.equal(h.requests.filter(row => row.options.method === 'PATCH').length, 1);
  const unchanged = await loaded(harness()), write = unchanged.api.select('A'); await tick();
  unchanged.requests[1].resolve({ equipped: { code: 'A' } }); await tick(); unchanged.requests[2].resolve(summary()); await write;
  assert.match(unchanged.text('mypageTitleFoot'), /변경되지/);
});

test('late old GET resolve/reject and identical-token logout/login cannot overwrite the new epoch', async () => {
  for (const reject of [false, true]) {
    const h = harness(), pending = h.api.load(); await tick(); h.auth(null); h.auth('A'); await tick();
    h.requests[1].resolve(summary([title('NEW')])); await tick();
    if (reject) h.requests[0].reject({ status: 500 }); else h.requests[0].resolve(summary([title('OLD')]));
    await pending; assert.equal(h.rows()[0].dataset.titleCode, 'NEW'); assert.doesNotMatch(h.document.body.textContent, /Synthetic OLD/);
  }
});

test('ambiguous response followed by an old valid snapshot keeps intent locked until matching state or account retirement', async () => {
  const h = await loaded(harness()), pending = h.api.select('A'); await tick();
  h.requests[1].reject(new Error('Synthetic lost acknowledgement')); await tick();
  h.requests[2].resolve(summary()); await pending;
  assert.match(h.text('mypageTitleFoot'), /확인하지 못/);
  assert.doesNotMatch(h.text('mypageTitleFoot'), /변경되지/);
  assert(h.rows().every(row => row.disabled));
  await h.api.select('A'); assert.equal(h.requests.length, 3);
  await loaded(h, summary());
  assert.match(h.text('mypageTitleFoot'), /확인하지 못/);
  await h.api.select('A'); assert.equal(h.requests.filter(row => row.options.method === 'PATCH').length, 1);
  await loaded(h, summary([title('A', { equipped: true }), title('B')]));
  assert.match(h.text('mypageTitleFoot'), /저장됐/);
  assert.equal(h.rows().find(row => row.dataset.titleCode === 'B').disabled, false);
  h.auth('B'); await tick(); h.requests.at(-1).resolve(summary([title('B')])); await tick();
  assert.equal(h.rows()[0].dataset.titleCode, 'B'); assert.equal(h.rows()[0].disabled, false);
});

test('late old PATCH and retained DOM cannot mutate or reconcile the new account', async () => {
  const h = await loaded(harness()), retained = h.rows()[0], pending = h.api.select('A'); await tick();
  h.storageAuth('B'); await tick(); h.requests[2].resolve(summary([title('B')])); await tick();
  const count = h.requests.length;
  h.elements.get('mypageTitleChips').dispatchEvent({ type: 'click', target: retained }); await tick();
  assert.equal(h.requests.length, count); h.requests[1].resolve({ equipped: { code: 'A' } }); await pending;
  assert.equal(h.requests.length, count); assert.equal(h.rows()[0].dataset.titleCode, 'B');
});

test('native pinned apiFetch PATCH401 makes exactly one write and no auth refresh/replay; GET readback remains authoritative', async () => {
  const h = harness({ native: true }), initial = h.api.load(); await tick(); await h.response(0, 200, summary()); await initial;
  const pending = h.api.select('A'); await tick(); await h.response(1, 401, { message: 'Synthetic expired access' });
  assert.equal(h.transports[2].method, 'GET'); await h.response(2, 200, summary()); await pending;
  assert.equal(h.transports.filter(row => row.method === 'PATCH').length, 1);
  assert.equal(h.transports.filter(row => row.path === '/api/v1/auth/refresh').length, 0);
  assert.match(h.text('mypageTitleFoot'), /변경되지/);
});

test('native pinned GET401 refresh rotation keeps one owner epoch and applies only its valid result', async () => {
  const h = harness({ native: true }), pending = h.api.load(); await tick(); await h.response(0, 401, {});
  assert.equal(h.transports[1].path, '/api/v1/auth/refresh');
  await h.response(1, 200, { ...auth('A'), accessToken: 'synthetic-rotated-access', refreshToken: 'synthetic-rotated-refresh' });
  assert.equal(h.transports[2].method, 'GET'); await h.response(2, 200, summary()); await pending;
  assert.equal(h.text('mypageFanBalance'), '12'); assert.equal(h.rows().length, 1);
  h.auth(null); blank(h); assert.equal(h.rows().length, 0); assert.equal(h.text('mypageAchievementList'), '');
});

test('five locale labels and hostile title/achievement content remain DOM text without more requests', async () => {
  const attack = '<img src=x onerror=alert(1)>', data = summary([title('A', { copy: { labels: { ko: { displayName: attack } } } })]);
  data.achievements = [achievement({ copy: { labels: { ko: { title: attack, description: '<script>synthetic</script>' } } } })];
  const h = await loaded(harness(), data);
  for (const [locale, label] of [['ko', '\uD32C \uD65C\uB3D9'], ['en', 'Fan activity'], ['ja', '\u30D5\u30A1\u30F3\u6D3B\u52D5'], ['zh-Hans', '\u7C89\u4E1D\u6D3B\u52A8'], ['zh-Hant', '\u7C89\u7D72\u6D3B\u52D5']]) {
    h.locale(locale); assert.equal(h.text('mypageFanHeading'), label); assert.equal(h.rows()[0].children[0].textContent, attack);
    assert.match(h.text('mypageAchievementList'), /<img src=x onerror=alert\(1\)>/);
  }
  assert.equal(h.requests.length, 1);
  const absent = harness({ missing: 'mypageTitlesRetry' }); assert.equal(absent.api, undefined); assert.equal(absent.requests.length, 0);
});

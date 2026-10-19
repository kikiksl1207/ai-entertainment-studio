'use strict';
const { restoreOwnedLoginDelta } = require('./support/auth-login-failclosed-inverse-20261017.cjs');
const { htmlWithoutFeedLightboxCacheDelta } = require('./support/feed-search-locale-html-inverse-20261015.cjs');
const { feedWithoutRepostComposerLifetimeDelta } = require('./support/feed-repost-composer-lifetime-inverse-20261019.cjs');
// AUTHOR UNRUN. Whole consumer with synthetic dependencies; no old suite imports.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const PROFILE = process.env.LUMINA_FEED_LOCALE_PROFILE || 'current';
const SELECTED = process.env.LUMINA_FEED_LOCALE_CASES || 'all';
assert(['baseline', 'current'].includes(PROFILE)); assert(['first', 'all'].includes(SELECTED));
const root = path.resolve(process.env.LUMINA_FEED_LOCALE_SOURCE_ROOT || path.join(__dirname, '..'));
if (!process.env.LUMINA_FEED_LOCALE_SOURCE_ROOT) {
  assert(!['e:/codex/luminastage/ai-entertainment-studio-git', 'e:/codex/luminastage/story-completion-20261003']
    .includes(root.replace(/\\/g, '/').toLowerCase()), 'Shared checkout requires an explicit admitted source root');
}
const PINS = { baseline: {
  "pages/lumina-feed.js": [
    [
      "6cf281501104f0dd32e8f3c817a2784281fe62392c7060be86ac7382ad47df5d",
      "4432e8fe7aaf8ca9f11ccb60d78df00d049a8518"
    ],
    [
      "dfe69b1d7ab0e9459922eeb6f2f1706630afa9d452b8f0e4a378cb6ee5bba8c1",
      "3ce9a2c144fdd68d43c39e320f6931140ebff4e4"
    ]
  ],
  "lumina-feed/index.html": [
    [
      "d96758293441989728c303b98280e502cbf43a62d458049c7bb4acd9c721753b",
      "c40eecdf38f35093c4b54c49f1b00080f451e3e4"
    ],
    [
      "5b2a9db0750784378edf7b112b6ceda1eb7016ca77e0c8375e052a83ae3766fd",
      "7b55d605fe648369c20c9376573738bf1fded61d"
    ]
  ],
  "app.js": [
    [
      "a1d791ee7ba4fce5e5777777d5326147a1f0a3ae32f90ce38728a9ec40ec9f1b",
      "83a6937820eee028efdeb9817490fe979b797c56"
    ],
    [
      "c49eb83c89d77e6e393a67dc1abf78a7ed81375d959b4b753593703e21c3694e",
      "06f5b0e24229023ef27b9a40e143402e85eece70"
    ]
  ]
}, current: {
  "pages/lumina-feed.js": [
    [
      "ee7c440a7e84c54924c686b6c0016f690247f53b90ec076714ecba860b499fbe",
      "eaa0ffbbae0cd3b7b0121b0c79a92d4244bcbcb5"
    ],
    [
      "c696fd62e8516534248e9b0aac76f25cb2365ab0e839030e2d81f1b3f4755687",
      "b9baeb1796c723d05ee31088f152717f90c42c97"
    ]
  ],
  "lumina-feed/index.html": [
    [
      "d778963f9f2fd7b9f410472ca434ba9a3bdf0b1e6c8c989b997599d5767a8d15",
      "b1ff4c312396da36f63f9d38157332e0fc37995f"
    ],
    [
      "cb8c3607863b8b1b7e7da48432a7fbf0aa2a9cf2d100bba0f378a04e972fee61",
      "0d67f642c7d4cfdda4b0f338a93ebb3b5e5bcf42"
    ]
  ],
  "app.js": [
    [
      "1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87",
      "7c3a65b55c3e2f12623d3f782663c2e2233243a5"
    ],
    [
      "c0dde13eca015b3fdd2c775b8c01fee7f75a4e3000ef486f7a9190003864744f",
      "b95bae7a9d1cdf0becee90a89e460b00a7c5188f"
    ]
  ]
} };
function readSource(file) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert(bytes.length > 0 && bytes.length <= 524288);
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert(!/\r(?!\n)/.test(text) && !(text.includes('\r\n') && /(?<!\r)\n/.test(text)));
  const pinView = file === 'app.js' ? restoreOwnedLoginDelta(text) :
    file === 'lumina-feed/index.html' ? htmlWithoutFeedLightboxCacheDelta(text) :
    file === 'pages/lumina-feed.js' ? feedWithoutRepostComposerLifetimeDelta(text) : text;
  const pinBytes = file === 'app.js' || file === 'lumina-feed/index.html' || file === 'pages/lumina-feed.js' ? Buffer.from(pinView) : bytes;
  const sha = createHash('sha256').update(pinBytes).digest('hex');
  const blob = createHash('sha1').update('blob ' + pinBytes.length + '\0').update(pinBytes).digest('hex');
  assert(PINS[PROFILE][file].some(pair => pair[0] === sha && pair[1] === blob), 'Exact source SHA/blob pair required');
  return text;
}
const page = readSource('pages/lumina-feed.js'), html = readSource('lumina-feed/index.html'), app = readSource('app.js');
const cache = PROFILE === 'baseline' ? 'feed-search-owner-20261009-deadline-20261011' : 'feed-search-locale-20261015';
const pageLfBytes = Buffer.from(page.replace(/\r\n/g, '\n'), 'utf8');
const repostCache = PROFILE === 'current' && pageLfBytes.length === 140113
  && createHash('sha256').update(pageLfBytes).digest('hex') === '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4'
  && createHash('sha1').update('blob ' + pageLfBytes.length + '\0').update(pageLfBytes).digest('hex') === '4698f985e99ee52f0a630984cdf51f75c36c7f3a'
  ? '&amp;content=29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4' : '';
assert.equal((html.match(/<script\b[^>]*src="\/pages\/lumina-feed\.js(?:\?[^"<>]*)?"[^>]*><\/script>/g) || []).length, 1);
assert(html.includes('<script src="/pages/lumina-feed.js?v=' + cache + repostCache + '"></script>'));
for (const id of ['luminaFeedList', 'feedSearchInput', 'feedTrendList', 'feedHashtagList']) {
  assert.equal(html.split('id="' + id + '"').length - 1, 1, 'Actual selected HTML control must exist once');
}
function section(text, begin, end) {
  assert.equal(text.split(begin).length, 2); assert.equal(text.split(end).length, 2);
  const start = text.indexOf(begin), finish = text.indexOf(end, start + begin.length);
  assert(start >= 0 && finish > start); return text.slice(start, finish);
}
const shared = [
  section(app, 'let _luminaFeedItems =', 'function feedEscapeHtml('),
  section(app, 'function feedEscapeHtml(', 'function normalizeFeedAuthorType('),
  section(app, 'function normalizeFeedAuthorType(', 'function buildUserProfileUrl('),
  section(app, 'function normalizeFeedThread(', 'let _feedEditModalEl ='),
  section(app, 'function renderFeedPostThreadBadge(', 'const statusMeta ='),
].join('\n');
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); await new Promise(setImmediate); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function target() {
  const listeners = new Map();
  return { addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatchEvent(event) { for (const callback of [...(listeners.get(event.type) || [])]) callback(event); return true; } };
}
function element(id) {
  return { ...target(), id, innerHTML: '', textContent: '', value: '', dataset: {}, hidden: false,
    disabled: false, isConnected: true, attributes: {}, style: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    closest() { return null; }, focus() {} };
}
const payload = marker => ({ items: [{ id: 'synthetic-' + marker, postType: 'fan_post',
  authorType: 'fan', authorName: 'Synthetic author', body: marker, assets: [], viewer: {} }] });
async function harness(t, locale = 'en-US') {
  const window = target(), document = { ...target(), readyState: 'loading', hidden: false };
  const nodes = new Map(['luminaFeedList', 'feedSearchInput', 'feedTrendList', 'feedHashtagList',
    'feedTrendStatus', 'feedHashtagStatus', 'feedTrendLocaleLabel'].map(id => [id, element(id)]));
  Object.assign(document, { getElementById: id => nodes.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [], createElement: () => element('synthetic-created') });
  const calls = [], timers = new Map(); let timerId = 0, forbiddenWrites = 0, warningCount = 0;
  const auth = Object.freeze({ accessToken: 'synthetic-memory-access', user: Object.freeze({ id: 'synthetic-owner' }) });
  function setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }
  function apiFetch(route, options = {}) {
    assert.equal(options.method || 'GET', 'GET', 'Only synthetic GET dependencies are allowed');
    assert.equal(options.throwOnError, true); assert.equal(options.body, undefined); assert.equal(options.headers, undefined);
    const url = new URL(route, 'https://synthetic.invalid');
    assert.equal(url.origin, 'https://synthetic.invalid');
    const kind = url.pathname === '/api/v1/lumina-feed/search' ? 'search'
      : url.pathname === '/api/v1/lumina-feed/trending-searches' ? 'trends'
      : url.pathname === '/api/v1/lumina-feed/hashtags' ? 'hashtags' : null;
    assert(kind, 'No auth/settings/provider/list/write route is admitted');
    if (kind !== 'search') {
      assert.equal(options.auth, undefined);
      calls.push({ kind, route, settled: true });
      return Promise.resolve({ items: [{ keyword: 'synthetic-discovery', rank: 1, searchCount: 1 }] });
    }
    assert.equal(options.auth, true);
    assert.deepEqual([...url.searchParams.keys()].sort(), ['language', 'q', 'take', 'type']);
    assert.equal(url.searchParams.get('take'), '30');
    const header = deferred(); let controller, headersSent = false, bodySent = false;
    const record = { kind, route, language: url.searchParams.get('language'), query: url.searchParams.get('q'),
      settled: false, bodyStarted: false,
      headers(status = 200) {
        assert(!headersSent); headersSent = true;
        header.resolve(new Response(new ReadableStream({ start(value) { controller = value; } }),
          { status, headers: { 'Content-Type': 'application/json' } }));
      },
      body(value) {
        assert(headersSent && !bodySent); bodySent = true;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(value))); controller.close();
      },
      finish(value) { if (!headersSent) this.headers(); this.body(value); },
      fail() {
        if (!headersSent) { headersSent = true; header.reject(new Error('Synthetic header failure')); }
        else if (!bodySent) { bodySent = true; controller.error(new Error('Synthetic body failure')); }
      },
    };
    calls.push(record);
    return header.promise.then(async response => {
      record.bodyStarted = true;
      const value = await response.json();
      if (!response.ok) { const error = new Error('Synthetic response failure'); error.status = response.status; throw error; }
      return value;
    }).finally(() => { record.settled = true; });
  }
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [0])); } static now() { return 0; } }
  let context;
  window.location = { hostname: 'synthetic.invalid', search: '' };
  window.setTimeout = setTimer; window.clearTimeout = id => timers.delete(id);
  window.luminaI18n = { t: key => '[' + context._currentLocale + ']' + key, apply() {} };
  context = vm.createContext({ window, document, _currentLocale: locale, Date: ClockDate, Intl, Promise,
    URL, URLSearchParams, AbortController, getAuth: () => auth, isLoggedIn: () => true,
    apiFetch, setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    requestAnimationFrame(callback) { callback(); return 1; },
    console: { log() {}, info() {}, warn() { warningCount++; }, error() { warningCount++; } },
    localStorage: { getItem() { forbiddenWrites++; throw new Error('Storage forbidden'); },
      setItem() { forbiddenWrites++; throw new Error('Storage forbidden'); },
      removeItem() { forbiddenWrites++; throw new Error('Storage forbidden'); } },
    fetch() { forbiddenWrites++; throw new Error('Real transport forbidden'); },
  });
  vm.runInContext(shared, context, { filename: 'exact4A-shared-feed-render-helpers.js' });
  vm.runInContext(page, context, { filename: 'actual-whole-lumina-feed.js' });
  assert.equal(typeof window.bindLuminaFeedSearch, 'function');
  assert.equal(typeof window.initLuminaFeedDiscovery, 'function');
  assert.equal(typeof window.renderLuminaFeed, 'function');
  window.bindLuminaFeedSearch();
  await window.initLuminaFeedDiscovery(); await flush();
  const input = nodes.get('feedSearchInput');
  const h = {
    calls, timers, html: () => nodes.get('luminaFeedList').innerHTML,
    searches: () => calls.filter(call => call.kind === 'search'),
    async search(query) {
      const prior = this.searches().length; input.value = query;
      input.dispatchEvent({ type: 'input', target: input });
      input.dispatchEvent({ type: 'keydown', key: 'Enter', target: input, preventDefault() {} });
      await flush(); assert.equal(this.searches().length, prior + 1, 'One explicit Enter produces one memory search');
      return this.searches().at(-1);
    },
    async locale(value, emit = true) {
      const prior = this.searches().length; context._currentLocale = value;
      if (emit) window.dispatchEvent({ type: 'lumina:localechange', detail: { regionalLocale: value } });
      await flush(); assert.equal(this.searches().length, prior, 'Locale observation must not dispatch an explicit search');
    },
    async settle(record, outcome, marker) {
      if (outcome === 'failure') record.fail(); else record.finish(payload(marker));
      await flush(); assert.equal(record.settled, true);
    },
  };
  t.after(async () => {
    for (const record of h.searches()) if (!record.settled) record.fail();
    await flush(); timers.clear();
    assert.equal(forbiddenWrites, 0); assert.equal(warningCount, 0);
    assert(h.searches().every(record => record.settled));
  });
  return h;
}
function visible(h, marker) {
  assert(h.html().includes('<article class="feed-post'), 'Actual renderer must produce an admitted synthetic post');
  assert(h.html().includes(marker), 'Actual current result body must render');
}
async function seed(h) {
  const request = await h.search('qa-seed'); assert.equal(request.language, 'en');
  await h.settle(request, 'success', 'SYNTHETIC_SEED_VISIBLE'); visible(h, 'SYNTHETIC_SEED_VISIBLE');
}

test('FEED.SEARCH.LOCALE.01 retired EN headers and body cannot publish after JA change', async t => {
  for (const phase of ['headers', 'body']) for (const outcome of ['success', 'failure'])
    for (const order of ['beforeFresh', 'pendingFresh', 'afterFresh']) {
      const h = await harness(t); await seed(h);
      const old = await h.search('qa-retired');
      assert.equal(old.language, 'en'); assert.equal(h.searches().length, 2);
      if (phase === 'body') { old.headers(); await flush(); assert.equal(old.bodyStarted, true); }
      await h.locale('ja-JP');
      assert.equal(h.searches().length, 2, 'No automatic replacement search');
      let fresh;
      if (order !== 'beforeFresh') {
        fresh = await h.search('qa-current-ja'); assert.equal(fresh.language, 'ja');
        if (order === 'afterFresh') { await h.settle(fresh, 'success', 'SYNTHETIC_CURRENT_JA'); visible(h, 'SYNTHETIC_CURRENT_JA'); }
      }
      const current = h.html();
      await h.settle(old, outcome, 'SYNTHETIC_RETIRED_EN');
      if (PROFILE === 'baseline' && phase === 'headers' && outcome === 'success' && order === 'beforeFresh') {
        visible(h, 'SYNTHETIC_RETIRED_EN');
      }
      assert.equal(h.html(), current, 'FEED_SEARCH_LOCALE_RETIRED_RESULT');
      if (!fresh) { fresh = await h.search('qa-current-ja'); assert.equal(fresh.language, 'ja'); }
      if (order !== 'afterFresh') {
        assert.equal(fresh.settled, false, 'An old completion cannot settle the newer dependency');
        await h.settle(fresh, 'success', 'SYNTHETIC_CURRENT_JA');
      }
      visible(h, 'SYNTHETIC_CURRENT_JA'); assert.equal(h.searches().length, 3);
    }
});

if (SELECTED === 'all') {
  test('FEED.SEARCH.LOCALE.02 ABA silent changes and same-language current queries remain correctly scoped', async t => {
    for (const emit of ['aba', 'silent']) for (const outcome of ['success', 'failure']) {
      const h = await harness(t); await seed(h);
      const old = await h.search('qa-old-language'); old.headers(); await flush();
      await h.locale('ja-JP', emit !== 'silent');
      if (emit === 'aba') await h.locale('en-US');
      const current = h.html();
      await h.settle(old, outcome, 'SYNTHETIC_OLD_LANGUAGE');
      assert.equal(h.html(), current, 'ABA or missing event cannot revive an old-language result');
      const fresh = await h.search('qa-current-language');
      assert.equal(fresh.language, emit === 'aba' ? 'en' : 'ja');
      await h.settle(fresh, 'success', 'SYNTHETIC_FRESH_LANGUAGE');
      visible(h, 'SYNTHETIC_FRESH_LANGUAGE'); assert.equal(h.searches().length, 3);
    }
    for (const [from, to] of [['zh-Hans', 'zh-Hant'], ['zh-Hant', 'zh-Hans']]) {
      const h = await harness(t, from), current = await h.search('qa-same-server-language');
      assert.equal(current.language, 'zh'); current.headers(); await flush();
      await h.locale(to); assert.equal(current.settled, false);
      await h.settle(current, 'success', 'SYNTHETIC_CURRENT_ZH');
      visible(h, 'SYNTHETIC_CURRENT_ZH'); assert.equal(h.searches().length, 1);
    }
    const h = await harness(t); await seed(h);
    const old = await h.search('qa-older-query'), latest = await h.search('qa-newer-query');
    assert.equal(old.language, 'en'); assert.equal(latest.language, 'en');
    await h.settle(latest, 'success', 'SYNTHETIC_LATEST_QUERY'); visible(h, 'SYNTHETIC_LATEST_QUERY');
    const current = h.html(); await h.settle(old, 'failure');
    assert.equal(h.html(), current, 'A late same-language failure cannot clear the newer query');
    assert.equal(h.searches().length, 3);
  });
}

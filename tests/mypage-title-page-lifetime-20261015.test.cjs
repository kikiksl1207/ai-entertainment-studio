'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const profile = process.env.LUMINA_TITLE_LIFETIME_PROFILE || 'current';
const selected = process.env.LUMINA_TITLE_LIFETIME_CASES || 'all';
assert(['baseline', 'current'].includes(profile)); assert(['first', 'all'].includes(selected));
const root = path.resolve(process.env.LUMINA_TITLE_LIFETIME_SOURCE_ROOT || path.join(__dirname, '..'));
if (!process.env.LUMINA_TITLE_LIFETIME_SOURCE_ROOT) {
  assert(!['e:/codex/luminastage/ai-entertainment-studio-git', 'e:/codex/luminastage/story-completion-20261003']
    .includes(root.replace(/\\/g, '/').toLowerCase()), 'Shared checkout requires an explicit admitted source root');
}
const PINS = {
  baseline: {
    'pages/mypage-titles.js': [
      ['fc4e7a93b893c7dd8451d2ab2ba2bfc0c8553d3c59fc74a1d5490492cf595384', '0066da4578a6a4db3dfb5c2b04889c681b8adb73'],
      ['abd496f78b4085045f2bdcf436d0cd8f611761aa0f3cd9f60713757496ab6c01', 'e40fda8053e679992ed5f6641e31671dd858760c'],
    ],
    'mypage/index.html': [
      ['8a5220be9ae3006cf30222e0dadeeb6f9c1afe08423cb40b28ca6a786a256e27', '5f48d3c4adc4da827b7dbda9b1c5b315261fc7f7'],
      ['b736007a9ffae58ff44fe435f348fea932c1e2390212441b2b871082dd718d69', '76f860ad9addb448afc3dbb8c2ace486bc5e7209'],
    ],
  },
  current: {
    'pages/mypage-titles.js': [
      ['7806f2370077e48507c9f82571e4fc6c48ad1ca38437f63c16298b10347f76b9', '168159fdddbd551f2b92acb7aa4c0b0e44ec7c8f'],
      ['1268ad786a006720cb012fa9eb063876e55b2efcad16f06149113e98371a92e9', '0c1fa7f93228c07ff8861e0079f7a0c0f109bf41'],
    ],
    'mypage/index.html': [
      ['5327cb32e959c767791d60466095fa69b01cc5b91fd5f6de2478b50f561a3523', '050d0f55091457035f8622e289e7f258eca5634d'],
      ['2bf8ea4475057dd850936bdc7ddf292508c05448be9057985b6212417ba1d4bb', '36076afa0c0cbd4e9fd2b5763ecf54822dc35cbf'],
    ],
  },
};
function source(file) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert(bytes.length > 0 && bytes.length <= 262144);
  assert(!bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert(!/\r(?!\n)/.test(text) && !(text.includes('\r\n') && /(?<!\r)\n/.test(text)));
  const sha = createHash('sha256').update(bytes).digest('hex');
  const blob = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert(PINS[profile][file].some(pair => pair[0] === sha && pair[1] === blob), 'Exact title lifetime source pair required');
  return text;
}
const moduleSource = source('pages/mypage-titles.js'), html = source('mypage/index.html');
const expectedScript = profile === 'baseline' ? '/pages/mypage-titles.js' : '/pages/mypage-titles.js?v=mypage-title-pagehide-20261015';
assert.equal((html.match(/<script\b[^>]*src="\/pages\/mypage-titles\.js(?:\?[^"<>]*)?"[^>]*><\/script>/g) || []).length, 1);
assert(html.includes('<script src="' + expectedScript + '"></script>'));

const TITLE_IDS = ['mypageTitleChips', 'mypageTitleHeading', 'mypageTitleFilter', 'mypageEquippedTitle',
  'mypageTitleEmpty', 'mypageTitleFoot', 'mypageTitlesRetry'];
const FAN_IDS = ['mypageFanHeading', 'mypageFanStatus', 'mypageFanRetry', ...['Balance', 'Earned', 'Today', 'Streak', 'Accepted']
  .flatMap(suffix => ['mypageFan' + suffix, 'mypageFan' + suffix + 'Label'])];
const ACHIEVEMENT_IDS = ['mypageAchievementHeading', 'mypageAchievementList', 'mypageAchievementStatus', 'mypageAchievementRetry'];
const NUMBER_IDS = ['Balance', 'Earned', 'Today', 'Streak', 'Accepted'].map(suffix => 'mypageFan' + suffix);
const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); await new Promise(setImmediate); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function target() {
  const listeners = new Map();
  return { addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); return true; } };
}
function node(document, rootNode = false) {
  const classes = new Set(); let ownText = '';
  return { ...target(), parent: null, children: [], dataset: {}, attributes: {}, hidden: false, disabled: false,
    get isConnected() { return rootNode || !!this.parent?.isConnected; },
    get textContent() { return ownText + this.children.map(child => child.textContent || '').join(''); },
    set textContent(value) { ownText = String(value); this.replaceChildren(); },
    classList: { contains: name => classes.has(name), toggle(name, enabled = !classes.has(name)) {
      if (enabled) classes.add(name); else classes.delete(name); return enabled;
    } },
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    focus() { document.activeElement = this; },
    closest(selector) {
      const key = selector === '[data-title-code]' ? 'titleCode' : selector === '[data-title-filter]' ? 'titleFilter' : null;
      for (let current = this; current; current = current.parent) if (key && current.dataset[key] !== undefined) return current;
      return null;
    },
    querySelectorAll(selector) {
      const key = selector === '[data-title-filter]' ? 'titleFilter' : 'titleCode';
      return this.children.filter(child => child.dataset[key] !== undefined);
    },
  };
}
const title = (code, equipped = false) => ({ code, status: 'active', equipped, canEquip: true, rarity: 'common',
  copy: { labels: { en: { displayName: 'Synthetic ' + code }, ko: { displayName: 'Synthetic ' + code } } } });
function summary(prefix, equipped = prefix + '-equipped', amount = 7) {
  const items = [title(prefix + '-equipped', equipped === prefix + '-equipped'), title(prefix + '-choice', equipped === prefix + '-choice')];
  return { generatedAt: '2026-10-15T00:00:00.000Z', titles: { items, equipped: items.find(item => item.equipped) || null },
    points: { balance: amount, lifetimeEarned: amount, cashLike: false, transferable: false, settlementEligible: false, luminaConvertible: false },
    participationSummary: { completedTodayCount: 1, currentStreakDays: 1, totalAcceptedCount: amount },
    achievements: [{ code: prefix + '-achievement', status: 'earned', earnedAt: '2026-10-01T00:00:00.000Z',
      progress: { current: 1, target: 1 }, copy: { labels: { en: { title: 'Synthetic achievement ' + prefix, description: 'Synthetic only' } } } }],
  };
}
function harness(t, { waiting = false } = {}) {
  const window = target(), document = { ...target(), readyState: 'loading', activeElement: null };
  const elements = new Map([...TITLE_IDS, ...FAN_IDS, ...ACHIEVEMENT_IDS].map(id => [id, node(document, true)]));
  const filters = ['all', 'owned', 'locked', 'rare'].map(value => { const item = node(document); item.dataset.titleFilter = value; return item; });
  elements.get('mypageTitleFilter').append(...filters);
  Object.assign(document, { getElementById: id => elements.get(id) || null, createElement: () => node(document),
    querySelectorAll: selector => selector === '#mypageTitleFilter [data-title-filter]' ? filters : [] });
  const ready = deferred(), timers = new Map(), requests = []; let nextTimer = 0, authWrites = 0, sessionNumber = 1;
  let owner = 'synthetic-owner-A', authSession = Object.freeze({ sessionNumber }), locale = 'en';
  if (!waiting) ready.resolve();
  window.luminaI18n = { getLocale: () => locale, whenReady: () => ready.promise };
  function apiFetch(url, options, attempts) {
    assert.equal(options.auth, true); assert.equal(options.throwOnError, true);
    const method = options.method || 'GET';
    assert((method === 'GET' && /^\/api\/v1\/me\/fan-engagement\/summary\?locale=(?:en|ko|ja|zh-Hans|zh-Hant)$/.test(url))
      || (method === 'PATCH' && url === '/api/v1/me/fan-engagement/title'), 'Only the owned synthetic title routes are admitted');
    if (method === 'PATCH') { assert.equal(attempts, 1); assert.equal(options.headers, undefined); }
    const header = deferred(); let stream, headerSent = false, bodySent = false;
    const record = { method, url, options, attempts, owner, bodyStarted: false,
      headers(status = 200) {
        assert(!headerSent); headerSent = true;
        const body = new ReadableStream({ start(controller) { stream = controller; } });
        header.resolve(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
      },
      body(value) { assert(headerSent && !bodySent); bodySent = true; stream.enqueue(new TextEncoder().encode(JSON.stringify(value))); stream.close(); },
      finish(value, status = 200) { if (!headerSent) this.headers(status); this.body(value); },
      rejectHeaders() { assert(!headerSent); headerSent = true; header.reject(new Error('Synthetic header failure')); },
      rejectBody() { assert(headerSent && !bodySent); bodySent = true; stream.error(new Error('Synthetic body failure')); },
    };
    requests.push(record);
    return header.promise.then(async response => {
      record.bodyStarted = true;
      const data = await response.json();
      if (!response.ok) { const error = new Error('Synthetic API rejection'); error.status = response.status; throw error; }
      return data;
    });
  }
  const context = vm.createContext({ window, document, Promise, Date, AbortController,
    getAccessToken: () => owner ? 'synthetic-memory-access-' + sessionNumber : null,
    authRequestSession: () => authSession, authRequestSessionCurrent: value => value === authSession,
    apiFetch, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    localStorage: { getItem() { throw new Error('Storage forbidden'); }, setItem() { authWrites++; throw new Error('Storage forbidden'); },
      removeItem() { authWrites++; throw new Error('Storage forbidden'); } },
    fetch() { throw new Error('Real transport forbidden'); },
  });
  vm.runInContext(moduleSource, context, { filename: 'mypage-titles.js' });
  const api = window.LuminaMypageTitles;
  assert.equal(typeof api?.load, 'function'); assert.equal(typeof api?.select, 'function');
  const h = { api, elements, requests, timers,
    rows: () => elements.get('mypageTitleChips').children,
    text: id => elements.get(id).textContent,
    gets: () => requests.filter(row => row.method === 'GET'), patches: () => requests.filter(row => row.method === 'PATCH'),
    hide() { window.dispatchEvent({ type: 'pagehide', persisted: true }); },
    show() { window.dispatchEvent({ type: 'pageshow', persisted: true }); },
    ready() { ready.resolve(); },
    owner(value) { owner = value; sessionNumber++; authSession = Object.freeze({ sessionNumber }); window.dispatchEvent({ type: 'lumina:authchange' }); },
    locale(value) { locale = value; window.dispatchEvent({ type: 'lumina:localechange' }); },
    clickOld(button) { elements.get('mypageTitleChips').dispatchEvent({ type: 'click', target: button }); },
    authWrites: () => authWrites,
  };
  t.after(() => { h.hide(); assert.equal(authWrites, 0); });
  return h;
}
function blank(h, marker = 'MYPAGE_TITLE_PAGEHIDE_PRIVATE_CLEAR') {
  assert.equal(h.rows().length, 0, marker);
  assert.equal(h.elements.get('mypageAchievementList').children.length, 0, marker);
  assert.equal(h.text('mypageEquippedTitle'), '', marker);
  for (const id of NUMBER_IDS) assert.equal(h.text(id), '', marker);
}
async function loaded(h, prefix, equipped, amount) {
  const pending = h.api.load(); await flush();
  const record = h.requests.at(-1); assert.equal(record.method, 'GET');
  record.finish(summary(prefix, equipped, amount)); await pending; await flush();
}
function visible(h, prefix, amount = 7) {
  assert.equal(h.rows().length, 2);
  assert(h.rows().every(row => row.dataset.titleCode.startsWith(prefix + '-')));
  assert(h.elements.get('mypageAchievementList').textContent.includes('Synthetic achievement ' + prefix));
  assert.equal(h.text('mypageFanBalance'), amount.toLocaleString('en'));
}

test('MYPAGE.TITLE.PAGEHIDE.01 summary header body and readiness remain retired until explicit fresh read', async t => {
  for (const [phase, result] of [['headers', 'success'], ['body', 'success'], ['headers', 'failure'], ['body', 'failure']]) {
    const h = harness(t), old = h.api.load(); await flush();
    assert.equal(h.requests.length, 1, 'The old GET must actually be issued before pagehide');
    const request = h.requests[0];
    if (phase === 'body') { request.headers(); await flush(); assert.equal(request.bodyStarted, true); }
    h.hide(); blank(h);
    const hiddenRead = h.api.load(), hiddenSelection = h.api.select('old-choice');
    await flush(); assert.equal(h.requests.length, 1);
    let fresh;
    if (!(phase === 'headers' && result === 'success')) {
      h.show(); assert.equal(h.requests.length, 1);
      fresh = h.api.load(); await flush(); assert.equal(h.requests.length, 2);
      if (result === 'failure' && phase === 'headers') { h.requests[1].finish(summary('fresh')); await fresh; }
    }
    if (result === 'success') request.finish(summary('old', undefined, 81));
    else if (phase === 'headers') request.rejectHeaders(); else request.rejectBody();
    await old; await hiddenRead; await hiddenSelection; await flush();
    if (phase === 'headers' && result === 'success') {
      blank(h, 'MYPAGE_TITLE_PAGEHIDE_RETIRED_SUMMARY');
      assert.equal(h.requests.length, 1); h.show(); assert.equal(h.requests.length, 1);
      fresh = h.api.load(); await flush(); assert.equal(h.requests.length, 2);
    } else if (result === 'failure' && phase === 'headers') visible(h, 'fresh');
    else { blank(h); assert.equal(h.elements.get('mypageTitlesRetry').disabled, true, 'Old finally must not release the new read'); }
    if (!(result === 'failure' && phase === 'headers')) { h.requests[1].finish(summary('fresh')); await fresh; }
    visible(h, 'fresh'); assert.equal(h.requests.length, 2); assert.equal(h.patches().length, 0);
    assert.equal(h.timers.size, 0);
  }
  const waiting = harness(t, { waiting: true }), cancelled = waiting.api.load(); await flush();
  assert.equal(waiting.requests.length, 0); assert.equal(waiting.timers.size, 1);
  waiting.hide(); waiting.ready(); await cancelled; await flush();
  assert.equal(waiting.requests.length, 0); assert.equal(waiting.timers.size, 0);
  waiting.show(); assert.equal(waiting.requests.length, 0);
  await loaded(waiting, 'ready'); visible(waiting, 'ready');
});

if (selected === 'all') {
  test('MYPAGE.TITLE.PAGEHIDE.02 sent PATCH preserves acknowledgement uncertainty and manual reconciliation without replay', async t => {
    for (const outcome of ['acknowledged', 'unknown', 'rejected']) {
      const h = harness(t); await loaded(h, 'owned');
      const detached = h.rows().find(row => row.dataset.titleCode === 'owned-choice');
      const pending = h.api.select('owned-choice'); await flush();
      assert.equal(h.patches().length, 1); const patch = h.patches()[0];
      assert.deepEqual(JSON.parse(JSON.stringify(patch.options.body)), { titleCode: 'owned-choice' }); assert.equal(patch.attempts, 1);
      h.hide(); blank(h); assert.equal(detached.isConnected, false);
      h.clickOld(detached); await h.api.select('owned-choice'); await h.api.load();
      h.show(); await h.api.load(); assert.equal(h.requests.length, 2);
      assert.equal(h.elements.get('mypageTitlesRetry').disabled, true, 'Possibly sent selection retains its lock');
      if (outcome === 'unknown') patch.rejectHeaders();
      else if (outcome === 'rejected') patch.finish({ error: { statusCode: 403 } }, 403);
      else { patch.headers(); await flush(); patch.body({ equipped: { code: 'owned-choice' } }); }
      await pending; await flush(); blank(h);
      assert.equal(h.requests.length, 2, 'Retired PATCH must not start the automatic summary GET');
      assert.equal(h.elements.get('mypageTitlesRetry').hidden, false);
      assert.equal(h.elements.get('mypageTitlesRetry').disabled, false, 'Settled own flight must release the manual-read lock');
      await loaded(h, 'owned');
      const choice = () => h.rows().find(row => row.dataset.titleCode === 'owned-choice');
      if (outcome === 'unknown') {
        assert.equal(choice().disabled, true, 'Unacknowledged unchanged snapshot must remain uncertain');
        await h.api.select('owned-choice'); assert.equal(h.patches().length, 1);
        await loaded(h, 'owned', 'owned-choice');
        assert.equal(h.text('mypageTitleFoot'), 'Featured title saved.');
      } else {
        assert.equal(choice().disabled, false, 'Acknowledgement/rejection remains usable by the explicit fresh read');
        assert.equal(h.text('mypageTitleFoot'), 'Featured title was not changed.');
      }
      assert.equal(h.patches().length, 1); assert.equal(h.authWrites(), 0);
    }
  });

  test('MYPAGE.TITLE.PAGEHIDE.03 old finally cannot unlock another account or a newer same-owner selection', async t => {
    const h = harness(t); await loaded(h, 'ownerA');
    const oldA = h.api.select('ownerA-choice'), oldPatch = h.patches()[0];
    h.hide(); h.owner('synthetic-owner-B'); await flush(); assert.equal(h.requests.length, 2);
    h.show(); assert.equal(h.requests.length, 2); await loaded(h, 'ownerB', undefined, 12);
    const newB = h.api.select('ownerB-choice'), currentPatch = h.patches()[1];
    oldPatch.finish({ equipped: { code: 'ownerA-choice' } }); await oldA; await flush();
    assert(h.rows().every(row => row.disabled), 'Old account finally must not release the new selection lock');
    await h.api.load(); assert.equal(h.requests.length, 4); visible(h, 'ownerB', 12);
    currentPatch.finish({ equipped: { code: 'ownerB-choice' } }); await flush();
    assert.equal(h.requests.length, 5, 'Current nonretired selection retains its one automatic result read');
    h.requests[4].finish(summary('ownerB', 'ownerB-choice', 12)); await newB;
    assert(h.text('mypageEquippedTitle').includes('ownerB-choice'));

    const same = harness(t); await loaded(same, 'same');
    const first = same.api.select('same-choice'); same.patches()[0].finish({ equipped: { code: 'same-choice' } }); await flush();
    assert.equal(same.requests.length, 3); const obsoleteRead = same.requests[2];
    obsoleteRead.headers(); await flush(); same.hide(); same.show();
    const currentRead = same.api.load(); await flush();
    assert.equal(same.requests.length, 4, 'Settled PATCH must not deadlock restoration behind its retired summary');
    same.requests[3].finish(summary('same')); await currentRead;
    const second = same.api.select('same-choice'); assert.equal(same.patches().length, 2);
    obsoleteRead.body(summary('obsolete', undefined, 99)); await first; await flush();
    visible(same, 'same'); assert(same.rows().every(row => row.disabled), 'Old same-owner finally must not release the newer flight');
    await same.api.load(); assert.equal(same.requests.length, 5);
    same.patches()[1].finish({ equipped: { code: 'same-choice' } }); await flush();
    assert.equal(same.requests.length, 6); same.requests[5].finish(summary('same', 'same-choice')); await second;
    assert.equal(same.text('mypageTitleFoot'), 'Featured title saved.'); assert.equal(same.patches().length, 2);
  });
}

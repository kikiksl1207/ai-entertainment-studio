import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first + start.length);
  assert(first >= 0 && last > first, `Actual source anchors: ${start}`);
  assert.equal(app.indexOf(start, first + 1), -1, `Unique source anchor: ${start}`);
  return app.slice(first, last);
}
const sources = [
  extract('const API_BASE =', 'const I18N_LOCALES ='),
  extract('function generateIdempotencyKey()', 'async function authLogin('),
  extract('let _currentCampaign = null;', 'function rankingMetricNumber('),
  extract('function rankingMetricNumber(', 'let _wallet = null;'),
  extract('let _wallet = null;', 'function getLikesCount('),
  extract('function getLikesCount(', 'function bindLikeButtons('),
  extract('let _freeLikeQuota = null;', '/* \u2500\u2500 \ub80c\ub354\ub9c1: \ube44\uacf5\uac1c \uc544\ud2f0\uc2a4\ud2b8 \ub77c\uc778'),
  extract('function feedEscapeHtml(', 'function normalizeFeedAuthorType(')
];
const options = { timeout: 2500 };
const ID = {
  a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222',
  campaign: '33333333-3333-4333-8333-333333333333', artist: '44444444-4444-4444-8444-444444444444',
  event: '55555555-5555-4555-8555-555555555555', wallet: '66666666-6666-4666-8666-666666666666',
  ledger: '88888888-8888-4888-8888-888888888888', otherCampaign: '99999999-9999-4999-8999-999999999999'
};
const auth = (owner = 'a') => ({
  accessToken: `synthetic-access-${owner}`, refreshToken: `synthetic-refresh-${owner}`, user: { id: ID[owner] }
});
const quota = (unitPriceLumina = '10', changes = {}) => ({
  campaign: { id: ID.campaign }, dailyLimit: 20, usedToday: 0, remaining: 20, unitPriceLumina, ...changes
});
const scope = 'lumina_paid_like:' + JSON.stringify([ID.a, ID.campaign, ID.artist]);
const plain = value => JSON.parse(JSON.stringify(value));
async function tick() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

function node() {
  const handlers = new Map(), values = new Set();
  return {
    disabled: false, hidden: false, textContent: '', attributes: {}, style: {},
    classList: {
      add: value => values.add(value), contains: value => values.has(value), remove: value => values.delete(value),
      toggle(value, active) { if (active) values.add(value); else values.delete(value); }
    },
    addEventListener(name, callback) { const list = handlers.get(name) || []; list.push(callback); handlers.set(name, list); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    closest: () => null,
    async fire(name, target) { for (const callback of handlers.get(name) || []) await callback({ target: target || this }); }
  };
}
function overlay() {
  const root = node(), confirm = node(), message = node(), close = node();
  let html = '', radios = [];
  root.isConnected = false; root.confirm = confirm; root.message = message; root.radios = () => radios;
  close.closest = selector => selector === '.paid-like-close' || selector === '[data-paid-like-cancel]' ? close : null;
  Object.defineProperty(root, 'innerHTML', {
    get: () => html,
    set(value) {
      html = value;
      radios = [...value.matchAll(/<input\b([^>]*\bname="paidLikeBundle"[^>]*)>/g)].map(match => {
        const attrs = match[1], radio = node(), option = node();
        radio.value = /\bvalue="([^"]+)"/.exec(attrs)?.[1];
        radio.checked = /\bchecked\b/.test(attrs); radio.disabled = /\bdisabled\b/.test(attrs);
        if (radio.disabled) option.classList.add('is-disabled');
        radio.closest = selector => selector === '.paid-like-option' ? option : null;
        radio.option = option; return radio;
      });
    }
  });
  root.querySelector = selector => {
    if (selector === '[data-paid-like-confirm]') return confirm;
    if (selector === '[data-paid-like-message]') return message;
    if (selector === "[name='paidLikeBundle']:checked") return radios.find(radio => radio.checked) || null;
    if (selector === "[name='paidLikeBundle']:not([disabled])") return radios.find(radio => !radio.disabled) || null;
    assert.fail(`Unsupported synthetic modal selector: ${selector}`);
  };
  root.querySelectorAll = selector => {
    if (selector === '.paid-like-option') return radios.map(radio => radio.option);
    if (selector === "[name='paidLikeBundle']") return radios;
    assert.fail(`Unsupported synthetic modal selector: ${selector}`);
  };
  root.select = (quantity, force = false) => {
    const selected = radios.find(radio => Number(radio.value) === quantity); assert(selected, 'Actual rendered radio');
    if (!force) assert.equal(selected.disabled, false);
    for (const radio of radios) radio.checked = radio === selected;
  };
  root.clickConfirm = () => confirm.fire('click');
  root.close = () => root.fire('click', close);
  root.remove = () => { root.isConnected = false; };
  return root;
}

let keySequence = 0;
// Match the paid-response fixture: actual auth/pick/wallet/paid code, synthetic transport/storage/DOM only.
function harness({ sessions = new Map() } = {}) {
  const values = new Map([['lumina_auth', JSON.stringify(auth())]]);
  const listeners = new Map(), requests = [], alerts = [], modals = [], timers = new Map();
  const badge = { innerHTML: '', style: {} }, hero = { textContent: '' };
  let keys = 0, nextTimer = 0;
  const storage = {
    getItem: key => sessions.get(key) ?? null, setItem: (key, value) => sessions.set(key, String(value)),
    removeItem: key => sessions.delete(key), key: index => [...sessions.keys()][index] ?? null,
    get length() { return sessions.size; }
  };
  const context = {
    AbortController, Event, CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), console: { warn() {}, info() {}, error() {} },
    crypto: { randomUUID: () => { keys++; return `aaaaaaaa-aaaa-4aaa-8aaa-${String(++keySequence).padStart(12, '0')}`; } },
    sessionStorage: storage,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { onLine: true }, _currentLocale: 'ko-KR',
    _artists: [{ id: ID.artist, slug: 'artist-a', publicName: 'Synthetic artist' }],
    getCharacterBySlug: slug => context._artists.find(artist => artist.slug === slug),
    t: key => key, alert: text => alerts.push(text), openAuthModal() {}, currentAuthReturn: () => '/lumina-pick', updateAuthUI() {},
    window: {
      sessionStorage: storage,
      addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
      dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); }
    },
    document: {
      getElementById: id => id === 'walletBadge' ? badge : id === 'heroQuotaLabel' ? hero : null,
      querySelector: selector => selector === '.paid-like-modal-overlay' ? modals.find(item => item.isConnected) || null : null,
      querySelectorAll: selector => selector === '.paid-like-modal-overlay' ? modals.filter(item => item.isConnected) : [],
      createElement: tag => { assert.equal(tag, 'div'); const item = overlay(); modals.push(item); return item; },
      body: { style: {}, appendChild: item => { item.isConnected = true; } }
    },
    fetch(url, requestOptions) {
      const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.lumina-stage.com');
      const method = requestOptions.method || 'GET';
      assert(method === 'POST' ? /^\/api\/v1\/boost-campaigns\/[^/]+\/paid-like$/.test(parsed.pathname)
        : ['/api/v1/wallet', '/api/v1/me/paid-like-quota', '/api/v1/me/free-like-quota'].includes(parsed.pathname)
          || /^\/api\/v1\/boost-campaigns\/[^/]+\/rankings$/.test(parsed.pathname), 'Only synthetic expected transport');
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { path: parsed.pathname, options: requestOptions, method, done: false, ownerId: context.getAuth()?.user?.id };
      request.respond = (body, status = 200) => {
        request.done = true; resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
      };
      request.fail = error => { request.done = true; reject(error); };
      requestOptions.signal?.addEventListener('abort', () => request.fail(Object.assign(new Error('Synthetic abort'), { name: 'AbortError' })), { once: true });
      requests.push(request); return promise;
    }
  };
  for (const source of sources) runInNewContext(source, context, { filename: 'app.js:paid-server-price-source-extraction' });
  const read = code => runInNewContext(code, context);
  context.syntheticCampaign = ID.campaign;
  read('_currentCampaign = { id: syntheticCampaign }; _rankings = [{ slug: "artist-a", likes: 4 }];');
  return {
    context, sessions, requests, alerts, modals, timers, read,
    get keys() { return keys; }, posts: () => requests.filter(row => row.path.endsWith('/paid-like')),
    stored: () => sessions.has(scope) ? JSON.parse(sessions.get(scope)) : null,
    state: () => plain(read('({ wallet: _wallet, rankings: _rankings })')),
    async seedWallet(balance = 1000) {
      const promise = context.loadWallet(); requests.at(-1).respond({ cachedBalance: String(balance), currencyCode: 'LUMINA' }); await promise;
    },
    async open(data = quota(), quantity = 1) {
      const before = requests.length, promise = context.openPaidLikeModal('artist-a'); await tick();
      for (const row of requests.slice(before).filter(row => row.path.endsWith('/paid-like-quota') && !row.done)) row.respond(data);
      await promise;
      const item = modals.at(-1);
      if (item?.isConnected && item.radios().some(radio => Number(radio.value) === quantity && !radio.disabled)) item.select(quantity);
      return item;
    },
    async begin(item, data = quota(), answerQuote = true) {
      const before = requests.length, promise = item.clickConfirm(); await tick();
      const fresh = requests.slice(before).filter(row => row.path.endsWith('/paid-like-quota') && !row.done);
      if (answerQuote) { for (const row of fresh) row.respond(data); await tick(); }
      return { promise, fresh, post: requests.slice(before).find(row => row.path.endsWith('/paid-like')), before };
    },
    async finishReads(unit = '10') {
      for (const row of requests.filter(row => !row.done && row.method === 'GET')) {
        row.respond(row.path === '/api/v1/wallet' ? { cachedBalance: '1000' }
          : row.path.endsWith('/paid-like-quota') ? quota(unit)
            : row.path.endsWith('/free-like-quota') ? { dailyLimit: 1, usedToday: 0, remaining: 1 } : []);
      }
      await tick();
    }
  };
}

function receipt(request, total, replay = false) {
  const body = JSON.parse(request.options.body);
  return {
    event: {
      id: ID.event, userId: request.ownerId, campaignId: request.path.split('/')[4], artistId: body.artistId,
      boostType: 'lumina_boost', idempotencyKey: body.idempotencyKey,
      metadata: { source: 'paid_like', quantity: body.quantity, totalPriceLumina: String(total) },
      walletLedgerId: ID.ledger,
      walletLedger: { id: ID.ledger, direction: 'debit', amount: String(total), idempotencyKey: 'wallet:boost-paid-like:' + body.idempotencyKey }
    },
    idempotentReplay: replay, paidLike: { quantity: body.quantity }
  };
}
async function ready(unit = '10', quantity = 1, config) {
  const h = harness(config); await h.seedWallet(); const item = await h.open(quota(unit), quantity);
  assert(item?.isConnected); return { h, item };
}
function unchanged(h, balance = 1000) {
  assert.equal(h.alerts.length, 0); assert.equal(h.state().wallet.balance, balance); assert.equal(h.state().rankings[0].likes, 4);
}
function optionHtml(item, quantity) {
  const labels = [...item.innerHTML.matchAll(/<label class="paid-like-option[^\"]*">([\s\S]*?)<\/label>/g)];
  const label = labels.find(row => row[1].includes(`value="${quantity}"`)); assert(label); return label[1];
}

test('paid price source has quantity-only choices and preserves the response deadline helper', options, () => {
  const menu = extract('const PAID_LIKE_BUNDLES = [', '// MVP');
  assert.doesNotMatch(menu, /lumina:|krw:|label:|90L|900\uC6D0/);
  const helper = extract('function awaitPaidLikeSettlement(request) {', 'function getPaidLikeBalance()');
  const raw = helper.replace(/\r?\n/g, '\r\n');
  assert.equal(createHash('sha256').update(raw).digest('hex'), '7513769ae0056869bfb8ae75e3d5d8bea7a3e48f9660b115e0a12c452121ea9d');
  const h = harness(); assert.equal(h.requests.length, 0); assert.equal(h.keys, 0);
  assert.deepEqual(plain(h.read('PAID_LIKE_BUNDLES.map(row => row.quantity)')), [1, 5, 10, 20]);
});

test('price parser uses exact safe cents and rejects unsupported monetary shapes', options, () => {
  const h = harness();
  for (const [raw, expected] of [['0', 0], [0, 0], ['0.29', 29], [0.29, 29], ['2.75', 275], [' 10.00 ', 1000],
    ['1000000.01', 100000001], ['90071992547409.91', Number.MAX_SAFE_INTEGER]]) {
    assert.equal(h.context.paidLikeMoneyCents(raw), expected, String(raw));
  }
  for (const raw of [null, undefined, true, false, {}, [], '', ' ', '-1', -0.01, '0.001', 0.001,
    '10L', '1,000', '+10', '1e2', '0x10', '.29', '1.', NaN, Infinity, -Infinity, 'Infinity',
    '90071992547409.92', '99999999999999.99', '100000000000000', 0.1 + 0.2]) {
    assert.equal(h.context.paidLikeMoneyCents(raw), null, String(raw));
  }
});

const normalPrices = [['10', 1000], ['0.29', 29], ['2.75', 275]];
for (const [unit, cents] of normalPrices) {
  for (const quantity of [1, 5, 10, 20]) {
    test(`server unit ${unit} x ${quantity} renders and confirms the exact undiscounted total`, options, async () => {
      const { h, item } = await ready(unit, quantity), total = cents * quantity / 100;
      for (const count of [1, 5, 10, 20]) {
        assert.equal(item.radios().find(row => Number(row.value) === count).disabled, false);
        const expected = (cents * count / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
        assert(optionHtml(item, count).includes(`${count}\uAC1C \u00B7 ${expected}L`));
        assert.doesNotMatch(optionHtml(item, count), /\d[\d,.]*\s*\uC6D0|\bKRW\b|discount/i);
      }
      assert.equal(item.confirm.disabled, false);
      const first = await h.begin(item, quota(unit)); assert(first.post); assert.equal(first.fresh.length, 1);
      assert.equal(first.fresh[0].options.headers.Authorization, 'Bearer synthetic-access-a');
      assert.deepEqual(Object.keys(JSON.parse(first.post.options.body)).sort(), ['artistId', 'artistSlug', 'expectedTotalPriceLumina', 'idempotencyKey', 'quantity']);
      assert.equal(JSON.parse(first.post.options.body).expectedTotalPriceLumina, `${BigInt(cents * quantity) / 100n}.${String(BigInt(cents * quantity) % 100n).padStart(2, '0')}`);
      assert.equal(JSON.parse(first.post.options.body).quantity, quantity);
      assert.equal(first.post.options.headers['Idempotency-Key'], h.stored().key);
      assert.equal(h.stored().lumina, total); assert.equal(h.stored().quantity, quantity);
      unchanged(h); first.post.respond(receipt(first.post, total)); await first.promise;
      assert.equal(h.alerts.length, 1); assert.equal(h.sessions.size, 0); assert.equal(item.isConnected, false);
      await h.finishReads(unit);
    });
  }
}

const invalidQuotes = [
  ['missing quota', null], ['missing price', quota('10', { unitPriceLumina: undefined })], ['nonfinite price', quota(Infinity)],
  ['subcent price', quota('0.001')], ['negative price', quota('-1')], ['unsafe cents', quota('90071992547409.92')],
  ['zero paid-product price', quota('0')],
  ['wrong campaign', quota('10', { campaign: { id: ID.otherCampaign } })],
  ['inconsistent quota', quota('10', { usedToday: 1, remaining: 20 })]
];

test('server rejects a changed final price without adopting a receipt or changing the retained amount', options, async () => {
  const { h, item } = await ready('10', 10), first = await h.begin(item, quota('10'));
  assert(first.post);
  const body = JSON.parse(first.post.options.body), stored = [...h.sessions.values()][0];
  assert.equal(body.expectedTotalPriceLumina, '100.00');
  first.post.respond({ success: false, error: { code: 'BOOST_PAID_LIKE_PRICE_MISMATCH', statusCode: 409 } }, 409);
  await first.promise;
  assert.match(item.message.textContent, /표시된 금액과 서버 요금/);
  assert.equal(h.posts().length, 1); assert.equal(h.keys, 1); assert.equal(h.alerts.length, 0);
  assert.equal([...h.sessions.values()][0], stored); assert.equal(h.stored().lumina, 100);
  assert.equal(item.confirm.disabled, true); unchanged(h);
  await item.clickConfirm(); assert.equal(h.posts().length, 1);
});
for (const [name, data] of invalidQuotes) {
  test(`invalid ${name} disables choices and forced confirmation cannot dispatch or mint a key`, options, async () => {
    const h = harness(); await h.seedWallet(); const item = await h.open(data); assert(item?.isConnected);
    assert(item.radios().every(row => row.disabled)); assert.equal(item.confirm.disabled, true);
    item.select(1, true); const first = await h.begin(item); await first.promise;
    assert.equal(first.fresh.length, 0); assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); assert.equal(h.sessions.size, 0);
    unchanged(h);
  });
}

test('safe million-scale fractional totals render and match receipts without float multiplication', options, async () => {
  const h = harness(); await h.seedWallet(30000000);
  const item = await h.open(quota('1000000.01'), 20);
  assert(optionHtml(item, 20).includes('20,000,000.2L'));
  const first = await h.begin(item, quota('1000000.01')); assert(first.post);
  assert.equal(h.stored().lumina, 20000000.2);
  first.post.respond(receipt(first.post, '20000000.20')); await first.promise;
  assert.equal(h.alerts.length, 1); assert.equal(h.sessions.size, 0); await h.finishReads('1000000.01');
});

test('safe unit price cannot authorize an overflowing quantity total', options, async () => {
  const h = harness(); await h.seedWallet(100000000000000);
  const item = await h.open(quota('20000000000000'));
  assert.equal(item.radios().find(row => row.value === '1').disabled, false);
  assert(item.radios().filter(row => row.value !== '1').every(row => row.disabled));
  item.select(5, true); const first = await h.begin(item, quota('20000000000000')); await first.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); unchanged(h, 100000000000000);
});

test('safe integer cents that cannot round-trip through the persisted numeric amount stay disabled', options, async () => {
  const h = harness(); await h.seedWallet(100000000000000);
  const item = await h.open(quota('90071992547409.91'));
  assert(item.radios().every(row => row.disabled)); assert.equal(item.confirm.disabled, true);
  item.select(1, true); const first = await h.begin(item); await first.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); unchanged(h, 100000000000000);
});

test('quota still restricts new quantities without changing their server price', options, async () => {
  const { h, item } = await ready('0.29'); await item.close();
  const limited = await h.open(quota('0.29', { usedToday: 14, remaining: 6 }), 5);
  assert.deepEqual(limited.radios().map(row => [Number(row.value), row.disabled]), [[1, false], [5, false], [10, true], [20, true]]);
  limited.select(10, true); const blocked = await h.begin(limited, quota('0.29')); await blocked.promise;
  assert.equal(h.keys, 0); assert.equal(h.posts().length, 0); unchanged(h);
});

test('unknown fractional response recovers manually with the same key price quantity and body after reload', options, async () => {
  const { h, item } = await ready('0.29', 5), first = await h.begin(item, quota('0.29'));
  first.post.fail(new TypeError('Synthetic lost response')); await first.promise;
  const original = h.sessions.get(scope); assert.equal(h.stored().lumina, 1.45); unchanged(h);
  await tick(); assert.equal(h.posts().length, 1);
  const resumed = harness({ sessions: h.sessions }); assert.equal(resumed.requests.length, 0);
  await resumed.seedWallet(0);
  const exhausted = quota('0.29', { usedToday: 20, remaining: 0 });
  const reopened = await resumed.open(exhausted, 5); assert.equal(reopened.confirm.disabled, false);
  assert.equal(resumed.sessions.get(scope), original);
  const retry = await resumed.begin(reopened, exhausted); assert(retry.post);
  assert.equal(retry.post.options.body, first.post.options.body); assert.equal(resumed.keys, 0);
  assert.equal(retry.post.options.headers['Idempotency-Key'], first.post.options.headers['Idempotency-Key']);
  retry.post.respond(receipt(retry.post, '1.45', true)); await retry.promise;
  assert.equal(resumed.alerts.length, 1); assert.equal(resumed.sessions.size, 0); await resumed.finishReads('0.29');
});

test('an old zero-price intent is preserved but cannot dispatch against an invalid paid-product quote', options, async () => {
  const original = JSON.stringify({ version: 1, key: 'synthetic-zero-price', quantity: 20, lumina: 0 });
  const { h, item } = await ready('0', 20, { sessions: new Map([[scope, original]]) });
  assert.equal(item.confirm.disabled, true); assert(item.radios().every(row => row.disabled));
  item.select(20, true); await item.clickConfirm();
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); assert.equal(h.sessions.get(scope), original); unchanged(h);
});

test('unknown attempt with a changed server price remains disabled and is never silently repriced', options, async () => {
  const { h, item } = await ready('0.29', 5), first = await h.begin(item, quota('0.29'));
  first.post.fail(new TypeError('Synthetic lost response')); await first.promise;
  const original = h.sessions.get(scope); await item.close();
  const changed = await h.open(quota('0.30'), 5); assert.equal(changed.confirm.disabled, true);
  assert(changed.radios().every(row => row.disabled)); assert(optionHtml(changed, 5).includes('1.5L'));
  changed.select(5, true); const rejected = await h.begin(changed, quota('0.30')); await rejected.promise;
  assert.equal(rejected.fresh.length, 0); assert.equal(h.posts().length, 1); assert.equal(h.sessions.get(scope), original);
  assert.equal(h.keys, 1); unchanged(h);
  await changed.close(); const returned = await h.open(quota('0.29'), 5);
  const retry = await h.begin(returned, quota('0.29')); assert.equal(retry.post.options.body, first.post.options.body);
  retry.post.respond(receipt(retry.post, '1.45', true)); await retry.promise; await h.finishReads('0.29');
});

test('legacy ten-for-ninety stored attempt cannot become a hundred-L request or mint a replacement key', options, async () => {
  const original = JSON.stringify({ version: 1, key: 'synthetic-legacy-ten', quantity: 10, lumina: 90 });
  const { h, item } = await ready('10', 10, { sessions: new Map([[scope, original]]) });
  assert(optionHtml(item, 10).includes('100L')); assert.equal(item.confirm.disabled, true);
  assert(item.radios().every(row => row.disabled)); item.select(10, true);
  const blocked = await h.begin(item); await blocked.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); assert.equal(h.sessions.get(scope), original); unchanged(h);
});

for (const freshUnit of ['11', '9', '0']) {
  test(`price change from open ten to confirm ${freshUnit} locks the old quote without automatic repost`, options, async () => {
    const { h, item } = await ready('10', 10), blocked = await h.begin(item, quota(freshUnit)); await blocked.promise;
    assert.equal(h.posts().length, 0); assert.equal(h.keys, 1); assert.equal(item.confirm.disabled, true);
    assert(item.radios().every(row => row.disabled && !row.checked));
    assert(item.radios().every(row => row.option.hidden));
    const original = h.sessions.get(scope); assert.equal(h.stored().lumina, 100); assert.equal(h.stored().quantity, 10);
    const before = h.requests.length; item.select(10, true); await item.clickConfirm(); await tick();
    assert.equal(h.requests.length, before); assert.equal(h.sessions.get(scope), original); unchanged(h);
    await item.close(); const changed = await h.open(quota(freshUnit), 10);
    assert.equal(changed.confirm.disabled, true); assert.equal(h.sessions.get(scope), original);
    await changed.close(); const returned = await h.open(quota('10'), 10);
    const retry = await h.begin(returned, quota('10')); assert(retry.post);
    assert.equal(retry.post.options.headers['Idempotency-Key'], JSON.parse(original).key); assert.equal(h.keys, 1);
    retry.post.respond(receipt(retry.post, 100)); await retry.promise; await h.finishReads();
  });
}

test('a fresh modal with no retained intent requires its own explicit confirmation at the changed unit price', options, async () => {
  const { h, item } = await ready('10', 10); assert.equal(h.keys, 0); await item.close();
  const fresh = await h.open(quota('11'), 10); assert(optionHtml(fresh, 10).includes('110L'));
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 0);
  const first = await h.begin(fresh, quota('11')); assert(first.post); assert.equal(h.stored().lumina, 110);
  first.post.respond(receipt(first.post, 110)); await first.promise; await h.finishReads('11');
});

test('invalid latest quote disables confirmation and preserves the original stored amount without dispatch', options, async () => {
  for (const data of [null, quota('0.001'), quota('90071992547409.92')]) {
    const { h, item } = await ready('0.29', 5), first = await h.begin(item, data); await first.promise;
    assert.equal(h.posts().length, 0); assert.equal(item.confirm.disabled, true); assert.equal(h.stored().lumina, 1.45);
    const original = h.sessions.get(scope), before = h.requests.length;
    await item.clickConfirm(); await tick(); assert.equal(h.requests.length, before); assert.equal(h.sessions.get(scope), original);
    unchanged(h);
  }
});

test('fractional receipt price and ledger amount both must exactly match the retained cents', options, async () => {
  for (const mutate of [value => { value.event.metadata.totalPriceLumina = '1.44'; },
    value => { value.event.walletLedger.amount = '1.46'; }, value => { value.event.metadata.totalPriceLumina = '1.4501'; }]) {
    const { h, item } = await ready('0.29', 5), first = await h.begin(item, quota('0.29'));
    const original = h.sessions.get(scope), value = receipt(first.post, '1.45'); mutate(value);
    first.post.respond(value); await first.promise; unchanged(h); assert.equal(h.sessions.get(scope), original);
    const retry = await h.begin(item, quota('0.29')); assert.equal(retry.post.options.body, first.post.options.body);
    retry.post.respond(receipt(retry.post, '1.45', true)); await retry.promise; await h.finishReads('0.29');
  }
});

test('stored intent schema still rejects invalid amounts quantities keys and extra credentials', options, async () => {
  const valid = { version: 1, key: 'synthetic-stored-key', quantity: 5, lumina: 1.45 };
  for (const data of [null, { ...valid, lumina: '1.45' }, { ...valid, lumina: -1 }, { ...valid, lumina: 0.001 },
    { ...valid, lumina: Number.MAX_SAFE_INTEGER }, { ...valid, quantity: 30 }, { ...valid, key: 'short' },
    { ...valid, version: 2 }, { ...valid, accessToken: 'synthetic-only' }]) {
    const original = JSON.stringify(data), sessions = new Map([[scope, original]]);
    const { h, item } = await ready('0.29', 5, { sessions }); assert.equal(item.confirm.disabled, true);
    const blocked = await h.begin(item, quota('0.29')); await blocked.promise;
    assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); assert.equal(h.sessions.get(scope), original); unchanged(h);
  }
});

test('late fractional quote cannot dispatch after owner campaign artist or modal ownership changes', options, async () => {
  for (const retire of [async h => h.context.setAuth(auth('b')),
    async h => { h.context.syntheticCampaign = ID.otherCampaign; h.read('_currentCampaign = { id: syntheticCampaign };'); },
    async h => { h.context._artists[0].id = ID.b; }, async (h, item) => item.close()]) {
    const { h, item } = await ready('0.29', 5), first = await h.begin(item, quota('0.29'), false);
    assert.equal(first.fresh.length, 1); const original = h.sessions.get(scope);
    await retire(h, item); first.fresh[0].respond(quota('0.29')); await first.promise;
    assert.equal(h.posts().length, 0); assert.equal(h.alerts.length, 0); assert.equal(h.sessions.get(scope), original);
  }
});

test('pending fresh quote and offline confirmation cannot queue a duplicate or change an intent', options, async () => {
  const { h, item } = await ready('0.29', 5);
  h.context.navigator.onLine = false; await item.clickConfirm(); assert.equal(h.keys, 0); assert.equal(h.posts().length, 0);
  h.context.navigator.onLine = true;
  const first = await h.begin(item, quota('0.29'), false); const original = h.sessions.get(scope);
  await item.clickConfirm(); assert.equal(h.keys, 1); assert.equal(h.sessions.get(scope), original); assert.equal(h.posts().length, 0);
  first.fresh[0].respond(quota('0.29')); await tick(); const post = h.posts()[0]; assert(post);
  post.fail(new TypeError('Synthetic lost response')); await first.promise;
  item.select(10, true); const changed = await h.begin(item, quota('0.29')); await changed.promise;
  assert.equal(h.posts().length, 1); assert.equal(h.sessions.get(scope), original);
  item.select(5, true); h.context.navigator.onLine = false;
  await item.clickConfirm(); assert.equal(h.posts().length, 1); assert.equal(h.sessions.get(scope), original); unchanged(h);
});

test('fractional total still checks confirmed balance initially and again after the fresh quote', options, async () => {
  const { h, item } = await ready('0.29', 5); await h.seedWallet(1.44);
  const short = await h.begin(item, quota('0.29')); await short.promise;
  assert.equal(h.keys, 0); assert.equal(h.posts().length, 0);
  await h.seedWallet(1.45); const first = await h.begin(item, quota('0.29'), false);
  const original = h.sessions.get(scope); await h.seedWallet(1.44);
  first.fresh[0].respond(quota('0.29')); await first.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.sessions.get(scope), original); assert.equal(h.keys, 1); unchanged(h, 1.44);
});

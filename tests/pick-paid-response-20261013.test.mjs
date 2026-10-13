import assert from 'node:assert/strict';
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
  product: '77777777-7777-4777-8777-777777777777', ledger: '88888888-8888-4888-8888-888888888888',
  otherCampaign: '99999999-9999-4999-8999-999999999999'
};
const auth = (owner = 'a', suffix = 'original') => ({
  accessToken: `synthetic-access-${owner}-${suffix}`, refreshToken: `synthetic-refresh-${owner}-${suffix}`,
  user: { id: ID[owner] }
});
const quota = (changes = {}) => ({
  campaign: { id: ID.campaign, slug: 'synthetic-campaign', name: 'Synthetic campaign' },
  dailyLimit: 20, usedToday: 0, remaining: 20, unitPriceLumina: '10', resetsAt: '2026-10-14T00:00:00.000Z',
  ...changes
});
const plain = value => JSON.parse(JSON.stringify(value));
const noChargeClaim = /\ucc28\uac10\ub418\uc9c0 \uc54a|\ucc28\uac10\ub418\uc9c0 \uc54a\uc2b5|\bnot charged\b|\bno charge\b/i;
const successClaim = /\uc774\ubbf8 \uc804\ub2ec|\uc804\ub2ec\ub418\uc5c8|completed successfully/i;
async function tick() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

function classes() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value),
    toggle(value, active) { if (active) values.add(value); else values.delete(value); } };
}
function node() {
  const handlers = new Map();
  return { disabled: false, hidden: false, textContent: '', attributes: {}, classList: classes(), style: {},
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
    if (selector === "[name='paidLikeBundle']" || selector === 'input[name="paidLikeBundle"]') return radios;
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

let syntheticKeySequence = 0;
// Real source slices run only in the parent's test child; all transport, storage and DOM are synthetic.
function harness({ owner = 'a', sessions = new Map(), publicName = 'Synthetic artist', storageDenied = false,
  storageReadDenied = false, storageWriteDenied = false } = {}) {
  const values = new Map(owner ? [['lumina_auth', JSON.stringify(auth(owner))]] : []);
  const listeners = new Map(), requests = [], alerts = [], modals = [], logs = [], timers = new Map();
  const badge = { innerHTML: '', style: {} }, hero = { textContent: '' }, like = node();
  like.dataset = { likeSlug: 'artist-a' }; like.count = { textContent: '4' };
  like.querySelector = selector => selector === '.like-count' ? like.count : null;
  let keys = 0, refreshes = 0, nextTimer = 0, authModals = 0;
  const storage = {
    getItem: key => { if (storageDenied || storageReadDenied) throw new Error('Synthetic storage unavailable'); return sessions.get(key) ?? null; },
    setItem: (key, value) => { if (storageDenied || storageWriteDenied) throw new Error('Synthetic storage unavailable'); sessions.set(key, String(value)); },
    removeItem: key => { if (storageDenied) throw new Error('Synthetic storage unavailable'); sessions.delete(key); },
    key: index => [...sessions.keys()][index] ?? null,
    get length() { return sessions.size; }
  };
  const context = {
    AbortController, Event, CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => logs.push(args), info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    crypto: { randomUUID: () => { keys++; return `aaaaaaaa-aaaa-4aaa-8aaa-${String(++syntheticKeySequence).padStart(12, '0')}`; } },
    sessionStorage: storage,
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    navigator: { onLine: true }, _currentLocale: 'ko-KR',
    _artists: [{ id: ID.artist, slug: 'artist-a', publicName }],
    getCharacterBySlug: slug => context._artists.find(artist => artist.slug === slug),
    t: key => ({ 'pick.hero.quota': '{remaining}/{limit}', 'pick.action.support': 'Support' })[key] || key,
    alert: text => alerts.push(text), openAuthModal: () => { authModals++; }, currentAuthReturn: () => '/lumina-pick', updateAuthUI() {},
    window: {
      sessionStorage: storage,
      addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
      dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
      refreshPopularVotePage: () => { refreshes++; }
    },
    document: {
      getElementById: id => id === 'walletBadge' ? badge : id === 'heroQuotaLabel' ? hero : id === 'voteTabs' ? {} : null,
      querySelector: selector => selector === '.paid-like-modal-overlay' ? modals.find(item => item.isConnected) || null : null,
      querySelectorAll: selector => selector === '.paid-like-modal-overlay' ? modals.filter(item => item.isConnected)
        : selector === '[data-like-slug]' || selector === '[data-like-slug="artist-a"]' ? [like] : [],
      createElement: tag => { assert.equal(tag, 'div'); const item = overlay(); modals.push(item); return item; },
      body: { style: {}, appendChild: item => { item.isConnected = true; } }
    },
    fetch(url, requestOptions) {
      const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.lumina-stage.com');
      const method = requestOptions.method || 'GET';
      const permitted = method === 'POST'
        ? /^\/api\/v1\/boost-campaigns\/[^/]+\/(?:paid|free)-like$/.test(parsed.pathname) || parsed.pathname === '/api/v1/auth/refresh'
        : ['/api/v1/wallet', '/api/v1/me/paid-like-quota', '/api/v1/me/free-like-quota'].includes(parsed.pathname)
          || /^\/api\/v1\/boost-campaigns\/[^/]+\/rankings$/.test(parsed.pathname);
      assert.equal(permitted, true, 'No unrelated API/provider request in the synthetic fixture');
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { path: parsed.pathname, search: parsed.search, options: requestOptions, method, done: false,
        ownerId: context.getAuth()?.user?.id };
      request.respond = (body, status = 200) => {
        request.done = true; resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
      };
      request.fail = error => { request.done = true; reject(error); };
      requestOptions.signal?.addEventListener('abort', () => request.fail(Object.assign(new Error('Synthetic abort'), { name: 'AbortError' })), { once: true });
      requests.push(request); return promise;
    }
  };
  for (const source of sources) runInNewContext(source, context, { filename: 'app.js:paid-source-extraction' });
  const read = code => runInNewContext(code, context);
  context.syntheticCampaign = ID.campaign;
  read('_currentCampaign = { id: syntheticCampaign }; _rankings = [{ slug: "artist-a", likes: 4 }];');
  const posts = () => requests.filter(row => row.path.endsWith('/paid-like'));
  const h = {
    context, values, sessions, requests, alerts, modals, logs, timers, posts,
    get keys() { return keys; }, get refreshes() { return refreshes; }, get authModals() { return authModals; },
    state: () => plain(read('({ wallet: _wallet, rankings: _rankings })')),
    switch: (next = 'b', suffix = 'original') => context.setAuth(next ? auth(next, suffix) : null),
    campaign: value => { context.syntheticCampaign = value; read('_currentCampaign = { id: syntheticCampaign };'); },
    seedWallet: async (balance = 100) => {
      const promise = context.loadWallet(); requests.at(-1).respond({ cachedBalance: String(balance), currencyCode: 'LUMINA' }); await promise;
    },
    async unknownWallet() {
      const promise = context.loadWallet(); requests.at(-1).respond({ cachedBalance: null, currencyCode: 'LUMINA' }); await promise;
    },
    async open({ data = quota(), quantity = 1 } = {}) {
      const before = requests.length, promise = context.openPaidLikeModal('artist-a'); await tick();
      for (const row of requests.slice(before).filter(row => row.path.endsWith('/paid-like-quota') && !row.done)) row.respond(data);
      await promise;
      const item = modals.at(-1);
      if (item?.isConnected && item.radios().some(radio => Number(radio.value) === quantity && !radio.disabled)) item.select(quantity);
      return item;
    },
    async begin(item, { data = quota(), answerQuote = true } = {}) {
      const before = requests.length, promise = item.clickConfirm(); await tick();
      const fresh = requests.slice(before).filter(row => row.path.endsWith('/paid-like-quota') && !row.done);
      if (answerQuote) { for (const row of fresh) row.respond(data); await tick(); }
      const post = requests.slice(before).filter(row => row.method === 'POST' && row.path.endsWith('/paid-like')).at(-1);
      return { promise, fresh, post, before };
    },
    async finishReads({ balance = '73.25', rankings = [{ artist: { slug: 'artist-a' }, totalWeightedScore: '19' }] } = {}) {
      for (const row of requests.filter(row => !row.done && row.method === 'GET')) {
        row.respond(row.path === '/api/v1/wallet' ? { cachedBalance: balance }
          : row.path.endsWith('/paid-like-quota') ? quota({ campaign: { id: ID.campaign } })
            : row.path.endsWith('/free-like-quota') ? { dailyLimit: 1, usedToday: 0, remaining: 1 } : rankings);
      }
      await tick();
    },
    read,
    async rotate() {
      const promise = context.refreshAuthOnce(); assert.equal(requests.at(-1).path, '/api/v1/auth/refresh');
      requests.at(-1).respond(auth('a', 'rotated')); await promise; read('_refreshInFlight = null;');
    },
    async acceptFree() {
      const loading = context.loadFreeLikeQuota(); requests.at(-1).respond({ dailyLimit: 1, usedToday: 0, remaining: 1 }); await loading;
      const promise = context.handleLike('artist-a', like); await tick();
      const request = requests.at(-1); assert.equal(request.path, `/api/v1/boost-campaigns/${ID.campaign}/free-like`);
      const body = JSON.parse(request.options.body);
      request.respond({ event: { id: ID.event, userId: ID.a, campaignId: ID.campaign, artistId: body.artistId,
        boostType: 'free_like', idempotencyKey: body.idempotencyKey }, idempotentReplay: false });
      await promise;
    }
  };
  return h;
}

function receipt(request, replay = false) {
  const body = JSON.parse(request.options.body), quantity = body.quantity;
  const ownerId = request.ownerId;
  const campaignId = request.path.split('/')[4];
  const ledger = { id: ID.ledger, walletAccountId: ID.wallet, direction: 'debit', amount: String(quantity * 10),
    ledgerType: 'boost_spend', referenceType: 'boost_product', referenceId: ID.product,
    idempotencyKey: 'wallet:boost-paid-like:' + body.idempotencyKey };
  return {
    event: { id: ID.event, userId: ownerId, campaignId, artistId: body.artistId, boostType: 'lumina_boost',
      boostProductId: ID.product, walletLedgerId: ID.ledger, walletLedger: ledger, idempotencyKey: body.idempotencyKey,
      rawAmount: String(quantity), weightedScore: String(quantity), metadata: { source: 'paid_like', idempotencyScope: 'boost-paid-like',
        quantity, artistSlug: body.artistSlug, unitPriceLumina: '10', totalPriceLumina: String(quantity * 10) } },
    idempotentReplay: replay,
    paidLike: { quantity, unitPriceLumina: '10', totalPriceLumina: String(quantity * 10), unitBoostAmount: '1', totalBoostAmount: String(quantity),
      ...(replay ? {} : { dailyLimit: 20, usedToday: quantity, remainingToday: 20 - quantity, resetsAt: '2026-10-14T00:00:00.000Z' }) },
    wallet: { id: ID.wallet, userId: ownerId, currencyCode: 'LUMINA', status: 'active', cachedBalance: String(100 - quantity * 10) }
  };
}
async function ready(config) { const h = harness(config); await h.seedWallet(); const item = await h.open(); assert(item?.isConnected); return { h, item }; }
function unconfirmed(h, item) {
  assert.equal(h.alerts.length, 0); assert.equal(h.state().rankings[0].likes, 4);
  assert.equal(h.state().wallet.balance, 100); assert(item.message.textContent.length > 0);
  assert.doesNotMatch(item.message.textContent, noChargeClaim); assert.doesNotMatch(item.message.textContent, successClaim);
}

test('paid source fixture keeps native auth pick wallet quote receipt and escape functions', options, () => {
  assert.match(sources[0], /function apiFetch\(/); assert.match(sources[2], /function pickRequestCurrent\(/);
  assert.match(sources[5], /function paidLikeQuote\(/); assert.match(sources[5], /function paidLikeReceiptMatches\(/);
  assert.match(sources[7], /function feedEscapeHtml\(/);
  assert.match(sources[2], /let _pickRankingVersion = 0;/);
  assert.match(sources[3], /const rankingVersion = \+\+_pickRankingVersion;[\s\S]*await apiFetch[\s\S]*rankingVersion === _pickRankingVersion && _currentCampaign\?\.id === campaign\.id/);
  const free = extract('async function handleLike(', 'const PAID_LIKE_BUNDLES = [');
  const paid = extract('async function openPaidLikeModal(', 'function updateLikeButtons(');
  assert.match(free, /const rankingVersion = \+\+_pickRankingVersion;[\s\S]*apiFetch[\s\S]*!pickRequestCurrent\(epoch, campaignId\) \|\| rankingVersion !== _pickRankingVersion/);
  assert.match(paid, /const rankingVersion = \+\+_pickRankingVersion;[\s\S]*apiFetch[\s\S]*!identityCurrent\(\) \|\| rankingVersion !== _pickRankingVersion/);
  const h = harness(); assert.equal(h.requests.length, 0); assert.equal(h.keys, 0);
});
test('normal fresh receipt dispatches captured canonical fields and updates only from current server GETs', options, async () => {
  const { h, item } = await ready(); const attempt = await h.begin(item); assert(attempt.post);
  const body = JSON.parse(attempt.post.options.body);
  assert.deepEqual(Object.keys(body).sort(), ['artistId', 'artistSlug', 'quantity', 'expectedTotalPriceLumina', 'idempotencyKey'].sort());
  assert.equal(body.expectedTotalPriceLumina, '10.00');
  assert.equal(body.artistId, ID.artist); assert.equal(body.artistSlug, 'artist-a'); assert.equal(body.quantity, 1);
  assert.equal(body.idempotencyKey, attempt.post.options.headers['Idempotency-Key']);
  assert.equal(attempt.post.options.headers.Authorization, 'Bearer synthetic-access-a-original');
  assert.equal(attempt.post.path, `/api/v1/boost-campaigns/${ID.campaign}/paid-like`); assert.equal(attempt.fresh.length, 1);
  attempt.post.respond(receipt(attempt.post)); await attempt.promise;
  assert.equal(h.state().rankings[0].likes, 4); assert.equal(h.state().wallet.balance, 100);
  assert.equal(h.posts().length, 1); assert.equal(h.keys, 1); assert.equal(h.alerts.length, 1);
  assert.equal(item.isConnected, false); assert.equal(h.sessions.size, 0);
  await h.finishReads(); assert.equal(h.state().wallet.balance, 73.25); assert.equal(h.state().rankings[0].likes, 19);
});
test('lost response preserves one key and same manual retry body without automatic POST', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.fail(new TypeError('Failed to fetch')); await first.promise;
  unconfirmed(h, item); await tick(); assert.equal(h.posts().length, 1); assert.equal(h.keys, 1);
  assert.match(item.message.textContent, /\ubbf8\ucc98\ub9ac\uc600\ub2e4\uba74 \uc694\uae08\uc774 \ucc28\uac10\ub420 \uc218/);
  assert.match(item.confirm.textContent, /\uac19\uc740 \uc694\uccad \uc7ac\uc2dc\ub3c4/);
  const retry = await h.begin(item); assert.equal(retry.post.options.body, first.post.options.body);
  assert.equal(retry.post.options.headers['Idempotency-Key'], first.post.options.headers['Idempotency-Key']);
  retry.post.respond(receipt(retry.post, true)); await retry.promise;
  assert.equal(h.state().rankings[0].likes, 4); assert.equal(h.state().wallet.balance, 100);
  assert.equal(h.keys, 1); assert.equal(h.posts().length, 2); await h.finishReads();
});
test('pending direct duplicate and pending modal recreation cannot dispatch another paid request', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item);
  const duplicate = item.clickConfirm(); await duplicate; assert.equal(h.posts().length, 1);
  const before = h.requests.length, modalCount = h.modals.length; await h.open();
  assert.equal(h.modals.length, modalCount); assert.equal(h.requests.length, before); assert.equal(h.posts().length, 1);
  first.post.respond(receipt(first.post)); await first.promise; await h.finishReads();
});
test('fresh quota pending sets intent busy before a second confirm can enter', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item, { answerQuote: false });
  assert.equal(first.fresh.length, 1); assert.equal(h.posts().length, 0);
  await item.clickConfirm(); assert.equal(h.requests.filter(row => row.path.endsWith('/paid-like-quota')).length, 2);
  first.fresh[0].respond(quota()); await tick(); const post = h.posts()[0]; assert(post);
  post.respond(receipt(post)); await first.promise; await h.finishReads();
});
test('unresolved quantity cannot change or mint a replacement key', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.fail(new TypeError('Failed to fetch')); await first.promise;
  item.select(5, true); const changed = await h.begin(item); await changed.promise;
  assert.equal(h.posts().length, 1); assert.equal(h.keys, 1);
  item.select(1, true); const retry = await h.begin(item);
  assert.equal(retry.post.options.body, first.post.options.body); retry.post.respond(receipt(retry.post, true)); await retry.promise; await h.finishReads();
});
test('session reload restores the same unresolved key quantity and price without background requests', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.fail(new TypeError('Failed to fetch')); await first.promise;
  const resumed = harness({ sessions: h.sessions }); assert.equal(resumed.requests.length, 0);
  await resumed.seedWallet(); const reopened = await resumed.open(); const retry = await resumed.begin(reopened);
  assert.equal(retry.post.options.body, first.post.options.body); assert.equal(resumed.keys, 0);
  retry.post.respond(receipt(retry.post, true)); await retry.promise; await resumed.finishReads();
});
test('stored intent contains only version key quantity lumina and no credential fields', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item);
  assert.equal(h.sessions.size, 1);
  const data = JSON.parse([...h.sessions.values()][0]);
  assert.deepEqual(Object.keys(data).sort(), ['version', 'key', 'quantity', 'lumina'].sort());
  assert.equal(data.version, 1); assert.equal(data.quantity, 1); assert.equal(data.lumina, 10);
  assert.equal(data.key, JSON.parse(first.post.options.body).idempotencyKey);
  assert(![...h.sessions.values()][0].includes('synthetic-access')); assert(![...h.sessions.values()][0].includes('synthetic-refresh'));
  first.post.fail(new TypeError('Failed to fetch')); await first.promise;
});
test('storage unavailable blocks POST even when wallet and quote are confirmed', options, async () => {
  const { h, item } = await ready({ storageDenied: true }); const attempt = await h.begin(item); await attempt.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.alerts.length, 0); assert.equal(h.sessions.size, 0);
});
test('storage write failure blocks dispatch separately from storage read failure', options, async () => {
  const { h, item } = await ready({ storageWriteDenied: true }); const attempt = await h.begin(item); await attempt.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 1); assert.equal(h.sessions.size, 0); assert.equal(h.alerts.length, 0);
});
for (const [name, text] of [
  ['malformed JSON', '{'], ['null record', 'null'],
  ['wrong price', JSON.stringify({ version: 1, key: 'synthetic-stored-key', quantity: 1, lumina: 9 })],
  ['extra credential field', JSON.stringify({ version: 1, key: 'synthetic-stored-key', quantity: 1, lumina: 10, accessToken: 'synthetic-only' })]
]) {
  test(`malformed stored intent rejects ${name} rather than minting a new paid key`, options, async () => {
    const sessions = new Map([['lumina_paid_like:' + JSON.stringify([ID.a, ID.campaign, ID.artist]), text]]);
    const { h, item } = await ready({ sessions }); const attempt = await h.begin(item); await attempt.promise;
    assert.equal(h.posts().length, 0); assert.equal(h.keys, 0); assert.equal(h.alerts.length, 0);
    assert.equal([...sessions.values()][0], text);
  });
}
test('unknown intent replay is not blocked by a current confirmed zero wallet or zero remaining quota', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.fail(new TypeError('Failed to fetch')); await first.promise;
  await h.seedWallet(0); await item.close();
  const exhausted = quota({ usedToday: 20, remaining: 0 });
  const reopened = await h.open({ data: exhausted }); assert(reopened?.isConnected);
  const retry = await h.begin(reopened, { answerQuote: false }); assert.equal(h.posts().length, 1);
  await h.seedWallet(0); retry.fresh[0].respond(exhausted); await tick();
  const post = h.posts().at(-1); assert.notEqual(post, first.post); assert.equal(post.options.body, first.post.options.body);
  assert.equal(post.options.headers['Idempotency-Key'], first.post.options.headers['Idempotency-Key']);
  post.respond(receipt(post, true)); await retry.promise; assert.equal(h.keys, 1); await h.finishReads();
});

const invalidReceipts = [
  ['null', () => null], ['empty', () => ({})], ['missing event', value => { delete value.event; }],
  ['empty event id', value => { value.event.id = ''; }], ['wrong owner', value => { value.event.userId = ID.b; }],
  ['wrong campaign', value => { value.event.campaignId = ID.otherCampaign; }],
  ['wrong artist', value => { value.event.artistId = ID.b; }], ['wrong key', value => { value.event.idempotencyKey = 'synthetic-wrong-key'; }],
  ['wrong boost type', value => { value.event.boostType = 'free_like'; }],
  ['wrong source', value => { value.event.metadata.source = 'boost_order'; }],
  ['wrong quantity', value => { value.event.metadata.quantity = 5; }],
  ['wrong recorded price', value => { value.event.metadata.totalPriceLumina = '9'; }],
  ['missing ledger', value => { delete value.event.walletLedger; }],
  ['wrong ledger link', value => { value.event.walletLedger.id = ID.b; }],
  ['wrong ledger direction', value => { value.event.walletLedger.direction = 'credit'; }],
  ['wrong ledger scope key', value => { value.event.walletLedger.idempotencyKey = 'wallet:other-scope:key'; }],
  ['wrong ledger amount', value => { value.event.walletLedger.amount = '9'; }],
  ['nonfinite ledger amount', value => { value.event.walletLedger.amount = 'Infinity'; }],
  ['missing replay', value => { delete value.idempotentReplay; }],
  ['string replay', value => { value.idempotentReplay = 'false'; }],
  ['wrong paid quantity', value => { value.paidLike.quantity = 5; }]
];
for (const [name, mutate] of invalidReceipts) {
  test(`paid receipt rejects ${name} and retains the original uncertain intent`, options, async () => {
    const { h, item } = await ready(); const first = await h.begin(item), value = receipt(first.post);
    const replacement = mutate(value); first.post.respond(replacement === undefined ? value : replacement); await first.promise;
    unconfirmed(h, item); assert.equal(h.keys, 1); assert.equal(h.posts().length, 1);
    const postCount = h.posts().length;
    const retry = await h.begin(item);
    assert.equal(h.posts().length, postCount + 1);
    assert(retry.post); assert.notEqual(retry.post, first.post);
    assert.equal(retry.post.options.body, first.post.options.body);
    assert.equal(retry.post.options.headers['Idempotency-Key'], first.post.options.headers['Idempotency-Key']);
    retry.post.respond(receipt(retry.post, true)); await retry.promise;
    assert.equal(h.alerts.length, 1); assert.equal(item.isConnected, false); assert.equal(h.sessions.size, 0);
    const confirmed = h.read('[..._paidLikeAttempts.values()][0]');
    assert.equal(confirmed.confirmed, true); assert.equal(confirmed.pending, false);
    assert.equal(h.state().wallet.balance, 100); assert.equal(h.state().rankings[0].likes, 4);
    assert.equal(h.keys, 1); await h.finishReads();
  });
}
for (const [name, status, body] of [
  ['structured conflict', 409, { code: 'BOOST_IDEMPOTENCY_CONFLICT', message: 'boost.error.idempotencyConflict', walletMutation: false }],
  ['unrelated conflict', 409, { message: 'Synthetic unrelated conflict' }],
  ['required key rejection', 400, { code: 'BOOST_IDEMPOTENCY_REQUIRED', message: 'boost.error.idempotencyRequired', walletMutation: false }]
]) {
  test(`paid ${name} is never a confirmed replay or success`, options, async () => {
    const { h, item } = await ready(); const first = await h.begin(item); first.post.respond(body, status); await first.promise;
    unconfirmed(h, item); assert.equal(h.requests.length, first.before + 2);
    assert.equal(h.posts().length, 1); assert.equal(h.keys, 1);
  });
}

const invalidQuotes = [
  ['missing quota', null], ['missing price', quota({ unitPriceLumina: undefined })],
  ['price suffix', quota({ unitPriceLumina: '10L' })], ['nonfinite price', quota({ unitPriceLumina: Infinity })],
  ['wrong campaign', quota({ campaign: { id: ID.otherCampaign } })],
  ['wrong daily limit', quota({ dailyLimit: 19 })], ['inconsistent remaining', quota({ usedToday: 1, remaining: 20 })],
  ['boolean price', quota({ unitPriceLumina: true })]
];
for (const [name, data] of invalidQuotes) {
  test(`unconfirmed initial ${name} cannot permit a paid POST`, options, async () => {
    const h = harness(); await h.seedWallet(); const item = await h.open({ data });
    if (item?.isConnected) { assert(item.radios().every(radio => radio.disabled)); const attempt = await h.begin(item); await attempt.promise; }
    assert.equal(h.posts().length, 0); assert.equal(h.keys, 0);
  });
}
test('approved server price supplies ten at one hundred without a client discount', options, async () => {
  const { h, item } = await ready();
  assert.deepEqual(plain(h.read('PAID_LIKE_BUNDLES.map(row => row.quantity)')), [1, 5, 10, 20]);
  assert.equal(item.radios().find(radio => radio.value === '10').disabled, false);
  assert.match(item.innerHTML, /10개 · 100L/);
  item.select(10); const attempt = await h.begin(item); assert(attempt.post);
  assert.equal(JSON.parse(attempt.post.options.body).quantity, 10);
  attempt.post.respond(receipt(attempt.post)); await attempt.promise; await h.finishReads();
  assert.equal(h.posts().length, 1); assert.equal(h.keys, 1);
});
test('fresh quote is revalidated rather than authorizing the initial price', options, async () => {
  const { h, item } = await ready(); const changed = await h.begin(item, { data: quota({ unitPriceLumina: '11' }) }); await changed.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 1);
  const blocked = await h.begin(item); await blocked.promise; assert.equal(h.posts().length, 0);
  item.close(); const reopened = await h.open(); const retry = await h.begin(reopened);
  assert(retry.post); retry.post.respond(receipt(retry.post)); await retry.promise; await h.finishReads();
  assert.equal(h.keys, 1);
});
test('fresh exhausted quota blocks a new intent without inventing a replacement key', options, async () => {
  const { h, item } = await ready(); const blocked = await h.begin(item, { data: quota({ usedToday: 20, remaining: 0 }) }); await blocked.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 1); assert.equal(h.alerts.length, 0);
});
test('new intent cannot POST after a fresh quota transport failure', options, async () => {
  const { h, item } = await ready(); const blocked = await h.begin(item, { answerQuote: false });
  blocked.fresh[0].fail(new TypeError('Failed to fetch')); await blocked.promise;
  assert.equal(h.posts().length, 0); assert.equal(h.keys, 1); assert.equal(h.alerts.length, 0);
});
for (const changed of ['unknown', 'confirmed insufficient']) {
  test(`fresh quota await rechecks same-owner ${changed} wallet before POST and keeps its key`, options, async () => {
    const { h, item } = await ready(); const first = await h.begin(item, { answerQuote: false });
    const storedBefore = [...h.sessions.values()][0]; assert.equal(h.keys, 1);
    if (changed === 'unknown') await h.unknownWallet();
    else await h.seedWallet(0);
    first.fresh[0].respond(quota()); await first.promise;
    assert.equal(h.posts().length, 0); assert.equal(h.keys, 1); assert.equal(h.alerts.length, 0);
    assert.equal([...h.sessions.values()][0], storedBefore);
  });
}
test('confirmed zero and unknown wallet block a fresh intent before any additional quota or POST', options, async () => {
  for (const value of [0, null]) {
    const { h, item } = await ready();
    if (value === 0) await h.seedWallet(0);
    else await h.unknownWallet();
    const before = h.requests.length; await item.clickConfirm();
    assert.equal(h.requests.length, before); assert.equal(h.posts().length, 0); assert.equal(h.keys, 0);
  }
});

for (const change of ['owner', 'logout', 'campaign', 'artist', 'same-owner-login']) {
  test(`late paid success after ${change} cannot change current wallet ranking or follow-up reads`, options, async () => {
    const { h, item } = await ready(); const first = await h.begin(item);
    if (change === 'owner') { h.switch('b'); await h.seedWallet(300); }
    else if (change === 'logout') h.switch(null);
    else if (change === 'campaign') h.campaign(ID.otherCampaign);
    else if (change === 'artist') h.context._artists[0].id = ID.b;
    else h.switch('a', 'relogin');
    const before = plain(h.state()), requestCount = h.requests.length, refreshes = h.refreshes;
    first.post.respond(receipt(first.post)); await first.promise; await tick();
    assert.deepEqual(h.state(), before); assert.equal(h.requests.length, requestCount);
    assert.equal(h.alerts.length, 0); assert.equal(h.refreshes, refreshes);
  });
}
test('late paid failure after owner replacement cannot publish an old error or additional reads', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); h.switch('b'); await h.seedWallet(300);
  const before = item.message.textContent, requestCount = h.requests.length;
  first.post.fail(new TypeError('Failed to fetch')); await first.promise;
  assert.equal(item.message.textContent, before); assert.equal(h.requests.length, requestCount); assert.equal(h.alerts.length, 0);
});
test('fresh quota completion after campaign replacement cannot dispatch captured stale POST', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item, { answerQuote: false }); h.campaign(ID.otherCampaign);
  first.fresh[0].respond(quota()); await first.promise; assert.equal(h.posts().length, 0); assert.equal(h.alerts.length, 0);
});
test('closing a pending modal retires its response without automatic retry or local deduction', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); await item.close();
  const before = h.requests.length; first.post.respond(receipt(first.post)); await first.promise;
  assert.equal(h.requests.length, before); assert.equal(h.alerts.length, 0);
  assert.equal(h.state().wallet.balance, 100); assert.equal(h.state().rankings[0].likes, 4); assert.equal(h.sessions.size, 1);
});
test('owner scopes isolate B intent while A manual return retains its uncertain original key', options, async () => {
  const { h, item } = await ready(); const a = await h.begin(item); a.post.fail(new TypeError('Failed to fetch')); await a.promise;
  h.switch('b'); await h.seedWallet(); const bModal = await h.open(); const b = await h.begin(bModal);
  assert.notEqual(b.post.options.headers['Idempotency-Key'], a.post.options.headers['Idempotency-Key']);
  b.post.respond(receipt(b.post)); await b.promise; await h.finishReads();
  h.switch('a'); await h.seedWallet(); const returned = await h.open(); const retry = await h.begin(returned);
  assert.equal(retry.post.options.body, a.post.options.body); assert.equal(h.keys, 2);
  retry.post.respond(receipt(retry.post, true)); await retry.promise; await h.finishReads();
});
test('normal identity allows ranking and empty ranking callbacks after successful modal close', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.respond(receipt(first.post)); await first.promise;
  assert.equal(item.isConnected, false); await h.finishReads({ rankings: [] }); assert.deepEqual(h.state().rankings, []);
});
test('late ranking after accepted A response cannot replace B state', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); first.post.respond(receipt(first.post)); await first.promise;
  h.switch('b'); h.read('_rankings = [{ slug: "artist-a", likes: 30 }];'); await h.seedWallet(300);
  await h.finishReads({ rankings: [{ artist: { slug: 'artist-a' }, totalWeightedScore: '99' }] });
  assert.equal(h.state().rankings[0].likes, 30); assert.equal(h.state().wallet.balance, 300);
});
test('real free ranking started before paid ranking cannot overwrite the newer paid result', options, async () => {
  const { h, item } = await ready(); await h.acceptFree();
  const older = h.requests.filter(row => row.path.endsWith('/rankings')).at(-1); assert(older);
  const paid = await h.begin(item); paid.post.respond(receipt(paid.post)); await paid.promise;
  const newer = h.requests.filter(row => row.path.endsWith('/rankings')).at(-1); assert.notEqual(newer, older);
  newer.respond([{ artist: { slug: 'artist-a' }, totalWeightedScore: '21' }]); await tick();
  assert.equal(h.state().rankings[0].likes, 21);
  older.respond([{ artist: { slug: 'artist-a' }, totalWeightedScore: '9' }]); await tick();
  assert.equal(h.state().rankings[0].likes, 21); await h.finishReads();
});
test('real paid ranking started before free ranking cannot overwrite the newer free result', options, async () => {
  const { h, item } = await ready(); const paid = await h.begin(item); paid.post.respond(receipt(paid.post)); await paid.promise;
  const older = h.requests.filter(row => row.path.endsWith('/rankings')).at(-1); assert(older);
  await h.acceptFree(); const newer = h.requests.filter(row => row.path.endsWith('/rankings')).at(-1); assert.notEqual(newer, older);
  newer.respond([{ artist: { slug: 'artist-a' }, totalWeightedScore: '22' }]); await tick();
  assert.equal(h.state().rankings[0].likes, 22);
  older.respond([{ artist: { slug: 'artist-a' }, totalWeightedScore: '10' }]); await tick();
  assert.equal(h.state().rankings[0].likes, 22); await h.finishReads();
});
test('same-owner native refresh rotation keeps a valid captured receipt without changing the intent key', options, async () => {
  const { h, item } = await ready(); const first = await h.begin(item); await h.rotate();
  first.post.respond(receipt(first.post)); await first.promise; assert.equal(h.alerts.length, 1); assert.equal(h.keys, 1); await h.finishReads();
});
test('public artist markup is escaped in the actual paid modal', options, async () => {
  const name = '<img src=x onerror="synthetic"> & \uD55C\uAE00'; const { h, item } = await ready({ publicName: name });
  assert(item.innerHTML.includes('&lt;img')); assert(item.innerHTML.includes('&quot;synthetic&quot;'));
  assert(!item.innerHTML.includes('<img src=x')); assert.equal(h.posts().length, 0); assert.equal(h.keys, 0);
});

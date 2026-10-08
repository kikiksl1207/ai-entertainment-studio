import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function extract(start, end) {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert(first >= 0 && last > first, `Source anchors: ${start}`);
  assert.equal(app.indexOf(start, first + 1), -1, `Unique source anchor: ${start}`);
  return app.slice(first, last);
}
const sources = [
  extract('const API_BASE =', 'const I18N_LOCALES ='),
  extract('function generateIdempotencyKey()', 'function isLikelyOffline()'),
  extract('let _currentCampaign = null;', 'function rankingMetricNumber('),
  extract('function getLikesCount(', 'const PAID_LIKE_BUNDLES ='),
  extract('function updateLikeButtons(', 'function bindLikeButtons('),
  extract('let _freeLikeQuota = null;', '/* ── 렌더링: 비공개 아티스트 라인')
];
const options = { timeout: 2000 };
const auth = (owner = 'a', suffix = 'original') => ({
  accessToken: `synthetic-access-${owner}-${suffix}`,
  refreshToken: `synthetic-refresh-${owner}-${suffix}`,
  user: { id: `synthetic-user-${owner}` }
});
const quota = (remaining = 0) => ({ dailyLimit: 1, usedToday: 1 - remaining, remaining });
const plain = value => JSON.parse(JSON.stringify(value));
async function tick() { for (let n = 0; n < 16; n++) await Promise.resolve(); }
function button(slug = 'artist-a') {
  const classes = new Set(), count = { textContent: '4' };
  return {
    dataset: { likeSlug: slug }, disabled: false, title: 'Support', attributes: {},
    classList: {
      remove: value => classes.delete(value),
      contains: value => classes.has(value),
      toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector: selector => selector === '.like-count' ? count : null,
    count
  };
}

function harness({ loggedIn = true } = {}) {
  const values = new Map(loggedIn ? [['lumina_auth', JSON.stringify(auth())]] : []);
  const listeners = new Map(), requests = [], alerts = [], paid = [], modals = [];
  const hero = { textContent: '' }, buttons = [button()];
  let keys = 0, pageRefreshes = 0, authUpdates = 0;
  const context = {
    AbortController, Event,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout: () => 1, clearTimeout() {},
    console: { info() {}, warn() {}, error() {} },
    crypto: { randomUUID: () => `11111111-1111-4111-8111-${String(++keys).padStart(12, '0')}` },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    window: {
      addEventListener(name, callback) {
        const callbacks = listeners.get(name) || []; callbacks.push(callback); listeners.set(name, callbacks);
      },
      dispatchEvent(event) { for (const callback of listeners.get(event.type) || []) callback(event); },
      refreshPopularVotePage: () => { pageRefreshes++; }
    },
    document: {
      getElementById: id => id === 'heroQuotaLabel' ? hero : id === 'voteTabs' ? {} : null,
      querySelectorAll(selector) {
        if (selector === '[data-like-slug]') return buttons;
        return buttons.filter(btn => selector === `[data-like-slug="${btn.dataset.likeSlug}"]`);
      }
    },
    _currentLocale: 'en-US',
    _artists: [{ slug: 'artist-a', id: 'synthetic-artist-a' }, { slug: 'artist-b', id: 'synthetic-artist-b' }],
    feedEscapeHtml: value => String(value),
    getCharacterBySlug: slug => context._artists.find(artist => artist.slug === slug),
    getRankingLikes: row => row.totalWeightedScore ?? row.likes ?? 0,
    updateAuthUI: () => { authUpdates++; },
    openAuthModal: (...args) => modals.push(args),
    currentAuthReturn: () => '/lumina-pick',
    openPaidLikeModal: slug => paid.push(slug),
    alert: message => alerts.push(message),
    t: key => ({
      'pick.hero.quota': '{remaining}/{limit} left today',
      'pick.hero.oneVote': 'Your vote today',
      'pick.status.loading': 'Loading',
      'pick.status.unavailable': 'Results unavailable',
      'pick.action.support': 'Support',
      'pick.action.unavailable': 'Support unavailable'
    })[key] || key,
    fetch(url, requestOptions) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const request = { path: new URL(url).pathname, options: requestOptions, done: false };
      request.respond = (body, status = 200) => {
        request.done = true; resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
      };
      request.fail = error => { request.done = true; reject(error); };
      requests.push(request);
      return promise;
    }
  };
  for (const source of sources) runInNewContext(source, context, { filename: 'app.js:pick-source-extraction' });
  runInNewContext('_currentCampaign = { id: "synthetic-campaign-a" }; _rankings = [{ slug: "artist-a", likes: 4 }];', context);
  const read = code => runInNewContext(code, context);
  const h = {
    context, values, requests, alerts, paid, modals, hero, buttons, read,
    get keys() { return keys; }, get pageRefreshes() { return pageRefreshes; }, get authUpdates() { return authUpdates; },
    state: () => plain(read('({ quota: _freeLikeQuota, status: _freeLikeQuotaState, liked: [..._userLikedSlugs], rankings: _rankings })')),
    load: () => context.loadFreeLikeQuota(),
    like: (slug = 'artist-a', btn = buttons[0]) => context.handleLike(slug, btn),
    switch: next => context.setAuth(next),
    storage(next, key = 'lumina_auth') {
      if (next) values.set('lumina_auth', JSON.stringify(next)); else values.delete('lumina_auth');
      context.window.dispatchEvent({ type: 'storage', key });
    },
    campaign(id) { context.fixtureCampaignId = id; read('_currentCampaign = { id: fixtureCampaignId };'); },
    success(request, { replay = false, owner = 'synthetic-user-a' } = {}) {
      const body = JSON.parse(request.options.body);
      const campaignId = request.path.split('/')[4];
      request.respond({ event: { id: 'synthetic-event', userId: owner, campaignId, artistId: body.artistId }, idempotentReplay: replay });
    },
    async finishReads() {
      for (const request of requests.filter(item => !item.done && (item.options.method || 'GET') === 'GET')) {
        request.respond(request.path.endsWith('/free-like-quota') ? quota() : []);
      }
      await tick();
    },
    async rotate(suffix) {
      const pending = context.refreshAuthOnce();
      assert.equal(requests.at(-1).path, '/api/v1/auth/refresh');
      requests.at(-1).respond(auth('a', suffix));
      await pending;
      read('_refreshInFlight = null;');
    }
  };
  return h;
}

test('uses unchanged native auth/API helpers and real free-like functions without source substitutions', options, () => {
  for (const name of ['apiFetch', 'refreshAuthOnce', 'authRequestSessionCurrent', 'setAuth']) assert.match(sources[0], new RegExp(`function ${name}\\(`));
  assert.match(sources[3], /async function handleLike\(/);
  assert.match(sources[5], /async function loadFreeLikeQuota\(/);
  assert.match(sources[3], /idempotencyKey: attempt.key/);
});

test('confirmed zero quota remains zero and authenticated loading is distinct', options, async () => {
  for (const data of [quota(), { dailyLimit: 0, usedToday: 0, remaining: 0 }]) {
    const h = harness(), pending = h.load();
    assert.equal(h.hero.textContent, 'Loading');
    assert.equal(h.requests[0].path, '/api/v1/me/free-like-quota');
    h.requests[0].respond(data); await pending;
    assert.equal(h.state().status, 'ready'); assert.equal(h.hero.textContent, `0/${data.dailyLimit} left today`);
  }
});

test('failed quota lookup is unknown rather than zero or the anonymous vote label', options, async () => {
  const h = harness(), pending = h.load();
  h.requests[0].fail(new TypeError('Synthetic response loss')); await pending;
  assert.equal(h.state().quota, null); assert.equal(h.state().status, 'unknown');
  assert.equal(h.hero.textContent, 'Results unavailable');
});

test('missing, malformed, and out-of-range quota fields never become confirmed zero', options, async () => {
  for (const data of [null, {}, { dailyLimit: 1 }, { dailyLimit: 1, remaining: null }, { dailyLimit: 1, remaining: 2 }, { dailyLimit: '1', remaining: 0 }]) {
    const h = harness(), pending = h.load(); h.requests[0].respond(data); await pending;
    assert.equal(h.state().status, 'unknown'); assert.equal(h.state().quota, null);
  }
});

test('A quota success and failure cannot overwrite a newer B response', options, async () => {
  for (const fail of [false, true]) {
    const h = harness(), old = h.load(); h.switch(auth('b')); const current = h.load();
    h.requests[1].respond(quota(1)); await current;
    if (fail) h.requests[0].fail(new Error('Synthetic old failure')); else h.requests[0].respond(quota());
    await old; assert.equal(h.hero.textContent, '1/1 left today'); assert.equal(h.state().status, 'ready');
  }
});

test('logout clears displayed quota immediately and late GET cannot restore it', options, async () => {
  const h = harness(), first = h.load(); h.requests[0].respond(quota()); await first;
  const old = h.load(); h.context.clearAuth();
  assert.equal(h.state().quota, null); assert.equal(h.hero.textContent, 'Your vote today');
  h.requests[1].respond(quota(1)); await old; assert.equal(h.state().quota, null);
});

test('same-user logout and re-login rejects the old epoch even with identical credentials', options, async () => {
  const h = harness(), old = h.load(); h.context.clearAuth(); h.switch(auth());
  h.requests[0].respond(quota()); await old;
  assert.equal(h.state().status, 'unknown'); assert.equal(h.state().quota, null);
});

test('cross-tab account replacement invalidates state; unrelated storage events preserve it', options, async () => {
  const h = harness(), pending = h.load(); h.requests[0].respond(quota()); await pending;
  h.context.window.dispatchEvent({ type: 'storage', key: 'lumina_locale' });
  assert.equal(h.state().status, 'ready');
  h.storage(auth('b')); assert.equal(h.state().quota, null); assert.equal(h.hero.textContent, 'Results unavailable');
  assert.equal(h.requests.length, 1);
});

test('latest same-session quota read wins over older success or failure', options, async () => {
  for (const fail of [false, true]) {
    const h = harness(), old = h.load(), current = h.load();
    h.requests[1].respond(quota(1)); await current;
    if (fail) h.requests[0].fail(new Error('Synthetic old failure')); else h.requests[0].respond(quota());
    await old; assert.equal(h.hero.textContent, '1/1 left today');
  }
});

test('two legitimate native refresh rotations preserve an in-flight quota read', options, async () => {
  const h = harness(), pending = h.load(); await h.rotate('one'); await h.rotate('two');
  h.requests[0].respond(quota()); await pending;
  assert.equal(h.state().status, 'ready'); assert.equal(h.requests.filter(r => r.path.endsWith('/free-like-quota')).length, 1);
});

test('confirmed free-like uses captured identity, existing key contract, and no paid dispatch', options, async () => {
  const h = harness(), pending = h.like(), request = h.requests[0];
  assert.equal(request.path, '/api/v1/boost-campaigns/synthetic-campaign-a/free-like');
  assert.equal(request.options.method, 'POST');
  const body = JSON.parse(request.options.body);
  assert.equal(body.artistId, 'synthetic-artist-a'); assert.equal(body.artistSlug, 'artist-a');
  assert.equal(body.idempotencyKey, request.options.headers['Idempotency-Key']);
  h.success(request); await pending; await h.finishReads();
  assert.deepEqual(h.state().liked, ['artist-a']); assert.equal(h.pageRefreshes, 1); assert.equal(h.paid.length, 0);
  const count = h.requests.length; await h.like();
  assert.equal(h.requests.length, count); assert.deepEqual(h.paid, ['artist-a']);
});

test('DOM replacement cannot bypass pending intent and regenerated buttons stay disabled', options, async () => {
  const h = harness(), pending = h.like(), replacement = button(); h.buttons.splice(0, 1, replacement);
  assert.match(h.context.likeButtonHTML('artist-a'), /disabled/);
  await h.like('artist-a', replacement); assert.equal(h.requests.length, 1); assert.equal(h.keys, 1);
  h.success(h.requests[0]); await pending; await h.finishReads(); assert.equal(replacement.disabled, false);
});

test('lost POST response retains the same key and replay does not add another local count', options, async () => {
  const h = harness(), first = h.like(), originalKey = JSON.parse(h.requests[0].options.body).idempotencyKey;
  h.requests[0].fail(new TypeError('Synthetic committed response loss')); await first;
  assert.equal(h.buttons[0].disabled, false); assert.equal(h.state().rankings[0].likes, 4);
  assert.equal(h.state().status, 'unknown'); assert.match(h.alerts.at(-1), /unconfirmed/);
  h.read('_userLikedSlugs.add("artist-a");');
  const retry = h.like(); assert.equal(JSON.parse(h.requests[1].options.body).idempotencyKey, originalKey);
  assert.equal(h.paid.length, 0);
  h.success(h.requests[1], { replay: true }); await retry; await h.finishReads();
  assert.equal(h.keys, 1); assert.equal(h.state().rankings[0].likes, 4); assert.deepEqual(h.state().liked, ['artist-a']);
});

test('server failure and malformed success both retain the original uncertain key', options, async () => {
  for (const invalid of [
    { status: 503, body: {} },
    { status: 200, body: {} },
    { status: 200, body: { event: { id: 'synthetic-event', userId: 'synthetic-user-b', campaignId: 'synthetic-campaign-a', artistId: 'synthetic-artist-a' }, idempotentReplay: false } }
  ]) {
    const h = harness(), first = h.like(); h.requests[0].respond(invalid.body, invalid.status); await first;
    assert.equal(h.state().status, 'unknown'); assert.deepEqual(h.state().liked, []);
    const retry = h.like();
    assert.equal(h.requests[0].options.headers['Idempotency-Key'], h.requests[1].options.headers['Idempotency-Key']);
    h.success(h.requests[1], { replay: true }); await retry; await h.finishReads(); assert.equal(h.keys, 1);
  }
});

test('old POST success cannot add B liked state, counters, follow-up reads, or modal', options, async () => {
  const h = harness(), old = h.like(); h.switch(auth('b')); h.success(h.requests[0]); await old;
  assert.deepEqual(h.state().liked, []); assert.equal(h.state().rankings[0].likes, 4);
  assert.equal(h.requests.length, 1); assert.equal(h.pageRefreshes, 0); assert.equal(h.paid.length, 0);
  assert.equal(h.buttons[0].disabled, false);
});

test('old POST 401 cannot refresh, log out, or open a login modal for B', options, async () => {
  const h = harness(), old = h.like(); h.switch(auth('b'));
  h.requests[0].respond({ message: 'Synthetic expired A request' }, 401); await old;
  assert.equal(h.context.getAuth().user.id, 'synthetic-user-b');
  assert.equal(h.requests.length, 1); assert.equal(h.modals.length, 0); assert.equal(h.authUpdates, 0);
});

test('A->B->A retains unresolved intent key but rejects the previous epoch result', options, async () => {
  const h = harness(), old = h.like(), key = h.requests[0].options.headers['Idempotency-Key'];
  h.switch(auth('b')); h.switch(auth()); h.success(h.requests[0]); await old;
  assert.deepEqual(h.state().liked, []);
  const retry = h.like(); assert.equal(h.requests[1].options.headers['Idempotency-Key'], key);
  h.success(h.requests[1], { replay: true }); await retry; await h.finishReads(); assert.equal(h.keys, 1);
});

test('campaign replacement rejects old success and isolates the next captured key', options, async () => {
  const h = harness(), old = h.like(), key = h.requests[0].options.headers['Idempotency-Key'];
  h.campaign('synthetic-campaign-b'); h.success(h.requests[0]); await old;
  assert.deepEqual(h.state().liked, []); assert.equal(h.state().rankings[0].likes, 4);
  const current = h.like(); assert.notEqual(h.requests[1].options.headers['Idempotency-Key'], key);
  h.success(h.requests[1]); await current; await h.finishReads();
});

test('late rankings read from an accepted A write cannot replace B view state', options, async () => {
  const h = harness(), pending = h.like(); h.success(h.requests[0]); await pending;
  h.switch(auth('b'));
  h.read('_rankings = [{ slug: "artist-a", likes: 30 }];');
  const ranking = h.requests.find(request => request.path.endsWith('/rankings'));
  ranking.respond([{ artistSlug: 'artist-a', totalWeightedScore: 900 }]);
  await h.finishReads(); assert.equal(h.state().rankings[0].likes, 30); assert.equal(h.state().quota, null);
});

test('existing daily-limit modal branch remains while a rejected request keeps its key', options, async () => {
  const h = harness(), first = h.like(); h.requests[0].respond({ message: 'Daily free like limit exceeded' }, 400); await first;
  assert.deepEqual(h.paid, ['artist-a']); assert.equal(h.buttons[0].disabled, false);
  const retry = h.like(); assert.equal(h.requests[1].options.headers['Idempotency-Key'], h.requests[0].options.headers['Idempotency-Key']);
  h.requests[1].respond({ message: 'Daily free like limit exceeded' }, 400); await retry;
});

test('missing actor, unknown artist, and nonstring slug do not dispatch', options, async () => {
  const h = harness(); await h.like('missing'); await h.like(['artist-a']);
  h.switch({ accessToken: 'synthetic-access-without-owner' }); await h.like();
  assert.equal(h.requests.length, 0); assert.equal(h.keys, 0);
});

test('anonymous quota and click preserve login entry without provider or mutation requests', options, async () => {
  const h = harness({ loggedIn: false }); await h.load(); await h.like();
  assert.equal(h.hero.textContent, 'Your vote today'); assert.equal(h.requests.length, 0); assert.equal(h.modals.length, 1);
});

test('unconfirmed outcome message supports five existing locales', options, () => {
  const h = harness(), messages = [];
  for (const locale of ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant']) {
    h.context._currentLocale = locale; messages.push(h.context.freeLikeUnknownMessage());
  }
  assert.equal(new Set(messages).size, 5); assert(messages.every(message => message.length > 10));
});

test('native 401 refresh retries the same POST key and accepts only current owner result', options, async () => {
  const h = harness(), pending = h.like(), first = h.requests[0];
  first.respond({ message: 'Synthetic token expiry' }, 401); await tick();
  assert.equal(h.requests[1].path, '/api/v1/auth/refresh');
  h.requests[1].respond(auth('a', 'refreshed')); await tick();
  const replay = h.requests[2]; assert.equal(replay.path, first.path);
  assert.equal(replay.options.body, first.options.body);
  assert.equal(replay.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']);
  h.success(replay); await pending; await h.finishReads(); assert.equal(h.keys, 1); assert.deepEqual(h.state().liked, ['artist-a']);
});

test('different owner and artist scopes do not share keys or pending state', options, async () => {
  const h = harness(), a = h.like(), b = h.like('artist-b', button('artist-b'));
  assert.notEqual(h.requests[0].options.headers['Idempotency-Key'], h.requests[1].options.headers['Idempotency-Key']);
  h.switch(auth('b')); const current = h.like();
  assert.notEqual(h.requests[2].options.headers['Idempotency-Key'], h.requests[0].options.headers['Idempotency-Key']);
  h.success(h.requests[0]); h.success(h.requests[1]); h.success(h.requests[2], { owner: 'synthetic-user-b' });
  await Promise.all([a, b, current]); await h.finishReads(); assert.deepEqual(h.state().liked, ['artist-a']);
});

test('retired old-epoch intent restores the returned account button without accepting its old receipt', options, async () => {
  for (const replacement of ['aba', 'relogin']) {
    for (const loss of [false, true]) {
      const h = harness(), old = h.like(), request = h.requests[0];
      const key = request.options.headers['Idempotency-Key'];
      if (replacement === 'aba') h.switch(auth('b')); else h.context.clearAuth();
      h.switch(auth());
      assert.equal(h.buttons[0].disabled, true);
      if (loss) request.fail(new TypeError('Synthetic old response loss')); else h.success(request);
      await old;
      assert.equal(h.buttons[0].disabled, false);
      assert.deepEqual(h.state().liked, []); assert.equal(h.state().rankings[0].likes, 4);
      assert.equal(h.requests.length, 1); assert.equal(h.pageRefreshes, 0);
      assert.equal(h.paid.length, 0); assert.equal(h.modals.length, 0);
      const retry = h.like(); assert.equal(h.requests[1].options.headers['Idempotency-Key'], key);
      h.success(h.requests[1], { replay: true }); await retry; await h.finishReads();
      assert.equal(h.keys, 1); assert.equal(h.state().rankings[0].likes, 4);
    }
  }
});

test('retired A intent cannot unlock an independently pending B button', options, async () => {
  const h = harness(), old = h.like(); h.switch(auth('b'));
  const current = h.like(); assert.equal(h.buttons[0].disabled, true);
  h.success(h.requests[0]); await old;
  assert.equal(h.buttons[0].disabled, true); assert.deepEqual(h.state().liked, []);
  assert.equal(h.requests.length, 2); assert.equal(h.pageRefreshes, 0);
  h.success(h.requests[1], { owner: 'synthetic-user-b' }); await current; await h.finishReads();
  assert.equal(h.buttons[0].disabled, false); assert.deepEqual(h.state().liked, ['artist-a']);
});

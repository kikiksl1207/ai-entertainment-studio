import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const mypage = readFileSync(new URL('../pages/mypage.js', import.meta.url), 'utf8');
const mypageHtml = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
function slice(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Missing actual source boundary: ${start}`);
  return source.slice(first, last);
}
const authSource = slice(app, 'const API_BASE =', 'const I18N_LOCALES =');
const pickSource = slice(app, 'let _currentCampaign = null;', 'function rankingMetricNumber(');
const escapeSource = slice(app, 'function feedEscapeHtml(', 'function normalizeFeedAuthorType(');
const walletSource = slice(app, 'let _wallet = null;', 'function formatLuminaAmount(');
const headerSource = slice(app, 'function formatLuminaAmount(', 'function getLikesCount(');
const paidBalanceSource = slice(app, 'const PAID_LIKE_BUNDLES = [', 'async function loadPaidLikeQuota(');
const paidModalSource = slice(app, 'async function openPaidLikeModal(', 'function updateLikeButtons(');
const mypageHelpers = slice(mypage, 'function setMypageText(', 'function updateMypageProfilePreview(');
const mypageInit = slice(mypage, 'async function initMypagePage(', 'async function initMypageSettlementProfile(');
const summaryAnchor = 'const confirmedWalletAmount = raw =>';
assert.equal(mypageHtml.split(summaryAnchor).length, 2, 'Summary wallet parser must have one actual source anchor');
const summaryWalletSource = slice(mypageHtml, summaryAnchor, '          renderList(');

const authA = { accessToken: 'synthetic-a', refreshToken: 'synthetic-refresh-a', user: { id: 'synthetic-user-a' } };
const authB = { accessToken: 'synthetic-b', refreshToken: 'synthetic-refresh-b', user: { id: 'synthetic-user-b' } };
const unknownWallet = { balance: null, currencyCode: 'LUMINA', loaded: false };
const unknownMessage = /\uc794\uc561\uc744 \ud655\uc778\ud558\uc9c0 \ubabb/;
const insufficientOrCharge = /\ubd80\uc871|\ucda9\uc804|insufficient|recharg|top.?up/i;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Only the selected production functions run; transport and unrelated page startup are synthetic.
function harness() {
  const values = new Map([['lumina_auth', JSON.stringify(authA)]]);
  const sessionValues = new Map();
  const listeners = new Map(), requests = [], elements = new Map(), overlays = [], alerts = [];
  const counters = { quota: 0, create: 0, authModal: 0, offline: 0, key: 0 };
  const badge = { innerHTML: '', style: { display: 'none' } };
  elements.set('walletBadge', badge);
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', value: '', hidden: false, style: {} });
    return elements.get(id);
  };
  const makeOverlay = () => {
    const handlers = new Map();
    const confirm = { disabled: false, textContent: '', addEventListener: (name, callback) => handlers.set(name, callback) };
    const message = { hidden: true, textContent: '' };
    const option = { classList: { add() {}, contains: () => false, toggle() {} } };
    const radio = { value: '1', checked: true, closest: () => option };
    return {
      innerHTML: '', className: '', removed: false, confirm, message,
      querySelector: selector => {
        if (selector === '[data-paid-like-confirm]') return confirm;
        if (selector === '[data-paid-like-message]') return message;
        if (selector === "[name='paidLikeBundle']:checked" || selector === "[name='paidLikeBundle']:not([disabled])") return radio;
        assert.fail(`Unexpected synthetic modal selector: ${selector}`);
      },
      querySelectorAll: selector => { assert.equal(selector, '.paid-like-option'); return [option]; },
      addEventListener() {},
      remove() { this.removed = true; },
      clickConfirm: () => { assert.ok(handlers.has('click')); return handlers.get('click')(); }
    };
  };
  const context = {
    AbortController, Event, setTimeout: () => 1, clearTimeout() {},
    _freeLikeQuota: null, _freeLikeQuotaState: 'unknown', updateHeroQuotaDisplay() {},
    console: { warn() {}, info() {} },
    fetch: () => assert.fail('Actual transport must never run in this fixture'),
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    sessionStorage: {
      getItem: key => sessionValues.get(key) ?? null,
      setItem: (key, value) => sessionValues.set(key, String(value)),
      removeItem: key => sessionValues.delete(key)
    },
    window: {
      location: { pathname: '/mypage' },
      addEventListener: (name, callback) => {
        const list = listeners.get(name) || [];
        list.push(callback); listeners.set(name, list);
      },
      dispatchEvent: event => { for (const callback of listeners.get(event.type) || []) callback(event); }
    },
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      createElement: tag => { counters.create++; assert.equal(tag, 'div'); return makeOverlay(); },
      body: { style: {}, classList: { contains: name => name === 'page-mypage' }, appendChild: overlay => overlays.push(overlay) }
    },
    alert: message => alerts.push(message),
    openAuthModal: () => { counters.authModal++; },
    _currentCampaign: { id: 'synthetic-campaign' }, _artists: [],
    getCharacterBySlug: () => ({ id: 'synthetic-artist', publicName: 'Synthetic artist' }),
    loadPaidLikeQuota: () => { counters.quota++; assert.fail('Quota must be explicitly enabled by this test'); },
    isLikelyOffline: () => { counters.offline++; assert.fail('Unknown balance must return before offline checks'); },
    generateIdempotencyKey: () => { counters.key++; assert.fail('Unknown balance must not create payment intent'); },
    bindMypageAvatarUpload() {}, bindMypageCoverUpload() {},
    updateMypageProfilePreview() {}, updateMypageCoverPreview() {}, initMypageSettlementProfile() {},
    updateWalletUI() {}
  };
  runInNewContext(authSource, context);
  runInNewContext(pickSource, context);
  runInNewContext('_currentCampaign = { id: "synthetic-campaign" };', context);
  context.apiFetch = (route, options = {}) => {
    const pending = deferred(); requests.push({ route, options, pending });
    assert.equal(route, '/api/v1/wallet');
    assert.equal(options.method || 'GET', 'GET');
    assert.equal(options.auth, true); assert.equal(options.throwOnError, true);
    return pending.promise;
  };
  runInNewContext(walletSource + '\n' + headerSource + '\n' + paidBalanceSource + '\n' + paidModalSource + '\n' + escapeSource, context);
  runInNewContext(mypageHelpers + '\n' + mypageInit, context);
  return {
    context, values, requests, elements, overlays, alerts, counters, badge,
    wallet: () => JSON.parse(runInNewContext('JSON.stringify(_wallet)', context)),
    load: () => context.loadWallet(),
    setWallet: value => { context.syntheticWallet = value; runInNewContext('_wallet = syntheticWallet;', context); },
    paidBalance: () => context.getPaidLikeBalance(),
    open: () => context.openPaidLikeModal('synthetic-artist'),
    renderMypage: () => context.initMypagePage(),
    enableQuota: () => {
      const pending = deferred();
      context.loadPaidLikeQuota = () => { counters.quota++; return pending.promise; };
      return { ...pending, resolve: value => pending.resolve({
        campaign: { id: 'synthetic-campaign' }, dailyLimit: 20, usedToday: 0, remaining: 20,
        unitPriceLumina: '10', resetsAt: '2026-10-14T00:00:00.000Z', ...value
      }) };
    }
  };
}

async function receive(h, payload) {
  const pending = h.load();
  h.requests.at(-1).pending.resolve(payload);
  await pending;
}
async function fail(h) {
  const pending = h.load();
  h.requests.at(-1).pending.reject(new Error('Synthetic wallet failure'));
  await pending;
}
function noMutation(h) {
  assert.equal(h.counters.key, 0); assert.equal(h.counters.offline, 0);
  for (const request of h.requests) {
    assert.equal(request.route, '/api/v1/wallet');
    assert.equal(request.options.method || 'GET', 'GET');
  }
}
function unknownConsumerMessage(message) {
  assert.match(message, unknownMessage);
  assert.doesNotMatch(message, insufficientOrCharge);
}
function walletUnconfirmed(h) {
  assert.deepEqual(h.wallet(), unknownWallet);
  assert.equal(h.paidBalance(), null);
  assert.equal(h.badge.style.display, 'none'); assert.equal(h.badge.innerHTML, '');
  noMutation(h);
}
function renderSummaryWallet(wallet, text = new Map()) {
  runInNewContext(summaryWalletSource, {
    wallet: wallet || {},
    setText: (id, value) => text.set(id, value),
    fmt: value => { assert.equal(Number.isFinite(value), true); return value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
  });
  return text;
}
function unknownSummaryMessage(message) {
  assert.match(message, /\uc794\uc561 \uc815\ubcf4\ub97c \ud655\uc778\ud558\uc9c0 \ubabb/);
  assert.doesNotMatch(message, insufficientOrCharge);
}

const confirmed = [
  ['numeric zero', { cachedBalance: 0 }, 0],
  ['decimal zero', { cachedBalance: '0.00' }, 0],
  ['positive integer', { cachedBalance: 125 }, 125],
  ['decimal string', { cachedBalance: '120.50' }, 120.5],
  ['negative number', { cachedBalance: -2.75 }, -2.75],
  ['negative string', { cachedBalance: '-2.75' }, -2.75],
  ['trimmed decimal string', { cachedBalance: ' 12.50 ' }, 12.5],
  ['legacy balance alias', { balance: '12.50' }, 12.5],
  ['legacy lumina alias', { lumina: { balance: '12.50' } }, 12.5],
  ['legacy wallet alias', { wallet: { cachedBalance: '12.50' } }, 12.5],
  ['canonical zero precedence', { cachedBalance: '0', balance: '900' }, 0]
];
for (const [name, payload, balance] of confirmed) {
  test(`confirmed wallet preserves ${name}`, async () => {
    const h = harness(); await receive(h, payload);
    assert.deepEqual(h.wallet(), { balance, currencyCode: 'LUMINA', loaded: true });
    assert.equal(h.paidBalance(), balance);
    assert.equal(h.badge.style.display, '');
    assert.ok(h.badge.innerHTML.includes(`<span>${balance.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} L</span>`));
    assert.equal(h.requests.length, 1); noMutation(h);
  });
}

const invalid = [
  ['null response', null],
  ['empty response', {}],
  ['missing balance field', { currencyCode: 'LUMINA' }],
  ['null balance', { cachedBalance: null }],
  ['empty balance', { cachedBalance: '' }],
  ['whitespace balance', { cachedBalance: ' \t\n' }],
  ['numeric suffix', { cachedBalance: '12L' }],
  ['numeric infinity', { cachedBalance: Infinity }],
  ['text infinity', { cachedBalance: 'Infinity' }],
  ['numeric NaN', { cachedBalance: NaN }],
  ['text NaN', { cachedBalance: 'NaN' }],
  ['boolean false', { cachedBalance: false }],
  ['boolean true', { cachedBalance: true }],
  ['array balance', { cachedBalance: [12] }],
  ['object balance', { cachedBalance: { value: 12 } }],
  ['invalid legacy alias', { wallet: { cachedBalance: '12L' } }]
];
for (const [name, payload] of invalid) {
  test(`unconfirmed wallet rejects ${name} without publishing zero`, async () => {
    const h = harness(); await receive(h, { balance: '80' }); await receive(h, payload);
    walletUnconfirmed(h); assert.equal(h.requests.length, 2);
  });
}

test('current transport failure clears a previously confirmed balance without retry', async () => {
  const h = harness(); await receive(h, { balance: '80' }); await fail(h);
  walletUnconfirmed(h); assert.equal(h.requests.length, 2);
});
test('explicit later success recovers from unknown without manufacturing interim zero', async () => {
  const h = harness(); await fail(h); walletUnconfirmed(h);
  await receive(h, { balance: '0.00' });
  assert.deepEqual(h.wallet(), { balance: 0, currencyCode: 'LUMINA', loaded: true });
  assert.equal(h.paidBalance(), 0); assert.equal(h.requests.length, 2);
});
for (const failed of [false, true]) {
  test(`retired owner ${failed ? 'failure' : 'malformed response'} cannot clear the new confirmed wallet`, async () => {
    const h = harness(), old = h.load(); h.context.setAuth(authB); const current = h.load();
    h.requests[1].pending.resolve({ balance: '25.25' }); await current;
    if (failed) h.requests[0].pending.reject(new Error('Synthetic retired owner failure'));
    else h.requests[0].pending.resolve({ balance: '' });
    await old; assert.equal(h.wallet().balance, 25.25); assert.equal(h.paidBalance(), 25.25);
    assert.equal(h.requests.length, 2); noMutation(h);
  });
}
test('older duplicate malformed response cannot clear a later same-session confirmation', async () => {
  const h = harness(), old = h.load(), current = h.load();
  h.requests[1].pending.resolve({ balance: '60' }); await current;
  h.requests[0].pending.resolve({}); await old;
  assert.equal(h.wallet().balance, 60); assert.equal(h.paidBalance(), 60); noMutation(h);
});
test('latest failure remains unknown when an older duplicate succeeds later', async () => {
  const h = harness(), old = h.load(), current = h.load();
  h.requests[1].pending.reject(new Error('Synthetic latest failure')); await current;
  h.requests[0].pending.resolve({ balance: '900' }); await old; walletUnconfirmed(h);
});
test('logout immediately hides confirmed numbers and late malformed data cannot restore them', async () => {
  const h = harness(); await receive(h, { balance: '80' }); const old = h.load();
  h.context.clearAuth(); assert.equal(h.wallet(), null); assert.equal(h.paidBalance(), null);
  assert.equal(h.badge.innerHTML, ''); assert.equal(h.badge.style.display, 'none');
  h.requests[1].pending.resolve({ balance: '' }); await old;
  assert.equal(h.wallet(), null); assert.equal(h.requests.length, 2); noMutation(h);
});
test('cross-tab account invalidation clears the visible balance and paid getter without a new GET', async () => {
  const h = harness(); await receive(h, { balance: '80' });
  h.values.set('lumina_auth', JSON.stringify(authB));
  h.context.window.dispatchEvent({ type: 'storage', key: 'lumina_auth' });
  assert.equal(h.wallet(), null); assert.equal(h.paidBalance(), null);
  assert.equal(h.badge.innerHTML, ''); assert.equal(h.requests.length, 1); noMutation(h);
});

const pageConfirmed = [
  ['zero', '0.00', '0', '0'],
  ['positive decimal', '12500.50', '12,500.5', '1.25'],
  ['negative decimal', '-2.75', '-2.75', '0']
];
for (const [name, balance, lumina, stella] of pageConfirmed) {
  test(`mypage renders confirmed ${name} as available rather than unknown`, async () => {
    const h = harness(); await receive(h, { balance }); await h.renderMypage();
    assert.equal(h.elements.get('mypageLuminaBalance').textContent, lumina);
    assert.equal(h.elements.get('mypageStellaBalance').textContent, stella);
    assert.match(h.elements.get('mypageWalletStatus').textContent, /\uc0ac\uc6a9\ud560 \uc218 \uc788\ub294 \uc794\uc561/);
    assert.equal(h.requests.length, 1); noMutation(h);
  });
}
for (const failed of [false, true]) {
  test(`mypage shows two unknown placeholders after ${failed ? 'transport failure' : 'malformed payload'}`, async () => {
    const h = harness(); await receive(h, { balance: '12500.50' }); await h.renderMypage();
    await fail(h); const page = h.renderMypage();
    if (failed) h.requests.at(-1).pending.reject(new Error('Synthetic mypage failure'));
    else h.requests.at(-1).pending.resolve({ balance: null });
    await page; walletUnconfirmed(h);
    assert.equal(h.elements.get('mypageLuminaBalance').textContent, '--');
    assert.equal(h.elements.get('mypageStellaBalance').textContent, '--');
    unknownConsumerMessage(h.elements.get('mypageWalletStatus').textContent);
    assert.equal(h.requests.length, 3);
  });
}

for (const [name, value] of [
  ['never loaded', null],
  ['loaded false', { balance: 90, loaded: false }],
  ['null number', { balance: null, loaded: true }],
  ['infinite number', { balance: Infinity, loaded: true }],
  ['numeric text not confirmed by loader', { balance: '90', loaded: true }]
]) {
  test(`paid getter, header and first modal gate reject ${name} before quota or charge UI`, async () => {
    const h = harness(); h.setWallet(value);
    h.context.updateWalletUI();
    assert.equal(h.badge.style.display, 'none'); assert.equal(h.badge.innerHTML, '');
    assert.equal(h.paidBalance(), null); await h.open();
    assert.equal(h.alerts.length, 1); unknownConsumerMessage(h.alerts[0]);
    assert.equal(h.counters.quota, 0); assert.equal(h.counters.create, 0);
    assert.equal(h.counters.authModal, 0); assert.equal(h.requests.length, 0); noMutation(h);
  });
}
test('paid getter rejects a silently replaced session even before auth invalidation event', async () => {
  const h = harness(); await receive(h, { balance: '90' });
  h.values.set('lumina_auth', JSON.stringify(authB));
  assert.equal(h.paidBalance(), null); await h.open();
  assert.equal(h.alerts.length, 1); unknownConsumerMessage(h.alerts[0]);
  assert.equal(h.counters.quota, 0); assert.equal(h.counters.create, 0); noMutation(h);
});
test('failed wallet read prevents paid modal quota and charging entry', async () => {
  const h = harness(); await fail(h); await h.open();
  assert.equal(h.alerts.length, 1); unknownConsumerMessage(h.alerts[0]);
  assert.equal(h.counters.quota, 0); assert.equal(h.counters.create, 0);
  assert.equal(h.requests.length, 1); noMutation(h);
});

for (const change of ['new owner', 'new wallet request', 'logout']) {
  test(`quota await cannot build a modal after ${change}`, async () => {
    const h = harness(); await receive(h, { balance: '90' });
    const quota = h.enableQuota(), modal = h.open(); assert.equal(h.counters.quota, 1);
    if (change === 'new owner') h.context.setAuth(authB);
    else if (change === 'logout') h.context.clearAuth();
    else await receive(h, { balance: '100' });
    quota.resolve({ dailyLimit: 20, remaining: 20 }); await modal;
    assert.equal(h.counters.create, 0); assert.equal(h.overlays.length, 0);
    assert.equal(h.alerts.length, 0); assert.equal(h.counters.quota, 1); noMutation(h);
  });
}
test('quota completion rechecks unknown balance even when request version is unchanged', async () => {
  const h = harness(); await receive(h, { balance: '90' });
  const quota = h.enableQuota(), modal = h.open(); h.setWallet(unknownWallet);
  quota.resolve({ dailyLimit: 20, remaining: 20 }); await modal;
  assert.equal(h.counters.create, 0); assert.equal(h.overlays.length, 0); noMutation(h);
});
test('quota completion renders the current confirmed amount rather than the pre-await amount', async () => {
  const h = harness(); await receive(h, { balance: '90' });
  const quota = h.enableQuota(), modal = h.open();
  h.setWallet({ balance: 12.5, currencyCode: 'LUMINA', loaded: true });
  quota.resolve({ dailyLimit: 20, remaining: 20 }); await modal;
  assert.equal(h.overlays.length, 1); assert.equal(h.counters.quota, 1);
  assert.match(h.overlays[0].innerHTML, /<strong>12\.5L<\/strong>/);
  assert.doesNotMatch(h.overlays[0].innerHTML, /<strong>90L<\/strong>/); noMutation(h);
});

for (const change of ['failed read', 'malformed read', 'owner replacement', 'logout']) {
  test(`paid confirm rejects ${change} before insufficient balance or POST`, async () => {
    const h = harness(); await receive(h, { balance: '90' });
    const quota = h.enableQuota(), modal = h.open();
    quota.resolve({ dailyLimit: 20, remaining: 20 }); await modal;
    assert.equal(h.overlays.length, 1);
    const retired = change === 'owner replacement' || change === 'logout';
    const oldUI = retired ? {
      message: h.overlays[0].message.textContent,
      hidden: h.overlays[0].message.hidden,
      disabled: h.overlays[0].confirm.disabled
    } : null;
    if (change === 'failed read') await fail(h);
    else if (change === 'malformed read') await receive(h, { balance: false });
    else if (change === 'owner replacement') h.context.setAuth(authB);
    else h.context.clearAuth();
    const before = h.requests.length; await h.overlays[0].clickConfirm();
    if (retired) {
      assert.deepEqual({
        message: h.overlays[0].message.textContent,
        hidden: h.overlays[0].message.hidden,
        disabled: h.overlays[0].confirm.disabled
      }, oldUI);
    } else {
      unknownConsumerMessage(h.overlays[0].message.textContent);
      assert.equal(h.overlays[0].message.hidden, false); assert.equal(h.overlays[0].confirm.disabled, false);
    }
    assert.equal(h.requests.length, before); assert.equal(h.counters.quota, 1); noMutation(h);
  });
}
test('paid confirm recalculates confirmed zero as insufficient without treating it as unknown', async () => {
  const h = harness(); await receive(h, { balance: '90' });
  const quota = h.enableQuota(), modal = h.open();
  quota.resolve({ dailyLimit: 20, remaining: 20 }); await modal;
  await receive(h, { balance: '0.00' });
  const before = h.requests.length; await h.overlays[0].clickConfirm();
  assert.match(h.overlays[0].message.textContent, /\ubd80\uc871/);
  assert.doesNotMatch(h.overlays[0].message.textContent, unknownMessage);
  assert.equal(h.requests.length, before); assert.equal(h.paidBalance(), 0); noMutation(h);
});

const summaryConfirmed = [
  ['numeric zero', { lumina: { balance: 0 }, stella: { displayAmount: 0 } }, '0', '0'],
  ['decimal zeros', { lumina: { balance: '0.00' }, stella: { displayAmount: '0.00' } }, '0', '0'],
  ['positive integers', { lumina: { balance: 125 }, stella: { displayAmount: 2 } }, '125', '2'],
  ['positive decimals', { lumina: { balance: '12500.50' }, stella: { displayAmount: '1.25' } }, '12,500.5', '1.25'],
  ['negative numbers', { lumina: { balance: -2.75 }, stella: { displayAmount: -0.5 } }, '-2.75', '-0.5'],
  ['negative strings', { lumina: { balance: '-2.75' }, stella: { displayAmount: '-0.5' } }, '-2.75', '-0.5'],
  ['cached balance alias', { cachedBalance: '12.50', stella: { displayAmount: '0' } }, '12.5', '0'],
  ['trimmed alias', { cachedBalance: ' 12.50 ', stella: { displayAmount: ' 0.25 ' } }, '12.5', '0.25'],
  ['canonical zero precedence', { lumina: { balance: '0' }, cachedBalance: '900', stella: { displayAmount: '0' } }, '0', '0']
];
for (const [name, wallet, lumina, stella] of summaryConfirmed) {
  test(`actual summary wallet block preserves ${name}`, () => {
    const text = renderSummaryWallet(wallet);
    assert.equal(text.get('mypageLuminaBalance'), lumina);
    assert.equal(text.get('mypageStellaBalance'), stella);
    assert.match(text.get('mypageWalletStatus'), /\uc0ac\uc6a9\ud560 \uc218 \uc788\ub294 \uc794\uc561/);
  });
}
const summaryInvalid = [
  ['null', null], ['empty', ''], ['whitespace', ' \t\n'], ['numeric suffix', '12L'],
  ['numeric infinity', Infinity], ['text infinity', 'Infinity'],
  ['numeric NaN', NaN], ['text NaN', 'NaN'], ['boolean false', false], ['boolean true', true],
  ['array', [12]], ['object', { value: 12 }], ['undefined', undefined]
];
for (const [name, value] of summaryInvalid) {
  test(`actual summary wallet block rejects ${name} for both amounts`, () => {
    const text = renderSummaryWallet({ lumina: { balance: value }, stella: { displayAmount: value } });
    assert.equal(text.get('mypageLuminaBalance'), '--');
    assert.equal(text.get('mypageStellaBalance'), '--');
    unknownSummaryMessage(text.get('mypageWalletStatus'));
  });
}
for (const [name, wallet] of [['missing wallet', undefined], ['null wallet', null], ['missing fields', {}]]) {
  test(`actual summary wallet block does not turn ${name} into confirmed zero`, () => {
    const text = renderSummaryWallet(wallet);
    assert.equal(text.get('mypageLuminaBalance'), '--');
    assert.equal(text.get('mypageStellaBalance'), '--');
    unknownSummaryMessage(text.get('mypageWalletStatus'));
  });
}
test('summary keeps confirmed lumina zero when only stella is unknown', () => {
  const text = renderSummaryWallet({ lumina: { balance: '0' }, stella: { displayAmount: null } });
  assert.equal(text.get('mypageLuminaBalance'), '0'); assert.equal(text.get('mypageStellaBalance'), '--');
  assert.match(text.get('mypageWalletStatus'), /\uc0ac\uc6a9\ud560 \uc218 \uc788\ub294 \uc794\uc561/);
});
test('summary keeps confirmed stella while invalid lumina stays explicitly unknown', () => {
  const text = renderSummaryWallet({ lumina: { balance: '12L' }, stella: { displayAmount: '2.5' } });
  assert.equal(text.get('mypageLuminaBalance'), '--'); assert.equal(text.get('mypageStellaBalance'), '2.5');
  unknownSummaryMessage(text.get('mypageWalletStatus'));
});
test('independently valid summary can replace failed wallet display without confirming the global paid balance', async () => {
  const h = harness(); await fail(h); const page = h.renderMypage();
  h.requests.at(-1).pending.reject(new Error('Synthetic page wallet failure')); await page;
  const text = new Map(['mypageLuminaBalance', 'mypageStellaBalance', 'mypageWalletStatus']
    .map(id => [id, h.elements.get(id).textContent]));
  assert.equal(text.get('mypageLuminaBalance'), '--');
  renderSummaryWallet({ lumina: { balance: '0.00' }, stella: { displayAmount: '0.00' } }, text);
  assert.equal(text.get('mypageLuminaBalance'), '0'); assert.equal(text.get('mypageStellaBalance'), '0');
  assert.match(text.get('mypageWalletStatus'), /\uc0ac\uc6a9\ud560 \uc218 \uc788\ub294 \uc794\uc561/);
  walletUnconfirmed(h); assert.equal(h.requests.length, 2);
});
test('invalid later summary clears both previously displayed numeric amounts', () => {
  const text = renderSummaryWallet({ lumina: { balance: '12500.50' }, stella: { displayAmount: '1.25' } });
  assert.equal(text.get('mypageLuminaBalance'), '12,500.5');
  renderSummaryWallet({}, text);
  assert.equal(text.get('mypageLuminaBalance'), '--'); assert.equal(text.get('mypageStellaBalance'), '--');
  unknownSummaryMessage(text.get('mypageWalletStatus'));
});

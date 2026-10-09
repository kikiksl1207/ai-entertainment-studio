import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { htmlWithoutActivationReadDelta } from './support/mypage-activation-read-inverse-20261009.mjs';

const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function between(start, end) {
  const first = html.indexOf(start), last = html.indexOf(end, first + start.length);
  assert(first >= 0 && last > first);
  assert.equal(html.indexOf(start, first + 1), -1);
  return html.slice(first, last);
}
const readSource = between('        async function loadActivationProgress()', '        async function claimActivationReward(');
const refreshSource = between('        let mypageInlineRefreshPromise = null;', '        window.refreshMypageInlineData = refreshMypageInlineData;');
const payload = (owner = 'synthetic-a', items = []) => ({ userId: owner, generatedAt: '2026-10-09T00:00:00Z', milestoneStatus: items });
function harness({ locale = 'ko', inline = false } = {}) {
  let owner = 'synthetic-a', epoch = 1;
  const requests = [], paints = [], tabs = [], buttons = [];
  const wrap = { append: button => buttons.push(button) };
  const context = {
    window: { luminaI18n: { getLocale: () => locale } },
    isLoggedIn: () => Boolean(owner), getAuth: () => ({ user: { id: owner } }),
    authRequestSession: () => JSON.stringify([owner, epoch]),
    authRequestSessionCurrent: value => value === JSON.stringify([owner, epoch]),
    apiFetch: (path, options) => {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ path, options, owner, resolve, reject }); return promise;
    },
    normalizeRewardItems: data => data?.milestoneStatus || [],
    renderActivationRewards: items => paints.push({ type: 'items', items: JSON.parse(JSON.stringify(items)), owner }),
    renderBox: (id, title, body) => paints.push({ type: 'state', id, title, body, owner }),
    $: () => wrap,
    document: { createElement: () => ({ addEventListener: (name, fn) => { assert.equal(name, 'click'); wrap.click = fn; } }) },
    loadMypageSummary: async () => {}, loadMypageSettings: async () => {}, initMypageTabs: () => tabs.push(owner),
  };
  vm.runInNewContext('let activationProgressRead = null;\n' + readSource + (inline ? refreshSource : '') +
    '\nwindow.testLoad = loadActivationProgress;' + (inline ? 'window.testRefresh = refreshMypageInlineData;' : ''), context);
  return { context, load: context.window.testLoad, refresh: context.window.testRefresh, requests, paints, tabs, buttons,
    retry: () => wrap.click(),
    switchOwner: value => { owner = value; epoch++; },
    rotate: () => { epoch++; }, owner: () => owner };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('old account success cannot publish into a new account quest region', async () => {
  const h = harness(), pending = h.load(); await flush();
  h.switchOwner('synthetic-b');
  const before = h.paints.length;
  h.requests[0].resolve(payload()); await pending;
  assert.equal(h.paints.length, before);
});

test('inline refresh gives B its own GET while A is still pending', async () => {
  const h = harness({ inline: true }), a = h.refresh(); await flush();
  h.switchOwner('synthetic-b'); const b = h.refresh(); await flush();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve(payload()); await a;
  assert.deepEqual(h.tabs, []);
  h.requests[1].resolve(payload('synthetic-b')); await b;
  assert.deepEqual(h.tabs, ['synthetic-b']);
});

test('old failure cannot overwrite B and old finally cannot release B duplicate lock', async () => {
  const h = harness({ inline: true }), a = h.refresh(); await flush();
  h.switchOwner('synthetic-b'); const b = h.refresh(); await flush();
  const before = h.paints.length;
  h.requests[0].reject(new Error('synthetic failure')); await a;
  assert.equal(h.paints.length, before);
  const duplicate = h.refresh(); await flush(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(payload('synthetic-b')); await Promise.all([b, duplicate]);
});

test('same account concurrent reads share one GET and a verified empty result', async () => {
  const h = harness(), a = h.load(), b = h.load(); await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].path, '/api/v1/rewards/activation-progress');
  assert.deepEqual(JSON.parse(JSON.stringify(h.requests[0].options)), { auth: true, throwOnError: true });
  h.requests[0].resolve(payload()); await Promise.all([a, b]);
  assert.equal(h.paints.filter(item => item.type === 'items').length, 1);
});

for (const data of [null, {}, payload('synthetic-other'), payload('synthetic-a', null),
  payload('synthetic-a', [{ code: 'first_feed_like', completed: 'yes', claimStatus: 'claimed' }]),
  { ...payload(), generatedAt: 'not-a-date' }]) {
  test('malformed or differently owned success remains a failed read: ' + JSON.stringify(data), async () => {
    const h = harness(), pending = h.load(); await flush();
    h.requests[0].resolve(data); await pending;
    assert.equal(h.paints.some(item => item.type === 'items'), false);
    assert.match(h.paints.at(-1).title, /확인하지 못/);
  });
}

for (const [locale, expected] of [['ko', /확인하지 못/], ['en', /Could not verify/], ['ja', /確認できません/],
  ['zh-Hans', /无法确认/], ['zh-Hant', /無法確認/]]) {
  test('current failed read has an explicit localized failure and manual recovery: ' + locale, async () => {
    const h = harness({ locale }), first = h.load(); await flush();
    h.requests[0].reject(new Error('synthetic offline')); await first;
    assert.equal(h.requests.length, 1); assert.match(h.paints.at(-1).title, expected);
    const second = h.load(); await flush(); assert.equal(h.requests.length, 2);
    h.requests[1].resolve(payload()); await second;
    assert.equal(h.paints.at(-1).type, 'items');
  });
}

test('logout or session replacement before deferred dispatch sends no GET', async () => {
  for (const next of ['', 'synthetic-b']) {
    const h = harness(), pending = h.load(); h.switchOwner(next); await pending;
    assert.equal(h.requests.length, 0);
  }
});

test('a valid nonempty current read preserves milestone rendering without mutation', async () => {
  const item = { code: 'first_feed_like', completed: true, rewardLumina: 10, claimStatus: 'claimable_when_completed' };
  const h = harness(), pending = h.load(); await flush(); h.requests[0].resolve(payload('synthetic-a', [item])); await pending;
  assert.deepEqual(h.paints.at(-1).items, [item]);
  assert.equal(h.requests.some(request => request.options.method && request.options.method !== 'GET'), false);
});

test('the actual failure retry button only rereads the current owner and cannot claim', async () => {
  const h = harness(), first = h.load(); await flush();
  h.requests[0].reject(new Error('synthetic offline')); await first;
  assert.equal(h.buttons.length, 1); assert.equal(h.buttons[0].textContent, '다시 조회');
  h.retry(); await flush(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(payload()); await flush(); await flush();
  assert.equal(h.paints.at(-1).type, 'items');
  h.switchOwner('synthetic-b'); h.retry(); await flush(); assert.equal(h.requests.length, 2);
  assert(h.requests.every(request => request.path === '/api/v1/rewards/activation-progress'));
});

test('exact two-block inverse keeps previous integrations and rejects unrelated edits', () => {
  const original = htmlWithoutActivationReadDelta(html);
  assert.match(original, /activation-progress.*auth: true.*catch\(\(\) => null\)/);
  assert.match(original, /mypageInlineRefreshPromise\) return mypageInlineRefreshPromise/);
  assert.throws(() => htmlWithoutActivationReadDelta(html + '\n<!-- synthetic unrelated -->'));
  assert.throws(() => htmlWithoutActivationReadDelta(html.replace('참여 기록 확인 중', 'synthetic change')));
});

test('the actual app session helper admits a verified same-owner refresh but not another account', async () => {
  const start = app.indexOf('function authRequestSession('), end = app.indexOf('async function apiFetch(', start);
  assert(start >= 0 && end > start);
  const h = harness();
  let auth = { user: { id: 'synthetic-a' }, accessToken: 'synthetic-old', refreshToken: 'synthetic-refresh' };
  h.context.getAuth = () => auth;
  h.context.getRefreshToken = value => value.refreshToken;
  h.context._refreshCompleted = null;
  vm.runInContext(app.slice(start, end), h.context);
  const oldSession = h.context.authRequestSession();
  const pending = h.load(); await flush();
  auth = { ...auth, accessToken: 'synthetic-rotated', refreshToken: 'synthetic-rotated-refresh' };
  h.context._refreshCompleted = { session: oldSession, auth };
  h.requests[0].resolve(payload()); await pending;
  assert.equal(h.paints.at(-1).type, 'items');
  const second = h.load(); await flush();
  auth = { ...auth, user: { id: 'synthetic-b' } };
  const before = h.paints.length;
  h.requests[1].resolve(payload()); await second;
  assert.equal(h.paints.length, before);
});

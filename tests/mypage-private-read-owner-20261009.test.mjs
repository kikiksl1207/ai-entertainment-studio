import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function excerpt(source, start, end) {
  assert.equal(source.split(start).length, 2, `Unique start: ${start}`);
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(last > first, `End: ${end}`);
  return source.slice(first, last);
}

const summarySource = excerpt(html, '        async function loadMypageSummary()', '        async function loadMypageProducts()');
const settingsSource = excerpt(html, '        async function loadMypageSettings()', '        async function saveMypageProfile()');
const sessionSource = excerpt(app, 'function authRequestSession(', 'async function apiFetch(');
const refreshSource = excerpt(app, 'let _refreshInFlight = null;', 'function notifyAuthExpired(');
const authSource = excerpt(app, 'const AUTH_STORAGE_KEY =', '\n/* ');
const allowedPaths = new Set([
  '/api/v1/me/summary',
  '/api/v1/me/debut-applications/latest',
  '/api/v1/me/settings'
]);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function authFor(owner, suffix = 'initial') {
  return { user: { id: owner }, accessToken: `synthetic-access-${owner}-${suffix}`, refreshToken: `synthetic-refresh-${owner}-${suffix}` };
}

function summaryFor(owner, marker = owner) {
  return { user: { id: owner, email: `${owner}@synthetic.invalid` }, marker, wallets: { lumina: 10 }, debut: {} };
}

function makeHarness({ auth = authFor('A'), fixture = null } = {}) {
  const storage = new Map();
  if (auth) storage.set('lumina_auth', JSON.stringify(auth));
  const requests = [];
  const state = { summary: null, debut: 'untouched', commits: [], events: [], refreshCalls: 0, expired: 0 };
  const controls = Object.fromEntries([
    'mypageLocale', 'mypageTimezone', 'mypageActivityNotifications',
    'mypageMarketingNotifications', 'mypageFeedNotifications', 'mypageEmailNotifications'
  ].map(id => [id, { type: /Notifications$/.test(id) ? 'checkbox' : 'select-one', value: 'untouched', checked: false }]));
  let currentFixture = fixture;
  let context;
  context = vm.createContext({
    API_BASE: 'https://synthetic.invalid',
    AbortController,
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { state.events.push(event.type); } },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    console: { info() {}, warn() {} },
    notifyAuthExpired() { state.expired += 1; },
    getSafeAccountStateFixture: () => currentFixture,
    $: id => controls[id] ?? null,
    applySummary(data) {
      state.summary = structuredClone(data);
      state.debut = 'loaded';
      state.commits.push(['summary', data.marker ?? data.user?.id]);
    },
    applyDebutLoading() { state.debut = 'loading'; state.commits.push(['loading']); },
    applyDebutError() { state.debut = 'error'; state.commits.push(['error']); },
    applyDebutApiNotReady() { state.debut = 'not-ready'; state.commits.push(['not-ready']); },
    apiFetch(path, options) {
      assert.ok(allowedPaths.has(path), 'Only memory-backed private GET fixtures are allowed');
      assert.equal(options.method ?? 'GET', 'GET');
      assert.equal(options.auth, true);
      const pending = deferred();
      requests.push({ ...pending, path, options: structuredClone(options), owner: context.getAuth()?.user?.id });
      return pending.promise;
    },
    async fetch(url, options) {
      assert.equal(url, 'https://synthetic.invalid/api/v1/auth/refresh');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).refreshToken, context.getRefreshToken());
      state.refreshCalls += 1;
      const nextAuth = authFor(context.getAuth().user.id, `rotation-${state.refreshCalls}`);
      return { ok: true, status: 200, json: async () => structuredClone(nextAuth) };
    }
  });
  // Actual session/store/refresh code; only transport and rendering sinks use memory fixtures.
  vm.runInContext(`${sessionSource}\n${refreshSource}\n${authSource}\n${summarySource}\n${settingsSource}`, context, { filename: 'mypage-private-read-actual-excerpts.js' });
  return {
    context, requests, state, controls,
    setOwner(owner, suffix) { context.setAuth(authFor(owner, suffix)); },
    setFixture(value) { currentFixture = value; },
    summary() {
      const count = requests.length;
      const promise = context.loadMypageSummary();
      const added = requests.slice(count);
      assert.equal(added.length, 2);
      assert.deepEqual(added.map(request => request.path), ['/api/v1/me/summary', '/api/v1/me/debut-applications/latest']);
      return { promise, summary: added[0], latest: added[1] };
    },
    settings() {
      const count = requests.length;
      const promise = context.loadMypageSettings();
      assert.equal(requests.length, count + 1);
      return { promise, request: requests.at(-1) };
    }
  };
}

async function finishSummary(run, { owner = 'A', marker = owner, failed = false, latest = null, latestStatus = null } = {}) {
  if (failed) run.summary.reject(new Error('synthetic summary failure'));
  else run.summary.resolve(summaryFor(owner, marker));
  if (latestStatus !== null) run.latest.reject({ status: latestStatus });
  else run.latest.resolve(latest);
  await run.promise;
}

async function finishSettings(run, data, failed = false) {
  if (failed) run.request.reject(new Error('synthetic settings failure'));
  else run.request.resolve(data);
  await run.promise;
}

test('pre-reproduction: delayed A summary success cannot replace current B summary', async () => {
  const h = makeHarness();
  const a = h.summary();
  h.setOwner('B');
  await finishSummary(h.summary(), { owner: 'B' });
  const committed = structuredClone(h.state);
  await finishSummary(a, { owner: 'A' });
  assert.deepEqual(h.state, committed);
});

test('pre-reproduction: delayed A summary failure cannot replace current B debut state', async () => {
  const h = makeHarness();
  const a = h.summary();
  h.setOwner('B');
  await finishSummary(h.summary(), { owner: 'B' });
  const committed = structuredClone(h.state);
  await finishSummary(a, { failed: true, latestStatus: 500 });
  assert.deepEqual(h.state, committed);
});

test('delayed A settings success cannot replace current B controls', async () => {
  const h = makeHarness();
  const a = h.settings();
  h.setOwner('B');
  await finishSettings(h.settings(), { settings: { locale: 'en', timezone: 'B-zone', marketingOptIn: true } });
  const committed = structuredClone(h.controls);
  await finishSettings(a, { settings: { locale: 'ko', timezone: 'A-zone', marketingOptIn: false } });
  assert.deepEqual(h.controls, committed);
});

test('account switch without replacement dispatch retires both private reads', async () => {
  const h = makeHarness();
  const a = h.summary();
  const settings = h.settings();
  h.setOwner('B');
  const committed = structuredClone({ state: h.state, controls: h.controls });
  await finishSummary(a);
  await finishSettings(settings, { locale: 'ko' });
  assert.deepEqual({ state: h.state, controls: h.controls }, committed);
});

for (const failed of [false, true]) {
  test(`newer same-owner summary retires older ${failed ? 'failure' : 'success'}`, async () => {
    const h = makeHarness();
    const older = h.summary();
    await finishSummary(h.summary(), { marker: 'A-new' });
    const committed = structuredClone(h.state);
    await finishSummary(older, { marker: 'A-old', failed });
    assert.deepEqual(h.state, committed);
  });
}

test('newer same-owner settings retire older success', async () => {
  const h = makeHarness();
  const older = h.settings();
  await finishSettings(h.settings(), { locale: 'en', timezone: 'new' });
  await finishSettings(older, { locale: 'ko', timezone: 'old' });
  assert.equal(h.controls.mypageLocale.value, 'en');
  assert.equal(h.controls.mypageTimezone.value, 'new');
});

test('normal B summary preserves both GET options and latest application merge', async () => {
  const h = makeHarness({ auth: authFor('B') });
  const run = h.summary();
  assert.deepEqual(run.summary.options, { auth: true });
  assert.deepEqual(run.latest.options, { auth: true, throwOnError: true });
  assert.equal(run.summary.owner, 'B');
  assert.equal(run.latest.owner, 'B');
  await finishSummary(run, { owner: 'B', latest: { application: { status: 'synthetic-pending' } } });
  assert.equal(h.state.summary.user.id, 'B');
  assert.equal(h.state.summary.debut.latestApplication.status, 'synthetic-pending');
  assert.equal(h.state.debut, 'loaded');
});

test('normal B settings preserve values, checkbox mapping and legacy marketing alias', async () => {
  const h = makeHarness({ auth: authFor('B') });
  const run = h.settings();
  assert.deepEqual(run.request.options, { auth: true });
  assert.equal(run.request.owner, 'B');
  await finishSettings(run, { settings: {
    locale: 'en', timezone: 'B-zone', activityNotifications: true,
    marketingNotifications: true, feedNotifications: false, emailNotifications: true
  } });
  assert.equal(h.controls.mypageLocale.value, 'en');
  assert.equal(h.controls.mypageTimezone.value, 'B-zone');
  assert.equal(h.controls.mypageActivityNotifications.checked, true);
  assert.equal(h.controls.mypageMarketingNotifications.checked, true);
  assert.equal(h.controls.mypageFeedNotifications.checked, false);
  assert.equal(h.controls.mypageEmailNotifications.checked, true);
});

test('current summary failure still displays error rather than application absence', async () => {
  const h = makeHarness();
  await finishSummary(h.summary(), { failed: true });
  assert.equal(h.state.debut, 'error');
  assert.equal(h.state.summary, null);
});

for (const [status, expected] of [[404, 'loaded'], [501, 'not-ready'], [500, 'loaded']]) {
  test(`current latest endpoint ${status} retains existing debut behavior`, async () => {
    const h = makeHarness();
    await finishSummary(h.summary(), { latestStatus: status });
    assert.equal(h.state.debut, expected);
    assert.equal(h.state.summary.user.id, 'A');
  });
}

test('current and stale settings failures do not manufacture defaults or error commits', async () => {
  const h = makeHarness();
  const stale = h.settings();
  const current = h.settings();
  const controls = structuredClone(h.controls);
  await finishSettings(current, null, true);
  await finishSettings(stale, null, true);
  assert.deepEqual(h.controls, controls);
  assert.deepEqual(h.state.commits, []);
});

test('summary and settings have independent request ownership', async () => {
  const h = makeHarness();
  const summary = h.summary();
  const settings = h.settings();
  await finishSettings(settings, { locale: 'en' });
  await finishSummary(summary);
  assert.equal(h.controls.mypageLocale.value, 'en');
  assert.equal(h.state.summary.user.id, 'A');
});

test('safe fixture remains immediate without auth or private GET', async () => {
  const fixture = summaryFor('fixture');
  const h = makeHarness({ auth: null, fixture });
  await h.context.loadMypageSummary();
  assert.deepEqual(h.state.summary, fixture);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(h.state.commits, [['summary', 'fixture']]);
});

test('safe fixture invocation retires a pending real summary read', async () => {
  const h = makeHarness();
  const pending = h.summary();
  h.setFixture(summaryFor('fixture'));
  await h.context.loadMypageSummary();
  const committed = structuredClone(h.state);
  await finishSummary(pending);
  assert.deepEqual(h.state, committed);
});

test('logout retires late summary success and settings success', async () => {
  const h = makeHarness();
  const summary = h.summary();
  const settings = h.settings();
  h.context.clearAuth();
  const committed = structuredClone({ state: h.state, controls: h.controls });
  await finishSummary(summary);
  await finishSettings(settings, { locale: 'ko' });
  assert.deepEqual({ state: h.state, controls: h.controls }, committed);
});

test('logout retires late summary failure', async () => {
  const h = makeHarness();
  const pending = h.summary();
  h.context.clearAuth();
  const committed = structuredClone(h.state);
  await finishSummary(pending, { failed: true });
  assert.deepEqual(h.state, committed);
});

test('missing owner or login prevents private GET and loading mutation', async () => {
  for (const auth of [null, { accessToken: 'synthetic', user: {} }, { user: { id: 'A' } }]) {
    const h = makeHarness({ auth });
    await h.context.loadMypageSummary();
    await h.context.loadMypageSettings();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.state.commits, []);
  }
});

test('missing actual session helpers fails closed without private GET', async () => {
  for (const helper of ['authRequestSession', 'authRequestSessionCurrent']) {
    const h = makeHarness();
    h.context[helper] = undefined;
    await h.context.loadMypageSummary();
    await h.context.loadMypageSettings();
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.state.commits, []);
  }
});

test('same-owner token replacement without actual refresh retires pending reads', async () => {
  const h = makeHarness();
  const summary = h.summary();
  const settings = h.settings();
  h.setOwner('A', 'unrelated-login');
  const committed = structuredClone({ state: h.state, controls: h.controls });
  await finishSummary(summary);
  await finishSettings(settings, { locale: 'ko' });
  assert.deepEqual({ state: h.state, controls: h.controls }, committed);
});

test('actual same-owner refresh preserves pending summary and settings reads', async () => {
  const h = makeHarness();
  const session = h.context.authRequestSession();
  const summary = h.summary();
  const settings = h.settings();
  const refreshed = await h.context.refreshAuthOnce();
  assert.ok(refreshed.accessToken.endsWith('rotation-1'));
  assert.notEqual(h.context.authRequestSession(), session);
  assert.equal(h.context.authRequestSessionCurrent(session), true);
  await finishSummary(summary);
  await finishSettings(settings, { locale: 'en' });
  assert.equal(h.state.summary.user.id, 'A');
  assert.equal(h.controls.mypageLocale.value, 'en');
  assert.equal(h.state.refreshCalls, 1);
  assert.deepEqual(h.state.events, ['lumina:authchange']);
});

test('actual refresh bridge does not authorize an old account after switching to B', async () => {
  const h = makeHarness();
  const session = h.context.authRequestSession();
  const summary = h.summary();
  const settings = h.settings();
  await h.context.refreshAuthOnce();
  h.setOwner('B');
  assert.equal(h.context.authRequestSessionCurrent(session), false);
  await finishSummary(h.summary(), { owner: 'B' });
  await finishSettings(h.settings(), { locale: 'en', timezone: 'B-zone' });
  const committed = structuredClone({ state: h.state, controls: h.controls });
  await finishSummary(summary);
  await finishSettings(settings, { locale: 'ko', timezone: 'A-zone' });
  assert.deepEqual({ state: h.state, controls: h.controls }, committed);
});

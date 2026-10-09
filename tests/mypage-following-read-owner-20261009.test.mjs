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

const followingSource = excerpt(html, '        async function loadFullFollowingArtists()', '        async function loadMypageSummary()');
const summarySource = excerpt(html, '        async function loadMypageSummary()', '        async function loadMypageProducts()');
const applySource = excerpt(html, '        function applySummary(summary)', '        async function loadFullFollowingArtists()');
const displayHelpers = excerpt(html, '        function list(value)', '        function busy(');
const listSource = excerpt(html, '        function renderBox(', '        const SAFE_ACCOUNT_STATE_FIXTURES =');
const cardSource = excerpt(html, '        function renderFollowingArtist(', '        function activityLabel(');
const fixtureSource = excerpt(html, '        const SAFE_ACCOUNT_STATE_FIXTURES =', '        function ensureAccountFixtureBanner()');
const sessionSource = excerpt(app, 'function authRequestSession(', 'async function apiFetch(');
const refreshSource = excerpt(app, 'let _refreshInFlight = null;', 'function notifyAuthExpired(');
const authSource = excerpt(app, 'const AUTH_STORAGE_KEY =', '\n/* ');
const followingPath = '/api/v1/me/following-artists?take=20';
const allowedPaths = new Set(['/api/v1/me/summary', '/api/v1/me/debut-applications/latest', followingPath]);
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function authFor(owner, suffix = 'initial') {
  return { user: { id: owner }, accessToken: `synthetic-access-${owner}-${suffix}`, refreshToken: `synthetic-refresh-${owner}-${suffix}` };
}

function artists(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({ slug: `${prefix}-${index}`, displayName: `${prefix}-${index}` }));
}

function summaryFor(owner, count, prefix = owner) {
  return { user: { id: owner, displayName: owner }, wallet: {}, activity: { followingArtists: artists(prefix, count) }, debut: {} };
}

function makeHarness({ auth = authFor('A'), search = '' } = {}) {
  const storage = new Map();
  if (auth) storage.set('lumina_auth', JSON.stringify(auth));
  const requests = [];
  const warnings = [];
  const writes = [];
  const events = [];
  let currentHTML = '';
  const target = {
    get innerHTML() { return currentHTML; },
    set innerHTML(value) { currentHTML = value; writes.push(value); }
  };
  const location = { search };
  let refreshCalls = 0;
  let expired = 0;
  let context;
  context = vm.createContext({
    API_BASE: 'https://synthetic.invalid',
    AbortController,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Event: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { events.push(event.type); } },
    location,
    document: { querySelector: () => null },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    console: { info() {}, warn(...args) { warnings.push(args); } },
    notifyAuthExpired() { expired += 1; },
    $: id => id === 'mypageFollowingSummary' ? target : null,
    setProfilePreview() {},
    getSocialAccountId: () => '',
    getSocialProviderLabel: () => '',
    renderAccountFixtureBanner() {},
    renderEmailVerificationCard() {},
    applyDebutApplication() {},
    normalizeActivityItems: () => [],
    renderActivities() {},
    applyDebutLoading() {},
    applyDebutError() {},
    applyDebutApiNotReady() {},
    apiFetch(path, options) {
      assert.ok(allowedPaths.has(path), 'Only memory-backed GET fixtures are allowed');
      assert.equal(options.method ?? 'GET', 'GET');
      assert.equal(options.auth, true);
      const pending = deferred();
      const auth = context.getAuth();
      requests.push({ ...pending, path, options: structuredClone(options), owner: auth?.user?.id || auth?.user?.userId });
      return pending.promise;
    },
    async fetch(url, options) {
      assert.equal(url, 'https://synthetic.invalid/api/v1/auth/refresh');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.parse(options.body).refreshToken, context.getRefreshToken());
      refreshCalls += 1;
      const auth = context.getAuth();
      const next = authFor(auth.user.id || auth.user.userId, `rotation-${refreshCalls}`);
      return { ok: true, status: 200, json: async () => structuredClone(next) };
    }
  });
  // Actual caller, list/card renderer, fixture factory and session/refresh code; memory DOM/transport only.
  vm.runInContext(`let mypageSummary = null; let mypageActivities = [];\n${sessionSource}\n${refreshSource}\n${authSource}\n${displayHelpers}\n${listSource}\n${cardSource}\n${fixtureSource}\n${applySource}\n${followingSource}\n${summarySource}`, context, { filename: 'mypage-following-actual-excerpts.js' });
  return {
    context, requests, warnings, writes, events, location,
    get html() { return currentHTML; },
    get refreshCalls() { return refreshCalls; },
    get expired() { return expired; },
    get following() { return requests.filter(request => request.path === followingPath); },
    snapshot() { return { html: currentHTML, writes: [...writes], warnings: structuredClone(warnings) }; },
    setOwner(owner, suffix) { context.setAuth(authFor(owner, suffix)); },
    summary() {
      const count = requests.length;
      const promise = context.loadMypageSummary();
      const added = requests.slice(count);
      assert.deepEqual(added.map(request => request.path), ['/api/v1/me/summary', '/api/v1/me/debut-applications/latest']);
      return { promise, summary: added[0], latest: added[1] };
    },
    follow() {
      const count = requests.length;
      const promise = context.loadFullFollowingArtists();
      assert.equal(requests.length, count + 1);
      assert.equal(requests.at(-1).path, followingPath);
      return { promise, request: requests.at(-1) };
    }
  };
}

async function finishSummary(run, owner, count, prefix = owner) {
  run.summary.resolve(summaryFor(owner, count, prefix));
  run.latest.resolve(null);
  await run.promise;
}

async function settle(request, value, failed = false) {
  if (failed) request.reject(value);
  else request.resolve(value);
  await flush();
}

async function seedSummary(h, count = 7, prefix = 'A') {
  await finishSummary(h.summary(), h.context.getAuth().user.id || h.context.getAuth().user.userId, count, prefix);
}

test('pre-reproduction: late A following success cannot replace B zero-follow summary', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const old = h.following[0];
  h.setOwner('B');
  await finishSummary(h.summary(), 'B', 0);
  assert.equal(h.following.length, 1);
  const current = h.snapshot();
  await settle(old, { items: artists('A-late', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('pre-reproduction: late G1 following success cannot replace same-owner G2 zero-follow summary', async () => {
  const h = makeHarness();
  await seedSummary(h, 7, 'G1');
  const old = h.following[0];
  await finishSummary(h.summary(), 'A', 0, 'G2');
  assert.equal(h.following.length, 1);
  const current = h.snapshot();
  await settle(old, { items: artists('G1-late', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('normal current response preserves six-card fallback then displays at most twenty cards', async () => {
  const h = makeHarness();
  await seedSummary(h, 12);
  assert.equal((h.html.match(/class="mypage-following-card"/g) ?? []).length, 6);
  const request = h.following[0];
  assert.equal(request.owner, 'A');
  assert.deepEqual(request.options, { auth: true });
  await settle(request, { items: artists('full', 25) });
  assert.equal((h.html.match(/class="mypage-following-card"/g) ?? []).length, 20);
  assert.ok(h.html.includes('full-19'));
  assert.ok(!h.html.includes('full-20'));
});

test('normal B response remains valid in B account', async () => {
  const h = makeHarness({ auth: authFor('B') });
  await seedSummary(h, 7, 'B');
  assert.equal(h.following[0].owner, 'B');
  await settle(h.following[0], { items: artists('B-full', 7) });
  assert.ok(h.html.includes('B-full-0'));
  assert.equal(h.warnings.length, 0);
});

test('account switch without new summary retires pending success', async () => {
  const h = makeHarness();
  await seedSummary(h);
  h.setOwner('B');
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('A-late', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('same-owner six-follow summary retires old child without child redispatch', async () => {
  const h = makeHarness();
  await seedSummary(h, 7, 'G1');
  await finishSummary(h.summary(), 'A', 6, 'G2');
  assert.equal(h.following.length, 1);
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('G1-late', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('new summary claim retires old child before new summary response', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const next = h.summary();
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old', 7) });
  assert.deepEqual(h.snapshot(), current);
  await finishSummary(next, 'A', 0);
});

test('summary object replacement retires child even without a new summary request claim', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const claim = h.context.loadMypageSummary.currentRead;
  h.context.applySummary(summaryFor('A', 6, 'replacement'));
  assert.equal(h.context.loadMypageSummary.currentRead, claim);
  assert.equal(h.following.length, 1);
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('actual safe fixture applies zero follows, dispatches no child, and retires pending child', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const count = h.requests.length;
  h.location.search = '?accountfixture=verified';
  await h.context.loadMypageSummary();
  assert.equal(h.requests.length, count);
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old-private', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('logged-out safe fixture still renders without any request', async () => {
  const h = makeHarness({ auth: null, search: '?accountfixture=verified' });
  await h.context.loadMypageSummary();
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 1);
  assert.equal(h.warnings.length, 0);
});

test('new child request owns success even when summary identities stay unchanged', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const newer = h.follow();
  await settle(newer.request, { items: artists('new-child', 7) });
  await newer.promise;
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old-child', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('stale child failure cannot log after a newer child succeeds', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const newer = h.follow();
  await settle(newer.request, { items: artists('new-child', 7) });
  await newer.promise;
  const current = h.snapshot();
  await settle(h.following[0], new Error('SYNTHETIC_PRIVATE_ERROR'), true);
  assert.deepEqual(h.snapshot(), current);
});

for (const failed of [false, true]) {
  test(`logout retires late ${failed ? 'failure log' : 'success'}`, async () => {
    const h = makeHarness();
    await seedSummary(h);
    h.context.clearAuth();
    const current = h.snapshot();
    await settle(h.following[0], failed ? new Error('SYNTHETIC_PRIVATE_ERROR') : { items: artists('old', 7) }, failed);
    assert.deepEqual(h.snapshot(), current);
  });
}

test('late account failure is silent', async () => {
  const h = makeHarness();
  await seedSummary(h);
  h.setOwner('B');
  await finishSummary(h.summary(), 'B', 0);
  const current = h.snapshot();
  await settle(h.following[0], new Error('SYNTHETIC_PRIVATE_ERROR'), true);
  assert.deepEqual(h.snapshot(), current);
});

test('same-owner token replacement without real refresh retires success', async () => {
  const h = makeHarness();
  await seedSummary(h);
  h.setOwner('A', 'unrelated-login');
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('actual same-owner refresh bridge permits current child without extra follow dispatch', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const session = h.context.authRequestSession();
  await h.context.refreshAuthOnce();
  assert.notEqual(h.context.authRequestSession(), session);
  assert.equal(h.context.authRequestSessionCurrent(session), true);
  await settle(h.following[0], { items: artists('refreshed', 7) });
  assert.ok(h.html.includes('refreshed-0'));
  assert.equal(h.refreshCalls, 1);
  assert.equal(h.following.length, 1);
  assert.equal(h.expired, 0);
});

test('actual refresh bridge does not bypass newer summary ownership', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const session = h.context.authRequestSession();
  await h.context.refreshAuthOnce();
  await finishSummary(h.summary(), 'A', 0);
  assert.equal(h.context.authRequestSessionCurrent(session), true);
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('actual refresh bridge does not bypass a switch to B', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const session = h.context.authRequestSession();
  await h.context.refreshAuthOnce();
  h.setOwner('B');
  assert.equal(h.context.authRequestSessionCurrent(session), false);
  const current = h.snapshot();
  await settle(h.following[0], { items: artists('old', 7) });
  assert.deepEqual(h.snapshot(), current);
});

test('items takes precedence over legacy artists', async () => {
  const h = makeHarness();
  await seedSummary(h);
  await settle(h.following[0], { items: artists('canonical', 7), artists: artists('legacy', 7) });
  assert.ok(h.html.includes('canonical-0'));
  assert.ok(!h.html.includes('legacy-0'));
});

test('legacy artists remains supported when items is not an array', async () => {
  const h = makeHarness();
  await seedSummary(h);
  await settle(h.following[0], { items: {}, artists: artists('legacy', 7) });
  assert.ok(h.html.includes('legacy-0'));
});

for (const [label, payload] of [
  ['canonical empty with nonempty alias', { items: [], artists: artists('ignored', 7) }],
  ['legacy empty', { artists: [] }],
  ['null', null],
  ['absent wrapper', {}],
  ['invalid wrapper', { items: {}, artists: 'invalid' }]
]) {
  test(`${label} preserves the six-card summary fallback`, async () => {
    const h = makeHarness();
    await seedSummary(h);
    const current = h.snapshot();
    await settle(h.following[0], payload);
    assert.deepEqual(h.snapshot(), current);
  });
}

test('current failure preserves fallback and logs only one neutral string', async () => {
  const h = makeHarness();
  await seedSummary(h);
  const currentHTML = h.html;
  const error = new Error('SYNTHETIC_PRIVATE_ERROR');
  error.payload = { privateMarker: 'SYNTHETIC_PRIVATE_PAYLOAD' };
  await settle(h.following[0], error, true);
  assert.equal(h.html, currentHTML);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.warnings[0].length, 1);
  assert.equal(typeof h.warnings[0][0], 'string');
  assert.match(h.warnings[0][0], /^\[Mypage\] \/me\/following-artists/);
  assert.ok(!JSON.stringify(h.warnings).includes('SYNTHETIC_PRIVATE'));
});

test('missing owner, login or actual session helpers prevents child dispatch', async () => {
  for (const auth of [null, { accessToken: 'synthetic', user: {} }, { user: { id: 'A' } }]) {
    const h = makeHarness({ auth });
    await h.context.loadFullFollowingArtists();
    assert.equal(h.requests.length, 0);
    assert.equal(h.warnings.length, 0);
  }
  for (const helper of ['authRequestSession', 'authRequestSessionCurrent']) {
    const h = makeHarness();
    h.context[helper] = undefined;
    await h.context.loadFullFollowingArtists();
    assert.equal(h.requests.length, 0);
    assert.equal(h.warnings.length, 0);
  }
});

test('userId alias remains a valid actual session owner', async () => {
  const auth = authFor('A');
  auth.user = { userId: 'A' };
  const h = makeHarness({ auth });
  await seedSummary(h);
  assert.equal(h.following[0].owner, 'A');
  await settle(h.following[0], { items: artists('alias-owner', 7) });
  assert.ok(h.html.includes('alias-owner-0'));
});

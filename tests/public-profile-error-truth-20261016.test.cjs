'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const phase = process.env.PUBLIC_PROFILE_ERROR_PHASE || 'current';
assert(['baseline', 'current'].includes(phase));
const root = path.resolve(process.env.PUBLIC_PROFILE_ERROR_SOURCE_ROOT || path.join(__dirname, '..'));
const pins = {
  baseline: { 'pages/user-profile.js': '1f82e2948091180627f4f6665fedecf6850da9b7e103722dc7504859737177ec',
    'user-profile/index.html': '0fc25fa70aa80df8d1c5f19e43a9e7363b21dc30eba72eb74fc260b754fac50d' },
  current: { 'pages/user-profile.js': 'ddeb79308d7fcf0c236d561d2214944623f011066a9fb49460e83937d44acce8',
    'user-profile/index.html': 'dbd1cd661a3c51cbf397b33ca81feab7f67f878bdf33e0d0f5e42f0eddca200b' },
};
function read(file, pin) {
  const bytes = fs.readFileSync(path.join(root, file));
  assert(bytes.length > 0 && bytes.length <= 512 * 1024);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF') && Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r') && (text === lf || text === lf.replace(/\n/g, '\r\n')));
  assert.equal(crypto.createHash('sha256').update(lf).digest('hex'), pin);
  return lf;
}
const source = read('pages/user-profile.js', pins[phase]['pages/user-profile.js']);
const html = read('user-profile/index.html', pins[phase]['user-profile/index.html']);
const app = read('app.js', phase === 'baseline'
  ? 'a1d791ee7ba4fce5e5777777d5326147a1f0a3ae32f90ce38728a9ec40ec9f1b'
  : '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87');
const apiStart = 'async function apiFetch(path, options = {}, _retryDepth = 0) {';
assert.equal(app.split(apiStart).length, 2);
const start = app.indexOf(apiStart), end = app.indexOf('\n/*', start);
assert(end > start);
const actualApi = app.slice(start, end).trimEnd();
assert(actualApi.startsWith(apiStart) && actualApi.endsWith('\n}'));
const actualBase = 'const API_BASE = "https://api.lumina-stage.com";';
assert.equal(app.split(actualBase).length, 2);
const pageScript = phase === 'baseline' ? '/pages/user-profile.js' : '/pages/user-profile.js?v=public-profile-post-payload-truth-20261016';
assert.equal(html.split('<script src="' + pageScript + '"></script>').length, 2);
assert(html.indexOf(pageScript) < html.indexOf('/app.js?v=wallet-session-20261011'));
const secret = 'synthetic-message-not-for-console';
const options = { timeout: 10000, concurrency: false };

function element() {
  const classes = new Set();
  return { hidden: false, style: {}, textContent: '', innerHTML: '', dataset: {},
    classList: { add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name),
      toggle: (name, force) => { const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name); return add; } },
    addEventListener() {}, querySelector() { return null; }, setAttribute() {}, getAttribute() { return null; } };
}
function fixture(input = {}) {
  const url = new URL(input.url || 'https://www.lumina-stage.com/user-profile/?handle=fan123');
  const nodes = new Map(['userProfileCard', 'userProfileEmpty', 'userProfileBlocked', 'userProfilePostsSection',
    'userProfilePostsEmpty', 'userProfilePostList', 'userProfileLoadMore', 'userProfileName',
    'userProfileFollowerCount', 'userProfileFollowingCount', 'userProfilePostCount'].map(id => [id, element()]));
  const calls = [], warnings = [], faults = [], timers = new Map();
  let timerId = 0, closed = false;
  function check(value, message) {
    if (!value) { faults.push(message); throw new Error(message); }
  }
  const document = { title: '', getElementById: id => nodes.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const window = { location: url, addEventListener() {}, alert() { check(false, 'No interactive action'); } };
  const context = { document, window, URL, URLSearchParams, AbortController, Response,
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args), log() {} },
    isLoggedIn: () => false, getAuth: () => null, _luminaFeedItems: [],
    normalizeFeedPost() { check(false, 'No nonempty feed fixture admitted'); },
    setTimeout(fn, delay) { check(delay === 8000, 'Only existing API timer admitted');
      const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    refreshAuthOnce() { check(false, 'No auth refresh admitted'); },
    fetch: async (value, init) => {
      calls.push({ url: value, method: init?.method, headers: init?.headers });
      check(!closed && calls.length <= 2 && typeof value === 'string', 'Bounded selected request');
      check(init?.method === 'GET' && init.body === undefined && init.signal instanceof AbortSignal,
        'Only original read calls admitted');
      check(Object.keys(init.headers).length === 0, 'No credentials or extra headers admitted');
      const profile = 'https://api.lumina-stage.com/api/v1/users/handle/' + encodeURIComponent(url.searchParams.get('handle')) + '/profile';
      const feed = 'https://api.lumina-stage.com/api/v1/users/handle/' + encodeURIComponent(url.searchParams.get('handle')) + '/lumina-feed?take=20';
      check(value === (calls.length === 1 ? profile : feed), 'Exact selected profile then optional feed');
      if (calls.length === 2) return Response.json({ items: [], nextCursor: null });
      if (input.networkFailure) throw new Error(secret);
      return Response.json(input.payload ?? { message: secret }, { status: input.status ?? 404 });
    },
  };
  for (const name of ['bindLuminaFeedExpand', 'bindLuminaFeedDelete', 'bindLuminaFeedEdit', 'bindLuminaFeedLike',
    'bindLuminaFeedThreadBadge', 'bindLuminaFeedComment', 'bindFeedAssetLightbox']) context[name] = () => {};
  vm.createContext(context, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(actualBase + '\n' + actualApi, { filename: 'actual-shared-api-fetch.js' }).runInContext(context, { timeout: 1000 });
  new vm.Script(source, { filename: 'actual-whole-user-profile.js' }).runInContext(context, { timeout: 1000 });
  check(typeof window.initUserProfilePage === 'function', 'Whole actual profile boot export required');
  return { nodes, calls, warnings, document, run: () => window.initUserProfilePage(),
    done() { closed = true; assert.deepEqual(faults, []); assert.equal(timers.size, 0, 'All API timers cleared'); } };
}

test('01 a failed normal profile lookup cannot become a synthetic member', options, async () => {
  for (const input of [
    { status: 404 }, { status: 500 }, { networkFailure: true }, { status: 200, payload: {} },
    { status: 404, url: 'https://www.lumina-stage.com/user-profile/?handle=debut9&followfixture=1' },
    { status: 404, url: 'http://localhost/user-profile/?handle=fan123' },
  ]) {
    const f = fixture(input);
    try {
      await f.run();
      assert.equal(f.nodes.get('userProfileCard').hidden, true,
        'PUBLIC_PROFILE_ERROR_IS_NOT_A_MEMBER: a failed normal lookup must not render a fabricated profile');
      assert.equal(f.nodes.get('userProfileEmpty').hidden, false);
      assert.equal(f.nodes.get('userProfileBlocked').hidden, true);
      assert.equal(f.nodes.get('userProfileName').textContent, '');
      assert.equal(f.nodes.get('userProfileFollowerCount').textContent, '');
      assert.equal(f.calls.length, 1, 'No follow/feed/refresh or retry after a failed profile');
      assert(!JSON.stringify(f.warnings).includes(secret), 'Do not log the response/error message');
    } finally { f.done(); }
  }
});

test('02 an explicit403 stays blocked and valid source profiles keep their real fields', options, async () => {
  const denied = fixture({ status: 403 });
  try {
    await denied.run();
    assert.equal(denied.nodes.get('userProfileBlocked').hidden, false);
    assert.equal(denied.nodes.get('userProfileCard').hidden, true);
    assert.equal(denied.nodes.get('userProfileEmpty').hidden, true);
    assert.equal(denied.calls.length, 1); assert.deepEqual(denied.warnings, []);
  } finally { denied.done(); }
  const active = fixture({ status: 200, payload: {
    user: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic real-source member', publicHandle: 'fan123' },
    stats: { followerCount: 2, followingCount: 4, postCount: 7 }, viewer: { isSelf: false, canFollow: false },
  } });
  try {
    await active.run();
    assert.equal(active.nodes.get('userProfileCard').hidden, false);
    assert.equal(active.nodes.get('userProfileName').textContent, 'Synthetic real-source member');
    assert.equal(active.nodes.get('userProfileFollowerCount').textContent, '2');
    assert.equal(active.nodes.get('userProfileFollowingCount').textContent, '4');
    assert.equal(active.nodes.get('userProfilePostCount').textContent, '7');
    assert.equal(active.nodes.get('userProfileBlocked').hidden, true);
    assert.equal(active.nodes.get('userProfileEmpty').hidden, true);
    assert.equal(active.calls.length, 2); assert.deepEqual(active.warnings, []);
  } finally { active.done(); }
});

test('03 only explicit local previews retain fixtures without API or mutation', options, async () => {
  for (const host of ['localhost', '127.0.0.1', 'preview.local']) {
    const f = fixture({ url: 'http://' + host + '/user-profile/?handle=relationship-preview&followfixture=1' });
    try {
      await f.run();
      assert.equal(f.nodes.get('userProfileCard').hidden, false);
      assert.equal(f.nodes.get('userProfileEmpty').hidden, true);
      assert.equal(f.nodes.get('userProfileBlocked').hidden, true);
      assert(f.nodes.get('userProfileName').textContent.length > 0);
      assert.equal(f.calls.length, 0); assert.deepEqual(f.warnings, []);
    } finally { f.done(); }
  }
});

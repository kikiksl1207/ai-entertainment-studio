'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
// AUTHOR UNRUN. Baseline is the frozen Unit39 input, not an operating-base claim.
const phase = process.env.PUBLIC_PROFILE_POST_PAYLOAD_PHASE || 'current';
assert(['baseline', 'current'].includes(phase));
const root = path.resolve(process.env.PUBLIC_PROFILE_POST_PAYLOAD_SOURCE_ROOT || path.join(__dirname, '..'));
const pins = {
  baseline: { 'pages/user-profile.js': '40523801f56d532f6caeaf6f64aae6283759f52f99c85dc949e9d35cf0d1d2f4',
    'user-profile/index.html': 'a4a12b1470a31f3723520b2b976f78586b82df7b690c1b2e26d37bd4d8a9ffa6' },
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
const app = read('app.js', 'a1d791ee7ba4fce5e5777777d5326147a1f0a3ae32f90ce38728a9ec40ec9f1b');
const apiStart = 'async function apiFetch(path, options = {}, _retryDepth = 0) {';
assert.equal(app.split(apiStart).length, 2);
const start = app.indexOf(apiStart), end = app.indexOf('\n/*', start);
assert(end > start);
const actualApi = app.slice(start, end).trimEnd();
assert(actualApi.startsWith(apiStart) && actualApi.endsWith('\n}'));
const actualBase = 'const API_BASE = "https://api.lumina-stage.com";';
assert.equal(app.split(actualBase).length, 2);
const tag = phase === 'baseline' ? 'public-profile-post-error-truth-20261016' : 'public-profile-post-payload-truth-20261016';
const pageScript = '/pages/user-profile.js?v=' + tag;
assert.equal(html.split('<script src="' + pageScript + '"></script>').length, 2);
assert(html.indexOf(pageScript) < html.indexOf('/app.js?v=wallet-session-20261011'));
const secret = 'synthetic-post-payload-not-for-console';
const options = { timeout: 10000, concurrency: false };

function element() {
  const classes = new Set(), listeners = new Map();
  return { hidden: false, disabled: false, style: {}, textContent: '', innerHTML: '', dataset: {}, listeners,
    classList: { add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name),
      toggle: (name, force) => { const add = force === undefined ? !classes.has(name) : force;
        if (add) classes.add(name); else classes.delete(name); return add; } },
    addEventListener(name, fn) { assert.equal(typeof fn, 'function'); listeners.set(name, fn); },
    querySelector() { return null; }, setAttribute() {}, getAttribute() { return null; } };
}
function fixture(input = {}) {
  const url = new URL('https://www.lumina-stage.com/user-profile/?handle=synthetic-source-owner');
  const nodes = new Map(['userProfileCard', 'userProfileEmpty', 'userProfileBlocked', 'userProfilePostsSection',
    'userProfilePostsEmpty', 'userProfilePostList', 'userProfileLoadMore', 'userProfileName',
    'userProfileFollowerCount', 'userProfileFollowingCount', 'userProfilePostCount'].map(id => [id, element()]));
  const calls = [], warnings = [], faults = [], timers = new Map();
  let timerId = 0, closed = false;
  function check(value, message) { if (!value) { faults.push(message); throw new Error(message); } }
  const document = { title: '', getElementById: id => nodes.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const window = { location: url, addEventListener() {}, alert() { check(false, 'No interactive mutation'); } };
  const feed = 'https://api.lumina-stage.com/api/v1/users/handle/synthetic-source-owner/lumina-feed?take=20';
  const context = { document, window, URL, URLSearchParams, AbortController, Response,
    console: { warn: (...args) => warnings.push(args), error: (...args) => warnings.push(args), log() {} },
    isLoggedIn: () => false, getAuth: () => null, _luminaFeedItems: [],
    normalizeFeedPost() { check(false, 'No nonempty source feed fixture admitted'); },
    setTimeout(fn, delay) { check(delay === 8000, 'Only existing API timer admitted');
      const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    refreshAuthOnce() { check(false, 'No auth refresh admitted'); },
    fetch: async (value, init) => {
      calls.push({ url: value, method: init?.method, headers: init?.headers });
      check(!closed && calls.length <= 3 && typeof value === 'string', 'Bounded selected requests');
      check(init?.method === 'GET' && init.body === undefined && init.signal instanceof AbortSignal,
        'Only original read calls admitted');
      check(Object.keys(init.headers).length === 0, 'No credentials or extra headers admitted');
      const expected = calls.length === 1
        ? 'https://api.lumina-stage.com/api/v1/users/handle/synthetic-source-owner/profile'
        : calls.length === 2 ? feed : feed + '&cursor=synthetic-next';
      check(value === expected, 'Exact profile, initial feed and optional original cursor route');
      if (calls.length === 1) return Response.json({
        user: { id: '11111111-1111-4111-8111-111111111111', displayName: 'Synthetic source profile', publicHandle: 'synthetic-source-owner' },
        stats: { followerCount: 2, followingCount: 4, postCount: 7 }, viewer: { isSelf: false, canFollow: false },
      });
      if (calls.length === 2 && Object.prototype.hasOwnProperty.call(input, 'initialPayload')) {
        return Response.json(input.initialPayload);
      }
      if (calls.length === 3) {
        check(Object.prototype.hasOwnProperty.call(input, 'nextPayload'), 'Explicit malformed next page required');
        return Response.json(input.nextPayload);
      }
      return Response.json({ items: [], nextCursor: input.nextCursor ?? null });
    },
  };
  for (const name of ['bindLuminaFeedExpand', 'bindLuminaFeedDelete', 'bindLuminaFeedEdit', 'bindLuminaFeedLike',
    'bindLuminaFeedThreadBadge', 'bindLuminaFeedComment', 'bindFeedAssetLightbox']) context[name] = () => {};
  vm.createContext(context, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(actualBase + '\n' + actualApi, { filename: 'actual-shared-api-fetch.js' }).runInContext(context, { timeout: 1000 });
  new vm.Script(source, { filename: 'actual-whole-user-profile.js' }).runInContext(context, { timeout: 1000 });
  check(typeof window.initUserProfilePage === 'function', 'Whole actual profile boot export required');
  return { nodes, calls, warnings, context, run: () => window.initUserProfilePage(),
    done() { closed = true; assert.deepEqual(faults, []); assert.equal(timers.size, 0, 'All API timers cleared'); } };
}
function originalProfileRemains(f) {
  assert.equal(f.nodes.get('userProfileCard').hidden, false);
  assert.equal(f.nodes.get('userProfileName').textContent, 'Synthetic source profile');
  assert.equal(f.nodes.get('userProfileFollowerCount').textContent, '2');
  assert.equal(f.nodes.get('userProfileFollowingCount').textContent, '4');
  assert.equal(f.nodes.get('userProfilePostCount').textContent, '7');
  assert.equal(f.nodes.get('userProfileEmpty').hidden, true);
  assert.equal(f.nodes.get('userProfileBlocked').hidden, true);
}

test('01 malformed successful post payloads are not an empty history', options, async () => {
  for (const initialPayload of [null, {}, [], { items: null }, { items: {} }, { items: 0 }, { items: secret }]) {
    const f = fixture({ initialPayload });
    try {
      await f.run(); originalProfileRemains(f);
      assert.match(f.nodes.get('userProfilePostList').innerHTML, /글 목록을 불러오지 못했어요/,
        'PUBLIC_PROFILE_POST_PAYLOAD_IS_NOT_EMPTY: malformed successful data must not invent an empty history');
      assert.equal(f.nodes.get('userProfilePostsEmpty').hidden, true);
      assert.equal(f.calls.length, 2, 'No retry, mutation or refresh');
      assert.equal(f.warnings.length, 1);
      assert(!JSON.stringify(f.warnings).includes(secret), 'Raw error/body must not enter warnings');
      assert.equal(f.warnings[0].length, 2);
      assert.equal(f.warnings[0][1], 'unavailable');
      assert.equal(f.context._luminaFeedItems.length, 0);
    } finally { f.done(); }
  }
});

test('02 malformed next-page payload preserves retained rows and the original cursor', options, async () => {
  const f = fixture({ nextCursor: 'synthetic-next', nextPayload: { items: null, message: secret } });
  try {
    await f.run(); originalProfileRemains(f);
    const list = f.nodes.get('userProfilePostList'), button = f.nodes.get('userProfileLoadMore');
    assert.equal(button.hidden, false); assert.equal(typeof button.listeners.get('click'), 'function');
    const retained = { id: 'synthetic-retained-display-seam' };
    f.context._luminaFeedItems.push(retained); list.innerHTML = '<p>Synthetic retained display seam</p>';
    const before = f.context._luminaFeedItems, priorHtml = list.innerHTML;
    await button.listeners.get('click')();
    assert.equal(list.innerHTML, priorHtml); assert.equal(f.context._luminaFeedItems, before);
    assert.equal(f.context._luminaFeedItems.length, 1); assert.equal(before[0], retained);
    assert.equal(button.disabled, false); assert.equal(button.hidden, false);
    assert.equal(f.nodes.get('userProfilePostsEmpty').hidden, true);
    assert.equal(f.calls.length, 3); assert.equal(f.calls[2].url.split('&cursor=')[1], 'synthetic-next');
    assert.equal(f.warnings.length, 1); assert.equal(f.warnings[0][1], 'unavailable');
    assert(!JSON.stringify(f.warnings).includes(secret)); originalProfileRemains(f);
  } finally { f.done(); }
});

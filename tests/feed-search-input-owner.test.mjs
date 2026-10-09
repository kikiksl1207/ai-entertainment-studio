import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const pageSource = readFileSync(new URL('../pages/lumina-feed.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing production section: ${start} -> ${end}`);
  return source.slice(from, to);
}

const runtimeSource = [
  section(pageSource, 'let _luminaFeedFilter =', 'function feedViewerKey()'),
  section(appSource, 'let _luminaFeedItems =', 'function feedEscapeHtml('),
  section(appSource, 'function normalizeFeedAuthorType(', 'function buildUserProfileUrl('),
  section(appSource, 'function normalizeFeedThread(', 'let _feedEditModalEl ='),
  section(pageSource, 'function feedViewerKey()', 'function invalidateFeedReads()'),
  section(pageSource, 'function feedReadsBlockedForViewer()', 'function closeProtectedFeedDetails()'),
  section(pageSource, 'function feedResponseItems(', 'function isFeedFixtureAuthorHandle('),
  section(pageSource, 'function feedLocaleToLanguage(', 'function feedT('),
  section(pageSource, 'async function loadLuminaFeedData(', 'function renderLuminaFeed()'),
  section(pageSource, 'function bindLuminaFeedSearch()', 'function renderFeedTrendButtons('),
].join('\n');

const flush = () => new Promise(resolve => setImmediate(resolve));
const post = id => ({ id, postType: 'fan_post', authorType: 'fan', body: `synthetic-${id}` });

function fixture({ locale = 'en-US', authenticated = true } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const inputListeners = new Map();
  const documentListeners = new Map();
  const calls = [];
  const renders = [];
  const discoveryRefreshes = [];
  const input = {
    value: '',
    addEventListener(name, handler) {
      inputListeners.set(name, [...(inputListeners.get(name) || []), handler]);
    },
  };
  const document = {
    getElementById: id => id === 'feedSearchInput' ? input : null,
    addEventListener(name, handler) {
      documentListeners.set(name, [...(documentListeners.get(name) || []), handler]);
    },
  };
  const context = {
    document,
    _currentLocale: locale,
    initialPost: post('seed'),
    getAuth: () => authenticated ? { accessToken: 'synthetic-only', user: { id: 'synthetic-viewer' } } : null,
    isLoggedIn: () => authenticated,
    window: { location: { hostname: 'qa.invalid' } },
    console: { info() {} },
    setTimeout(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, due: now + delay, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    // Only transport and the rendered surface are synthetic; ownership decisions are production code.
    apiFetch(path, options = {}) {
      const url = new URL(path, 'https://qa.invalid');
      assert.ok(['/api/v1/lumina-feed/search', '/api/v1/me/lumina-feed', '/api/v1/lumina-feed'].includes(url.pathname));
      assert.equal(options.method || 'GET', 'GET');
      assert.equal(options.throwOnError, true);
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const call = { path, url, options, resolve, reject };
      calls.push(call);
      return promise;
    },
    renderLuminaFeed() { renders.push(context.qa.state()); },
    refreshLuminaFeedDiscoveryIfDue(age) { discoveryRefreshes.push(age); },
    fetch() { throw new Error('real transport is forbidden'); },
  };
  runInNewContext(`${runtimeSource}\n
    _luminaFeedItems = [normalizeFeedPost(initialPost)];
    _luminaFeedSource = 'operations';
    this.qa = {
      bindInput: bindLuminaFeedSearch,
      bindClicks: bindFeedDiscoveryClicks,
      state: () => JSON.parse(JSON.stringify({
        query: _luminaFeedQuery, items: _luminaFeedItems, source: _luminaFeedSource,
        searchSeq: _luminaFeedSearchSeq, listSeq: _feedListLoadSeq,
      })),
    };`, context);
  const state = () => JSON.parse(JSON.stringify(context.qa.state()));
  context.qa.bindInput();
  context.qa.bindClicks();
  return {
    calls, renders, discoveryRefreshes, input, state,
    rebind() { context.qa.bindInput(); context.qa.bindClicks(); },
    listenerCounts: () => [inputListeners.get('input').length, inputListeners.get('keydown').length, documentListeners.get('click').length],
    edit(value) {
      input.value = value;
      for (const handler of inputListeners.get('input')) handler({ type: 'input' });
    },
    key(key) {
      let prevented = false;
      for (const handler of inputListeners.get('keydown')) handler({ key, preventDefault() { prevented = true; } });
      return prevented;
    },
    click(keyword) {
      let prevented = false;
      const button = keyword === null ? null : { dataset: { feedSearchKeyword: keyword } };
      const target = { closest: selector => {
        assert.equal(selector, '[data-feed-search-keyword]');
        return button;
      } };
      for (const handler of documentListeners.get('click')) handler({ target, preventDefault() { prevented = true; } });
      return prevented;
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const entry = [...timers.entries()].filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!entry) break;
        const [id, timer] = entry;
        timers.delete(id);
        now = timer.due;
        timer.callback();
      }
      now = target;
    },
    pendingDelays: () => [...timers.values()].map(timer => timer.delay),
  };
}

function assertSearch(call, keyword, language = 'en', authenticated = true) {
  assert.equal(call.url.pathname, '/api/v1/lumina-feed/search');
  assert.deepEqual([...call.url.searchParams], [
    ['q', keyword.trim()], ['type', keyword.trim().startsWith('#') ? 'hashtag' : 'text'],
    ['language', language], ['take', '30'],
  ]);
  assert.equal(call.options.auth, authenticated);
  assert.equal(call.options.throwOnError, true);
  assert.equal(call.options.method, undefined);
  assert.equal(call.options.body, undefined);
}

test('input and discovery handlers bind once; unrelated keys and clicks send nothing', () => {
  const view = fixture();
  view.rebind();
  assert.deepEqual(view.listenerCounts(), [1, 1, 1]);
  assert.equal(view.key('Escape'), false);
  assert.equal(view.click(null), false);
  assert.equal(view.calls.length, 0);
  assert.deepEqual(view.pendingDelays(), []);
});

for (const [locale, language] of [['ko-KR', 'ko'], ['en-US', 'en'], ['ja-JP', 'ja'], ['zh-CN', 'zh'], ['zh-Hant', 'zh']]) {
  test(`unchanged A keeps the 360ms debounce and current success in ${locale}`, async () => {
    const view = fixture({ locale });
    view.edit('  A  ');
    assert.equal(view.calls.length, 0);
    assert.deepEqual(view.pendingDelays(), [360]);
    view.advance(359);
    assert.equal(view.calls.length, 0);
    view.advance(1);
    assert.equal(view.calls.length, 1);
    assertSearch(view.calls[0], 'A', language);
    view.calls[0].resolve({ items: [post('current-A')] });
    await flush();
    assert.equal(view.state().items[0].id, 'current-A');
    assert.equal(view.state().source, 'search');
    assert.equal(view.renders.at(-1).items[0].id, 'current-A');
    assert.deepEqual(view.discoveryRefreshes, [60_000]);
    view.advance(1000);
    assert.equal(view.calls.length, 1);
  });
}

for (const intent of ['B edit', 'clear', 'A-B-A']) {
  for (const outcome of ['success', 'failure']) {
    test(`${intent} before timer rejects old ${outcome}`, async () => {
      const view = fixture();
      view.click('A');
      assertSearch(view.calls[0], 'A');
      if (intent === 'A-B-A') { view.edit('B'); view.edit('A'); }
      else view.edit(intent === 'clear' ? '' : 'B');
      const before = view.state();
      const renderCount = view.renders.length;
      assert.equal(view.calls.length, 1, 'input intent sends no additional request');
      assert.deepEqual(view.pendingDelays(), [360]);
      if (outcome === 'success') view.calls[0].resolve({ items: [post('stale-A')] });
      else view.calls[0].reject(new Error('synthetic-failure'));
      await flush();
      assert.deepEqual(view.state(), before, 'stale response must not commit after input intent');
      assert.equal(view.renders.length, renderCount, 'stale response must not repaint');
      assert.deepEqual(view.discoveryRefreshes, []);
      view.advance(359);
      assert.equal(view.calls.length, 1);
      view.advance(1);
      assert.equal(view.calls.length, 2);
      if (intent === 'clear') {
        assert.equal(view.calls[1].path, '/api/v1/me/lumina-feed?mode=all&take=30');
        assert.equal(view.calls[1].options.auth, true);
      } else assertSearch(view.calls[1], intent === 'A-B-A' ? 'A' : 'B');
      view.calls[1].resolve({ posts: [post('latest')] });
      await flush();
      assert.equal(view.state().items[0].id, 'latest');
      assert.equal(view.state().source, intent === 'clear' ? 'me_all' : 'search');
      assert.deepEqual(view.discoveryRefreshes, intent === 'clear' ? [] : [60_000]);
      view.advance(1000);
      assert.equal(view.calls.length, 2);
    });
  }
}

for (const outcome of ['success', 'failure']) {
  test(`late current B commits and later old A ${outcome} cannot overwrite it`, async () => {
    const view = fixture();
    view.click('A');
    view.edit('B');
    view.advance(360);
    assert.equal(view.calls.length, 2);
    assertSearch(view.calls[1], 'B');
    view.advance(5000);
    view.calls[1].resolve([post('current-B')]);
    await flush();
    const before = view.state();
    const renderCount = view.renders.length;
    assert.equal(before.items[0].id, 'current-B');
    if (outcome === 'success') view.calls[0].resolve([post('stale-A')]);
    else view.calls[0].reject(new Error('synthetic-failure'));
    await flush();
    assert.deepEqual(view.state(), before);
    assert.equal(view.renders.length, renderCount);
    assert.deepEqual(view.discoveryRefreshes, [60_000]);
    assert.equal(view.calls.length, 2);
  });
}

test('Enter dispatches the latest input once and cancels its delayed duplicate', async () => {
  const view = fixture();
  view.click('A');
  view.edit('B');
  view.advance(100);
  assert.equal(view.key('Enter'), true);
  assert.equal(view.calls.length, 2);
  assertSearch(view.calls[1], 'B');
  assert.deepEqual(view.pendingDelays(), []);
  view.calls[1].resolve({ items: [post('entered-B')] });
  await flush();
  view.calls[0].resolve({ items: [post('old-A')] });
  await flush();
  view.advance(1000);
  assert.equal(view.calls.length, 2);
  assert.equal(view.state().items[0].id, 'entered-B');
  assert.deepEqual(view.discoveryRefreshes, [60_000]);
});

test('popular clicks still search immediately with their latest keyword and hashtag type', async () => {
  const view = fixture();
  assert.equal(view.click('A'), true);
  assert.equal(view.calls.length, 1);
  assert.equal(view.click('#B'), true);
  assert.equal(view.input.value, '#B');
  assert.equal(view.state().query, '#B');
  assert.equal(view.calls.length, 2);
  assertSearch(view.calls[1], '#B');
  assert.deepEqual(view.pendingDelays(), []);
  view.calls[1].resolve({ items: [post('popular-B')] });
  await flush();
  view.calls[0].resolve({ items: [post('popular-A')] });
  await flush();
  assert.equal(view.state().items[0].id, 'popular-B');
  assert.deepEqual(view.discoveryRefreshes, [60_000]);
  view.advance(1000);
  assert.equal(view.calls.length, 2);
});

test('current failure remains an error without a discovery refresh or automatic retry', async () => {
  const view = fixture();
  view.edit('A');
  view.advance(360);
  view.calls[0].reject(new Error('synthetic-failure'));
  await flush();
  assert.deepEqual(view.state().items, []);
  assert.equal(view.state().source, 'error');
  assert.equal(view.renders.at(-1).source, 'error');
  assert.deepEqual(view.discoveryRefreshes, []);
  view.advance(5000);
  assert.equal(view.calls.length, 1);
});

test('anonymous current search preserves the existing auth=false request contract', async () => {
  const view = fixture({ authenticated: false });
  view.edit('A');
  view.advance(360);
  assertSearch(view.calls[0], 'A', 'en', false);
  view.calls[0].resolve({ items: [post('anonymous-A')] });
  await flush();
  assert.equal(view.state().items[0].id, 'anonymous-A');
  assert.equal(view.calls.length, 1);
});

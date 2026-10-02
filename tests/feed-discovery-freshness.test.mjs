import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const pageSource = readFileSync(new URL('../pages/lumina-feed.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start} -> ${end}`);
  return source.slice(from, to);
}

const dictionary = runInNewContext(`${section(appSource,
  'const I18N_DICT = {', 'let _currentLocale = I18N_FALLBACK;')}\nI18N_DICT`, {});

// Keep lexical state and every discovery/search decision in production code.
// The real feed renderer returns early because this focused DOM has no post list.
const runtimeSource = [
  section(pageSource, 'let _luminaFeedFilter =', 'function feedViewerKey()'),
  section(appSource, 'let _luminaFeedItems =', 'function feedEscapeHtml('),
  section(appSource, 'function feedEscapeHtml(', 'function normalizeFeedAuthorType('),
  section(appSource, 'function normalizeFeedAuthorType(', 'function buildUserProfileUrl('),
  section(appSource, 'function normalizeFeedThread(', 'let _feedEditModalEl ='),
  section(pageSource, 'function feedViewerKey()', 'function invalidateFeedReads()'),
  section(pageSource, 'function feedReadsBlockedForViewer()', 'function closeProtectedFeedDetails()'),
  section(pageSource, 'function feedResponseItems(', 'function isFeedFixtureAuthorHandle('),
  section(pageSource, 'function feedLocaleToLanguage(', 'function feedNormalizeAssetUrl('),
  section(pageSource, 'async function loadLuminaFeedData(', 'function bindLuminaFeedTabs()'),
  section(pageSource, 'async function executeLuminaFeedSearch(', 'function syncFeedFollowButton('),
].join('\n');

const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ locale = 'en-US', now = 0 } = {}) {
  let clock = now;
  let auth = { accessToken: 'qa-token', user: { id: 'viewer-a' } };
  const calls = [];
  const listeners = new Map();
  const timers = [];
  const roots = Object.fromEntries([
    'feedTrendList', 'feedHashtagList', 'feedTrendStatus',
    'feedHashtagStatus', 'feedTrendLocaleLabel', 'feedSearchInput',
  ].map(id => [id, {
    id, innerHTML: '', textContent: '', value: '', dataset: {}, attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
  }]));
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const document = {
    hidden: false,
    getElementById: id => roots[id] || null,
    addEventListener(name, callback) {
      listeners.set(name, [...(listeners.get(name) || []), callback]);
    },
  };
  const context = {
    document, Date: ClockDate, Intl, _currentLocale: locale,
    getAuth: () => auth,
    isLoggedIn: () => Boolean(auth?.accessToken),
    apiFetch(path, options = {}) {
      const pending = deferred();
      const url = new URL(path, 'https://qa.invalid');
      const kind = url.pathname.endsWith('/trending-searches') ? 'trends'
        : url.pathname.endsWith('/hashtags') ? 'hashtags'
        : url.pathname.endsWith('/search') ? 'search' : 'feed';
      const call = {
        path, url, kind, options, method: options.method || 'GET', settled: false,
        resolve(value) { this.settled = true; pending.resolve(value); },
        reject(error) { this.settled = true; pending.reject(error); },
      };
      calls.push(call);
      return pending.promise;
    },
    window: {
      setInterval(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
      location: { hostname: 'qa.invalid' },
      luminaI18n: {
        t: key => dictionary[key]?.[context._currentLocale] ?? key,
      },
    },
  };
  runInNewContext(`"use strict";\n${runtimeSource}\nthis.qa = {
    init: initLuminaFeedDiscovery,
    search: executeLuminaFeedSearch,
    bindRefresh: bindFeedDiscoveryRefresh,
    inFlight: () => _feedDiscoveryFlight?.promise,
    state: () => ({
      items: _luminaFeedItems, source: _luminaFeedSource,
      searchSeq: _luminaFeedSearchSeq, listSeq: _feedListLoadSeq,
      discoverySeq: _feedDiscoverySeq, lastLocale: _feedDiscoveryLastLocale,
      lastAttemptAt: _feedDiscoveryLastAttemptAt,
    }),
  };`, context);
  return {
    ...context.qa, roots, calls, document, listeners, timers,
    setLocale(value) { context._currentLocale = value; },
    setOwner(id) { auth = id ? { accessToken: `token-${id}`, user: { id } } : null; },
    setTime(value) { clock = value; },
    advance(ms) { clock += ms; },
    dispatch(name) { for (const callback of listeners.get(name) || []) callback({ type: name }); },
    text(key) { return dictionary[key]?.[context._currentLocale] ?? key; },
    checkedAt() {
      const time = new Intl.DateTimeFormat(context._currentLocale, {
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(clock));
      return this.text('feed.discovery.checkedAt').replace('{time}', time);
    },
  };
}

function discoveryCalls(view) {
  return view.calls.filter(call => call.kind === 'trends' || call.kind === 'hashtags');
}

function assertPair(calls, language) {
  assert.equal(calls.length, 2, 'one GET per discovery region');
  assert.deepEqual(calls.map(call => call.kind), ['trends', 'hashtags']);
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.options.throwOnError, true);
    assert.equal(call.url.searchParams.get('language'), language);
    assert.equal(call.url.searchParams.get('window'), call.kind === 'trends' ? '1h' : '24h');
    assert.equal(call.url.searchParams.get('take'), call.kind === 'trends' ? '10' : '12');
  }
  assert.equal(calls[0].url.searchParams.get('type'), 'all');
}

function resolvePair(calls, prefix = 'fresh') {
  assert.equal(calls.length, 2);
  for (const call of calls) call.resolve({ items: [{ keyword: `${prefix}-${call.kind}`, rank: 1 }] });
}

function snapshot(view) {
  return Object.fromEntries(Object.entries(view.roots).map(([id, root]) => [id, {
    html: root.innerHTML, text: root.textContent, state: root.dataset.state,
    busy: root.attributes['aria-busy'],
  }]));
}

function assertReady(view, kind) {
  const root = view.roots[kind === 'trends' ? 'feedTrendList' : 'feedHashtagList'];
  assert.equal(root.dataset.state, 'ready');
  assert.equal(root.attributes['aria-busy'], 'false');
}

function assertError(view, kind) {
  const root = view.roots[kind === 'trends' ? 'feedTrendList' : 'feedHashtagList'];
  const status = view.roots[kind === 'trends' ? 'feedTrendStatus' : 'feedHashtagStatus'];
  assert.equal(root.dataset.state, 'error');
  assert.equal(root.attributes['aria-busy'], 'false');
  assert.ok(root.innerHTML.includes(view.text(`feed.discovery.${kind}Error`)));
  assert.equal(status.textContent, '', 'failed reads must not display a success timestamp');
  assert.doesNotMatch(root.innerHTML, /PRIVATE_BACKEND_DETAIL|Invalid discovery response/);
  assert.doesNotMatch(root.innerHTML, /data-feed-search-keyword=/);
}

test('same full locale shares the exact in-flight promise and one GET pair', async () => {
  const view = fixture({ locale: 'ko-KR' });
  const first = view.init();
  assert.ok(first && typeof first.then === 'function');
  assert.strictEqual(view.init(), first);
  assert.strictEqual(view.init(), first);
  assertPair(view.calls, 'ko');
  assert.equal(view.state().lastAttemptAt, 0, 'epoch zero is a valid attempt timestamp');
  assert.equal(view.roots.feedTrendLocaleLabel.textContent, view.text('feed.discovery.locale'));
  assert.equal(view.roots.feedTrendList.dataset.state, 'loading');
  assert.equal(view.roots.feedTrendList.attributes['aria-busy'], 'true');
  view.bindRefresh();
  assert.equal(view.timers.length, 1);
  assert.equal(view.timers[0].delay, 300_000);
  assert.equal(view.listeners.get('visibilitychange').length, 1);
  assert.equal(view.listeners.get('click').length, 1);
  resolvePair(view.calls);
  await first;
  assertReady(view, 'trends');
  assertReady(view, 'hashtags');
  assert.equal(view.inFlight(), undefined);
  const next = view.init();
  assert.notStrictEqual(next, first);
  assertPair(view.calls.slice(2), 'ko');
  resolvePair(view.calls.slice(2), 'next');
  await next;
});

test('late success, empty response and failure obey full-locale and generation ownership', async () => {
  for (const [oldLocale, newLocale, language] of [
    ['ko-KR', 'en-US', 'en'], ['zh-CN', 'zh-Hant', 'zh'], ['zh-Hant', 'zh-CN', 'zh'],
  ]) {
    for (const outcome of ['rows', 'empty', 'failure']) {
      for (const oldFirst of [false, true]) {
        const view = fixture({ locale: oldLocale });
        const old = view.init();
        const oldCalls = view.calls.slice();
        view.setLocale(newLocale);
        const current = view.init();
        assert.notStrictEqual(current, old, `${oldLocale} -> ${newLocale}`);
        const currentCalls = view.calls.slice(2);
        assertPair(currentCalls, language);
        const settleOld = async () => {
          for (const call of oldCalls) {
            if (outcome === 'failure') call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
            else call.resolve({ items: outcome === 'empty' ? [] : [{ keyword: 'stale-row' }] });
          }
          await old;
        };
        if (oldFirst) {
          const loading = snapshot(view);
          await settleOld();
          assert.deepEqual(snapshot(view), loading);
          assert.strictEqual(view.inFlight(), current, 'old cleanup must retain the newer flight');
          assert.strictEqual(view.init(), current);
        }
        resolvePair(currentCalls, 'latest');
        await current;
        const latest = snapshot(view);
        if (!oldFirst) await settleOld();
        assert.deepEqual(snapshot(view), latest, `${oldLocale}/${newLocale}/${outcome}`);
        assert.equal(view.calls.length, 4, 'stale empty responses must not initiate all-language fallback');
        assert.equal(view.state().lastLocale, newLocale);
        assert.equal(view.roots.feedTrendLocaleLabel.textContent, view.text('feed.discovery.locale'));
        assert.match(view.roots.feedTrendList.innerHTML, /latest-trends/);
        assert.match(view.roots.feedHashtagList.innerHTML, /latest-hashtags/);
      }
    }
  }

  // Returning to the same locale still cannot revive an older generation.
  const view = fixture({ locale: 'ko-KR' });
  const first = view.init();
  view.setLocale('en-US');
  const middle = view.init();
  view.setLocale('ko-KR');
  const last = view.init();
  resolvePair(view.calls.slice(4), 'latest-ko');
  await last;
  const latest = snapshot(view);
  resolvePair(view.calls.slice(0, 2), 'old-ko');
  for (const call of view.calls.slice(2, 4)) call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
  await Promise.all([first, middle]);
  assert.deepEqual(snapshot(view), latest);
  assert.equal(view.calls.length, 6);
});

test('only successful empty language results fall back, with per-region labels and completion times', async () => {
  const view = fixture({ now: Date.UTC(2026, 9, 1, 4, 5) });
  const flight = view.init();
  assertPair(view.calls, 'en');
  view.advance(90_000);
  view.calls[0].resolve({ keywords: [] });
  view.calls[1].resolve({ hashtags: [{ keyword: '#local' }] });
  await flush();
  assert.equal(view.calls.length, 3);
  const fallback = view.calls[2];
  assert.equal(fallback.kind, 'trends');
  assert.equal(fallback.url.searchParams.get('language'), 'all');
  assert.equal(fallback.options.throwOnError, true);
  assert.equal(view.roots.feedTrendList.dataset.state, 'loading');
  assert.equal(view.roots.feedHashtagStatus.textContent, view.checkedAt());
  const localTimestamp = view.roots.feedHashtagStatus.textContent;
  view.advance(60_000);
  fallback.resolve([{ keyword: 'global-result' }]);
  await flight;
  assertReady(view, 'trends');
  assertReady(view, 'hashtags');
  assert.equal(view.roots.feedTrendStatus.textContent,
    `${view.text('feed.discovery.allLanguages')} \u00b7 ${view.checkedAt()}`);
  assert.equal(view.roots.feedHashtagStatus.textContent, localTimestamp);
  assert.notEqual(localTimestamp, view.checkedAt(), 'timestamps describe each completed region');

  const next = view.init();
  view.calls[3].resolve([{ keyword: 'local-trend' }]);
  view.calls[4].resolve([]);
  await flush();
  assert.equal(view.calls.length, 6);
  assert.equal(view.calls[5].kind, 'hashtags');
  assert.equal(view.calls[5].url.searchParams.get('language'), 'all');
  view.calls[5].resolve({ hashtags: [] });
  await next;
  assert.equal(view.roots.feedTrendStatus.textContent, view.checkedAt(), 'old fallback label is cleared');
  assert.equal(view.roots.feedHashtagStatus.textContent,
    `${view.text('feed.discovery.allLanguages')} \u00b7 ${view.checkedAt()}`);
  assert.ok(view.roots.feedHashtagList.innerHTML.includes(view.text('feed.discovery.hashtagsEmpty')));
  assertReady(view, 'hashtags');

  const all = fixture({ locale: 'fr-FR' });
  const allFlight = all.init();
  assertPair(all.calls, 'all');
  all.calls.forEach(call => call.resolve([]));
  await allFlight;
  assert.equal(all.calls.length, 2, 'language=all must not fall back to itself');
  assertReady(all, 'trends');
  assertReady(all, 'hashtags');
});

test('rejection, null and malformed language/fallback payloads display generic errors without extra fallback', async () => {
  const invalid = [
    ['reject', null], ['null', null], ['undefined', undefined], ['missing', {}],
    ['non-array items', { items: 'PRIVATE_BACKEND_DETAIL' }],
    ['non-array alternate', { keywords: {}, hashtags: 'PRIVATE_BACKEND_DETAIL' }],
  ];
  for (const fallbackPhase of [false, true]) {
    for (const [name, payload] of invalid) {
      const view = fixture();
      const flight = view.init();
      if (fallbackPhase) {
        view.calls.forEach(call => call.resolve({ items: [] }));
        await flush();
        assertPair(view.calls.slice(2), 'all');
      }
      const failingCalls = view.calls.slice(fallbackPhase ? 2 : 0);
      for (const call of failingCalls) {
        if (name === 'reject') call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
        else call.resolve(payload);
      }
      await flight;
      assert.equal(view.calls.length, fallbackPhase ? 4 : 2, name);
      assertError(view, 'trends');
      assertError(view, 'hashtags');
      assert.equal(view.inFlight(), undefined);
    }
  }
});

test('actual five-minute timer and visibility listener honor freshness, hidden state and locale changes', async () => {
  const view = fixture();
  const initial = view.init();
  resolvePair(view.calls);
  await initial;
  assert.equal(view.timers.length, 1);
  assert.equal(view.timers[0].delay, 300_000);
  assert.equal(view.listeners.get('visibilitychange').length, 1);
  const tick = () => view.timers[0].callback();
  view.setTime(299_999);
  tick();
  view.dispatch('visibilitychange');
  assert.equal(view.calls.length, 2, 'fresh results need no GET');
  view.setTime(300_000);
  view.document.hidden = true;
  tick();
  view.dispatch('visibilitychange');
  assert.equal(view.calls.length, 2, 'hidden timer and hidden visibility events need no GET');
  assert.equal(view.state().lastAttemptAt, 0, 'hidden events cannot consume the refresh interval');
  view.document.hidden = false;
  view.dispatch('visibilitychange');
  const visibleFlight = view.inFlight();
  assert.ok(visibleFlight);
  assertPair(view.calls.slice(2), 'en');
  tick();
  view.dispatch('visibilitychange');
  assert.strictEqual(view.inFlight(), visibleFlight);
  assert.equal(view.calls.length, 4, 'timer/visibility overlap shares the flight');
  resolvePair(view.calls.slice(2));
  await visibleFlight;
  view.advance(299_999);
  tick();
  view.dispatch('visibilitychange');
  assert.equal(view.calls.length, 4);
  view.advance(1);
  tick();
  const timedFlight = view.inFlight();
  assert.ok(timedFlight, 'the exact five-minute boundary is due');
  assertPair(view.calls.slice(4), 'en');
  resolvePair(view.calls.slice(4));
  await timedFlight;
  view.setLocale('zh-Hant');
  view.document.hidden = true;
  tick();
  view.dispatch('visibilitychange');
  assert.equal(view.calls.length, 6);
  view.document.hidden = false;
  view.dispatch('visibilitychange');
  const localeFlight = view.inFlight();
  assertPair(view.calls.slice(6), 'zh');
  resolvePair(view.calls.slice(6));
  await localeFlight;
  assert.equal(view.state().lastLocale, 'zh-Hant');
});

test('successful search refresh has a sixty-second floor and preserves search sequence and viewer ownership', async () => {
  const view = fixture();
  const initial = view.init();
  resolvePair(view.calls);
  await initial;
  const startSearch = query => {
    const promise = view.search(query);
    const call = view.calls.at(-1);
    assert.equal(call.kind, 'search');
    assert.equal(call.method, 'GET');
    assert.equal(call.options.throwOnError, true);
    assert.equal(call.options.auth, true);
    return { promise, call };
  };
  view.setTime(59_999);
  const early = startSearch('  #early  ');
  assert.equal(early.call.url.searchParams.get('q'), '#early');
  assert.equal(early.call.url.searchParams.get('type'), 'hashtag');
  assert.equal(early.call.url.searchParams.get('language'), 'en');
  early.call.resolve({ items: [{ id: 'early', body: 'early' }] });
  await early.promise;
  assert.equal(discoveryCalls(view).length, 2);
  view.setTime(60_000);
  const due = startSearch('due');
  due.call.resolve({ posts: [{ id: 'due', body: 'due' }] });
  await due.promise;
  assert.equal(discoveryCalls(view).length, 4, 'the exact sixty-second boundary refreshes');
  const refreshed = view.inFlight();
  const seq = view.state().searchSeq;
  const listSeq = view.state().listSeq;
  resolvePair(discoveryCalls(view).slice(2));
  await refreshed;
  assert.equal(view.state().searchSeq, seq, 'discovery must not invalidate the search owner');
  assert.equal(view.state().listSeq, listSeq);
  assert.equal(view.state().items[0].body, 'due');
  view.setTime(119_999);
  const again = startSearch('again');
  again.call.resolve([]);
  await again.promise;
  assert.equal(discoveryCalls(view).length, 4, 'the gap starts at the last discovery attempt');
  view.setTime(120_000);
  const failed = startSearch('failed');
  failed.call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
  await failed.promise;
  assert.equal(view.state().source, 'error');
  assert.equal(discoveryCalls(view).length, 4, 'failed searches cannot refresh discovery');

  const old = startSearch('old');
  const latest = startSearch('latest');
  latest.call.resolve({ items: [{ id: 'latest', body: 'latest' }] });
  await latest.promise;
  const latestFlight = view.inFlight();
  assert.equal(discoveryCalls(view).length, 6);
  const latestSeq = view.state().searchSeq;
  resolvePair(discoveryCalls(view).slice(4));
  await latestFlight;
  old.call.resolve({ items: [{ id: 'stale', body: 'stale' }] });
  await old.promise;
  assert.equal(view.state().items[0].body, 'latest');
  assert.equal(view.state().searchSeq, latestSeq);
  assert.equal(discoveryCalls(view).length, 6);
  const oldFailure = startSearch('old-failure');
  const winner = startSearch('winner');
  winner.call.resolve({ items: [{ id: 'winner', body: 'winner' }] });
  await winner.promise;
  oldFailure.call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
  await oldFailure.promise;
  assert.equal(view.state().source, 'search');
  assert.equal(view.state().items[0].body, 'winner');

  view.setTime(180_000);
  for (const outcome of ['success', 'failure']) {
    view.setOwner('viewer-a');
    const previousOwner = startSearch(`previous-${outcome}`);
    view.setOwner('viewer-b');
    if (outcome === 'success') previousOwner.call.resolve([{ id: 'wrong-owner', body: 'wrong-owner' }]);
    else previousOwner.call.reject(new Error('PRIVATE_BACKEND_DETAIL'));
    await previousOwner.promise;
    assert.equal(view.state().source, 'search');
    assert.equal(view.state().items[0].body, 'winner');
    assert.equal(discoveryCalls(view).length, 6, 'stale viewer searches must not refresh');
  }
  view.document.hidden = true;
  const hidden = startSearch('hidden-success');
  hidden.call.resolve([{ id: 'hidden', body: 'hidden-current' }]);
  await hidden.promise;
  assert.equal(view.state().items[0].body, 'hidden-current');
  assert.equal(discoveryCalls(view).length, 6, 'successful hidden search still cannot GET discovery');
});

test('a failed region cannot block the other region from succeeding independently', async () => {
  for (const failedKind of ['trends', 'hashtags']) {
    for (const failFallback of [false, true]) {
      const view = fixture();
      const flight = view.init();
      let complete = false;
      flight.then(() => { complete = true; });
      const failure = view.calls.find(call => call.kind === failedKind);
      const success = view.calls.find(call => call.kind !== failedKind);
      if (failFallback) {
        failure.resolve({ items: [] });
        await flush();
        assert.equal(view.calls.at(-1).kind, failedKind);
        assert.equal(view.calls.at(-1).url.searchParams.get('language'), 'all');
        view.calls.at(-1).reject(new Error('PRIVATE_BACKEND_DETAIL'));
      } else failure.reject(new Error('PRIVATE_BACKEND_DETAIL'));
      await flush();
      assertError(view, failedKind);
      assert.equal(complete, false, 'the sibling request is still pending');
      const sibling = view.roots[success.kind === 'trends' ? 'feedTrendList' : 'feedHashtagList'];
      assert.equal(sibling.dataset.state, 'loading');
      success.resolve({ items: [{ keyword: 'independent-success' }] });
      await flight;
      assert.equal(complete, true);
      assertError(view, failedKind);
      assertReady(view, success.kind);
      assert.match(sibling.innerHTML, /independent-success/);
      assert.equal(view.calls.length, failFallback ? 3 : 2);
    }
  }
});

test('ranked discovery escapes keyword text and attributes and never interpolates raw rank/count markup', async () => {
  const view = fixture();
  const flight = view.init();
  const keyword = `<img src=x onerror="attack()">&"'`;
  const escaped = '&lt;img src=x onerror=&quot;attack()&quot;&gt;&amp;&quot;&#039;';
  view.calls[0].resolve({ keywords: [
    { keyword, rank: '7', searchCount: 1234 },
    { normalizedKeyword: `" onclick="attack()`, rank: '"><script>attack()</script>', postCount: '<svg onload=attack()>' },
    { keyword: 'zero-count', postCount: 0 },
  ] });
  view.calls[1].resolve({ hashtags: [{ keyword: '#<&"\'', rank: 2, postCount: 10 }] });
  await flight;
  const html = view.roots.feedTrendList.innerHTML;
  assert.equal(html.split(escaped).length - 1, 2, 'keyword is escaped in both text and attribute');
  assert.ok(html.includes(`data-feed-search-keyword="${escaped}"`));
  assert.ok(html.includes(`<span class="feed-trend-keyword">${escaped}</span>`));
  assert.match(html, /<span class="feed-trend-rank">7<\/span>/);
  assert.match(html, /<span class="feed-trend-rank">2<\/span>/);
  assert.ok(html.includes(`<small>${Number(1234).toLocaleString('en-US')}</small>`));
  assert.match(html, /<small>0<\/small>/);
  assert.equal((html.match(/<small>/g) || []).length, 2, 'non-numeric counts are omitted');
  assert.ok(html.includes('data-feed-search-keyword="&quot; onclick=&quot;attack()"'));
  assert.doesNotMatch(html, /<img|<script|<svg|data-feed-search-keyword="" onclick=/);
  assert.ok(view.roots.feedHashtagList.innerHTML.includes('#&lt;&amp;&quot;&#039;'));
  assertReady(view, 'trends');
  assertReady(view, 'hashtags');
});

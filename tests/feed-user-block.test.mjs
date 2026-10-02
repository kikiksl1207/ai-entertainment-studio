import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/lumina-feed.js', import.meta.url), 'utf8');
const self = '11111111-1111-4111-8111-111111111111';
const target = '22222222-2222-4222-8222-222222222222';

function section(start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0, start);
  const finish = source.indexOf(end, offset);
  assert.ok(finish > offset, end);
  return source.slice(offset, finish);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function button(attributes = {}) {
  const attrs = { 'data-feed-block-user-id': target, 'data-feed-block-name': 'Test fan', ...attributes };
  return {
    disabled: false,
    getAttribute: key => attrs[key] ?? null,
    setAttribute: (key, value) => { attrs[key] = value; },
    removeAttribute: key => { delete attrs[key]; },
    attrs,
  };
}

function harness() {
  const state = { auth: { accessToken: 'test-only', user: { id: self, publicHandle: 'self' } }, requests: [], alerts: [], rendered: 0, closed: 0 };
  const context = {
    _luminaFeedScope: 'all', _luminaFeedSource: 'me_all', _luminaFeedItems: [{ id: 'old-post' }],
    _luminaFeedQuery: '', _luminaFeedSearchTimer: null, _luminaFeedSearchSeq: 0,
    _feedListLoadSeq: 0, _feedDetailLoadSeq: 0, _feedBlockPending: false, _feedBlockWriteOwner: '',
    luminaFeedSamplePosts: [{ id: 'sample' }], enrichSampleFeedAuthor: value => value,
    normalizeFeedPost: value => value,
    getAuth: () => state.auth,
    isLoggedIn: () => !!state.auth?.accessToken,
    clearTimeout,
    encodeURIComponent,
    console: { info() {}, warn() {} },
    feedT: key => key,
    feedText: (key, values) => `${key}:${values.name}`,
    feedLocaleToLanguage: () => 'ko',
    feedEscapeHtml: value => String(value).replace(/[<>&"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]),
    renderLuminaFeed: () => { state.rendered++; },
    openAuthModal: () => { state.loginRequested = true; },
    window: {
      confirm: () => true,
      alert: message => state.alerts.push(message),
      location: { pathname: '/lumina-feed', search: '', hostname: 'feed.test' },
      closeFeedPostDetail: () => { state.closed++; },
    },
    apiFetch: async (path, options) => {
      state.requests.push({ path, options });
      if (options?.method === 'POST') return { block: { status: 'active', user: { id: target, publicHandle: 'target' } } };
      return { items: [] };
    },
  };
  runInNewContext([
    section('function feedViewerKey()', 'function isFeedFixtureAuthorHandle('),
    section('async function loadLuminaFeedData(', 'function renderLuminaFeed()'),
    section('async function executeLuminaFeedSearch(', 'function bindFeedDiscoveryClicks()'),
  ].join('\n'), context);
  return { state, context };
}

test('block write phase prevents new list/search requests, including after an unknown outcome', async () => {
  const { context, state } = harness();
  const pending = deferred();
  context.apiFetch = async (path, options) => {
    state.requests.push({ path, options });
    return pending.promise;
  };
  const block = context.submitFeedUserBlock(button());
  await context.loadLuminaFeedData();
  await context.executeLuminaFeedSearch('target');
  assert.equal(state.requests.length, 1);
  assert.equal(context.feedReadsBlockedForViewer(), true);
  pending.resolve({ block: { status: 'invalid' } });
  await block;
  assert.equal(context.feedReadsBlockedForViewer(), false);
  assert.equal(context._luminaFeedItems.length, 0);
  assert.equal(context._luminaFeedSource, 'error');
  assert.equal(state.alerts.at(-1), 'feed.block.error');
});

test('block routes prefer UUID and keep handle-only routing distinct', () => {
  const { context } = harness();
  assert.equal(context.feedBlockTarget(button({ 'data-feed-block-handle': 'target' })).endpoint, `/api/v1/users/${target}/block`);
  assert.equal(context.feedBlockTarget(button({ 'data-feed-block-user-id': '', 'data-feed-block-handle': 'fan name/target' })).endpoint,
    '/api/v1/users/handle/fan%20name%2Ftarget/block');
  assert.equal(context.feedBlockTarget(button({ 'data-feed-block-user-id': 'not-a-uuid', 'data-feed-block-handle': 'target' })), null);
  assert.equal(context.feedBlockTarget(button({ 'data-feed-block-user-id': '', 'data-feed-block-handle': 'x'.repeat(81) })), null);
});

test('list/detail share escaped block attributes and hide the self action', () => {
  const { context } = harness();
  const post = { authorUserId: target, authorPublicHandle: 'target' };
  assert.equal(context.buildFeedBlockButton(post, 'Self', true), '');
  const html = context.buildFeedBlockButton(post, '"><img src=x>', false);
  assert.match(html, /data-feed-block-user-id="22222222/);
  assert.match(html, /data-feed-block-handle="target"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /data-i18n="feed.block.label"/);
});

for (const mode of ['guest', 'preview', 'self', 'self-handle', 'cancel', 'invalid']) {
  test(`${mode} cannot send a block mutation`, async () => {
    const { state, context } = harness();
    let input = button();
    if (mode === 'guest') state.auth = null;
    if (mode === 'preview') context._luminaFeedSource = 'preview_fixture';
    if (mode === 'self') input = button({ 'data-feed-block-user-id': self.toUpperCase() });
    if (mode === 'self-handle') input = button({ 'data-feed-block-user-id': '', 'data-feed-block-handle': 'self' });
    if (mode === 'cancel') context.window.confirm = () => false;
    if (mode === 'invalid') input = button({ 'data-feed-block-user-id': 'invalid' });
    await context.submitFeedUserBlock(input);
    assert.equal(state.requests.length, 0);
    assert.equal(context._luminaFeedItems.length, 1);
    if (mode === 'guest') assert.equal(state.loginRequested, true);
  });
}

test('confirmed block uses the authenticated API and an authenticated empty reload', async () => {
  const { state, context } = harness();
  const input = button();
  await context.submitFeedUserBlock(input);
  assert.equal(state.requests.length, 2);
  assert.equal(state.requests[0].path, `/api/v1/users/${target}/block`);
  assert.equal(state.requests[0].options.method, 'POST');
  assert.equal(state.requests[0].options.auth, true);
  assert.equal(state.requests[0].options.throwOnError, true);
  assert.equal(state.requests[1].path, '/api/v1/me/lumina-feed?mode=all&take=30');
  assert.equal(context._luminaFeedItems.length, 0);
  assert.equal(context._luminaFeedSource, 'me_all');
  assert.equal(state.closed, 2);
  assert.equal(state.alerts.at(-1), 'feed.block.success');
  assert.equal(input.disabled, false);
  assert.equal(input.attrs['aria-busy'], undefined);
});

test('block succeeds through the handle-only route', async () => {
  const { state, context } = harness();
  await context.submitFeedUserBlock(button({ 'data-feed-block-user-id': '', 'data-feed-block-handle': 'target' }));
  assert.equal(state.requests[0].path, '/api/v1/users/handle/target/block');
  assert.equal(state.alerts.at(-1), 'feed.block.success');
});

for (const status of [401, 403, 429, 503]) {
  test(`block HTTP ${status} clears old content without claiming success or leaking detail`, async () => {
    const { state, context } = harness();
    context.apiFetch = async () => { throw Object.assign(new Error('private detail'), { status }); };
    const input = button();
    await context.submitFeedUserBlock(input);
    assert.equal(context._feedBlockPending, false);
    assert.equal(input.disabled, false);
    assert.equal(context._luminaFeedItems.length, 0);
    assert.equal(context._luminaFeedSource, 'error');
    assert.doesNotMatch(state.alerts.join(' '), /success|private detail/);
    assert.equal(state.alerts.at(-1), status === 401 ? 'feed.block.expired' : status === 429 ? 'feed.block.rateLimited' : 'feed.block.error');
  });
}

for (const response of [{}, { block: { status: 'active', user: { id: self } } }, { block: { status: 'deleted', user: { id: target } } }]) {
  test('invalid block response cannot confirm or restore old content', async () => {
    const { state, context } = harness();
    context.apiFetch = async () => response;
    await context.submitFeedUserBlock(button());
    assert.equal(state.alerts.at(-1), 'feed.block.error');
    assert.equal(context._luminaFeedItems.length, 0);
    assert.equal(context._feedBlockPending, false);
  });
}

test('rapid duplicate clicks create one mutation', async () => {
  const { state, context } = harness();
  const pending = deferred();
  const original = context.apiFetch;
  context.apiFetch = async (path, options) => options?.method === 'POST' ? pending.promise : original(path, options);
  const first = context.submitFeedUserBlock(button());
  let requested = 0;
  const fetch = context.apiFetch;
  context.apiFetch = (...args) => { requested++; return fetch(...args); };
  await context.submitFeedUserBlock(button());
  assert.equal(requested, 0);
  pending.resolve({ block: { status: 'active', user: { id: target } } });
  await first;
  assert.equal(state.alerts.at(-1), 'feed.block.success');
});

test('account change during confirmation cannot mutate the new account', async () => {
  const { state, context } = harness();
  context.window.confirm = () => { state.auth = { accessToken: 'new', user: { id: target } }; return true; };
  await context.submitFeedUserBlock(button());
  assert.equal(state.requests.length, 0);
});

test('a delayed block response after account change cannot replace new account data', async () => {
  const { state, context } = harness();
  const pending = deferred();
  context.apiFetch = async () => pending.promise;
  const action = context.submitFeedUserBlock(button());
  state.auth = { accessToken: 'new', user: { id: target } };
  context._luminaFeedItems = [{ id: 'new-account-post' }];
  pending.resolve({ block: { status: 'active', user: { id: target } } });
  await action;
  assert.equal(context._luminaFeedItems[0].id, 'new-account-post');
  assert.equal(state.alerts.length, 0);
});

test('authenticated empty and failed lists cannot fall back to public or sample content', async () => {
  const { state, context } = harness();
  await context.loadLuminaFeedData();
  assert.equal(state.requests.length, 1);
  assert.equal(context._luminaFeedSource, 'me_all');
  assert.equal(context._luminaFeedItems.length, 0);
  context.window.location.hostname = 'localhost';
  context.apiFetch = async (path) => { state.requests.push({ path }); throw new Error('private failure'); };
  await context.loadLuminaFeedData();
  assert.equal(state.requests.length, 2);
  assert.ok(state.requests.every(item => item.path.startsWith('/api/v1/me/')));
  assert.equal(context._luminaFeedSource, 'error');
  assert.equal(context._luminaFeedItems.length, 0);
});

test('an actual empty public list stays empty even on localhost', async () => {
  const { state, context } = harness();
  state.auth = null;
  context.window.location.hostname = 'localhost';
  await context.loadLuminaFeedData();
  assert.equal(context._luminaFeedSource, 'operations');
  assert.equal(context._luminaFeedItems.length, 0);
});

test('older list responses and responses from the previous account are discarded', async () => {
  const { state, context } = harness();
  const first = deferred();
  const second = deferred();
  let calls = 0;
  context.apiFetch = () => ++calls === 1 ? first.promise : second.promise;
  const old = context.loadLuminaFeedData();
  const latest = context.loadLuminaFeedData();
  second.resolve({ items: [{ id: 'latest' }] });
  await latest;
  first.resolve({ items: [{ id: 'old' }] });
  await old;
  assert.equal(context._luminaFeedItems[0].id, 'latest');
  const delayed = deferred();
  context.apiFetch = () => delayed.promise;
  const previous = context.loadLuminaFeedData();
  state.auth = null;
  delayed.resolve({ items: [{ id: 'private-previous-account' }] });
  await previous;
  assert.equal(context._luminaFeedItems[0].id, 'latest');
});

test('a search response started before blocking cannot resurrect hidden posts', async () => {
  const { state, context } = harness();
  const pending = deferred();
  const original = context.apiFetch;
  context.apiFetch = (path, options) => path.includes('/search?') ? pending.promise : original(path, options);
  const oldSearch = context.executeLuminaFeedSearch('old');
  await context.submitFeedUserBlock(button());
  pending.resolve({ items: [{ id: 'blocked-old-search' }] });
  await oldSearch;
  assert.equal(context._luminaFeedItems.length, 0);
  assert.equal(state.alerts.at(-1), 'feed.block.success');
});

test('failed authenticated reload distinguishes a saved block from feed failure', async () => {
  const { state, context } = harness();
  const original = context.apiFetch;
  context.apiFetch = (path, options) => options?.method === 'POST' ? original(path, options) : Promise.reject(new Error('offline'));
  await context.submitFeedUserBlock(button());
  assert.equal(state.alerts.at(-1), 'feed.block.refreshError');
  assert.equal(context._luminaFeedSource, 'error');
  assert.equal(context._luminaFeedItems.length, 0);
});

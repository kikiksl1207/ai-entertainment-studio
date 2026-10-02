import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) { return app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  const state = { auth: { accessToken: 'a', user: { id: 'a' } }, blocked: false, panels: [] };
  const context = {
    _luminaFeedItems: [{ id: 'post', body: 'cached' }], _feedThreadModalEl: null, _feedCommentModalEl: null, _feedCommentLoadSeq: 0,
    getAuth: () => state.auth, isLoggedIn: () => !!state.auth,
    window: { feedReadsBlockedForViewer: () => state.blocked },
    console: { warn() {} }, normalizeFeedPost: value => value,
    renderFeedThreadModalContent: post => post.body,
    renderFeedCommentItems: items => items.map(item => item.body).join(','),
    showFeedThreadModalShell() {
      const panel = { innerHTML: 'loading' };
      state.panels.push(panel);
      context._feedThreadModalEl = { querySelector: () => panel };
    },
  };
  runInNewContext([
    section('function feedModalViewerKey()', 'function closeFeedThreadModal()'),
    section('async function openFeedThreadModal(', 'function bindLuminaFeedThreadBadge()'),
    section('async function loadFeedComments(', 'function bindLuminaFeedComment()'),
  ].join('\n'), context);
  return { state, context };
}

for (const mode of ['account-change', 'modal-replaced', 'block-started']) {
  test(`thread read cannot update cache or modal after ${mode}`, async () => {
    const { state, context } = harness();
    const pending = deferred();
    context.apiFetch = () => pending.promise;
    const request = context.openFeedThreadModal('post');
    if (mode === 'account-change') state.auth = { accessToken: 'b', user: { id: 'b' } };
    if (mode === 'modal-replaced') context.showFeedThreadModalShell();
    if (mode === 'block-started') state.blocked = true;
    pending.resolve({ post: { id: 'post', body: 'old server body' } });
    await request;
    assert.equal(context._luminaFeedItems[0].body, 'cached');
    assert.equal(state.panels.every(panel => panel.innerHTML === 'loading'), true);
  });
}

test('comment responses belong to their current viewer, instance and request order', async () => {
  const { state, context } = harness();
  const old = deferred();
  const latest = deferred();
  const list = { innerHTML: '' };
  context._feedCommentModalEl = { querySelector: selector => selector === '[data-feed-comment-form]' ? { dataset: { postId: 'post' } } : list };
  let calls = 0;
  context.apiFetch = () => ++calls === 1 ? old.promise : latest.promise;
  const first = context.loadFeedComments('post');
  const second = context.loadFeedComments('post');
  latest.resolve({ items: [{ body: 'latest' }] });
  await second;
  old.resolve({ items: [{ body: 'stale' }] });
  await first;
  assert.equal(list.innerHTML, 'latest');
  const changed = deferred();
  context.apiFetch = () => changed.promise;
  const third = context.loadFeedComments('post');
  state.auth = { accessToken: 'b', user: { id: 'b' } };
  changed.resolve({ items: [{ body: 'previous viewer' }] });
  await third;
  assert.equal(list.innerHTML, 'latest');
});

test('thread and comments do not fetch while a block is being saved', async () => {
  const { state, context } = harness();
  state.blocked = true;
  context.apiFetch = () => { throw new Error('must not fetch'); };
  await context.openFeedThreadModal('post');
  await context.loadFeedComments('post');
  assert.equal(state.panels.length, 0);
});

test('a comments read cannot use a modal belonging to another post', async () => {
  const { context } = harness();
  context._feedCommentModalEl = { querySelector: () => ({ dataset: { postId: 'another-post' } }) };
  context.apiFetch = () => { throw new Error('must not fetch'); };
  await context.loadFeedComments('post');
});

test('a late comment submission cannot update another modal or account', async () => {
  for (const mode of ['modal-replaced', 'account-change']) {
    const { state, context } = harness();
    const handlers = {};
    context.document = { addEventListener: (name, handler) => { handlers[name] = handler; } };
    context.getAccessToken = () => state.auth?.accessToken;
    context.renderLuminaFeed = () => { state.rendered = true; };
    runInNewContext(section('function bindLuminaFeedComment()', '/* 라이트박스'), context);
    context.bindLuminaFeedComment();
    const textarea = { value: 'new comment' };
    const submit = { disabled: false };
    const form = {
      dataset: { postId: 'post' }, closest() { return this; },
      querySelector: selector => selector === 'textarea' ? textarea : selector === "button[type='submit']" ? submit : null,
    };
    context._feedCommentModalEl = { querySelector: () => form };
    const pending = deferred();
    let calls = 0;
    context.apiFetch = () => { calls++; return pending.promise; };
    const request = handlers.submit({ target: form, preventDefault() {} });
    if (mode === 'modal-replaced') context._feedCommentModalEl = { querySelector: () => ({ dataset: { postId: 'other-post' } }) };
    else state.auth = { accessToken: 'b', user: { id: 'b' } };
    pending.resolve({ post: { replyCount: 99 } });
    await request;
    assert.equal(calls, 1);
    assert.equal(textarea.value, 'new comment');
    assert.equal(state.rendered, undefined);
    assert.equal(context._luminaFeedItems[0].replyCount, undefined);
  }
});

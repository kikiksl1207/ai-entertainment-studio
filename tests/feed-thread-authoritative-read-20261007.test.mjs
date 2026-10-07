import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const file = process.env.QA_FEED_APP_SOURCE || new URL('../app.js', import.meta.url);
const app = readFileSync(file, 'utf8');
function section(start, end) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return app.slice(from, to);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness() {
  const state = { auth: { accessToken: 'synthetic', user: { id: 'viewer' } }, blocked: false, nodes: [], calls: [] };
  const document = {
    addEventListener() {}, removeEventListener() {},
    body: { style: {}, appendChild(node) { state.nodes.push(node); } },
    createElement() {
      const panel = { innerHTML: '' };
      return {
        setAttribute() {}, remove() { this.removed = true; },
        set innerHTML(value) {
          panel.innerHTML = value.slice(value.indexOf('<section'), value.lastIndexOf('</section>'));
        },
        querySelector() { return panel; },
      };
    },
  };
  const context = {
    document, getAuth: () => state.auth, isLoggedIn: () => !!state.auth,
    window: { feedReadsBlockedForViewer: () => state.blocked }, console: { warn() {} },
    _luminaFeedItems: [{ id: 'post', body: 'cached-unverified-root', authorName: 'cached-author',
      thread: { items: [{ body: 'cached-unverified-child', position: 1 }] }, assets: ['cached-asset'] }],
  };
  runInNewContext([
    section('function feedEscapeHtml(', '/* #137 Phase B'),
    'let _feedThreadModalEl = null;',
    section('function feedModalViewerKey()', 'function bindLuminaFeedThreadBadge()'),
    'globalThis.inspectModal = () => _feedThreadModalEl;',
  ].join('\n'), context);
  const pending = deferred();
  context.apiFetch = (url, options) => { state.calls.push({ url, options }); return pending.promise; };
  return { state, context, pending, panel: () => context.inspectModal()?.querySelector()?.innerHTML || '' };
}

test('T01 pending and rejected reads never show cached content', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  const pendingSafe = !h.panel().includes('cached-');
  h.pending.reject({ status: 404 });
  await request;
  assert.equal(pendingSafe, true);
  assert.equal(h.panel().includes('cached-'), false);
  assert.match(h.panel(), /data-feed-thread-close/);
  assert.equal(h.state.calls.length, 1);
  assert.equal(h.state.calls[0].options.method, undefined);
});

test('T02 a new projection cannot inherit a removed cached thread or assets', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.pending.resolve({ post: { id: 'post', authorName: 'current-author', body: 'current-root' } });
  await request;
  assert.equal(h.panel().includes('cached-'), false);
  assert.match(h.panel(), /current-root/);
  assert.equal(h.context._luminaFeedItems[0].thread, null);
  assert.equal(h.context._luminaFeedItems[0].assets.length, 0);
});

test('T03 current thread is normalized, sorted and escaped', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.pending.resolve({ data: { post: { id: 'post', authorName: '<img>', thread: { items: [
    { position: 2, body: '<script>unsafe()</script>' }, { position: 1, body: 'current-first' },
  ] } } } });
  await request;
  assert.ok(h.panel().indexOf('current-first') < h.panel().indexOf('&lt;script&gt;'));
  assert.equal(h.panel().includes('<script>'), false);
  assert.match(h.panel(), /&lt;img&gt;/);
});

test('T04 a mismatched response cannot replace cached data or display content', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.pending.resolve({ post: { id: 'other-post', body: 'unrelated-response' } });
  await request;
  assert.equal(h.panel().includes('unrelated-response'), false);
  assert.equal(h.context._luminaFeedItems[0].body, 'cached-unverified-root');
});

test('T05 closing a pending read cannot resurrect the dialog or cache response', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.context.closeFeedThreadModal();
  h.pending.resolve({ id: 'post', body: 'late-response' });
  await request;
  assert.equal(h.context.inspectModal(), null);
  assert.equal(h.context._luminaFeedItems[0].body, 'cached-unverified-root');
  assert.equal(h.state.nodes[0].removed, true);
});

test('T06 a changed viewer leaves the pending shell free of the prior cached body', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.state.auth = null;
  h.pending.resolve({ id: 'post', body: 'prior-viewer-response' });
  await request;
  assert.equal(h.panel().includes('cached-'), false);
  assert.equal(h.panel().includes('prior-viewer-response'), false);
});

test('T07 network failure does not make stale content a fallback', async () => {
  const h = harness();
  const request = h.context.openFeedThreadModal('post');
  h.pending.reject(new TypeError('synthetic-network-failure'));
  await request;
  assert.equal(h.panel().includes('cached-'), false);
  assert.match(h.panel(), /data-feed-thread-close/);
  assert.equal(h.state.calls.length, 1);
});

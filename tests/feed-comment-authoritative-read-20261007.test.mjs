import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const app = readFileSync(process.env.QA_FEED_APP_SOURCE || new URL('../app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = app.indexOf(start), to = app.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return app.slice(from, to);
}
const tick = async () => { for (let n = 0; n < 6; n++) await Promise.resolve(); };
function harness() {
  const state = { auth: { accessToken: 'synthetic', user: { id: 'viewer' } }, blocked: false,
    nodes: [], requests: [], handlers: {}, focus: 0, timers: [] };
  const cached = { id: 'post', body: 'cached-unverified-parent', authorName: 'cached-author',
    thread: { items: [{ body: 'cached-child' }] } };
  const document = {
    addEventListener(name, handler) { state.handlers[name] = handler; },
    body: { style: {}, appendChild(node) { state.nodes.push(node); } },
    createElement() {
      const textarea = { value: '', disabled: false, addEventListener() {}, focus() { state.focus++; } };
      const button = { disabled: false }, message = { hidden: true, textContent: '' };
      const form = { dataset: {}, closest() { return this; }, querySelector(selector) {
        return selector === 'textarea' ? textarea : selector === "button[type='submit']" ? button : message;
      } };
      const parent = { innerHTML: '' }, list = { innerHTML: '' }, counter = { dataset: {} };
      const modal = {
        setAttribute() {}, remove() { this.removed = true; },
        set innerHTML(value) {
          parent.innerHTML = value.split('<div class="feed-comment-post">')[1]?.split('</div>')[0] || '';
          textarea.disabled = /<textarea[^>]*\bdisabled\b/.test(value);
          button.disabled = /<button[^>]*type="submit"[^>]*\bdisabled\b/.test(value);
        },
        querySelector(selector) {
          return selector === '[data-feed-comment-form]' ? form : selector === 'textarea' ? textarea
            : selector === '.feed-comment-post' ? parent : selector === '[data-feed-comment-list]' ? list
              : selector === '.feed-comment-counter' ? counter : null;
        },
        parts: { parent, list, textarea, button, form },
      };
      return modal;
    },
  };
  const context = {
    document, setTimeout: fn => state.timers.push(fn), getAuth: () => state.auth,
    isLoggedIn: () => !!state.auth, getAccessToken: () => state.auth?.accessToken,
    window: { feedReadsBlockedForViewer: () => state.blocked }, console: { warn() {} },
    _luminaFeedItems: [cached],
    apiFetch(url, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      state.requests.push({ url, options, resolve, reject });
      return promise;
    },
  };
  runInNewContext([
    section('function feedEscapeHtml(', '/* #137 Phase B'),
    section('function feedModalViewerKey()', 'function closeFeedThreadModal()'),
    section('let _feedCommentModalEl = null;', '/* 라이트박스'),
    'globalThis.inspectModal = () => _feedCommentModalEl;',
  ].join('\n'), context);
  context.bindLuminaFeedComment();
  return { state, context, cached, modal: () => context.inspectModal(),
    submit: () => state.handlers.submit({ target: context.inspectModal().parts.form, preventDefault() {} }) };
}
async function ready(h) {
  const request = h.context.openFeedCommentModal(h.cached);
  h.state.requests[0].resolve({ post: { id: 'post', body: 'current-parent', authorName: 'current-author' } });
  await tick();
  assert.equal(h.state.requests.length, 2);
  h.state.requests[1].resolve({ items: [{ body: 'current-reply', authorName: 'reply-author' }] });
  await request;
  return request;
}

test('C01 pending and refused parent never displays cached text or allows writing', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached), modal = h.modal();
  const safeInitial = !modal.parts.parent.innerHTML.includes('cached-') && modal.parts.button.disabled && modal.parts.textarea.disabled;
  h.state.requests[0].reject({ status: 404 });
  await request; await tick();
  assert.equal(safeInitial, true);
  assert.equal(modal.parts.parent.innerHTML.includes('cached-'), false);
  assert.equal(modal.parts.button.disabled, true);
  assert.equal(h.state.requests.length, 1);
});

test('C02 current parent replaces cached projection before loading replies', async () => {
  const h = harness();
  await ready(h);
  assert.equal(h.modal().parts.parent.innerHTML.includes('cached-'), false);
  assert.match(h.modal().parts.parent.innerHTML, /current-parent/);
  assert.match(h.modal().parts.list.innerHTML, /current-reply/);
  assert.equal(h.context._luminaFeedItems[0].thread, null);
  assert.equal(h.modal().parts.button.disabled, false);
  assert.equal(h.modal().parts.textarea.disabled, false);
  assert.equal(h.state.requests[0].url.endsWith('/post'), true);
  assert.equal(h.state.requests[1].url.endsWith('/post/replies?take=20'), true);
});

test('C03 mismatched parent response never loads replies or enables writing', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached);
  h.state.requests[0].resolve({ post: { id: 'other-post', body: 'unrelated-parent' } });
  await request;
  assert.equal(h.modal().parts.parent.innerHTML.includes('unrelated-parent'), false);
  assert.equal(h.modal().parts.button.disabled, true);
  assert.equal(h.state.requests.length, 1);
});

test('C04 closing while parent is pending does not resurrect or continue reading', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached), modal = h.modal();
  h.context.closeFeedCommentModal();
  h.state.requests[0].resolve({ id: 'post', body: 'late-parent' });
  await request;
  assert.equal(h.modal(), null);
  assert.equal(modal.removed, true);
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.context._luminaFeedItems[0].body, 'cached-unverified-parent');
});

test('C05 changing viewer leaves pending parent hidden and writing disabled', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached);
  h.state.auth = { accessToken: 'other', user: { id: 'other' } };
  h.state.requests[0].resolve({ id: 'post', body: 'prior-viewer-parent' });
  await request;
  assert.equal(h.modal().parts.parent.innerHTML.includes('prior-viewer-parent'), false);
  assert.equal(h.modal().parts.button.disabled, true);
  assert.equal(h.state.requests.length, 1);
});

test('C06 a later replies access refusal hides parent and invalidates writing', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached);
  h.state.requests[0].resolve({ id: 'post', body: 'current-parent' });
  await tick();
  h.state.requests[1].reject({ status: 403 });
  await request;
  assert.equal(h.modal().parts.parent.innerHTML.includes('current-parent'), false);
  assert.equal(h.modal().parts.button.disabled, true);
  h.modal().parts.button.disabled = false;
  h.modal().parts.textarea.value = 'new-reply';
  await h.submit();
  assert.equal(h.state.requests.length, 2);
});

test('C07 validated submission is single flight and reloads replies', async () => {
  const h = harness();
  await ready(h);
  h.modal().parts.textarea.value = 'new-reply';
  const submitted = h.submit();
  await h.submit();
  assert.equal(h.state.requests.length, 3);
  assert.equal(h.state.requests[2].options.method, 'POST');
  h.state.requests[2].resolve({ post: { replyCount: 2 } });
  await tick();
  assert.equal(h.state.requests.length, 4);
  h.state.requests[3].resolve({ items: [] });
  await submitted;
  assert.equal(h.modal().parts.button.disabled, false);
  assert.equal(h.modal().parts.textarea.value, '');
});

test('C08 network failure is not a fallback or an automatic retry', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached);
  h.state.requests[0].reject(new TypeError('synthetic-network'));
  await request;
  assert.equal(h.modal().parts.parent.innerHTML.includes('cached-'), false);
  assert.equal(h.modal().parts.button.disabled, true);
  assert.equal(h.state.requests.length, 1);
});

test('C09 pending parent cannot be submitted by bypassing the disabled button', async () => {
  const h = harness(), request = h.context.openFeedCommentModal(h.cached);
  h.modal().parts.button.disabled = false;
  h.modal().parts.textarea.value = 'new-reply';
  await h.submit();
  const blocked = h.state.requests.length === 1;
  h.state.requests[0].reject({ status: 404 });
  await request;
  assert.equal(blocked, true);
});

test('C10 missing parent ID does not create a modal or request', async () => {
  const h = harness();
  await h.context.openFeedCommentModal(null);
  await h.context.openFeedCommentModal({});
  assert.equal(h.state.nodes.length, 0);
  assert.equal(h.state.requests.length, 0);
});

test('C11 delayed focus belongs to the same active viewer and modal', async () => {
  const h = harness();
  await ready(h);
  h.state.blocked = true;
  for (const callback of h.state.timers) callback();
  assert.equal(h.state.focus, 0);
});

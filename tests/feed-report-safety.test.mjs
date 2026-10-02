import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/feed-report.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const dictionaryStart = appSource.indexOf('const I18N_DICT = {');
const dictionaryEnd = appSource.indexOf('let _currentLocale = I18N_FALLBACK;', dictionaryStart);
assert.ok(dictionaryStart >= 0 && dictionaryEnd > dictionaryStart, 'locate the real report dictionary');
const dictionary = runInNewContext(`${appSource.slice(dictionaryStart, dictionaryEnd)}\nI18N_DICT`, {});
const locales = ['ko-KR', 'ja-JP', 'en-US', 'zh-CN', 'zh-Hant'];
const reasons = ['sexual_content', 'harassment', 'hate', 'impersonation', 'spam', 'other'];
const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';
const reportId = '33333333-3333-4333-8333-333333333333';
const postId = '44444444-4444-4444-8444-444444444444';
const otherPostId = '55555555-5555-4555-8555-555555555555';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKey = (owner = userId, post = postId, reason = 'spam') => `lumina-feed-report:${owner}:${post}:${reason}`;
const receipt = (post = postId, owner = userId, status = 'submitted', alreadySubmitted = false) => ({
  report: { id: reportId, postId: post, reporterUserId: owner, status }, alreadySubmitted,
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function eventTarget(target = {}) {
  const listeners = new Map();
  target.addEventListener = (name, handler) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(handler);
  };
  target.emit = (name, values = {}) => {
    const event = {
      type: name, target, defaultPrevented: false, propagationStopped: false, ...values,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    return { event, results: (listeners.get(name) || []).map(handler => handler(event)) };
  };
  return target;
}

function session() {
  return {
    values: new Map(), writes: [], removals: [], failRead: false, failWrite: false, failRemove: false,
    getItem(key) {
      if (this.failRead) throw new Error('storage unavailable');
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.writes.push([String(key), String(value)]);
      if (this.failWrite) throw new Error('storage unavailable');
      this.values.set(String(key), String(value));
    },
    removeItem(key) {
      this.removals.push(key);
      if (this.failRemove) throw new Error('storage unavailable');
      this.values.delete(key);
    },
  };
}

function harness(storage = session()) {
  const state = {
    auth: { accessToken: 'test-token', user: { id: userId } }, available: true, locale: 'en-US',
    requests: [], login: [], dialogs: [], focus: [], applied: [], generated: 0, respond: () => receipt(),
  };
  const document = eventTarget({ activeElement: null });
  const translate = key => dictionary[key]?.[state.locale] ?? key;

  // Model only the generated DOM and native dialog actions; never replace IIFE-private functions.
  function element(tagName, attributes = {}) {
    const node = eventTarget({
      tagName, attributes: new Map(Object.entries(attributes)), children: [], parentNode: null,
      isConnected: false, open: false, disabled: 'disabled' in attributes, hidden: 'hidden' in attributes,
      value: attributes.value ?? '', textContent: '', dataset: {}, showCount: 0, closeCount: 0,
    });
    for (const [key, value] of node.attributes) {
      if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
    }
    node.getAttribute = name => node.attributes.get(name) ?? null;
    node.setAttribute = (name, value) => { node.attributes.set(name, String(value)); };
    node.matches = selector => {
      const match = selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
      return match ? node.attributes.has(match[1]) && (match[2] === undefined || node.getAttribute(match[1]) === match[2])
        : node.tagName === selector;
    };
    node.closest = selector => node.matches(selector) ? node : node.parentNode?.closest(selector) ?? null;
    node.querySelectorAll = selector => {
      const matches = [];
      const selectors = selector.split(',').map(value => value.trim());
      const walk = parent => parent.children.forEach(child => {
        if (selectors.some(value => child.matches(value))) matches.push(child);
        walk(child);
      });
      walk(node);
      return matches;
    };
    node.querySelector = selector => node.querySelectorAll(selector)[0] ?? null;
    node.connect = connected => { node.isConnected = connected; node.children.forEach(child => child.connect(connected)); };
    node.append = child => { child.parentNode = node; node.children.push(child); child.connect(node.isConnected); };
    node.remove = () => {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
      node.parentNode = null;
      node.connect(false);
    };
    node.focus = () => { document.activeElement = node; state.focus.push(node); };
    node.showModal = () => { assert.equal(node.isConnected, true); node.open = true; node.showCount++; };
    node.close = () => { node.open = false; node.closeCount++; };
    Object.defineProperty(node, 'innerHTML', {
      set(markup) {
        node.children = [];
        const stack = [node];
        for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
          if (match[1]) { stack.pop(); continue; }
          const attrs = Object.fromEntries([...match[3].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)]
            .map(attr => [attr[1], attr[2] ?? '']));
          const child = element(match[2], attrs);
          stack.at(-1).append(child);
          stack.push(child);
        }
        for (const form of node.querySelectorAll('form')) {
          form.elements = Object.fromEntries(form.querySelectorAll('[name]').map(child => [child.getAttribute('name'), child]));
        }
      },
    });
    return node;
  }

  document.body = element('body');
  document.body.connect(true);
  document.createElement = tag => {
    const node = element(tag);
    if (tag === 'dialog') state.dialogs.push(node);
    return node;
  };
  const window = eventTarget({
    location: { pathname: '/lumina-feed/' }, feedReportAvailable: () => state.available,
    luminaI18n: {
      t: translate,
      apply(root) {
        state.applied.push(root);
        root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = translate(node.getAttribute('data-i18n')); });
      },
    },
  });
  runInNewContext(source, {
    window, document, sessionStorage: storage, getAuth: () => state.auth,
    crypto: { randomUUID() { state.generated++; return randomUUID(); } },
    openAuthModal: (...args) => state.login.push(JSON.parse(JSON.stringify(args))),
    apiFetch(path, options) {
      state.requests.push({ path, options: JSON.parse(JSON.stringify(options)) });
      return state.respond(path, options);
    },
  }, { filename: 'pages/feed-report.js' });

  const active = () => document.body.children.find(node => node.tagName === 'dialog' && node.open) ?? null;
  return {
    state, storage, window, document, active, translate,
    open(post = postId, disabled = false) {
      const origin = element('button', { 'data-feed-report': post });
      origin.disabled = disabled;
      const icon = element('span');
      origin.append(icon);
      document.body.append(origin);
      const click = document.emit('click', { target: icon });
      assert.equal(click.event.defaultPrevented, true);
      assert.equal(click.event.propagationStopped, true);
      return { origin, dialog: active() };
    },
    submit(dialog, reason = 'spam', detail = '') {
      const form = dialog.querySelector('form');
      form.elements.reason.value = reason;
      form.elements.detail.value = detail;
      const submit = form.emit('submit');
      assert.equal(submit.results.length, 1, 'use the actual registered submit callback');
      assert.equal(submit.event.defaultPrevented, true);
      return submit.results[0];
    },
    close(dialog, mode = 'button') {
      if (mode === 'button') return dialog.querySelector('[data-report-cancel]').emit('click');
      const cancel = dialog.emit('cancel');
      assert.equal(cancel.event.defaultPrevented, true, 'native Escape cancellation is handled');
      return cancel;
    },
  };
}

const controls = dialog => dialog.querySelector('form').querySelectorAll('select, textarea, [type=submit]');
const statusNode = dialog => dialog.querySelector('[data-report-message]');
function assertStatus(h, dialog, suffix) {
  const key = `feed.report.${suffix}`;
  assert.equal(statusNode(dialog).getAttribute('data-i18n'), key);
  assert.equal(statusNode(dialog).textContent, h.translate(key));
  assert.equal(statusNode(dialog).hidden, false);
}
function snapshot(dialog) {
  return {
    open: dialog.open, connected: dialog.isConnected, showCount: dialog.showCount,
    messageKey: statusNode(dialog).getAttribute('data-i18n'), message: statusNode(dialog).textContent,
    messageHidden: statusNode(dialog).hidden,
    controls: controls(dialog).map(node => [node.value, node.disabled, node.hidden]),
  };
}

test('guest, invalid UUID, disabled and preview/unavailable guards never POST at open or submit', async () => {
  for (const mode of ['guest', 'no-token', 'invalid-owner', 'invalid-post', 'missing-post', 'disabled', 'preview', 'unavailable']) {
    const h = harness();
    if (mode === 'guest') h.state.auth = null;
    if (mode === 'no-token') h.state.auth.accessToken = '';
    if (mode === 'invalid-owner') h.state.auth.user.id = 'not-a-uuid';
    if (mode === 'preview' || mode === 'unavailable') h.state.available = false;
    h.open(mode === 'invalid-post' ? 'not-a-uuid' : mode === 'missing-post' ? '' : postId, mode === 'disabled');
    assert.equal(h.active(), null, mode);
    assert.equal(h.state.dialogs.length, 0, mode);
    assert.equal(h.state.requests.length, 0, mode);
    assert.equal(h.storage.writes.length, 0, mode);
    assert.equal(h.state.login.length, ['guest', 'no-token', 'invalid-owner'].includes(mode) ? 1 : 0, mode);
    if (h.state.login.length) assert.deepEqual(h.state.login[0], ['login', { returnTo: { href: '/lumina-feed/' } }]);
  }
  for (const mode of ['guest', 'invalid-owner', 'new-token', 'preview', 'unavailable']) {
    const h = harness();
    const { dialog } = h.open();
    if (mode === 'guest') h.state.auth = null;
    else if (mode === 'invalid-owner') h.state.auth.user.id = 'invalid';
    else if (mode === 'new-token') h.state.auth.accessToken = 'rotated';
    else h.state.available = false;
    await h.submit(dialog);
    assert.equal(h.state.requests.length, 0, mode);
    assert.equal(h.storage.writes.length, 0, mode);
    assert.equal(statusNode(dialog).hidden, true, mode);
    assert.ok(controls(dialog).every(node => !node.disabled), mode);
  }
});

test('invalid reason or oversized trimmed detail never POST; all reasons accept the 500-character boundary', async () => {
  for (const [reason, detail] of [['', ''], ['unknown', ''], ['SPAM', ''], ['__proto__', ''], ['spam', 'x'.repeat(501)], ['other', `  ${'x'.repeat(501)}  `]]) {
    const h = harness();
    const { dialog } = h.open();
    await h.submit(dialog, reason, detail);
    assertStatus(h, dialog, 'invalid');
    assert.equal(h.state.requests.length, 0);
    assert.equal(h.state.generated, 0);
    assert.equal(h.storage.writes.length, 0);
    assert.ok(controls(dialog).every(node => !node.disabled));
  }
  for (const reason of reasons) {
    const h = harness();
    const { dialog } = h.open();
    await h.submit(dialog, reason, `  ${'x'.repeat(500)}  `);
    assert.equal(h.state.requests.length, 1, reason);
    assert.equal(h.state.requests[0].options.body.detail, 'x'.repeat(500), reason);
    assert.equal(h.state.requests[0].options.body.reason, reason);
    assertStatus(h, dialog, 'submitted');
  }
});

test('duplicate submit and repeated opening during a flight produce exactly one authenticated POST', async () => {
  const h = harness();
  const pending = deferred();
  h.state.respond = () => pending.promise;
  const { dialog } = h.open();
  const first = h.submit(dialog, 'harassment', '  private report detail  ');
  assertStatus(h, dialog, 'sending');
  assert.ok(controls(dialog).every(node => node.disabled));
  await h.submit(dialog, 'harassment', 'private report detail');
  h.open();
  assert.equal(h.state.dialogs.length, 1);
  assert.equal(h.active(), dialog);
  assert.equal(h.state.requests.length, 1);
  const { path, options } = h.state.requests[0];
  assert.equal(path, `/api/v1/lumina-feed/posts/${postId}/report`);
  assert.deepEqual(Object.keys(options).sort(), ['auth', 'body', 'method', 'throwOnError']);
  assert.equal(options.method, 'POST');
  assert.equal(options.auth, true);
  assert.equal(options.throwOnError, true);
  assert.deepEqual(Object.keys(options.body).sort(), ['detail', 'reason', 'requestKey']);
  assert.equal(options.body.detail, 'private report detail');
  assert.match(options.body.requestKey, uuid);
  pending.resolve(receipt());
  await first;
  assertStatus(h, dialog, 'submitted');
  assert.equal(dialog.querySelector('[type=submit]').hidden, true);
  assert.equal(h.storage.values.size, 0);
});

test('unknown failure retries the same UUID requestKey across reopen/reload without storing report text or detail', async () => {
  const h = harness();
  h.state.respond = () => { throw new Error('private server response and report text'); };
  const { dialog } = h.open();
  await h.submit(dialog, 'other', 'sensitive detail first attempt');
  assertStatus(h, dialog, 'error');
  assert.doesNotMatch(statusNode(dialog).textContent, /private server|sensitive detail/);
  assert.ok(controls(dialog).every(node => !node.disabled));
  const firstKey = h.state.requests[0].options.body.requestKey;
  assert.match(firstKey, uuid);
  assert.deepEqual([...h.storage.values], [[storageKey(userId, postId, 'other'), firstKey]]);
  h.close(dialog);
  const reopened = h.open().dialog;
  assert.equal(reopened.querySelector('form').elements.detail.value, '');
  await h.submit(reopened, 'other', 'sensitive detail second attempt');
  assert.equal(h.state.requests[1].options.body.requestKey, firstKey);
  assert.equal(h.state.generated, 1);
  h.close(reopened);

  const reload = harness(h.storage);
  const fresh = reload.open().dialog;
  assert.equal(fresh.querySelector('form').elements.detail.value, '');
  await reload.submit(fresh, 'other', 'sensitive detail third attempt');
  assert.equal(reload.state.requests[0].options.body.requestKey, firstKey);
  assert.equal(reload.state.generated, 0, 'recover the key from sessionStorage, not from a private function');
  assertStatus(reload, fresh, 'submitted');
  assert.deepEqual(h.storage.removals, [storageKey(userId, postId, 'other')]);
  assert.equal(h.storage.values.size, 0);
  for (const [name, value] of h.storage.writes) {
    assert.equal(name, storageKey(userId, postId, 'other'));
    assert.match(value, uuid, 'only UUID metadata is persisted');
    assert.doesNotMatch(`${name}:${value}`, /sensitive detail|private server|report text|"detail"|"text"/);
  }
});

test('only a matching UUID receipt with an allowed status confirms success; invalid receipts and HTTP errors do not', async () => {
  for (const status of ['submitted', 'reviewing', 'resolved', 'dismissed']) {
    for (const duplicate of [false, true]) {
      const h = harness();
      h.state.respond = () => receipt(postId, userId, status, duplicate);
      const { dialog } = h.open();
      await h.submit(dialog);
      assertStatus(h, dialog, duplicate ? 'duplicate' : 'submitted');
      assert.equal(dialog.querySelector('[type=submit]').hidden, true);
      assert.equal(h.storage.values.size, 0);
      assert.deepEqual(h.storage.removals, [storageKey()]);
    }
  }
  const invalid = [null, {}, { report: null }, { alreadySubmitted: true },
    ...[{ id: 'invalid' }, { id: '00000000-0000-0000-0000-000000000000' }, { postId: otherPostId },
      { reporterUserId: otherUserId }, { reporterUserId: undefined }, { status: 'pending' }, { status: undefined }]
      .map(change => ({ report: { ...receipt().report, ...change }, alreadySubmitted: true })),
  ];
  for (const result of invalid) {
    const h = harness();
    h.state.respond = () => result;
    const { dialog } = h.open();
    await h.submit(dialog);
    assertStatus(h, dialog, 'error');
    assert.equal(dialog.querySelector('[type=submit]').hidden, false);
    assert.ok(controls(dialog).every(node => !node.disabled));
    assert.equal(h.storage.values.get(storageKey()), h.state.requests[0].options.body.requestKey);
    assert.equal(h.storage.removals.length, 0);
  }
  for (const [status, suffix] of [[401, 'auth'], [403, 'unavailable'], [404, 'unavailable'], [429, 'error'], [503, 'error']]) {
    const h = harness();
    h.state.respond = () => { throw Object.assign(new Error('private HTTP detail'), { status }); };
    const { dialog } = h.open();
    await h.submit(dialog);
    assertStatus(h, dialog, suffix);
    assert.doesNotMatch(statusNode(dialog).textContent, /private HTTP detail/);
    assert.equal(h.storage.removals.length, 0);
    assert.ok(controls(dialog).every(node => !node.disabled));
  }
});

test('auth, token, locale and storage changes cannot leak a late receipt/error into the current view', async () => {
  for (const mode of ['authchange', 'auth-expired', 'token-change', 'storage-auth', 'storage-clear', 'storage-unrelated']) {
    for (const outcome of ['receipt', 'error']) {
      const h = harness();
      const oldResponse = deferred();
      h.state.respond = () => oldResponse.promise;
      const { dialog: oldDialog, origin } = h.open();
      const oldSubmit = h.submit(oldDialog, 'spam', 'previous account detail');
      h.state.auth = mode === 'token-change'
        ? { accessToken: 'rotated-token', user: { id: userId } }
        : { accessToken: 'new-account-token', user: { id: otherUserId } };
      if (mode === 'auth-expired') {
        h.state.auth = null;
        h.window.emit('lumina:auth-expired');
        h.state.auth = { accessToken: 'new-account-token', user: { id: otherUserId } };
      } else if (mode.startsWith('storage-')) {
        h.window.emit('storage', { key: mode === 'storage-auth' ? 'lumina_auth' : mode === 'storage-clear' ? null : 'unrelated' });
      } else h.window.emit('lumina:authchange');
      assert.equal(oldDialog.isConnected, mode === 'storage-unrelated', mode);
      assert.equal(h.state.focus.includes(origin), false, 'never restore focus for an old owner/token');

      const newResponse = deferred();
      h.state.respond = () => newResponse.promise;
      const { dialog: current } = h.open(otherPostId);
      const currentSubmit = h.submit(current, 'hate', 'current account detail');
      h.state.locale = 'ja-JP';
      h.window.emit('lumina:localechange');
      assertStatus(h, current, 'sending');
      const before = snapshot(current);
      const detachedBefore = snapshot(oldDialog);
      const focused = h.document.activeElement;
      const focusCount = h.state.focus.length;
      const currentKey = storageKey(h.state.auth.user.id, otherPostId, 'hate');
      const currentRequestKey = h.storage.values.get(currentKey);
      if (outcome === 'receipt') oldResponse.resolve(receipt());
      else oldResponse.reject(Object.assign(new Error('private previous-account error'), { status: 401 }));
      await oldSubmit;
      assert.equal(h.active(), current, `${mode}/${outcome}`);
      assert.deepEqual(snapshot(current), before, `${mode}/${outcome}`);
      assert.deepEqual(snapshot(oldDialog), detachedBefore, 'detached view is not updated either');
      assert.equal(h.document.activeElement, focused);
      assert.equal(h.state.focus.length, focusCount);
      assert.equal(h.storage.values.get(currentKey), currentRequestKey, 'old completion cannot remove the current request key');
      assert.match(currentRequestKey, uuid);
      assert.equal(h.state.requests.length, 2);
      newResponse.resolve(receipt(otherPostId, h.state.auth.user.id));
      await currentSubmit;
      assertStatus(h, current, 'submitted');
    }
  }
  for (const outcome of ['receipt', 'error']) {
    const h = harness();
    const pending = deferred();
    h.state.respond = () => pending.promise;
    const { dialog } = h.open();
    const action = h.submit(dialog, 'other', 'detail remains in the open form');
    h.state.locale = 'zh-Hant';
    h.window.emit('lumina:localechange');
    assert.equal(h.active(), dialog);
    assertStatus(h, dialog, 'sending');
    assert.equal(dialog.querySelector('form').elements.detail.value, 'detail remains in the open form');
    if (outcome === 'receipt') pending.resolve(receipt());
    else pending.reject(new Error('private late failure'));
    await action;
    assertStatus(h, dialog, outcome === 'receipt' ? 'submitted' : 'error');
    assert.equal(h.state.requests.length, 1);
    assert.equal(dialog.showCount, 1);
  }
});

test('closing a pending native dialog by button or Escape never reopens it or updates its replacement', async () => {
  for (const mode of ['button', 'escape']) {
    for (const outcome of ['receipt', 'error']) {
      const h = harness();
      const pending = deferred();
      h.state.respond = () => pending.promise;
      const { dialog, origin } = h.open();
      const action = h.submit(dialog);
      h.close(dialog, mode);
      assert.equal(dialog.open, false);
      assert.equal(dialog.isConnected, false);
      assert.equal(dialog.closeCount, 1);
      assert.equal(h.active(), null);
      assert.equal(h.document.activeElement, origin, 'restore the connected same-owner origin');
      h.open();
      assert.equal(h.active(), null, 'same-post pending flight cannot reopen');
      assert.equal(h.state.dialogs.length, 1);
      const replacement = h.open(otherPostId).dialog;
      const before = snapshot(replacement);
      const detachedBefore = snapshot(dialog);
      const focusCount = h.state.focus.length;
      if (outcome === 'receipt') pending.resolve(receipt());
      else pending.reject(new Error('private cancelled report failure'));
      await action;
      assert.equal(h.active(), replacement);
      assert.deepEqual(snapshot(replacement), before);
      assert.deepEqual(snapshot(dialog), detachedBefore);
      assert.equal(dialog.showCount, 1);
      assert.equal(h.state.focus.length, focusCount);
      assert.equal(h.state.requests.length, 1);
      assert.ok(h.open().dialog, 'flight is released after completion, so an explicit later open works');
      assert.equal(h.state.requests.length, 1);
    }
  }
});

test('confirmed status/key stay stable after success cleanup, even when sessionStorage removal fails', async () => {
  for (const failRemove of [false, true]) {
    for (const duplicate of [false, true]) {
      const h = harness();
      h.storage.failRemove = failRemove;
      h.state.respond = () => receipt(postId, userId, 'submitted', duplicate);
      const { dialog } = h.open();
      await h.submit(dialog);
      const suffix = duplicate ? 'duplicate' : 'submitted';
      const key = h.state.requests[0].options.body.requestKey;
      assertStatus(h, dialog, suffix);
      assert.deepEqual(h.storage.removals, [storageKey()]);
      assert.equal(h.storage.values.get(storageKey()), failRemove ? key : undefined);
      for (const locale of locales) {
        h.state.locale = locale;
        h.window.emit('lumina:localechange');
        assertStatus(h, dialog, suffix);
        assert.equal(dialog.querySelector('[type=submit]').hidden, true);
        assert.ok(controls(dialog).every(node => node.disabled));
        assert.equal(h.active(), dialog);
        assert.equal(dialog.showCount, 1);
      }
      assert.equal(h.state.requests.length, 1);
      assert.equal(h.state.generated, 1);
      if (!failRemove) {
        h.close(dialog);
        const next = h.open().dialog;
        await h.submit(next);
        assertStatus(h, next, suffix);
        assert.match(h.state.requests[1].options.body.requestKey, uuid);
        assert.notEqual(h.state.requests[1].options.body.requestKey, key, 'successful removal also clears the in-memory key');
        assert.equal(h.state.generated, 2);
        assert.equal(h.storage.values.size, 0);
      }
    }
  }
  const h = harness();
  h.storage.failRead = true;
  h.storage.failWrite = true;
  h.state.respond = () => { throw new Error('unknown outcome without storage'); };
  const { dialog } = h.open();
  await h.submit(dialog);
  await h.submit(dialog);
  assertStatus(h, dialog, 'error');
  assert.equal(h.state.requests[1].options.body.requestKey, h.state.requests[0].options.body.requestKey);
  assert.equal(h.state.generated, 1, 'in-memory key survives unavailable sessionStorage');
});

test('all report dictionary keys exist in all five locales and translate the actual generated dialog', () => {
  const required = ['label', 'soon', 'title', 'reason', 'choose', 'detail', 'cancel', 'submit',
    'sending', 'submitted', 'duplicate', 'error', 'auth', 'unavailable', 'invalid',
    ...reasons.map(reason => `reason.${reason}`)].map(key => `feed.report.${key}`);
  const keys = new Set([...required, ...Object.keys(dictionary).filter(key => key.startsWith('feed.report.'))]);
  for (const key of keys) {
    const placeholders = [...(dictionary[key]?.['ko-KR'] ?? '').matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    for (const locale of locales) {
      const value = dictionary[key]?.[locale];
      assert.equal(typeof value, 'string', `${key} missing ${locale}`);
      assert.ok(value.trim().length > 0, `${key} empty ${locale}`);
      assert.notEqual(value, key, `${key} untranslated in ${locale}`);
      assert.deepEqual([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), placeholders, `${key}/${locale}`);
    }
  }
  for (const locale of locales) {
    const h = harness();
    h.state.locale = locale;
    const { dialog } = h.open();
    assert.equal(dialog.getAttribute('aria-labelledby'), 'feedReportHeading');
    assert.equal(dialog.querySelector('h2').getAttribute('id'), 'feedReportHeading');
    assert.equal(statusNode(dialog).getAttribute('role'), 'status');
    assert.equal(statusNode(dialog).getAttribute('tabindex'), '-1');
    assert.equal(dialog.querySelector('textarea').getAttribute('maxlength'), '500');
    assert.deepEqual(dialog.querySelectorAll('option').map(node => node.getAttribute('value')), ['', ...reasons]);
    const translated = dialog.querySelectorAll('[data-i18n]');
    assert.equal(translated.length, 12, 'title, two labels, seven options and two actions');
    for (const node of translated) {
      const key = node.getAttribute('data-i18n');
      assert.ok(keys.has(key), `generated key not included in five-locale coverage: ${key}`);
      assert.equal(node.textContent, dictionary[key][locale], `${key}/${locale}`);
    }
    assert.equal(statusNode(dialog).hidden, true);
    assert.equal(h.state.requests.length, 0);
  }
});

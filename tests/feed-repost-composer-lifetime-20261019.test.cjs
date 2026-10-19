'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const ts = require(path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js'));
const feedFile = path.join(ROOT, 'pages/lumina-feed.js');
const appFile = path.join(ROOT, 'app.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = [feedFile, appFile, __filename];
const opening = tracked.map(file => sha(fs.readFileSync(file)));

function parse(file) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  return tree;
}
const feedTree = parse(feedFile);
const appTree = parse(appFile);
function oneFunction(tree, name) {
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.length, 1, name);
  return found[0];
}
const openNode = oneFunction(feedTree, 'openRepostModal');
const closeNode = oneFunction(feedTree, 'closeRepostModal');
const submitNode = oneFunction(feedTree, 'submitRepost');
assert.equal(openNode.parent, closeNode.parent);
assert.equal(openNode.parent, submitNode.parent);
const siblings = [...openNode.parent.statements];
const initializers = siblings.filter(node => ts.isVariableStatement(node) &&
  node.declarationList.declarations.some(decl => decl.name.getText(feedTree) === 'repostReturnFocus'));
assert.equal(initializers.length, 1);
const initializer = initializers[0];
const focusDeclaration = initializer.declarationList.declarations.find(decl =>
  decl.name.getText(feedTree) === 'repostReturnFocus');
assert.equal(focusDeclaration.initializer.kind, ts.SyntaxKind.NullKeyword);
assert.ok(initializer.pos < closeNode.pos && closeNode.pos < openNode.pos && openNode.pos < submitNode.pos);
const lifetimeBody = feedTree.text.slice(initializer.getStart(feedTree), submitNode.end);
const helperBodies = ['buildPostShareUrl', 'setPanelStatus', 'feedSubmitErrorMessage']
  .map(name => oneFunction(feedTree, name).getText(feedTree));
helperBodies.push(oneFunction(appTree, 'feedEscapeHtml').getText(appTree));
const genuine = helperBodies.join('\n') + '\n' + lifetimeBody +
  '\n({ openRepostModal, closeRepostModal, submitRepost, setPanelStatus });';

function fixture({ deferLoad = false } = {}) {
  const calls = { requests: [], loads: [], loadFlights: [], renders: 0, warnings: [], focus: [] };
  const loadEntryWaiters = new Set();
  const bodyClasses = new Set();
  const backdrop = { hidden: true };
  let serial = 0;
  let children = Object.create(null);
  let markup = '';
  const modal = { hidden: true, dataset: {}, isConnected: true };
  const trigger = { isConnected: true, focus() { document.activeElement = trigger; calls.focus.push('trigger'); } };
  const document = {
    activeElement: trigger,
    body: { classList: { add(name) { bodyClasses.add(name); }, remove(name) { bodyClasses.delete(name); } } },
    getElementById(id) {
      if (id === 'feedRepostModal') return modal;
      if (id === 'feedRepostBackdrop') return backdrop;
      return null;
    },
  };
  Object.defineProperty(modal, 'innerHTML', {
    get() { return markup; },
    set(value) {
      for (const child of Object.values(children)) child.isConnected = false;
      markup = value;
      children = Object.create(null);
      if (!value) return;
      const generation = ++serial;
      function child(extra = {}) {
        return { generation, isConnected: true, dataset: {}, textContent: '', hidden: false,
          addEventListener() {}, focus() { document.activeElement = this; calls.focus.push(generation); }, ...extra };
      }
      children['[data-feed-repost-input]'] = child({ value: '' });
      children['[data-feed-repost-submit]'] = child({ disabled: false, textContent: 'submit' });
      children['[data-feed-status]'] = child({ hidden: true });
      children['.feed-repost-counter'] = child();
    },
  });
  modal.querySelector = selector => children[selector] || null;
  modal.contains = element => Object.values(children).includes(element);
  const context = {
    document, encodeURIComponent,
    window: { location: { origin: 'https://synthetic.example.test' } },
    isLoggedIn() { return true; },
    getAuth() { return { accessToken: "synthetic-api-A", user: { id: "10000000-0000-4000-8000-000000000001" } }; },
    _luminaFeedFilter: 'all',
    apiFetch(url, options) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.requests.push({ url, options: JSON.parse(JSON.stringify(options)), resolve, reject });
      return promise;
    },
    async loadLuminaFeedData(filter) {
      calls.loads.push(filter);
      if (deferLoad) return new Promise(resolve => {
        calls.loadFlights.push({ resolve });
        for (const notify of [...loadEntryWaiters]) notify();
      });
    },
    renderLuminaFeed() { calls.renders++; },
    console: { warn(...args) { calls.warnings.push(args); } },
  };
  const subject = vm.runInNewContext(genuine, context, { timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false } });
  function open(postId, draft) {
    subject.openRepostModal({ postId, body: 'synthetic original', authorName: 'synthetic author' });
    const input = modal.querySelector('[data-feed-repost-input]');
    assert.ok(input);
    input.value = draft;
    return input;
  }
  function capture() {
    const input = modal.querySelector('[data-feed-repost-input]');
    const status = modal.querySelector('[data-feed-status]');
    const button = modal.querySelector('[data-feed-repost-submit]');
    return { input, status, button, draft: input?.value, postId: modal.dataset.postId,
      statusText: status?.textContent, statusKind: status?.dataset.kind, markup };
  }
  function whenLoadEntered(count) {
    if (calls.loadFlights.length >= count) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        loadEntryWaiters.delete(notify);
        reject(new Error('Synthetic reload entry was not observed'));
      }, 1000);
      function notify() {
        if (calls.loadFlights.length < count) return;
        clearTimeout(timer);
        loadEntryWaiters.delete(notify);
        resolve();
      }
      loadEntryWaiters.add(notify);
    });
  }
  function unchanged(saved) {
    assert.equal(modal.hidden, false, 'replacement composer remains visible');
    assert.equal(backdrop.hidden, false);
    assert.equal(bodyClasses.has('is-feed-repost-open'), true);
    assert.equal(modal.dataset.postId, saved.postId);
    assert.equal(modal.querySelector('[data-feed-repost-input]'), saved.input);
    assert.equal(saved.input.isConnected, true);
    assert.equal(saved.input.value, saved.draft);
    assert.equal(modal.querySelector('[data-feed-status]'), saved.status);
    assert.equal(saved.status.textContent, saved.statusText);
    assert.equal(saved.status.dataset.kind, saved.statusKind);
    assert.equal(modal.querySelector('[data-feed-repost-submit]'), saved.button);
    assert.equal(markup, saved.markup);
  }
  return { subject, modal, backdrop, calls, open, capture, unchanged, whenLoadEntered };
}

test('Repost keeps its own success failure payload and duplicate controls', async () => {
  const own = fixture();
  own.open('synthetic-A', '  synthetic quote  ');
  const pending = own.subject.submitRepost();
  assert.equal(own.modal.dataset.busy, '1');
  assert.equal(own.capture().button.disabled, true);
  await own.subject.submitRepost();
  assert.equal(own.calls.requests.length, 1);
  const request = own.calls.requests[0];
  assert.equal(request.url, '/api/v1/lumina-feed/posts/synthetic-A/reposts');
  assert.deepEqual(request.options, { method: 'POST', auth: true, throwOnError: true,
    body: { body: 'synthetic quote' } });
  request.resolve({});
  await pending;
  assert.equal(own.modal.hidden, true);
  assert.equal(own.backdrop.hidden, true);
  assert.equal(own.modal.innerHTML, '');
  assert.equal(own.modal.dataset.postId, '');
  assert.equal(own.modal.dataset.busy, '0');
  assert.deepEqual(own.calls.loads, ['all']);
  assert.equal(own.calls.renders, 1);
  assert.equal(own.calls.warnings.length, 0);

  const failed = fixture();
  failed.open('synthetic-A', '');
  const rejected = failed.subject.submitRepost();
  assert.deepEqual(failed.calls.requests[0].options.body, {});
  failed.calls.requests[0].reject({ status: 404 });
  await rejected;
  assert.equal(failed.modal.hidden, false);
  assert.equal(failed.capture().input.value, '');
  assert.equal(failed.capture().status.hidden, false);
  assert.equal(failed.capture().status.dataset.kind, 'error');
  assert.ok(failed.capture().status.textContent.length > 0);
  assert.equal(failed.capture().button.disabled, false);
  assert.equal(failed.modal.dataset.busy, '0');
  assert.equal(failed.calls.loads.length, 0);
  assert.equal(failed.calls.renders, 0);
  assert.equal(failed.calls.requests.length, 1);
});

test('Old repost success cannot close a different replacement draft or release its pending submit', async () => {
  for (const replacementPending of [false, true]) {
    const f = fixture();
    const oldInput = f.open('synthetic-A', 'synthetic old draft');
    const old = f.subject.submitRepost();
    f.subject.closeRepostModal();
    const newInput = f.open('synthetic-B', 'synthetic replacement draft');
    assert.notEqual(newInput, oldInput);
    assert.equal(oldInput.isConnected, false);
    let current;
    if (replacementPending) {
      current = f.subject.submitRepost();
      assert.equal(f.calls.requests.length, 2, 'new composer has its own submit admission');
    } else {
      f.subject.setPanelStatus(f.modal, 'synthetic current status', 'info');
    }
    const saved = f.capture();
    const busy = f.modal.dataset.busy;
    const disabled = saved.button.disabled;
    f.calls.requests[0].resolve({});
    await old;
    f.unchanged(saved);
    assert.equal(f.modal.dataset.busy, busy);
    assert.equal(saved.button.disabled, disabled);
    assert.equal(f.calls.requests[0].url, '/api/v1/lumina-feed/posts/synthetic-A/reposts');
    assert.equal(f.calls.loads.length, 0);
    assert.equal(f.calls.renders, 0);
    if (replacementPending) {
      await f.subject.submitRepost();
      assert.equal(f.calls.requests.length, 2);
      assert.equal(f.calls.requests[1].url, '/api/v1/lumina-feed/posts/synthetic-B/reposts');
      f.calls.requests[1].resolve({});
      await current;
      assert.equal(f.modal.hidden, true);
      assert.equal(f.calls.loads.length, 1);
      assert.equal(f.calls.renders, 1);
    } else {
      assert.equal(f.calls.requests.length, 1);
      assert.equal(f.modal.dataset.busy, '0');
    }
  }

  const refreshing = fixture({ deferLoad: true });
  refreshing.open('synthetic-A', 'synthetic own success');
  const oldRefresh = refreshing.subject.submitRepost();
  refreshing.calls.requests[0].resolve({});
  await refreshing.whenLoadEntered(1);
  assert.equal(refreshing.modal.hidden, true);
  assert.equal(refreshing.calls.loadFlights.length, 1);
  refreshing.open('synthetic-B', 'synthetic draft during old refresh');
  const newSubmit = refreshing.subject.submitRepost();
  const newSaved = refreshing.capture();
  assert.equal(refreshing.calls.requests.length, 2);
  assert.equal(refreshing.modal.dataset.busy, '1');
  refreshing.calls.loadFlights[0].resolve();
  await oldRefresh;
  refreshing.unchanged(newSaved);
  assert.equal(refreshing.modal.dataset.busy, '1');
  assert.equal(newSaved.button.disabled, true);
  assert.equal(refreshing.calls.renders, 1);
  await refreshing.subject.submitRepost();
  assert.equal(refreshing.calls.requests.length, 2);
  refreshing.calls.requests[1].resolve({});
  await refreshing.whenLoadEntered(2);
  assert.equal(refreshing.calls.loadFlights.length, 2);
  refreshing.calls.loadFlights[1].resolve();
  await newSubmit;
  assert.equal(refreshing.modal.hidden, true);
  assert.equal(refreshing.calls.renders, 2);
});

test('Old repost failure cannot mark a reopened same-post draft or change its state', async () => {
  const f = fixture();
  const oldInput = f.open('synthetic-A', 'synthetic old draft');
  const old = f.subject.submitRepost();
  f.subject.closeRepostModal();
  const newInput = f.open('synthetic-A', 'synthetic same-post new draft');
  assert.notEqual(newInput, oldInput);
  f.subject.setPanelStatus(f.modal, 'synthetic new owner status', 'warn');
  const saved = f.capture();
  f.calls.requests[0].reject({ status: 404 });
  await old;
  f.unchanged(saved);
  assert.equal(f.modal.dataset.busy, '0');
  assert.equal(saved.button.disabled, false);
  assert.equal(f.calls.requests.length, 1);
  assert.equal(f.calls.loads.length, 0);
  assert.equal(f.calls.renders, 0);
  assert.equal(f.calls.warnings.length, 0);
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(file => sha(fs.readFileSync(file))), opening);
});

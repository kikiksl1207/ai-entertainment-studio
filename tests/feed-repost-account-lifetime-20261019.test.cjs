'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const tsFile = path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js');
const feedFile = path.join(ROOT, 'pages/lumina-feed.js');
const appFile = path.join(ROOT, 'app.js');
const helperFile = path.join(__dirname, 'support/feed-like-account-lifetime-inverse-20261019.cjs');
const editHelperFile = path.join(__dirname, 'support/feed-edit-modal-lifetime-inverse-20261019.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const blob = b => createHash('sha1').update('blob ' + b.length + '\0').update(b).digest('hex');
const tracked = [feedFile, appFile, helperFile, __filename, tsFile, editHelperFile];
const caps = [1024 * 1024, 1024 * 1024, 16 * 1024, 128 * 1024, 16 * 1024 * 1024, 16 * 1024];
for (const [i, file] of tracked.entries()) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= caps[i]);
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
}
assert.equal(fs.statSync(tsFile).size, 9112572);
assert.ok([5869, 6007].includes(fs.statSync(helperFile).size));
assert.ok([9615, 9812].includes(fs.statSync(editHelperFile).size));
const opening = tracked.map(p => sha(fs.readFileSync(p)));
assert.equal(opening[4], '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');
function canonicalSource(raw) {
  assert.equal(Buffer.isBuffer(raw), true);
  let text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text).equals(raw), true);
  assert.equal(text.startsWith('\uFEFF'), false);
  if (text.includes('\r')) {
    const withoutPairs = text.replace(/\r\n/g, '');
    assert.equal(withoutPairs.includes('\r'), false);
    assert.equal(withoutPairs.includes('\n'), false);
    text = text.replace(/\r\n/g, '\n');
  }
  return Buffer.from(text);
}
const helperRaw = fs.readFileSync(helperFile);
assert.equal(sha(helperRaw), opening[2]);
const helperCanonical = canonicalSource(helperRaw);
assert.equal(helperCanonical.length, 5869);
assert.equal(sha(helperCanonical), '5d0c23c5f666c710019c44f8d59c4734e28d8c85743c9c6cde240e11c5f6be1a');
assert.equal(blob(helperCanonical), '4726a461e9d7c3c772b442ca5a20d810a548c8af');
const editRaw = fs.readFileSync(editHelperFile);
assert.equal(sha(editRaw), opening[5]);
const editCanonical = canonicalSource(editRaw);
assert.equal(editCanonical.length, 9615);
assert.equal(sha(editCanonical), '93c4de9c4df3cc65ceeee081c57c5b95320428552b363813e6dbad024b2df8ad');
assert.equal(blob(editCanonical), '3265048e8ad17481b0892ce57932a7939010e212');
const { restoreOwnedFeedLikeLifetime } = require(helperFile);
const { restoreOwnedFeedEditAccountFeed } = require(editHelperFile);
const actualFeed = canonicalSource(fs.readFileSync(feedFile));
assert.equal(actualFeed.length, 141156);
assert.equal(sha(actualFeed), '67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207');
assert.equal(blob(actualFeed), '4ee9e314b7e34059b007adeb252f8dd8f76e9f06');
const feedRaw = Buffer.from(restoreOwnedFeedEditAccountFeed(actualFeed.toString('utf8')));
const appRaw = Buffer.from(restoreOwnedFeedLikeLifetime(canonicalSource(fs.readFileSync(appFile)).toString('utf8')));
assert.ok([
  '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4',
  '4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b',
].includes(sha(feedRaw)));
assert.equal(sha(appRaw), '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61');
assert.equal(sha(fs.readFileSync(tsFile)), opening[4]);
const ts = require(tsFile);
function parse(file, raw) {
  const text = raw.toString('utf8');
  assert.equal(Buffer.from(text).equals(raw), true);
  assert.equal(text.startsWith('\uFEFF'), false);
  assert.equal(text.includes('\r'), false);
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  return tree;
}
const feedTree = parse(feedFile, feedRaw);
const appTree = parse(appFile, appRaw);
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
function oneVariable(tree, name, statements = tree.statements) {
  const found = [...statements].filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name));
  assert.equal(found.length, 1, name);
  return found[0];
}
const openNode = oneFunction(feedTree, 'openRepostModal');
const closeNode = oneFunction(feedTree, 'closeRepostModal');
const submitNode = oneFunction(feedTree, 'submitRepost');
const accountNode = oneFunction(feedTree, 'clearFeedOnAccountChange');
assert.equal(openNode.parent, closeNode.parent);
assert.equal(openNode.parent, submitNode.parent);
assert.equal(openNode.parent, accountNode.parent);
const siblings = [...openNode.parent.statements];
const outerStrict = siblings[0];
assert.ok(ts.isExpressionStatement(outerStrict) && ts.isStringLiteral(outerStrict.expression));
assert.equal(outerStrict.expression.text, 'use strict');
const focusInit = oneVariable(feedTree, 'repostReturnFocus', siblings);
assert.equal(focusInit.declarationList.declarations.length, 1);
assert.equal(focusInit.declarationList.declarations[0].initializer.kind, ts.SyntaxKind.NullKeyword);
assert.ok(focusInit.pos < closeNode.pos && closeNode.pos < openNode.pos && openNode.pos < submitNode.pos);
const viewerInit = oneVariable(feedTree, '_feedLastViewerKey', siblings);
const accountIndex = siblings.indexOf(accountNode);
assert.equal(siblings[accountIndex - 1], viewerInit);
const eventNodes = siblings.slice(accountIndex + 1, accountIndex + 4);
assert.equal(eventNodes.length, 3);
for (const [i, eventName] of ['lumina:authchange', 'lumina:auth-expired', 'storage'].entries()) {
  const expression = eventNodes[i].expression;
  assert.ok(ts.isExpressionStatement(eventNodes[i]) && ts.isCallExpression(expression));
  assert.equal(expression.expression.getText(feedTree), 'window.addEventListener');
  assert.equal(expression.arguments.length, 2);
  assert.equal(expression.arguments[0].text, eventName);
}
const appParts = ['API_BASE', 'AUTH_STORAGE_KEY', '_refreshCompleted']
  .map(n => oneVariable(appTree, n).getText(appTree));
appParts.push(...['authRequestSession', 'authRequestSessionCurrent', 'apiFetch', 'getAuth',
  'setAuth', 'isLoggedIn', 'getRefreshToken', 'feedEscapeHtml']
  .map(n => oneFunction(appTree, n).getText(appTree)));
const feedParts = ['buildPostShareUrl', 'setPanelStatus', 'feedSubmitErrorMessage',
  'feedViewerKey', 'closeProtectedFeedDetails'].map(n => oneFunction(feedTree, n).getText(feedTree));
const genuine = appParts.join('\n') + '\n(function () {\n' + outerStrict.getText(feedTree) + '\n' +
  feedParts.join('\n') + '\n' +
  feedTree.text.slice(focusInit.getStart(feedTree), submitNode.end) + '\n' +
  [viewerInit, accountNode, ...eventNodes].map(n => n.getText(feedTree)).join('\n') +
  '\nreturn {openRepostModal,closeRepostModal,submitRepost,getAuth,setAuth};\n})();';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const auth = (id, suffix = '1', alias = false) => ({ accessToken: 'synthetic-api-' + id + '-' + suffix,
  refreshToken: 'synthetic-refresh-' + id, user: alias ? { userId: id } : { id } });

function fixture({ listPresent = false, initial = auth(A) } = {}) {
  const calls = { requests: [], fetchAttempts: 0, pending: [], loads: [], renders: 0, warnings: [], refresh: 0,
    protectedClosers: [], storageReads: [], storageWrites: [], events: [] };
  const store = new Map();
  if (initial) store.set('lumina_auth', JSON.stringify(initial));
  const listeners = new Map();
  const bodyClasses = new Set();
  const backdrop = { hidden: true };
  let serial = 0;
  let children = Object.create(null);
  let markup = '';
  const modal = { hidden: true, dataset: {}, isConnected: true };
  const trigger = { isConnected: true, focus() { document.activeElement = trigger; } };
  const document = {
    activeElement: trigger,
    body: { classList: { add(n) { bodyClasses.add(n); }, remove(n) { bodyClasses.delete(n); } } },
    getElementById(id) {
      if (id === 'feedRepostModal') return modal;
      if (id === 'feedRepostBackdrop') return backdrop;
      if (id === 'luminaFeedList' && listPresent) return {};
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
      const child = extra => ({ generation, isConnected: true, dataset: {}, textContent: '',
        hidden: false, addEventListener() {}, focus() { document.activeElement = this; }, ...extra });
      children['[data-feed-repost-input]'] = child({ value: '' });
      children['[data-feed-repost-submit]'] = child({ disabled: false, textContent: 'submit' });
      children['[data-feed-status]'] = child({ hidden: true });
      children['.feed-repost-counter'] = child({});
    },
  });
  modal.querySelector = selector => children[selector] || null;
  modal.contains = element => Object.values(children).includes(element);
  const window = {
    location: { origin: 'https://synthetic.example.test' },
    addEventListener(type, callback) {
      const rows = listeners.get(type) || [];
      rows.push(callback); listeners.set(type, rows);
    },
    dispatchEvent(event) {
      calls.events.push(event.type);
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
    closeFeedPostDetail() { calls.protectedClosers.push('detail'); },
    closeFeedThreadModal() { calls.protectedClosers.push('thread'); },
    closeFeedCommentModal() { calls.protectedClosers.push('comment'); },
  };
  const context = {
    document, window, Event, AbortController, encodeURIComponent, setTimeout, clearTimeout,
    localStorage: {
      getItem(key) { assert.equal(key, 'lumina_auth'); calls.storageReads.push(key); return store.get(key) || null; },
      setItem(key, value) { assert.equal(key, 'lumina_auth'); calls.storageWrites.push(key); store.set(key, value); },
      removeItem(key) { assert.equal(key, 'lumina_auth'); calls.storageWrites.push(key); store.delete(key); },
    },
    fetch(url, options) {
      calls.fetchAttempts++;
      assert.match(url, /^https:\/\/api\.lumina-stage\.com\/api\/v1\/lumina-feed\/posts\/synthetic-post[^/]*\/reposts$/);
      assert.equal(options.method, 'POST');
      let settle;
      const promise = new Promise(resolve => { settle = resolve; });
      const row = { url, method: options.method, headers: { ...options.headers }, body: options.body,
        settled: false, resolve(status = 200) {
          if (row.settled) return;
          row.settled = true;
          settle({ ok: status >= 200 && status < 300, status,
            async json() { return status === 200 ? {} : { message: 'synthetic response failure' }; } });
        } };
      calls.requests.push(row);
      return promise;
    },
    refreshAuthOnce() { calls.refresh++; throw new Error('Unexpected synthetic refresh'); },
    _luminaFeedFilter: 'all', _luminaFeedScope: 'all', _luminaFeedQuery: '',
    _luminaFeedItems: [], _luminaFeedSource: 'synthetic',
    invalidateFeedReads() {},
    executeLuminaFeedSearch() { throw new Error('Unexpected synthetic search'); },
    async loadLuminaFeedData(filter) { calls.loads.push(filter); },
    renderLuminaFeed() { calls.renders++; },
    console: { warn(...args) { calls.warnings.push(args); } },
  };
  const subject = vm.runInNewContext(genuine, context, { timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false } });
  assert.deepEqual([...listeners.keys()], ['lumina:authchange', 'lumina:auth-expired', 'storage']);
  function open(draft = 'synthetic draft', postId = 'synthetic-post') {
    subject.openRepostModal({ postId, body: 'synthetic original', authorName: 'synthetic author' });
    const input = modal.querySelector('[data-feed-repost-input]');
    assert.ok(input, 'known owner can open composer'); input.value = draft;
    return input;
  }
  function submit() {
    const result = subject.submitRepost();
    calls.pending.push(result);
    return result;
  }
  function silent(value) {
    if (value) store.set('lumina_auth', JSON.stringify(value)); else store.delete('lumina_auth');
  }
  function storage(key = 'lumina_auth') { window.dispatchEvent({ type: 'storage', key }); }
  function closed() {
    assert.equal(modal.hidden, true); assert.equal(backdrop.hidden, true);
    assert.equal(modal.innerHTML, ''); assert.equal(modal.dataset.postId || '', '');
    assert.equal(bodyClasses.has('is-feed-repost-open'), false);
  }
  function capture() {
    const input = modal.querySelector('[data-feed-repost-input]');
    const button = modal.querySelector('[data-feed-repost-submit]');
    const status = modal.querySelector('[data-feed-status]');
    return { input, button, status, inputPresent: !!input, hidden: modal.hidden,
      backdropHidden: backdrop.hidden, postId: modal.dataset.postId || '',
      bodyOpen: bodyClasses.has('is-feed-repost-open'), draft: input?.value, busy: modal.dataset.busy,
      disabled: button?.disabled, text: status?.textContent, kind: status?.dataset.kind, markup };
  }
  function unchanged(saved) {
    assert.equal(modal.hidden, false);
    assert.equal(modal.querySelector('[data-feed-repost-input]'), saved.input);
    assert.equal(saved.input.value, saved.draft);
    assert.equal(modal.querySelector('[data-feed-repost-submit]'), saved.button);
    assert.equal(saved.button.disabled, saved.disabled); assert.equal(modal.dataset.busy, saved.busy);
    assert.equal(saved.status.textContent, saved.text); assert.equal(saved.status.dataset.kind, saved.kind);
    assert.equal(markup, saved.markup);
  }
  async function dispose() {
    for (const row of calls.requests) row.resolve();
    await Promise.allSettled(calls.pending);
    assert.equal(calls.fetchAttempts, calls.requests.length, 'invalid fetch attempts cannot disappear');
    assert.equal(calls.refresh, 0);
    assert.equal(calls.storageReads.every(k => k === 'lumina_auth'), true);
    assert.equal(calls.storageWrites.every(k => k === 'lumina_auth'), true);
  }
  return { subject, modal, calls, window, open, submit, silent, storage, closed, capture, unchanged, dispose };
}

test('Same known owner token rotation preserves draft and genuine current-auth submission', async t => {
  for (const alias of [false, true]) {
    const f = fixture({ initial: auth(A, '1', alias) }); t.after(() => f.dispose());
    const input = f.open(alias ? '' : '  synthetic quote  ');
    f.subject.setAuth(auth(A, '2', alias));
    assert.equal(f.modal.querySelector('[data-feed-repost-input]'), input);
    const pending = f.submit();
    await f.submit();
    assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.fetchAttempts, 1);
    const row = f.calls.requests[0];
    assert.equal(row.headers.Authorization, 'Bearer ' + auth(A, '2').accessToken);
    assert.equal(row.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(row.body), alias ? {} : { body: 'synthetic quote' });
    assert.equal(f.modal.innerHTML.includes(A), false);
    assert.equal(f.modal.dataset.busy, '1');
    row.resolve(); await pending;
    f.closed(); assert.deepEqual(f.calls.loads, ['all']); assert.equal(f.calls.renders, 1);
    assert.equal(f.calls.warnings.length, 0);
  }
});

test('Observed account replacement loss and return retire the prior draft before POST', async t => {
  for (const mode of ['authchange', 'storage', 'storage-null', 'expired']) {
    for (const listPresent of [false, true]) {
      const f = fixture({ listPresent }); t.after(() => f.dispose());
      const old = f.open('synthetic prior account draft');
      if (mode === 'authchange') f.subject.setAuth(auth(B));
      else {
        f.silent(mode === 'expired' ? null : auth(B));
        if (mode === 'expired') f.window.dispatchEvent({ type: 'lumina:auth-expired' });
        else f.storage(mode === 'storage-null' ? null : 'lumina_auth');
      }
      const atEvent = Object.freeze(f.capture());
      const pending = f.submit();
      if (f.calls.requests.length) {
        assert.equal(f.calls.requests[0].headers.Authorization, 'Bearer ' + auth(B).accessToken,
          'baseline witness uses current B, never an A credential');
      }
      t.diagnostic(JSON.stringify({ mode, listPresent, eventClosed: atEvent.hidden,
        fetchAttempts: f.calls.fetchAttempts, validRequests: f.calls.requests.length,
        currentBHeader: f.calls.requests.length ?
          f.calls.requests[0].headers.Authorization === 'Bearer ' + auth(B).accessToken : null }));
      assert.equal(atEvent.hidden, true, 'event retirement is observed before submit can mask it');
      assert.equal(atEvent.backdropHidden, true);
      assert.equal(atEvent.inputPresent, false);
      assert.equal(atEvent.markup, '');
      assert.equal(atEvent.postId, '');
      assert.equal(atEvent.bodyOpen, false);
      assert.equal(f.calls.requests.length, 0, 'prior account draft cannot initiate a current-account POST');
      assert.equal(f.calls.fetchAttempts, 0);
      await pending; f.closed(); assert.equal(old.isConnected, false);
      f.subject.setAuth(auth(A, '3')); await f.submit();
      f.closed(); assert.equal(f.calls.requests.length, 0, 'observed A-B-A never revives retired draft');
    }
  }
  for (const listPresent of [false, true]) {
    const aba = fixture({ listPresent }); t.after(() => aba.dispose());
    aba.open('synthetic observed ABA draft');
    aba.subject.setAuth(auth(B));
    const atB = Object.freeze(aba.capture());
    aba.subject.setAuth(auth(A, '3'));
    const returned = Object.freeze(aba.capture());
    const pending = aba.submit();
    assert.equal(atB.hidden, true, 'observed B retires without a B-time submit');
    assert.equal(atB.inputPresent, false);
    assert.equal(returned.hidden, true, 'A return never revives the retired draft');
    assert.equal(returned.inputPresent, false);
    assert.equal(aba.calls.fetchAttempts, 0);
    await pending; aba.closed();
  }
});

test('Explicit submit rejects silent different owner and unknown opening identity without requests', async t => {
  const changed = fixture(); t.after(() => changed.dispose());
  changed.open('synthetic prior draft'); changed.silent(auth(B));
  const pending = changed.submit();
  if (changed.calls.requests.length) {
    assert.equal(changed.calls.requests[0].headers.Authorization, 'Bearer ' + auth(B).accessToken);
  }
  assert.equal(changed.calls.requests.length, 0, 'silent current B is checked before POST');
  assert.equal(changed.calls.fetchAttempts, 0);
  await pending; changed.closed();
  for (const initial of [null, { accessToken: 'synthetic-unknown', user: {} },
    { accessToken: 'synthetic-blank', user: { id: ' ' } }]) {
    const f = fixture({ initial }); t.after(() => f.dispose());
    f.subject.openRepostModal({ postId: 'synthetic-post', body: 'synthetic original' });
    await f.submit(); f.closed(); assert.equal(f.calls.requests.length, 0);
    assert.equal(f.calls.fetchAttempts, 0);
  }
});

test('Already dispatched A completion cannot publish UI effects after silent current B', async t => {
  for (const status of [200, 404]) {
    const f = fixture(); t.after(() => f.dispose());
    f.open('synthetic in-flight draft'); const pending = f.submit();
    assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.requests[0].headers.Authorization, 'Bearer ' + auth(A).accessToken);
    const saved = f.capture(); f.silent(auth(B));
    f.calls.requests[0].resolve(status); await pending;
    f.unchanged(saved); assert.equal(f.calls.loads.length, 0);
    assert.equal(f.calls.renders, 0); assert.equal(f.calls.warnings.length, 0);
    await f.submit(); f.closed(); assert.equal(f.calls.requests.length, 1);
    assert.equal(f.calls.fetchAttempts, 1);
  }
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(p => sha(fs.readFileSync(p))), opening);
});

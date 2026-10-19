'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app.js');
const TS = path.join(ROOT, 'server/node_modules/typescript/lib/typescript.js');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tracked = [APP, TS, __filename];
assert.ok(fs.statSync(APP).size <= 1024 * 1024);
assert.equal(fs.statSync(TS).size, 9112572);
const opening = tracked.map(file => sha(fs.readFileSync(file)));
assert.equal(opening[1], '3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675');

// Same admission body as the closed 583195 EOL oracle; never rewrites a file.
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
const profiles = new Map([
  ['7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61', {
    bytes: 433479, functionBytes: 3053,
    functionSha: '176eaaebddf0abb19afb79a949d8770de9c4a3e10a13cbc5b7de9f71fb0f04a4',
  }],
  ['848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07', {
    bytes: 434541, functionBytes: 4115,
    functionSha: '2e1f2b57478c5a27e35f506f6cbb67a9406a92f5fa4729b5983d67b835bef3ab',
  }],
]);
function admitted(raw) {
  const canonical = canonicalSource(raw);
  const profile = profiles.get(sha(canonical));
  assert.ok(profile, 'only two exact whole app profiles are admitted');
  assert.equal(canonical.length, profile.bytes);
  return { canonical, profile };
}
const physical = fs.readFileSync(APP);
const { canonical, profile } = admitted(physical);
const text = canonical.toString('utf8');
const crlf = Buffer.from(text.replace(/\n/g, '\r\n'));
assert.equal(admitted(crlf).canonical.equals(canonical), true);
assert.equal(admitted(canonical).canonical.equals(canonical), true);
const firstLF = text.indexOf('\n');
assert.ok(firstLF >= 0 && text.indexOf('\n', firstLF + 1) > firstLF);
for (const bad of [
  Buffer.concat([Buffer.from([239, 187, 191]), canonical]),
  Buffer.concat([canonical, Buffer.from([255])]),
  Buffer.from(text.slice(0, firstLF) + '\r' + text.slice(firstLF + 1)),
  Buffer.from(text.slice(0, firstLF) + '\r\n' + text.slice(firstLF + 1)),
  Buffer.concat([canonical, Buffer.from(' ')]),
]) assert.throws(() => admitted(bad));

const ts = require(TS);
const tree = ts.createSourceFile(APP, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
assert.equal(tree.parseDiagnostics.length, 0);
function oneFunction(name) {
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.length, 1, name);
  assert.equal(found[0].parent, tree, name + ' is a top-level declaration');
  return found[0];
}
function oneVariable(name) {
  const found = tree.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === name));
  assert.equal(found.length, 1, name);
  assert.equal(found[0].declarationList.declarations.length, 1, name);
  return found[0];
}
const binder = oneFunction('bindLuminaFeedLike');
assert.equal(Buffer.byteLength(text.slice(0, binder.getStart(tree))), 347042);
const binderBytes = Buffer.from(binder.getText(tree) + '\n');
assert.equal(binderBytes.length, profile.functionBytes);
assert.equal(sha(binderBytes), profile.functionSha);
const authKey = oneVariable('AUTH_STORAGE_KEY');
assert.equal(authKey.declarationList.declarations[0].initializer.text, 'lumina_auth');
const cacheInit = oneVariable('_luminaFeedItems');
assert.ok(ts.isArrayLiteralExpression(cacheInit.declarationList.declarations[0].initializer));
assert.equal(cacheInit.declarationList.declarations[0].initializer.elements.length, 0);
const genuine = [authKey, cacheInit, oneFunction('getAuth'), oneFunction('getAccessToken'),
  oneFunction('feedModalViewerKey'), binder].map(node => node.getText(tree)).join('\n');
const source = genuine + '\n({bind:bindLuminaFeedLike,' +
  'viewer:feedModalViewerKey,getAuth,getAccessToken,' +
  'seed(value){_luminaFeedItems=value;},cache(){return _luminaFeedItems;}});';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const POST = '20000000-0000-4000-8000-000000000001';
const auth = (id, revision = '1', alias = false) => ({
  accessToken: 'synthetic-session-' + id + '-' + revision,
  user: alias ? { userId: id } : { id },
});
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t, { liked = false, count = '0', initial = auth(A) } = {}) {
  const requests = [], alerts = [], warnings = [], tasks = new Set();
  let apiAttempts = 0;
  const store = new Map(initial ? [['lumina_auth', JSON.stringify(initial)]] : []);
  const events = new Map();
  const classNames = new Set(liked ? ['is-liked'] : []);
  const attrs = new Map([['aria-pressed', String(liked)], ['aria-label', 'synthetic-initial']]);
  const countEl = { textContent: count };
  const btn = {
    dataset: { feedLike: POST, busy: '0' }, isConnected: true,
    classList: {
      contains(name) { return classNames.has(name); },
      toggle(name, force) {
        if (force === undefined) force = !classNames.has(name);
        if (force) classNames.add(name); else classNames.delete(name);
        return force;
      },
    },
    setAttribute(name, value) { attrs.set(name, String(value)); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    querySelector(selector) { assert.equal(selector, '[data-feed-like-count]'); return countEl; },
    closest(selector) { assert.equal(selector, '[data-feed-like]'); return this; },
  };
  const clickHandlers = [];
  const document = {
    addEventListener(type, fn) { assert.equal(type, 'click'); clickHandlers.push(fn); },
  };
  const window = {
    addEventListener(type, fn) {
      assert.ok(['lumina:authchange', 'lumina:auth-expired', 'storage'].includes(type));
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(fn);
    },
    removeEventListener(type, fn) { events.get(type)?.delete(fn); },
    dispatchEvent(event) {
      for (const fn of [...(events.get(event.type) || [])]) fn(event);
      return true;
    },
  };
  let subject;
  const apiFetch = (route, options) => {
    apiAttempts++;
    assert.equal(route, '/api/v1/lumina-feed/posts/' + POST + '/like');
    assert.deepEqual(Object.keys(options), ['method', 'auth', 'throwOnError']);
    assert.ok(['POST', 'DELETE'].includes(options.method));
    assert.equal(options.auth, true);
    assert.equal(options.throwOnError, true);
    let resolvePromise, rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const request = {
      route, method: options.method, owner: subject.viewer(), settled: false,
      resolve(value = {}) {
        assert.equal(this.settled, false); this.settled = true; resolvePromise(clone(value));
      },
      reject() {
        assert.equal(this.settled, false); this.settled = true;
        rejectPromise(Object.assign(new Error('synthetic-like-error'), { status: 409, body: { synthetic: true } }));
      },
    };
    requests.push(request);
    return promise;
  };
  const context = vm.createContext({
    document, window, localStorage: { getItem(key) { assert.equal(key, 'lumina_auth'); return store.get(key) ?? null; } },
    apiFetch, alert(message) { alerts.push(String(message)); },
    console: { warn(...args) { warnings.push({ arguments: args.length, status: args[1]?.status ?? null }); } },
  }, { codeGeneration: { strings: false, wasm: false } });
  subject = vm.runInContext(source, context, { timeout: 1000 });
  subject.bind(); subject.bind();
  assert.equal(clickHandlers.length, 1, 'genuine bind idempotence');
  let prevented = 0, stopped = 0;
  const f = {
    subject, requests, alerts, warnings, btn, countEl,
    click() {
      const promise = Promise.resolve(clickHandlers[0]({ target: btn,
        preventDefault() { prevented++; }, stopPropagation() { stopped++; } }));
      tasks.add(promise);
      promise.then(() => tasks.delete(promise), () => tasks.delete(promise));
      return promise;
    },
    switch(value, type = null, key = 'lumina_auth') {
      if (value) store.set('lumina_auth', JSON.stringify(value)); else store.delete('lumina_auth');
      if (type) window.dispatchEvent({ type, key });
    },
    seed(owner, value = 7, hasLiked = false) {
      subject.seed(clone([{ id: POST, likeCount: value, viewer: { hasLiked }, syntheticOwner: owner }]));
    },
    paint(hasLiked, value) {
      btn.classList.toggle('is-liked', hasLiked);
      btn.setAttribute('aria-pressed', String(hasLiked));
      btn.setAttribute('aria-label', 'synthetic-current-view');
      countEl.textContent = String(value);
    },
    capture() {
      return { cache: clone(subject.cache()), liked: btn.classList.contains('is-liked'),
        pressed: btn.getAttribute('aria-pressed'), label: btn.getAttribute('aria-label'),
        count: countEl.textContent, alerts: [...alerts], warnings: clone(warnings) };
    },
    event(type, key = 'lumina_auth') { window.dispatchEvent({ type, key }); },
    listenerCount() { return [...events.values()].reduce((n, set) => n + set.size, 0); },
    settled() {
      assert.equal(btn.dataset.busy, '0');
      assert.equal([...events.values()].reduce((n, set) => n + set.size, 0), 0);
      assert.equal(prevented, stopped);
    },
  };
  f.seed(A, Number(count), liked);
  t.after(async () => {
    // Settlement is cleanup only, never evidence that an unreached assertion ran.
    for (const request of requests) if (!request.settled) request.resolve();
    await Promise.allSettled([...tasks]);
    assert.equal(apiAttempts, requests.length, 'every attempted API call entered its validated stub');
    assert.equal([...events.values()].reduce((n, set) => n + set.size, 0), 0);
  });
  return f;
}
function response(count, liked, nested = false) {
  const post = { id: POST, likeCount: count, viewer: { hasLiked: liked } };
  return nested ? { data: { post } } : { post };
}
function entered(f, length, owner, method) {
  assert.equal(f.requests.length, length, 'API stub entry before any owner transition');
  assert.equal(f.requests[length - 1].owner, owner);
  assert.equal(f.requests[length - 1].method, method);
  assert.equal(f.btn.dataset.busy, '1');
}
function unchanged(f, before) { assert.deepEqual(f.capture(), before, 'late completion cannot publish current-view effects'); }

test('Normal free-feed like keeps POST DELETE intent zero counts duplicate guard and failure rollback', async t => {
  const f = fixture(t);
  let pending = f.click(); entered(f, 1, A, 'POST');
  assert.equal(f.btn.classList.contains('is-liked'), true);
  await f.click(); assert.equal(f.requests.length, 1);
  f.requests[0].resolve(response(0, false)); await pending;
  assert.equal(f.subject.cache()[0].viewer.hasLiked, true);
  assert.equal(f.btn.getAttribute('aria-pressed'), 'true');
  assert.equal(f.countEl.textContent, '0'); f.settled();
  pending = f.click(); entered(f, 2, A, 'DELETE');
  f.requests[1].resolve(response(0, true, true)); await pending;
  assert.equal(f.subject.cache()[0].viewer.hasLiked, false);
  assert.equal(f.btn.getAttribute('aria-pressed'), 'false');
  assert.equal(f.countEl.textContent, '0'); f.settled();
  pending = f.click(); entered(f, 3, A, 'POST');
  f.requests[2].resolve(); await pending;
  assert.equal(f.countEl.textContent, '1'); f.settled();
  f.countEl.textContent = '0';
  pending = f.click(); entered(f, 4, A, 'DELETE');
  f.requests[3].resolve(); await pending;
  assert.equal(f.countEl.textContent, '0', 'fallback DELETE clamps at zero'); f.settled();
  assert.equal(f.alerts.length, 0); assert.equal(f.warnings.length, 0);
  for (const liked of [false, true]) {
    const fail = fixture(t, { liked, count: '4' });
    const before = clone(fail.subject.cache());
    const work = fail.click(); entered(fail, 1, A, liked ? 'DELETE' : 'POST');
    fail.requests[0].reject(); await work;
    assert.equal(fail.btn.classList.contains('is-liked'), liked);
    assert.equal(fail.btn.getAttribute('aria-pressed'), String(liked));
    assert.equal(fail.countEl.textContent, '4');
    assert.deepEqual(clone(fail.subject.cache()), before);
    assert.equal(fail.alerts.length, 1); assert.equal(fail.warnings.length, 1); fail.settled();
  }
  const anonymous = fixture(t, { initial: null });
  await anonymous.click(); assert.equal(anonymous.requests.length, 0);
  assert.equal(anonymous.alerts.length, 1); anonymous.settled();
  t.diagnostic('reached POST/DELETE stale-viewer intent, server zero, fallback/clamp, duplicate, both rollback and anonymous controls');
});

test('A late success cannot mutate B cache button count label or alerts', async t => {
  for (const mode of ['authchange', 'silent']) {
    const f = fixture(t);
    const pending = f.click(); entered(f, 1, A, 'POST');
    f.switch(auth(B), mode === 'authchange' ? 'lumina:authchange' : null);
    f.seed(B); f.paint(false, 7);
    const before = f.capture();
    f.requests[0].resolve(response(99, false)); await pending;
    t.diagnostic(JSON.stringify({ mode, requests: f.requests.length,
      cacheEqual: JSON.stringify(f.capture().cache) === JSON.stringify(before.cache),
      count: f.countEl.textContent, alerts: f.alerts.length }));
    unchanged(f, before); f.settled(); assert.equal(f.requests.length, 1);
  }
});

test('A late failure cannot roll back B button or emit B alert and warning', async t => {
  for (const mode of ['authchange', 'silent']) {
    const f = fixture(t);
    const pending = f.click(); entered(f, 1, A, 'POST');
    f.switch(auth(B), mode === 'authchange' ? 'lumina:authchange' : null);
    f.seed(B, 7, true); f.paint(true, 7);
    const before = f.capture();
    f.requests[0].reject(); await pending;
    t.diagnostic(JSON.stringify({ mode, liked: f.btn.classList.contains('is-liked'),
      alerts: f.alerts.length, warnings: f.warnings.length }));
    unchanged(f, before); f.settled(); assert.equal(f.requests.length, 1);
  }
});

test('Observed A B A and storage clear retire flights but same-owner rotation stays current', async t => {
  for (const mode of ['authchange', 'expired', 'storage-null', 'storage-auth', 'clear']) {
    const f = fixture(t);
    const pending = f.click(); entered(f, 1, A, 'POST');
    if (mode === 'clear') f.switch(null, 'storage', null);
    else if (mode === 'storage-null' || mode === 'storage-auth') {
      f.switch(auth(B), 'storage', mode === 'storage-null' ? null : 'lumina_auth');
    } else f.switch(auth(B), mode === 'expired' ? 'lumina:auth-expired' : 'lumina:authchange');
    f.switch(auth(A, '3'), 'lumina:authchange');
    assert.equal(f.subject.viewer(), A);
    f.seed(A, 7, false); f.paint(false, 7);
    const before = f.capture();
    f.requests[0].resolve(response(99, false)); await pending;
    t.diagnostic(JSON.stringify({ mode, returnedOwnerA: f.subject.viewer() === A,
      count: f.countEl.textContent, cacheEqual: JSON.stringify(f.capture().cache) === JSON.stringify(before.cache) }));
    unchanged(f, before); f.settled();
  }
  const rotation = fixture(t);
  const pending = rotation.click(); entered(rotation, 1, A, 'POST');
  rotation.switch(auth(A, '2', true), 'lumina:authchange');
  assert.equal(rotation.subject.viewer(), A, 'real helper accepts userId alias without token ownership');
  rotation.requests[0].resolve(response(0, false)); await pending;
  assert.equal(rotation.subject.cache()[0].viewer.hasLiked, true);
  assert.equal(rotation.btn.getAttribute('aria-pressed'), 'true');
  assert.equal(rotation.countEl.textContent, '0'); rotation.settled();
  const unrelated = fixture(t);
  const ignored = unrelated.click(); entered(unrelated, 1, A, 'POST');
  unrelated.switch(auth(B), 'storage', 'synthetic-unrelated-key');
  unrelated.switch(auth(A, '2'));
  unrelated.requests[0].resolve(response(0, false)); await ignored;
  assert.equal(unrelated.subject.cache()[0].viewer.hasLiked, true);
  assert.equal(unrelated.countEl.textContent, '0'); unrelated.settled();
  t.diagnostic('reached five retirement modes plus same-ID rotation and unrelated storage-key controls');
});

test('Old finally preserves successor B busy and detached completion has no content effects', async t => {
  const f = fixture(t);
  const old = f.click(); entered(f, 1, A, 'POST');
  f.switch(auth(B), 'lumina:authchange'); f.seed(B); f.paint(false, 7);
  // Explicit synthetic DOM reuse, not a claim that the app performs account reload.
  f.btn.dataset.busy = '0';
  const newer = f.click(); entered(f, 2, B, 'POST');
  const before = f.capture();
  f.requests[0].reject(); await old;
  t.diagnostic(JSON.stringify({ successorBusy: f.btn.dataset.busy,
    requests: f.requests.length, alerts: f.alerts.length, warnings: f.warnings.length }));
  assert.equal(f.btn.dataset.busy, '1', 'old finally cannot release the newer flight');
  assert.equal(f.listenerCount(), 3, 'old cleanup leaves the three B-flight subscriptions');
  unchanged(f, before);
  await f.click(); assert.equal(f.requests.length, 2, 'new B flight still blocks duplicates');
  f.requests[1].resolve(response(0, false)); await newer;
  assert.equal(f.subject.cache()[0].syntheticOwner, B);
  assert.equal(f.subject.cache()[0].viewer.hasLiked, true);
  assert.equal(f.countEl.textContent, '0'); f.settled();
  const detached = fixture(t);
  const work = detached.click(); entered(detached, 1, A, 'POST');
  detached.btn.isConnected = false;
  detached.seed(A, 7, false); detached.paint(false, 7);
  const disconnected = detached.capture();
  detached.requests[0].resolve(response(99, false)); await work;
  unchanged(detached, disconnected); detached.settled();
  t.diagnostic('reached successor-finally ownership, duplicate preservation, B settlement and disconnected DOM fence');
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(file => sha(fs.readFileSync(file))), opening,
    'physical app, TypeScript and test bytes remain unchanged');
});

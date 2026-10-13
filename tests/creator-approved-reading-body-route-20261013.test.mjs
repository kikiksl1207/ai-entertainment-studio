import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Source plan UNRUN: 28 route/scope cases; no body parser/view duplication or live resources.
const read = file => readFileSync(new URL('../pages/' + file, import.meta.url), 'utf8');
const transportSource = read('creator-approved-readonly-transport.js');
const handoffSource = read('creator-approved-reading-handoff.js');
const catalogSource = read('creator-approved-reading-catalog.js');
const entrySource = read('creator-approved-reading-entry.js');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'], options = { timeout: 2500 };
const ownerA = '11111111-1111-4111-8111-111111111111', ownerB = '22222222-2222-4222-8222-222222222222';
const work = 'abcdef12-abcd-4abc-8abc-abcdef123456';
const authA = { accessToken: 'synthetic.A.token', user: { id: ownerA }, refreshToken: 'unused.synthetic.refresh' };
const authB = { accessToken: 'synthetic.B.token', user: { id: ownerB } };
const path = (locale = 'ko') => '/api/v1/me/creator-studio/stories/' + work + '/body-preview?locale=' + locale;
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
function events() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name, fields = {}) { for (const fn of [...listeners.get(name) || []]) fn({ type: name, ...fields }); },
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0) };
}
function response(status = 200) {
  let cancelled = 0;
  return { status, body: { cancel() { cancelled++; return new Promise(() => {}); } }, cancelled: () => cancelled,
    text() { assert.fail('Transport must not consume text'); }, json() { assert.fail('Transport must not parse JSON'); } };
}
function fixture({ auth = authA, send = () => response() } = {}) {
  let currentAuth = auth;
  const calls = [], writes = [], reads = [], eventTarget = events();
  const storage = { getItem(key) { reads.push(key); assert.equal(key, 'lumina_auth'); return currentAuth === null ? null : JSON.stringify(currentAuth); },
    setItem(...args) { writes.push(args); }, removeItem(...args) { writes.push(args); }, clear() { writes.push('clear'); } };
  const originalAuth = () => 'synthetic existing auth', originalApi = Object.freeze({ numericOnly: true });
  const nativeFetch = (url, request) => { calls.push({ url, request }); return send(url, request); };
  const window = { ...eventTarget, localStorage: storage, fetch: nativeFetch, getAuth: originalAuth, LuminaCreatorStudioApi: originalApi };
  vm.runInNewContext(transportSource, { window, AbortController }, { filename: 'actual-readonly-route-transport.js' });
  const factory = window.LuminaCreatorApprovedReadonlyTransport;
  const body = factory.createBody(), numeric = factory.create(), catalog = factory.createCatalog();
  return { body, numeric, catalog, factory, calls, writes, reads, window, originalAuth, originalApi,
    setAuth(value) { currentAuth = value; }, emit: eventTarget.emit, listeners: eventTarget.count,
    close() { body.dispose(); numeric.dispose(); catalog.dispose(); } };
}
const request = (adapter, overrides = {}) => ({ method: 'GET', identity: adapter.identity(), token: adapter.getAuth()?.accessToken,
  _retried: true, cache: 'no-store', headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
  signal: new AbortController().signal, ...overrides });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code && error.message === 'Readonly transport unavailable');
const untouched = f => { assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0); };

test('all actual facades construct and sample without GET storage writes refresh or global replacement', options, () => {
  const f = fixture(); untouched(f); assert.equal(f.reads.length, 0);
  assert(Object.isFrozen(f.factory)); assert(Object.isFrozen(f.body));
  for (const adapter of [f.body, f.numeric, f.catalog]) { adapter.identity(); adapter.getAuth(); adapter.isCurrent(adapter.identity()); }
  untouched(f); assert.equal(f.window.getAuth, f.originalAuth); assert.equal(f.window.LuminaCreatorStudioApi, f.originalApi);
  f.close(); assert.equal(f.listeners(), 0);
});
for (const locale of locales) test(`actual createBody exact lowercase UUID GET for source ${locale}`, options, async () => {
  const reply = response(), f = fixture({ send: () => reply });
  assert.equal(work, work.toLowerCase()); assert.equal(await f.body.fetch(path(locale), request(f.body)), reply);
  assert.equal(f.calls.length, 1); const call = f.calls[0];
  assert.equal(call.url, 'https://api.lumina-stage.com' + path(locale));
  assert.deepEqual(plain(call.request.headers), { Authorization: 'Bearer synthetic.A.token', Accept: 'application/json', 'Cache-Control': 'no-store' });
  assert.equal(call.request.method, 'GET'); assert.equal(call.request.cache, 'no-store'); assert.equal(call.request.credentials, 'omit');
  assert.equal(call.request.redirect, 'error'); assert.equal(call.request.referrerPolicy, 'no-referrer');
  assert.equal(Object.hasOwn(call.request, 'body'), false); assert.equal(Object.hasOwn(call.request, 'token'), false);
  assert.equal(Object.hasOwn(call.request, 'identity'), false); assert.equal(reply.cancelled(), 0); assert.equal(f.writes.length, 0); f.close();
});
for (const name of ['numeric', 'catalog']) test(`actual ${name} facade still rejects every body locale`, options, async () => {
  const f = fixture();
  for (const locale of locales) await rejects(f[name].fetch(path(locale), request(f[name])), 'invalid_request');
  untouched(f); f.close();
});
test('body facade rejects numeric catalog shared API and refresh endpoints', options, async () => {
  const f = fixture();
  for (const url of ['/api/v1/me/creator-studio/stories/' + work + '/generation-profile/approved-section-bytes?measurement=json-utf8-v1',
    '/api/v1/me/creator-studio/approved-reading-catalog?locale=ko&limit=12', '/api/v1/me/creator-studio', '/api/v1/wallet', '/api/v1/auth/refresh']) {
    await rejects(f.body.fetch(url, request(f.body)), 'invalid_request');
  }
  untouched(f); f.close();
});
test('wrong origin path UUID encoding slash or whitespace cannot reach native fetch', options, async () => {
  const f = fixture();
  for (const url of ['https://api.lumina-stage.com' + path(), '//foreign.invalid' + path(), ' ' + path(), path() + '\n',
    path().replace(work, 'not-a-uuid'), path().replace(work, '%61' + work.slice(1)), path().replace('body-preview', 'BODY-preview'),
    path().replace('body-preview?', 'body-preview/?')]) await rejects(f.body.fetch(url, request(f.body)), 'invalid_request');
  untouched(f); f.close();
});
test('missing duplicated encoded foreign or fragment queries cannot widen the five-locale route', options, async () => {
  const f = fixture(), base = path().split('?')[0];
  for (const url of [base, base + '?locale=en-US', base + '?locale=zh', base + '?locale=EN', base + '?locale=%6b%6f',
    base + '?LOCALE=ko', path() + '&locale=en', path() + '&owner=' + ownerA, path() + '&token=synthetic', path() + '#fragment',
    base + '?x=1&locale=ko']) await rejects(f.body.fetch(url, request(f.body)), 'invalid_request');
  untouched(f); f.close();
});
test('POST HEAD lowercase get and other mutations are rejected', options, async () => {
  const f = fixture();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'get']) await rejects(f.body.fetch(path(), request(f.body, { method })), 'invalid_request');
  untouched(f); f.close();
});
test('a body option is rejected even when null or undefined', options, async () => {
  const f = fixture();
  for (const body of [null, undefined, '{}']) await rejects(f.body.fetch(path(), request(f.body, { body })), 'invalid_request');
  untouched(f); f.close();
});
test('headers must be exactly Accept JSON plus Cache-Control no-store without caller bearer override', options, async () => {
  const f = fixture();
  for (const headers of [{ Accept: 'application/json' }, { 'Cache-Control': 'no-store' },
    { Accept: 'text/plain', 'Cache-Control': 'no-store' }, { Accept: 'application/json', 'Cache-Control': 'public' },
    { Accept: 'application/json', 'Cache-Control': 'no-store', Authorization: 'Bearer synthetic.override' },
    { Accept: 'application/json', 'Cache-Control': 'no-store', Cookie: 'synthetic' }]) {
    await rejects(f.body.fetch(path(), request(f.body, { headers })), 'invalid_request');
  }
  untouched(f); f.close();
});
test('retry cache cookies missing signal and unknown options cannot add authority', options, async () => {
  const f = fixture();
  for (const override of [{ _retried: false }, { cache: 'default' }, { auth: false }, { credentials: 'include' }, { signal: null }, { arbitrary: true }]) {
    await rejects(f.body.fetch(path(), request(f.body, override)), 'invalid_request');
  }
  untouched(f); f.close();
});
test('wrong owner own epoch or current token is stale before sending', options, async () => {
  const f = fixture(), owner = f.body.identity();
  for (const override of [{ identity: { ...owner, ownerId: ownerB } }, { identity: { ...owner, epoch: owner.epoch + 1 } }, { token: 'synthetic.foreign' }]) {
    await rejects(f.body.fetch(path(), request(f.body, override)), 'stale');
  }
  untouched(f); f.close();
});
test('refresh-only or missing auth never dispatches GET refresh logout or storage writes', options, async () => {
  const f = fixture({ auth: null });
  for (const auth of [null, { refreshToken: 'synthetic.refresh.only', user: { id: ownerA } }]) {
    f.setAuth(auth); await rejects(f.body.fetch(path(), request(f.body)), 'unauthenticated');
  }
  untouched(f); f.close();
});
test('401 returns unread once with no refresh retry storage write or owner invalidation', options, async () => {
  const reply = response(401), f = fixture({ send: () => reply }), owner = f.body.identity();
  assert.equal(await f.body.fetch(path(), request(f.body)), reply); assert.equal(f.calls.length, 1);
  assert.equal(f.body.isCurrent(owner), true); assert.equal(f.writes.length, 0); assert.equal(reply.cancelled(), 0); f.close();
});
for (const mode of ['owner', 'token']) test(`${mode} A-B-A settles ignored-abort fetch and discards late private headers`, options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), before = f.body.identity();
  const task = rejects(f.body.fetch(path(), request(f.body)), 'stale');
  f.setAuth(mode === 'owner' ? authB : { ...authA, accessToken: 'synthetic.other.token' }); f.emit('lumina:authchange');
  f.setAuth(authA); f.emit('lumina:authchange'); await task;
  assert.equal(f.body.isCurrent(before), false); assert.equal(f.calls[0].request.signal.aborted, true);
  const late = response(); wait.resolve(late); await flush(); assert(late.cancelled() > 0);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); f.close();
});
test('late ownership change without an event is checked again when native headers arrive', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise });
  const task = rejects(f.body.fetch(path(), request(f.body)), 'stale'); f.setAuth(authB);
  const late = response(); wait.resolve(late); await task; await flush();
  assert(late.cancelled() > 0); assert.equal(f.calls[0].request.signal.aborted, true); assert.equal(f.writes.length, 0); f.close();
});
test('already aborted and in-flight caller cancellation cannot send or restore late responses', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), abort = new AbortController(); abort.abort();
  await rejects(f.body.fetch(path(), request(f.body, { signal: abort.signal })), 'stale'); assert.equal(f.calls.length, 0);
  const active = new AbortController(), task = rejects(f.body.fetch(path(), request(f.body, { signal: active.signal })), 'stale');
  active.abort(); await task; const late = response(); wait.resolve(late); await flush();
  assert.equal(f.calls[0].request.signal.aborted, true); assert(late.cancelled() > 0); f.close();
});
test('pagehide disposes only owned facades and settles pending fetch without waiting for native abort', options, async () => {
  const wait = deferred(), f = fixture({ send: () => wait.promise }), task = rejects(f.body.fetch(path(), request(f.body)), 'disposed');
  f.emit('pagehide'); await task; assert.equal(f.listeners(), 0); assert.equal(f.body.identity(), null);
  await rejects(f.body.fetch(path(), request(f.body)), 'disposed');
  const late = response(); wait.resolve(late); await flush(); assert(late.cancelled() > 0); assert.equal(f.writes.length, 0); f.close();
});
test('native failure is sanitized and never triggers a refresh or a second request', options, async () => {
  const f = fixture({ send: () => Promise.reject(new Error('synthetic private detail')) });
  await rejects(f.body.fetch(path(), request(f.body)), 'transport'); assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); f.close();
});

// Reuse the existing lifecycle DOM/auth fixture without importing or registering its suite.
// Browser timer/location globals and the actual handoff replace only synthetic fixture scaffolding.
const lifecycleSource = readFileSync(new URL('./creator-approved-reading-page-lifecycle-20261013.test.mjs', import.meta.url), 'utf8');
const first = lifecycleSource.indexOf('function fixture('), last = lifecycleSource.indexOf('\ntest(', first);
assert(first >= 0 && last > first, 'Existing lifecycle fixture remains bounded');
const scopeSources = [transportSource,
  'window.location.origin = "https://www.lumina-stage.com"; globalThis.location = window.location; window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;',
  handoffSource, catalogSource, entrySource];
const catalogData = { contract: 'story-owner-approved-reading-catalog-v1', sourceScope: 'owner_work_records_only', readOnly: true,
  providerCalls: 0, operatingWrites: 0, items: [{ workId: work, title: { value: 'Synthetic scope work', locale: 'ko', fallback: false, bounded: false },
    defaultLocale: 'ko', recordedState: { workStatus: 'draft', approval: 'not_checked' } }], nextCursor: null };
const pageFixture = vm.runInNewContext(lifecycleSource.slice(first, last) + '\nfixture;', {
  sources: scopeSources, owner: ownerA, work, data: catalogData, vm, AbortController, TextDecoder, Uint8Array, Event, Response, setTimeout, clearTimeout
});
const hide = f => f.window.dispatchEvent({ type: 'pagehide' });
async function select(f) {
  await f.elements.get('readingCatalogLoad').emit('click');
  f.elements.get('readingCatalogWork').value = work; f.elements.get('readingCatalogWork').emit('change');
  return f.window.LuminaCreatorApprovedReadingScope.snapshot();
}
test('actual entry/catalog frozen Scope keeps original source and strict object identity with independent body epoch', options, async () => {
  const f = pageFixture(); assert.equal(f.calls.length, 0);
  f.elements.get('readingLocale').value = 'en'; f.elements.get('readingLocale').emit('change'); assert.equal(f.calls.length, 0);
  const selected = await select(f), scope = f.window.LuminaCreatorApprovedReadingScope;
  assert(Object.isFrozen(scope)); assert(Object.isFrozen(selected));
  assert.deepEqual(Object.keys(scope).sort(), ['isCurrent', 'snapshot', 'validate']);
  assert.deepEqual(Object.keys(selected).sort(), ['ownerId', 'sourceLocale', 'workId', 'workLabel']);
  assert.equal(selected.sourceLocale, 'ko'); assert.equal(f.elements.get('writerManuscriptLocale').value, 'ko');
  assert.equal(scope.isCurrent(selected), true); assert.equal(scope.isCurrent({ ...selected }), false);
  assert.equal(await scope.validate(selected, new AbortController().signal), true);
  assert.equal(await scope.validate({ ...selected }, new AbortController().signal), false);
  const bodyEvents = events(), body = f.window.LuminaCreatorApprovedReadonlyTransport.createBody({ eventTarget: bodyEvents });
  body.identity(); bodyEvents.emit('lumina:authchange'); bodyEvents.emit('lumina:authchange');
  assert.notEqual(body.identity().epoch, f.window.LuminaCreatorStudioApi.identity().epoch);
  assert.equal(scope.isCurrent(selected), true);
  await body.fetch(path(selected.sourceLocale), request(body)); assert.equal(f.calls.length, 2);
  await assert.rejects(f.window.LuminaCreatorStudioApi.fetch(path(), request(body)));
  assert.equal(f.calls.length, 2); body.dispose(); hide(f);
});
test('actual entry Scope rejects prior same-work objects and owner revocation without an automatic GET', options, async () => {
  const f = pageFixture(), old = await select(f), scope = f.window.LuminaCreatorApprovedReadingScope;
  f.elements.get('readingCatalogWork').emit('change'); const next = scope.snapshot();
  assert.notEqual(next, old); assert.equal(scope.isCurrent(old), false); assert.equal(await scope.validate(old, new AbortController().signal), false);
  assert.equal(scope.isCurrent(next), true); f.authChanged(); assert.equal(scope.snapshot(), null);
  assert.equal(await scope.validate(next, new AbortController().signal), false); assert.equal(f.calls.length, 1); hide(f);
});
function openerPage() {
  const messages = [], opener = { closed: false, postMessage(data, origin) { messages.push({ data, origin }); } };
  const f = pageFixture({ opener }), nonce = messages[0].data.nonce, origin = 'https://www.lumina-stage.com';
  const receive = data => f.window.dispatchEvent({ type: 'message', source: opener, origin, data: { nonce, ...data } });
  assert.equal(messages[0].data.type, 'lumina-approved-reading-ready-v1');
  receive({ type: 'lumina-approved-reading-handoff-v1', context: { ownerId: ownerA, workId: work, workLabel: 'Synthetic handoff work', sourceLocale: 'ja' } });
  return { ...f, messages, receive, scope: f.window.LuminaCreatorApprovedReadingScope };
}
test('actual entry/handoff Scope validates the original source through real check/checked RPC without API reads', options, async () => {
  const f = openerPage(), selected = f.scope.snapshot(); assert(Object.isFrozen(selected)); assert.equal(selected.sourceLocale, 'ja');
  assert.equal(await f.scope.validate({ ...selected }, new AbortController().signal), false);
  const pending = f.scope.validate(selected, new AbortController().signal); await flush(); const check = f.messages.at(-1);
  assert.equal(check.data.type, 'lumina-approved-reading-check-v1'); assert.equal(check.origin, 'https://www.lumina-stage.com');
  f.receive({ type: 'lumina-approved-reading-checked-v1', requestId: check.data.requestId, valid: true });
  assert.equal(await pending, true); assert.equal(f.scope.isCurrent(selected), true); assert.equal(f.calls.length, 0); hide(f);
});
test('actual handoff revocation settles pending Scope validation and late checked cannot revive it', options, async () => {
  const f = openerPage(), selected = f.scope.snapshot(), pending = f.scope.validate(selected, new AbortController().signal);
  await flush(); const check = f.messages.at(-1).data; assert.equal(check.type, 'lumina-approved-reading-check-v1'); f.receive({ type: 'lumina-approved-reading-revoked-v1' });
  assert.equal(await pending, false); f.receive({ type: 'lumina-approved-reading-checked-v1', requestId: check.requestId, valid: true });
  assert.equal(f.scope.snapshot(), null); assert.equal(f.scope.isCurrent(selected), false); assert.equal(f.calls.length, 0); hide(f);
});

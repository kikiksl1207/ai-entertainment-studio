import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const authA = { accessToken: 'a-access', refreshToken: 'a-refresh', user: { id: 'owner-a', email: 'a@example.invalid' } };
const authB = { accessToken: 'b-access', refreshToken: 'b-refresh', user: { id: 'owner-b', email: 'b@example.invalid' } };
const rotatedA = { ...authA, accessToken: 'a-new', refreshToken: 'a-new-refresh' };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const bootstrap = (enabled = true, userId = 'owner-a') => ({ access: { enabled }, viewer: { userId }, artists: [], summary: {} });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); }

function fixture({ auth = authA, fetch: request, handoff = null } = {}) {
  const elements = new Map(), listeners = new Map(), timers = new Map(), calls = [];
  const storage = new Map(auth ? [['lumina_auth', JSON.stringify(auth)]] : []);
  let timerId = 0, handoffReads = 0;
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(), handlers = new Map();
      elements.set(id, {
        hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
        classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
          toggle: (value, flag) => flag ? classes.add(value) : classes.delete(value) },
        addEventListener: (name, action) => handlers.set(name, action), click: () => handlers.get('click')?.(),
        setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; },
        querySelectorAll: () => [], querySelector: selector => selector === '[data-studio-retry]' ? element('retry') : null,
        replaceChildren() { this.innerHTML = ''; }, scrollTo() {}, prepend() {},
        reset() { this.resetCount = (this.resetCount || 0) + 1; }
      });
    }
    return elements.get(id);
  }
  const document = {
    body: element('body'), documentElement: { ...element('html'), lang: 'ko' }, getElementById: element,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => element('created')
  };
  const window = { LUMINA_API_BASE: 'https://studio.fixture.invalid',
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); } };
  const context = {
    window, document, URL, URLSearchParams, AbortController, DOMException, FormData, Blob, TextEncoder, TextDecoder,
    API_BASE: 'https://studio.fixture.invalid',
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    sessionStorage: { getItem() { handoffReads++; return handoff ? JSON.stringify(handoff) : null; } },
    location: { hash: '' }, history: { replaceState() {} }, Date, Math, console,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id),
    async fetch(url, options = {}) {
      const call = { path: new URL(url).pathname, ...options }; calls.push(call);
      return await request?.(call) || response({ items: [] });
    }
  };
  const index = source.lastIndexOf('  verify();');
  assert.ok(index > 0);
  vm.runInNewContext(source.slice(0, index) +
    '  window.__access = { verify, fetchStoryIntake, fetchWriterPaste, loadSettlementConversions, loadKnowledgeUrls, loadAiContentRequests, submitStoryIntake };' + source.slice(index + '  verify();'.length), context);
  return { window, element, calls, timers, handoffReads: () => handoffReads,
    auth: () => JSON.parse(storage.get('lumina_auth') || 'null'),
    setAuth(value) { if (value) storage.set('lumina_auth', JSON.stringify(value)); else storage.clear(); },
    dispatch(name, extra = {}) { for (const callback of listeners.get(name) || []) callback({ type: name, ...extra }); },
    fire(delay) { for (const timer of [...timers.values()]) if (timer.delay === delay) timer.callback(); }
  };
}

test('cached handoff cannot bypass current server approval, even with no viewer or future timestamp', async () => {
  const f = fixture({ handoff: { savedAt: Date.now() + 600_000, data: bootstrap() },
    fetch: () => response(bootstrap(false)) });
  await f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioAccessGate').hidden, false);
  assert.equal(f.handoffReads(), 0);
  assert.equal(f.calls.length, 1);
});

test('approved empty creator is admitted only after the server reply', async () => {
  const pending = deferred();
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? pending.promise : response({ items: [] }) });
  const verify = f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, true);
  pending.resolve(response(bootstrap()));
  await verify;
  assert.equal(f.element('studioShell').hidden, false);
  assert.equal(f.element('studioAccessGate').hidden, true);
  assert.equal(f.timers.size, 0);
});

for (const [label, value] of [
  ['missing approval', { artists: [] }], ['string approval', { access: { enabled: 'true' }, artists: [] }],
  ['incomplete payload', { access: { enabled: true } }], ['different viewer', bootstrap(true, 'owner-b')]
]) test(`invalid bootstrap is denied: ${label}`, async () => {
  const f = fixture({ fetch: () => response(value) });
  await f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioGateActions').hidden, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.timers.size, 0);
});

test('anonymous entry does not send a request and clears all check timers', async () => {
  const f = fixture({ auth: null });
  await f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.calls.length, 0);
  assert.equal(f.timers.size, 0);
});

for (const status of [403, 503]) test(`server ${status} preserves a denied, retryable entry`, async () => {
  const f = fixture({ fetch: () => response({}, status) });
  await f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioGateActions').hidden, false);
  assert.equal(f.timers.size, 0);
});

test('latest retry wins and aborts the earlier bootstrap', async () => {
  const first = deferred(); let requests = 0;
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio'
    ? (++requests === 1 ? first.promise : response(bootstrap())) : response({ items: [] }) });
  const old = f.window.__access.verify();
  f.fire(4000);
  assert.equal(f.element('studioGateActions').hidden, false);
  await f.window.__access.verify();
  assert.equal(f.calls[0].signal.aborted, true);
  first.resolve(response({}, 503)); await old;
  assert.equal(f.element('studioShell').hidden, false);
  assert.equal(f.element('studioAccessGate').hidden, true);
  assert.equal(f.timers.size, 0);
});

test('bootstrap JSON arriving after an account switch cannot admit the old owner', async () => {
  const json = deferred();
  const f = fixture({ fetch: () => ({ ok: true, status: 200, json: () => json.promise }) });
  const verify = f.window.__access.verify(); await flush();
  f.setAuth(authB); json.resolve(bootstrap()); await verify;
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioGateActions').hidden, false);
  assert.equal(f.timers.size, 0);
});

test('account change hides an admitted shell, clears the manuscript and requires fresh approval', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap()) : response({ items: [] }) });
  await f.window.__access.verify(); await flush();
  f.element('writerManuscriptBody').value = 'private draft';
  f.setAuth(authB); f.dispatch('storage', { key: 'lumina_auth' });
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('writerManuscriptBody').value, '');
  assert.equal(f.element('writerManuscriptWork').disabled, true);
  assert.equal(f.element('studioGateActions').hidden, false);
});

test('timeout aborts the bootstrap and leaves a retry path', async () => {
  const f = fixture({ fetch: call => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')));
  }) });
  const verify = f.window.__access.verify(); f.fire(12000); await verify;
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioGateActions').hidden, false);
  assert.equal(f.timers.size, 0);
});

test('delayed old-account 401 cannot refresh or resend as the new account', async () => {
  const pending = deferred();
  const f = fixture({ fetch: () => pending.promise });
  const request = f.window.LuminaCreatorStudioApi.fetch('/api/v1/me/creator-studio/stories', { method: 'POST', body: { title: 'private' } });
  const rejected = assert.rejects(request, { name: 'AbortError' });
  f.setAuth(authB); pending.resolve(response({}, 401)); await rejected;
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.auth(), authB);
});

test('concurrent 401 responses share one refresh and delayed 401 uses its completed rotation', async () => {
  const refresh = deferred(), late = deferred(); let refreshCount = 0;
  const f = fixture({ fetch: call => {
    if (call.path === '/api/v1/auth/refresh') { refreshCount++; return refresh.promise; }
    if (call.headers.Authorization === 'Bearer a-new') return response({ ok: true });
    if (call.path.endsWith('/late')) return late.promise;
    return response({}, 401);
  } });
  const identity = f.window.LuminaCreatorStudioApi.identity();
  const first = f.window.LuminaCreatorStudioApi.fetch('/first');
  const second = f.window.LuminaCreatorStudioApi.fetch('/second');
  const delayed = f.window.LuminaCreatorStudioApi.fetch('/late');
  await flush(); assert.equal(refreshCount, 1);
  refresh.resolve(response(rotatedA)); await Promise.all([first, second]);
  late.resolve(response({}, 401)); assert.equal((await delayed).status, 200);
  assert.equal(refreshCount, 1);
  assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
  assert.deepEqual(f.auth(), rotatedA);
});

test('refresh rejection clears only its own session and does not leave the entry checking', async () => {
  const f = fixture({ fetch: () => response({}, 401) });
  await f.window.__access.verify();
  assert.equal(f.auth(), null);
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('studioGateActions').hidden, false);
  assert.equal(f.calls.length, 2, 'one bootstrap and one refresh; no duplicate refresh');
  assert.equal(f.timers.size, 0);
});

for (const status of [200, 401]) test(`late refresh ${status} cannot overwrite or clear a newer login`, async () => {
  const pending = deferred();
  const f = fixture({ fetch: call => call.path === '/api/v1/auth/refresh' ? pending.promise : response({}, 401) });
  const request = f.window.LuminaCreatorStudioApi.fetch('/old');
  const rejected = assert.rejects(request, { name: 'AbortError' }); await flush();
  f.setAuth(authB); pending.resolve(response(rotatedA, status)); await rejected;
  assert.deepEqual(f.auth(), authB);
  assert.equal(f.calls.length, 2);
});

test('refresh with another owner is rejected and the original account is preserved', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/auth/refresh' ? response(authB) : response({}, 401) });
  const result = await f.window.LuminaCreatorStudioApi.fetch('/old');
  assert.equal(result.status, 401);
  assert.deepEqual(f.auth(), authA);
  assert.equal(f.calls.length, 2);
});

test('multipart intake retries the same body and idempotency key only within its original session', async () => {
  const form = new FormData(); form.append('title', 'private fixture');
  const f = fixture({ fetch: call => call.path === '/api/v1/auth/refresh' ? response(rotatedA)
    : response({}, call.headers.Authorization === 'Bearer a-new' ? 200 : 401) });
  assert.equal((await f.window.__access.fetchStoryIntake(form, 'fixture-key')).status, 200);
  const writes = f.calls.filter(call => call.path === '/api/v1/story-upload/intake');
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.equal(call.body, form); assert.equal(call.headers['Idempotency-Key'], 'fixture-key');
    assert.equal(call.headers['Content-Type'], undefined);
  }
});

test('multipart manuscript from an old identity is not sent', async () => {
  const f = fixture(); const identity = f.window.LuminaCreatorStudioApi.identity(); f.setAuth(authB);
  assert.equal(await f.window.__access.fetchWriterPaste('private-work', new FormData(), { identity }), null);
  assert.equal(f.calls.length, 0);
});

test('confirmed shared auth rotation keeps the admitted shell and unsent manuscript', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap()) : response({ items: [] }) });
  await f.window.__access.verify(); await flush();
  const identity = f.window.LuminaCreatorStudioApi.identity();
  f.element('writerManuscriptBody').value = 'private draft';
  f.window.authRequestSession = value => JSON.stringify([value?.user?.id, value?.accessToken, value?.refreshToken]);
  f.window.authRequestSessionCurrent = session => session === f.window.authRequestSession(authA) &&
    JSON.stringify(f.auth()) === JSON.stringify(rotatedA);
  f.setAuth(rotatedA); f.dispatch('lumina:authchange');
  assert.equal(f.element('studioShell').hidden, false);
  assert.equal(f.element('writerManuscriptBody').value, 'private draft');
  assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
});

test('a new login by the same owner is not assumed to be a normal token rotation', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap()) : response({ items: [] }) });
  await f.window.__access.verify(); await flush();
  f.element('writerManuscriptBody').value = 'private draft';
  f.setAuth(rotatedA); f.dispatch('lumina:authchange');
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('writerManuscriptBody').value, '');
});

test('same-origin Studio uses the existing shared refresh helper without starting its own rotation', async () => {
  const f = fixture({ fetch: call => response({}, call.headers.Authorization === 'Bearer a-new' ? 200 : 401) });
  let refreshes = 0;
  f.window.authRequestSession = value => JSON.stringify([value?.user?.id, value?.accessToken, value?.refreshToken]);
  f.window.authRequestSessionCurrent = session => session === f.window.authRequestSession(authA) &&
    JSON.stringify(f.auth()) === JSON.stringify(rotatedA);
  f.window.refreshAuthOnce = async original => {
    refreshes++; assert.equal(original.accessToken, authA.accessToken);
    f.setAuth(rotatedA); return rotatedA;
  };
  const identity = f.window.LuminaCreatorStudioApi.identity();
  assert.equal((await f.window.LuminaCreatorStudioApi.fetch('/shared')).status, 200);
  assert.equal(refreshes, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.window.LuminaCreatorStudioApi.isCurrent(identity), true);
});

test('legacy userId login is normalized before matching the server viewer', async () => {
  const f = fixture({ auth: { accessToken: 'legacy-access', viewer: { userId: 'owner-a' } },
    fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap()) : response({ items: [] }) });
  await f.window.__access.verify();
  assert.equal(f.element('studioShell').hidden, false);
});

test('an older unscoped shared helper is not used for Studio refresh', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/auth/refresh' ? response(rotatedA)
    : response({}, call.headers.Authorization === 'Bearer a-new' ? 200 : 401) });
  f.window.refreshAuthOnce = () => { throw new Error('older helper must not run'); };
  assert.equal((await f.window.LuminaCreatorStudioApi.fetch('/legacy-helper')).status, 200);
  assert.equal(f.calls.filter(call => call.path === '/api/v1/auth/refresh').length, 1);
});

test('a retry rejected with 401 does not start a second refresh loop', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/auth/refresh' ? response(rotatedA) : response({}, 401) });
  assert.equal((await f.window.LuminaCreatorStudioApi.fetch('/rejected')).status, 401);
  assert.equal(f.calls.filter(call => call.path === '/api/v1/auth/refresh').length, 1);
  assert.equal(f.calls.length, 3);
});

for (const [name, endpoint, root] of [
  ['settlement conversions', '/settlement-conversions', 'studioSettlementConversionRows'],
  ['knowledge URLs', '/knowledge-urls', 'knowledgeUrlRows'],
  ['AI request history', '/ai-content-requests', 'studioImageRequestRows']
]) test(`late ${name} JSON cannot repaint the next account`, async () => {
  const json = deferred();
  const f = fixture({ fetch: call => {
    if (call.path === '/api/v1/me/creator-studio') return response({ ...bootstrap(),
      artists: [{ artist: { id: 'fixture-artist', displayName: 'Private artist', assets: [] } }] });
    if (call.path.endsWith(endpoint)) return { ok: true, status: 200, json: () => json.promise };
    return response({ items: [] });
  } });
  await f.window.__access.verify();
  let request;
  if (endpoint === '/ai-content-requests') request = f.window.__access.loadAiContentRequests();
  await flush();
  f.setAuth(authB); f.element(root).innerHTML = 'current account view';
  json.resolve({ items: [{ id: 'old-private-row', note: 'old private data', description: 'old private data' }] });
  await request; await flush();
  assert.equal(f.element(root).innerHTML, 'current account view');
});

function prepareIntake(f) {
  f.element('storyIntakeTitle').value = 'private intake';
  f.element('storyIntakeManuscripts').files = [Object.assign(new Blob(['private source'], { type: 'text/plain' }), { name: 'fixture.txt' })];
}

test('late intake receipt cannot reset the next owner inputs or show a previous private receipt', async () => {
  const json = deferred();
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap())
    : call.path === '/api/v1/story-upload/intake' ? { ok: true, status: 200, json: () => json.promise }
      : response({ items: [] }) });
  await f.window.__access.verify(); await flush(); prepareIntake(f);
  const submit = f.window.__access.submitStoryIntake({ preventDefault() {} }); await flush();
  f.setAuth(authB); f.dispatch('storage', { key: 'lumina_auth' });
  f.element('storyIntakeTitle').value = 'new owner draft';
  json.resolve({ status: 'received', fileCount: 1, receivedAt: new Date().toISOString() }); await submit;
  assert.equal(f.element('storyIntakeTitle').value, 'new owner draft');
  assert.equal(f.element('storyIntakeForm').resetCount, undefined);
  assert.equal(f.element('storyIntakeReceipt').hidden, true);
});

test('double intake submission sends one request and completion restores controls', async () => {
  const pending = deferred();
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap())
    : call.path === '/api/v1/story-upload/intake' ? pending.promise : response({ items: [] }) });
  await f.window.__access.verify(); await flush(); prepareIntake(f);
  const submit = f.window.__access.submitStoryIntake({ preventDefault() {} });
  await f.window.__access.submitStoryIntake({ preventDefault() {} });
  assert.equal(f.calls.filter(call => call.path === '/api/v1/story-upload/intake').length, 1);
  pending.resolve(response({ status: 'received', fileCount: 1 })); await submit;
  assert.equal(f.element('storyIntakeForm').resetCount, 1);
  assert.equal(f.element('storyIntakeSubmit').disabled, false);
});

test('standalone refresh rejection also hides an already admitted shell and clears its draft', async () => {
  const f = fixture({ fetch: call => call.path === '/api/v1/me/creator-studio' ? response(bootstrap())
    : call.path === '/expired' || call.path === '/api/v1/auth/refresh' ? response({}, 401) : response({ items: [] }) });
  await f.window.__access.verify(); await flush();
  f.element('writerManuscriptBody').value = 'private draft';
  await assert.rejects(f.window.LuminaCreatorStudioApi.fetch('/expired'), { name: 'AbortError' });
  assert.equal(f.auth(), null);
  assert.equal(f.element('studioShell').hidden, true);
  assert.equal(f.element('writerManuscriptBody').value, '');
  assert.equal(f.element('studioGateActions').hidden, false);
});

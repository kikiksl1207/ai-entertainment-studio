import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const studioSource = source('pages/creator-studio.js');
const appSource = source('app.js');
const previewSource = source('pages/creator-body-preview.js');
const trialSource = source('pages/creator-body-trial.js');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const auth = (token = 'synthetic-access', owner = id(8)) => ({
  accessToken: token, refreshToken: 'synthetic-refresh', user: { id: owner }
});
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' }
});

function between(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Source boundary missing: ${start}`);
  return text.slice(first, last);
}

// Execute unchanged production auth/API bodies, without unrelated app bootstrap.
const sharedStudio = between(studioSource, '(function guardCreatorStudioAccess() {', '  window.LuminaCreatorManuscript =') + '\n})();';
const refreshStart = appSource.indexOf('let _refreshInFlight =');
const refreshTokenStart = appSource.indexOf('function getRefreshToken(', refreshStart);
const authEnd = appSource.indexOf('\n}', refreshTokenStart) + 2;
assert.ok(refreshStart >= 0 && refreshTokenStart > refreshStart && authEnd > refreshTokenStart);
const sharedAuth = between(appSource, 'const API_BASE =', 'async function apiFetch(') +
  appSource.slice(refreshStart, authEnd);

class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = [];
    this.listeners = new Map(); this.attributes = {}; this.dataset = {};
    this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { contains: key => classes.has(key), add: key => classes.add(key) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    for (const callback of this.listeners.get(event.type) || []) callback(event);
    return true;
  }
}

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

function state() {
  return { contract: 'story-author-body-trial-state-v1', workId: id(1), readOnly: true,
    generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
    state: 'approval_recorded', approval: { id: id(7), expiresAt: '2099-01-01T00:00:00.000Z' },
    budget: { knownActualCostKrw: '0.000000', reservedMaximumCostKrw: '0.000000',
      committedCostKrw: '0.000000', approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '10000.000000',
      requestCount: 0, pendingCount: 0, unknownCostCount: 0, verifiedSharedReuseCount: 0,
      evidenceReadyForBudgetCheck: true } };
}

function preview(position) {
  return { contract: 'story-author-body-preview-v1', workId: id(1), locale: 'ko',
    readOnly: true, imageGenerationStarted: false, progress: {
      progressId: id(2), revision: 4, storyVersion: 1, status: 'active', currentBeatPosition: position,
      scene: { id: id(3), isGenerated: true, title: 'Synthetic scene', endingType: null,
        beats: [1, 2].map(n => ({ id: id(10 + n), position: n, type: 'narration', content: `Synthetic beat ${n}` })) },
      choices: [{ id: id(5), label: 'Synthetic NEXT', routeKind: 'generation_required' }] } };
}

const pending = () => ({ version: 1, ownerId: id(8), workId: id(1), choiceId: id(5), key: 'synthetic-choice-key',
  body: { approvalId: id(7), progressId: id(2), expectedRevision: 4, locale: 'ko' } });
function receipt() {
  return { contract: 'story-author-body-trial-receipt-v1', workId: id(1), choiceId: id(5),
    ...pending().body, sourceRevision: 4, readOnly: true, generationAuthorized: false,
    generationStarted: false, imageGenerationStarted: false, receipt: {
      contract: 'story-author-body-trial-choice-v1', imageGenerationStarted: false, idempotentReplay: true,
      revisionAfterRequest: 5, continuationId: id(6), status: 'queued', generationStarted: true,
      privateInputReturned: false, providerPayloadReturned: false, internalCostReturned: false,
      progressApplied: false, provenance: 'ai_generated', resultGeneratedSceneId: null } };
}

function deferred() {
  let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve };
}

function mounted({ initialAuth = auth(), common = true, position = 0, transport, journal = false } = {}) {
  const window = new Element(), document = new Element(), localStorage = storage(), sessionStorage = storage();
  localStorage.setItem('lumina_auth', JSON.stringify(initialAuth));
  if (journal) sessionStorage.setItem(`lumina:author-body-trial:pending:v1:${id(8)}`, JSON.stringify(pending()));
  const shell = new Element('main', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const work = new Element('select', 'writerManuscriptWork'), locale = new Element('select', 'writerManuscriptLocale');
  const host = new Element('section', 'writerBodyTrial');
  work.value = id(1); locale.value = 'ko'; section.classList.add('is-active');
  const nodes = [shell, section, work, locale];
  document.getElementById = name => nodes.find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  const calls = [], events = [], timers = new Map(); let timerId = 0;
  const dispatch = window.dispatchEvent.bind(window);
  window.dispatchEvent = event => { events.push(event.type); return dispatch(event); };
  window.crypto = { randomUUID: () => id(90) };
  window.luminaI18n = { getLocale: () => 'ko' }; window.sessionStorage = sessionStorage;
  const fixture = { window, document, localStorage, sessionStorage, calls, events,
    getAuth: () => JSON.parse(localStorage.getItem('lumina_auth') || 'null') };
  const context = vm.createContext({ window, document, localStorage, AbortController, DOMException,
    Event, CustomEvent: Event, TextEncoder, TextDecoder, console: { info() {}, warn() {} },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: key => timers.delete(key), fetch: async (url, options) => {
      assert.ok(url.startsWith('https://api.lumina-stage.com/api/v1/'), 'Only mocked production API paths are allowed');
      if (options.signal?.aborted) throw new DOMException('Aborted synthetic request', 'AbortError');
      const call = { url, ...options }; calls.push(call);
      const reply = () => response(url.endsWith('/auth/refresh') ? auth('synthetic-rotated')
        : url.endsWith('/body-trial-state') ? state()
          : url.includes('/body-preview?') ? preview(position)
            : url.includes('/receipt?') ? receipt()
              : url.endsWith('/body-trial/recovery') ? {
                contract: 'story-author-body-trial-recovery-v1', workId: id(1), readOnly: true,
                generationAuthorized: false, generationStarted: false, imageGenerationStarted: false, command: null
              } : {});
      return transport ? transport({ call, reply, fixture }) : reply();
    } });
  vm.runInContext(sharedAuth, context, { filename: 'app.js:production-auth-excerpt' });
  vm.runInContext('Object.assign(window, { getAuth, setAuth, refreshAuthOnce, authRequestSession, authRequestSessionCurrent });', context);
  fixture.setAuth = value => window.setAuth(value);
  if (!common) for (const name of ['refreshAuthOnce', 'authRequestSession', 'authRequestSessionCurrent']) delete window[name];
  vm.runInContext(sharedStudio, context, { filename: 'creator-studio.js:production-shared-api-excerpt' });
  vm.runInContext(previewSource, context, { filename: 'creator-body-preview.js' });
  vm.runInContext(trialSource, context, { filename: 'creator-body-trial.js' });
  nodes.push(host);
  fixture.controller = window.LuminaCreatorBodyTrial.mount(host);
  assert.ok(fixture.controller, 'Use the complete production mount adapter, not an injected fetch');
  assert.equal(calls.length, 0, 'Mount never requests or refreshes automatically');
  fixture.identity = () => window.LuminaCreatorStudioApi.identity();
  fixture.refreshes = () => calls.filter(call => call.url.endsWith('/auth/refresh'));
  fixture.posts = () => calls.filter(call => call.method === 'POST' && !call.url.endsWith('/auth/refresh'));
  return fixture;
}

test('valid GET uses the mounted adapter and shared API without a refresh or write', async () => {
  const view = mounted();
  assert.equal(await view.controller.load(), true);
  assert.equal(view.calls.length, 2); assert.equal(view.refreshes().length, 0); assert.equal(view.posts().length, 0);
  assert.equal(view.controller.snapshot().canRecordRead, true);
  for (const call of view.calls) {
    assert.equal(call.headers.Authorization, 'Bearer synthetic-access');
    assert.equal(call.cache, 'no-store'); assert.equal(call.headers['Cache-Control'], 'no-store');
    assert.equal(call.body, undefined);
  }
});

for (const refreshOnly of [true, false]) test(`shared refresh ${refreshOnly ? 'only' : 'after GET 401'} preserves epoch and invalidates the old ticket`, async () => {
  const view = mounted({ initialAuth: auth(refreshOnly ? null : 'synthetic-expired'), transport: ({ call, reply }) =>
    call.headers.Authorization === 'Bearer synthetic-expired' ? response({}, 401) : reply() });
  const identity = view.identity(), ticket = view.controller.snapshot().ticket;
  assert.equal(await view.controller.load(), false, 'authchange must discard the in-flight read');
  assert.equal(view.getAuth().accessToken, 'synthetic-rotated');
  assert.deepEqual(view.identity(), identity); assert.ok(view.events.includes('lumina:authchange'));
  const stale = view.controller.snapshot();
  assert.ok(stale.ticket > ticket); assert.equal(stale.data, null); assert.equal(stale.canChoose, false);
  assert.equal(await view.controller.load(ticket), false); assert.equal(view.refreshes().length, 1);
  assert.equal(await view.controller.load(stale.ticket), true, 'An explicit new GET uses the refreshed identity');
  assert.equal(view.controller.snapshot().canRecordRead, true); assert.equal(view.refreshes().length, 1);
  assert.equal(view.posts().length, 0);
  assert.ok(view.calls.filter(call => !call.url.endsWith('/auth/refresh')).slice(-2)
    .every(call => call.headers.Authorization === 'Bearer synthetic-rotated'));
});

test('shared Studio fallback refresh-only flow can finish a same-ticket GET without authchange', async () => {
  const view = mounted({ initialAuth: auth(null), common: false });
  const identity = view.identity();
  assert.equal(await view.controller.load(), true); assert.deepEqual(view.identity(), identity);
  assert.equal(view.refreshes().length, 1); assert.equal(view.posts().length, 0);
  assert.equal(view.events.includes('lumina:authchange'), false);
});

test('GET 401 is retried once by the real shared API, never recursively refreshed', async () => {
  const view = mounted({ common: false, transport: ({ call, reply }) =>
    call.url.endsWith('/auth/refresh') ? reply() : response({}, 401) });
  assert.equal(await view.controller.load(), false);
  assert.equal(view.calls.length, 3); assert.equal(view.refreshes().length, 1);
  assert.equal(view.controller.snapshot().messageKey, 'unauthenticated'); assert.equal(view.posts().length, 0);
});

for (const status of [403, 500]) test(`refresh HTTP ${status} clears auth without restoring old content`, async () => {
  const view = mounted({ initialAuth: auth(null), transport: () => response({}, status) });
  assert.equal(await view.controller.load(), false); assert.equal(view.getAuth(), null);
  assert.equal(view.refreshes().length, 1); assert.equal(view.posts().length, 0);
  assert.equal(view.controller.snapshot().data, null); assert.equal(view.controller.snapshot().canChoose, false);
});

test('refresh transport failure cannot authorize or write', async () => {
  const view = mounted({ initialAuth: auth(null), transport: () => { throw new TypeError('Synthetic transport loss'); } });
  assert.equal(await view.controller.load(), false); assert.equal(view.getAuth(), null);
  assert.equal(view.calls.length, 1); assert.equal(view.posts().length, 0); assert.equal(view.controller.snapshot().data, null);
});

test('wrong-owner refresh response is rejected by production common auth', async () => {
  const view = mounted({ initialAuth: auth(null), transport: () => response(auth('synthetic-other', id(9))) });
  assert.equal(await view.controller.load(), false); assert.equal(view.getAuth(), null);
  assert.equal(view.calls.length, 1); assert.equal(view.posts().length, 0); assert.equal(view.controller.snapshot().data, null);
});

test('account switch while refresh is pending cannot store or retry the old identity', async () => {
  const hold = deferred(), started = deferred();
  const view = mounted({ initialAuth: auth(null), transport: ({ call }) => {
    assert.ok(call.url.endsWith('/auth/refresh')); started.resolve(); return hold.promise;
  } });
  const old = view.identity(), loading = view.controller.load(); await started.promise;
  view.setAuth(auth('synthetic-other', id(9))); hold.resolve(response(auth('synthetic-rotated')));
  assert.equal(await loading, false); assert.equal(view.getAuth().user.id, id(9));
  assert.equal(view.getAuth().accessToken, 'synthetic-other'); assert.equal(view.calls.length, 1);
  assert.notEqual(view.identity().epoch, old.epoch); assert.equal(view.posts().length, 0);
  assert.equal(view.controller.snapshot().data, null); assert.equal(view.controller.snapshot().canChoose, false);
});

test('late GET after account switch never restores the old body', async () => {
  const hold = deferred(), started = deferred();
  const view = mounted({ transport: () => { started.resolve(); return hold.promise; } });
  const loading = view.controller.load(); await started.promise;
  view.setAuth(auth('synthetic-other', id(9))); hold.resolve(response(state()));
  assert.equal(await loading, false); assert.equal(view.calls.length, 1);
  assert.equal(view.refreshes().length, 0); assert.equal(view.posts().length, 0); assert.equal(view.controller.snapshot().data, null);
});

for (const operation of ['read', 'choice']) test(`${operation} POST 401 never refreshes or resends`, async () => {
  let rejecting = false;
  const view = mounted({ position: operation === 'read' ? 0 : 2, transport: ({ call, reply }) =>
    rejecting ? response({}, 401) : reply() });
  assert.equal(await view.controller.load(), true); rejecting = true;
  assert.equal(await (operation === 'read' ? view.controller.recordRead() : view.controller.choose(id(5))), false);
  assert.equal(view.posts().length, 1); assert.equal(view.refreshes().length, 0);
  const post = view.posts()[0];
  assert.equal(post.headers.Authorization, 'Bearer synthetic-access');
  assert.deepEqual(JSON.parse(post.body), pending().body, 'The complete mount serializes one structured body');
  assert.match(post.headers['Idempotency-Key'], operation === 'read' ? /^read-/ : /^[A-Za-z0-9._:-]{8,120}$/);
  assert.equal(view.controller.snapshot().messageKey, 'unauthenticated');
  assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(await (operation === 'read' ? view.controller.recordRead() : view.controller.choose(id(5))), false);
  assert.equal(view.posts().length, 1); assert.equal(view.refreshes().length, 0);
});

test('refresh-only auth replacing loaded access never initiates a POST refresh', async () => {
  const view = mounted(); assert.equal(await view.controller.load(), true);
  view.setAuth(auth(null));
  assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.refreshes().length, 0); assert.equal(view.posts().length, 0);
  assert.equal(view.controller.snapshot().data, null);
});

test('restored receipt GET may refresh but keeps the exact journal until a fresh manual GET verifies it', async () => {
  const view = mounted({ initialAuth: auth(null), journal: true });
  const saved = [...view.sessionStorage.values.values()][0];
  assert.equal(await view.controller.retry(), false);
  assert.equal(view.refreshes().length, 1); assert.equal([...view.sessionStorage.values.values()][0], saved);
  assert.equal(view.controller.snapshot().unresolved, true); assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(await view.controller.retry(), true);
  assert.equal(view.sessionStorage.values.size, 0); assert.equal(view.posts().length, 0);
  const read = view.calls.find(call => call.url.includes('/receipt?'));
  assert.equal(read.headers['Idempotency-Key'], pending().key);
  assert.equal(new URL(read.url).searchParams.get('expectedRevision'), '4');
  assert.equal(view.controller.snapshot().receipt.status, 'queued');
});

test('recovery GET refreshes without generating or persisting a replacement command', async () => {
  const view = mounted({ initialAuth: auth(null) });
  assert.equal(await view.controller.recover(), false); assert.equal(await view.controller.recover(), true);
  assert.equal(view.refreshes().length, 1); assert.equal(view.posts().length, 0);
  assert.equal(view.controller.snapshot().messageKey, 'recoveryEmpty'); assert.equal(view.sessionStorage.values.size, 0);
});

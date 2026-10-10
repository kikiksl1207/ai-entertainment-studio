import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { setImmediate as tick } from 'node:timers/promises';

const page = readFileSync(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const shared = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const apiStart = shared.indexOf('async function apiFetch(');
const apiEnd = shared.indexOf('\n/*', apiStart);
assert.ok(apiStart >= 0 && apiEnd > apiStart, 'The actual shared apiFetch function must exist');
const sharedApi = shared.slice(apiStart, apiEnd);
assert.ok(sharedApi.trimEnd().endsWith('}'), 'The complete shared function must be retained');

const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const origin = 'https://api.lumina-stage.com';
const workId = id(1), sceneId = id(2), nextSceneId = id(3);
const ownerA = { user: { id: id(10) }, accessToken: 'synthetic-owner-a' };
const ownerB = { user: { id: id(11) }, accessToken: 'synthetic-owner-b' };
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const drain = async () => { for (let i = 0; i < 6; i++) await tick(); };

function graph(marker = 'CURRENT OWNER A', focus = sceneId) {
  const title = value => ({ value, locale: 'en', fallback: false });
  return {
    vocabulary: ['scene', 'choice', 'branch', 'rejoin', 'ending'],
    part: { id: id(4), seasonKey: 'synthetic-season', actNumber: 1, position: 1,
      status: 'draft', title: title(`${marker} PART`) },
    focus: { id: focus, sceneKey: 'synthetic-focus', position: 1, status: 'draft',
      title: title(`${marker} FOCUS`), endingType: null },
    parents: [],
    choices: [{ id: id(5), choiceKey: 'synthetic-route', label: title(`${marker} ROUTE`),
      targetSceneId: nextSceneId, targetEndingKey: null, routeKind: 'branch',
      explicitRejoin: false, declaredRejoinSceneId: null,
      nextScene: { id: nextSceneId, sceneKey: 'synthetic-next', position: 2,
        status: 'draft', title: title(`${marker} NEXT`), endingType: null } }],
    destinations: [], validation: { status: 'needs_attention', blockingIssueCount: 0, warnings: [] },
    page: { bounded: true, maxChoices: 20, fullGraphIncluded: false },
  };
}

function events() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    removeEventListener(name, callback) {
      listeners.set(name, (listeners.get(name) || []).filter(value => value !== callback));
    },
    emit(name, event = {}) {
      return Promise.all((listeners.get(name) || []).map(callback => callback(event)));
    },
  };
}

// Reuse the small DOM/event pattern of existing story VM fixtures, not browser layout.
function host() {
  let markup = '', nodes = [];
  const decode = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const root = { ...events(), isConnected: true, attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    contains: node => node === root || nodes.includes(node),
    querySelector: selector => nodes.find(node => node.matches(selector)) || null,
    querySelectorAll: selector => nodes.filter(node => node.matches(selector)),
    insertAdjacentHTML(_where, html) { root.innerHTML += html; },
    get innerHTML() { return markup; },
    set innerHTML(value) {
      for (const node of nodes) node.isConnected = false;
      markup = value;
      nodes = Array.from(value.matchAll(/<(button|section|article|h2|strong|small|p|div|span)\b([^>]*)>/g), match => {
        const attrs = Object.fromEntries(Array.from(match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g),
          attribute => [attribute[1], decode(attribute[2] ?? '')]));
        return { tag: match[1], attrs, isConnected: true, disabled: 'disabled' in attrs,
          dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-'))
            .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
          focus() {}, scrollIntoView() {},
          matches(selector) {
            return selector.split(',').some(part => {
              part = part.trim();
              if (part === 'button:disabled') return this.tag === 'button' && this.disabled;
              if (part === this.tag) return true;
              if (part.startsWith('.')) return (attrs.class || '').split(' ').includes(part.slice(1));
              const attribute = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
              return Boolean(attribute && attribute[1] in attrs &&
                (attribute[2] === undefined || attrs[attribute[1]] === attribute[2]));
            });
          },
          closest(selector) { return this.matches(selector) ? this : null; },
        };
      });
    },
    click(selector) {
      const target = root.querySelector(selector);
      assert.ok(target, `Missing actual rendered control ${selector}`);
      assert.equal(target.disabled, false);
      return root.emit('click', { target, preventDefault() {} });
    },
  };
  return root;
}

function response(body, status = 200, json = async () => clone(body)) {
  return { status, ok: status >= 200 && status < 300, json };
}

function fixture({ hold, initial } = {}) {
  const root = host(), window = events(), calls = [], prohibited = [], historyCalls = [];
  const timers = new Map(), storage = new Map();
  let auth = clone(ownerA), timerId = 0, storageWrites = 0;
  const pending = hold ? { gate: deferred(), entered: false } : null;
  const location = { origin: 'https://fixture.invalid', pathname: '/story-stage',
    search: `?workId=${workId}`, href: `https://fixture.invalid/story-stage?workId=${workId}` };
  const history = {
    replaceState(_state, _title, value) {
      historyCalls.push(value);
      const next = new URL(value, location.href);
      location.href = next.href; location.search = next.search; location.pathname = next.pathname;
    },
  };
  Object.assign(window, { getAuth: () => auth, isLoggedIn: () => Boolean(auth?.accessToken),
    luminaI18n: { getLocale: () => 'en' }, location, history, scrollY: 0, scrollTo() {} });
  const document = { ...events(), activeElement: null,
    getElementById: name => name === 'storyStageRoot' ? root : null, querySelector: () => null,
    body: { classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} } } };
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const call = { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams),
      method: options.method || 'GET', owner: auth?.user?.id || '', headers: options.headers,
      body: options.body, signal: options.signal };
    calls.push(call);
    if (parsed.origin !== origin || call.path !== `/api/v1/stories/${workId}/graph` || call.method !== 'GET') {
      prohibited.push({ path: call.path, method: call.method });
      throw new Error('Unexpected synthetic request; no native network is available');
    }
    if (calls.length === 1 && pending) {
      if (hold === 'fetch') { pending.entered = true; return pending.gate.promise; }
      return response(null, 200, () => { pending.entered = true; return pending.gate.promise; });
    }
    if (calls.length === 1 && initial === 'http') {
      return response({ message: 'INTERNAL_SYNTHETIC_DIAGNOSTIC' }, 503);
    }
    if (calls.length === 1 && initial === 'json') {
      return response(null, 200, async () => { throw new Error('INTERNAL_SYNTHETIC_DIAGNOSTIC'); });
    }
    return response(graph('CURRENT OWNER A', call.query.focusSceneId || sceneId));
  };
  const context = { window, document, location, history, URL, URLSearchParams, AbortController,
    API_BASE: origin, getAuth: () => auth, fetch,
    refreshAuthOnce() { assert.fail('Refresh is outside this synthetic graph boundary'); },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(value) { timers.delete(value); },
    sessionStorage: { getItem: key => storage.get(key) ?? null,
      setItem(key, value) { storageWrites++; storage.set(key, value); },
      removeItem(key) { storageWrites++; storage.delete(key); } },
  };
  // Only shared apiFetch is extracted. The page IIFE, bootstrap, handlers and render are unmodified.
  // Shared refresh/auth UI and server authorization are not executed; identity and fetch are synthetic.
  runInNewContext(sharedApi + '\nwindow.apiFetch = apiFetch;\n' + page, context, { timeout: 1000 });
  return { root, calls, prohibited, historyCalls, location,
    setAuth(value) { auth = value ? clone(value) : null; },
    emit: (name, event = {}) => window.emit(name, event),
    async held() { await drain(); assert.equal(pending?.entered, true, 'The requested stage must actually be pending'); },
    async complete(outcome = 'success', marker = 'OLD PRIVATE OWNER A') {
      if (outcome === 'failure') pending.gate.reject(new Error('INTERNAL_SYNTHETIC_DIAGNOSTIC'));
      else pending.gate.resolve(hold === 'fetch' ? response(graph(marker)) : graph(marker));
      await drain();
    },
    onlyGraph(expected) {
      assert.equal(calls.length, expected, 'No automatic account refresh, replay or extra read');
      assert.deepEqual(prohibited, []);
      assert.ok(calls.every(call => call.method === 'GET' && call.path === `/api/v1/stories/${workId}/graph`));
      assert.ok(calls.every(call => call.body === undefined));
      assert.equal(storageWrites, 0);
    },
  };
}

const boundaries = ['logout', 'account', 'expired', 'storage'];
async function change(f, boundary) {
  f.setAuth(boundary === 'account' || boundary === 'storage' ? ownerB : null);
  await f.emit(boundary === 'expired' ? 'lumina:auth-expired'
    : boundary === 'storage' ? 'storage' : 'lumina:authchange',
  boundary === 'storage' ? { key: 'lumina_auth' } : {});
  await drain();
}
function noGraph(f) {
  assert.equal(f.root.querySelector('.story-graph-preview'), null, 'No previous-owner protected graph remains mounted');
  assert.doesNotMatch(f.root.innerHTML, /OLD PRIVATE OWNER A|CURRENT OWNER A/);
}

test('graph current account: full IIFE mounts the owner graph and bound focus requests the actual target', async () => {
  const f = fixture();
  await drain();
  assert.ok(f.root.querySelector('.story-graph-preview'));
  for (const field of ['PART', 'FOCUS', 'ROUTE', 'NEXT']) assert.ok(f.root.innerHTML.includes(`CURRENT OWNER A ${field}`));
  assert.deepEqual(f.calls[0].query, { locale: 'en' });
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${ownerA.accessToken}`);
  assert.equal(f.calls[0].owner, ownerA.user.id);
  assert.equal(f.location.search, `?workId=${workId}`);
  await f.root.click('[data-story-graph-focus]');
  await drain();
  assert.deepEqual(f.calls[1].query, { locale: 'en', focusSceneId: nextSceneId });
  assert.equal(new URLSearchParams(f.location.search).get('focusSceneId'), nextSceneId);
  assert.ok(f.root.querySelector('.story-graph-preview'));
  f.onlyGraph(2);
});

for (const boundary of boundaries) for (const stage of ['fetch', 'json']) for (const outcome of ['success', 'failure']) {
  const red = boundary === 'logout' && stage === 'fetch' && outcome === 'success';
  test(red ? 'GRAPH-ACCOUNT-RED held graph GET after logout must not render the previous owner'
    : `graph current account: ${boundary} fences delayed ${stage} ${outcome} without a new read`, async () => {
    const f = fixture({ hold: stage });
    await f.held();
    assert.equal(f.calls[0].owner, ownerA.user.id);
    await change(f, boundary);
    f.onlyGraph(1);
    const markup = f.root.innerHTML, history = [...f.historyCalls], search = f.location.search;
    await f.complete(outcome);
    noGraph(f);
    assert.equal(f.root.innerHTML, markup, 'A stale success/failure cannot overwrite the current boundary notice');
    assert.deepEqual(f.historyCalls, history, 'A stale response cannot rewrite current navigation');
    assert.equal(f.location.search, search);
    assert.doesNotMatch(f.root.innerHTML, /INTERNAL_SYNTHETIC_DIAGNOSTIC/);
    f.onlyGraph(1);
  });
}

for (const boundary of boundaries) {
  test(`graph current account: ${boundary} removes an already displayed private graph without reloading`, async () => {
    const f = fixture();
    await drain();
    assert.ok(f.root.querySelector('.story-graph-preview'));
    await change(f, boundary);
    noGraph(f);
    f.onlyGraph(1);
  });
}

test('graph current account: A to B to A cannot revive an earlier A response', async () => {
  const f = fixture({ hold: 'json' });
  await f.held();
  await change(f, 'account');
  f.setAuth(ownerA);
  await f.emit('lumina:authchange');
  const markup = f.root.innerHTML, history = [...f.historyCalls];
  await f.complete();
  noGraph(f);
  assert.equal(f.root.innerHTML, markup);
  assert.deepEqual(f.historyCalls, history);
  f.onlyGraph(1);
});

test('graph current account: same-owner token rotation keeps the pending and displayed graph without refetch', async () => {
  const f = fixture({ hold: 'fetch' });
  await f.held();
  f.setAuth({ ...ownerA, accessToken: 'synthetic-owner-a-rotated' });
  await f.emit('lumina:authchange');
  await f.complete('success', 'CURRENT OWNER A');
  assert.ok(f.root.querySelector('.story-graph-preview'));
  const markup = f.root.innerHTML, history = [...f.historyCalls];
  await f.emit('lumina:authchange');
  await f.emit('storage', { key: 'lumina_auth' });
  await drain();
  assert.equal(f.root.innerHTML, markup);
  assert.deepEqual(f.historyCalls, history);
  f.onlyGraph(1);
});

test('graph current account: unrelated storage does not discard a pending or displayed current graph', async () => {
  const f = fixture({ hold: 'json' });
  await f.held();
  await f.emit('storage', { key: 'unrelated_synthetic_key' });
  await f.complete('success', 'CURRENT OWNER A');
  assert.ok(f.root.querySelector('.story-graph-preview'));
  const markup = f.root.innerHTML;
  await f.emit('storage', { key: 'unrelated_synthetic_key' });
  await drain();
  assert.equal(f.root.innerHTML, markup);
  f.onlyGraph(1);
});

for (const initial of ['http', 'json']) {
  test(`graph current account: current ${initial} failure stays retryable and only an explicit bound retry reads again`, async () => {
    const f = fixture({ initial });
    await drain();
    assert.ok(f.root.querySelector('[data-story-retry]'));
    assert.equal(f.root.querySelector('.story-graph-preview'), null);
    assert.match(f.root.innerHTML, /branch preview could not be loaded/);
    assert.doesNotMatch(f.root.innerHTML, /INTERNAL_SYNTHETIC_DIAGNOSTIC/);
    f.onlyGraph(1);
    await f.root.click('[data-story-retry]');
    await drain();
    assert.ok(f.root.querySelector('.story-graph-preview'));
    assert.ok(f.root.innerHTML.includes('CURRENT OWNER A FOCUS'));
    assert.deepEqual(f.calls[1].query, { locale: 'en' });
    assert.equal(f.calls[1].owner, ownerA.user.id);
    f.onlyGraph(2);
  });
}

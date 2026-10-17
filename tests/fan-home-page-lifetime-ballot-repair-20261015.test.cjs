'use strict';
// Author UNRUN. Whole product module with synthetic DOM/auth/transport only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

const PINS = Object.freeze({
  baseline: Object.freeze({
    'pages/fan-engagement.js': 'fdecbe54b129676f8c55a6dc375eaf927c494cfd23a6a568d57a340a8c417d80',
    'index.html': '07ddf80dd8221154e133a379caef92c73447e7407767c26c6f302f308ca4fbce',
  }),
  ballotBaseline: Object.freeze({
    'pages/fan-engagement.js': '2792f7483659c50e2cbeb33fd95983f09500d0018d4f00100752d0135a50b80b',
    'index.html': 'bd40a03763570c50c9d6652f8eb6318bbcbecbdc4cd0ce5575bf4fa9aff633cb',
  }),
  focused: Object.freeze({
    'pages/fan-engagement.js': 'a97c6f60a07046e789469a0518d03553c0cee5ce4d4ef0b1e25cf230b1e172bf',
    'index.html': '3e68d763daac5d9fad73737baed6d3a577c86aac6a3861b4f25bef021b3336e9',
  }),
});
const phase = process.env.FAN_HOME_LIFETIME_PHASE || 'focused';
assert(Object.hasOwn(PINS, phase));
const sourceRoot = path.resolve(process.env.FAN_HOME_LIFETIME_SOURCE_ROOT || path.join(__dirname, '..'));
if (process.env.FAN_HOME_LIFETIME_SOURCE_ROOT) {
  const shared = ['E:/Codex/LuminaStage/ai-entertainment-studio-git', 'E:/Codex/LuminaStage/story-completion-20261003'];
  assert(!shared.some(root => path.resolve(root).toLowerCase() === sourceRoot.toLowerCase()), 'shared source is not admitted');
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readSource(file, rawPin) {
  const bytes = readFileSync(path.join(sourceRoot, file));
  assert(bytes.length > 0 && bytes.length <= 131072);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert(!text.startsWith('\uFEFF'), 'unexpected source BOM');
  assert(Buffer.from(text).equals(bytes));
  const lf = text.replace(/\r\n/g, '\n');
  assert(!lf.includes('\r'));
  if (text.includes('\r')) assert.equal(text, lf.replace(/\n/g, '\r\n'));
  assert.equal(sha(Buffer.from(lf)), PINS[phase][file], file);
  if (rawPin) assert.equal(sha(bytes), rawPin, 'explicit raw source pin');
  return lf;
}
const source = readSource('pages/fan-engagement.js', process.env.FAN_HOME_LIFETIME_JS_SHA);
const html = readSource('index.html', process.env.FAN_HOME_LIFETIME_HTML_SHA);
assert.equal((html.match(/id="homeMissionTeaser"/g) || []).length, 1);
const cacheVersion = phase === 'baseline' ? '20261013-home-mission-deadline-v1' : '20261015-home-page-lifetime-v1';
assert.equal((html.match(/<script src="\/pages\/fan-engagement\.js\?v=[^"]+"><\/script>/g) || []).length, 1);
assert(html.includes('<script src="/pages/fan-engagement.js?v=' + cacheVersion + '"></script>'));

const missionId = '11111111-1111-4111-8111-111111111111';
const otherMissionId = '22222222-2222-4222-8222-222222222222';
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const listUrl = 'https://api.lumina-stage.com/api/v1/fan-engagement/missions?surface=home&scope=today&take=3';
const postUrl = `https://api.lumina-stage.com/api/v1/fan-engagement/missions/${missionId}/participations`;
const auth = (token = 'synthetic-access-a', id = userId) => ({ user: { id }, accessToken: token });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

function mission(extra = {}) {
  return { id: missionId, missionType: 'daily_signal', resetPolicy: 'daily', status: 'active',
    participation: { status: 'not_started', remainingCount: 1 },
    rewardPreview: { points: 5, cashLike: false },
    action: { type: 'mission_participation', method: 'POST', endpoint: postUrl.replace('https://api.lumina-stage.com', ''),
      requiresAuth: true, bodyHint: { action: 'complete', idempotencyKey: 'client-generated-key' } },
    ...extra };
}
const completed = extra => mission({ participation: { status: 'accepted', remainingCount: 0 }, ...extra });
const receipt = extra => ({ participation: { id: '33333333-3333-4333-8333-333333333333', missionId, status: 'accepted' },
  rewards: { pointsGranted: 99999 }, idempotentReplay: false, ...extra });

function response(url, data, status = 200, readGate) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let consumed = false, cancelled = false;
  return { ok: status >= 200 && status < 300, status, url,
    body: {
      async cancel() { cancelled = true; },
      getReader() {
        return {
          async read() {
            if (readGate) await readGate;
            if (consumed || cancelled) return { done: true };
            consumed = true; return { done: false, value: bytes };
          },
          async cancel() { cancelled = true; }
        };
      }
    } };
}

function harness({ account = auth(), items = [mission()], get, post, cryptoMissing = false,
  readyState = 'complete', missingAuthReader = false } = {}) {
  const windowHandlers = new Map(), rootHandlers = new Map(), documentHandlers = new Map(), timers = new Map();
  const calls = [], attributes = {}, root = { dataset: {}, isConnected: true, innerHTML: '',
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, fn) { rootHandlers.set(name, fn); },
    contains(button) { return button.root === root; } };
  let currentAuth = account, serverItems = items, keyCount = 0, timerId = 0;
  let getHandler = get, postHandler = post;
  const window = {
    crypto: cryptoMissing ? {} : { randomUUID() { return `00000000-0000-4000-8000-${String(++keyCount).padStart(12, '0')}`; } },
    addEventListener(name, fn) { windowHandlers.set(name, fn); }
  };
  const context = vm.createContext({ window,
    document: { visibilityState: 'visible', readyState,
      getElementById(id) { return id === 'homeMissionTeaser' ? root : null; },
      addEventListener(name, handler, options) { documentHandlers.set(name, { handler, once: options?.once }); } },
    getAuth: missingAuthReader ? undefined : () => currentAuth, AbortController, TextDecoder, Uint8Array,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) {
      calls.push({ url, options });
      if (options.method === 'GET') return Promise.resolve(getHandler
        ? getHandler(url, options) : response(url, { generatedAt: '2026-10-12T14:59:00.000Z', items: serverItems }));
      if (postHandler) return Promise.resolve(postHandler(url, options));
      serverItems = [completed()]; return Promise.resolve(response(url, receipt()));
    }
  });
  vm.runInContext(source, context, { filename: 'fan-engagement.js' });
  function button(id) {
    const selector = id === null ? 'data-home-missions-refresh' : `data-mission-participate="${id}"`;
    const opening = [...root.innerHTML.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).find(text => text.includes(selector));
    if (!opening) return null;
    return { root, disabled: /\sdisabled(?:\s|>)/.test(opening), dataset: { missionParticipate: id },
      closest() { return this; }, hasAttribute(name) { return id === null && name === 'data-home-missions-refresh'; } };
  }
  function click(id = missionId, trusted = true) {
    const target = button(id);
    if (!target) return false;
    rootHandlers.get('click')({ isTrusted: trusted, target, preventDefault() {} }); return true;
  }
  return { root, calls, attributes, button, click, context,
    get keyCount() { return keyCount; },
    setItems(value) { serverItems = value; },
    setGet(value) { getHandler = value; },
    setPost(value) { postHandler = value; },
    setAuth(value, emit = true) { currentAuth = value; if (emit) windowHandlers.get('lumina:authchange')(); },
    emit(name, event = {}) { windowHandlers.get(name)?.(event); },
    installAuthReader() { context.getAuth = () => currentAuth; },
    domReady() {
      context.document.readyState = 'interactive';
      const item = documentHandlers.get('DOMContentLoaded');
      if (item?.once) documentHandlers.delete('DOMContentLoaded');
      item?.handler();
    },
    expire() { for (const fn of [...timers.values()]) fn(); },
    posts() { return calls.filter(call => call.options.method === 'POST'); },
    gets() { return calls.filter(call => call.options.method === 'GET'); }
  };
}


test('01 daily pagehide retires pending POST and keeps its unresolved key', { concurrency: false, timeout: 15000 }, async () => {
  for (const boundary of ['headers', 'body']) {
    const old = deferred(), retry = deferred();
    const h = harness({ post: () => boundary === 'headers' ? old.promise : response(postUrl, receipt(), 200, old.promise) });
    await flush();
    assert.equal(h.gets().length, 1); assert.equal(h.button(missionId).disabled, false);
    h.click(); h.click(); await flush();
    assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
    const first = h.posts()[0], key = JSON.parse(first.options.body).idempotencyKey;
    assert.equal(first.options.signal.aborted, false);
    assert.match(h.root.innerHTML, /is-pending/);

    h.context.document.visibilityState = 'hidden'; h.emit('pagehide'); await flush();
    assert.equal(first.options.signal.aborted, true, 'FAN_PAGEHIDE_POST_NOT_ABORTED');
    assert.match(h.root.innerHTML, /is-indeterminate/);
    h.emit('focus'); h.emit('lumina:authchange'); h.click(); await flush();
    assert.equal(h.gets().length, 1, 'hidden HOME must not dispatch a follow-up GET');
    assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);

    h.context.document.visibilityState = 'visible'; h.emit('pageshow', { persisted: true }); await flush();
    assert.equal(h.gets().length, 2); assert.equal(h.posts().length, 1);
    assert.match(h.root.innerHTML, /is-indeterminate/);
    h.setPost(() => retry.promise); h.click(); await flush();
    assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1);
    assert.equal(JSON.parse(h.posts()[1].options.body).idempotencyKey, key);
    assert.match(h.root.innerHTML, /is-pending/);

    // Neither deferred transport observes abort; release the old result after a new flight exists.
    old.resolve(boundary === 'headers' ? response(postUrl, receipt()) : undefined); await flush();
    assert.equal(h.gets().length, 2); assert.equal(h.posts().length, 2);
    assert.equal(h.posts()[1].options.signal.aborted, false);
    assert.match(h.root.innerHTML, /is-pending/, 'old completion must not overwrite the current retry');
    assert.equal(h.keyCount, 1);

    h.setItems([completed()]); retry.resolve(response(postUrl, receipt())); await flush();
    assert.equal(h.gets().length, 3); assert.equal(h.posts().length, 2);
    assert.equal(h.button(missionId).disabled, true); assert.match(h.root.innerHTML, /is-completed/);
    assert.doesNotMatch(h.root.innerHTML, /99999/); assert.equal(h.keyCount, 1);
  }
});

test('02 pagehide retires HOME GET and late finalizers cannot replace restored reads', { concurrency: false, timeout: 15000 }, async () => {
  for (const boundary of ['headers', 'body']) {
    const old = deferred(), fresh = deferred();
    const h = harness({ get: () => boundary === 'headers' ? old.promise :
      response(listUrl, { items: [mission()] }, 200, old.promise) });
    await flush();
    assert.equal(h.gets().length, 1); assert.equal(h.root.dataset.state, 'loading');
    const first = h.gets()[0];
    h.context.document.visibilityState = 'hidden'; h.emit('pagehide'); await flush();
    assert.equal(first.options.signal.aborted, true, 'FAN_PAGEHIDE_GET_NOT_ABORTED');
    h.emit('focus'); h.emit('lumina:authchange'); await flush();
    assert.equal(h.gets().length, 1);

    h.setGet(() => fresh.promise);
    h.context.document.visibilityState = 'visible'; h.emit('pageshow', { persisted: true }); await flush();
    assert.equal(h.gets().length, 2); assert.equal(h.root.dataset.state, 'loading');
    const current = h.gets()[1];
    old.resolve(boundary === 'headers' ? response(listUrl, { items: [mission()] }) : undefined); await flush();
    assert.equal(h.root.dataset.state, 'loading', 'old HOME response must not paint the restored document');
    assert.equal(current.options.signal.aborted, false);
    assert.equal(h.gets().length, 2); assert.equal(h.posts().length, 0);

    fresh.resolve(response(listUrl, { items: [completed()] })); await flush();
    assert.equal(h.root.dataset.state, 'loaded'); assert.match(h.root.innerHTML, /is-completed/);
    assert.equal(h.button(missionId).disabled, true);
    assert.equal(h.gets().length, 2); assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
  }
});

function ballotFixture() {
  const missionId = '11111111-1111-4111-8111-111111111111';
  const voteId = '22222222-2222-4222-8222-222222222222';
  const artistId = '33333333-3333-4333-8333-333333333333';
  const otherId = '44444444-4444-4444-8444-444444444444';
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const url = `https://api.lumina-stage.com/api/v1/fan-engagement/concept-votes?status=active&locale=ko&take=20&artistId=${artistId}`;
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  function mission(extra = {}) {
    return { id: missionId, artist: { id: artistId }, missionType: 'vote_concept', status: 'active',
      participation: { status: 'not_started', remainingCount: 1 },
      action: { type: 'concept_vote', method: 'POST', requiresAuth: true,
        endpoint: `/api/v1/fan-engagement/concept-votes/${voteId}/ballots`, bodyHint: { missionId } }, ...extra };
  }
  function option(number, label = `공개 선택지 ${number}`) {
    return { id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, '0')}`, optionKey: `option-${number}`,
      labels: { ko: { label } }, sortOrder: number };
  }
  function vote(extra = {}) {
    return { id: voteId, artist: { id: artistId }, status: 'active', visibility: 'public',
      viewer: { hasVoted: false, selectedOptionId: null }, resultsPreview: null,
      mission: { id: missionId, participationStatus: 'not_started' }, options: [option(1), option(2)], ...extra };
  }
  const data = items => ({ locale: 'ko', generatedAt: '2026-10-12T05:00:00.000Z', items });
  function response(address, body, { status = 200, type = 'application/json; charset=utf-8', gate, headers = {} } = {}) {
    const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
    let read = false, cancelled = false;
    return { ok: status >= 200 && status < 300, status, url: address, headers: { get(name) {
      if (Object.hasOwn(headers, name)) return headers[name];
      return name === 'content-type' ? type : name === 'cache-control' ? 'private, no-store' : name === 'vary' ? 'Authorization' : null;
    } },
      body: { async cancel() { cancelled = true; }, getReader() { return {
        async read() { if (gate) await gate; if (read || cancelled) return { done: true }; read = true; return { done: false, value: bytes }; },
        async cancel() { cancelled = true; }
      }; } } };
  }
  function harness({ items = [mission()], account = null, concept = address => response(address, data([vote()])),
    ownedConcept, post, get, cryptoMissing = false } = {}) {
    const handlers = new Map(), rootHandlers = new Map(), timers = new Map(), calls = [], controls = new Map();
    let html = '', context, renderCount = 0;
    const root = { isConnected: true, dataset: {}, setAttribute() {},
      addEventListener(name, fn) { rootHandlers.set(name, fn); }, contains(element) { return element?.root === root; },
      get innerHTML() { return html; }, set innerHTML(value) { html = value; renderCount++; controls.clear(); if (context) context.document.activeElement = null; },
      querySelector(selector) {
        const opening = [...html.matchAll(/<(?:button|input)\b[^>]*>/g)].map(match => match[0]).find(text =>
          [...selector.matchAll(/\[([^=]+)="([^"]+)"\]/g)].every(match => text.includes(`${match[1]}="${match[2]}"`)));
        if (!opening) return null;
        if (!controls.has(opening)) {
          const attributes = Object.fromEntries([...opening.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
          const element = { root, attributes, type: attributes.type, value: attributes.value,
            disabled: /\sdisabled(?:\s|>)/.test(opening), checked: /\schecked(?:\s|>)/.test(opening),
            dataset: { conceptOption: attributes['data-concept-option'], conceptSubmit: attributes['data-concept-submit'],
              missionParticipate: attributes['data-mission-participate'] },
            hasAttribute(name) { return Object.hasOwn(attributes, name); },
            setAttribute(name, value) { attributes[name] = String(value); }, closest() { return this; } };
          controls.set(opening, element);
        }
        return controls.get(opening);
      } };
    let currentAuth = account, currentItems = items, nextTimer = 0, reader = concept, ownerReader = ownedConcept, writer = post, missionReader = get, keyCount = 0;
    context = vm.createContext({ window: { location: { href: 'https://www.lumina-stage.com/' },
      crypto: cryptoMissing ? {} : { randomUUID() { return `00000000-0000-4000-8000-${String(++keyCount).padStart(12, '0')}`; } },
      addEventListener(name, fn) { handlers.set(name, fn); } },
      document: { readyState: 'complete', visibilityState: 'visible', activeElement: null, documentElement: { lang: 'ko' }, getElementById() { return root; } },
      getAuth: () => currentAuth, AbortController, TextDecoder, Uint8Array,
      setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
      fetch(address, options) { calls.push({ address, options });
        if (options.method === 'POST') return Promise.resolve(writer ? writer(address, options) : Promise.reject(new Error('No synthetic write is permitted')));
        if (options.method !== 'GET') throw new Error('Unexpected synthetic method');
        return Promise.resolve(address.includes('/concept-votes?')
          ? (options.headers.Authorization && ownerReader ? ownerReader : reader)(address, options)
          : missionReader ? missionReader(address, options) : response(address, { items: currentItems })); }
    });
    vm.runInContext(source, context, { filename: 'fan-engagement.js' });
    return { root, calls, context, emit(name, event = {}) { handlers.get(name)?.(event); },
      setItems(value) { currentItems = value; }, setConcept(value) { reader = value; },
      setOwnedConcept(value) { ownerReader = value; }, setPost(value) { writer = value; }, setGet(value) { missionReader = value; },
      setAuth(value, emit = true) { currentAuth = value; if (emit) handlers.get('lumina:authchange')(); },
      expire() { for (const fn of [...timers.values()]) fn(); },
      concepts() { return calls.filter(call => call.address.includes('/concept-votes?')); },
      posts() { return calls.filter(call => call.options.method === 'POST'); },
      get keyCount() { return keyCount; },
      get renderCount() { return renderCount; },
      get timerCount() { return timers.size; },
      button(id = missionId, general = false) { return root.querySelector(`[data-${general ? 'mission-participate' : 'concept-submit'}="${id}"]`); },
      radio(id, forMission = missionId) { return root.querySelector(`[data-concept-option="${forMission}"][value="${id}"]`); },
      select(id, trusted = true) {
        const target = this.radio(id); if (!target) return false;
        target.checked = true; context.document.activeElement = target;
        rootHandlers.get('change')?.({ isTrusted: trusted, target }); return true;
      },
      click(id = missionId, trusted = true, general = false) {
        const target = this.button(id, general); if (!target) return false;
        rootHandlers.get('click')?.({ isTrusted: trusted, target, preventDefault() {} }); return true;
      }, dispatch(name, event) { rootHandlers.get(name)?.(event); } };
  }
  const hasState = (h, state) => h.root.innerHTML.includes(`data-concept-state="${state}"`);
  const noExamples = h => { for (const label of ['무대 의상', '화보 무드', '숏폼 콘셉트']) assert(!h.root.innerHTML.includes(label)); };

  const auth = (token = 'synthetic-ballot-token', id = userId) => ({ user: { id }, accessToken: token });
  function ballotMission(extra = {}) {
    return mission({ resetPolicy: 'once', action: { type: 'concept_vote', method: 'POST', requiresAuth: true,
      endpoint: `/api/v1/fan-engagement/concept-votes/${voteId}/ballots`,
      bodyHint: { optionId: 'uuid', missionId, idempotencyKey: 'client-generated-key' } }, ...extra });
  }
  function completedMission() { return ballotMission({ participation: { status: 'accepted', remainingCount: 0 } }); }
  function ballotReceipt(body, extra = {}) {
    return { ballot: { id: otherId, voteId, optionId: body.optionId },
      viewer: { hasVoted: true, selectedOptionId: body.optionId },
      missionParticipation: { id: otherId, missionId, status: 'accepted' },
      rewards: { pointsGranted: 99999 }, idempotentReplay: false, ...extra };
  }
  function ballotHarness({ items = [ballotMission()], options = [option(1), option(2)], account = auth(),
    concept, ownedConcept, post, get, cryptoMissing = false } = {}) {
    let stored = null, h;
    const owned = address => response(address, data([vote({ options,
      viewer: { hasVoted: stored !== null, selectedOptionId: stored },
      resultsPreview: stored === null ? null : { visible: true, totalBallots: 1, options: [] } })]));
    h = harness({ items, account, cryptoMissing, get,
      concept: concept || (address => response(address, data([vote({ options })]))),
      ownedConcept: ownedConcept || owned, post: post || ((address, request) => {
        const body = JSON.parse(request.body); stored = body.optionId; h.setItems([completedMission()]);
        return response(address, ballotReceipt(body), { status: 201 });
      }) });
    h.store = value => { stored = value; }; h.ownerReply = owned;
    return h;
  }
  return { harness: ballotHarness, response, ballotReceipt, completedMission, option, flush };
}

test('03 retired ballot finally cannot mutate a restored same-key retry', { concurrency: false, timeout: 15000 }, async () => {
  for (const boundary of ['headers', 'body']) {
    for (const outcome of ['success', 'rejection']) {
      const b = ballotFixture(), old = deferred(), retry = deferred();
      let originalAddress, originalBody;
      const h = b.harness({ post: (address, request) => {
        originalAddress = address; originalBody = JSON.parse(request.body);
        return boundary === 'headers' ? old.promise :
          b.response(address, b.ballotReceipt(originalBody), { status: 201, gate: old.promise });
      } });
      await b.flush();
      assert.equal(h.posts().length, 0); assert.equal(h.keyCount, 0);
      assert.equal(h.select(b.option(2).id), true);
      assert.equal(h.button().disabled, false);
      h.click(); await b.flush();
      assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
      const first = h.posts()[0], firstBody = JSON.parse(first.options.body);
      assert.match(h.root.innerHTML, /is-pending/);

      h.context.document.visibilityState = 'hidden'; h.emit('pagehide'); await b.flush();
      assert.equal(first.options.signal.aborted, true);
      h.context.document.visibilityState = 'visible'; h.emit('pageshow', { persisted: true }); await b.flush();
      assert.equal(h.posts().length, 1); assert.equal(h.keyCount, 1);
      assert.equal(h.radio(b.option(2).id).checked, true);
      assert.equal(h.button().disabled, false);
      h.setPost(() => retry.promise); h.click(); await b.flush();
      assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1);
      const current = h.posts()[1], currentBody = JSON.parse(current.options.body);
      assert.deepEqual(currentBody, firstBody, 'only an explicit same-body/key retry is permitted');
      assert.match(h.root.innerHTML, /is-pending/);
      const beforeCalls = h.calls.length, beforeRenders = h.renderCount;
      assert.equal(h.timerCount, 2, 'old and current ballot timers are separately owned');

      if (outcome === 'rejection') old.reject(new Error('synthetic retired transport rejection'));
      else old.resolve(boundary === 'headers' ?
        b.response(originalAddress, b.ballotReceipt(originalBody), { status: 201 }) : undefined);
      await b.flush();
      assert.match(h.root.innerHTML, /is-pending/, 'FAN_BALLOT_RETIRED_FINALIZER_CHANGED_PENDING_RETRY');
      assert.equal(h.renderCount, beforeRenders, 'a retired ballot must not rerender the restored page');
      assert.equal(h.calls.length, beforeCalls, 'a retired ballot must not dispatch a follow-up read');
      assert.equal(current.options.signal.aborted, false); assert.equal(h.timerCount, 1);
      assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1);

      h.store(currentBody.optionId); h.setItems([b.completedMission()]);
      retry.resolve(b.response(current.address, b.ballotReceipt(currentBody), { status: 201 })); await b.flush();
      assert.match(h.root.innerHTML, /is-completed/); assert.equal(h.button().disabled, true);
      assert.equal(h.posts().length, 2); assert.equal(h.keyCount, 1); assert.equal(h.timerCount, 0);
      assert.doesNotMatch(h.root.innerHTML, /99999/);
    }
  }
});

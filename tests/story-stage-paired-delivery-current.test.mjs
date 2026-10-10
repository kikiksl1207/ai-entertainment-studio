import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

// QA-only: no page bootstrap, transport, credentials, provider, or server imports.
// A parent runner may point the single auth-expired case at preserved original
// bytes using STORY_STAGE_PAIRED_SOURCE_FILE and optionally pin those raw bytes
// with STORY_STAGE_PAIRED_SOURCE_SHA256. Missing new helpers are not a RED oracle.
const sourceFile = process.env.STORY_STAGE_PAIRED_SOURCE_FILE ||
  new URL('../pages/story-stage.js', import.meta.url);
const sourceBytes = await readFile(sourceFile);
const pageSource = sourceBytes.toString('utf8');
export const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
export const caseCount = 7;
const expectedPin = process.env.STORY_STAGE_PAIRED_SOURCE_SHA256;
if (expectedPin !== undefined) {
  assert.match(expectedPin, /^[a-f0-9]{64}$/i, 'expected source pin must be a raw SHA256');
  assert.equal(sourceSha256, expectedPin.toLowerCase(), 'source override pin mismatch');
}

const IDS = Object.freeze({
  session: '11111111-1111-4111-8111-111111111111',
  otherSession: '22222222-2222-4222-8222-222222222222',
  work: '33333333-3333-4333-8333-333333333333',
  user: '44444444-4444-4444-8444-444444444444',
  otherUser: '55555555-5555-4555-8555-555555555555',
  scene: '66666666-6666-4666-8666-666666666666',
});

function range(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, 'missing source range start: ' + start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, 'missing source range end: ' + end);
  const body = source.slice(from, to);
  assert.match(body.trimEnd(), /(?:\}|};|\);)$/, 'incomplete source function/registration range');
  return body;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

async function drain() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

// Whole function ranges keep the original and current implementations intact.
// Only surrounding layout/other operation effects are synthetic; paired,
// loading/block rendering, loadScene and event callbacks are the actual source.
export function createPairedHarness(source = pageSource) {
  const pieces = [
    range(source, '  const state = {', '  const READER_COPY = {'),
    range(source, '  function readerIdentity(', '  function purchaseQuote('),
    range(source, '  function signedIn(', '  function detailAction('),
    range(source, '  function safeSessionId(', '  function requestId('),
    range(source, '  function renderLoading(', '  function coverUrl('),
    range(source, '  function pairedDeliveryPending(', '  function renderScene('),
    range(source, '  function blockScene(', '  function progressPath('),
    range(source, '  function currentRequest(', '  function cancelAiPolling('),
    range(source, '  async function loadScene(', '  function graphTitle('),
    range(source, '  function refreshStoryAccount(', '  window.addEventListener("lumina:authchange"'),
    range(source, '  root.addEventListener("click"', '  root.addEventListener("input"'),
    range(source, '  window.addEventListener("lumina:localechange"', '  window.addEventListener("lumina:auth-expired"'),
    range(source, '  window.addEventListener("lumina:auth-expired"', '  function refreshStoryAccount('),
    range(source, '  window.addEventListener("lumina:authchange"', '\n  updateHeading();'),
  ];
  let state;
  let identity = IDS.user;
  let loggedIn = true;
  let locale = 'en';
  let clock = 1000;
  let html = '';
  let domWrites = 0;
  let timerSequence = 0;
  let blockedCalls = 0;
  let restoreAiOperationCalls = 0;
  const timers = new Map();
  const windowEvents = new Map();
  const rootEvents = new Map();
  const requests = [];
  const posts = [];
  const gets = [];
  const unexpectedRequests = [];
  const loadErrors = [];

  const listen = (events, name, callback) => {
    const callbacks = events.get(name) || [];
    callbacks.push(callback);
    events.set(name, callbacks);
  };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); domWrites += 1; },
    insertAdjacentHTML(_position, value) { html += String(value); domWrites += 1; },
    querySelector: () => null,
    addEventListener: (name, callback) => listen(rootEvents, name, callback),
  };
  const location = {
    search: '?sessionId=' + IDS.session + '&workId=' + IDS.work,
    href: 'https://synthetic.invalid/story-stage?sessionId=' + IDS.session + '&workId=' + IDS.work,
  };
  function denyExternal() {
    blockedCalls += 1;
    throw new Error('synthetic harness forbids external transport');
  }
  const window = {
    isLoggedIn: () => loggedIn,
    getAuth: () => ({ user: { id: identity } }),
    addEventListener: (name, callback) => listen(windowEvents, name, callback),
    apiFetch: denyExternal,
    fetch: denyExternal,
  };
  function request(path, options) {
    const entry = { path, options: plain(options) };
    requests.push(entry);
    const postPath = '/api/v1/me/story-progress/' + state.sessionId + '/scene-visual';
    const getPath = '/api/v1/story-sessions/' + state.sessionId +
      '/current-scene?locale=' + encodeURIComponent(state.locale);
    if (path === postPath && options?.method === 'POST') {
      const pending = deferred();
      const record = {
        ...entry,
        settled: false,
        resolve(value) {
          assert.equal(record.settled, false, 'synthetic POST settled twice');
          record.settled = true;
          pending.resolve(value);
        },
        reject(error) {
          assert.equal(record.settled, false, 'synthetic POST settled twice');
          record.settled = true;
          pending.reject(error);
        },
      };
      posts.push(record);
      return pending.promise;
    }
    if (path === getPath && options?.method === undefined) {
      gets.push(entry);
      return Promise.resolve({
        progressId: state.sessionId,
        workId: state.workId,
        revision: 9,
        status: 'active',
        choices: [],
        scene: { id: IDS.scene, sceneKey: 'synthetic-current-ready', deliveryState: 'ready' },
      });
    }
    unexpectedRequests.push(path);
    throw new Error('unexpected synthetic request');
  }
  const noop = () => {};
  const sandbox = {
    window, root, location, URLSearchParams, URL, request,
    Date: { now: () => clock },
    fetch: denyExternal, XMLHttpRequest: denyExternal, WebSocket: denyExternal,
    resolveLocale: () => locale,
    tr: (key) => key,
    controlTr: (key) => key,
    escapeHtml: (value) => String(value),
    setTimeout(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, { callback, delay, cancelled: false, fired: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      assert.ok(timer, 'only synthetic timer IDs may be cleared');
      timer.cancelled = true;
    },
    // No paired state/key/timer ownership is implemented in these layout stubs.
    renderScene() { root.innerHTML = '<section data-synthetic-current-view></section>'; },
    readControls: async () => null,
    errorCode: (error) => error?.code || '',
    errorCopy(error) { loadErrors.push(error); return 'synthetic-load-error'; },
    setBusy(value) { state.busy = value; },
    cancelEndingRead: noop,
    cancelCanonicalRead: noop,
    cancelAiPolling: noop,
    cancelBeatNavigation: noop,
    resetParticipantPicker: noop,
    rememberReadingScroll: noop,
    restoreAiOperation() { restoreAiOperationCalls += 1; },
    updateHeading: noop,
  };
  const api = runInNewContext(pieces.join('\n') +
    '\n({ state, ensurePairedSceneVisual, renderPairedDelivery, loadScene, blockScene })',
  sandbox, { filename: 'story-stage.paired-source-functions.js', timeout: 1000 });
  state = api.state;
  const initialScene = {
    id: IDS.scene, sceneKey: 'synthetic-paired-pending', deliveryState: 'artwork_pending',
  };
  Object.assign(state, {
    epoch: 1,
    scene: initialScene,
    sceneIdentity: IDS.user,
    progress: { revision: 7, status: 'active' },
    pairedVisualSceneKey: initialScene.sceneKey,
    pairedVisualStartedAt: clock,
  });

  async function emitWindow(name, event = {}) {
    const callbacks = windowEvents.get(name);
    assert.ok(callbacks?.length, 'actual window callback was not registered: ' + name);
    for (const callback of callbacks) await callback(event);
    await drain();
  }
  async function clickPairedRetry() {
    const callbacks = rootEvents.get('click');
    assert.equal(callbacks?.length, 1, 'actual root click callback must be registered once');
    const target = { closest: (selector) => selector === '[data-story-paired-retry]' ? {} : null };
    await callbacks[0]({ target });
    await drain();
  }
  const activeTimerIds = () => [...timers.entries()]
    .filter(([, timer]) => !timer.cancelled && !timer.fired).map(([id]) => id);
  async function fireTimer(id, { queuedBeforeCancel = false } = {}) {
    const timer = timers.get(id);
    assert.ok(timer, 'timer must have been scheduled by actual source');
    assert.equal(timer.fired, false, 'synthetic timer fired twice');
    if (!queuedBeforeCancel) assert.equal(timer.cancelled, false, 'timer was cancelled');
    timer.fired = true;
    timer.callback();
    await drain();
  }
  function snapshot() {
    return {
      data: plain(state),
      scene: state.scene,
      progress: state.progress,
      operation: state.pairedVisualOperation ?? null,
      html,
      domWrites,
      requests: requests.length,
      timers: timers.size,
      activeTimers: activeTimerIds().length,
    };
  }
  function assertUnchanged(before, label) {
    const after = snapshot();
    assert.deepEqual(after.data, before.data, label + ': stale state mutation');
    assert.equal(after.scene, before.scene, label + ': scene identity changed');
    assert.equal(after.progress, before.progress, label + ': progress identity changed');
    assert.equal(after.operation, before.operation, label + ': operation ownership changed');
    assert.equal(after.html, before.html, label + ': stale DOM changed');
    assert.equal(after.domWrites, before.domWrites, label + ': stale DOM write');
    assert.equal(after.requests, before.requests, label + ': stale GET/POST');
    assert.equal(after.timers, before.timers, label + ': stale timer scheduled');
    assert.equal(after.activeTimers, before.activeTimers, label + ': stale timer ownership');
  }
  function assertContracts() {
    assert.equal(blockedCalls, 0, 'no external transport attempt');
    assert.deepEqual(unexpectedRequests, [], 'no unrelated route dispatch');
    assert.deepEqual(loadErrors, [], 'actual current-scene projection must complete');
    for (const post of posts) {
      assert.deepEqual(post.options, {
        method: 'POST', auth: true, body: { sourceSceneKey: initialScene.sceneKey },
      }, 'existing paired POST auth/body stays exact; no signal/retry/authority is added');
    }
    for (const get of gets) assert.deepEqual(get.options, { auth: true });
  }
  async function dispose() {
    // These are fake promises/timers, not process/window listeners or real handles.
    for (const post of posts) if (!post.settled) post.resolve({ status: 'unavailable' });
    await drain();
    timers.clear();
    assertContracts();
  }
  return {
    ...api, initialScene, posts, gets, requests, timers, root,
    emitWindow, clickPairedRetry, activeTimerIds, fireTimer, snapshot,
    assertUnchanged, assertContracts, dispose,
    get restoreAiOperationCalls() { return restoreAiOperationCalls; },
    setLoggedIn(value) { loggedIn = value; },
    setIdentity(value) { identity = value; },
    setLocale(value) { locale = value; },
    advance(milliseconds) { clock += milliseconds; },
    setSessionLocation(sessionId) {
      location.search = '?sessionId=' + sessionId + '&workId=' + IDS.work;
      location.href = 'https://synthetic.invalid/story-stage' + location.search;
    },
  };
}

function useHarness(t) {
  const h = createPairedHarness();
  t.after(() => h.dispose());
  return h;
}

test('paired current: processing/ready control retains one POST and owned refresh', async (t) => {
  for (const status of ['processing', 'ready']) {
    const h = useHarness(t);
    const task = h.ensurePairedSceneVisual(h.initialScene);
    await h.ensurePairedSceneVisual(h.initialScene);
    assert.equal(h.posts.length, 1, 'an in-flight current operation deduplicates the POST');
    const operation = h.state.pairedVisualOperation;
    assert.ok(operation);
    assert.equal(operation.scene, h.initialScene);
    assert.deepEqual(plain({
      epoch: operation.epoch, sessionId: operation.sessionId, sceneKey: operation.sceneKey,
      identity: operation.identity, locale: operation.locale, workId: operation.workId,
      workIdClaim: operation.workIdClaim, revision: operation.revision,
    }), {
      epoch: 1, sessionId: IDS.session, sceneKey: h.initialScene.sceneKey,
      identity: IDS.user, locale: 'en', workId: IDS.work, workIdClaim: IDS.work, revision: 7,
    });
    h.posts[0].resolve({ status });
    await task;
    if (status === 'processing') {
      assert.equal(h.gets.length, 0);
      const ids = h.activeTimerIds();
      assert.equal(ids.length, 1);
      assert.equal(h.timers.get(ids[0]).delay, 1800);
      assert.equal(operation.timer, ids[0]);
      await h.fireTimer(ids[0]);
    } else {
      assert.equal(h.timers.size, 0);
      assert.equal(h.state.pairedVisualStatus, 'idle');
    }
    assert.equal(h.gets.length, 1);
    assert.equal(h.posts.length, 1, 'refresh never replays the POST');
    assert.equal(h.state.scene.sceneKey, 'synthetic-current-ready');
    assert.equal(h.state.progress.revision, 9);
    assert.equal(h.state.pairedVisualOperation, null);
    assert.equal(h.state.visualRequestKey, '');
    assert.equal(h.activeTimerIds().length, 0);
    h.assertContracts();
  }
});

// Authentic baseline RED: preserved 40D5FFBD... source can run this case alone.
// Actual OLD ensure + auth-expired + blockScene run; the delayed catch overwrites
// the login block. No new-helper call/assertion is needed for that reproduction.
test('paired current: auth-expired delayed catch cannot replace the login block [baseline-race]', async (t) => {
  const h = useHarness(t);
  h.state.pairedVisualTransportFailures = 1;
  const task = h.ensurePairedSceneVisual(h.initialScene);
  assert.equal(h.posts.length, 1);
  h.setLoggedIn(false);
  await h.emitWindow('lumina:auth-expired');
  assert.equal(h.state.scene, null, 'actual auth-expired block cleared the scene');
  assert.ok(h.state.epoch > 1);
  assert.match(h.root.innerHTML, /loginRequired/);
  assert.doesNotMatch(h.root.innerHTML, /data-story-paired-retry/);
  const blocked = h.snapshot();
  h.posts[0].reject(new Error('synthetic delayed transport failure'));
  await task;
  await drain();
  h.assertUnchanged(blocked, 'auth-expired delayed catch');
  assert.doesNotMatch(h.root.innerHTML, /data-story-paired-retry/);
  assert.equal(h.gets.length, 0);
});

test('paired current: account replacement rejects an old ready response', async (t) => {
  const h = useHarness(t);
  const task = h.ensurePairedSceneVisual(h.initialScene);
  h.setIdentity(IDS.otherUser);
  await h.emitWindow('lumina:authchange');
  assert.equal(h.state.authIdentity, IDS.otherUser);
  assert.equal(h.state.sceneIdentity, IDS.otherUser);
  assert.equal(h.state.scene.sceneKey, 'synthetic-current-ready');
  assert.equal(h.gets.length, 1);
  h.state.visualRequestKey = 'ordinary:new-account-view';
  const replacement = h.snapshot();
  h.posts[0].resolve({ status: 'ready' });
  await task;
  await drain();
  h.assertUnchanged(replacement, 'replacement reader');
  assert.equal(h.posts.length, 1);
});

test('paired current: locale replacement fences an already queued processing timer', async (t) => {
  const h = useHarness(t);
  const task = h.ensurePairedSceneVisual(h.initialScene);
  h.posts[0].resolve({ status: 'processing' });
  await task;
  const ids = h.activeTimerIds();
  assert.equal(ids.length, 1);
  h.setLocale('ja');
  await h.emitWindow('lumina:localechange');
  assert.equal(h.state.locale, 'ja');
  assert.equal(h.state.scene.sceneKey, 'synthetic-current-ready');
  assert.equal(h.gets.length, 1);
  assert.match(h.gets[0].path, /\?locale=ja$/);
  assert.equal(h.timers.get(ids[0]).cancelled, true);
  h.state.visualRequestKey = 'ordinary:new-locale-view';
  const replacement = h.snapshot();
  await h.fireTimer(ids[0], { queuedBeforeCancel: true });
  h.assertUnchanged(replacement, 'queued old-locale refresh');
});

test('paired current: same-session/key leave-return cannot revive an old epoch', async (t) => {
  const h = useHarness(t);
  const task = h.ensurePairedSceneVisual(h.initialScene);
  h.setSessionLocation(IDS.otherSession);
  await h.emitWindow('popstate');
  assert.equal(h.state.sessionId, IDS.otherSession);
  h.setSessionLocation(IDS.session);
  await h.emitWindow('popstate');
  assert.equal(h.state.sessionId, IDS.session);
  assert.equal(h.gets.length, 2);
  assert.ok(h.state.epoch > 1);
  // Synthetic remount gives the old pair, scene identity and revision back;
  // the actual navigation callbacks, not a helper stub, retired its ownership.
  Object.assign(h.state, {
    scene: h.initialScene,
    progress: { revision: 7, status: 'active' },
    pairedVisualSceneKey: h.initialScene.sceneKey,
  });
  assert.equal(h.state.workId, IDS.work);
  assert.equal(h.state.workIdClaim, IDS.work);
  assert.equal(h.state.locale, 'en');
  assert.equal(h.state.sceneIdentity, IDS.user);
  const returned = h.snapshot();
  h.posts[0].resolve({ status: 'ready' });
  await task;
  await drain();
  h.assertUnchanged(returned, 'leave-return old epoch');
});

test('paired current: real retry owns the replacement lock and pagehide retires its timer', async (t) => {
  const h = useHarness(t);
  const oldTask = h.ensurePairedSceneVisual(h.initialScene);
  h.advance(180001);
  h.renderPairedDelivery(h.initialScene);
  assert.match(h.root.innerHTML, /data-story-paired-retry/);
  assert.equal(h.posts.length, 1, 'the expired wait exposes retry without dispatching');
  await h.clickPairedRetry();
  assert.equal(h.posts.length, 2, 'the actual click callback starts the explicit replacement');
  const operation = h.state.pairedVisualOperation;
  assert.ok(operation);
  const scopedKey = 'paired:' + IDS.session + ':' + h.initialScene.sceneKey;
  assert.equal(h.state.visualRequestKey, scopedKey);
  const replacement = h.snapshot();
  h.posts[0].resolve({ status: 'ready' });
  await oldTask;
  await drain();
  h.assertUnchanged(replacement, 'superseded retry response');
  assert.equal(h.state.pairedVisualOperation, operation);
  assert.equal(h.state.visualRequestKey, scopedKey);
  h.posts[1].resolve({ status: 'processing' });
  await drain();
  const ids = h.activeTimerIds();
  assert.equal(ids.length, 1);
  await h.emitWindow('pagehide');
  assert.equal(h.timers.get(ids[0]).cancelled, true);
  assert.equal(h.state.pairedVisualOperation, null);
  assert.equal(h.state.visualRequestKey, '');
  const hidden = h.snapshot();
  await h.fireTimer(ids[0], { queuedBeforeCancel: true });
  h.assertUnchanged(hidden, 'pagehide queued retry refresh');
  assert.equal(h.gets.length, 0);
});

test('paired current: BFCache pageshow performs one current GET and keeps the retired timer inert', async (t) => {
  const scenarios = [
    { name: 'persisted signed-in session', persisted: true, resume: true },
    { name: 'non-persisted', persisted: false, resume: false },
    { name: 'no session', persisted: true, resume: false, noSession: true },
    { name: 'not signed-in', persisted: true, resume: false, signedOut: true },
  ];
  for (const scenario of scenarios) {
    const h = useHarness(t);
    const task = h.ensurePairedSceneVisual(h.initialScene);
    const operation = h.state.pairedVisualOperation;
    assert.ok(operation, scenario.name + ': actual source must own the pending operation');
    // A provider processing response retains the existing local loading status.
    h.posts[0].resolve({ status: 'processing' });
    await task;
    assert.equal(h.state.pairedVisualStatus, 'loading',
      scenario.name + ': actual processing response must retain local loading');
    const ids = h.activeTimerIds();
    assert.equal(ids.length, 1);
    assert.equal(operation.timer, ids[0]);
    assert.equal(h.timers.get(ids[0]).delay, 1800);
    await h.emitWindow('pagehide');
    assert.equal(h.timers.get(ids[0]).cancelled, true);
    assert.equal(h.state.pairedVisualOperation, null);
    assert.equal(h.state.visualRequestKey, '');
    assert.equal(h.state.pairedVisualStatus, 'loading');
    assert.equal(h.activeTimerIds().length, 0);
    assert.equal(h.gets.length, 0);
    // Isolate exclusions after the real provider-processing/local-loading pagehide path.
    // No synthetic assignment manufactures the status tested by pageshow.
    if (scenario.noSession) h.state.sessionId = '';
    if (scenario.signedOut) h.setLoggedIn(false);
    const hidden = h.snapshot();
    await h.emitWindow('pageshow', { persisted: scenario.persisted });
    if (scenario.resume) {
      assert.equal(h.gets.length, 1, 'BFCache resumes by reading the current scene once');
      assert.equal(h.gets[0].path, '/api/v1/story-sessions/' + IDS.session + '/current-scene?locale=en');
      assert.equal(h.requests.length, 2, 'only the initial paired POST and one current GET');
      assert.equal(h.state.scene.sceneKey, 'synthetic-current-ready');
      assert.equal(h.state.progress.revision, 9);
      assert.equal(h.state.pairedVisualOperation, null, 'no retired operation is revived');
      assert.equal(h.state.visualRequestKey, '');
    } else {
      h.assertUnchanged(hidden, scenario.name + ' pageshow');
      assert.equal(h.gets.length, 0, scenario.name + ': no current-scene dispatch');
      assert.equal(h.requests.length, 1);
    }
    assert.equal(h.posts.length, 1, 'pageshow cannot replay the paired POST');
    assert.equal(h.restoreAiOperationCalls, 0, 'actual loadScene must use restorePending:false');
    assert.equal(h.activeTimerIds().length, 0);
    const restored = h.snapshot();
    await h.fireTimer(ids[0], { queuedBeforeCancel: true });
    h.assertUnchanged(restored, scenario.name + ' retired queued callback');
    assert.equal(h.gets.length, scenario.resume ? 1 : 0);
    assert.equal(h.posts.length, 1);
    assert.equal(h.restoreAiOperationCalls, 0);
    h.assertContracts();
  }
});

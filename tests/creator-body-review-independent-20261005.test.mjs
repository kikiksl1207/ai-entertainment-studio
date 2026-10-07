import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const sources = ['creator-body-preview', 'creator-body-trial', 'creator-body-review']
  .map(name => readFileSync(new URL(`../pages/${name}.js`, import.meta.url), 'utf8'));
const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
const fields = ['styleReviewed', 'charactersReviewed', 'timelineReviewed'];
const response = value => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(value) });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const approval = () => ({
  contract: 'story-author-body-trial-state-v1', workId: id(1), state: 'approval_recorded', readOnly: true,
  generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
  approval: { id: id(7), expiresAt: '2099-12-31T23:59:59.000Z' },
  budget: { knownActualCostKrw: '0.000000', reservedMaximumCostKrw: '0.000000', committedCostKrw: '0.000000',
    approvedBudgetKrw: '10.000000', remainingBudgetKrw: '10.000000', requestCount: 0, pendingCount: 0,
    unknownCostCount: 0, verifiedSharedReuseCount: 0, evidenceReadyForBudgetCheck: true }
});
const preview = advanced => ({
  contract: 'story-author-body-preview-v1', workId: id(1), locale: 'ko', readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: advanced ? 3 : 2, storyVersion: 1, status: 'active', currentBeatPosition: 1,
    scene: { id: advanced ? id(9) : id(3), isGenerated: !advanced, title: 'SYNTHETIC SCENE', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'SYNTHETIC BODY ONLY' }] },
    choices: advanced ? [] : [{ id: id(5), label: 'Synthetic original route', routeKind: 'writer_original' }] }
});
const review = advanced => ({
  contract: 'story-author-body-review-v1', workId: id(1), locale: 'ko', readOnly: true,
  generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false,
  state: advanced ? 'not_generated' : 'reviewable', latestReview: null,
  target: advanced ? null : { progressId: id(2), progressRevision: 2, sceneId: id(3),
    sourceBindingHash: 'ab'.repeat(32), bodyChecksum: 'cd'.repeat(32), ending: false }
});
const choiceReceipt = replay => ({
  contract: 'story-author-body-trial-choice-v1', progressId: id(2), revisionAfterRequest: 3,
  status: 'active', generationStarted: false, imageGenerationStarted: false, idempotentReplay: replay
});
const receiptEnvelope = () => ({
  contract: 'story-author-body-trial-receipt-v1', workId: id(1), choiceId: id(5), approvalId: id(7),
  progressId: id(2), sourceRevision: 2, locale: 'ko', readOnly: true, generationAuthorized: false,
  generationStarted: false, imageGenerationStarted: false, receipt: choiceReceipt(true)
});

class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.style = {}; this.dataset = {}; this.hidden = false; this.disabled = false;
    this.checked = false; this.value = ''; this.className = ''; this._text = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), contains: name => classes.has(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || []; callbacks.push(callback); this.listeners.set(type, callbacks);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }
  fire(type, event = {}) {
    let result;
    for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event });
    return result;
  }
}
const walk = node => [node, ...node.children.flatMap(walk)];

// Both production mounts share one event bus, unlike the existing per-panel harnesses.
function mountedPair(settings = {}) {
  const window = new Element(), document = new Element();
  const shell = new Element('main', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const trialHost = new Element('section', 'writerBodyTrial'), reviewHost = new Element('section', 'writerBodyReview');
  const work = new Element('select', 'writerManuscriptWork'), locale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); locale.value = 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, work, locale].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  const storage = new Map(), calls = [], events = [], gate = deferred();
  window.sessionStorage = {
    getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
  };
  const forbidden = () => { throw new Error('Real network, timers and persistent storage are forbidden'); };
  window.localStorage = { getItem: forbidden, setItem: forbidden }; window.fetch = forbidden;
  window.crypto = { randomUUID: () => id(90) }; window.getAuth = () => ({ accessToken: 'synthetic-token-only' });
  window.luminaI18n = { getLocale: () => 'ko' };
  window.dispatchEvent = event => { events.push(event.type); window.fire(event.type); return true; };
  let owner = { ownerId: id(8), epoch: 1 };
  let advanced = false;
  window.LuminaCreatorStudioApi = {
    identity: () => owner, isCurrent: value => owner && value.ownerId === owner.ownerId && value.epoch === owner.epoch,
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') assert.equal(options._retried, true);
      else { assert.equal(options.method, 'GET'); assert.equal(typeof options._retried, 'boolean'); }
      assert.equal(options.cache, 'no-store');
      const override = settings.responseOverride?.(url, options);
      if (override !== undefined) return override;
      if (options.method === 'POST' || url.includes('/receipt?')) return gate.promise;
      if (url.endsWith('/body-trial-state')) return response(approval());
      if (url.endsWith('/body-review?locale=ko')) return response(review(advanced));
      if (url.endsWith('/body-preview?locale=ko')) return response(preview(advanced));
      throw new Error('Unexpected synthetic endpoint');
    }
  };
  class Event { constructor(type) { this.type = type; } }
  const vm = createContext({ window, document, Event, TextEncoder, TextDecoder, AbortController,
    fetch: forbidden, setTimeout: forbidden, setInterval: forbidden });
  for (const source of sources) runInContext(source, vm);
  const trialController = window.LuminaCreatorBodyTrial.mount(trialHost);
  const reviewController = window.LuminaCreatorBodyReview.mount(reviewHost);
  const button = (host, name) => walk(host).find(node => node.id === name);
  return { gate, calls, events, window, trialHost, reviewHost, trialController, reviewController,
    setOwner: value => { owner = value; },
    loadTrial: () => button(trialHost, 'writerBodyTrialRefresh').fire('click'),
    loadReview: () => button(reviewHost, 'writerBodyReviewRefresh').fire('click'),
    choose: () => walk(trialHost).find(node => node.className === 'body-trial-choice').fire('click'),
    retry: () => button(trialHost, 'writerBodyTrialRetry').fire('click'),
    checkAll: () => {
      for (const field of fields) {
        const input = button(reviewHost, `writerBodyReview-${field}`); input.checked = true; input.fire('change');
      }
    },
    approveEnabled: () => !button(reviewHost, 'writerBodyReviewApprove').disabled,
    advance: () => { advanced = true; }
  };
}

for (const outcome of ['late POST', 'lost POST then receipt GET']) {
  test(`independent: ${outcome} must invalidate an old body reloaded after trial dispatch`, async t => {
    const view = mountedPair();
    assert.equal(await view.loadReview(), true); assert.equal(await view.loadTrial(), true);
    const task = view.choose();
    assert.equal(view.reviewController.snapshot().data, null, 'dispatch already erases the review');
    assert.equal(await view.trialController.choose(id(5)), false, 'duplicate choice cannot dispatch');
    let settlement = task;
    if (outcome.startsWith('lost')) {
      view.gate.reject(new TypeError('Synthetic lost response'));
      assert.equal(await task, false);
      // Replace only the fake transport gate for the read-only receipt retry.
      const retryGate = deferred(); view.gate.promise = retryGate.promise; view.gate.resolve = retryGate.resolve;
      settlement = view.retry();
    }
    assert.equal(await view.loadReview(), true, 'a GET can still observe the pre-commit revision');
    view.checkAll(); assert.equal(view.approveEnabled(), true);
    view.advance(); view.gate.resolve(response(outcome.startsWith('lost') ? receiptEnvelope() : choiceReceipt(false)));
    assert.equal(await settlement, true, 'the production receipt parser accepts the advanced revision');
    const stale = view.reviewController.snapshot();
    const observed = { outcome, receiptRevision: view.trialController.snapshot().receipt.revisionAfterRequest,
      displayedReviewRevision: stale.data?.review.target?.progressRevision ?? null,
      oldBodyPresent: walk(view.reviewHost).some(node => node.className === 'body-review-source'),
      staleApproveEnabled: view.approveEnabled(), progressChangeEvents: view.events.length,
      choicePosts: view.calls.filter(call => call.options.method === 'POST').length,
      receiptGets: view.calls.filter(call => call.url.includes('/receipt?')).length };
    t.diagnostic(JSON.stringify(observed));
    assert.equal(observed.choicePosts, 1);
    if (outcome.startsWith('lost')) {
      const post = view.calls.find(call => call.options.method === 'POST');
      const check = view.calls.find(call => call.url.includes('/receipt?'));
      assert.equal(check.options.headers['Idempotency-Key'], post.options.headers['Idempotency-Key']);
      assert.equal(check.options.body, undefined);
    }
    assert.equal(await view.loadReview(), true, 'explicit refresh sees the new non-generated original route');
    assert.equal(view.reviewController.snapshot().data.review.state, 'not_generated');
    assert.equal(view.approveEnabled(), false);
    assert.equal(observed.staleApproveEnabled, false,
      'verified progress advance must not leave approval enabled for the previously displayed generated body');
  });
}

const clone = value => JSON.parse(JSON.stringify(value));
function callbackBoundary(settings = {}) {
  const forbidden = () => { throw new Error('External access is forbidden'); };
  const window = { crypto: { randomUUID: () => id(90) }, fetch: forbidden };
  const vm = createContext({ window, TextEncoder, TextDecoder, AbortController,
    fetch: forbidden, setTimeout: forbidden, setInterval: forbidden });
  for (const source of sources) runInContext(source, vm);
  const calls = [], states = [], rows = new Map();
  let owner = { ownerId: id(8), epoch: 1 }, fault = null, gate = deferred(), dispatched = 0, settled = 0;
  const journal = {
    read: key => rows.has(key) ? clone(rows.get(key)) : null,
    write: entry => { rows.set(entry.ownerId, clone(entry)); return true; },
    remove: entry => {
      if (fault === 'throw') throw new Error('Synthetic retirement failure');
      if (fault === 'false') return false;
      if (fault !== 'read-back-still-present') rows.delete(entry.ownerId);
      return true;
    }
  };
  let controller;
  controller = window.LuminaCreatorBodyTrial.createController({
    identity: () => owner, isCurrent: value => owner && value.ownerId === owner.ownerId && value.epoch === owner.epoch,
    context: () => ({ workId: id(1), locale: 'ko' }), locale: () => 'ko', visible: () => true, journal,
    makeIdempotencyKey: () => 'synthetic-boundary-command-0001',
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'POST') assert.equal(options._retried, true);
      else { assert.equal(options.method, 'GET'); assert.equal(typeof options._retried, 'boolean'); }
      assert.equal(options.cache, 'no-store');
      const override = settings.responseOverride?.(url, options);
      if (override !== undefined) return override;
      if (options.method === 'POST' || url.includes('/receipt?')) return gate.promise;
      if (url.endsWith('/body-trial-state')) return response(approval());
      if (url.endsWith('/body-preview?locale=ko')) return response(preview(false));
      throw new Error('Unexpected synthetic endpoint');
    },
    onChange: value => states.push(clone(value)), onDispatch: () => { dispatched++; },
    onSettled: () => {
      settled++;
      // The callback must run only after a verified receipt and successful journal retirement.
      assert.equal(rows.size, 0);
      assert.equal(controller.snapshot().phase, 'accepted');
      assert.equal(controller.snapshot().receipt.revisionAfterRequest, 3);
      assert.equal(controller.snapshot().unresolved, false);
      settings.onSettled?.(controller, value => { owner = value; });
    }
  });
  return { controller, calls, states, rows, journal,
    dispatched: () => dispatched, settled: () => settled,
    gate: () => gate, resetGate: () => { gate = deferred(); return gate; },
    fault: value => { fault = value; }, setOwner: value => { owner = value; }
  };
}
async function startBoundary(view, replaying) {
  assert.equal(await view.controller.load(), true);
  const task = view.controller.choose(id(5));
  assert.equal(await view.controller.choose(id(5)), false);
  if (!replaying) return { task };
  view.gate().reject(new TypeError('Synthetic lost response'));
  assert.equal(await task, false);
  view.resetGate();
  return { task: view.controller.retry() };
}
function assertNoReplacementPost(view) {
  const posts = view.calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  for (const check of view.calls.filter(call => call.url.includes('/receipt?'))) {
    assert.equal(check.options.method, 'GET'); assert.equal(check.options.body, undefined);
    assert.equal(check.options.headers['Idempotency-Key'], posts[0].options.headers['Idempotency-Key']);
    const query = new URL(check.url, 'https://synthetic.invalid').searchParams;
    for (const [key, value] of Object.entries(JSON.parse(posts[0].options.body))) {
      assert.equal(query.get(key), String(value));
    }
  }
}

for (const replaying of [false, true]) {
  const path = replaying ? 'receipt GET' : 'initial POST';
  test(`settlement boundary: ${path} notifies once after retirement and never redispatches`, async () => {
    const view = callbackBoundary(), { task } = await startBoundary(view, replaying);
    assert.equal(view.settled(), 0); assert.equal(view.dispatched(), 1);
    view.gate().resolve(response(replaying ? receiptEnvelope() : choiceReceipt(false)));
    assert.equal(await task, true); assert.equal(view.settled(), 1);
    const count = view.calls.length;
    assert.equal(await view.controller.retry(), false); assert.equal(await view.controller.choose(id(5)), false);
    assert.equal(view.calls.length, count); assertNoReplacementPost(view);
  });

  for (const fault of ['false', 'throw', 'read-back-still-present']) {
    test(`settlement boundary: ${path} retirement ${fault} cannot notify; exact GET can reconcile`, async () => {
      const view = callbackBoundary(), { task } = await startBoundary(view, replaying);
      const saved = clone(view.rows.get(id(8))); view.fault(fault);
      view.gate().resolve(response(replaying ? receiptEnvelope() : choiceReceipt(false)));
      assert.equal(await task, false); assert.equal(view.settled(), 0);
      assert.equal(view.controller.snapshot().receipt, null);
      assert.equal(view.controller.snapshot().unresolved, true);
      assert.deepEqual(view.rows.get(id(8)), saved);
      assert.equal(await view.controller.choose(id(5)), false);
      view.fault(null); view.resetGate(); const retry = view.controller.retry();
      assert.equal(await view.controller.retry(), false);
      view.gate().resolve(response(receiptEnvelope()));
      assert.equal(await retry, true); assert.equal(view.settled(), 1); assertNoReplacementPost(view);
    });
  }

  for (const change of ['ticket', 'owner', 'logout']) {
    test(`settlement boundary: late ${path} after ${change} cannot notify or replace the owner command`, async () => {
      const view = callbackBoundary(), { task } = await startBoundary(view, replaying);
      const saved = clone(view.rows.get(id(8)));
      if (change === 'ticket') view.controller.invalidate();
      else view.setOwner(change === 'logout' ? null : { ownerId: id(18), epoch: 2 });
      view.controller.syncContext();
      const state = clone(view.controller.snapshot());
      view.gate().resolve(response(replaying ? receiptEnvelope() : choiceReceipt(false)));
      assert.equal(await task, false); assert.equal(view.settled(), 0);
      assert.deepEqual(clone(view.controller.snapshot()), state);
      assert.deepEqual(view.rows.get(id(8)), saved);
      assert.equal(await view.controller.choose(id(5)), false);
      view.setOwner({ ownerId: id(8), epoch: 3 }); view.controller.syncContext();
      view.resetGate(); const retry = view.controller.retry();
      view.gate().resolve(response(receiptEnvelope()));
      assert.equal(await retry, true); assert.equal(view.settled(), 1); assertNoReplacementPost(view);
    });
  }

  const corruptions = {
    'wrong-revision': receipt => ({ ...receipt, revisionAfterRequest: 4 }),
    'image-generation-flag': receipt => ({ ...receipt, imageGenerationStarted: true }),
    'contradictory-completed-AI': receipt => ({ ...receipt, continuationId: id(11), status: 'completed',
      progressApplied: false, resultGeneratedSceneId: id(12), provenance: 'ai_generated',
      privateInputReturned: false, providerPayloadReturned: false, internalCostReturned: false })
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    test(`settlement boundary: ${path} ${name} cannot notify or cause paid resubmission`, async () => {
      const view = callbackBoundary(), { task } = await startBoundary(view, replaying);
      const saved = clone(view.rows.get(id(8)));
      const wire = replaying ? { ...receiptEnvelope(), receipt: corrupt(choiceReceipt(true)) } : corrupt(choiceReceipt(false));
      view.gate().resolve(response(wire));
      assert.equal(await task, false); assert.equal(view.settled(), 0);
      assert.equal(view.controller.snapshot().receipt, null);
      assert.equal(view.controller.snapshot().unresolved, true); assert.deepEqual(view.rows.get(id(8)), saved);
      assert.equal(await view.controller.choose(id(5)), false);
      view.resetGate(); const retry = view.controller.retry();
      view.gate().resolve(response(receiptEnvelope()));
      assert.equal(await retry, true); assert.equal(view.settled(), 1); assertNoReplacementPost(view);
    });
  }
}

test('settlement boundary: receipt envelope for another command cannot notify', async () => {
  const view = callbackBoundary(), { task } = await startBoundary(view, true);
  const saved = clone(view.rows.get(id(8)));
  view.gate().resolve(response({ ...receiptEnvelope(), approvalId: id(19) }));
  assert.equal(await task, false); assert.equal(view.settled(), 0);
  assert.deepEqual(view.rows.get(id(8)), saved); assertNoReplacementPost(view);
});

for (const change of ['ticket', 'owner']) {
  test(`settlement boundary: reentrant ${change} inside onSettled cannot emit accepted into a new scope`, async () => {
    const view = callbackBoundary({ onSettled: (controller, setOwner) => {
      if (change === 'ticket') controller.invalidate();
      else setOwner({ ownerId: id(18), epoch: 2 });
    } });
    const { task } = await startBoundary(view, false);
    view.gate().resolve(response(choiceReceipt(false)));
    assert.equal(await task, false); assert.equal(view.settled(), 1);
    assert.equal(view.rows.size, 0, 'a verified retired command must stay retired');
    assert.equal(view.controller.snapshot().receipt, null);
    assert.equal(view.states.some(state => state.phase === 'accepted'), false);
    const count = view.calls.length;
    assert.equal(await view.controller.retry(), false); assert.equal(view.calls.length, count);
    assertNoReplacementPost(view);
  });
}

for (const stage of ['body-review', 'body-preview']) {
  test(`settlement boundary: verified advance aborts a late ${stage} GET without restoring old body`, async () => {
    const pendingReview = deferred(), started = deferred();
    let hold = false, signal;
    const view = mountedPair({ responseOverride: (url, options) => {
      if (hold && url.endsWith(`/${stage}?locale=ko`)) {
        signal = options.signal; started.resolve(); return pendingReview.promise;
      }
    } });
    assert.equal(await view.loadTrial(), true); const choiceTask = view.choose();
    hold = true; const reviewTask = view.loadReview(); await started.promise;
    view.advance(); view.gate.resolve(response(choiceReceipt(false)));
    assert.equal(await choiceTask, true); assert.equal(signal.aborted, true);
    pendingReview.resolve(response(stage === 'body-review' ? review(false) : preview(false)));
    assert.equal(await reviewTask, false);
    assert.equal(view.reviewController.snapshot().data, null); assert.equal(view.approveEnabled(), false);
    assert.equal(walk(view.reviewHost).some(node => node.className === 'body-review-source'), false);
    assert.equal(view.events.length, 2); assert.equal(view.calls.filter(call => call.options.method === 'POST').length, 1);
    hold = false; assert.equal(await view.loadReview(), true);
    assert.equal(view.reviewController.snapshot().data.review.state, 'not_generated');
  });
}

for (const change of ['ticket', 'owner']) {
  test(`settlement boundary: stale mounted trial ${change} response cannot erase a newly loaded review`, async () => {
    const view = mountedPair(); await view.loadTrial(); const task = view.choose();
    if (change === 'ticket') view.trialController.invalidate();
    else { view.setOwner({ ownerId: id(18), epoch: 2 }); view.window.fire('lumina:authchange'); }
    assert.equal(await view.loadReview(), true); view.checkAll();
    const ticket = view.reviewController.snapshot().ticket;
    view.gate.resolve(response(choiceReceipt(false)));
    assert.equal(await task, false);
    assert.equal(view.events.length, 1, 'no settlement event from an obsolete request');
    assert.equal(view.reviewController.snapshot().ticket, ticket); assert.equal(view.approveEnabled(), true);
    assert.equal(view.calls.filter(call => call.options.method === 'POST').length, 1);
  });
}

test('independent: trial GET forwards false while review GET and choice POST remain retry-fenced', async () => {
  const view = mountedPair();
  assert.equal(await view.loadReview(), true); assert.equal(await view.loadTrial(), true);
  const gets = view.calls.filter(call => call.options.method === 'GET');
  assert.deepEqual(gets.map(call => call.options._retried), [true, true, false, false]);
  assert.equal(gets[0].url.endsWith('/body-review?locale=ko'), true);
  assert.equal(gets[1].url.endsWith('/body-preview?locale=ko'), true);
  assert.equal(gets[2].url.endsWith('/body-trial-state'), true);
  assert.equal(gets[3].url.endsWith('/body-preview?locale=ko'), true);
  assert.equal(view.trialController.snapshot().canChoose, true);
  const task = view.choose(), posts = view.calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].options._retried, true);
  assert.equal(await view.trialController.choose(id(5)), false);
  view.advance(); view.gate.resolve(response(choiceReceipt(false)));
  assert.equal(await task, true);
  assert.equal(view.calls.filter(call => call.options.method === 'POST').length, 1);
});

for (const position of ['missing', 0]) {
  test(`independent: generated body read position ${position} cannot dispatch a choice`, async () => {
    const view = callbackBoundary({ responseOverride: url => {
      if (!url.endsWith('/body-preview?locale=ko')) return undefined;
      const value = preview(false);
      if (position === 'missing') delete value.progress.currentBeatPosition;
      else value.progress.currentBeatPosition = position;
      return response(value);
    } });
    assert.equal(await view.controller.load(), true);
    const state = view.controller.snapshot();
    assert.equal(state.phase, 'ready'); assert.equal(state.messageKey, 'readRequired');
    assert.equal(state.data.preview.progress.scene.isGenerated, true);
    assert.equal(state.data.preview.progress.scene.beats.at(-1).position, 1);
    if (position === 'missing') assert.equal(Object.hasOwn(state.data.preview.progress, 'currentBeatPosition'), false);
    else assert.equal(state.data.preview.progress.currentBeatPosition, 0);
    assert.equal(state.canChoose, false); assert.equal(state.canRecordRead, position !== 'missing');
    assert.equal(await view.controller.choose(id(5)), false);
    assert.equal(view.calls.filter(call => call.options.method === 'POST').length, 0);
    assert.equal(view.dispatched(), 0); assert.equal(view.settled(), 0); assert.equal(view.rows.size, 0);
  });
}

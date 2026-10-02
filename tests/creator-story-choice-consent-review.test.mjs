import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-story-choice-consent-review.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-story-choice-consent-review.css', import.meta.url), 'utf8');
const id = number => `${String(number).padStart(8, '0')}-1111-4111-8111-${String(number).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const walk = node => [node, ...node.children.flatMap(walk)];

class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map();
    this.hidden = false; this.disabled = false; this.checked = false; this.attributes = {}; this.parentElement = null;
    this._text = ''; this.className = '';
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name) };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) {
    for (const node of this.children) node.parentElement = null;
    this.children = []; this._text = ''; this.append(...nodes);
  }
  after(node) {
    const parent = this.parentElement;
    assert.ok(parent, 'panel anchor must have a parent');
    node.parentElement = parent;
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  contains(node) { return walk(this).includes(node); }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || []; listeners.push(listener); this.listeners.set(name, listeners);
  }
  fire(name) { let result; for (const listener of this.listeners.get(name) || []) result = listener({ type: name, target: this }); return result; }
}

function fixture({ locale = 'en', total = 2 } = {}) {
  const modal = new Element('div', 'writerFinalModal');
  const content = new Element('div');
  const sourceSection = new Element('section');
  const parts = new Element('div', 'writerFinalParts');
  const footer = new Element('div'); footer.className = 'modal-actions';
  modal.append(content); content.append(sourceSection, footer); sourceSection.append(parts);
  const documentListeners = new Map();
  const document = { documentElement: { lang: locale }, createElement: tag => new Element(tag),
    getElementById: name => walk(modal).find(node => node.id === name) || null,
    addEventListener: (name, listener) => documentListeners.set(name, listener) };
  const active = { workId: id(1), manuscriptVersionId: id(2), analysisJobId: id(3),
    identity: { ownerId: id(4), epoch: 2 } };
  const completed = clone(active);
  const snapshot = { manuscriptVersionId: active.manuscriptVersionId, analysisJobId: active.analysisJobId,
    manuscriptHash: 'a'.repeat(64), releaseId: id(5), consent: { active: true, revision: 2 },
    parts: Array.from({ length: total }, (_, index) => ({ partKey: `p${index + 1}`, title: `Part ${index + 1}` })),
    scenes: Array.from({ length: total }, (_, index) => ({ partKey: `p${index + 1}`, sceneId: id(100 + index), choiceCount: 3 })) };
  const review = { releaseId: snapshot.releaseId, status: 'consent_changed', canReset: false, generationStarted: false,
    expectedManuscriptHash: snapshot.manuscriptHash, expectedApprovedFingerprint: 'b'.repeat(64),
    expectedProfilePinHash: 'c'.repeat(64), expectedReleaseChecksum: 'd'.repeat(64),
    preparedScenes: total, resetRequiredScenes: 0,
    consentReview: { canReapprove: true, consentId: id(6), consentRevision: 2, batchHash: 'e'.repeat(64),
      scenes: snapshot.scenes.map(scene => ({ partKey: scene.partKey, sceneId: scene.sceneId,
        choices: [1, 2, 3].map(position => ({ position, label: `Saved ${scene.partKey} choice ${position}`,
          routeKind: position === 1 ? 'writer_original' : 'generation_required' })) })) } };
  const goodReceipt = { releaseId: snapshot.releaseId, status: 'current', reapprovedScenes: total, generationStarted: false, idempotentReplay: false };
  const response = (value = goodReceipt, ok = true) => ({ ok, json: async () => clone(value) });
  let reply = () => response();
  let identityCurrent = true;
  let language = locale;
  const calls = [], confirmations = [], events = [], intervals = new Map(), listeners = new Map(), observers = [];
  let nextTimer = 0;
  const window = {
    luminaI18n: { getLocale: () => language },
    confirm: message => { confirmations.push(message); return true; },
    LuminaCreatorAnalysis: { completed: () => completed },
    LuminaCreatorStudioApi: {
      isCurrent: identity => identityCurrent && identity.ownerId === id(4) && identity.epoch === 2,
      fetch: async (url, options) => { calls.push({ url, ...options }); return reply(url, options); }
    },
    addEventListener: (name, listener) => { const values = listeners.get(name) || []; values.push(listener); listeners.set(name, values); },
    dispatchEvent: event => {
      if (event.type === 'lumina:story-choice-consent-reviewed') events.push(event);
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    }
  };
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new Error('Storage forbidden'); } });
  class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
  class MutationObserver { constructor(callback) { observers.push(callback); } observe() {} }
  vm.runInNewContext(script, { window, document, CustomEvent, MutationObserver, AbortController,
    setInterval: callback => { const key = ++nextTimer; intervals.set(key, callback); return key; },
    clearInterval: key => intervals.delete(key), fetch: () => { throw new Error('Non-service network forbidden'); } });
  const panel = window.LuminaCreatorChoiceConsentReview;
  const get = suffix => document.getElementById('writerChoiceConsent' + suffix);
  const show = (source = snapshot, value = review, scope = active) => panel.show(source, value, scope);
  const acknowledge = () => {
    get('Reviewed').checked = true; get('Reviewed').fire('change');
    get('Confirmed').checked = true; get('Confirmed').fire('change');
  };
  return { window, document, modal, content, parts, sourceSection, footer, active, completed, snapshot, review, calls, events,
    confirmations, goodReceipt, response, panel, get, show, acknowledge, click: () => get('Approve').fire('click'),
    reply: value => { reply = typeof value === 'function' ? value : () => response(value); },
    expire: () => { identityCurrent = false; }, tick: () => { for (const callback of [...intervals.values()]) callback(); },
    dispatch: type => window.dispatchEvent(new CustomEvent(type)),
    mutateModal: () => { for (const callback of observers) callback(); },
    input: () => documentListeners.get('input')?.(),
    locale: value => { language = value; window.dispatchEvent(new CustomEvent('lumina:localechange')); } };
}

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('mounts one unframed panel directly after parts inside the modal and before its footer without fetching', () => {
  const f = fixture();
  assert.deepEqual(Object.keys(f.panel).sort(), ['reset', 'show']);
  assert.equal(f.get('Review').hidden, true);
  f.show();
  assert.deepEqual(f.content.children, [f.sourceSection, f.footer]);
  assert.deepEqual(f.sourceSection.children, [f.parts, f.get('Review')]);
  assert.equal(f.modal.contains(f.get('Review')), true);
  assert.equal(f.parts.children.length, 0);
  assert.equal(f.get('Review').hidden, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.get('Scenes').children.length, 2);
  assert.equal(walk(f.get('Review')).filter(node => node.tagName === 'INPUT').length, 2);
  assert.equal(f.get('Scenes').tabIndex, 0);
  f.get('Scenes').children.forEach((row, index) => {
    assert.equal(row.children[0].textContent, `${index + 1}. Part ${index + 1}`);
    assert.equal(row.children[1].children.length, 3);
    row.children[1].children.forEach((choice, choiceIndex) => {
      assert.equal(choice.value, choiceIndex + 1);
      assert.equal(choice.children[0].textContent, `Saved p${index + 1} choice ${choiceIndex + 1}`);
      assert.equal(choice.children[1].textContent, choiceIndex ? 'AI branch path' : 'Original path');
    });
  });
  f.show(); assert.equal(f.sourceSection.children.length, 2);
  f.panel.reset();
  assert.equal(f.get('Review').hidden, true);
  assert.equal(f.get('Scenes').textContent, '');
  assert.equal(f.get('Approve').disabled, true);
});

test('both batch acknowledgements and explicit confirmation send only the exact guarded reuse request', async () => {
  for (const replay of [false, true]) {
    const f = fixture(); f.reply({ ...f.goodReceipt, reapprovedScenes: replay ? 0 : 2, idempotentReplay: replay }); f.show();
    assert.equal(f.get('Approve').disabled, true);
    await f.click(); assert.equal(f.calls.length, 0);
    f.get('Reviewed').checked = true; f.get('Reviewed').fire('change');
    assert.equal(f.get('Approve').disabled, true);
    f.get('Confirmed').checked = true; f.get('Confirmed').fire('change');
    assert.equal(f.get('Approve').disabled, false);
    await f.click();
    assert.equal(f.confirmations.length, 1);
    assert.match(f.confirmations[0], /all 2 scenes under current consent/);
    assert.match(f.confirmations[0], /No new AI generation will start/);
    assert.equal(f.calls.length, 1);
    const call = f.calls[0];
    assert.equal(call.url, `/api/v1/me/creator-studio/stories/${f.active.workId}/linear-draft/releases/${f.snapshot.releaseId}/reapprove-choices`);
    assert.equal(call.method, 'POST'); assert.equal(call._retried, true);
    assert.deepEqual(clone(call.identity), f.active.identity);
    assert.deepEqual(clone(call.body), {
      expectedManuscriptHash: 'a'.repeat(64), expectedApprovedFingerprint: 'b'.repeat(64),
      expectedProfilePinHash: 'c'.repeat(64), expectedReleaseChecksum: 'd'.repeat(64),
      expectedConsentId: id(6), expectedConsentRevision: 2, expectedBatchHash: 'e'.repeat(64),
      choicesReviewed: true, currentConsentConfirmed: true
    });
    assert.equal(f.events.length, 1);
    assert.deepEqual(clone(f.events[0].detail), { workId: f.active.workId, releaseId: f.snapshot.releaseId });
    assert.equal(f.get('Status').textContent, 'Saved choice reuse approved.');
    assert.equal(f.get('Approve').disabled, true);
    await f.click(); assert.equal(f.calls.length, 1);
  }
});

test('cancelled, missing, or throwing confirmation never sends approval', async () => {
  for (const mode of ['cancel', 'missing', 'throw']) {
    const f = fixture(); f.show(); f.acknowledge();
    f.window.confirm = mode === 'missing' ? undefined : () => { if (mode === 'throw') throw new Error('No dialog'); return false; };
    await f.click();
    assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
    assert.notEqual(f.get('Status').textContent, 'Saved choice reuse approved.');
  }
});

test('forced clicks with either acknowledgement missing cannot reach confirmation or write', async () => {
  for (const [reviewed, confirmed] of [[false, false], [true, false], [false, true]]) {
    const f = fixture(); f.show();
    f.get('Reviewed').checked = reviewed; f.get('Reviewed').fire('change');
    f.get('Confirmed').checked = confirmed; f.get('Confirmed').fire('change');
    assert.equal(f.get('Approve').disabled, true);
    f.get('Approve').disabled = false;
    await f.click();
    assert.equal(f.confirmations.length, 0); assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
  }
});

test('shows only consent_changed and never substitutes retry, reset, finish, or publish', async () => {
  for (const status of ['current', 'settings_changed', 'reset_ready', 'approval_required', 'blocked', undefined]) {
    const f = fixture(); f.show(); f.review.status = status; f.show();
    assert.equal(f.get('Review').hidden, true); assert.equal(f.get('Scenes').textContent, '');
    await f.click(); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.show(); f.review.status = 'current'; f.tick();
  assert.equal(f.get('Review').hidden, true);
  assert.doesNotMatch(script, /localStorage|sessionStorage|retry-choices|reset-choices|\/finish|\/publish|window\.fetch/);
});

test('no currently approved profile leaves valid saved choices read-only even with forced checks', async () => {
  const f = fixture(); f.review.consentReview.canReapprove = false;
  f.review.expectedApprovedFingerprint = null; f.review.expectedProfilePinHash = null;
  f.show();
  assert.equal(f.get('Review').hidden, false); assert.equal(f.get('Scenes').children.length, 2);
  assert.match(f.get('Status').textContent, /Reuse cannot be approved/);
  assert.equal(f.get('Reviewed').disabled, true); assert.equal(f.get('Confirmed').disabled, true);
  f.acknowledge(); await f.click(); assert.equal(f.calls.length, 0);
});

test('malformed bindings, hashes, IDs, consent, scene coverage, and choices fail closed', async () => {
  const mutations = [
    f => { f.snapshot.releaseId = 'bad'; }, f => { f.review.releaseId = id(999); },
    f => { f.snapshot.manuscriptVersionId = id(999); }, f => { f.snapshot.analysisJobId = id(999); },
    f => { f.snapshot.workId = id(999); }, f => { f.snapshot.manuscriptHash = 'bad'; },
    f => { f.active.manuscriptHash = f.completed.manuscriptHash = 'b'.repeat(64); },
    f => { f.review.canReset = true; }, f => { f.review.generationStarted = true; },
    f => { f.review.generationStarted = 'false'; }, f => { f.review.consentReview = null; },
    f => { f.review.consentReview.canReapprove = 'true'; }, f => { f.review.consentReview.consentId = 'bad'; },
    f => { f.review.consentReview.consentRevision = 0; }, f => { f.review.consentReview.consentRevision = 1.5; },
    f => { f.review.consentReview.consentRevision = Number.MAX_SAFE_INTEGER + 1; },
    f => { f.review.consentReview.batchHash = 'bad'; }, f => { f.review.preparedScenes = 1; },
    f => { f.review.resetRequiredScenes = 3; }, f => { f.review.preparedScenes = '2'; },
    f => { f.snapshot.parts = []; }, f => { f.snapshot.parts = {}; },
    f => { f.snapshot.parts[1].partKey = f.snapshot.parts[0].partKey; },
    f => { f.snapshot.parts[0].partKey = '../p1'; }, f => { f.snapshot.parts[0].title = {}; },
    f => { f.snapshot.parts[0].title = 'Bad\0title'; },
    f => { f.snapshot.scenes.pop(); }, f => { f.snapshot.scenes[0].choiceCount = 1; },
    f => { f.snapshot.scenes[1].partKey = f.snapshot.scenes[0].partKey; },
    f => { f.snapshot.scenes[1].sceneId = f.snapshot.scenes[0].sceneId; },
    f => { f.snapshot.scenes[0].sceneId = 'bad'; },
    f => { f.review.consentReview.scenes.pop(); }, f => { f.review.consentReview.scenes.push(clone(f.review.consentReview.scenes[0])); },
    f => { f.review.consentReview.scenes[1].partKey = 'unknown'; },
    f => { f.review.consentReview.scenes[1].sceneId = f.review.consentReview.scenes[0].sceneId; },
    f => { f.review.consentReview.scenes[0].sceneId = id(999); },
    f => { f.review.consentReview.scenes[0].choices.pop(); },
    f => { f.review.consentReview.scenes[0].choices[2].position = 2; },
    f => { f.review.consentReview.scenes[0].choices[2].position = '3'; },
    f => { f.review.consentReview.scenes[0].choices[2].routeKind = 'paid_generation'; },
    f => { f.review.consentReview.scenes[0].choices[0].routeKind = 'generation_required'; },
    f => { f.review.consentReview.scenes[0].choices[1].routeKind = 'writer_original'; },
    f => { f.review.consentReview.scenes[0].choices[2].routeKind = 'writer_original'; },
    f => { f.review.consentReview.scenes[0].choices[2].label = f.review.consentReview.scenes[0].choices[1].label; },
    f => { f.review.consentReview.scenes[0].choices[2].label = ' ' + f.review.consentReview.scenes[0].choices[1].label + ' '; },
    f => { f.review.consentReview.scenes[0].choices[2].label = ' '; },
    f => { f.review.consentReview.scenes[0].choices[2].label = 'x'.repeat(121); },
    f => { f.review.consentReview.scenes[0].choices[2].label = 'Bad\0label'; },
    f => { f.review.consentReview.scenes[0].choices[2].label = 'Bad\u001flabel'; },
    f => { f.snapshot.consent.active = false; }, f => { f.snapshot.consent.revision++; },
    f => { f.snapshot.consent.id = id(999); }, f => { f.active.identity.ownerId = null; },
    f => { f.active.identity.epoch = undefined; }, f => { f.window.LuminaCreatorStudioApi.isCurrent = undefined; },
    f => { f.window.LuminaCreatorStudioApi.fetch = undefined; }, f => { f.window.LuminaCreatorAnalysis = undefined; }
  ];
  for (const field of ['expectedManuscriptHash', 'expectedApprovedFingerprint', 'expectedProfilePinHash', 'expectedReleaseChecksum']) {
    mutations.push(f => { f.review[field] = null; }, f => { f.review[field] = 'bad'; });
  }
  for (const mutate of mutations) {
    const f = fixture(); mutate(f); f.show();
    assert.equal(f.get('Approve').disabled, true, mutate.toString());
    f.acknowledge(); await f.click();
    assert.equal(f.calls.length, 0, mutate.toString()); assert.equal(f.events.length, 0, mutate.toString());
  }
});

test('all source parts match by unique keys and scene IDs, and choice positions render in order', async () => {
  const f = fixture();
  f.snapshot.scenes.reverse(); f.review.consentReview.scenes.reverse();
  f.review.consentReview.scenes.forEach(scene => scene.choices.reverse());
  f.show(); f.acknowledge(); await f.click();
  assert.equal(f.events.length, 1);
  assert.match(f.get('Scenes').children[0].textContent, /1\. Part 1Saved p1 choice 1/);
});

test('legitimate title angle brackets, whitespace, and newlines remain visible as text', async () => {
  const f = fixture();
  f.snapshot.parts[0].title = '  <A title>\nwith\tspaces\r\nand > comparisons  ';
  f.snapshot.parts[1].title = '   \n  ';
  f.show();
  assert.equal(f.get('Scenes').children.length, 2);
  assert.equal(f.get('Scenes').children[0].children[0].textContent, `1. ${f.snapshot.parts[0].title}`);
  assert.equal(f.get('Scenes').children[0].children[0].children.length, 0);
  f.acknowledge(); await f.click(); assert.equal(f.events.length, 1);
});

test('saved choice angle brackets and markup-like strings render only as literal text', async () => {
  const f = fixture();
  const labels = ['<Stay here>', 'A < B & C > D', '<script>literal text</script>'];
  f.review.consentReview.scenes[0].choices.forEach((choice, index) => { choice.label = labels[index]; });
  f.show();
  const choices = f.get('Scenes').children[0].children[1].children;
  choices.forEach((choice, index) => {
    assert.equal(choice.children[0].textContent, labels[index]);
    assert.equal(choice.children[0].children.length, 0);
  });
  assert.equal(walk(f.get('Review')).some(node => node.tagName === 'SCRIPT'), false);
  f.acknowledge(); await f.click(); assert.equal(f.events.length, 1);
});

test('verified partial approval counts and zero-count idempotent replay emit the same guarded refresh', async () => {
  for (const [reapprovedScenes, idempotentReplay] of [[1, false], [2, false], [0, true]]) {
    const f = fixture(); f.reply({ ...f.goodReceipt, reapprovedScenes, idempotentReplay });
    f.show(); f.acknowledge(); await f.click();
    assert.equal(f.events.length, 1);
    assert.equal(f.get('Status').textContent, 'Saved choice reuse approved.');
    assert.equal(f.get('Approve').disabled, true);
  }
});

test('account, manuscript, source, consent, and review changes immediately clear choices and checks', async () => {
  const mutations = [
    f => f.expire(), f => { f.completed.identity.ownerId = id(999); }, f => { f.completed.identity.epoch++; },
    f => { f.completed.workId = id(999); }, f => { f.completed.manuscriptVersionId = id(999); },
    f => { f.completed.analysisJobId = id(999); }, f => { f.active.workId = id(999); },
    f => { f.active.identity.ownerId = id(999); }, f => { f.active.identity.epoch++; },
    f => { f.snapshot.releaseId = id(999); }, f => { f.snapshot.manuscriptHash = 'b'.repeat(64); },
    f => { f.snapshot.parts[0].title = 'Changed part'; }, f => { f.snapshot.scenes[0].choiceCount = 1; },
    f => { f.review.expectedProfilePinHash = 'f'.repeat(64); }, f => { f.review.expectedApprovedFingerprint = 'f'.repeat(64); },
    f => { f.review.expectedReleaseChecksum = 'f'.repeat(64); }, f => { f.review.consentReview.batchHash = 'f'.repeat(64); },
    f => { f.review.consentReview.scenes[0].choices[0].label = 'Changed choice'; },
    f => { f.review.consentReview.consentId = id(999); }, f => { f.review.consentReview.consentRevision++; },
    f => { f.review.consentReview.canReapprove = false; }, f => { f.snapshot.consent.active = false; },
    f => { f.window.LuminaCreatorStudioApi.isCurrent = () => { throw new Error('No identity'); }; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.show(); f.acknowledge(); mutate(f);
    await f.click();
    assert.equal(f.get('Review').hidden, true, mutate.toString());
    assert.equal(f.get('Scenes').textContent, '');
    assert.equal(f.get('Reviewed').checked, false); assert.equal(f.get('Confirmed').checked, false);
    assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
  }
});

test('reset, page hide, auth expiry, modal closure, and periodic identity checks erase the panel', () => {
  for (const close of [f => f.panel.reset(), f => f.dispatch('pagehide'), f => f.dispatch('lumina:auth-expired'),
    f => { f.modal.hidden = true; f.mutateModal(); },
    f => { f.modal.classList.add('is-hidden'); f.mutateModal(); },
    f => { f.expire(); f.tick(); }, f => { f.expire(); f.dispatch('lumina:authchange'); },
    f => { f.expire(); f.dispatch('focus'); }, f => { f.expire(); f.input(); }]) {
    const f = fixture(); f.show(); f.acknowledge(); close(f);
    assert.equal(f.get('Review').hidden, true); assert.equal(f.get('Scenes').textContent, '');
    assert.equal(f.get('Reviewed').checked, false); assert.equal(f.get('Confirmed').checked, false);
  }
});

test('identity and acknowledgements are rechecked after the confirmation dialog returns', async () => {
  for (const change of [f => f.expire(), f => f.panel.reset(), f => { f.get('Confirmed').checked = false; }]) {
    const f = fixture(); f.show(); f.acknowledge();
    f.window.confirm = () => { change(f); return true; };
    await f.click(); assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
  }
});

test('concurrent clicks and equivalent refreshed snapshots never duplicate the pending request', async () => {
  const f = fixture(), held = deferred(); f.reply(() => held.promise);
  f.show(); f.acknowledge(); const first = f.click();
  assert.equal(f.calls.length, 1); assert.equal(f.get('Approve').disabled, true);
  await f.click(); f.show(clone(f.snapshot), clone(f.review), clone(f.active)); await f.click();
  assert.equal(f.calls.length, 1); assert.equal(f.confirmations.length, 1);
  held.resolve(f.response()); await first;
  assert.equal(f.events.length, 1); await f.click(); assert.equal(f.calls.length, 1);
});

test('reset aborts a pending request; reopening the same batch cannot submit until it settles', async () => {
  const f = fixture(), held = deferred(); f.reply(() => held.promise); f.show(); f.acknowledge(); const first = f.click();
  f.panel.reset(); assert.equal(f.calls[0].signal.aborted, true);
  f.show(); assert.equal(f.get('Reviewed').disabled, true); assert.equal(f.get('Approve').disabled, true);
  await f.click(); assert.equal(f.calls.length, 1);
  held.resolve(f.response()); await first;
  assert.equal(f.events.length, 0); assert.equal(f.get('Review').hidden, false);
  assert.equal(f.get('Reviewed').disabled, false); assert.equal(f.get('Approve').disabled, true);
  assert.notEqual(f.get('Status').textContent, 'Saved choice reuse approved.');
});

test('late service and late JSON responses recheck account and source without waiting for a timer', async () => {
  for (const phase of ['fetch', 'json']) {
    const f = fixture(), held = deferred(), reading = deferred();
    f.reply(() => phase === 'fetch' ? held.promise : { ok: true, json: () => { reading.resolve(); return held.promise; } });
    f.show(); f.acknowledge(); const operation = f.click();
    if (phase === 'json') await reading.promise;
    f.completed.identity.epoch++;
    held.resolve(phase === 'fetch' ? f.response() : f.goodReceipt); await operation;
    assert.equal(f.events.length, 0); assert.equal(f.get('Review').hidden, true); assert.equal(f.get('Scenes').textContent, '');
  }
});

test('an old response cannot approve or unlock a different newer consent review', async () => {
  const f = fixture(), first = deferred(), second = deferred();
  f.reply(() => f.calls.length === 1 ? first.promise : second.promise);
  f.show(); f.acknowledge(); const old = f.click(); f.panel.reset();
  f.review.consentReview.consentRevision++; f.snapshot.consent.revision++;
  f.review.consentReview.batchHash = 'f'.repeat(64); f.show(); f.acknowledge(); const newer = f.click();
  assert.equal(f.calls.length, 2); first.resolve(f.response()); await old;
  assert.equal(f.events.length, 0); assert.equal(f.get('Status').textContent, 'Confirming reuse approval...');
  assert.equal(f.get('Approve').disabled, true); assert.equal(f.calls[1].body.expectedConsentRevision, 3);
  second.resolve(f.response()); await newer; assert.equal(f.events.length, 1);
});

test('unconfirmed receipts and transport failures never claim approval, emit refresh, or retry', async () => {
  const malformed = [() => null, () => [], () => 'current', () => ({}), () => ({ status: 'current' }),
    value => ({ ...value, generationStarted: true }), value => ({ ...value, generationStarted: 'false' }),
    value => ({ ...value, releaseId: id(999) }), value => ({ ...value, reapprovedScenes: -1 }),
    value => ({ ...value, reapprovedScenes: 0 }), value => ({ ...value, reapprovedScenes: 3 }),
    value => ({ ...value, idempotentReplay: true, reapprovedScenes: 1 }),
    value => ({ ...value, idempotentReplay: true, reapprovedScenes: 2 }),
    value => ({ ...value, reapprovedScenes: '2' }), value => ({ ...value, reapprovedScenes: 2.5 }),
    value => ({ ...value, idempotentReplay: undefined }), value => ({ ...value, idempotentReplay: 'false' }),
    value => ({ ...value, status: 'queued' }), value => ({ ...value, published: true })];
  for (const make of malformed) {
    const f = fixture();
    const value = make(f.goodReceipt); f.reply(value);
    f.show(); f.acknowledge(); await f.click();
    assert.equal(f.events.length, 0, JSON.stringify(value));
    assert.match(f.get('Status').textContent, /could not be confirmed/, JSON.stringify(value));
    assert.equal(f.get('Approve').disabled, true); assert.equal(f.get('Reviewed').checked, false);
    await f.click(); assert.equal(f.calls.length, 1);
  }
  for (const mode of ['http', 'json', 'transport']) {
    const f = fixture();
    f.reply(() => { if (mode === 'transport') throw new Error('Transport');
      return mode === 'http' ? f.response(f.goodReceipt, false) : { ok: true, json: async () => { throw new Error('JSON'); } }; });
    f.show(); f.acknowledge(); await f.click();
    assert.equal(f.events.length, 0); assert.match(f.get('Status').textContent, /could not be confirmed/);
    assert.equal(f.calls.length, 1); assert.equal(f.get('Approve').disabled, true);
  }
});

test('missing local API fails visibly and safely without a network or storage fallback', async () => {
  for (const remove of [f => { f.window.LuminaCreatorStudioApi = undefined; },
    f => { f.window.LuminaCreatorStudioApi.fetch = undefined; }, f => { f.window.LuminaCreatorStudioApi.isCurrent = undefined; }]) {
    for (const afterShow of [false, true]) {
      const f = fixture();
      if (afterShow) { f.show(); f.acknowledge(); }
      remove(f);
      if (afterShow) f.tick(); else f.show();
      assert.equal(f.get('Review').hidden, false);
      assert.match(f.get('Status').textContent, /creator service is unavailable/);
      assert.equal(f.get('Scenes').textContent, '');
      assert.equal(f.get('Reviewed').checked, false); assert.equal(f.get('Confirmed').checked, false);
      assert.equal(f.get('Reviewed').disabled, true); assert.equal(f.get('Confirmed').disabled, true);
      f.acknowledge(); await f.click(); assert.equal(f.calls.length, 0); assert.equal(f.events.length, 0);
    }
  }
  const f = fixture(); f.window.LuminaCreatorStudioApi = undefined; f.show(); f.locale('ja');
  assert.match(f.get('Status').textContent, /作者向けサービスを利用できません/);
  assert.equal(f.calls.length, 0);
});

test('synchronous main refresh on the verified event can reset without a stale final update', async () => {
  const f = fixture(); f.window.addEventListener('lumina:story-choice-consent-reviewed', () => {
    f.review.status = 'current'; f.show();
  });
  f.show(); f.acknowledge(); await f.click();
  assert.equal(f.events.length, 1); assert.equal(f.get('Review').hidden, true); assert.equal(f.get('Scenes').textContent, '');
});

test('five locales and locale aliases translate both acknowledgements and confirmation without refetching', async () => {
  const languages = [
    ['ko', '저장된 선택지 재사용 승인', '저장된 선택지를 검토했습니다.', '현재 동의', '새로운 AI 생성'],
    ['en', 'Saved Choice Reuse Approval', 'I reviewed saved choices.', 'current consent', 'No new AI generation'],
    ['ja', '保存済み選択肢の再利用承認', '保存済みの選択肢を確認しました。', '現在の同意', '新たな AI 生成'],
    ['zh-Hans', '批准复用已保存选项', '我已审阅已保存的选项。', '当前同意', '新的 AI 生成'],
    ['zh-Hant', '核准重用已儲存選項', '我已審閱已儲存的選項。', '目前的同意', '新的 AI 生成']
  ];
  const f = fixture(); f.show(); f.acknowledge();
  f.window.confirm = message => { f.confirmations.push(message); return false; };
  for (const [locale, title, reviewed, consent, confirmation] of languages) {
    f.locale(locale); assert.equal(f.get('Title').textContent, title);
    assert.equal(f.get('ReviewedText').textContent, reviewed); assert.ok(f.get('ConfirmedText').textContent.includes(consent));
    assert.equal(f.get('Approve').disabled, false); await f.click();
    assert.ok(f.confirmations.at(-1).includes(confirmation)); assert.equal(f.calls.length, 0);
    assert.ok(f.get('Scenes').textContent.includes('Saved p1 choice 1'));
  }
  for (const [alias, index] of [['ko-KR', 0], ['en-US', 1], ['ja-JP', 2], ['zh-CN', 3], ['zh-TW', 4]]) {
    f.locale(alias); assert.equal(f.get('Title').textContent, languages[index][1]);
  }
});

test('large batches retain all choices and only two global checks; long labels have wrapping styles', () => {
  const f = fixture({ total: 75 }); f.snapshot.parts[0].title = 'T'.repeat(1000);
  f.review.consentReview.scenes[0].choices[0].label = 'X'.repeat(120); f.show(); f.acknowledge();
  assert.equal(f.get('Scenes').children.length, 75);
  assert.equal(walk(f.get('Scenes')).filter(node => node.className === 'writer-choice-consent-label').length, 225);
  assert.equal(walk(f.get('Review')).filter(node => node.tagName === 'INPUT').length, 2);
  assert.equal(f.get('Approve').disabled, false);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /white-space: normal/);
  assert.match(css, /max-width: 100%/); assert.match(css, /max-height: 28rem/);
  assert.match(css, /@media \(max-width: 640px\)/); assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /white-space:\s*nowrap|\d+vw|border-radius|linear-gradient/);
  assert.equal(f.calls.length, 0);
});

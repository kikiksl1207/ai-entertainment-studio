import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { approvalState, deferred, id, originalReceipt, preview } from './support/creator-body-source-read-20261007.mjs';

const scripts = Object.fromEntries(['creator-studio', 'creator-body-preview', 'creator-body-trial', 'creator-body-review']
  .map(name => [name, readFileSync(new URL(`../pages/${name}.js`, import.meta.url), 'utf8')]));
const acceptedEvent = 'creator:manuscript-accepted';
const workId = id(1), ownerId = id(8), manuscriptId = id(20);
const oldMarker = 'SYNTHETIC_N1_SAVED_BODY_NOT_CURRENT_N2';
const newMarker = 'SYNTHETIC_N2_EXPLICIT_CURRENT_BODY';
const manuscript = '# Part 01. Synthetic N2\nNew synthetic source, not an approval or quality claim.\n';
const clone = value => JSON.parse(JSON.stringify(value));
const consumers = ['Preview', 'Trial', 'Review'];
// 17 synthetic cases: 5 producer, 6 body-read, 2 head-read, 2 recovery, 2 receipt.
// Parent-only RED selector: ^AUTHOR-MANUSCRIPT-CURRENT-RED\b

// Adapt the existing writer and mounted-reader Element fixtures; no private state exports.
class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.value = ''; this.checked = false;
    this._disabled = false; this.hidden = false; this.dataset = {}; this.style = {};
    this.children = []; this.listeners = new Map(); this.attributes = {}; this.className = ''; this._text = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className} ${name}`.trim(); },
      remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.contains(name);
        this.classList[enabled ? 'add' : 'remove'](name); return enabled;
      }
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  get options() { return this.children.filter(child => child.tagName === 'OPTION'); }
  get disabled() { return this._disabled; }
  set disabled(value) {
    const changed = this._disabled !== Boolean(value); this._disabled = Boolean(value);
    if (changed) this.attributeChanged?.('disabled');
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) {
    const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list);
  }
  removeEventListener(type, callback) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== callback));
  }
  fire(type, event = {}) {
    let result;
    for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event });
    return result;
  }
  find(predicate) { return walk(this).find(predicate) || null; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
  focus() {}
  setSelectionRange(start) { this.selectionStart = start; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
class UnitEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
function storage(initial = []) {
  const entries = new Map(initial), effects = { writes: 0, removes: 0 };
  return { entries, effects, getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { effects.writes++; entries.set(key, String(value)); },
    removeItem: key => { effects.removes++; entries.delete(key); } };
}
function bodyPreview(version) {
  const value = preview(workId, 'ko');
  value.progress.revision = version === 1 ? 7 : 8;
  value.progress.scene.id = version === 1 ? id(3) : id(23);
  value.progress.scene.beats[0].content = version === 1 ? oldMarker : newMarker;
  return value;
}
function bodyReview(version) {
  const value = bodyPreview(version);
  return { contract: 'story-author-body-review-v1', workId, locale: 'ko', readOnly: true,
    generationStarted: false, imageGenerationStarted: false, publicationStarted: false, sharedReuseAuthorized: false,
    state: 'reviewable', target: { progressId: value.progress.progressId, progressRevision: value.progress.revision,
      sceneId: value.progress.scene.id, sourceBindingHash: 'ab'.repeat(32), bodyChecksum: 'cd'.repeat(32), ending: false },
    latestReview: null };
}
const recoveredCommand = { workId, choiceId: id(5), key: 'recovered-command-0001',
  body: { approvalId: id(7), progressId: id(2), expectedRevision: 7, locale: 'ko' } };
function recovery() {
  return { contract: 'story-author-body-trial-recovery-v1', workId, readOnly: true,
    generationAuthorized: false, generationStarted: false, imageGenerationStarted: false, command: clone(recoveredCommand) };
}
function receipt() {
  return { contract: 'story-author-body-trial-receipt-v1', workId, choiceId: id(5), approvalId: id(7),
    progressId: id(2), sourceRevision: 7, locale: 'ko', readOnly: true, generationAuthorized: false,
    generationStarted: false, imageGenerationStarted: false, receipt: { ...originalReceipt(), idempotentReplay: true } };
}

function screen() {
  const ids = ['studioShell', 'writer-manuscript', 'writerManuscriptWork', 'writerManuscriptLocale',
    'writerDraftTitle', 'writerDraftCreate', 'writerDraftState', 'writerDraftMetadata', 'writerMetadataAuthor',
    'writerMetadataSummary', 'writerMetadataCover', 'writerMetadataSave', 'writerMetadataState',
    'writerManuscriptExpected', 'writerManuscriptBody', 'writerManuscriptParts', 'writerManuscriptState',
    'writerManuscriptBoundary', 'writerManuscriptPreface', 'writerManuscriptPrefaceChoice',
    'writerManuscriptSeparatePreface', 'writerManuscriptConfirm', 'writerManuscriptSubmit', 'writerManuscriptFile',
    'writerManuscriptAddPart', 'writerManuscriptAutoParts', 'writerManuscriptReview', 'writerManuscriptClear'];
  const tags = { studioShell: 'div', 'writer-manuscript': 'section', writerDraftState: 'p',
    writerDraftMetadata: 'div', writerMetadataSummary: 'textarea', writerMetadataState: 'p',
    writerManuscriptWork: 'select', writerManuscriptLocale: 'select', writerManuscriptBody: 'textarea',
    writerManuscriptParts: 'div', writerManuscriptState: 'p', writerManuscriptBoundary: 'p',
    writerManuscriptPreface: 'p', writerManuscriptPrefaceChoice: 'label' };
  const controls = Object.fromEntries(ids.map(name => [name, new Element(tags[name] ||
    (/(?:Submit|Review|Clear|AutoParts|AddPart|Create|Save)$/.test(name) ? 'button' : 'input'), name)]));
  controls['writer-manuscript'].classList.add('is-active');
  controls.writerManuscriptWork.value = workId; controls.writerManuscriptLocale.value = 'ko';
  for (const [control, value, label] of [[controls.writerManuscriptWork, workId, 'Synthetic private work'],
    [controls.writerManuscriptLocale, 'ko', 'Korean']]) {
    const option = new Element('option'); option.value = value; option.selected = true; option.textContent = label;
    control.append(option);
  }
  const window = new Element(), document = new Element(), hosts = {};
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko';
  document.visibilityState = 'visible'; document.readyState = 'complete';
  document.getElementById = name => controls[name] || Object.values(hosts).flatMap(walk).find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  document.querySelector = () => null;
  document.querySelectorAll = selector => selector.startsWith('#writer-manuscript ')
    ? [...Object.values(controls), ...walk(controls.writerManuscriptParts).slice(1), ...Object.values(hosts).flatMap(walk)]
      .filter(node => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(node.tagName)) : [];
  // Only the actual observed disabled mutations are delivered, in a microtask.
  const observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; this.targets = []; observers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
    disconnect() { this.targets = []; this.records = []; }
  }
  for (const node of Object.values(controls)) node.attributeChanged = attributeName => {
    for (const observer of observers) {
      if (!observer.targets.some(item => item.target === node && item.options.attributes &&
          (!item.options.attributeFilter || item.options.attributeFilter.includes(attributeName)))) continue;
      observer.records.push({ type: 'attributes', target: node, attributeName });
      if (observer.records.length === 1) Promise.resolve().then(() => {
        const records = observer.records.splice(0); if (records.length) observer.callback(records);
      });
    }
  };
  const auth = { accessToken: 'synthetic-existing-token', user: { id: ownerId } };
  const localStorage = storage([['lumina_auth', JSON.stringify(auth)]]), sessionStorage = storage();
  const calls = [], events = [], effects = { forbidden: 0, timers: 0 }, holds = [];
  let savedVersion = 1, pasteMode = 'accept';
  window.LUMINA_API_BASE = 'https://example.invalid'; window.getAuth = () => auth;
  window.luminaI18n = { t: key => key, getLocale: () => 'ko' };
  window.localStorage = localStorage; window.sessionStorage = sessionStorage;
  window.crypto = { randomUUID: () => id(90) };
  window.dispatchEvent = event => {
    events.push({ type: event.type, receipt: clone(window.LuminaCreatorManuscript.receipt()) });
    window.fire(event.type, event); return true;
  };
  const response = (value, status = 200) => ({ status, ok: status >= 200 && status < 300,
    headers: { get: () => null }, json: async () => value, text: async () => JSON.stringify(value),
    body: { cancel: async () => {} } });
  const root = `/api/v1/me/creator-studio/stories/${workId}`;
  const fetch = async (url, options) => {
    const path = new URL(url).pathname;
    const kind = path === `${root}/manuscripts/paste` ? 'paste' : path === `${root}/body-trial-state` ? 'state' :
      path === `${root}/body-preview` ? 'preview' : path === `${root}/body-review` ? 'review' :
        path === `${root}/body-trial/recovery` ? 'recovery' :
          path === `${root}/body-trial/choices/${id(5)}/receipt` ? 'receipt' : 'forbidden';
    calls.push({ url, options, kind });
    if (kind === 'forbidden' || options.method !== (kind === 'paste' ? 'POST' : 'GET')) {
      effects.forbidden++; throw new Error('Unrequested transport, replay or generation');
    }
    assert.equal(options.headers.Authorization, `Bearer ${auth.accessToken}`);
    if (kind === 'paste') {
      assert.ok(options.body instanceof FormData);
      const file = options.body.get('manuscript'), manifest = JSON.parse(options.body.get('manifest'));
      assert.equal(await file.text(), manuscript); assert.equal(manifest.locale, 'ko');
      assert.equal(manifest.parts.length, 1);
      if (pasteMode === 'rejected') return response(null, 413);
      const value = { manuscript: { id: manuscriptId, workId, locale: 'ko', version: 2, contentHash: 'a'.repeat(64) },
        received: { sourceKind: 'utf8_paste', byteLength: file.size, parts: manifest.parts.length },
        analysisStarted: false, idempotentReplay: false };
      if (pasteMode === 'wrongWork') value.manuscript.workId = id(99);
      else if (pasteMode === 'wrongBytes') value.received.byteLength++;
      else savedVersion = 2;
      return response(value, 201);
    }
    const value = kind === 'state' ? approvalState(workId) : kind === 'preview' ? bodyPreview(savedVersion) :
      kind === 'review' ? bodyReview(savedVersion) : kind === 'recovery' ? recovery() : receipt();
    const reply = response(value), hold = holds.find(item => !item.used && item.kind === kind);
    if (hold) {
      hold.used = true; hold.call = calls.at(-1);
      reply.text = async () => { hold.entered.resolve(); return hold.result.promise; };
      hold.value = value;
    }
    return reply;
  };
  window.fetch = fetch;
  const context = createContext({ window, document, localStorage, sessionStorage, location: { hash: '' }, fetch,
    TextEncoder, TextDecoder, Blob, FormData, URL, URLSearchParams, AbortController, DOMException,
    Event: UnitEvent, CustomEvent: UnitEvent, MutationObserver, Option: Element, crypto: window.crypto, console,
    setTimeout: () => { effects.timers++; throw new Error('Bootstrap timer outside this fixture'); }, clearTimeout() {} });
  // The existing writer fixture omits only automatic verify(); no handler/state injection.
  const verify = scripts['creator-studio'].lastIndexOf('  verify();');
  assert.ok(verify > 0);
  runInContext(scripts['creator-studio'].slice(0, verify) + scripts['creator-studio'].slice(verify + '  verify();'.length),
    context, { filename: 'creator-studio.js' });
  for (const name of ['creator-body-preview', 'creator-body-trial', 'creator-body-review']) {
    runInContext(scripts[name], context, { filename: `${name}.js` });
  }
  const controllers = {};
  for (const name of consumers) {
    const host = new Element('section', `writerBody${name}`); hosts[name] = host;
    controllers[name] = window[`LuminaCreatorBody${name}`].mount(host);
    assert.ok(controllers[name], `actual ${name} mount`);
  }
  const click = name => {
    const node = document.getElementById(name); assert.ok(node, `bound control ${name}`);
    assert.equal(node.disabled, false, `enabled control ${name}`); return node.fire('click');
  };
  const hold = kind => {
    const value = { kind, used: false, entered: deferred(), result: deferred() }; holds.push(value);
    return { entered: value.entered.promise, call: () => value.call,
      finish: outcome => outcome === 'success' ? value.result.resolve(JSON.stringify(value.value)) :
        value.result.reject(new Error('SYNTHETIC_OLD_N1_READ_FAILURE')) };
  };
  return { controls, controllers, hosts, window, document, calls, events, effects, sessionStorage, click, hold,
    mode: value => { pasteMode = value; }, load: name => click(`writerBody${name}Refresh`),
    scope: () => clone({ identity: window.LuminaCreatorStudioApi.identity(), context: window.LuminaCreatorManuscript.context(),
      language: document.documentElement.lang }),
    accepted: () => events.filter(event => event.type === acceptedEvent) };
}

function prepare(view) {
  const input = view.controls.writerManuscriptBody;
  input.value = manuscript; input.fire('input');
  const title = view.controls.writerManuscriptParts.find(node => node.maxLength === 240);
  assert.ok(title, 'actual rendered part title'); title.value = 'Synthetic N2'; title.fire('input');
  view.controls.writerManuscriptExpected.value = '1'; view.controls.writerManuscriptExpected.fire('input');
  view.click('writerManuscriptReview');
  assert.equal(view.controls.writerManuscriptConfirm.disabled, false);
  view.controls.writerManuscriptConfirm.checked = true; view.controls.writerManuscriptConfirm.fire('change');
  assert.equal(view.controls.writerManuscriptSubmit.disabled, false);
}
async function submit(view) { prepare(view); await view.click('writerManuscriptSubmit'); }
async function loadAll(view) {
  for (const name of consumers) { assert.equal(await view.load(name), true); assert.match(view.hosts[name].textContent, new RegExp(oldMarker)); }
}
function assertIdle(view, name) {
  const value = view.controllers[name].snapshot();
  assert.equal(value.data, null); assert.equal(value.busy, false); assert.equal(value.phase, 'idle');
  assert.equal(value.messageKey, 'ready'); assert.doesNotMatch(view.hosts[name].textContent, new RegExp(oldMarker));
  if (name === 'Trial') { assert.equal(value.canChoose, false); assert.equal(value.canRecordRead, false); }
  if (name === 'Review') {
    assert.equal(value.canReview, false);
    assert.ok(Object.values(value.reviewed).every(value => value === false));
  }
}
function assertNoReplay(view, pasteCount = 1) {
  assert.equal(view.effects.forbidden, 0); assert.equal(view.effects.timers, 0);
  assert.equal(view.calls.filter(call => call.options.method !== 'GET').length, pasteCount);
  assert.equal(view.calls.filter(call => call.kind === 'paste').length, pasteCount);
  assert.equal(view.accepted().length, pasteCount);
}
async function currentRead(view, name) {
  const count = view.calls.length;
  assert.equal(await view.load(name), true);
  assert.match(view.hosts[name].textContent, new RegExp(newMarker));
  assert.doesNotMatch(view.hosts[name].textContent, new RegExp(oldMarker));
  const added = view.calls.slice(count);
  assert.equal(added.length, name === 'Preview' ? 1 : 2);
  for (const call of added) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.cache, 'no-store'); }
}

test('AUTHOR-MANUSCRIPT-CURRENT verified bound N2 submit invalidates all three saved views without automatic reads', async () => {
  const view = screen(); assert.equal(view.calls.length, 0); await loadAll(view);
  const scope = view.scope(), count = view.calls.length;
  await submit(view);
  assert.equal(view.calls.length, count + 1); assertNoReplay(view);
  const accepted = view.accepted()[0].receipt;
  assert.equal(accepted.id, manuscriptId); assert.equal(accepted.workId, workId);
  assert.equal(accepted.sourceLocale, 'ko'); assert.equal(accepted.version, 2); assert.equal(accepted.contentHash, 'a'.repeat(64));
  assert.deepEqual(view.scope(), scope);
  for (const name of consumers) assertIdle(view, name);
  assert.equal(view.sessionStorage.effects.writes, 0); assert.equal(view.sessionStorage.effects.removes, 0);
});

test('AUTHOR-MANUSCRIPT-CURRENT unsaved bound input does not emit acceptance or invalidate saved views', async () => {
  const view = screen(); await loadAll(view);
  const before = consumers.map(name => JSON.stringify(view.controllers[name].snapshot())), count = view.calls.length;
  view.controls.writerManuscriptBody.value = manuscript; view.controls.writerManuscriptBody.fire('input');
  assert.equal(view.calls.length, count); assert.equal(view.accepted().length, 0);
  assert.equal(view.window.LuminaCreatorManuscript.receipt(), null);
  assert.deepEqual(consumers.map(name => JSON.stringify(view.controllers[name].snapshot())), before);
  assert.equal(view.effects.forbidden, 0);
});

for (const [mode, feedback] of [['rejected', 'rejected'], ['wrongWork', 'invalidReceipt'], ['wrongBytes', 'invalidReceipt']]) {
  test(`AUTHOR-MANUSCRIPT-CURRENT ${mode} bound receipt does not emit acceptance or replace saved views`, async () => {
    const view = screen(); await loadAll(view); view.mode(mode);
    const before = consumers.map(name => JSON.stringify(view.controllers[name].snapshot())), count = view.calls.length;
    await submit(view);
    assert.equal(view.calls.length, count + 1); assert.equal(view.accepted().length, 0);
    assert.equal(view.window.LuminaCreatorManuscript.receipt(), null);
    assert.match(view.controls.writerManuscriptState.textContent, new RegExp(`writerManuscript\\.${feedback}`));
    assert.deepEqual(consumers.map(name => JSON.stringify(view.controllers[name].snapshot())), before);
    assert.equal(view.effects.forbidden, 0); assert.equal(view.sessionStorage.effects.writes, 0);
  });
}

for (const name of consumers) {
  for (const outcome of ['success', 'failure']) {
    const prefix = name === 'Preview' && outcome === 'success' ? 'AUTHOR-MANUSCRIPT-CURRENT-RED' : 'AUTHOR-MANUSCRIPT-CURRENT';
    test(`${prefix} suppresses N1 ${name.toLowerCase()} ${outcome} after verified N2 submit and permits an explicit current read`, async () => {
      const view = screen(), scope = view.scope(), held = view.hold('preview');
      const loading = view.load(name); await held.entered;
      const count = view.calls.length;
      await submit(view);
      assert.equal(view.calls.length, count + 1);
      const after = JSON.stringify(view.controllers[name].snapshot()), notice = view.hosts[name].textContent;
      held.finish(outcome); const settled = await loading;
      assert.doesNotMatch(view.hosts[name].textContent, new RegExp(oldMarker), 'a completed N1 reply must not become the N2 view');
      assert.equal(settled, false); assertIdle(view, name);
      assert.equal(held.call().options.signal.aborted, true);
      assert.equal(JSON.stringify(view.controllers[name].snapshot()), after);
      assert.equal(view.hosts[name].textContent, notice); assert.equal(view.calls.length, count + 1);
      assert.deepEqual(view.scope(), scope); await currentRead(view, name); assertNoReplay(view);
    });
  }
}

for (const [name, kind] of [['Trial', 'state'], ['Review', 'review']]) {
  test(`AUTHOR-MANUSCRIPT-CURRENT N1 ${kind} head cannot start a downstream body read after verified N2 submit`, async () => {
    const view = screen(), held = view.hold(kind), loading = view.load(name); await held.entered;
    await submit(view); assertIdle(view, name);
    const count = view.calls.length;
    held.finish('success'); assert.equal(await loading, false);
    assert.equal(view.calls.length, count); assert.equal(view.calls.filter(call => call.kind === 'preview').length, 0);
    assertIdle(view, name); await currentRead(view, name); assertNoReplay(view);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`AUTHOR-MANUSCRIPT-CURRENT N1 recovery ${outcome} cannot install an old command after verified N2 submit`, async () => {
    const view = screen(), held = view.hold('recovery'), recovering = view.click('writerBodyTrialRecover');
    await held.entered; await submit(view); assertIdle(view, 'Trial');
    const after = JSON.stringify(view.controllers.Trial.snapshot()), count = view.calls.length;
    held.finish(outcome); assert.equal(await recovering, false);
    assert.equal(JSON.stringify(view.controllers.Trial.snapshot()), after); assert.equal(view.calls.length, count);
    assert.equal(view.sessionStorage.entries.size, 0); assert.equal(view.sessionStorage.effects.writes, 0);
    assert.equal(view.sessionStorage.effects.removes, 0);
    assert.equal(await view.click('writerBodyTrialRecover'), true, 'only an explicit current recovery may install server evidence');
    assert.equal(view.controllers.Trial.snapshot().unresolved, true); assert.equal(view.sessionStorage.entries.size, 1);
    assert.equal(view.calls.length, count + 1); assertNoReplay(view);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`AUTHOR-MANUSCRIPT-CURRENT late N1 receipt ${outcome} preserves the exact recovered unknown command across N2 acceptance`, async () => {
    const view = screen(); assert.equal(await view.click('writerBodyTrialRecover'), true);
    const saved = [...view.sessionStorage.entries], effects = clone(view.sessionStorage.effects);
    assert.equal(saved.length, 1);
    const journal = JSON.parse(saved[0][1]);
    assert.equal(journal.ownerId, ownerId); assert.equal(journal.key, recoveredCommand.key);
    assert.equal(journal.workId, workId); assert.equal(journal.choiceId, recoveredCommand.choiceId);
    assert.deepEqual(journal.body, recoveredCommand.body);
    const held = view.hold('receipt'), retrying = view.click('writerBodyTrialRetry'); await held.entered;
    const request = held.call(), query = new URL(request.url).searchParams;
    assert.equal(request.options.method, 'GET'); assert.equal(request.options.headers['Idempotency-Key'], recoveredCommand.key);
    for (const [key, value] of Object.entries(recoveredCommand.body)) assert.equal(query.get(key), String(value));
    const count = view.calls.length; await submit(view);
    assert.equal(view.calls.length, count + 1); assert.equal(request.options.signal.aborted, true);
    const state = view.controllers.Trial.snapshot();
    assert.equal(state.unresolved, true); assert.equal(state.phase, 'uncertain'); assert.equal(state.canRetry, true);
    assert.equal(state.canChoose, false); assert.equal(state.receipt, null); assert.equal(state.data, null);
    const after = JSON.stringify(state), notice = view.hosts.Trial.textContent;
    held.finish(outcome); assert.equal(await retrying, false);
    assert.equal(JSON.stringify(view.controllers.Trial.snapshot()), after); assert.equal(view.hosts.Trial.textContent, notice);
    assert.deepEqual([...view.sessionStorage.entries], saved); assert.deepEqual(view.sessionStorage.effects, effects);
    assert.equal(view.calls.length, count + 1); assertNoReplay(view);
  });
}

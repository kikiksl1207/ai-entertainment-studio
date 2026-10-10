'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../pages/creator-body-original-reference.js'), 'utf8');
const css = readFileSync(path.join(__dirname, '../pages/creator-body-original-reference.css'), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const beat = (position = 1, content = '  full original \uD83D\uDE00\nmiddle\nTAIL  ') => ({ position, type: 'narration', content });
function reference(locale = 'ko', workId = id(1)) {
  return {
    contract: 'story-author-body-original-reference-v1', workId, locale, readOnly: true,
    referenceScope: 'current_published_original_part', progressRevision: 7, semanticQualityVerified: false,
    bodySourceAligned: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
    outcome: 'reference_ready', original: { scenes: [{ position: 1, title: 'Original \uC6D0\uC791', beats: [beat()] }] },
    savedBody: { isGenerated: true, title: 'Saved body', beats: [beat(1, '  saved\nmiddle\nSAVED TAIL  ')] }
  };
}
function absent(locale = 'ko', workId = id(1)) {
  return { ...reference(locale, workId), outcome: 'no_saved_body', progressRevision: null, original: null, savedBody: null };
}
function response(value = reference(), { status = 200, raw = JSON.stringify(value), chunks = null, length = null, read = null } = {}) {
  let index = 0;
  const stats = { reads: 0, cancelled: 0, released: 0, textReads: 0 };
  const bytes = chunks || [new TextEncoder().encode(raw)];
  const reader = {
    read: async () => { stats.reads++; return read ? read(stats.reads) : index < bytes.length ? { done: false, value: bytes[index++] } : { done: true }; },
    cancel: async () => { stats.cancelled++; },
    releaseLock: () => { stats.released++; }
  };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : null },
    body: { getReader: () => reader, cancel: async () => { stats.cancelled++; } },
    text: () => { stats.textReads++; throw new Error('Text fallback forbidden'); } };
}
function library(extra = {}) {
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController, ...extra });
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyOriginalReference, vm };
}
function screen(handler = ({ sourceLocale, workId }) => response(reference(sourceLocale, workId)), onChange = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko', shown = true, authorized = true;
  const calls = [], states = [], { api } = library();
  const controller = api.createController({
    fetch: (url, options) => { calls.push({ url, options }); return handler({ sourceLocale, workId, calls, options }); },
    identity: () => owner, isCurrent: value => authorized && !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => { states.push(clone(state)); onChange(state); }
  });
  return { ...controller, calls, states, api, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; }
  } };
}
const target = (locale = 'ko', workId = id(1)) => ({ locale, workId });
const parse = (value, expected = target()) => library().api.parseReference(value, expected);
const cleared = view => assert.equal(view.snapshot().data, null);

// The synthetic DOM implements standard ancestry, events and text nodes; it never supplies private controller state.
class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.parentElement = null;
    this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.style = {};
    this.hidden = false; this.disabled = false; this.value = ''; this._text = ''; this.className = ''; this.isConnected = true;
    this.classes = new Set(); this.classList = {
      contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name)
    };
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this._text = ''; this.append(...nodes); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_) { throw new Error('HTML insertion forbidden'); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
  fire(name, event = {}) { let result; for (const callback of this.listeners.get(name) || []) result = callback({ target: this, ...event }); return result; }
  contains(node) { for (let current = node; current; current = current.parentElement) if (current === this) return true; return false; }
  closest(selector) { for (let current = this; current; current = current.parentElement) if (selector === '[data-section]' && current.getAttribute('data-section') !== null) return current; return null; }
}
const walk = node => [node, ...node.children.flatMap(walk)];
function mounted(handler = ({ locale, workId }) => response(reference(locale, workId)), language = 'ko') {
  const html = new Element('html'); html.lang = language;
  const shell = new Element('div', 'studioShell'), main = new Element('main'), section = new Element('section', 'writer-manuscript');
  main.className = 'studio-main'; shell.className = 'studio-shell'; section.classList.add('is-active');
  const work = new Element('select', 'writerManuscriptWork'), locale = new Element('select', 'writerManuscriptLocale');
  work.value = id(1); locale.value = language;
  const preview = new Element('section', 'writerBodyPreview'), trial = new Element('section', 'writerBodyTrial');
  preview.textContent = 'EXISTING PREVIEW'; trial.textContent = 'EXISTING TRIAL';
  const host = new Element('section', 'writerBodyOriginalReference');
  section.append(work, locale, preview, host, trial); main.append(section); shell.append(main); html.append(shell);
  const document = new Element('document'); document.documentElement = html; document.visibilityState = 'visible';
  document.createElement = tag => new Element(tag);
  document.getElementById = name => walk(html).find(node => node.id === name) || null;
  const window = new Element('window'), calls = [], observers = [], icons = [];
  let owner = { ownerId: id(8), epoch: 1 }, token = 'SYNTHETIC_TOKEN';
  let authHook = null, fetches = 0, refreshRequests = 0;
  window.getAuth = () => { if (authHook) authHook(); return { accessToken: token }; };
  window.luminaI18n = { getLocale: () => html.lang };
  window.lucide = { icons: { ArrowLeftRight: {} }, createElement: icon => { icons.push(icon); return new Element('svg'); } };
  window.LuminaCreatorStudioApi = {
    identity: () => owner,
    isCurrent: value => !!value && !!owner && value.ownerId === owner.ownerId && value.epoch === owner.epoch,
    fetch: (url, options) => {
      fetches++; calls.push({ url, options });
      if (!options._retried || !options.token) refreshRequests++;
      return handler({ locale: locale.value, workId: work.value, calls, options });
    }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(node, options) { observers.push({ node, options, callback: this.callback }); }
  }
  const { api } = library({ window, document, MutationObserver, fetch: () => { throw new Error('Direct network forbidden'); } });
  const find = name => document.getElementById(name);
  const button = find('writerBodyOriginalReferenceRead'), content = find('writerBodyOriginalReferenceContent');
  return { api, window, document, shell, section, work, locale, host, preview, trial, html, button, content, calls, observers, icons,
    click: () => button.fire('click'),
    find,
    observe: node => { for (const item of observers.filter(item => item.node === node)) item.callback([]); },
    auth: value => { owner = value; }, token: value => { token = value; }, authHook: value => { authHook = value; },
    counts: () => ({ fetches, refreshRequests }) };
}
function domCleared(view) {
  assert.equal(view.content.children.length, 0); assert.equal(view.content.hidden, true);
  assert.equal(view.find('writerBodyOriginalReferenceOriginalTitle'), null);
  assert.equal(view.find('writerBodyOriginalReferenceSavedTitle'), null);
}

test('ORIGINAL-REFERENCE: exact five-locale contract preserves immutable full Unicode and whitespace', () => {
  for (const locale of locales) {
    const value = freeze(reference(locale)), before = JSON.stringify(value);
    const result = parse(value, target(locale));
    assert.deepEqual(clone(result), value); assert.equal(JSON.stringify(value), before);
    assert.equal(result.original.scenes[0].beats[0].content, value.original.scenes[0].beats[0].content);
    assert.equal(result.savedBody.beats[0].content, value.savedBody.beats[0].content);
  }
});

test('ORIGINAL-REFERENCE: absent reference keeps nulls while ready requires a safe nonnegative revision', () => {
  for (const revision of [null, 0, 7, Number.MAX_SAFE_INTEGER]) {
    const value = absent(); value.progressRevision = revision; assert.deepEqual(clone(parse(value)), value);
  }
  for (const revision of [0, Number.MAX_SAFE_INTEGER]) {
    const value = reference(); value.progressRevision = revision; value.savedBody.isGenerated = false;
    assert.deepEqual(clone(parse(value)), value);
  }
  for (const revision of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '7', NaN]) {
    const value = reference(); value.progressRevision = revision; assert.throws(() => parse(value));
  }
  for (const mutate of [v => { v.original = reference().original; }, v => { v.savedBody = reference().savedBody; }]) {
    const value = absent(); mutate(value); assert.throws(() => parse(value));
  }
});

test('ORIGINAL-REFERENCE: exact keys, flags, work and source-locale echoes reject unsafe envelopes', () => {
  const changes = [
    v => { v.contract = 'v2'; }, v => { v.workId = id(2); }, v => { v.workId = '../private'; },
    v => { v.locale = 'en'; }, v => { v.referenceScope = 'historical_source'; }, v => { v.readOnly = false; },
    v => { v.outcome = 'quality_pass'; }, v => { v.extra = 'PRIVATE'; }, v => { delete v.original; }
  ];
  for (const name of ['semanticQualityVerified', 'bodySourceAligned', 'dispatchAuthorized', 'providerCalls', 'operatingWrites']) {
    changes.push(v => { v[name] = true; }, v => { v[name] = 1; }, v => { delete v[name]; });
  }
  for (const change of changes) { const value = reference(); change(value); assert.throws(() => parse(value)); }
  for (const value of [null, [], false, 'raw']) assert.throws(() => parse(value));
  for (const expected of [null, target('zh'), target('ko', 'bad')]) assert.throws(() => parse(reference(), expected));
});

test('ORIGINAL-REFERENCE: sorted positions may exceed collection limits but remain unique safe positive integers', () => {
  const value = reference();
  value.original.scenes = [{ position: 101, title: 'A', beats: [beat(1001), beat(Number.MAX_SAFE_INTEGER)] },
    { position: Number.MAX_SAFE_INTEGER, title: 'B', beats: [beat(1002)] }];
  value.savedBody.beats = [beat(1001), beat(Number.MAX_SAFE_INTEGER)];
  assert.deepEqual(clone(parse(value)), value);
  for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
    for (const location of ['scene', 'originalBeat', 'savedBeat']) {
      const input = reference();
      (location === 'scene' ? input.original.scenes[0] : location === 'originalBeat' ? input.original.scenes[0].beats[0] : input.savedBody.beats[0]).position = bad;
      assert.throws(() => parse(input));
    }
  }
  for (const positions of [[2, 2], [2, 1]]) {
    const input = reference(); input.original.scenes = positions.map(position => ({ position, title: 'Scene', beats: [beat()] }));
    assert.throws(() => parse(input));
    const beatsInput = reference(); beatsInput.savedBody.beats = positions.map(position => beat(position)); assert.throws(() => parse(beatsInput));
    beatsInput.savedBody.beats = [beat()]; beatsInput.original.scenes[0].beats = positions.map(position => beat(position));
    assert.throws(() => parse(beatsInput));
  }
});

test('ORIGINAL-REFERENCE: original scene and aggregate beat bounds are exact without truncation', () => {
  const value = reference();
  value.original.scenes = Array.from({ length: 100 }, (_, n) => ({ position: n + 1, title: 'S', beats: Array.from({ length: 10 }, (_, b) => beat(b + 1, 'text')) }));
  assert.equal(parse(value).original.scenes.length, 100);
  value.original.scenes[99].beats.push(beat(11, 'extra')); assert.throws(() => parse(value));
  const single = reference(); single.original.scenes[0].beats = Array.from({ length: 1000 }, (_, n) => beat(n + 1, 'x'));
  assert.equal(parse(single).original.scenes[0].beats.length, 1000);
  single.original.scenes[0].beats.push(beat(1001, 'x')); assert.throws(() => parse(single));
  for (const scenes of [[], Array.from({ length: 101 }, (_, n) => ({ position: n + 1, title: 'S', beats: [beat()] }))]) {
    const input = reference(); input.original.scenes = scenes; assert.throws(() => parse(input));
  }
});

test('ORIGINAL-REFERENCE: saved forty-beat limit and nested exact shapes fail closed', () => {
  const value = reference(); value.savedBody.beats = Array.from({ length: 40 }, (_, n) => beat(n + 1));
  assert.equal(parse(value).savedBody.beats.length, 40);
  value.savedBody.beats.push(beat(41)); assert.throws(() => parse(value));
  for (const change of [
    v => { v.savedBody.isGenerated = 'true'; }, v => { v.savedBody.beats = []; }, v => { v.original.scenes[0].beats = []; },
    v => { v.original.extra = true; }, v => { v.original.scenes[0].id = id(4); },
    v => { v.original.scenes[0].beats[0].id = id(5); }, v => { v.savedBody.rawBody = 'secret'; },
    v => { delete v.savedBody.title; }, v => { delete v.savedBody.beats[0].type; }
  ]) { const input = reference(); change(input); assert.throws(() => parse(input)); }
});

test('ORIGINAL-REFERENCE: text bounds are inclusive and reject blank, NUL and invalid Unicode', () => {
  const value = reference(); value.original.scenes[0].title = 'T'.repeat(1000); value.savedBody.title = 'S'.repeat(1000);
  value.original.scenes[0].beats[0] = { position: 1, type: 't'.repeat(64), content: 'c'.repeat(64000) };
  assert.deepEqual(clone(parse(value)), value);
  for (const bad of ['', '  \n ', '\0', 'a\uD800b', 'a\uDC00b', 123]) {
    for (const field of ['sceneTitle', 'savedTitle', 'type', 'content']) {
      const input = reference();
      if (field === 'sceneTitle') input.original.scenes[0].title = bad;
      if (field === 'savedTitle') input.savedBody.title = bad;
      if (field === 'type') input.savedBody.beats[0].type = bad;
      if (field === 'content') input.savedBody.beats[0].content = bad;
      assert.throws(() => parse(input));
    }
  }
  for (const [field, size] of [['title', 1001], ['type', 65], ['content', 64001]]) {
    const input = reference(); (field === 'title' ? input.savedBody : input.savedBody.beats[0])[field] = 'x'.repeat(size);
    assert.throws(() => parse(input));
  }
});

test('ORIGINAL-REFERENCE: aggregate UTF8 cap rejects individually valid full text instead of sampling', () => {
  const value = reference(); value.original.scenes[0].beats = Array.from({ length: 5 }, (_, n) => beat(n + 1, 'x'.repeat(64000)));
  assert.throws(() => parse(value));
  const valid = reference(); valid.original.scenes[0].beats[0].content = '\u6F22'.repeat(64000);
  assert.equal(parse(valid).original.scenes[0].beats[0].content.length, 64000);
});

test('ORIGINAL-REFERENCE: only manual reads send exact GET, pinned identity, no-store and no auth retry in five locales', async () => {
  for (const locale of locales) {
    const view = screen(); view.set.source(locale); view.set.language(locale); view.syncContext(); view.snapshot();
    assert.equal(view.calls.length, 0); assert.equal(await view.load(), true);
    const { url, options } = view.calls[0];
    assert.equal(url, '/api/v1/me/creator-studio/stories/' + id(1) + '/body-preview/original-reference?locale=' + locale);
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error'); assert.equal(options._retried, true); assert.equal(options.headers['Cache-Control'], 'no-store');
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 }); assert.equal(options.signal.aborted, false);
    assert.deepEqual(clone(view.snapshot().data), reference(locale)); view.syncContext(); assert.equal(view.calls.length, 1);
  }
});

test('ORIGINAL-REFERENCE: invalid identity, context or visibility permits no request', async () => {
  for (const [name, value] of [['work', '../unsafe'], ['work', ''], ['work', '00000000-0000-0000-0000-000000000000'],
    ['source', 'zh'], ['owner', null], ['owner', { ownerId: 'bad', epoch: 1 }], ['owner', { ownerId: id(8), epoch: -1 }],
    ['owner', { ownerId: id(8), epoch: Number.MAX_SAFE_INTEGER + 1 }], ['authorized', false], ['shown', false]]) {
    const view = screen(); view.set[name](value); assert.equal(await view.load(), false); cleared(view); assert.equal(view.calls.length, 0);
  }
});

test('ORIGINAL-REFERENCE: bounded stream accepts 256KiB inclusive and rejects the next byte', async () => {
  const raw = JSON.stringify(reference()), size = new TextEncoder().encode(raw).byteLength;
  for (const extra of [0, 1]) {
    const reply = response(reference(), { raw: raw + ' '.repeat(256 * 1024 - size + extra) }), view = screen(() => reply);
    assert.equal(await view.load(), extra === 0); assert.equal(reply.stats.released, 1);
    assert.equal(reply.stats.cancelled, extra); assert.equal(reply.stats.textReads, 0);
    if (extra) cleared(view);
  }
});

test('ORIGINAL-REFERENCE: malformed or excessive content-length is rejected before reading', async () => {
  for (const length of ['-1', '1.2', 'bad', '262145', '9007199254740992']) {
    const reply = response(reference(), { length }), view = screen(() => reply);
    assert.equal(await view.load(), false); cleared(view); assert.equal(reply.stats.reads, 0);
    assert.equal(reply.stats.cancelled, 1); assert.equal(reply.stats.textReads, 0);
  }
  const reply = response(reference(), { length: '262144' }), view = screen(() => reply);
  assert.equal(await view.load(), true);
});

test('ORIGINAL-REFERENCE: split UTF8 is complete while malformed bytes, truncated JSON and nonbyte chunks are rejected', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(reference()));
  const split = response(reference(), { chunks: Array.from(bytes, byte => Uint8Array.of(byte)) });
  assert.equal(await screen(() => split).load(), true); assert.equal(split.stats.released, 1);
  for (const [chunks, cancelled, reads] of [
    [[Uint8Array.of(0xff)], 1, 1], [[Uint8Array.of(0xe2, 0x82)], 1, 2],
    [[new TextEncoder().encode('{"contract":')], 1, 2],
    [[new TextEncoder().encode('{}')], 0, 2], [['not bytes'], 1, 1]
  ]) {
    const reply = response(reference(), { chunks }), view = screen(() => reply);
    assert.equal(await view.load(), false); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
    assert.equal(reply.stats.reads, reads); assert.equal(reply.stats.cancelled, cancelled);
    assert.equal(reply.stats.released, 1); assert.equal(reply.stats.textReads, 0);
  }
  // Valid JSON reaches EOF and releases its lock before the separate contract parser rejects it.
  const completed = response(reference(), { raw: '{}' }), dom = mounted(() => completed);
  assert.equal(await dom.click(), false); domCleared(dom);
  assert.equal(dom.find('writerBodyOriginalReferenceState').textContent, dom.api.copy.ko.invalid);
  assert.equal(completed.stats.reads, 2); assert.equal(completed.stats.cancelled, 0);
  assert.equal(completed.stats.released, 1); assert.equal(completed.stats.textReads, 0);
});

test('ORIGINAL-REFERENCE: missing stream and invalid status never fall back to response text', async () => {
  for (const change of [r => { r.body = null; }, r => { r.body.getReader = undefined; }, r => { r.status = '200'; }, r => { r.status = 0; }, r => { r.status = 600; }]) {
    const reply = response(); change(reply); const view = screen(() => reply);
    assert.equal(await view.load(), false); cleared(view); assert.equal(reply.stats.textReads, 0);
  }
});

test('ORIGINAL-REFERENCE: safe HTTP failure codes clear data and never parse or retry private error bodies', async () => {
  for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'unavailable'], [409, 'conflict'], [500, 'server'], [503, 'server']]) {
    const reply = response(reference(), { status, raw: 'PRIVATE_ERROR' }), view = screen(() => reply);
    assert.equal(await view.load(), false); cleared(view); assert.equal(view.snapshot().messageKey, key);
    assert.equal(view.calls.length, 1); assert.equal(reply.stats.reads, 0); assert.equal(reply.stats.cancelled, 1);
  }
});

test('ORIGINAL-REFERENCE: untrusted transport and stream errors expose no raw messages or forged kinds', async () => {
  for (const handler of [
    () => { throw Object.assign(new Error('RAW_SECRET'), { kind: 'conflict' }); },
    () => response(reference(), { read: () => { throw new Error('RAW_STREAM_SECRET'); } })
  ]) {
    const view = screen(handler); assert.equal(await view.load(), false); cleared(view);
    assert.equal(view.snapshot().messageKey, 'transport'); assert.doesNotMatch(JSON.stringify(view.states), /RAW_/);
    assert.equal(view.calls.length, 1);
  }
});

test('ORIGINAL-REFERENCE: pending read blocks duplicates and failed current read allows only manual recovery', async () => {
  const wait = deferred(), view = screen(() => wait.promise), loading = view.load();
  assert.equal(view.snapshot().busy, true); assert.equal(await view.load(), false); assert.equal(view.calls.length, 1);
  wait.resolve(response(reference(), { status: 503 })); assert.equal(await loading, false);
  assert.equal(view.snapshot().canLoad, true); view.syncContext(); assert.equal(view.calls.length, 1);
  const retry = screen(({ calls }) => response(reference(), { status: calls.length === 1 ? 503 : 200 }));
  assert.equal(await retry.load(), false); assert.equal(await retry.load(), true); assert.equal(retry.calls.length, 2);
});

test('ORIGINAL-REFERENCE: late success is discarded on work, source, account, UI language or visibility changes', async () => {
  for (const [name, next] of [['work', id(2)], ['source', 'en'], ['owner', { ownerId: id(9), epoch: 2 }], ['language', 'ja'], ['shown', false], ['authorized', false]]) {
    const wait = deferred(), reply = response(), view = screen(() => wait.promise), loading = view.load();
    view.set[name](next); view.syncContext(); cleared(view); assert.equal(view.calls[0].options.signal.aborted, true);
    wait.resolve(reply); assert.equal(await loading, false); cleared(view);
    assert.equal(reply.stats.reads, 0); assert.equal(reply.stats.cancelled, 1); assert.equal(view.calls.length, 1);
  }
});

test('ORIGINAL-REFERENCE: stale failures do not overwrite the new context or reenable a newer pending read', async () => {
  const first = deferred(), second = deferred(), view = screen(({ calls }) => calls.length === 1 ? first.promise : second.promise);
  const old = view.load(); view.set.work(id(2)); view.syncContext(); const current = view.load();
  first.reject(new Error('OLD_SECRET')); assert.equal(await old, false);
  assert.equal(view.snapshot().busy, true); assert.equal(view.snapshot().messageKey, 'loading'); cleared(view);
  assert.equal(view.calls.length, 2); assert.equal(view.calls[1].options.signal.aborted, false);
  second.resolve(response(reference('ko', id(2)))); assert.equal(await current, true);
  assert.equal(view.snapshot().data.workId, id(2)); assert.equal(view.snapshot().busy, false);
});

test('ORIGINAL-REFERENCE: partial stream abort immediately cancels the reader and discards its late completion', async () => {
  const entered = deferred(), wait = deferred(), raw = new TextEncoder().encode(JSON.stringify(reference()));
  const reply = response(reference(), { read: count => {
    if (count === 1) return { done: false, value: raw.slice(0, 30) };
    entered.resolve(); return wait.promise;
  } });
  const view = screen(() => reply), loading = view.load(); await entered.promise;
  view.set.work(id(2)); view.syncContext(); assert.equal(reply.stats.cancelled, 1); cleared(view);
  wait.resolve({ done: false, value: raw.slice(30) }); assert.equal(await loading, false);
  assert.equal(reply.stats.cancelled, 1); assert.equal(reply.stats.released, 1); cleared(view);
});

test('ORIGINAL-REFERENCE: mismatched current work or locale clears both texts without a fallback', async () => {
  for (const value of [reference('en'), reference('ko', id(2)), { ...reference(), bodySourceAligned: true }]) {
    const view = screen(() => response(value)); assert.equal(await view.load(), false); cleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(view.calls.length, 1);
  }
});

test('ORIGINAL-REFERENCE: returned snapshots are clones and cannot replace saved full text', async () => {
  const input = freeze(reference()), before = JSON.stringify(input), view = screen(() => response(input));
  assert.equal(await view.load(), true);
  const copy = view.snapshot(); copy.data.original.scenes[0].beats[0].content = 'REPLACED'; copy.data.savedBody = null;
  assert.deepEqual(clone(view.snapshot().data), input); assert.equal(JSON.stringify(input), before);
});

test('ORIGINAL-REFERENCE: actual IIFE mounts once with accessible icon and no automatic request', () => {
  const view = mounted();
  assert.equal(view.host.dataset.bodyOriginalReferenceMounted, 'true');
  assert.equal(view.api.mount(view.host), null); assert.equal(view.calls.length, 0); assert.equal(view.icons.length, 1);
  assert.equal(view.button.type, 'button'); assert.equal(view.button.children[0].tagName, 'SVG');
  assert.equal(view.button.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(view.host.getAttribute('aria-labelledby'), 'writerBodyOriginalReferenceTitle');
  assert.equal(view.find('writerBodyOriginalReferenceState').getAttribute('aria-live'), 'polite'); domCleared(view);
});

test('ORIGINAL-REFERENCE: bound manual button renders five localized complete references without auth refresh', async () => {
  const expectedTitles = ['\uC6D0\uC791 \uD30C\uD2B8\uC640 \uC800\uC7A5 \uBCF8\uBB38', 'Original Part and Saved Body',
    '\u539F\u4F5C\u30D1\u30FC\u30C8\u3068\u4FDD\u5B58\u672C\u6587', '\u539F\u4F5C\u90E8\u5206\u4E0E\u5DF2\u4FDD\u5B58\u6B63\u6587', '\u539F\u4F5C\u90E8\u5206\u8207\u5DF2\u5132\u5B58\u6B63\u6587'];
  for (const [index, locale] of locales.entries()) {
    const view = mounted(undefined, locale), c = view.api.copy[locale];
    assert.equal(view.find('writerBodyOriginalReferenceTitle').textContent, expectedTitles[index]);
    assert.equal(view.find('writerBodyOriginalReferenceState').textContent, c.ready);
    const pending = view.click(); assert.equal(view.button.disabled, true);
    assert.equal(view.find('writerBodyOriginalReferenceState').textContent, c.loading);
    assert.equal(await pending, true); assert.equal(view.button.disabled, false);
    assert.equal(view.find('writerBodyOriginalReferenceState').textContent, c.reference_ready);
    assert.equal(view.find('writerBodyOriginalReferenceOriginalTitle').textContent, c.original);
    assert.equal(view.find('writerBodyOriginalReferenceSavedTitle').textContent, c.saved);
    assert.equal(view.button.title, c.load); assert.equal(view.button.getAttribute('aria-label'), c.load);
    assert.match(view.find('writerBodyOriginalReferenceContent').textContent, /TAIL/);
    assert.equal(view.host.lang, locale); assert.deepEqual(view.counts(), { fetches: 1, refreshRequests: 0 });
    assert.equal(view.calls[0].options.token, 'SYNTHETIC_TOKEN'); assert.equal(view.calls[0].options._retried, true);
    assert.equal(view.preview.textContent, 'EXISTING PREVIEW'); assert.equal(view.trial.textContent, 'EXISTING TRIAL');
    assert.equal(view.find('writerBodyOriginalReferenceState').textContent.includes('quality pass'), false);
  }
});

test('ORIGINAL-REFERENCE: DOM uses complete literal text, scroll regions and no HTML or image insertion', async () => {
  const value = reference(), literal = '<img src=x onerror=SECRET>\n' + 'middle '.repeat(8000) + 'UNTRIMMED TAIL  ';
  value.original.scenes[0].beats[0].content = literal; value.savedBody.beats[0].content = '  SAVED\n' + literal;
  const view = mounted(() => response(value)); assert.equal(await view.click(), true);
  const nodes = walk(view.content), paragraphs = nodes.filter(node => node.className === 'body-original-beat');
  assert.deepEqual(paragraphs.map(node => node.textContent), [literal, value.savedBody.beats[0].content]);
  assert.equal(nodes.some(node => ['IMG', 'A', 'IFRAME'].includes(node.tagName)), false);
  const regions = nodes.filter(node => node.className === 'body-original-prose');
  assert.equal(regions.length, 2);
  for (const region of regions) { assert.equal(region.tabIndex, 0); assert.equal(region.lang, 'ko'); assert.equal(region.getAttribute('role'), 'region'); }
});

test('ORIGINAL-REFERENCE: five-locale absent, revision-zero and safe error states never imply semantic alignment', async () => {
  for (const locale of locales) {
    const noBody = mounted(() => response(absent(locale)), locale);
    assert.equal(await noBody.click(), true); domCleared(noBody);
    assert.equal(noBody.find('writerBodyOriginalReferenceState').textContent, noBody.api.copy[locale].no_saved_body);
    const value = reference(locale); value.progressRevision = 0; value.savedBody.isGenerated = false;
    const ready = mounted(() => response(value), locale); assert.equal(await ready.click(), true);
    const meta = ready.find('writerBodyOriginalReferenceContent').parentElement.children.find(node => node.className === 'body-original-meta');
    assert.equal(meta.textContent, ready.api.copy[locale].revision + ': 0 \u00B7 ' + ready.api.copy[locale].unverified);
    assert.equal(walk(ready.content).find(node => node.className === 'body-original-kind').textContent, ready.api.copy[locale].canonical);
    for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict'], [503, 'server']]) {
      const failure = mounted(() => response(reference(locale), { status }), locale);
      assert.equal(await failure.click(), false); domCleared(failure);
      assert.equal(failure.find('writerBodyOriginalReferenceState').textContent, failure.api.copy[locale][key]);
    }
  }
  assert.equal(library().api.copy.ko.conflict, '\uD604\uC7AC \uC6D0\uBB38 \uAE30\uC900\uC744 \uD655\uC778\uD560 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.');
});

test('ORIGINAL-REFERENCE: manuscript, profile, auth and route events clear loaded texts without new GET', async () => {
  for (const event of ['storage', 'lumina:authchange', 'lumina:auth-expired', 'pagehide', 'popstate', 'hashchange',
    'creator:manuscript-accepted', 'creator:generation-profile-changed', 'lumina:author-body-trial-progress-changed']) {
    const view = mounted(); assert.equal(await view.click(), true); view.window.fire(event);
    domCleared(view); assert.equal(view.calls.length, 1); assert.equal(view.preview.textContent, 'EXISTING PREVIEW');
  }
});

test('ORIGINAL-REFERENCE: pending profile invalidation aborts and suppresses the late DOM response', async () => {
  const wait = deferred(), reply = response(), view = mounted(() => wait.promise), pending = view.click();
  assert.equal(view.calls.length, 1); view.window.fire('creator:generation-profile-changed');
  assert.equal(view.calls[0].options.signal.aborted, true); domCleared(view);
  wait.resolve(reply); assert.equal(await pending, false); domCleared(view);
  assert.equal(reply.stats.cancelled, 1); assert.equal(reply.stats.reads, 0); assert.equal(view.calls.length, 1);
});

test('ORIGINAL-REFERENCE: work and source changes clear both columns and manual read targets only the new selection', async () => {
  const view = mounted(); assert.equal(await view.click(), true);
  view.work.value = id(2); view.work.fire('change'); domCleared(view); assert.equal(view.calls.length, 1);
  view.locale.value = 'ja'; view.locale.fire('input'); domCleared(view); assert.equal(view.calls.length, 1);
  assert.equal(await view.click(), true);
  assert.equal(view.calls[1].url, '/api/v1/me/creator-studio/stories/' + id(2) + '/body-preview/original-reference?locale=ja');
  assert.equal(walk(view.content).find(node => node.className === 'body-original-prose').lang, 'ja');
});

test('ORIGINAL-REFERENCE: UI language changes relabel idle and loaded state only after clearing old text', async () => {
  const view = mounted(); assert.equal(await view.click(), true);
  for (const locale of locales) {
    view.html.lang = locale; view.window.fire('lumina:localechange');
    if (locale !== 'ko') domCleared(view);
    assert.equal(view.find('writerBodyOriginalReferenceTitle').textContent, view.api.copy[locale].title);
  }
  assert.equal(view.calls.length, 1);
  assert.equal(await view.click(), true); assert.equal(view.calls[1].url.endsWith('?locale=ko'), true);
});

test('ORIGINAL-REFERENCE: hidden tab, document visibility and auth transitions remove private text', async () => {
  for (const mode of ['tab', 'hidden', 'visibility', 'auth', 'localeMutation', 'workMutation']) {
    const view = mounted(); assert.equal(await view.click(), true);
    if (mode === 'tab') {
      const tab = new Element('button'); tab.setAttribute('data-section', 'artist-studio');
      view.document.fire('click', { target: tab });
    }
    if (mode === 'hidden') { view.shell.hidden = true; view.observe(view.shell); }
    if (mode === 'visibility') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
    if (mode === 'auth') { view.auth(null); view.window.fire('lumina:authchange'); }
    if (mode === 'localeMutation') { view.html.lang = 'en'; view.observe(view.html); }
    if (mode === 'workMutation') { view.work.value = id(2); view.observe(view.work); }
    domCleared(view); assert.equal(view.calls.length, 1); assert.equal(view.trial.textContent, 'EXISTING TRIAL');
    if (['hidden', 'visibility', 'auth'].includes(mode)) { assert.equal(view.button.disabled, true); assert.equal(await view.click(), false); }
  }
});

test('ORIGINAL-REFERENCE: reentrant current selection and absent auth token prevent stale dispatch', async () => {
  for (const mode of ['token', 'work', 'owner']) {
    const view = mounted();
    if (mode === 'token') view.token(null);
    if (mode === 'work') view.authHook(() => { view.work.value = id(2); });
    if (mode === 'owner') view.authHook(() => { view.auth({ ownerId: id(9), epoch: 2 }); });
    assert.equal(await view.click(), false); domCleared(view); assert.equal(view.calls.length, 0);
    assert.deepEqual(view.counts(), { fetches: 0, refreshRequests: 0 });
  }
});

test('ORIGINAL-REFERENCE: unavailable endpoint discards existing text and leaves manual-only recovery', async () => {
  const view = mounted(({ calls }) => response(reference(), { status: calls.length === 1 ? 200 : 404 }));
  assert.equal(await view.click(), true); assert.equal(await view.click(), false); domCleared(view);
  assert.equal(view.button.disabled, false); assert.equal(view.find('writerBodyOriginalReferenceState').textContent, view.api.copy.ko.unavailable);
  view.window.fire('focus'); assert.equal(view.calls.length, 2);
});

test('ORIGINAL-REFERENCE: scoped CSS stacks mobile full-text panes with focusable scrolling and no clipping', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /overflow:\s*auto/); assert.match(css, /white-space:\s*pre-wrap/);
  assert.match(css, /:focus-visible/); assert.match(css, /width:\s*44px/); assert.match(css, /height:\s*44px/);
  assert.match(css, /@media\s+print/);
  assert.doesNotMatch(css, /line-clamp|text-overflow|overflow:\s*hidden/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|\.innerHTML\s*=|method:\s*["']POST["']/);
});

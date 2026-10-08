import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-body-preview.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const body = (workId = id(1), locale = 'ko') => ({
  contract: 'story-author-body-preview-v1', workId, locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 1, status: 'active', storyVersion: 1,
    scene: { id: id(3), isGenerated: false, title: 'Saved scene', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'Private text.\r\n  Exact spacing. \uD55C\uAE00 \uD83C\uDFAC' }] },
    choices: [{ id: id(5), label: 'Keep reading', routeKind: 'writer_original' },
      { id: id(6), label: 'Take another route', routeKind: 'generation_required' }] }
});
const response = (data = body(), status = 200, extra = {}) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(data), ...extra });
function library(extra = {}) {
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, AbortController, ...extra });
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyPreview, vm };
}
function screen(handler = ({ target }) => response(body(target.workId, target.locale))) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko', shown = true, authorized = true;
  const calls = [], states = [];
  const { api } = library();
  const controller = api.createController({
    fetch: async (url, options) => {
      const target = { workId, locale: sourceLocale };
      calls.push({ url, options });
      return handler({ target, calls });
    },
    identity: () => owner,
    isCurrent: value => authorized && owner && owner.ownerId === value?.ownerId && owner.epoch === value?.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => states.push(clone(state))
  });
  return { ...controller, calls, states, api, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; }
  } };
}
const assertCleared = view => {
  assert.equal(view.snapshot().data, null);
  assert.equal(JSON.stringify(view.snapshot()).includes('Private text'), false);
};

test('entry adds one unframed mount and loads it after the shared API and auth accessor', () => {
  assert.match(entry, /href="\/pages\/creator-body-preview\.css\?v=body-preview-20261002"/);
  assert.match(entry, /<section id="writerBodyPreview" aria-labelledby="writerBodyPreviewTitle"><\/section>/);
  assert.equal((entry.match(/id="writerBodyPreview"/g) || []).length, 1);
  const start = entry.indexOf('id="writer-manuscript"'), end = entry.indexOf('id="story-intake"');
  assert.ok(start < entry.indexOf('id="writerBodyPreview"') && entry.indexOf('id="writerBodyPreview"') < end);
  assert.ok(entry.indexOf('src="/pages/creator-studio.js') < entry.indexOf('src="/pages/creator-body-preview.js'));
  assert.ok(entry.indexOf('src="/app.js') < entry.indexOf('src="/pages/creator-body-preview.js'));
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|setInterval|setTimeout|\.json\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /\/generate|\/images|\/approve|\/payments|\/choices\/|\/progress\//);
});

test('explicit load uses only the exact owner GET and never images or mutations', async () => {
  const view = screen();
  view.syncContext(); view.snapshot();
  assert.equal(view.calls.length, 0);
  assert.equal(await view.load(), true);
  assert.deepEqual(clone(view.snapshot().data), body());
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0].url, `/api/v1/me/creator-studio/stories/${id(1)}/body-preview?locale=ko`);
  const options = view.calls[0].options;
  assert.equal(options.method, 'GET'); assert.equal(options._retried, true); assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['Cache-Control'], 'no-store');
  assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  assert.equal(options.body, undefined); assert.ok(options.signal);
  assert.equal(view.calls.filter(call => /image|generate|approve|payment/.test(call.url)).length, 0);
  assert.equal(view.calls.filter(call => call.options.method !== 'GET').length, 0);
  for (let i = 0; i < 5; i++) { view.syncContext(); view.snapshot(); }
  assert.equal(view.calls.length, 1);
});

test('response normalization drops all uncontracted private or image fields', async () => {
  const view = screen(() => response({ ...body(), secret: 'do not retain', imageUrl: 'https://invalid.example/image',
    progress: { ...body().progress, image: 'do not retain' } }));
  await view.load();
  assert.deepEqual(clone(view.snapshot().data), body());
});

test('uppercase UUID selection accepts canonical lowercase response IDs without changing the route', async () => {
  const workId = 'a0000001-abcd-4abc-8abc-abcdef000001';
  const view = screen(({ target }) => {
    const value = body(target.workId.toLowerCase(), target.locale);
    value.progress.progressId = 'A0000002-ABCD-4ABC-8ABC-ABCDEF000002';
    value.progress.scene.id = 'A0000003-ABCD-4ABC-8ABC-ABCDEF000003';
    value.progress.scene.beats[0].id = 'A0000004-ABCD-4ABC-8ABC-ABCDEF000004';
    value.progress.choices[0].id = 'A0000005-ABCD-4ABC-8ABC-ABCDEF000005';
    return response(value);
  });
  view.set.work(workId.toUpperCase()); await view.load();
  assert.equal(view.snapshot().data.workId, workId);
  assert.ok(view.calls[0].url.includes(workId.toUpperCase()));
  assert.match(view.snapshot().data.progress.scene.beats[0].id, /^a/);
});

for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'notFound'], [409, 'conflict'], [500, 'server'], [503, 'server'], [422, 'unavailable']]) {
  test(`HTTP ${status} has a distinct default state, clears old text and never reads diagnostics or retries`, async () => {
    let failing = false, read = 0;
    const view = screen(() => failing ? response(null, status, { text: () => { read++; throw new Error('Server private diagnostics'); } }) : response());
    await view.load(); failing = true;
    const pending = view.load(); assertCleared(view);
    await pending;
    assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, key);
    assert.equal(view.calls.length, 2); assert.equal(read, 0);
    assert.doesNotMatch(JSON.stringify(view.snapshot()), /diagnostics/);
    view.syncContext(); assert.equal(view.calls.length, 2);
  });
}

test('transport and body-stream transport errors are not success, empty, or server errors', async () => {
  for (const handler of [() => { throw new Error('Private network detail'); }, () => response(null, 200, { text: () => { throw new TypeError('Connection reset'); } })]) {
    const view = screen(handler); await view.load();
    assertCleared(view); assert.equal(view.snapshot().messageKey, 'transport'); assert.equal(view.calls.length, 1);
  }
});

const malformed = {
  contract: value => { value.contract = 'other'; }, work: value => { value.workId = id(99); },
  'work-id': value => { value.workId = '../injection'; }, locale: value => { value.locale = 'en'; },
  'unsupported-locale': value => { value.locale = 'zh'; }, readonly: value => { value.readOnly = false; },
  'readonly-type': value => { value.readOnly = 'true'; }, 'image-started': value => { value.imageGenerationStarted = true; },
  'image-flag-missing': value => { delete value.imageGenerationStarted; }, 'progress-missing': value => { delete value.progress; },
  'progress-array': value => { value.progress = []; }, 'progress-id': value => { value.progress.progressId = 'bad'; },
  revision: value => { value.progress.revision = 0; }, 'revision-string': value => { value.progress.revision = '1'; },
  'revision-fraction': value => { value.progress.revision = 1.5; }, 'revision-unsafe': value => { value.progress.revision = Number.MAX_SAFE_INTEGER + 1; },
  version: value => { value.progress.storyVersion = -1; }, status: value => { value.progress.status = ''; },
  'status-markup': value => { value.progress.status = '<script>'; }, 'status-long': value => { value.progress.status = 'x'.repeat(65); },
  'scene-missing': value => { delete value.progress.scene; }, 'scene-array': value => { value.progress.scene = []; },
  'scene-id': value => { value.progress.scene.id = 'bad'; }, 'scene-generated-type': value => { value.progress.scene.isGenerated = 'false'; },
  'title-object': value => { value.progress.scene.title = { ko: 'not a string' }; }, 'title-long': value => { value.progress.scene.title = 'x'.repeat(1001); },
  'title-blank': value => { value.progress.scene.title = ' \n '; }, 'title-empty': value => { value.progress.scene.title = ''; },
  'title-surrogate': value => { value.progress.scene.title = '\uD800'; }, 'ending-missing': value => { delete value.progress.scene.endingType; },
  ending: value => { value.progress.scene.endingType = {}; }, beats: value => { value.progress.scene.beats = {}; },
  'beats-empty': value => { value.progress.scene.beats = []; },
  'beat-overflow': value => { value.progress.scene.beats = Array.from({ length: 41 }, (_, index) => ({ ...value.progress.scene.beats[0], id: id(100 + index), position: index + 1 })); },
  'beat-id': value => { value.progress.scene.beats[0].id = 'bad'; }, 'beat-duplicate': value => { value.progress.scene.beats.push({ ...value.progress.scene.beats[0], position: 2 }); },
  'beat-position': value => { value.progress.scene.beats[0].position = 0; }, 'beat-position-string': value => { value.progress.scene.beats[0].position = '1'; },
  'beat-position-duplicate': value => { value.progress.scene.beats.push({ ...value.progress.scene.beats[0], id: id(7) }); },
  'beat-order': value => { value.progress.scene.beats[0].position = 2; value.progress.scene.beats.push({ ...value.progress.scene.beats[0], id: id(7), position: 1 }); },
  'beat-type': value => { value.progress.scene.beats[0].type = []; }, 'beat-content': value => { value.progress.scene.beats[0].content = { value: 'text' }; },
  'beat-blank': value => { value.progress.scene.beats[0].content = ' \n '; }, 'beat-empty': value => { value.progress.scene.beats[0].content = ''; },
  'beat-long': value => { value.progress.scene.beats[0].content = 'x'.repeat(64001); }, 'beat-control': value => { value.progress.scene.beats[0].content = 'bad\0text'; },
  'beat-surrogate': value => { value.progress.scene.beats[0].content = '\uDC00'; }, 'choices-missing': value => { delete value.progress.choices; },
  choices: value => { value.progress.choices = {}; }, 'choice-overflow': value => { value.progress.choices = [1, 2, 3, 4].map(n => ({ ...value.progress.choices[0], id: id(50 + n) })); },
  'choice-id': value => { value.progress.choices[0].id = 'bad'; }, 'choice-duplicate': value => { value.progress.choices[1].id = value.progress.choices[0].id; },
  'choice-label': value => { value.progress.choices[0].label = { ko: 'not a string' }; }, 'choice-blank': value => { value.progress.choices[0].label = ' \n '; },
  'choice-long': value => { value.progress.choices[0].label = 'x'.repeat(1001); }, 'choice-surrogate': value => { value.progress.choices[0].label = '\uD800'; },
  'choice-route': value => { value.progress.choices[0].routeKind = null; },
  'scene-null-with-choices': value => { value.progress.scene = null; },
  'completed-with-choices': value => { value.progress.status = 'completed'; }
};
for (const [name, corrupt] of Object.entries(malformed)) test(`malformed payload fails closed: ${name}`, async () => {
  const view = screen(() => { const value = body(); corrupt(value); return response(value); });
  await view.load(); assertCleared(view); assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'invalid');
  assert.equal(view.calls.length, 1);
});

test('null, arrays, broken JSON, and non-text responses fail closed', async () => {
  for (const result of [response(null), response([]), response(null, 200, { text: async () => '{broken' }), { status: 200 }, { status: '200' }]) {
    const view = screen(() => result); await view.load(); assertCleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  }
});

test('payload bounds permit forty beats and three choices and preserve exact text', async () => {
  const value = body();
  value.progress.scene.beats = Array.from({ length: 40 }, (_, index) => ({ id: id(100 + index), position: index + 1,
    type: 'paragraph', content: index ? 'x' : value.progress.scene.beats[0].content }));
  value.progress.choices.push({ id: id(10), label: 'Third', routeKind: 'branch' });
  const view = screen(() => response(value)); await view.load();
  assert.deepEqual(clone(view.snapshot().data), value);
});

test('UTF-8 byte limit includes multibyte content, not just JavaScript string length', async () => {
  const value = body();
  value.progress.scene.beats = [1, 2].map(n => ({ id: id(n + 100), position: n, type: 'paragraph', content: '\uD55C'.repeat(45000) }));
  const raw = JSON.stringify(value); assert.ok(raw.length < 256 * 1024); assert.ok(Buffer.byteLength(raw) > 256 * 1024);
  const view = screen(() => response(value)); await view.load(); assertCleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
});

test('exactly 256 KiB is accepted; the next byte is rejected even as JSON whitespace', async () => {
  const raw = JSON.stringify(body()), target = 256 * 1024;
  for (const extra of [0, 1]) {
    const view = screen(() => response(null, 200, { text: async () => raw + ' '.repeat(target - Buffer.byteLength(raw) + extra) }));
    await view.load(); assert.equal(view.snapshot().messageKey, extra ? 'invalid' : 'body');
  }
});

test('oversize Content-Length is rejected before reading and missing length is still bounded', async () => {
  let read = 0, cancelled = 0;
  const view = screen(() => response(null, 200, { headers: { get: () => '262145' }, body: { cancel: async () => { cancelled++; } }, text: async () => { read++; return '{}'; } }));
  await view.load(); assert.equal(read, 0); assert.equal(cancelled, 1); assert.equal(view.snapshot().messageKey, 'invalid');
});

test('streaming limit cancels and releases immediately at the first overflowing chunk', async () => {
  let reads = 0, cancelled = 0, released = 0;
  const reader = { read: async () => { reads++; return { done: false, value: new Uint8Array(131073) }; },
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; } };
  const view = screen(() => response(null, 200, { body: { getReader: () => reader } })); await view.load();
  assert.equal(reads, 2); assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(view.snapshot().messageKey, 'invalid');
});

test('stream decoding preserves split multibyte characters and rejects invalid UTF-8', async () => {
  for (const valid of [true, false]) {
    const bytes = new TextEncoder().encode(JSON.stringify(body())); let index = 0, cancelled = 0;
    const chunks = valid ? Array.from(bytes, value => new Uint8Array([value])) : [new Uint8Array([0xff])];
    const reader = { read: async () => index < chunks.length ? { done: false, value: chunks[index++] } : { done: true },
      cancel: async () => { cancelled++; }, releaseLock() {} };
    const view = screen(() => response(null, 200, { body: { getReader: () => reader } })); await view.load();
    assert.equal(view.snapshot().messageKey, valid ? 'body' : 'invalid'); assert.equal(cancelled, valid ? 0 : 1);
    if (valid) assert.deepEqual(clone(view.snapshot().data), body());
  }
});

for (const [status, scene, key] of [['active', true, 'body'], ['active', false, 'noScene'], ['pending', true, 'generating'],
  ['pending_generation', false, 'generating'], ['ai_pending', true, 'generating'], ['ai_pending', false, 'generating'],
  ['generating', false, 'generating'], ['completed', true, 'ending']]) {
  test(`saved progress ${status} / scene ${scene} is reported without advancing`, async () => {
    const value = body(); value.progress.status = status;
    if (!scene) value.progress.scene = null;
    if (!scene || status === 'completed') value.progress.choices = [];
    const view = screen(() => response(value)); await view.load();
    assert.equal(view.snapshot().messageKey, key); assert.equal(view.snapshot().data.progress.status, status);
    assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.method, 'GET');
  });
}

test('no progress, no scene, and authored or generated endings are distinct', async () => {
  for (const kind of ['none', 'noScene', 'authored', 'generated']) {
    const value = body();
    if (kind === 'none') value.progress = null;
    if (kind === 'noScene') { value.progress.scene = null; value.progress.choices = []; }
    if (['authored', 'generated'].includes(kind)) { value.progress.scene.endingType = kind === 'authored' ? 'original' : 'ai_generated'; value.progress.scene.isGenerated = kind === 'generated'; }
    const view = screen(() => response(value)); await view.load();
    assert.equal(view.snapshot().messageKey, kind === 'none' ? 'noProgress' : kind === 'noScene' ? 'noScene' : 'ending');
  }
});

test('absent work, invalid work/source language, hidden section and missing authentication never fetch', async () => {
  for (const [change, value, key] of [['work', '', 'noWork'], ['work', '../unsafe', 'invalid'], ['source', 'zh', 'invalid'],
    ['owner', null, 'unauthenticated'], ['owner', { ownerId: id(8), epoch: '1' }, 'unauthenticated'],
    ['authorized', false, 'unauthenticated'], ['shown', false, 'hidden']]) {
    const view = screen(); view.set[change](value); await view.load();
    assertCleared(view); assert.equal(view.snapshot().messageKey, key); assert.equal(view.calls.length, 0);
  }
});

const contextChanges = {
  work: view => view.set.work(id(9)), source: view => view.set.source('en'), language: view => view.set.language('ja'),
  account: view => view.set.owner({ ownerId: id(9), epoch: 1 }), epoch: view => view.set.owner({ ownerId: id(8), epoch: 2 }),
  logout: view => view.set.owner(null), permission: view => view.set.authorized(false), tab: view => view.set.shown(false)
};
for (const [name, change] of Object.entries(contextChanges)) {
  test(`stored body is erased synchronously on ${name}, with no automatic request`, async () => {
    const view = screen(); await view.load(); change(view); view.syncContext();
    assertCleared(view); assert.equal(view.calls.length, 1); assert.equal(view.states.at(-1).data, null);
  });
  test(`late response is ignored after ${name}, even without an event`, async () => {
    const pending = deferred(), view = screen(() => pending.promise);
    const task = view.load(); change(view); pending.resolve(response()); await task;
    assertCleared(view); assert.equal(view.calls.length, 1); assert.notEqual(view.snapshot().phase, 'ready');
  });
}

test('duplicate requests are blocked and invalidation aborts the original signal', async () => {
  const pending = deferred(), view = screen(() => pending.promise);
  const old = view.snapshot().ticket, task = view.load(old);
  assert.equal(await view.load(), false); assert.equal(await view.load(old), false); assert.equal(view.calls.length, 1);
  view.invalidate(); assert.equal(view.calls[0].options.signal.aborted, true);
  pending.resolve(response()); await task; assertCleared(view);
});

test('switch away and back cannot resurrect text; a newer explicit GET wins', async () => {
  const old = deferred(); let number = 0;
  const view = screen(({ target }) => ++number === 1 ? old.promise : response(body(target.workId, target.locale)));
  const task = view.load(); view.set.work(id(9)); view.syncContext(); view.set.work(id(1)); view.syncContext();
  await view.load(); const current = clone(view.snapshot());
  old.resolve(response(body(id(9)))); await task;
  assert.deepEqual(clone(view.snapshot()), current); assert.equal(view.calls.length, 2);
});

test('source changes while decoding erase text and cancel the pending stream', async () => {
  const pending = deferred(), started = deferred(); let cancelled = 0;
  const view = screen(() => response(null, 200, { body: { getReader: () => ({ read: () => { started.resolve(); return pending.promise; },
    cancel: async () => { cancelled++; }, releaseLock() {} }) } }));
  const task = view.load(); await started.promise; view.set.source('en'); view.syncContext();
  pending.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(body())) }); await task;
  assertCleared(view); assert.equal(cancelled, 1);
});

test('identity provider failures fail closed instead of retaining a private snapshot', async () => {
  const { api } = library(); let broken = false;
  const view = api.createController({ fetch: async () => response(), identity: () => { if (broken) throw new Error('expired'); return { ownerId: id(8), epoch: 1 }; },
    isCurrent: () => true, context: () => ({ workId: id(1), locale: 'ko' }) });
  await view.load(); broken = true; assertCleared(view); assert.equal(view.snapshot().canLoad, false);
});

for (const uiLocale of locales) for (const sourceLocale of locales) test(`UI ${uiLocale} and original ${sourceLocale} stay independent`, async () => {
  const view = screen(); view.set.language(uiLocale); view.set.source(sourceLocale); await view.load();
  assert.equal(view.snapshot().locale, uiLocale); assert.equal(view.snapshot().data.locale, sourceLocale);
  assert.ok(view.calls[0].url.endsWith(`?locale=${sourceLocale}`));
  const dictionary = view.api.copy[uiLocale]; assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(view.api.copy.ko).sort());
  for (const [key, value] of Object.entries(dictionary)) assert.ok(typeof value === 'string' && (key === 'hidden' || value.length > 0));
});

// A minimal DOM keeps these tests independent of a browser, server, or DOM package.
const walk = node => [node, ...node.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, event = {}) { let result; for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler = () => response()) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const host = new Element('section', 'writerBodyPreview'), work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, host, work, sourceLocale].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', accessToken = 'existing-access-token', refreshPosts = 0;
  const calls = [], observers = [];
  window.getAuth = () => ({ accessToken, refreshToken: 'must-not-use' });
  window.luminaI18n = { getLocale: () => language };
  window.LuminaCreatorStudioApi = {
    identity: () => owner,
    isCurrent: value => owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: async (url, options) => {
      if (!options.token || !options._retried) refreshPosts++;
      calls.push({ url, options }); return handler();
    }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ target, options, callback: this.callback }); }
  }
  const { api } = library({ window, document, MutationObserver, fetch: () => { throw new Error('Global fetch is forbidden'); } });
  const button = () => walk(host).find(node => node.tagName === 'BUTTON');
  const controller = api.mount(host);
  assert.equal(controller, null, 'automatic mount is idempotent');
  return { window, document, shell, section, host, work, sourceLocale, api, calls, observers, button,
    click: () => button().fire('click'), setOwner: value => { owner = value; }, setToken: value => { accessToken = value; },
    locale: value => { language = value; }, refreshPosts: () => refreshPosts,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); }
  };
}

test('mount is idle; only the icon button loads; GET bypasses preflight refresh and unauthorized retry', async () => {
  const view = mounted(); assert.equal(view.calls.length, 0);
  assert.equal(view.button().type, 'button'); assert.ok(view.button().getAttribute('aria-label')); assert.ok(view.button().title);
  await view.click(); assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.token, 'existing-access-token');
  assert.equal(view.refreshPosts(), 0); assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 1);
  for (const type of ['focus', 'pageshow', 'lumina:localechange']) view.window.fire(type);
  assert.equal(view.calls.length, 1);
  view.setToken(null); await view.click(); assert.equal(view.calls.length, 1); assert.equal(view.refreshPosts(), 0);
  assert.doesNotMatch(view.host.textContent, /Private text/);
});

test('XSS stays literal in title, prose, and choices; choices contain no executable controls', async () => {
  const attack = '<img src=x onerror=attack()><script>steal()</script><a href="javascript:steal()">open</a>';
  const value = body(); value.progress.scene.title = attack; value.progress.scene.beats[0].content = attack;
  value.progress.choices[0].label = attack;
  const view = mounted(() => response(value)); await view.click();
  assert.ok(view.host.textContent.includes(attack));
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'A', 'IFRAME', 'INPUT', 'TEXTAREA'].includes(node.tagName)).length, 0);
  const list = walk(view.host).find(node => node.tagName === 'OL');
  assert.ok(list); assert.equal(walk(list).filter(node => node.tagName === 'BUTTON').length, 0);
  assert.equal(list.lang, 'ko'); assert.equal(walk(view.host).find(node => node.className === 'body-preview-source').lang, 'ko');
});

for (const name of ['work', 'source', 'authchange', 'expired-window', 'expired-document', 'storage', 'pagehide', 'tab-click', 'hidden-shell', 'hidden-section', 'visibility', 'language']) {
  test(`mounted private DOM clears on ${name} and never automatically reloads`, async () => {
    const view = mounted(); await view.click(); assert.match(view.host.textContent, /Private text/);
    if (name === 'work') { view.work.value = id(9); view.work.fire('change'); }
    if (name === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('input'); }
    if (name === 'authchange') view.window.fire('lumina:authchange');
    if (name === 'expired-window') view.window.fire('lumina:auth-expired');
    if (name === 'expired-document') view.document.fire('lumina:auth-expired');
    if (name === 'storage') view.window.fire('storage');
    if (name === 'pagehide') view.window.fire('pagehide');
    if (name === 'tab-click') { const tab = new Element('button'); tab.setAttribute('data-section', 'artist-list'); view.document.fire('click', { target: tab }); }
    if (name === 'hidden-shell') { view.shell.hidden = true; view.mutate(view.shell); }
    if (name === 'hidden-section') { view.section.classList.remove('is-active'); view.mutate(view.section); }
    if (name === 'visibility') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
    if (name === 'language') { view.locale('en'); view.window.fire('lumina:localechange'); }
    assert.doesNotMatch(view.host.textContent, /Private text|Saved scene|Keep reading/); assert.equal(view.calls.length, 1);
  });
}

test('a hide/show mutation in one task still erases the body and late ticket', async () => {
  const pending = deferred(), view = mounted(() => pending.promise), task = view.click();
  view.section.classList.remove('is-active'); view.section.classList.add('is-active'); view.mutate(view.section);
  pending.resolve(response()); await task; assert.doesNotMatch(view.host.textContent, /Private text/); assert.equal(view.calls.length, 1);
});

test('late responses and duplicate clicks cannot populate a hidden private DOM', async () => {
  const pending = deferred(), view = mounted(() => pending.promise), task = view.click();
  await view.click(); assert.equal(view.calls.length, 1); assert.equal(view.button().disabled, true);
  view.window.fire('lumina:authchange'); pending.resolve(response()); await task;
  assert.doesNotMatch(view.host.textContent, /Private text/); assert.equal(view.calls[0].options.signal.aborted, true);
});

for (const locale of locales) test(`mounted ${locale} labels and pending status preserve the original text language`, async () => {
  const value = body(id(1), 'ja'); value.progress.status = 'ai_pending';
  const view = mounted(() => response(value)); view.locale(locale); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
  await view.click();
  assert.equal(view.host.lang, locale); assert.equal(view.button().title, view.api.copy[locale].refresh);
  assert.equal(view.button().getAttribute('aria-label'), view.api.copy[locale].refresh);
  assert.ok(view.host.textContent.includes(view.api.copy[locale].statusPending));
  assert.doesNotMatch(view.host.textContent, /ai_pending|writer_original|generation_required/);
  assert.equal(walk(view.host).find(node => node.className === 'body-preview-source').lang, 'ja');
});

for (const locale of locales) {
  for (const [status, key] of [['active', 'statusActive'], ['ai_pending', 'statusPending'], ['completed', 'statusCompleted'], ['future_status', 'statusOther']]) {
    test(`${locale} progress labels are user readable: ${status}`, async () => {
      const value = body(); value.progress.status = status; if (status === 'completed') value.progress.choices = [];
      const view = mounted(() => response(value)); view.locale(locale); view.window.fire('lumina:localechange'); await view.click();
      const metadata = walk(view.host).find(node => node.className === 'body-preview-metadata');
      assert.ok(metadata.textContent.includes(view.api.copy[locale][key])); assert.ok(metadata.textContent.includes(view.api.copy[locale].revision));
      assert.ok(!metadata.textContent.includes(status));
    });
  }
  for (const [ending, key] of [['author_main', 'endingOriginal'], ['author_sub', 'endingAlternate'], ['ai_generated', 'endingGenerated'], ['future_ending', 'endingOther']]) {
    test(`${locale} ending labels never expose codes: ${ending}`, async () => {
      const value = body(); value.progress.scene.endingType = ending; value.progress.status = 'completed'; value.progress.choices = [];
      const view = mounted(() => response(value)); view.locale(locale); view.window.fire('lumina:localechange'); await view.click();
      assert.equal(walk(view.host).find(node => node.className === 'body-preview-ending').textContent, view.api.copy[locale][key]);
      assert.ok(!view.host.textContent.includes(ending));
    });
  }
  test(`${locale} all choice-route labels are translated, including unknown codes`, async () => {
    for (const [route, key] of [['writer_original', 'routeOriginal'], ['generation_required', 'routeGeneration'], ['branch', 'routeBranch'],
      ['rejoin', 'routeRejoin'], ['ending', 'routeEnding'], ['future_route', 'routeOther']]) {
      const value = body(); value.progress.choices = [{ id: id(5), label: 'Saved choice', routeKind: route }];
      const view = mounted(() => response(value)); view.locale(locale); view.window.fire('lumina:localechange'); await view.click();
      assert.equal(walk(view.host).find(node => node.className === 'body-preview-route').textContent, view.api.copy[locale][key]);
      assert.ok(!view.host.textContent.includes(route));
    }
  });
}

test('ai_pending remains pending even when the previous saved scene has an ending marker', async () => {
  const value = body(); value.progress.status = 'ai_pending'; value.progress.scene.endingType = 'author_main';
  const view = screen(() => response(value)); await view.load();
  assert.equal(view.snapshot().messageKey, 'generating'); assert.equal(view.snapshot().data.progress.status, 'ai_pending');
});

test('untrusted transport error kinds cannot turn an error into an apparent preview', async () => {
  const view = screen(() => { throw Object.assign(new Error('Private diagnostics'), { kind: 'body' }); }); await view.load();
  assertCleared(view); assert.equal(view.snapshot().messageKey, 'transport');
});

test('responsive type and layout use unframed, wrapping content and a fixed 44px icon at 320px', () => {
  assert.match(css, /font-family: Pretendard/); assert.match(css, /font-size: 18px;\s*line-height: 1\.78/);
  assert.match(css, /#writerBodyPreview \{ font-size: 17px;/); assert.match(css, /font-size: 17px; line-height: 1\.78/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 44px/);
  assert.match(css, /width: 44px;\s*height: 44px/); assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /min-width: 0/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /letter-spacing: 0/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /^\s*(?:min-)?width:\s*(?:3[3-9]\d|[4-9]\d\d)px|\d(?:vw|cqw)|linear-gradient|box-shadow|overflow-y|position:\s*(fixed|absolute)/m);
  assert.doesNotMatch(source, /element\(["'](?:article|dialog)["']|className\s*=\s*["'][^"']*card/);
});



const selectedContextLabels = {
  ko: { work: '\uc6d0\uace0 \uc900\ube44 \uc791\ud488', empty: '\ubbf8\uc120\ud0dd', source: '\uc6d0\ubb38 \uc5b8\uc5b4' },
  en: { work: 'Manuscript story', empty: 'Not selected', source: 'Original language' },
  ja: { work: '\u539f\u7a3f\u306e\u4f5c\u54c1', empty: '\u672a\u9078\u629e', source: '\u539f\u6587\u306e\u8a00\u8a9e' },
  'zh-Hans': { work: '\u7a3f\u4ef6\u4f5c\u54c1', empty: '\u672a\u9009\u62e9', source: '\u539f\u6587\u8bed\u8a00' },
  'zh-Hant': { work: '\u7a3f\u4ef6\u4f5c\u54c1', empty: '\u672a\u9078\u64c7', source: '\u539f\u6587\u8a9e\u8a00' },
};
const selectedContextLanguages = ['\ud55c\uad6d\uc5b4', 'English', '\u65e5\u672c\u8a9e', '\u7b80\u4f53\u4e2d\u6587', '\u7e41\u9ad4\u4e2d\u6587'];
const selectedContextNode = view => walk(view.host).find(node => node.id === 'writerBodyPreviewSelection');
function selectSourceLocale(view, locale = 'ko', label = selectedContextLanguages[locales.indexOf(locale)] || 'Unsupported language') {
  const option = new Element('option'); option.value = locale; option.textContent = label;
  view.sourceLocale.value = locale; view.sourceLocale.replaceChildren(option); view.sourceLocale.options = [option]; view.sourceLocale.selectedOptions = [option];
  view.sourceLocale.fire('change');
}
function selectManuscript(view, title = 'Synthetic manuscript A', workId = id(1)) {
  if (!view.sourceLocale.selectedOptions) selectSourceLocale(view, view.sourceLocale.value);
  const option = new Element('option'); option.value = workId; option.textContent = title;
  view.work.value = workId; view.work.replaceChildren(option); view.work.options = [option]; view.work.selectedOptions = [option];
  view.work.fire('change');
  return option;
}

test('selected context: five languages show only the manuscript selection without requests', () => {
  const controller = screen();
  assert.deepEqual(Object.keys(controller.snapshot()).sort(), ['busy', 'canLoad', 'data', 'locale', 'messageKey', 'phase', 'ticket']);
  for (const [index, locale] of locales.entries()) {
    const view = mounted(), words = selectedContextLabels[locale];
    view.locale(locale); view.window.fire('lumina:localechange');
    view.work.value = ''; view.work.fire('change');
    assert.equal(selectedContextNode(view).textContent, `${words.work}: ${words.empty}`);
    assert.equal(view.button().disabled, true);
    view.sourceLocale.value = locale; selectManuscript(view);
    assert.equal(selectedContextNode(view).textContent, `${words.work}: Synthetic manuscript A \u00b7 ${words.source}: ${selectedContextLanguages[index]}`);
    const publicWork = new Element('select'); publicWork.setAttribute('data-interaction-work', '');
    publicWork.value = id(9); view.document.append(publicWork); publicWork.fire('change');
    assert.equal(selectedContextNode(view).textContent.includes('Synthetic manuscript A'), true);
    assert.equal(view.work.value, id(1)); assert.equal(view.host.lang, locale);
    assert.equal(view.button().disabled, false); assert.equal(view.calls.length, 0); assert.equal(view.refreshPosts(), 0);
    assert.equal(selectedContextNode(view).tagName, 'P'); assert.equal(selectedContextNode(view).className, 'body-preview-private');
    assert.match(css, /\.body-preview-private \{[^}]*font-size: 14px/);
    assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 1);
  }
});

test('selected context: invalid, missing and mismatched options never supply a work title', () => {
  for (const [workId, optionId, title, disabled, sourceLocale = 'ko'] of [
    ['', id(9), 'Synthetic public work', true], ['../unsafe', '../unsafe', 'Unsafe target', true],
    [id(1), id(9), 'Synthetic public work', false], [id(1), id(1), '', false],
    [id(1), id(1), 'Unsupported language target', true, 'zh'],
  ]) {
    const view = mounted(); view.sourceLocale.value = sourceLocale;
    selectManuscript(view, title, optionId); view.work.value = workId; view.work.fire('input');
    assert.equal(selectedContextNode(view).textContent, '\uc6d0\uace0 \uc900\ube44 \uc791\ud488: \ubbf8\uc120\ud0dd');
    assert.equal(view.button().disabled, disabled); assert.equal(view.calls.length, 0);
    assert.equal(selectedContextNode(view).textContent.includes(id(9)), false);
  }
  for (const control of ['work', 'sourceLocale']) {
    const view = mounted(); selectManuscript(view); view[control].disabled = true; view.mutate(view[control]);
    assert.ok(view.observers.find(observer => observer.target === view[control]).options.attributeFilter.includes('disabled'));
    assert.equal(selectedContextNode(view).textContent, ''); assert.equal(view.calls.length, 0);
  }
  const view = mounted(); selectManuscript(view);
  view.sourceLocale.selectedOptions[0].value = 'en'; view.sourceLocale.fire('input');
  assert.equal(selectedContextNode(view).textContent.includes('Synthetic manuscript A'), false);
  assert.equal(view.calls.length, 0);
});

test('selected context: authentication, selection and language invalidate without automatic loads', async () => {
  for (const change of ['logout', 'account', 'auth-event', 'work', 'source', 'ui', 'hidden']) {
    const view = mounted(); selectManuscript(view); await view.click();
    assert.equal(view.host.textContent.includes('Private text'), true);
    if (change === 'logout') { view.setOwner(null); view.window.fire('lumina:authchange'); }
    if (change === 'account') { view.setOwner({ ownerId: id(9), epoch: 2 }); view.shell.hidden = true; view.window.fire('lumina:authchange'); }
    if (change === 'auth-event') view.window.fire('lumina:authchange');
    if (change === 'work') selectManuscript(view, 'Synthetic manuscript B', id(9));
    if (change === 'source') selectSourceLocale(view, 'en');
    if (change === 'ui') { view.locale('ja'); view.window.fire('lumina:localechange'); }
    if (change === 'hidden') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
    assert.equal(view.host.textContent.includes('Private text'), false);
    assert.equal(view.calls.length, 1); assert.equal(view.refreshPosts(), 0);
    if (['logout', 'account', 'auth-event', 'hidden'].includes(change)) {
      assert.equal(selectedContextNode(view).textContent.includes('Synthetic manuscript A'), false);
      assert.equal(selectedContextNode(view).textContent, '');
      assert.equal(view.button().disabled, change !== 'auth-event');
    } else if (change === 'work') {
      assert.equal(selectedContextNode(view).textContent.includes('Synthetic manuscript A'), false);
      assert.equal(selectedContextNode(view).textContent.includes('Synthetic manuscript B'), true);
    } else if (change === 'source') assert.equal(selectedContextNode(view).textContent.endsWith('English'), true);
    else assert.equal(selectedContextNode(view).textContent.startsWith(selectedContextLabels.ja.work), true);
  }
});

test('selected context: late responses cannot restore old titles, languages or body text', async () => {
  for (const change of ['work', 'source', 'logout']) {
    const pending = deferred(), view = mounted(() => pending.promise); selectManuscript(view);
    const task = view.click(); assert.equal(view.calls.length, 1);
    if (change === 'work') selectManuscript(view, 'Synthetic manuscript B', id(9));
    if (change === 'source') selectSourceLocale(view, 'en');
    if (change === 'logout') { view.setOwner(null); view.window.fire('lumina:authchange'); }
    const current = selectedContextNode(view).textContent;
    assert.equal(view.calls[0].options.signal.aborted, true);
    pending.resolve(response()); assert.equal(await task, false);
    assert.equal(selectedContextNode(view).textContent, current);
    assert.equal(view.host.textContent.includes('Private text'), false);
    assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.method, 'GET');
    assert.equal(view.calls[0].options.body, undefined); assert.equal(view.refreshPosts(), 0);
  }
});

test('selected context: title text stays literal and option refresh never fetches or changes the selected work', () => {
  const view = mounted(), attack = '<img src=x onerror=attack()><script>steal()</script>';
  const option = selectManuscript(view, attack);
  assert.equal(selectedContextNode(view).textContent.includes(attack), true);
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'A', 'IFRAME'].includes(node.tagName)).length, 0);
  option.textContent = 'Synthetic renamed manuscript'; view.mutate(view.work);
  assert.equal(selectedContextNode(view).textContent.includes(attack), false);
  assert.equal(selectedContextNode(view).textContent.includes('Synthetic renamed manuscript'), true);
  assert.equal(view.calls.length, 0); assert.equal(view.refreshPosts(), 0);
  assert.equal(view.work.value, id(1)); assert.equal(view.button().disabled, false);
  selectSourceLocale(view, 'ko', 'Synthetic current locale label');
  assert.equal(selectedContextNode(view).textContent.endsWith('Synthetic current locale label'), true);
  view.window.LuminaCreatorStudioApi.identity = () => { throw new Error('Private identity diagnostic'); };
  view.window.fire('focus');
  assert.equal(selectedContextNode(view).textContent, ''); assert.equal(view.calls.length, 0);
  assert.equal(view.host.textContent.includes('Private identity diagnostic'), false);
});

test('selected context: identity replacement cannot rebind the same private options after focus or a late GET', async () => {
  for (const owner of [{ ownerId: id(9), epoch: 1 }, { ownerId: id(8), epoch: 2 }]) {
    const pending = deferred(), view = mounted(() => pending.promise); selectManuscript(view);
    const first = view.work.options[0], second = new Element('option'); second.value = id(9); second.textContent = 'Synthetic alternate story';
    view.work.options.push(second); view.work.append(second); view.mutate(view.work);
    const task = view.click();
    first.textContent = 'Synthetic pending rename'; view.mutate(view.work);
    assert.equal(selectedContextNode(view).textContent.includes('Synthetic pending rename'), true);
    assert.equal(view.button().disabled, true); assert.equal(view.calls.length, 1);
    view.setOwner(owner);
    pending.resolve(response()); assert.equal(await task, false);
    assert.equal(selectedContextNode(view).textContent, ''); assert.equal(view.host.textContent.includes('Private text'), false);
    view.window.fire('lumina:authchange'); assert.equal(selectedContextNode(view).textContent, '');
    for (const type of ['focus', 'pageshow']) { view.window.fire(type); assert.equal(selectedContextNode(view).textContent, ''); }
    view.work.fire('change'); view.mutate(view.work); assert.equal(selectedContextNode(view).textContent, '');
    view.work.value = second.value; view.work.selectedOptions = [second]; view.work.fire('change');
    assert.equal(selectedContextNode(view).textContent, '');
    selectSourceLocale(view, 'en'); assert.equal(selectedContextNode(view).textContent, '');
    first.textContent = 'Synthetic old owner rename'; view.mutate(view.work);
    assert.equal(selectedContextNode(view).textContent, ''); assert.equal(view.calls.length, 1); assert.equal(view.refreshPosts(), 0);
    selectManuscript(view, 'Synthetic new owner story', id(9));
    assert.equal(selectedContextNode(view).textContent.includes('Synthetic new owner story'), true);
    assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.signal.aborted, true);
  }
});

test('selected context: disabled, unauthenticated and invalid selectors never advance the private option binding', () => {
  for (const mode of ['work-disabled', 'locale-disabled', 'unauthenticated', 'invalid-work', 'invalid-locale', 'invalid-title']) {
    const view = mounted(); selectManuscript(view);
    const oldOptions = view.work.options, oldOption = oldOptions[0], owner = { ownerId: id(9), epoch: 2 };
    const candidate = new Element('option'); candidate.value = id(9); candidate.textContent = 'Synthetic unvalidated story';
    view.setOwner(mode === 'unauthenticated' ? null : owner);
    view.work.options = [candidate]; view.work.selectedOptions = [candidate]; view.work.value = candidate.value;
    if (mode === 'work-disabled') view.work.disabled = true;
    if (mode === 'locale-disabled') view.sourceLocale.disabled = true;
    if (mode === 'invalid-work') view.work.value = candidate.value = '../unsafe';
    if (mode === 'invalid-locale') view.sourceLocale.value = 'xx';
    if (mode === 'invalid-title') candidate.textContent = '';
    view.mutate(view.work);
    assert.equal(selectedContextNode(view).textContent.includes('Synthetic unvalidated story'), false);
    view.setOwner(owner); view.work.disabled = false; view.sourceLocale.disabled = false;
    view.work.options = oldOptions; view.work.selectedOptions = [oldOption]; view.work.value = oldOption.value;
    view.sourceLocale.value = 'ko'; view.work.fire('change');
    assert.equal(selectedContextNode(view).textContent, '');
    selectManuscript(view, 'Synthetic validated replacement', id(9));
    assert.equal(selectedContextNode(view).textContent.includes('Synthetic validated replacement'), true);
    assert.equal(view.calls.length, 0); assert.equal(view.refreshPosts(), 0);
  }
});

test('selected context: partial option mutations cannot relabel retained nodes for a new identity', () => {
  for (const owner of [{ ownerId: id(9), epoch: 1 }, { ownerId: id(8), epoch: 2 }]) {
    for (const mutation of ['append', 'remove', 'reorder', 'replace-unselected']) {
      const view = mounted(); const selected = selectManuscript(view, 'Synthetic prior owner story');
      const other = new Element('option'); other.value = id(9); other.textContent = 'Synthetic prior alternate';
      view.work.options.push(other); view.mutate(view.work);
      view.setOwner(owner); view.window.fire('lumina:authchange');
      const fresh = new Element('option'); fresh.value = id(7); fresh.textContent = 'Synthetic new current story';
      view.work.options = mutation === 'append' ? [selected, other, fresh] : mutation === 'remove' ? [selected]
        : mutation === 'reorder' ? [other, selected] : [selected, fresh];
      view.mutate(view.work);
      assert.equal(selectedContextNode(view).textContent, '', mutation);
      view.work.options = [other, fresh]; view.work.value = other.value; view.work.selectedOptions = [other];
      view.work.fire('change');
      assert.equal(selectedContextNode(view).textContent, '', 'An old unselected node cannot become current');
      view.work.value = fresh.value; view.work.selectedOptions = [fresh]; view.work.fire('change');
      assert.equal(selectedContextNode(view).textContent.includes('Synthetic new current story'), true);
      view.work.options = [fresh, selected]; view.work.value = selected.value; view.work.selectedOptions = [selected];
      view.work.fire('change');
      assert.equal(selectedContextNode(view).textContent, '', 'Reinserting an old node cannot renew its scope');
      assert.equal(view.calls.length, 0); assert.equal(view.refreshPosts(), 0);
    }
  }
});

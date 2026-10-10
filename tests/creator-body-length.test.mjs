import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-length.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-body-length.css', import.meta.url), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const diagnostic = (locale = 'ko') => ({
  contract: 'story-author-body-length-v1', locale, readOnly: true, referenceScope: 'current_published_original_part', progressRevision: 7,
  currentApprovalVerified: false, semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
  outcome: 'generated_body_checked', diagnostic: {
    version: 'story-fixed-cap-narrative-v1', narrativeFit: 'within_original_bounds', reason: 'fixed_cap_narrative_within_original_bounds',
    measuredUnits: 100, utf8Bytes: 300, beatCount: 2, expectedBounds: { referenceUnits: 100, minUnits: 80, targetUnits: 100, maxUnits: 120 },
    currentApprovalVerified: false, providerReceiptVerified: false, semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0
  }
});
function unmeasured(reason, bounds = diagnostic().diagnostic.expectedBounds) {
  const value = diagnostic();
  Object.assign(value.diagnostic, { reason, narrativeFit: reason === 'continuation_output_underlength' ? 'underlength' : reason === 'continuation_output_overlength' ? 'overlength' : 'unmeasured',
    measuredUnits: null, utf8Bytes: null, beatCount: null, expectedBounds: bounds });
  return value;
}
function response(value = diagnostic(), { status = 200, raw = JSON.stringify(value), chunks = null, length = null, reader = null } = {}) {
  let index = 0;
  const stats = { reads: 0, cancelled: 0, released: 0, textReads: 0 };
  const bytes = chunks || [new TextEncoder().encode(raw)];
  const stream = reader || { read: async () => { stats.reads++; return index < bytes.length ? { done: false, value: bytes[index++] } : { done: true }; },
    cancel: async () => { stats.cancelled++; }, releaseLock: () => { stats.released++; } };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : null },
    body: { getReader: () => stream, cancel: async () => { stats.cancelled++; } },
    text: () => { stats.textReads++; throw new Error('Raw diagnostic text must not be read'); } };
}
function library(extra = {}) {
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController, ...extra });
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyLength, vm };
}
function screen(handler = ({ sourceLocale }) => response(diagnostic(sourceLocale)), onChange = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko', shown = true, authorized = true;
  const calls = [], states = [], { api } = library();
  const controller = api.createController({ fetch: (url, options) => { calls.push({ url, options }); return handler({ sourceLocale, calls }); },
    identity: () => owner, isCurrent: value => authorized && !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => { states.push(clone(state)); onChange(state); } });
  return { ...controller, calls, states, api, set: { owner: value => { owner = value; }, work: value => { workId = value; },
    source: value => { sourceLocale = value; }, language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; } } };
}
const cleared = view => assert.equal(view.snapshot().data, null);
const parse = (value, locale = 'ko') => library().api.parseDiagnostic(value, locale);

test('BODY-LENGTH: explicit read uses the exact GET with pinned identity, no-store and no retry', async () => {
  const view = screen(); view.syncContext(); view.snapshot(); assert.equal(view.calls.length, 0);
  assert.equal(await view.load(), true);
  assert.deepEqual(clone(view.snapshot().data), diagnostic());
  const { url, options } = view.calls[0];
  assert.equal(url, `/api/v1/me/creator-studio/stories/${id(1)}/body-preview/length-diagnostic?locale=ko`);
  assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options._retried, true);
  assert.equal(options.headers['Cache-Control'], 'no-store'); assert.equal(options.body, undefined);
  assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 }); assert.equal(options.signal.aborted, false);
  view.syncContext(); view.snapshot(); assert.equal(view.calls.length, 1);
  for (const language of locales) {
    const localized = screen(); localized.set.source(language); assert.equal(await localized.load(), true);
    assert.equal(localized.calls[0].url.endsWith(`?locale=${language}`), true); assert.equal(localized.snapshot().data.locale, language);
  }
});

test('BODY-LENGTH: unavailable contexts and strict UUID nonce inputs dispatch nothing', async () => {
  for (const [name, value] of [['work', '../unsafe'], ['work', '00000000-0000-0000-0000-000000000000'], ['source', 'zh'], ['owner', null], ['owner', { ownerId: 'unsafe', epoch: 1 }], ['owner', { ownerId: id(8), epoch: -1 }], ['shown', false], ['authorized', false]]) {
    const view = screen(); view.set[name](value); assert.equal(await view.load(), false); cleared(view); assert.equal(view.calls.length, 0);
  }
});

test('BODY-LENGTH: numeric revisions including zero and exact inclusive 80-120 bounds remain literal', () => {
  for (const units of [80, 100, 120]) {
    const value = diagnostic(); value.progressRevision = 0; value.diagnostic.measuredUnits = units;
    assert.deepEqual(clone(parse(freeze(value))), value);
  }
  const odd = diagnostic(); Object.assign(odd.diagnostic.expectedBounds, { referenceUnits: 101, minUnits: 81, targetUnits: 101, maxUnits: 121 });
  assert.deepEqual(clone(parse(odd)), odd);
});

test('BODY-LENGTH: no saved, canonical and unavailable reference outcomes have no diagnostic or invented zero', () => {
  for (const outcome of ['no_saved_body', 'canonical_body_only', 'original_reference_unavailable']) {
    const value = diagnostic(); value.outcome = outcome; value.diagnostic = null;
    if (outcome === 'no_saved_body') value.progressRevision = null;
    assert.deepEqual(clone(parse(value)), value);
  }
});

test('BODY-LENGTH: all fixed typed unmeasured reasons keep null counts, never estimated under/over counts', () => {
  for (const reason of ['fixed_cap_narrative_unmeasured', 'author_length_locale_mismatch', 'author_length_locale_unsupported', 'author_length_beats_invalid', 'author_length_beat_type_invalid',
    'author_length_text_invalid', 'author_length_byte_limit', 'author_length_unicode_invalid', 'continuation_output_underlength', 'continuation_output_overlength']) {
    const value = unmeasured(reason); assert.deepEqual(clone(parse(value)), value);
  }
  for (const reason of ['author_length_profile_invalid', 'fixed_cap_narrative_unmeasured']) {
    const value = unmeasured(reason, null); assert.deepEqual(clone(parse(value)), value);
  }
});

test('BODY-LENGTH: versions, readonly/privacy flags, required fields and numeric types fail closed', () => {
  const mutations = [v => { v.contract = 'v2'; }, v => { v.locale = 'en'; }, v => { v.readOnly = false; }, v => { v.referenceScope = 'current_manuscript'; },
    v => { v.progressRevision = -1; }, v => { v.progressRevision = '7'; }, v => { v.progressRevision = 1.5; }, v => { v.progressRevision = Number.MAX_SAFE_INTEGER + 1; },
    v => { v.progressRevision = null; }, v => { v.outcome = 'generated_body_measured'; }, v => { v.diagnostic.version = 'other'; }];
  for (const level of ['', 'diagnostic']) for (const flag of ['currentApprovalVerified', 'semanticQualityVerified', 'dispatchAuthorized', 'providerCalls']) {
    mutations.push(v => { (level ? v.diagnostic : v)[flag] = true; });
    mutations.push(v => { delete (level ? v.diagnostic : v)[flag]; });
  }
  mutations.push(v => { v.diagnostic.providerReceiptVerified = true; }, v => { v.operatingWrites = 1; }, v => { delete v.diagnostic; });
  for (const mutate of mutations) { const value = diagnostic(); mutate(value); assert.throws(() => parse(value)); }
  for (const value of [null, false, [], 'bad']) assert.throws(() => parse(value));
});

test('BODY-LENGTH: malformed fixed bounds and extra properties are rejected rather than loosened', () => {
  for (const mutate of [b => { b.referenceUnits = 0; }, b => { b.referenceUnits = 256001; }, b => { b.referenceUnits = '100'; }, b => { b.minUnits = 79; },
    b => { b.maxUnits = 121; }, b => { b.targetUnits = 90; }, b => { delete b.minUnits; }, b => { b.secret = 'private'; }, b => { b.maxUnits = Infinity; }]) {
    const value = diagnostic(); mutate(value.diagnostic.expectedBounds); assert.throws(() => parse(value));
  }
});

test('BODY-LENGTH: fit/reason/count contradictions, unknown reasons and null versus zero fail closed', () => {
  for (const mutate of [d => { d.narrativeFit = 'underlength'; }, d => { d.reason = 'private-error'; }, d => { d.reason = ['fixed_cap_narrative_unmeasured']; },
    d => { d.reason = '__proto__'; }, d => { d.measuredUnits = 79; }, d => { d.measuredUnits = 121; }, d => { d.measuredUnits = null; },
    d => { d.utf8Bytes = 99; }, d => { d.utf8Bytes = 100001; }, d => { d.beatCount = 0; }, d => { d.beatCount = 41; }, d => { d.expectedBounds = null; }]) {
    const value = diagnostic(); mutate(value.diagnostic); assert.throws(() => parse(value));
  }
  for (const field of ['measuredUnits', 'utf8Bytes', 'beatCount']) { const value = unmeasured('continuation_output_underlength'); value.diagnostic[field] = 0; assert.throws(() => parse(value)); }
  const wrongBounds = unmeasured('author_length_profile_invalid'); assert.throws(() => parse(wrongBounds));
  const canonical = diagnostic(); canonical.outcome = 'canonical_body_only'; assert.throws(() => parse(canonical));
});

test('BODY-LENGTH: IDs, hashes, raw body and arbitrary unknown fields never enter returned state', async () => {
  const sentinel = '<img src=x onerror=private()>PRIVATE_SOURCE_SENTINEL';
  for (const level of ['root', 'diagnostic', 'bounds']) for (const field of ['workId', 'title', 'rawbody', 'hash', 'request', 'secret']) {
    const value = diagnostic(); (level === 'root' ? value : level === 'diagnostic' ? value.diagnostic : value.diagnostic.expectedBounds)[field] = sentinel;
    const view = screen(() => response(value)); assert.equal(await view.load(), false); cleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(JSON.stringify(view.states).includes(sentinel), false);
  }
});

test('BODY-LENGTH: exactly 16 KiB is accepted and the next byte is cancelled without text fallback', async () => {
  const raw = JSON.stringify(diagnostic());
  for (const extra of [0, 1]) {
    const res = response(null, { raw: raw + ' '.repeat(16384 - Buffer.byteLength(raw) + extra) }), view = screen(() => res);
    assert.equal(await view.load(), extra === 0); assert.equal(res.stats.textReads, 0); assert.equal(res.stats.released, 1);
    assert.equal(res.stats.cancelled, extra); if (extra) cleared(view);
  }
});

test('BODY-LENGTH: oversize or malformed Content-Length cancels before any body read', async () => {
  for (const length of ['16385', '-1', 'NaN', '1.5', '9007199254740993']) {
    const res = response(diagnostic(), { length }), view = screen(() => res); await view.load();
    cleared(view); assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1);
  }
});

test('BODY-LENGTH: strict streaming UTF-8 decodes split bytes and rejects malformed/truncated bytes or uncontracted text', async () => {
  const raw = JSON.stringify(diagnostic());
  const padded = `${raw}\n\t`;
  const valid = Array.from(new TextEncoder().encode(padded), byte => new Uint8Array([byte]));
  const view = screen(() => response(null, { chunks: valid })); assert.equal(await view.load(), true);
  const privateValue = { ...diagnostic(), secret: '\uD55C\uD83C\uDFAC' };
  const split = Array.from(new TextEncoder().encode(JSON.stringify(privateValue)), byte => new Uint8Array([byte]));
  const decoded = response(null, { chunks: split }), rejected = screen(() => decoded); await rejected.load();
  assert.equal(rejected.snapshot().messageKey, 'invalid'); cleared(rejected); assert.equal(decoded.stats.cancelled, 0);
  for (const chunks of [[new Uint8Array([0xff])], [new Uint8Array([0xe2, 0x82])], [new TextEncoder().encode('{broken')]]) {
    const res = response(null, { chunks }), bad = screen(() => res); await bad.load(); cleared(bad);
    assert.equal(bad.snapshot().messageKey, 'invalid'); assert.equal(res.stats.cancelled, 1); assert.equal(res.stats.released, 1);
  }
});

test('BODY-LENGTH: no stream, null response and invalid status are not success or raw JSON fallbacks', async () => {
  for (const result of [null, { status: 200, text: () => { throw new Error('must not call'); } }, { status: '200' }]) {
    const view = screen(() => result); await view.load(); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  }
});

test('BODY-LENGTH: HTTP errors including old-server 404 cancel without parsing, fallback or retry', async () => {
  for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'unavailable'], [409, 'conflict'], [500, 'server'], [503, 'server'], [400, 'unavailable']]) {
    const res = response(null, { status }), view = screen(() => res); await view.load();
    cleared(view); assert.equal(view.snapshot().messageKey, key); assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1);
    view.syncContext(); assert.equal(view.calls.length, 1);
  }
});

test('BODY-LENGTH: untrusted transport messages/kinds cannot masquerade as a valid result', async () => {
  const view = screen(() => { throw Object.assign(new Error('PRIVATE_DIAGNOSTIC'), { kind: 'within' }); }); await view.load();
  cleared(view); assert.equal(view.snapshot().messageKey, 'transport'); assert.equal(JSON.stringify(view.states).includes('PRIVATE_DIAGNOSTIC'), false);
});

test('BODY-LENGTH: duplicate explicit click stays single-flight, snapshots remain detached copies', async () => {
  const held = deferred(), view = screen(() => held.promise), first = view.load();
  assert.equal(view.snapshot().busy, true); assert.equal(await view.load(), false); assert.equal(view.calls.length, 1);
  held.resolve(response()); await first;
  const snapshot = view.snapshot(); snapshot.data.diagnostic.measuredUnits = 999;
  assert.equal(view.snapshot().data.diagnostic.measuredUnits, 100);
});

for (const [name, change] of [['account', v => v.set.owner({ ownerId: id(9), epoch: 2 })], ['work', v => v.set.work(id(9))],
  ['source', v => v.set.source('ja')], ['language', v => v.set.language('en')], ['visibility', v => v.set.shown(false)], ['auth expiry', v => v.set.authorized(false)]]) {
  test(`BODY-LENGTH: ${name} clears numbers and rejects late fetch success/failure with no automatic read`, async () => {
    for (const success of [true, false]) {
      const held = deferred(), view = screen(() => held.promise), first = view.load();
      change(view); view.syncContext(); assert.equal(view.calls[0].options.signal.aborted, true); cleared(view);
      const before = clone(view.snapshot()); if (success) held.resolve(response()); else held.reject(new Error('OLD_PRIVATE_ERROR'));
      assert.equal(await first, false); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 1);
    }
    const ready = screen(); await ready.load(); change(ready); ready.syncContext(); cleared(ready); assert.equal(ready.calls.length, 1);
  });
}

test('BODY-LENGTH: A-B-A epoch changes and explicit same-work invalidation reject the old ticket', async () => {
  for (const identity of [true, false]) {
    const held = deferred(), view = screen(() => held.promise), first = view.load();
    if (identity) { view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext(); view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext(); }
    else { view.invalidate(); }
    held.resolve(response()); assert.equal(await first, false); cleared(view); assert.equal(view.calls.length, 1);
  }
});

test('BODY-LENGTH: late stream completion cannot unlock or replace a newer pending read', async () => {
  const chunk = deferred(); let reads = 0, cancelled = 0, released = 0;
  const firstResponse = response(null, { reader: { read: () => { reads++; return chunk.promise; }, cancel: async () => { cancelled++; }, releaseLock: () => { released++; } } });
  const next = deferred(), started = deferred();
  firstResponse.body.getReader = () => ({ read: () => { reads++; started.resolve(); return chunk.promise; }, cancel: async () => { cancelled++; }, releaseLock: () => { released++; } });
  const view = screen(({ calls }) => calls.length === 1 ? firstResponse : next.promise), first = view.load();
  await started.promise; view.invalidate(); const second = view.load();
  chunk.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(diagnostic())) });
  assert.equal(await first, false); assert.equal(view.snapshot().busy, true); cleared(view); assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(reads, 1);
  const newer = diagnostic(); newer.progressRevision = 8; next.resolve(response(newer)); assert.equal(await second, true);
  assert.equal(view.snapshot().data.progressRevision, 8); assert.equal(view.calls.length, 2);
});

test('BODY-LENGTH: reentrant onChange invalidation cancels before dispatch', async () => {
  let view;
  view = screen(undefined, state => { if (state.busy) { view.set.owner({ ownerId: id(9), epoch: 2 }); view.invalidate(); } });
  assert.equal(await view.load(), false); cleared(view); assert.equal(view.calls.length, 0);
});

test('BODY-LENGTH: an abort listener starting a new read cannot be cleared by the old reset', async () => {
  const held = deferred(), newer = diagnostic(); newer.progressRevision = 8;
  const view = screen(({ calls }) => calls.length === 1 ? held.promise : response(newer));
  const first = view.load(), started = deferred();
  view.calls[0].options.signal.addEventListener('abort', () => { started.resolve(view.load()); }, { once: true });
  view.invalidate(); assert.equal(await started.promise, true); held.resolve(response()); assert.equal(await first, false);
  assert.equal(view.snapshot().data.progressRevision, 8); assert.equal(view.calls.length, 2);
});

// Small synthetic DOM, not a browser layout engine or an authentication service.
const walk = node => [node, ...node.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set(); this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  fire(name, event = {}) { let result; for (const callback of this.listeners.get(name) || []) result = callback({ type: name, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler = () => response()) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const host = new Element('section', 'writerBodyLength'), preview = new Element('section', 'writerBodyPreview'), trial = new Element('section', 'writerBodyTrial');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko'; section.append(work, sourceLocale, preview, host, trial); shell.append(section);
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => walk(shell).find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', accessToken = 'SYNTHETIC_EXISTING_TOKEN', refreshes = 0;
  const calls = [], observers = [], icons = [];
  window.getAuth = () => ({ accessToken, refreshToken: 'DO_NOT_USE_REFRESH' }); window.luminaI18n = { getLocale: () => language };
  window.lucide = { icons: { Ruler: { syntheticIcon: true } }, createElement: icon => { icons.push(icon); return new Element('svg'); } };
  window.LuminaCreatorStudioApi = { identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: (url, options) => { if (!options.token || !options._retried) refreshes++; calls.push({ url, options }); return handler({ calls, locale: sourceLocale.value }); } };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe(target, options) { observers.push({ target, options, callback: this.callback }); } }
  const { api } = library({ window, document, MutationObserver, fetch: () => { throw new Error('Global transport forbidden'); } });
  return { api, window, document, shell, section, host, preview, trial, work, sourceLocale, calls, icons, observers,
    button: () => walk(host).find(node => node.tagName === 'BUTTON'), click: () => walk(host).find(node => node.tagName === 'BUTTON').fire('click'),
    setOwner: value => { owner = value; }, setToken: value => { accessToken = value; }, locale: value => { language = value; }, refreshes: () => refreshes,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); } };
}
const metadata = view => walk(view.host).find(node => node.id === 'writerBodyLengthContent');

test('BODY-LENGTH: actual IIFE mounts a single unframed sibling and one 44px icon control without requests', () => {
  const view = mounted(); assert.equal(view.api.mount(view.host), null); assert.equal(view.calls.length, 0);
  assert.deepEqual(view.section.children.map(node => node.id), ['writerManuscriptWork', 'writerManuscriptLocale', 'writerBodyPreview', 'writerBodyLength', 'writerBodyTrial']);
  assert.equal(view.icons.length, 1); assert.equal(view.icons[0], view.window.lucide.icons.Ruler); assert.equal(view.button().type, 'button');
  assert.ok(view.button().title); assert.ok(view.button().getAttribute('aria-label'));
  assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 1);
  assert.equal(walk(view.host).filter(node => ['ARTICLE', 'INPUT', 'TEXTAREA', 'A', 'IMG'].includes(node.tagName)).length, 0);
});

test('BODY-LENGTH: mounted explicit GET supplies current token, bypasses refresh and leaves sibling panes alone', async () => {
  const view = mounted(); view.preview.textContent = 'EXISTING_PREVIEW'; view.trial.textContent = 'UNKNOWN_COMMAND_JOURNAL';
  await view.click(); assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.token, 'SYNTHETIC_EXISTING_TOKEN'); assert.equal(view.refreshes(), 0);
  assert.match(metadata(view).textContent, /100/); assert.equal(view.preview.textContent, 'EXISTING_PREVIEW'); assert.equal(view.trial.textContent, 'UNKNOWN_COMMAND_JOURNAL');
  for (const name of ['focus', 'pageshow', 'lumina:localechange']) view.window.fire(name);
  assert.equal(view.calls.length, 1); assert.equal(view.refreshes(), 0);
});

test('BODY-LENGTH: absent token and reentrant token-accessor account/work switches dispatch no GET', async () => {
  for (const change of ['missing', 'account', 'work']) {
    const view = mounted();
    if (change === 'missing') view.setToken(null);
    else view.window.getAuth = () => { if (change === 'account') view.setOwner({ ownerId: id(9), epoch: 2 }); else view.work.value = id(9); return { accessToken: 'SYNTHETIC_OTHER' }; };
    await view.click(); assert.equal(view.calls.length, 0); assert.equal(view.refreshes(), 0); assert.equal(metadata(view).children.length, 0);
  }
});

for (const language of locales) test(`BODY-LENGTH: mounted ${language} labels preserve independent source locale and numeric snapshot`, async () => {
  const view = mounted(({ locale }) => response(diagnostic(locale))); view.locale(language); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
  await view.click(); assert.equal(view.host.lang, language); assert.equal(view.calls[0].url.endsWith('?locale=ja'), true);
  const c = view.api.copy[language]; assert.equal(view.button().title, c.check); assert.equal(view.button().getAttribute('aria-label'), c.check);
  for (const label of [c.scope, c.published, c.revision, c.reference, c.range, c.within, c.snapshot]) assert.ok(view.host.textContent.includes(label));
  assert.ok(view.host.textContent.includes('80 - 120')); assert.ok(view.host.textContent.includes('7')); assert.ok(view.host.textContent.includes('\u65e5\u672c\u8a9e'));
  assert.doesNotMatch(view.host.textContent, /story-author-body|story-fixed-cap|current_published_original_part|fixed_cap_narrative/);
});

test('BODY-LENGTH: all dictionaries have identical finite status labels and exact Korean revision label', () => {
  const { api } = library(), keys = Object.keys(api.copy.ko).sort();
  for (const language of locales) { assert.deepEqual(Object.keys(api.copy[language]).sort(), keys); for (const [key, text] of Object.entries(api.copy[language])) assert.ok(typeof text === 'string' && (key === 'hidden' || text.length > 0)); }
  assert.equal(api.copy.ko.revision, '\uac80\uc0ac \uacbd\ub85c \ubc84\uc804');
});

test('BODY-LENGTH: mounted lifecycle/account/progress/receipt events clear numbers without automatic reads', async () => {
  for (const name of ['storage', 'lumina:authchange', 'lumina:auth-expired', 'pagehide', 'creator:manuscript-accepted', 'lumina:author-body-trial-progress-changed']) {
    const view = mounted(); await view.click(); view.window.fire(name); assert.equal(metadata(view).children.length, 0); assert.equal(view.calls.length, 1);
  }
  for (const name of ['visibilitychange', 'lumina:auth-expired']) {
    const view = mounted(); await view.click(); view.document.fire(name); assert.equal(metadata(view).children.length, 0); assert.equal(view.calls.length, 1);
  }
});

test('BODY-LENGTH: bound selection/language/visibility/tab changes clear numeric DOM and never fetch', async () => {
  for (const change of ['work', 'source', 'language', 'shell', 'section', 'host', 'document', 'tab', 'hide-show']) {
    const view = mounted(); await view.click();
    if (change === 'work') { view.work.value = id(9); view.work.fire('input'); }
    if (change === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('change'); }
    if (change === 'language') { view.locale('en'); view.window.fire('lumina:localechange'); }
    if (change === 'shell') { view.shell.hidden = true; view.mutate(view.shell); }
    if (change === 'section') { view.section.classList.remove('is-active'); view.mutate(view.section); }
    if (change === 'host') { view.host.hidden = true; view.mutate(view.host); }
    if (change === 'document') { view.document.documentElement.lang = 'en'; view.mutate(view.document.documentElement); }
    if (change === 'tab') { const tab = new Element('button'); tab.setAttribute('data-section', 'artist-list'); view.document.fire('click', { target: tab }); }
    if (change === 'hide-show') { view.section.classList.remove('is-active'); view.section.classList.add('is-active'); view.mutate(view.section); }
    assert.equal(metadata(view).children.length, 0, change); assert.equal(view.calls.length, 1); assert.equal(view.refreshes(), 0);
  }
});

test('BODY-LENGTH: mounted late response after receipt and new explicit read cannot restore old snapshot', async () => {
  const held = deferred(), newer = diagnostic(); newer.progressRevision = 8;
  const view = mounted(({ calls }) => calls.length === 1 ? held.promise : response(newer)), first = view.click();
  view.window.fire('creator:manuscript-accepted'); assert.equal(view.calls[0].options.signal.aborted, true);
  await view.click(); const before = view.host.textContent; held.resolve(response()); assert.equal(await first, false);
  assert.equal(view.host.textContent, before); assert.equal(view.calls.length, 2);
  const revision = metadata(view).children.find(row => row.children[0].textContent === view.api.copy.ko.revision); assert.equal(revision.children[1].textContent, '8');
});

test('BODY-LENGTH: unmeasured counts display unknown, no body/hash/ID or injected HTML gets rendered', async () => {
  const value = unmeasured('continuation_output_underlength'), view = mounted(() => response(value)); await view.click();
  for (const label of ['measured', 'bytes', 'beats']) {
    const row = metadata(view).children.find(node => node.children[0].textContent === view.api.copy.ko[label]); assert.equal(row.children[1].textContent, view.api.copy.ko.unknown);
  }
  const attack = '<img src=x onerror=steal()>PRIVATE_BODY';
  value.secret = attack; await view.click(); assert.equal(metadata(view).children.length, 0); assert.equal(view.host.textContent.includes(attack), false);
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'IFRAME', 'INPUT', 'TEXTAREA', 'A'].includes(node.tagName)).length, 0);
});

test('BODY-LENGTH: narrow source/style contracts keep one GET, textContent-only and responsive unframed layout', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|setInterval|setTimeout|\.json\(|\.text\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /\/generate|\/approve|\/payments|\/auth\/refresh|console\.|createObjectURL/);
  assert.match(source, /maxBytes = 16 \* 1024/); assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 44px/); assert.match(css, /width: 44px;\s*height: 44px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/); assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /letter-spacing: 0/); assert.match(css, /@media print/);
  assert.doesNotMatch(css, /box-shadow|linear-gradient|\d(?:vw|cqw)|min-width:\s*\d{3}px/);
});

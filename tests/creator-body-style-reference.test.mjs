import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-style-reference.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-body-style-reference.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../scripts/public-site-manifest.json', import.meta.url), 'utf8'));
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const diagnostic = (locale = 'ko', reason = 'body_style_reference_same_approval_pin', currentSourceState = 'validated') => ({
  contract: 'story-author-body-style-reference-read-v1', locale,
  sourceScope: 'current_saved_body_and_latest_private_approval', progressRevision: 7,
  readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false,
  semanticQualityVerified: false, dispatchAuthorized: false, currentSourceState,
  currentProfileVersion: currentSourceState === 'validated' ? 4 : null,
  currentReviewRevision: currentSourceState === 'validated' ? 3 : null,
  diagnostic: {
    version: 'story-author-body-style-reference-v1', referenceScope: 'stored_completed_origin_request_pin',
    contextSource: 'caller_supplied_metadata',
    comparison: reason === 'body_style_reference_same_approval_pin' ? 'same_approval_pin'
      : reason === 'body_style_reference_different_approval_pin' ? 'different_approval_pin' : 'unavailable',
    reason, readOnly: true, currentApprovalVerified: false, originalGenerationApprovalVerified: false,
    semanticQualityVerified: false, generatedBodyQualityVerified: false, bodySourceAligned: false,
    dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
  },
});
function response(value = diagnostic(), { status = 200, raw = JSON.stringify(value), chunks = null, length = null, reader = null } = {}) {
  let index = 0;
  const stats = { reads: 0, cancelled: 0, released: 0, fallback: 0 };
  const bytes = chunks || [new TextEncoder().encode(raw)];
  const stream = reader || {
    read: async () => { stats.reads++; return index < bytes.length ? { done: false, value: bytes[index++] } : { done: true }; },
    cancel: async () => { stats.cancelled++; }, releaseLock: () => { stats.released++; },
  };
  const fallback = () => { stats.fallback++; throw new Error('Unbounded diagnostic body fallback prohibited'); };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : null },
    body: { getReader: () => stream, cancel: async () => { stats.cancelled++; } },
    text: fallback, json: fallback, arrayBuffer: fallback };
}
function library(extra = {}) {
  const window = extra.window || {};
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {
    configurable: true, get: () => { throw new Error('Browser storage access prohibited'); },
  });
  const vm = createContext({ window, TextEncoder, TextDecoder, Uint8Array, AbortController, ...extra });
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyStyleReference, vm };
}
function screen(handler = ({ sourceLocale }) => response(diagnostic(sourceLocale)), onChange = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko', shown = true, authorized = true;
  const calls = [], states = [], { api } = library();
  const controller = api.createController({
    fetch: (url, options) => { calls.push({ url, options }); return handler({ sourceLocale, calls }); },
    identity: () => owner,
    isCurrent: value => authorized && !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => { states.push(clone(state)); onChange(state); },
  });
  return { ...controller, api, calls, states, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; }, authorized: value => { authorized = value; },
  } };
}
const cleared = view => assert.equal(view.snapshot().data, null);
const parse = (value, locale = 'ko') => library().api.parseDiagnostic(value, locale);

test('BODY-STYLE-REFERENCE: explicit five-locale GET pins identity with no-store, no body, no retry and no automatic read', async () => {
  for (const locale of locales) {
    const view = screen(); view.set.source(locale); view.syncContext(); view.snapshot();
    assert.equal(view.calls.length, 0); assert.equal(await view.load(), true);
    assert.deepEqual(clone(view.snapshot().data), diagnostic(locale));
    const { url, options } = view.calls[0];
    assert.equal(url, '/api/v1/me/creator-studio/stories/' + id(1) + '/body-preview/style-reference?locale=' + locale);
    assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options._retried, true);
    assert.equal(options.headers['Cache-Control'], 'no-store'); assert.equal(options.body, undefined);
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
    assert.equal(options.signal.aborted, false);
    view.syncContext(); view.snapshot(); assert.equal(view.calls.length, 1);
  }
});

test('BODY-STYLE-REFERENCE: missing auth, hidden scope, invalid UUID nonce and unsupported source locale dispatch nothing', async () => {
  for (const [key, value] of [['work', '../unsafe'], ['work', '00000000-0000-0000-0000-000000000000'],
    ['source', 'zh'], ['owner', null], ['owner', { ownerId: 'unsafe', epoch: 1 }],
    ['owner', { ownerId: id(8), epoch: -1 }], ['shown', false], ['authorized', false]]) {
    const view = screen(); view.set[key](value); assert.equal(await view.load(), false);
    cleared(view); assert.equal(view.calls.length, 0);
  }
});

test('BODY-STYLE-REFERENCE: same and different exact pins are metadata comparisons with every approval/quality flag false', () => {
  for (const reason of ['body_style_reference_same_approval_pin', 'body_style_reference_different_approval_pin']) {
    const value = diagnostic('ko', reason); value.progressRevision = 0;
    assert.deepEqual(clone(parse(freeze(value))), value);
    assert.equal(value.diagnostic.currentApprovalVerified, false);
    assert.equal(value.diagnostic.generatedBodyQualityVerified, false);
  }
});

test('BODY-STYLE-REFERENCE: none, canonical, reused, invalid origin, legacy pin and unknown remain finite unavailable states', () => {
  for (const reason of ['body_style_reference_no_saved_body', 'body_style_reference_canonical_body',
    'body_style_reference_reused_origin_unavailable', 'body_style_reference_origin_unavailable', 'body_style_reference_unavailable']) {
    const value = diagnostic('ko', reason, 'not_checked');
    if (reason === 'body_style_reference_no_saved_body') value.progressRevision = null;
    assert.deepEqual(clone(parse(value)), value);
    assert.equal(value.currentProfileVersion, null); assert.equal(value.currentReviewRevision, null);
  }
  for (const state of ['validated', 'unavailable']) {
    const value = diagnostic('ko', 'body_style_reference_pin_unavailable', state);
    assert.deepEqual(clone(parse(value)), value);
  }
});

test('BODY-STYLE-REFERENCE: strict envelope versions, scopes, required fields and false flags reject incompatibility', () => {
  const mutations = [
    v => { v.contract = 'v2'; }, v => { v.sourceScope = 'same_manuscript'; }, v => { v.locale = 'en'; },
    v => { v.diagnostic.version = 'v2'; }, v => { v.diagnostic.referenceScope = 'current_body_quality'; },
    v => { v.diagnostic.contextSource = 'server_approved'; }, v => { delete v.diagnostic; },
  ];
  for (const level of ['root', 'diagnostic']) {
    const flags = level === 'root'
      ? ['readOnly', 'providerCalls', 'operatingWrites', 'bodySourceAligned', 'semanticQualityVerified', 'dispatchAuthorized']
      : ['readOnly', 'providerCalls', 'operatingWrites', 'currentApprovalVerified', 'originalGenerationApprovalVerified',
        'semanticQualityVerified', 'generatedBodyQualityVerified', 'bodySourceAligned', 'dispatchAuthorized'];
    for (const key of flags) {
      mutations.push(v => { (level === 'root' ? v : v.diagnostic)[key] = key === 'readOnly' ? false : true; });
      mutations.push(v => { delete (level === 'root' ? v : v.diagnostic)[key]; });
    }
  }
  for (const mutate of mutations) { const value = diagnostic(); mutate(value); assert.throws(() => parse(value)); }
  for (const value of [null, false, [], 'bad']) assert.throws(() => parse(value));
  assert.throws(() => parse(diagnostic(), 'fr'));
});

test('BODY-STYLE-REFERENCE: inconsistent source state, comparison and reason fail closed instead of claiming a match', () => {
  for (const mutate of [
    v => { v.currentSourceState = 'approved'; }, v => { v.currentSourceState = 'unavailable'; },
    v => { v.diagnostic.comparison = 'unavailable'; }, v => { v.diagnostic.reason = '__proto__'; },
    v => { v.diagnostic.reason = ['body_style_reference_same_approval_pin']; },
    v => { v.diagnostic.reason = 'raw-private-error'; }, v => { v.progressRevision = null; },
  ]) { const value = diagnostic(); mutate(value); assert.throws(() => parse(value)); }
  for (const reason of ['body_style_reference_no_saved_body', 'body_style_reference_canonical_body',
    'body_style_reference_reused_origin_unavailable', 'body_style_reference_origin_unavailable', 'body_style_reference_unavailable']) {
    assert.throws(() => parse(diagnostic('ko', reason, 'validated')));
  }
  assert.throws(() => parse(diagnostic('ko', 'body_style_reference_pin_unavailable', 'not_checked')));
  const canonical = diagnostic('ko', 'body_style_reference_canonical_body', 'not_checked');
  canonical.progressRevision = null; assert.throws(() => parse(canonical));
});

test('BODY-STYLE-REFERENCE: numeric revisions are safe integers and unknown current versions are null, never fabricated zero', () => {
  for (const key of ['progressRevision', 'currentProfileVersion', 'currentReviewRevision']) {
    for (const value of [-1, 1.5, '7', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      const item = diagnostic(); item[key] = value; assert.throws(() => parse(item));
    }
  }
  for (const key of ['currentProfileVersion', 'currentReviewRevision']) {
    for (const value of [0, null]) { const item = diagnostic(); item[key] = value; assert.throws(() => parse(item)); }
    const unavailable = diagnostic('ko', 'body_style_reference_pin_unavailable', 'unavailable');
    unavailable[key] = 0; assert.throws(() => parse(unavailable));
    delete unavailable[key]; assert.throws(() => parse(unavailable));
  }
});

test('BODY-STYLE-REFERENCE: body, IDs, fingerprints, raw objects and XSS payloads cannot enter accepted state', async () => {
  const attack = '<img src=x onerror=steal()>PRIVATE_PROFILE_BODY';
  for (const level of ['root', 'diagnostic']) for (const key of ['workId', 'rawBody', 'section', 'fingerprint', 'path', 'secret']) {
    const value = diagnostic(); (level === 'root' ? value : value.diagnostic)[key] = attack;
    const view = screen(() => response(value)); assert.equal(await view.load(), false); cleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(JSON.stringify(view.states).includes(attack), false);
  }
});

test('BODY-STYLE-REFERENCE: exact 8 KiB streams are accepted and the next byte is cancelled without unbounded fallback', async () => {
  const raw = JSON.stringify(diagnostic());
  for (const extra of [0, 1]) {
    const res = response(null, { raw: raw + ' '.repeat(8192 - Buffer.byteLength(raw) + extra) });
    const view = screen(() => res);
    assert.equal(await view.load(), extra === 0); assert.equal(res.stats.fallback, 0);
    assert.equal(res.stats.released, 1); assert.equal(res.stats.cancelled, extra);
    if (extra) cleared(view);
  }
});

test('BODY-STYLE-REFERENCE: oversized or malformed Content-Length cancels before body reads', async () => {
  for (const length of ['8193', '-1', 'NaN', '1.5', '9007199254740993']) {
    const res = response(diagnostic(), { length }), view = screen(() => res);
    await view.load(); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
    assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1); assert.equal(res.stats.fallback, 0);
  }
});

test('BODY-STYLE-REFERENCE: fatal streaming UTF-8 handles split bytes and rejects malformed/truncated bytes, JSON and chunk types', async () => {
  const valid = Array.from(new TextEncoder().encode(JSON.stringify(diagnostic()) + '\n\t'), byte => new Uint8Array([byte]));
  assert.equal(await screen(() => response(null, { chunks: valid })).load(), true);
  const unknown = { ...diagnostic(), secret: '\uD55C\uD83C\uDFAC' };
  const decoded = response(null, { chunks: Array.from(new TextEncoder().encode(JSON.stringify(unknown)), byte => new Uint8Array([byte])) });
  const rejected = screen(() => decoded); await rejected.load();
  assert.equal(rejected.snapshot().messageKey, 'invalid'); assert.equal(decoded.stats.cancelled, 0);
  for (const chunks of [[new Uint8Array([0xff])], [new Uint8Array([0xe2, 0x82])],
    [new TextEncoder().encode('{broken')], ['not a byte chunk']]) {
    const res = response(null, { chunks }), view = screen(() => res); await view.load(); cleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(res.stats.cancelled, 1);
    assert.equal(res.stats.released, 1); assert.equal(res.stats.fallback, 0);
  }
});

test('BODY-STYLE-REFERENCE: missing stream and invalid status cannot become fallback success', async () => {
  for (const result of [null, { status: 200, text: () => { throw new Error('No fallback'); } }, { status: '200' }, { status: 600 }]) {
    const view = screen(() => result); await view.load(); cleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  }
});

test('BODY-STYLE-REFERENCE: old-server 404 and other HTTP failures cancel without parsing, refresh, fallback or retry', async () => {
  for (const [status, key] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'unavailable'],
    [409, 'conflict'], [500, 'server'], [503, 'server'], [400, 'unavailable']]) {
    const res = response(null, { status }), view = screen(() => res); await view.load(); cleared(view);
    assert.equal(view.snapshot().messageKey, key); assert.equal(res.stats.reads, 0);
    assert.equal(res.stats.cancelled, 1); assert.equal(res.stats.fallback, 0);
    view.syncContext(); assert.equal(view.calls.length, 1);
  }
});

test('BODY-STYLE-REFERENCE: untrusted error messages and kind cannot impersonate a diagnostic or leak text', async () => {
  const view = screen(() => { throw Object.assign(new Error('PRIVATE_FAILURE_TEXT'), { kind: 'same' }); });
  await view.load(); cleared(view); assert.equal(view.snapshot().messageKey, 'transport');
  assert.equal(JSON.stringify(view.states).includes('PRIVATE_FAILURE_TEXT'), false);
});

test('BODY-STYLE-REFERENCE: duplicate click remains single-flight and returned snapshots are detached', async () => {
  const held = deferred(), view = screen(() => held.promise), first = view.load();
  assert.equal(view.snapshot().busy, true); assert.equal(await view.load(), false); assert.equal(view.calls.length, 1);
  held.resolve(response()); assert.equal(await first, true);
  const external = view.snapshot(); external.data.currentProfileVersion = 900; external.data.diagnostic.comparison = 'unavailable';
  assert.equal(view.snapshot().data.currentProfileVersion, 4); assert.equal(view.snapshot().data.diagnostic.comparison, 'same_approval_pin');
});

for (const [name, change] of [
  ['account', v => v.set.owner({ ownerId: id(9), epoch: 2 })], ['work', v => v.set.work(id(9))],
  ['source language', v => v.set.source('ja')], ['display language', v => v.set.language('en')],
  ['visibility', v => v.set.shown(false)], ['auth expiry', v => v.set.authorized(false)],
]) test('BODY-STYLE-REFERENCE: ' + name + ' clears current data and fences late fetch success/failure without new reads', async () => {
  for (const success of [true, false]) {
    const held = deferred(), view = screen(() => held.promise), first = view.load();
    change(view); view.syncContext(); assert.equal(view.calls[0].options.signal.aborted, true); cleared(view);
    const before = clone(view.snapshot());
    if (success) held.resolve(response()); else held.reject(new Error('OLD_PRIVATE_FAILURE'));
    assert.equal(await first, false); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 1);
  }
  const ready = screen(); await ready.load(); change(ready); ready.syncContext(); cleared(ready);
  assert.equal(ready.calls.length, 1);
});

test('BODY-STYLE-REFERENCE: account/work A-B-A and same-scope lifecycle invalidation reject the old ticket', async () => {
  for (const kind of ['account', 'work', 'same scope']) {
    const held = deferred(), view = screen(() => held.promise), first = view.load();
    if (kind === 'account') {
      view.set.owner({ ownerId: id(9), epoch: 2 }); view.syncContext();
      view.set.owner({ ownerId: id(8), epoch: 3 }); view.syncContext();
    } else if (kind === 'work') {
      view.set.work(id(9)); view.syncContext(); view.set.work(id(1)); view.syncContext();
    } else view.invalidate();
    held.resolve(response()); assert.equal(await first, false); cleared(view); assert.equal(view.calls.length, 1);
  }
});

test('BODY-STYLE-REFERENCE: late stream cannot replace or unlock a newer pending explicit read', async () => {
  const held = deferred(), started = deferred(), next = deferred();
  let cancelled = 0, released = 0, reads = 0;
  const res = response(null, { reader: {
    read: () => { reads++; started.resolve(); return held.promise; },
    cancel: async () => { cancelled++; }, releaseLock: () => { released++; },
  } });
  const view = screen(({ calls }) => calls.length === 1 ? res : next.promise), first = view.load();
  await started.promise; view.invalidate(); const second = view.load();
  held.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(diagnostic())) });
  assert.equal(await first, false); assert.equal(view.snapshot().busy, true); cleared(view);
  assert.equal(cancelled, 1); assert.equal(released, 1); assert.equal(reads, 1);
  const value = diagnostic(); value.progressRevision = 8; next.resolve(response(value));
  assert.equal(await second, true); assert.equal(view.snapshot().data.progressRevision, 8); assert.equal(view.calls.length, 2);
});

test('BODY-STYLE-REFERENCE: reentrant onChange invalidation prevents dispatch before any transport starts', async () => {
  let view;
  view = screen(undefined, state => { if (state.busy) { view.set.owner({ ownerId: id(9), epoch: 2 }); view.invalidate(); } });
  assert.equal(await view.load(), false); cleared(view); assert.equal(view.calls.length, 0);
});

test('BODY-STYLE-REFERENCE: abort listener may start a new read without the old reset clearing its result', async () => {
  const held = deferred(), newer = diagnostic(); newer.progressRevision = 8;
  const view = screen(({ calls }) => calls.length === 1 ? held.promise : response(newer)), first = view.load(), started = deferred();
  view.calls[0].options.signal.addEventListener('abort', () => { started.resolve(view.load()); }, { once: true });
  view.invalidate(); assert.equal(await started.promise, true);
  held.resolve(response()); assert.equal(await first, false);
  assert.equal(view.snapshot().data.progressRevision, 8); assert.equal(view.calls.length, 2);
});

// Bounded synthetic DOM only: the complete product IIFE runs, not extracted render code.
// This is not a browser geometry, real storage, account or server test.
const walk = node => [node, ...node.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  set innerHTML(_) { throw new Error('HTML sink prohibited'); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, callback) { this.listeners.set(name, [...(this.listeners.get(name) || []), callback]); }
  fire(name, event = {}) { let result; for (const callback of this.listeners.get(name) || []) result = callback({ type: name, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler = ({ locale }) => response(diagnostic(locale))) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell');
  const section = new Element('section', 'writer-manuscript'), host = new Element('section', 'writerBodyStyleReference');
  const preview = new Element('section', 'writerBodyPreview'), length = new Element('section', 'writerBodyLength');
  const style = new Element('section', 'writerApprovedStyle'), trial = new Element('section', 'writerBodyTrial');
  const review = new Element('section', 'writerBodyReview'), work = new Element('select', 'writerManuscriptWork');
  const sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko';
  section.append(work, sourceLocale, preview, length, style, host, trial, review); shell.append(section);
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => walk(shell).find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', accessToken = 'SYNTHETIC_EXISTING_TOKEN', refreshes = 0;
  const calls = [], observers = [], icons = [];
  window.getAuth = () => ({ accessToken, refreshToken: 'NEVER_USE_SYNTHETIC_REFRESH' });
  window.luminaI18n = { getLocale: () => language };
  window.lucide = { icons: { ListChecks: { syntheticIcon: true } }, createElement: icon => { icons.push(icon); return new Element('svg'); } };
  window.LuminaCreatorStudioApi = {
    identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: (url, options) => {
      if (!options.token || !options._retried) refreshes++;
      calls.push({ url, options }); return handler({ calls, locale: sourceLocale.value });
    },
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ target, options, callback: this.callback }); }
  }
  const { api } = library({ window, document, MutationObserver,
    fetch: () => { throw new Error('Global transport prohibited'); } });
  const button = () => walk(host).find(node => node.tagName === 'BUTTON');
  return { api, window, document, shell, section, host, preview, length, style, trial, review, work, sourceLocale,
    calls, observers, icons, button, click: () => button().fire('click'),
    setOwner: value => { owner = value; }, setToken: value => { accessToken = value; },
    locale: value => { language = value; }, refreshes: () => refreshes,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); },
  };
}
const metadata = view => walk(view.host).find(node => node.id === 'writerBodyStyleReferenceContent');

test('BODY-STYLE-REFERENCE: actual IIFE mounts one unframed sibling and a single accessible ListChecks icon without reads', () => {
  const view = mounted(); assert.equal(view.api.mount(view.host), null); assert.equal(view.calls.length, 0);
  assert.deepEqual(view.section.children.map(node => node.id), ['writerManuscriptWork', 'writerManuscriptLocale',
    'writerBodyPreview', 'writerBodyLength', 'writerApprovedStyle', 'writerBodyStyleReference', 'writerBodyTrial', 'writerBodyReview']);
  assert.equal(view.icons.length, 1); assert.equal(view.icons[0], view.window.lucide.icons.ListChecks);
  assert.equal(view.button().type, 'button'); assert.ok(view.button().title); assert.ok(view.button().getAttribute('aria-label'));
  assert.equal(walk(view.host).filter(node => node.tagName === 'BUTTON').length, 1);
  assert.equal(walk(view.host).filter(node => ['ARTICLE', 'INPUT', 'TEXTAREA', 'IMG', 'A'].includes(node.tagName)).length, 0);
});

test('BODY-STYLE-REFERENCE: bound explicit read forwards current token without refresh and preserves body/style/journal sibling panes', async () => {
  const view = mounted();
  for (const pane of [view.preview, view.length, view.style, view.trial, view.review]) pane.textContent = 'EXISTING_' + pane.id;
  await view.click(); assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.token, 'SYNTHETIC_EXISTING_TOKEN');
  assert.equal(view.refreshes(), 0); assert.ok(metadata(view).textContent.includes('7'));
  for (const pane of [view.preview, view.length, view.style, view.trial, view.review]) assert.equal(pane.textContent, 'EXISTING_' + pane.id);
  for (const name of ['focus', 'pageshow', 'lumina:localechange']) view.window.fire(name);
  assert.equal(view.calls.length, 1); assert.equal(view.refreshes(), 0);
});

test('BODY-STYLE-REFERENCE: missing token and reentrant auth/work/source changes during token access cannot dispatch', async () => {
  for (const change of ['missing', 'account', 'work', 'source']) {
    const view = mounted();
    if (change === 'missing') view.setToken(null);
    else view.window.getAuth = () => {
      if (change === 'account') view.setOwner({ ownerId: id(9), epoch: 2 });
      if (change === 'work') view.work.value = id(9);
      if (change === 'source') view.sourceLocale.value = 'ja';
      return { accessToken: 'SYNTHETIC_NEW_TOKEN' };
    };
    await view.click(); assert.equal(view.calls.length, 0); assert.equal(view.refreshes(), 0);
    assert.equal(metadata(view).children.length, 0);
  }
});

for (const language of locales) test('BODY-STYLE-REFERENCE: mounted ' + language + ' labels keep body locale independent and quality explicitly unverified', async () => {
  const view = mounted(); view.locale(language); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
  await view.click(); assert.equal(view.host.lang, language);
  assert.equal(view.calls[0].url.endsWith('?locale=ja'), true);
  const c = view.api.copy[language];
  assert.equal(view.button().title, c.check); assert.equal(view.button().getAttribute('aria-label'), c.check);
  for (const label of [c.title, c.same, c.source, c.revision, c.profile, c.review, c.quality, c.unverified]) {
    assert.ok(view.host.textContent.includes(label), language + ': ' + label);
  }
  assert.equal(metadata(view).children.length, 5);
  assert.ok(view.host.textContent.includes('\u65e5\u672c\u8a9e'));
  assert.doesNotMatch(view.host.textContent, /story-author-body|body_style_reference|current_saved_body|stored_completed_origin_request_pin/);
});

test('BODY-STYLE-REFERENCE: all five dictionaries share finite keys and exact Korean metadata labels, with no raw reason display', () => {
  const { api } = library(), keys = Object.keys(api.copy.ko).sort();
  for (const language of locales) {
    assert.deepEqual(Object.keys(api.copy[language]).sort(), keys);
    for (const text of Object.values(api.copy[language])) assert.ok(typeof text === 'string' && text.length > 0);
  }
  assert.equal(api.copy.ko.revision, '\uc77d\uc740 \uacbd\ub85c \ubc84\uc804');
  assert.equal(api.copy.ko.quality, '\ubcf8\ubb38 \ubb38\uccb4 \uc758\ubbf8 \uac80\uc218');
  assert.equal(api.copy.ko.unverified, '\ubbf8\ud655\uc778');
});

test('BODY-STYLE-REFERENCE: bound account/storage/receipt/progress/lifecycle events clear metadata with no automatic read or write', async () => {
  for (const name of ['storage', 'lumina:authchange', 'lumina:auth-expired', 'pagehide',
    'creator:manuscript-accepted', 'lumina:author-body-trial-progress-changed']) {
    const view = mounted(); await view.click(); view.window.fire(name);
    assert.equal(metadata(view).children.length, 0); assert.equal(view.calls.length, 1);
  }
  for (const name of ['visibilitychange', 'lumina:auth-expired']) {
    const view = mounted(); await view.click(); view.document.fire(name);
    assert.equal(metadata(view).children.length, 0); assert.equal(view.calls.length, 1);
  }
});

test('BODY-STYLE-REFERENCE: bound selection, language, visibility, disconnection and tab changes clear DOM without GET', async () => {
  for (const change of ['work', 'source', 'language', 'shell', 'section', 'host', 'document', 'tab', 'hide-show', 'disconnected']) {
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
    if (change === 'disconnected') { view.host.isConnected = false; view.window.fire('focus'); }
    assert.equal(metadata(view).children.length, 0, change); assert.equal(view.calls.length, 1); assert.equal(view.refreshes(), 0);
  }
});

test('BODY-STYLE-REFERENCE: old response after accepted manuscript cannot restore old data over a new explicit read', async () => {
  const held = deferred(), newer = diagnostic(); newer.progressRevision = 8;
  const view = mounted(({ calls }) => calls.length === 1 ? held.promise : response(newer)), first = view.click();
  view.window.fire('creator:manuscript-accepted'); assert.equal(view.calls[0].options.signal.aborted, true);
  await view.click(); const before = view.host.textContent;
  held.resolve(response()); assert.equal(await first, false); assert.equal(view.host.textContent, before);
  const row = metadata(view).children.find(node => node.children[0].textContent === view.api.copy.ko.revision);
  assert.equal(row.children[1].textContent, '8'); assert.equal(view.calls.length, 2);
});

test('BODY-STYLE-REFERENCE: null versions display unverified and all render sinks treat text literally, not as HTML', async () => {
  const view = mounted(() => response(diagnostic('ko', 'body_style_reference_pin_unavailable', 'unavailable')));
  const attack = '<img src=x onerror=steal()>LITERAL_QA_LABEL';
  view.api.copy.ko.quality = attack;
  await view.click();
  for (const key of ['profile', 'review']) {
    const row = metadata(view).children.find(node => node.children[0].textContent === view.api.copy.ko[key]);
    assert.equal(row.children[1].textContent, view.api.copy.ko.unverified);
  }
  assert.ok(view.host.textContent.includes(attack));
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'IFRAME', 'INPUT', 'TEXTAREA', 'A'].includes(node.tagName)).length, 0);
  const invalid = diagnostic(); invalid.secret = attack;
  const bad = mounted(() => response(invalid)); await bad.click();
  assert.equal(metadata(bad).children.length, 0); assert.equal(bad.host.textContent.includes(attack), false);
});

test('BODY-STYLE-REFERENCE: product/CSS enforce bounded text-only read and responsive 44px unframed controls', () => {
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|setInterval|setTimeout|\.json\(|\.text\(|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(source, /\/generate|\/approve|\/payments|\/auth\/refresh|console\.|createObjectURL/);
  assert.match(source, /maxBytes = 8 \* 1024/);
  assert.match(source, /new TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 44px/);
  assert.match(css, /width: 44px;\s*height: 44px/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)/); assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /letter-spacing: 0/); assert.match(css, /@media print/);
  assert.doesNotMatch(css, /box-shadow|linear-gradient|\d(?:vw|cqw)|min-width:\s*\d{3}px/);
});

test('BODY-STYLE-REFERENCE: entry and public manifest include exact versioned assets once and preserve sibling ordering', () => {
  const script = '<script src="/pages/creator-body-style-reference.js?v=body-style-reference-20261010"></script>';
  const sheet = '<link rel="stylesheet" href="/pages/creator-body-style-reference.css?v=body-style-reference-20261010" />';
  assert.equal(entry.split(script).length - 1, 1); assert.equal(entry.split(sheet).length - 1, 1);
  assert.equal((entry.match(/id="writerBodyStyleReference"/g) || []).length, 1);
  assert.match(entry, /<section id="writerBodyStyleReference" aria-labelledby="writerBodyStyleReferenceTitle"><\/section>/);
  const ids = ['writerBodyPreview', 'writerBodyLength', 'writerApprovedStyle', 'writerBodyStyleReference', 'writerBodyTrial', 'writerBodyReview'];
  const positions = ids.map(value => entry.indexOf('id="' + value + '"'));
  assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
  assert.ok(entry.indexOf('/pages/creator-approved-style.js?') < entry.indexOf('/pages/creator-body-style-reference.js?'));
  assert.ok(entry.indexOf('/pages/creator-body-style-reference.js?') < entry.indexOf('/pages/creator-body-trial.js?'));
  for (const path of ['pages/creator-body-style-reference.js', 'pages/creator-body-style-reference.css']) {
    assert.equal(manifest.files.filter(value => value === path).length, 1);
  }
});

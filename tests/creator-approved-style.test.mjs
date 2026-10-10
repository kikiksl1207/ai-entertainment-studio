import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-approved-style.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-approved-style.css', import.meta.url), 'utf8');
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const clone = v => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const style = (locale = 'ko') => ({
  version: 'story-author-approved-style-v1', sourceScope: 'latest_private_manuscript_completed_analysis', locale,
  manuscriptVersion: 2, analysisVersion: 3, profileVersion: 4, reviewRevision: 5,
  section: { key: 'writing_style', decision: 'accepted',
    value: { summary: 'FULL_SUMMARY_' + 's'.repeat(2000),
      observations: Array.from({ length: 5 }, (_, n) => ({ title: 'TITLE_' + n, detail: 'DETAIL_' + n + '_' + 'd'.repeat(1600) + '_TAIL_' + n, sourceRef: 'analysis:' + id(n + 10) })),
      categories: Array.from({ length: 7 }, (_, n) => ({ category: 'CATEGORY_' + n, observations: ['FIRST_' + n, 'MIDDLE_' + n + '_' + 'c'.repeat(900), 'TAIL_' + n] })),
      imitationBoundary: 'FULL_BOUNDARY_' + 'b'.repeat(1000) },
    evidence: [{ sourceType: 'manuscript', sourceRef: 'SYNTHETIC_REFERENCE', summary: '<img src=x onerror=not_a_real_action()>SYNTHETIC_EVIDENCE' }] },
  readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false, semanticQualityVerified: false
});
function response(value = style(), { status = 200, raw = JSON.stringify(value), chunks, length = null } = {}) {
  let index = 0;
  const stats = { reads: 0, cancelled: 0, released: 0 };
  const bytes = chunks || [new TextEncoder().encode(raw)];
  return { status, stats, headers: { get: name => name === 'content-length' ? length : null },
    body: { getReader: () => ({ read: async () => { stats.reads++; return index < bytes.length ? { value: bytes[index++], done: false } : { done: true }; },
      cancel: async () => { stats.cancelled++; }, releaseLock: () => { stats.released++; } }),
      cancel: async () => { stats.cancelled++; } },
    text: () => { throw new Error('Raw fallback is forbidden'); }, json: () => { throw new Error('JSON fallback is forbidden'); } };
}
function library(extra = {}) {
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController, ...extra });
  runInContext(source, vm); return { vm, api: vm.window.LuminaCreatorApprovedStyle };
}
function screen(handler = () => response(), onChange = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, work = id(1), language = 'ko', sourceLocale = 'ko', shown = true;
  const { api } = library(), calls = [], states = [];
  const controller = api.createController({ fetch: (url, options) => { calls.push({ url, options }); return handler(); },
    identity: () => owner, isCurrent: o => !!owner && o.ownerId === owner.ownerId && o.epoch === owner.epoch,
    context: () => ({ workId: work, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => { states.push(clone(state)); onChange(state); } });
  return { ...controller, api, calls, states, set: { owner: v => { owner = v; }, work: v => { work = v; }, language: v => { language = v; }, source: v => { sourceLocale = v; }, shown: v => { shown = v; } } };
}
const walk = el => [el, ...el.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase(); this.id = id; this.children = []; this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.hidden = false; this.value = ''; this._text = '';
    const classes = new Set(); this.classList = { contains: name => classes.has(name), add: name => classes.add(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); this._text = String(v); }
  setAttribute(n, v) { this.attributes[n] = String(v); }
  getAttribute(n) { return this.attributes[n] ?? null; }
  addEventListener(n, cb) { this.listeners.set(n, [...(this.listeners.get(n) || []), cb]); }
  fire(n, event = {}) { let result; for (const cb of this.listeners.get(n) || []) result = cb({ target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler = () => response()) {
  const window = new Element(), document = new Element(), shell = new Element('div', 'studioShell'), section = new Element('section', 'writer-manuscript');
  const host = new Element('section', 'writerApprovedStyle'), sibling = new Element('section', 'writerBodyPreview'), work = new Element('select', 'writerManuscriptWork'), locale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); locale.value = 'ko'; sibling.textContent = 'UNCHANGED_SIBLING'; section.append(work, locale, sibling, host); shell.append(section);
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => walk(shell).find(el => el.id === name) || null; document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', token = 'SYNTHETIC_TOKEN';
  const calls = [], observers = [];
  window.getAuth = () => ({ accessToken: token }); window.luminaI18n = { getLocale: () => language };
  window.LuminaCreatorStudioApi = { identity: () => owner, isCurrent: o => !!owner && o.ownerId === owner.ownerId && o.epoch === owner.epoch,
    fetch: (url, options) => { calls.push({ url, options }); return handler(); } };
  class MutationObserver { constructor(callback) { this.callback = callback; } observe(target) { observers.push({ target, callback: this.callback }); } }
  const { api } = library({ window, document, MutationObserver, fetch: () => { throw new Error('No global fetch'); } });
  return { api, window, document, shell, section, host, sibling, work, locale, calls,
    button: () => walk(host).find(el => el.tagName === 'BUTTON'), click: () => walk(host).find(el => el.tagName === 'BUTTON').fire('click'),
    owner: v => { owner = v; }, token: v => { token = v; }, language: v => { language = v; },
    mutate: target => { for (const o of observers.filter(o => o.target === target)) o.callback([]); } };
}

test('APPROVED-STYLE: parser preserves every approved observation/category middle and tail', () => {
  const input = style(), before = JSON.stringify(input), parsed = library().api.parseStyle(input);
  assert.deepEqual(clone(parsed), input); assert.equal(JSON.stringify(input), before);
  assert.equal(parsed.section.value.observations.length, 5); assert.equal(parsed.section.value.categories.length, 7);
  assert.ok(parsed.section.value.observations[4].detail.endsWith('_TAIL_4')); assert.equal(parsed.section.value.categories[6].observations[2], 'TAIL_6');
  parsed.section.value.summary = 'changed'; assert.equal(JSON.stringify(input), before);
});
test('APPROVED-STYLE: exact source/version/privacy flags reject unsupported contracts and alignment claims', () => {
  for (const change of [v => { v.version = 'v2'; }, v => { v.sourceScope = 'published_body'; }, v => { v.locale = 'zh'; },
    v => { v.manuscriptVersion = 0; }, v => { v.analysisVersion = '3'; }, v => { v.profileVersion = Infinity; }, v => { v.reviewRevision = Number.MAX_SAFE_INTEGER + 1; },
    v => { v.readOnly = false; }, v => { v.providerCalls = 1; }, v => { v.operatingWrites = 1; }, v => { v.bodySourceAligned = true; }, v => { v.semanticQualityVerified = true; },
    v => { v.workId = id(1); }, v => { delete v.section; }]) { const v = style(); change(v); assert.throws(() => library().api.parseStyle(v)); }
});
test('APPROVED-STYLE: invalid JSON bounds fail wholly without partial style', () => {
  for (const change of [v => { v.section.key = 'canon'; }, v => { v.section.decision = 'proposed'; },
    v => { v.section.value = null; }, v => { v.section.value = []; }, v => { v.section.value.summary = Infinity; },
    v => { v.section.value.summary = 'x'.repeat(8001); }, v => { v.section.value.observations = Array(201).fill('x'); },
    v => { v.section.value = Object.fromEntries(Array.from({ length: 101 }, (_, n) => ['key' + n, n])); },
    v => { v.section.value = JSON.parse('{"__proto__":"forbidden"}'); },
    v => { v.section.value.summary = Object.fromEntries([['constructor', 'forbidden']]); },
    v => { let nested = 'tail'; for (let i = 0; i < 9; i++) nested = { inner: nested }; v.section.value = nested; },
    v => { v.section.evidence[0].sourceType = 'secret'; }, v => { v.section.evidence[0].summary = ''; }]) {
    const v = style(); change(v); assert.throws(() => library().api.parseStyle(v));
  }
});
test('APPROVED-STYLE: previously approvable generic values retain exact keys and absent fields', () => {
  for (const value of [{ summary: 'summary only' }, { summary: '' }, {}, { summary: 42 }, { summary: null },
    { summary: { rhythm: ['slow', 'fast'] }, customRule: ['<img src=x>', true, null] },
    { observations: [{ title: 7, detail: null, custom: 'approved generic row' }], imitationBoundary: null }]) {
    const v = style(); v.section.value = value; const before = JSON.stringify(v);
    assert.deepEqual(clone(library().api.parseStyle(v)), v); assert.equal(JSON.stringify(v), before);
  }
});
test('APPROVED-STYLE: mounted summary-only style does not invent absent rules', async () => {
  const v = style(); v.section.value = { summary: 'ONLY_APPROVED_SUMMARY' };
  const view = mounted(() => response(v)); assert.equal(await view.click(), true);
  const dom = view.host.textContent; assert.ok(dom.includes(v.section.value.summary));
  assert.equal(dom.includes(view.api.copy.ko.observations), false);
  assert.equal(dom.includes(view.api.copy.ko.categories), false);
  assert.equal(dom.includes(view.api.copy.ko.boundary), false);
});
test('APPROVED-STYLE: mounted generic value renders the complete literal JSON safely', async () => {
  const v = style(); v.section.value = { custom: { rules: ['<img src=x onerror=not_a_real_action()>', 'MIDDLE', 'TAIL'] }, summary: 42 };
  const view = mounted(() => response(v)); assert.equal(await view.click(), true);
  const pre = walk(view.host).find(el => el.tagName === 'PRE');
  assert.equal(pre.textContent, JSON.stringify(v.section.value, null, 2));
  assert.equal(walk(view.host).some(el => el.tagName === 'IMG'), false);
  assert.equal(view.sibling.textContent, 'UNCHANGED_SIBLING');
});
test('APPROVED-STYLE: read is explicit GET, no-store, pinned identity, no refresh or paid fallback', async () => {
  const view = screen(); view.snapshot(); assert.equal(view.calls.length, 0); assert.equal(await view.load(), true);
  const { url, options } = view.calls[0]; assert.equal(url, '/api/v1/me/creator-studio/stories/' + id(1) + '/generation-profile/approved-style');
  assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.cache, 'no-store'); assert.equal(options._retried, true);
  assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 }); view.snapshot(); assert.equal(view.calls.length, 1);
});
test('APPROVED-STYLE: missing auth/work/locale/visibility never dispatch', async () => {
  for (const [key, value] of [['owner', null], ['owner', { ownerId: 'invalid', epoch: 1 }], ['owner', { ownerId: id(8), epoch: -1 }], ['work', '../unsafe'], ['work', ''], ['source', 'zh'], ['shown', false]]) {
    const view = screen(); view.set[key](value); assert.equal(await view.load(), false); assert.equal(view.calls.length, 0); assert.equal(view.snapshot().data, null);
  }
});
test('APPROVED-STYLE: duplicate explicit read stays single flight and snapshots are detached', async () => {
  const wait = deferred(), view = screen(() => wait.promise), first = view.load();
  assert.equal(await view.load(), false); assert.equal(view.calls.length, 1); wait.resolve(response()); assert.equal(await first, true);
  const read = view.snapshot(); read.data.section.value.summary = 'tampered'; assert.notEqual(view.snapshot().data.section.value.summary, 'tampered');
});
for (const [key, value] of [['owner', { ownerId: id(9), epoch: 2 }], ['work', id(2)], ['source', 'en'], ['language', 'ja'], ['shown', false]]) {
  test('APPROVED-STYLE: stale response after ' + key + ' switch cannot restore private style', async () => {
    const wait = deferred(), view = screen(() => wait.promise), first = view.load(); view.set[key](value); view.syncContext();
    wait.resolve(response()); assert.equal(await first, false); assert.equal(view.snapshot().data, null); assert.equal(view.calls.length, 1);
  });
}
test('APPROVED-STYLE: A-B-A and explicit same-work invalidation retain a fresh ticket', async () => {
  const wait = deferred(), view = screen(() => wait.promise), first = view.load();
  view.set.work(id(2)); view.syncContext(); view.set.work(id(1)); view.syncContext(); view.invalidate();
  wait.resolve(response()); assert.equal(await first, false); assert.equal(view.snapshot().data, null);
});
test('APPROVED-STYLE: old completion cannot unlock or overwrite a newer pending read', async () => {
  const old = deferred(), next = deferred(); let count = 0; const view = screen(() => (++count === 1 ? old.promise : next.promise));
  const first = view.load(); view.invalidate(); const second = view.load(); old.resolve(response()); assert.equal(await first, false);
  assert.equal(view.snapshot().busy, true); assert.equal(view.snapshot().data, null); next.resolve(response()); assert.equal(await second, true);
});
test('APPROVED-STYLE: oversized envelope rejects before read and wire bound does not trim approved rules', async () => {
  for (const length of ['196609', '-1', 'NaN']) { const res = response(style(), { length }), view = screen(() => res); assert.equal(await view.load(), false); assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1); }
  const res = response(null, { raw: ' '.repeat(196609) }), view = screen(() => res); assert.equal(await view.load(), false); assert.equal(res.stats.cancelled, 1); assert.equal(res.stats.released, 1);
});
test('APPROVED-STYLE: streaming UTF-8 accepts split multibytes and rejects malformed/truncated bytes', async () => {
  const v = style(); v.section.value.summary = '文体'; const bytes = new TextEncoder().encode(JSON.stringify(v));
  const accepted = screen(() => response(v, { chunks: Array.from(bytes, b => Uint8Array.of(b)) })); assert.equal(await accepted.load(), true);
  for (const chunk of [Uint8Array.of(0xff), Uint8Array.of(0xe3, 0x81)]) { const res = response(null, { chunks: [chunk] }), view = screen(() => res); assert.equal(await view.load(), false); assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(res.stats.cancelled, 1); }
});
test('APPROVED-STYLE: HTTP 401/403/404/409/503 cancel and never retry or create a draft', async () => {
  for (const status of [401, 403, 404, 409, 503]) { const res = response(null, { status }), view = screen(() => res); assert.equal(await view.load(), false); assert.equal(view.calls.length, 1); assert.equal(res.stats.reads, 0); assert.equal(res.stats.cancelled, 1); assert.equal(view.snapshot().data, null); }
});
test('APPROVED-STYLE: bad JSON, null response and hostile error never expose transport strings', async () => {
  const sentinel = 'PRIVATE_TRANSPORT_ERROR';
  for (const handler of [() => response(null, { raw: '{bad' }), () => null, () => { throw Object.assign(new Error(sentinel), { kind: 'loaded' }); }]) {
    const view = screen(handler); assert.equal(await view.load(), false); assert.equal(view.snapshot().data, null); assert.equal(JSON.stringify(view.states).includes(sentinel), false);
  }
});
test('APPROVED-STYLE: actual mounted IIFE is read-only and renders full rows with textContent', async () => {
  const view = mounted(); assert.equal(view.calls.length, 0); assert.equal(view.api.mount(view.host), null);
  assert.equal(await view.click(), true); assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.token, 'SYNTHETIC_TOKEN');
  assert.equal(view.calls[0].options._retried, true); assert.equal(view.sibling.textContent, 'UNCHANGED_SIBLING');
  const dom = view.host.textContent; const v = style().section.value;
  for (const row of v.observations) { assert.ok(dom.includes(row.title)); assert.ok(dom.includes(row.detail)); }
  for (const row of v.categories) for (const item of row.observations) assert.ok(dom.includes(item));
  assert.ok(dom.includes(v.imitationBoundary)); assert.ok(dom.includes('<img src=x onerror=not_a_real_action()>SYNTHETIC_EVIDENCE'));
  assert.equal(walk(view.host).filter(el => el.tagName === 'IMG').length, 0);
});
for (const name of ['storage', 'lumina:authchange', 'creator:manuscript-accepted', 'lumina:author-body-trial-progress-changed', 'pagehide']) {
  test('APPROVED-STYLE: mounted ' + name + ' clears private rows without automatic GET', async () => {
    const view = mounted(); await view.click(); view.window.fire(name); assert.equal(view.calls.length, 1);
    assert.equal(view.host.textContent.includes('FULL_SUMMARY_'), false); assert.equal(view.sibling.textContent, 'UNCHANGED_SIBLING');
  });
}
test('APPROVED-STYLE: absent token and token-getter account switch do not dispatch', async () => {
  const absent = mounted(); absent.token(null); assert.equal(await absent.click(), false); assert.equal(absent.calls.length, 0);
  const moved = mounted(); moved.window.getAuth = () => { moved.owner({ ownerId: id(9), epoch: 2 }); return { accessToken: 'SYNTHETIC_OTHER_TOKEN' }; };
  assert.equal(await moved.click(), false); assert.equal(moved.calls.length, 0);
});
test('APPROVED-STYLE: locale/selection/tab/visibility invalidation preserves sibling panes', async () => {
  const view = mounted(); await view.click(); view.work.value = id(2); view.work.fire('change');
  assert.equal(view.host.textContent.includes('FULL_SUMMARY_'), false); assert.equal(view.calls.length, 1);
  await view.click(); view.language('en'); view.window.fire('lumina:localechange'); assert.equal(view.host.textContent.includes('FULL_SUMMARY_'), false);
  await view.click(); view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); assert.equal(view.host.textContent.includes('FULL_SUMMARY_'), false);
  assert.equal(view.sibling.textContent, 'UNCHANGED_SIBLING');
});
for (const language of locales) {
  test('APPROVED-STYLE: ' + language + ' copy keeps manuscript language separate from UI language', async () => {
    const view = mounted(); view.language(language); view.window.fire('lumina:localechange'); assert.equal(await view.click(), true);
    assert.equal(view.host.lang, language); assert.ok(view.host.textContent.includes('한국어')); assert.ok(view.host.textContent.includes(view.api.copy[language].title));
    assert.equal(view.calls[0].url.includes('?locale='), false);
  });
}
test('APPROVED-STYLE: source and CSS remain scoped, unframed, fixed-size and text-only', () => {
  const { api } = library(); const keys = Object.keys(api.copy.ko).sort();
  for (const language of locales) assert.deepEqual(Object.keys(api.copy[language]).sort(), keys);
  assert.equal(source.includes('innerHTML'), false); assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('.slice('), false); assert.equal(source.includes('getOrCreate'), false);
  assert.match(css, /width: 44px; height: 44px/); assert.match(css, /max-width: 720px/); assert.match(css, /white-space: pre-wrap/);
});

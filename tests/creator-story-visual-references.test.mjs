import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-story-visual-references.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const finalize = readFileSync(new URL('../pages/creator-story-finalize.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../creator-story-visual-references.css', import.meta.url), 'utf8');
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptVersionId = '22222222-2222-4222-8222-222222222222';
const analysisJobId = '33333333-3333-4333-8333-333333333333';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {};
    this.attributes = {}; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  get options() { return this.children; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  async fire(name) { for (const callback of this.listeners[name] || []) await callback({ target: this }); }
  focus() { this.document.activeElement = this; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(node =>
      selector === '*' || (selector === 'button' && node.tagName === 'BUTTON') ||
      (selector === '[data-vr-copy]' && node.dataset.vrCopy));
  }
}

function fixture({ total = 17, legacy = false, promptText = '<img src=x onerror=alert(1)>\nFull synthetic prompt', textLength = 12030, prose, guidanceOrigin } = {}) {
  const root = new Element(); root.id = 'writerVisualReferences';
  const modal = new Element(); modal.id = 'writerFinalModal';
  const nodes = () => [root, modal, ...root.querySelectorAll('*')];
  const documentListeners = {};
  const document = { documentElement: { lang: 'ko' }, activeElement: null,
    getElementById: id => nodes().find(node => node.id === id),
    createElement: tag => { const node = new Element(tag); node.document = document; return node; },
    addEventListener: (event, callback) => { (documentListeners[event] ||= []).push(callback); } };
  const active = { workId, manuscriptVersionId, analysisJobId, identity: { ownerId: 'synthetic-author', epoch: 2 } };
  let completed = clone(active);
  const snapshot = { workId, manuscriptVersionId, analysisJobId, manuscriptHash: 'a'.repeat(64),
    parts: [{ partKey: 'p1', title: 'Synthetic part' }], importedVisualReferences: {
      contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only', requiresSceneReview: true,
      ...(guidanceOrigin === undefined ? {} : { guidanceOrigin }),
      manuscriptHash: 'a'.repeat(64), checksum: 'b'.repeat(64), totalReferences: total,
      mappedReferences: legacy ? 0 : total, mappingState: legacy ? 'unmapped_legacy' : 'exact_source_segments',
      items: [{ promptExcerpt: 'DO_NOT_RENDER_PREVIEW_TEXT' }], truncated: total > 8 } };
  const windowListeners = {};
  const intervals = new Map();
  let intervalId = 0;
  let observer;
  let locale = 'ko';
  let identityCurrent = true;
  let intercept = null;
  const calls = [];
  const readerText = prose ?? ('SYNTHETIC_PROSE_' + 'x'.repeat(Math.max(0, textLength - 16)));
  const row = index => ({ referenceIndex: index, sourceSceneKey: `original.scene-${index}`, promptSha256: hash(promptText),
    partKey: legacy ? null : 'p1', partTitle: legacy ? null : 'Synthetic part', segmentCount: legacy ? 0 : 2 });
  const base = contract => ({ contract, workId, manuscriptVersionId, manuscriptHash: snapshot.manuscriptHash,
    ...(snapshot.importedVisualReferences.guidanceOrigin === undefined ? {} : { guidanceOrigin: snapshot.importedVisualReferences.guidanceOrigin }),
    checksum: snapshot.importedVisualReferences.checksum, approvalState: 'reference_only', requiresSceneReview: true,
    mappingState: snapshot.importedVisualReferences.mappingState });
  function dataFor(url) {
    const path = new URL(url, 'http://fixture');
    const isList = path.pathname.endsWith('/visual-references');
    if (isList) {
      const offset = Number(path.searchParams.get('offset'));
      const items = Array.from({ length: Math.min(8, total - offset) }, (_, index) => row(offset + index));
      return { ...base('publication-visual-reference-page-v1'), offset, totalReferences: total,
        nextOffset: offset + items.length < total ? offset + items.length : null, items };
    }
    const index = Number(path.pathname.split('/').at(-1));
    const textOffset = Number(path.searchParams.get('textOffset'));
    let end = Math.min(textOffset + 6000, readerText.length);
    if (end < readerText.length && /[\uD800-\uDBFF]/u.test(readerText[end - 1]) && /[\uDC00-\uDFFF]/u.test(readerText[end])) end--;
    return { ...base('publication-visual-reference-detail-v1'), referenceIndex: index, sourceSceneKey: row(index).sourceSceneKey,
      promptSha256: hash(promptText), promptText, reader: legacy ? null : { partKey: 'p1', partTitle: 'Synthetic part', segmentCount: 2,
        text: readerText.slice(textOffset, end), textOffset, totalTextLength: readerText.length,
        nextTextOffset: end < readerText.length ? end : null } };
  }
  const response = (data, status = 200) => ({ ok: status === 200, status, json: async () => clone(data) });
  const window = { crypto: webcrypto, luminaI18n: { getLocale: () => locale },
    LuminaCreatorAnalysis: { completed: () => completed },
    LuminaCreatorStudioApi: { isCurrent: identity => identityCurrent && identity.ownerId === completed?.identity?.ownerId &&
      identity.epoch === completed?.identity?.epoch,
      fetch: async (url, options) => {
        calls.push({ url, ...options });
        const data = dataFor(url);
        return intercept ? intercept(data, url, options) : response(data);
      } }, addEventListener: (event, callback) => { (windowListeners[event] ||= []).push(callback); } };
  vm.runInNewContext(script, { window, document, URLSearchParams, AbortController, TextEncoder, Uint8Array,
    setInterval: callback => { intervals.set(++intervalId, callback); return intervalId; }, clearInterval: id => intervals.delete(id),
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} } });
  const get = id => document.getElementById('writerVisualReferences' + id);
  const show = () => window.LuminaCreatorVisualReferences.show(snapshot, active);
  const click = name => get(name).fire('click');
  const dispatch = async event => { for (const callback of windowListeners[event] || []) await callback({}); };
  return { root, modal, window, document, active, snapshot, calls, get, show, click, dataFor, response,
    setIntercept: callback => { intercept = callback; },
    complete: value => { completed = value; }, completed: () => completed,
    expire: () => { identityCurrent = false; },
    tick: () => { for (const callback of [...intervals.values()]) callback(); },
    hide: () => { modal.classList.add('is-hidden'); observer(); },
    dispatch, locale: async value => { locale = value; await dispatch('lumina:localechange'); },
    reset: () => window.LuminaCreatorVisualReferences.reset() };
}

test('integration is scoped, read-only, lazy and includes select/text keyboard surfaces', () => {
  assert.match(html, /<section id="writerVisualReferences" hidden aria-labelledby="writerVisualReferencesTitle"><\/section>/);
  assert.match(html, /href="\/creator-story-visual-references\.css/);
  assert.ok(html.indexOf('/pages/creator-story-visual-references.js') < html.indexOf('/pages/creator-story-finalize.js'));
  assert.match(finalize, /LuminaCreatorVisualReferences\?\.show\(snapshot, active\)/);
  assert.ok((finalize.match(/LuminaCreatorVisualReferences\?\.reset\(\)/g) || []).length >= 4);
  assert.match(finalize, /select:not\(:disabled\)/);
  assert.match(finalize, /\[tabindex='0'\]/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-width: 640px/);
});

test('standalone browser fixture bootstrap compiles without launching a browser or server', () => {
  const source = readFileSync(new URL('./creator-story-visual-references.browser.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const bootstrap = `');
  const end = source.indexOf('\nfunction fixtureServer()', start);
  assert.ok(start >= 0 && end > start);
  const bootstrap = vm.runInNewContext(source.slice(start, end) + '\nbootstrap;', {
    workId, manuscriptId: manuscriptVersionId, analysisId: analysisJobId, promptText: 'Synthetic prompt',
    promptSha256: hash('Synthetic prompt'), prose: 'Synthetic prose', partTitle: 'Synthetic part'
  });
  assert.doesNotThrow(() => new vm.Script(bootstrap));
});

test('snapshot open shows metadata only; opening loads eight rows and bounded full detail', async () => {
  const f = fixture(); f.show();
  assert.equal(f.root.hidden, false);
  assert.match(f.get('Metadata').textContent, /17/);
  assert.match(f.get('Notice').textContent, /승인/);
  assert.equal(f.get('Viewer').hidden, true);
  assert.equal(f.calls.length, 0);
  assert.ok(!f.root.textContent.includes('DO_NOT_RENDER_PREVIEW_TEXT'));
  await f.click('Open');
  assert.equal(f.calls.length, 2);
  assert.equal(f.get('Select').options.length, 8);
  assert.equal(f.get('Select').options[0].textContent, '1. Synthetic part');
  assert.ok(!f.get('Select').options[0].textContent.includes('original.scene'));
  assert.equal(f.get('Prompt').textContent, '<img src=x onerror=alert(1)>\nFull synthetic prompt');
  assert.equal(f.get('Prompt').children.length, 0);
  assert.equal(f.get('Reader').textContent.length, 6000);
  assert.equal(f.get('PageNote').hidden, false);
  for (const call of f.calls) {
    const url = new URL(call.url, 'http://fixture');
    assert.equal(call.method, 'GET');
    assert.equal(call.identity.ownerId, f.active.identity.ownerId);
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(url.searchParams.get('expectedManuscriptHash'), 'a'.repeat(64));
    assert.equal(url.searchParams.get('expectedSourceChecksum'), 'b'.repeat(64));
    assert.match(url.pathname, new RegExp(`/stories/${workId}/linear-draft/${manuscriptVersionId}/visual-references`));
  }
  f.show();
  assert.equal(f.calls.length, 2);
  assert.equal(f.get('Prompt').textContent.length > 0, true);
});

test('absent, missing, inconsistent or unverifiable snapshot metadata fails closed', () => {
  const mutations = [
    f => { delete f.snapshot.importedVisualReferences; },
    f => { delete f.active.identity.epoch; },
    f => { f.active.workId = 'not-an-id'; },
    f => { f.snapshot.analysisJobId = workId; },
    f => { f.snapshot.workId = manuscriptVersionId; },
    f => { f.snapshot.importedVisualReferences.contract = 'other'; },
    f => { f.snapshot.importedVisualReferences.checksum = 'missing'; },
    f => { f.snapshot.importedVisualReferences.manuscriptHash = 'c'.repeat(64); },
    f => { f.snapshot.importedVisualReferences.approvalState = 'approved'; },
    f => { f.snapshot.importedVisualReferences.requiresSceneReview = false; },
    f => { f.snapshot.importedVisualReferences.totalReferences = 2001; },
    f => { f.snapshot.importedVisualReferences.totalReferences = 1.2; },
    f => { f.snapshot.importedVisualReferences.mappedReferences = 0; },
    f => { f.snapshot.importedVisualReferences.mappingState = 'guessed'; },
    f => { f.active.manuscriptHash = 'c'.repeat(64); f.complete(clone(f.active)); },
    f => { f.expire(); }, f => { f.hide(); }
  ];
  mutations.forEach(mutate => {
    const f = fixture(); mutate(f); f.show();
    assert.equal(f.root.hidden, true, mutate.toString());
    assert.equal(f.calls.length, 0);
    assert.equal(f.get('Prompt').textContent, '');
  });
});

test('reference pages use explicit next/previous offsets and selecting a row starts at text offset zero', async () => {
  const f = fixture(); f.show(); await f.click('Open');
  await f.click('ListNext'); assert.equal(f.get('Select').options.length, 8);
  assert.equal(f.get('Select').value, '8');
  await f.click('ListNext'); assert.equal(f.get('Select').options.length, 1);
  assert.equal(f.get('ListNext').disabled, true);
  await f.click('ListPrev'); await f.click('ListPrev');
  assert.equal(f.get('ListPrev').disabled, true);
  const offsets = f.calls.filter(call => new URL(call.url, 'http://fixture').searchParams.has('offset'))
    .map(call => Number(new URL(call.url, 'http://fixture').searchParams.get('offset')));
  assert.deepEqual(offsets, [0, 8, 16, 8, 0]);
  f.get('Select').value = '3'; await f.get('Select').fire('change');
  assert.equal(f.get('SceneKey').textContent, 'original.scene-3');
  assert.equal(new URL(f.calls.at(-1).url, 'http://fixture').searchParams.get('textOffset'), '0');
});

test('prose pages stay bounded at 6000 UTF-16 units with explicit offsets and retain the full prompt', async () => {
  const fullPrompt = 'Full prompt '.repeat(2667).slice(0, 32000);
  const f = fixture({ promptText: fullPrompt }); f.show(); await f.click('Open');
  assert.equal(f.get('Prompt').textContent, fullPrompt);
  await f.click('TextNext');
  assert.equal(f.get('Reader').textContent.length, 6000);
  assert.equal(f.get('TextPrev').disabled, false);
  await f.click('TextNext');
  assert.equal(f.get('Reader').textContent.length, 30);
  assert.equal(f.get('TextNext').disabled, true);
  assert.equal(f.get('Prompt').textContent, fullPrompt);
  await f.locale('en');
  assert.equal(f.get('TextRange').textContent, 'Prose page 3 · Last page');
  await f.click('TextPrev'); await f.click('TextPrev');
  assert.equal(f.get('TextPrev').disabled, true);
  assert.equal(f.get('TextRange').textContent, 'Prose page 1');
  assert.deepEqual(f.calls.filter(call => call.url.includes('textOffset')).map(call =>
    Number(new URL(call.url, 'http://fixture').searchParams.get('textOffset'))), [0, 6000, 12000, 6000, 0]);
});

test('surrogate-safe prose chunks follow returned UTF-16 offsets rather than multiples of 6000', async () => {
  const prose = 'x'.repeat(5999) + '\u{1F30C}' + 'z'.repeat(6010);
  const f = fixture({ prose }); f.show(); await f.click('Open');
  assert.equal(f.get('Reader').textContent.length, 5999);
  await f.click('TextNext');
  assert.ok(f.get('Reader').textContent.startsWith('\u{1F30C}'));
  assert.equal(f.get('Reader').textContent.length, 6000);
  await f.click('TextNext');
  assert.equal(f.get('Reader').textContent.length, 12);
  await f.click('TextPrev'); await f.click('TextPrev');
  assert.deepEqual(f.calls.filter(call => call.url.includes('textOffset')).map(call =>
    Number(new URL(call.url, 'http://fixture').searchParams.get('textOffset'))), [0, 5999, 11999, 5999, 0]);
});

test('legacy references show only the full prompt, without guessed source prose', async () => {
  const f = fixture({ legacy: true }); f.show(); await f.click('Open');
  assert.equal(f.get('Columns').hidden, false);
  assert.equal(f.get('Prompt').textContent.length > 0, true);
  assert.equal(f.get('Unmapped').hidden, false);
  assert.equal(f.get('Reader').hidden, true);
  assert.equal(f.get('Reader').textContent, '');
  assert.equal(f.get('TextPager').hidden, true);
  assert.equal(f.get('TextNext').disabled, true);
});

test('a verified title-only mapped range has localized no-prose warnings, not review or approval', async () => {
  const f = fixture({ prose: '' }); f.show(); await f.click('Open');
  assert.equal(f.get('Prompt').textContent.length > 0, true);
  assert.equal(f.get('Columns').hidden, false);
  assert.equal(f.get('Reader').textContent, '');
  assert.equal(f.get('Reader').hidden, true);
  assert.equal(f.get('Unmapped').hidden, true);
  assert.equal(f.get('TextPager').hidden, true);
  assert.equal(f.get('TextRange').textContent, '');
  assert.equal(f.get('TextNext').disabled, true);
  const warnings = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale);
    assert.equal(f.get('NoProse').hidden, false);
    warnings.add(f.get('NoProse').textContent);
  }
  assert.equal(warnings.size, 5);
  assert.equal(f.calls.length, 2);
  assert.equal(f.snapshot.importedVisualReferences.approvalState, 'reference_only');
  assert.equal(f.snapshot.importedVisualReferences.requiresSceneReview, true);
  for (const mutate of [d => { d.reader.text = 'unexpected'; }, d => { d.reader.nextTextOffset = 0; }, d => { d.reader.textOffset = 1; }]) {
    const invalid = fixture({ prose: '' });
    invalid.setIntercept((data, url) => { if (url.includes('textOffset')) mutate(data); return invalid.response(data); });
    invalid.show(); await invalid.click('Open');
    assert.equal(invalid.get('Prompt').textContent, '');
    assert.match(invalid.get('Status').textContent, /검증/);
  }
});

test('valid long reader ranges can navigate beyond 2.5M units using safe returned offsets', async () => {
  const f = fixture();
  f.setIntercept((data, url) => {
    if (url.includes('textOffset')) {
      const offset = Number(new URL(url, 'http://fixture').searchParams.get('textOffset'));
      const total = 3000001;
      const length = Math.min(6000, total - offset);
      Object.assign(data.reader, { text: 'x'.repeat(length), textOffset: offset, totalTextLength: total,
        nextTextOffset: offset + length < total ? offset + length : null });
    }
    return f.response(data);
  });
  f.show(); await f.click('Open');
  for (let page = 0; page < 417; page++) await f.click('TextNext');
  assert.equal(new URL(f.calls.at(-1).url, 'http://fixture').searchParams.get('textOffset'), '2502000');
  assert.equal(f.get('Reader').textContent.length, 6000);
  assert.equal(f.get('Columns').hidden, false);
  await f.click('TextPrev');
  assert.equal(new URL(f.calls.at(-1).url, 'http://fixture').searchParams.get('textOffset'), '2496000');
});

test('list contracts enforce exact identities, indices, keys, counts, mapping and pagination bounds', async () => {
  const mutations = [
    d => { d.contract = 'other'; }, d => { d.workId = manuscriptVersionId; }, d => { d.manuscriptVersionId = workId; },
    d => { d.checksum = 'c'.repeat(64); }, d => { d.manuscriptHash = 'd'.repeat(64); },
    d => { d.approvalState = 'approved'; }, d => { d.requiresSceneReview = false; }, d => { d.mappingState = 'unmapped_legacy'; },
    d => { d.totalReferences++; }, d => { d.offset = 1; }, d => { d.nextOffset = 9; },
    d => { d.items.push(d.items[0]); }, d => { d.items.pop(); }, d => { d.items[0].referenceIndex = 1; },
    d => { d.items[1].sourceSceneKey = d.items[0].sourceSceneKey; }, d => { d.items[0].sourceSceneKey = '<script>'; },
    d => { d.items[0].sourceSceneKey = 1; },
    d => { d.items[0].promptSha256 = 'x'.repeat(64); }, d => { d.items[0].partKey = 'other'; },
    d => { d.items[0].partTitle = 'Other'; }, d => { d.items[0].segmentCount = 0; }, d => { d.items[0].segmentCount = 1001; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.setIntercept((data, url) => { if (!url.includes('textOffset')) mutate(data); return f.response(data); });
    f.show(); await f.click('Open');
    assert.equal(f.calls.length, 1, mutate.toString());
    assert.equal(f.get('Prompt').textContent, '');
    assert.equal(f.get('Viewer').hidden, true);
    assert.match(f.get('Status').textContent, /검증/);
  }
});

test('details fail closed on mismatched identities, hashes, mapping or UTF-16 bounds', async () => {
  const mutations = [
    d => { d.contract = 'other'; }, d => { d.workId = manuscriptVersionId; }, d => { d.manuscriptVersionId = workId; },
    d => { d.checksum = 'c'.repeat(64); }, d => { d.manuscriptHash = 'c'.repeat(64); },
    d => { d.referenceIndex = 1; }, d => { d.sourceSceneKey = 'wrong'; }, d => { d.promptSha256 = 'c'.repeat(64); },
    d => { d.promptText += 'tampered'; }, d => { d.promptText = 'x'.repeat(32001); }, d => { d.promptText += '\0'; },
    d => { d.reader = null; }, d => { d.approvalState = 'approved'; }, d => { d.requiresSceneReview = false; },
    d => { d.reader.partKey = 'wrong'; }, d => { d.reader.partTitle = 'Wrong'; }, d => { d.reader.segmentCount++; },
    d => { d.reader.textOffset = 1; }, d => { d.reader.text += 'x'; }, d => { d.reader.text = ''; },
    d => { d.reader.text = d.reader.text.slice(2); }, d => { d.reader.nextTextOffset = 5999; },
    d => { d.reader.totalTextLength = 1.5; }, d => { d.reader.totalTextLength = 5999; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.setIntercept((data, url) => { if (url.includes('textOffset')) mutate(data); return f.response(data); });
    f.show(); await f.click('Open');
    assert.equal(f.get('Prompt').textContent, '', mutate.toString());
    assert.equal(f.get('Reader').textContent, '');
    assert.equal(f.get('Viewer').hidden, true);
    assert.match(f.get('Status').textContent, /검증/);
  }
  const legacy = fixture({ legacy: true });
  legacy.setIntercept((data, url) => { if (url.includes('textOffset')) data.reader = { text: 'INFERRED_PROSE' }; return legacy.response(data); });
  legacy.show(); await legacy.click('Open');
  assert.equal(legacy.get('Prompt').textContent, '');
});

test('changing total prose length across pages discards previously displayed prompt and prose', async () => {
  const f = fixture(); f.show(); await f.click('Open');
  f.setIntercept((data, url) => { if (url.includes('textOffset')) data.reader.totalTextLength++; return f.response(data); });
  await f.click('TextNext');
  assert.equal(f.get('Prompt').textContent, '');
  assert.equal(f.get('Reader').textContent, '');
  assert.match(f.get('Status').textContent, /검증/);
});

test('loading/errors/retry, no references and 404/409 fail closed without diagnostic text', async () => {
  for (const detailFailure of [false, true]) {
    const f = fixture(); let fail = true;
    f.setIntercept((data, url) => {
      if (fail && url.includes('textOffset') === detailFailure) { fail = false; return f.response({ message: 'PRIVATE_DIAGNOSTIC' }, 503); }
      return f.response(data);
    });
    f.show(); await f.click('Open');
    assert.equal(f.get('Retry').hidden, false);
    assert.equal(f.get('Prompt').textContent, '');
    assert.ok(!f.root.textContent.includes('PRIVATE_DIAGNOSTIC'));
    await f.click('Retry'); assert.equal(f.get('Prompt').textContent.length > 0, true);
  }
  for (const status of [404, 409, 401, 403]) {
    const f = fixture(); f.setIntercept(data => f.response(data, status)); f.show(); await f.click('Open');
    assert.equal(f.get('Viewer').hidden, true);
    assert.equal(f.get('Prompt').textContent, '');
    assert.equal(f.get('Retry').hidden, true);
    if (status === 401 || status === 403) assert.equal(f.root.hidden, true);
  }
  const empty = fixture({ total: 0 }); empty.show();
  assert.equal(empty.get('Open').hidden, true);
  assert.match(empty.get('Status').textContent, /없습니다/);
  assert.equal(empty.calls.length, 0);
});

test('token/account/work/manuscript/analysis/hash/source changes clear displayed text without another request', async () => {
  const mutations = [
    f => { f.expire(); }, f => { f.completed().identity.epoch++; }, f => { f.completed().identity.ownerId = 'other'; },
    f => { f.completed().workId = manuscriptVersionId; }, f => { f.completed().manuscriptVersionId = workId; },
    f => { f.completed().analysisJobId = workId; }, f => { f.complete(null); },
    f => { f.completed().manuscriptHash = 'c'.repeat(64); },
    f => { f.snapshot.manuscriptHash = 'c'.repeat(64); },
    f => { f.snapshot.importedVisualReferences.checksum = 'c'.repeat(64); },
    f => { f.snapshot.importedVisualReferences.mappingState = 'unmapped_legacy'; },
    f => { f.snapshot.importedVisualReferences.totalReferences++; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); f.show(); await f.click('Open'); mutate(f); f.tick();
    assert.equal(f.root.hidden, true, mutate.toString());
    assert.equal(f.get('Prompt').textContent, '');
    assert.equal(f.get('Reader').textContent, '');
    assert.equal(f.calls.length, 2);
  }
});

test('reset and close/reopen abort late list/detail responses even if the transport ignores its signal', async () => {
  for (const detailPending of [false, true]) {
    const f = fixture(); let resolve;
    const deferred = new Promise(done => { resolve = done; });
    let pendingData;
    f.setIntercept((data, url) => {
      if (url.includes('textOffset') === detailPending) { pendingData = data; return deferred; }
      return f.response(data);
    });
    f.show(); const opening = f.click('Open');
    while (!pendingData) await new Promise(done => setImmediate(done));
    assert.equal(f.get('Select').disabled, true);
    const signal = f.calls.at(-1).signal;
    f.hide();
    assert.equal(signal.aborted, true);
    f.modal.classList.remove('is-hidden');
    f.show();
    resolve(f.response(pendingData)); await opening;
    assert.equal(f.root.hidden, false);
    assert.equal(f.get('Viewer').hidden, true);
    assert.equal(f.get('Prompt').textContent, '');
    assert.equal(f.get('Reader').textContent, '');
    f.setIntercept(null); await f.click('Open');
    assert.equal(f.get('Prompt').textContent.length > 0, true);
    await f.dispatch('pagehide'); assert.equal(f.get('Prompt').textContent, '');
  }
});

test('a late response after identity or source invalidation cannot render old text', async () => {
  for (const change of ['identity', 'source', 'manuscript']) {
    const f = fixture(); let resolve; let old;
    f.setIntercept(data => { old = data; return new Promise(done => { resolve = done; }); });
    f.show(); const opening = f.click('Open');
    assert.equal(f.calls.length, 1);
    if (change === 'identity') f.completed().identity.epoch++;
    else if (change === 'source') f.snapshot.importedVisualReferences.checksum = 'c'.repeat(64);
    else f.completed().manuscriptVersionId = workId;
    resolve(f.response(old)); await opening;
    assert.equal(f.root.hidden, true);
    assert.equal(f.get('Select').options.length, 0);
    assert.equal(f.get('Prompt').textContent, '');
  }
});

test('five locales update labels and page-only/unapproved notices without refetching or altering raw text', async () => {
  const f = fixture(); f.show(); await f.click('Open');
  const raw = f.get('Prompt').textContent;
  const titles = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale);
    titles.add(f.get('Title').textContent);
    assert.equal(f.get('Prompt').textContent, raw);
    assert.equal(f.get('Notice').textContent.length > 0, true);
    assert.equal(f.get('PageNote').textContent.length > 0, true);
    assert.doesNotMatch(f.get('TextRange').textContent, /UTF-16|6000|12030/);
    assert.equal(f.get('Label').attributes.for, 'writerVisualReferencesSelect');
  }
  assert.equal(titles.size, 5);
  assert.equal(f.calls.length, 2);
});

test('proposed guidance uses distinct localized labels without changing manuscript data or raw guidance', async () => {
  const proposed = fixture({ total: 1, guidanceOrigin: 'manuscript_proposal' });
  const imported = fixture({ total: 1 });
  const before = clone(proposed.snapshot);
  proposed.show(); await proposed.click('Open'); imported.show(); await imported.click('Open');
  const expected = {
    ko: ['제안된 장면 시각 가이드', '제안된 장면 가이드', '제안 가이드 전체', '제안'],
    en: ['Proposed Scene Visual Guidance', 'Proposed scene guidance', 'Full proposed guidance', 'proposed'],
    ja: ['提案されたシーンのビジュアルガイド', '提案されたシーンガイド', '提案ガイド全文', '提案'],
    'zh-Hans': ['建议的场景视觉指南', '建议的场景指南', '建议指南全文', '建议'],
    'zh-Hant': ['建議的場景視覺指南', '建議的場景指南', '建議指南全文', '建議']
  };
  for (const [locale, [title, label, prompt, marker]] of Object.entries(expected)) {
    await proposed.locale(locale); await imported.locale(locale);
    assert.equal(proposed.get('Title').textContent, title);
    assert.equal(proposed.get('Label').textContent, label);
    assert.equal(proposed.get('PromptTitle').textContent, prompt);
    for (const name of ['Title', 'Label', 'PromptTitle', 'Open', 'Notice', 'Metadata', 'ListPrev', 'ListNext', 'ListRange']) {
      assert.notEqual(proposed.get(name).textContent, imported.get(name).textContent, `${locale}/${name}`);
      assert.ok(proposed.get(name).textContent.toLowerCase().includes(marker), `${locale}/${name}`);
    }
    assert.equal(proposed.get('Prompt').textContent, imported.get('Prompt').textContent);
    assert.equal(proposed.get('Reader').textContent, imported.get('Reader').textContent);
    assert.equal(proposed.get('PageNote').textContent, imported.get('PageNote').textContent);
    assert.doesNotMatch(proposed.get('Notice').textContent, /automatic|generated|approved automatically/i);
  }
  await proposed.locale('en');
  assert.match(proposed.get('Notice').textContent, /review and visual approval are still required/);
  assert.equal(proposed.calls.length, 2);
  assert.ok(proposed.calls.every(call => call.method === 'GET'));
  assert.deepEqual(proposed.snapshot, before);
  const empty = fixture({ total: 0, guidanceOrigin: 'manuscript_proposal' }); empty.show(); await empty.locale('en');
  assert.equal(empty.get('Status').textContent, 'No proposed scene guidance for this manuscript.');
});

test('missing and explicit imported origins remain interchangeable on preview, page and detail responses', async () => {
  for (const guidanceOrigin of [undefined, 'imported_reference']) {
    const f = fixture({ total: 1, guidanceOrigin });
    f.setIntercept(data => {
      if (guidanceOrigin === undefined) data.guidanceOrigin = 'imported_reference';
      else delete data.guidanceOrigin;
      return f.response(data);
    });
    f.show(); await f.click('Open'); await f.locale('en');
    assert.equal(f.get('Title').textContent, 'Original Scene Visual References');
    assert.equal(f.get('PromptTitle').textContent, 'Full original prompt');
    assert.equal(f.get('Columns').hidden, false);
    assert.equal(f.calls.length, 2);
  }
});

test('unknown guidance origins fail closed on preview, page and detail, and proposal responses must match origin', async () => {
  const unknown = ['unknown', '', null, false, 0, {}, [], 'Manuscript_proposal'];
  for (const guidanceOrigin of unknown) {
    const f = fixture({ guidanceOrigin }); f.show();
    assert.equal(f.root.hidden, true, JSON.stringify(guidanceOrigin));
    assert.equal(f.calls.length, 0);
  }
  for (const origin of [undefined, 'imported_reference', 'manuscript_proposal']) {
    const rejected = [...unknown, origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal'];
    if (origin === 'manuscript_proposal') rejected.push(undefined);
    for (const detail of [false, true]) for (const guidanceOrigin of rejected) {
      const f = fixture({ total: 1, guidanceOrigin: origin });
      f.setIntercept((data, url) => {
        if (url.includes('textOffset') === detail) {
          if (guidanceOrigin === undefined) delete data.guidanceOrigin;
          else data.guidanceOrigin = guidanceOrigin;
        }
        return f.response(data);
      });
      f.show(); await f.click('Open');
      assert.equal(f.calls.length, detail ? 2 : 1);
      assert.equal(f.get('Viewer').hidden, true, `${origin}/${detail}/${JSON.stringify(guidanceOrigin)}`);
      assert.equal(f.get('Prompt').textContent, '');
      assert.equal(f.get('Reader').textContent, '');
      assert.equal(f.get('Retry').hidden, true);
      assert.match(f.get('Status').textContent, /검증/);
    }
  }
});

test('origin changes discard late list/detail responses even with unchanged hashes, then reopen in the new mode', async () => {
  for (const origin of ['imported_reference', 'manuscript_proposal']) for (const detailPending of [false, true]) {
    const f = fixture({ total: 1, guidanceOrigin: origin }); let resolve; let old;
    const pending = new Promise(done => { resolve = done; });
    f.setIntercept((data, url) => {
      if (url.includes('textOffset') === detailPending) { old = data; return pending; }
      return f.response(data);
    });
    f.show(); const opening = f.click('Open');
    while (!old) await new Promise(done => setImmediate(done));
    const signal = f.calls.at(-1).signal;
    const nextOrigin = origin === 'imported_reference' ? 'manuscript_proposal' : 'imported_reference';
    f.snapshot.importedVisualReferences.guidanceOrigin = nextOrigin;
    f.show();
    assert.equal(signal.aborted, true);
    assert.equal(f.get('Viewer').hidden, true);
    assert.equal(f.get('Prompt').textContent, '');
    f.setIntercept(null); await f.click('Open');
    const raw = f.get('Prompt').textContent;
    resolve(f.response(old)); await opening; await f.locale('en');
    assert.equal(f.get('Prompt').textContent, raw);
    assert.equal(f.get('Columns').hidden, false);
    assert.equal(f.get('Title').textContent, nextOrigin === 'manuscript_proposal' ? 'Proposed Scene Visual Guidance' : 'Original Scene Visual References');
    assert.equal(f.snapshot.importedVisualReferences.manuscriptHash, 'a'.repeat(64));
    assert.equal(f.snapshot.importedVisualReferences.checksum, 'b'.repeat(64));
  }
});

test('changed or invalid preview origin clears displayed guidance without another request', async () => {
  for (const origin of ['imported_reference', 'manuscript_proposal']) for (const next of ['unknown', null, undefined,
    origin === 'imported_reference' ? 'manuscript_proposal' : 'imported_reference']) {
    if (origin === 'imported_reference' && next === undefined) continue;
    const f = fixture({ total: 1, guidanceOrigin: origin }); f.show(); await f.click('Open');
    f.snapshot.importedVisualReferences.guidanceOrigin = next;
    f.tick();
    assert.equal(f.root.hidden, true);
    assert.equal(f.get('Prompt').textContent, '');
    assert.equal(f.get('Reader').textContent, '');
    assert.equal(f.calls.length, 2);
  }
});

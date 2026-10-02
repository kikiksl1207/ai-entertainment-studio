import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-story-visual-review.js', import.meta.url), 'utf8');
const references = readFileSync(new URL('../pages/creator-story-visual-references.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-story-visual-review.css', import.meta.url), 'utf8');
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptVersionId = '22222222-2222-4222-8222-222222222222';
const analysisJobId = '33333333-3333-4333-8333-333333333333';
const batchId = '44444444-4444-4444-8444-444444444444';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const originalPrompt = '<img src=x onerror=alert(1)>\nOriginal scene directive';
const sourceText = 'Synthetic source scene, with its cast and time.';
const editedPrompt = 'Author revised scene directive';
const basePath = `/api/v1/me/creator-studio/stories/${workId}/linear-draft/${manuscriptVersionId}`;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const drain = () => new Promise(done => setImmediate(done));

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {};
    this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this._text = '';
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
      selector === '*' || (selector === 'button' && node.tagName === 'BUTTON') || (selector === '[data-vr-copy]' && node.dataset.vrCopy));
  }
}

function fixture({ legacy = false, empty = false, initial = null, prose = sourceText, representative = false, total = 10, guidanceOrigin } = {}) {
  const parent = new Element(); parent.id = 'writerVisualReferences';
  const modal = new Element(); modal.id = 'writerFinalModal';
  const nodes = () => [parent, modal, ...parent.querySelectorAll('*')];
  const documentListeners = {};
  const document = { documentElement: { lang: 'ko' }, activeElement: null,
    getElementById: id => nodes().find(node => node.id === id),
    createElement: tag => { const node = new Element(tag); node.document = document; return node; },
    addEventListener: (name, callback) => { (documentListeners[name] ||= []).push(callback); } };
  const active = { workId, manuscriptVersionId, analysisJobId, identity: { ownerId: 'synthetic-author', epoch: 2 } };
  let completed = clone(active);
  const snapshot = { workId, manuscriptVersionId, analysisJobId, manuscriptHash: 'a'.repeat(64),
    parts: [{ partKey: 'p1', title: 'Synthetic part' }], importedVisualReferences: {
      contract: 'publication-visual-reference-preview-v1', approvalState: 'reference_only', requiresSceneReview: true,
      ...(guidanceOrigin === undefined ? {} : { guidanceOrigin }),
      manuscriptHash: 'a'.repeat(64), checksum: 'b'.repeat(64), totalReferences: total,
      mappedReferences: legacy ? 0 : total, mappingState: legacy ? 'unmapped_legacy' : 'exact_source_segments' } };
  const calls = [];
  const intervals = new Map();
  const observers = [];
  const windowListeners = {};
  let locale = 'ko';
  let identityCurrent = true;
  let intervalId = 0;
  let intercept = null;
  let remoteBatch = null;
  let remoteRepresentative = null;
  let uniqueSelections = 0;
  let pin = 'c'.repeat(64);
  let uniqueSaves = 0;
  let selected = 0;
  let confirmDiscard = true;
  const confirmations = [];
  const idempotent = new Map();
  const selectionIdempotent = new Map();
  const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(data) });
  const referenceBase = contract => ({ contract, workId, manuscriptVersionId, manuscriptHash: snapshot.manuscriptHash,
    ...(snapshot.importedVisualReferences.guidanceOrigin === undefined ? {} : { guidanceOrigin: snapshot.importedVisualReferences.guidanceOrigin }),
    checksum: snapshot.importedVisualReferences.checksum, approvalState: 'reference_only', requiresSceneReview: true,
    mappingState: snapshot.importedVisualReferences.mappingState });
  const row = index => ({ referenceIndex: index, sourceSceneKey: `original.scene-${index}`, promptSha256: hash(originalPrompt),
    partKey: legacy ? null : 'p1', partTitle: legacy ? null : 'Synthetic part', segmentCount: legacy ? 0 : 1 });
  const detail = (index, textOffset = 0) => ({ ...referenceBase('publication-visual-reference-detail-v1'), referenceIndex: index,
    sourceSceneKey: row(index).sourceSceneKey, promptSha256: hash(originalPrompt), promptText: originalPrompt,
    reader: legacy ? null : { partKey: 'p1', partTitle: 'Synthetic part', segmentCount: 1, text: empty ? '' : prose.slice(textOffset, textOffset + 6000),
      textOffset, totalTextLength: empty ? 0 : prose.length, nextTextOffset: !empty && textOffset + 6000 < prose.length ? textOffset + 6000 : null } });
  const reviewBase = contract => ({ contract, workId, manuscriptVersionId, analysisJobId,
    manuscriptHash: snapshot.manuscriptHash, sourceChecksum: snapshot.importedVisualReferences.checksum, profilePinHash: pin });
  const entry = (promptText = editedPrompt, index = selected) => ({ referenceIndex: index, sourceSceneKey: row(index).sourceSceneKey,
    originalPromptSha256: hash(originalPrompt), promptText, promptSha256: hash(promptText), partKey: 'p1', partTitle: 'Synthetic part', bindingSha256: 'd'.repeat(64) });
  const batch = (status = 'draft', promptText = editedPrompt) => ({ ...reviewBase('story-visual-review-batch-v1'), batchId,
    revision: status === 'draft' ? 1 : 2, status, batchChecksum: 'e'.repeat(64), entries: [entry(promptText)],
    approvedAt: status === 'approved' ? '2026-09-30T01:00:00.000Z' : null, generationStarted: false, published: false });
  if (initial) remoteBatch = batch(initial);
  const representativeContext = (selection = null) => ({ contract: 'story-part-visual-selection-context-v1',
    partKey: 'p1', partTitle: 'Synthetic part', targetSceneKey: 'p1-main', selectionVersion: selection?.selectionVersion || 0, selection });
  const selection = (status = 'selected', selectionVersion = 1) => ({ ...reviewBase('story-part-visual-selection-v1'),
    id: '55555555-5555-4555-8555-555555555555', partKey: 'p1', targetSceneKey: 'p1-main', selectionVersion, status,
    referenceIndex: status === 'selected' ? selected : null, sourceSceneKey: status === 'selected' ? row(selected).sourceSceneKey : null,
    batchId: status === 'selected' ? remoteBatch?.batchId || batchId : null,
    batchChecksum: status === 'selected' ? remoteBatch?.batchChecksum || 'e'.repeat(64) : null,
    selectionChecksum: 'f'.repeat(64), createdAt: '2026-10-01T01:00:00.000Z', current: true });
  if (representative) remoteRepresentative = representativeContext();
  function currentRepresentative() {
    const value = clone(remoteRepresentative);
    if (value?.selection?.status === 'selected' && value.selection.referenceIndex === selected) {
      const item = value.selection;
      item.current = item.current && remoteBatch?.status === 'approved' && item.batchId === remoteBatch.batchId &&
        item.batchChecksum === remoteBatch.batchChecksum && item.profilePinHash === pin && item.manuscriptHash === snapshot.manuscriptHash &&
        item.sourceChecksum === snapshot.importedVisualReferences.checksum && item.manuscriptVersionId === manuscriptVersionId && item.analysisJobId === analysisJobId;
    }
    return value;
  }
  function dataFor(url, options) {
    const path = new URL(url, 'http://fixture');
    if (path.pathname.endsWith('/visual-references')) {
      const offset = Number(path.searchParams.get('offset'));
      const items = Array.from({ length: Math.min(8, total - offset) }, (_, index) => row(offset + index));
      return { ...referenceBase('publication-visual-reference-page-v1'), offset, totalReferences: total,
        nextOffset: offset + items.length < total ? offset + items.length : null, items };
    }
    if (path.pathname.includes('/visual-references/')) {
      selected = Number(path.pathname.split('/').at(-1));
      return detail(selected, Number(path.searchParams.get('textOffset')));
    }
    if (path.pathname.endsWith('/representative')) {
      const body = options.body;
      if (!selectionIdempotent.has(body.idempotencyKey)) {
        assert.equal(body.expectedSelectionVersion, remoteRepresentative.selectionVersion);
        uniqueSelections++;
        const item = { ...selection(body.mode === 'select' ? 'selected' : 'cleared', body.expectedSelectionVersion + 1),
          id: webcrypto.randomUUID(), selectionChecksum: hash(JSON.stringify(body)) };
        if (body.mode === 'select') { item.batchId = body.batchId; item.batchChecksum = body.expectedBatchChecksum; }
        selectionIdempotent.set(body.idempotencyKey, representativeContext(item));
      }
      remoteRepresentative = clone(selectionIdempotent.get(body.idempotencyKey));
      return currentRepresentative();
    }
    if (path.pathname.includes('/visual-review/')) {
      return { ...reviewBase('story-visual-review-context-v1'), referenceIndex: selected, sourceSceneKey: row(selected).sourceSceneKey,
        originalPromptSha256: hash(originalPrompt), batch: clone(remoteBatch),
        ...(remoteRepresentative ? { representative: currentRepresentative() } : {}) };
    }
    if (path.pathname.endsWith('/approve')) {
      remoteBatch = { ...remoteBatch, status: 'approved', revision: 2, approvedAt: '2026-09-30T01:00:00.000Z' };
      return clone(remoteBatch);
    }
    if (path.pathname.endsWith('/visual-review-batches')) {
      const key = options.body.idempotencyKey;
      if (!idempotent.has(key)) {
        uniqueSaves++;
        const next = batch('draft', options.body.entries[0].promptText);
        if (remoteBatch) next.batchId = webcrypto.randomUUID();
        idempotent.set(key, next);
      }
      remoteBatch = clone(idempotent.get(key));
      return clone(remoteBatch);
    }
    throw new Error(`Unexpected test URL: ${url}`);
  }
  const window = { crypto: webcrypto, luminaI18n: { getLocale: () => locale },
    confirm: message => { confirmations.push(message); return confirmDiscard; },
    LuminaCreatorAnalysis: { completed: () => completed },
    LuminaCreatorStudioApi: { isCurrent: identity => identityCurrent && identity.ownerId === completed?.identity?.ownerId && identity.epoch === completed?.identity?.epoch,
      fetch: async (url, options) => {
        calls.push({ url, ...options, ...(options.body ? { body: clone(options.body) } : {}) });
        const data = dataFor(url, options);
        return intercept ? intercept(data, url, options) : response(data);
      } },
    addEventListener: (name, callback) => { (windowListeners[name] ||= []).push(callback); } };
  const sandbox = vm.createContext({ window, document, URLSearchParams, AbortController, TextEncoder, Uint8Array,
    setInterval: callback => { intervals.set(++intervalId, callback); return intervalId; }, clearInterval: id => intervals.delete(id),
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} } });
  vm.runInContext(references, sandbox);
  vm.runInContext(script, sandbox);
  const get = suffix => document.getElementById('writerVisualReview' + suffix);
  const reference = suffix => document.getElementById('writerVisualReferences' + suffix);
  const dispatch = async name => { for (const callback of windowListeners[name] || []) await callback({}); };
  const show = () => window.LuminaCreatorVisualReferences.show(snapshot, active);
  const open = async () => { show(); await reference('Open').fire('click'); };
  return { parent, modal, active, snapshot, window, calls, get, reference, response, batch, detail, show, open, selection, representativeContext,
    click: suffix => get(suffix).fire('click'),
    edit: async text => { get('Prompt').value = text; await get('Prompt').fire('input'); },
    check: async (value = true) => { get('Reviewed').checked = value; await get('Reviewed').fire('change'); },
    checkRepresentative: async (value = true) => { get('RepresentativeReviewed').checked = value; await get('RepresentativeReviewed').fire('change'); },
    setIntercept: value => { intercept = value; },
    completed: () => completed, complete: value => { completed = value; },
    expire: () => { identityCurrent = false; },
    setPin: value => { pin = value; },
    setBatch: value => { remoteBatch = clone(value); }, uniqueSaves: () => uniqueSaves,
    setRepresentative: value => { remoteRepresentative = clone(value); }, uniqueSelections: () => uniqueSelections,
    confirmations, confirmDiscard: value => { confirmDiscard = value; },
    reset: () => window.LuminaCreatorVisualReferences.reset(),
    tick: () => { for (const callback of [...intervals.values()]) callback(); },
    hide: () => { modal.classList.add('is-hidden'); for (const observer of observers) observer(); },
    dispatch, locale: async value => { locale = value; await dispatch('lumina:localechange'); },
    reopen: async () => { window.LuminaCreatorVisualReferences.reset(); modal.classList.remove('is-hidden'); await open(); } };
}

test('browser review fixture bootstrap compiles without launching a browser or server', () => {
  const source = readFileSync(new URL('./creator-story-visual-review.browser.test.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function bootstrap(config) {');
  const end = source.indexOf('\nasync function withBrowser(', start);
  assert.ok(start >= 0 && end > start);
  const bootstrap = vm.runInNewContext(source.slice(start, end) + '\nbootstrap;');
  assert.doesNotThrow(() => new vm.Script(`(${bootstrap.toString()})(${JSON.stringify({ prompt: originalPrompt, promptHash: hash(originalPrompt) })});`));
});

test('integration appends an unframed editor, remains lazy and preserves original prompt/source', async () => {
  assert.ok(html.indexOf('/pages/creator-story-visual-references.js') < html.indexOf('/pages/creator-story-visual-review.js'));
  assert.ok(html.indexOf('/pages/creator-story-visual-review.js') < html.indexOf('/pages/creator-story-finalize.js'));
  assert.match(html, /href="\/pages\/creator-story-visual-review\.css/);
  assert.match(references, /LuminaCreatorVisualReview\?\.show\(data, scope.snapshot, scope.active\)/);
  assert.match(references, /function clearDetail\(preserveReview = false\)/);
  assert.match(references, /if \(!preserveReview\) window.LuminaCreatorVisualReview\?\.reset\(\)/);
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|console\./);
  assert.match(css, /minmax\(0, 1fr\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /box-shadow|gradient/);
  const f = fixture();
  assert.equal(f.get('').hidden, true);
  f.show(); assert.equal(f.calls.length, 0);
  await f.open();
  assert.equal(f.calls.length, 3);
  assert.equal(f.get('').hidden, false);
  assert.ok(f.reference('Viewer').children.includes(f.get('')));
  assert.equal(f.get('Prompt').maxLength, 32000);
  assert.equal(f.get('Prompt').value, originalPrompt);
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  assert.equal(f.reference('Reader').textContent, sourceText);
  assert.equal(f.get('Approve').disabled, true);
  assert.equal(f.get('Reviewed').checked, false);
  const call = f.calls.at(-1);
  const url = new URL(call.url, 'http://fixture');
  assert.equal(url.pathname, basePath + '/visual-review/0');
  assert.equal(url.searchParams.get('expectedManuscriptHash'), 'a'.repeat(64));
  assert.equal(url.searchParams.get('expectedSourceChecksum'), 'b'.repeat(64));
  assert.equal(call.method, 'GET');
  assert.deepEqual(clone(call.identity), f.active.identity);
  assert.ok(call.signal instanceof AbortSignal);
  f.show(); assert.equal(f.calls.length, 3);
});

test('save sends one entry only and never approves; approval needs saved unchanged text plus explicit review and click', async () => {
  const f = fixture(); await f.open();
  await f.click('Approve'); assert.equal(f.calls.length, 3);
  await f.edit(editedPrompt);
  assert.equal(f.get('Reviewed').disabled, true);
  await f.click('Save');
  assert.equal(f.calls.length, 5);
  assert.equal(f.calls[3].method, 'GET');
  const call = f.calls[4];
  assert.equal(call.url, basePath + '/visual-review-batches');
  assert.equal(call.method, 'POST');
  assert.match(call.body.idempotencyKey, /^[a-f0-9-]{36}$/);
  assert.deepEqual(Object.keys(call.body).sort(), ['entries', 'expectedManuscriptHash', 'expectedProfilePinHash', 'expectedSourceChecksum', 'idempotencyKey']);
  assert.deepEqual(call.body.entries, [{ referenceIndex: 0, sourceSceneKey: 'original.scene-0', originalPromptSha256: hash(originalPrompt), promptText: editedPrompt }]);
  assert.equal(call.body.expectedProfilePinHash, 'c'.repeat(64));
  assert.equal(call.body.expectedManuscriptHash, 'a'.repeat(64));
  assert.equal(call.body.expectedSourceChecksum, 'b'.repeat(64));
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(f.get('Approve').disabled, true);
  assert.equal(f.get('Save').disabled, true);
  assert.match(f.get('Status').textContent, /초안 저장됨/);
  await f.click('Approve'); assert.equal(f.calls.length, 5);
  await f.check(); assert.equal(f.get('Approve').disabled, false);
  assert.equal(f.calls.length, 5);
  await f.click('Approve');
  assert.equal(f.calls.length, 7);
  assert.equal(f.calls[5].method, 'GET');
  assert.equal(f.calls[6].url, basePath + `/visual-review-batches/${batchId}/approve`);
  assert.deepEqual(f.calls[6].body, { expectedManuscriptHash: 'a'.repeat(64), expectedSourceChecksum: 'b'.repeat(64),
    expectedProfilePinHash: 'c'.repeat(64), expectedBatchChecksum: 'e'.repeat(64), expectedRevision: 1, scenesReviewed: true });
  assert.match(f.get('Status').textContent, /장면 지시 승인됨/);
  assert.equal(f.get('Approve').disabled, true);
  assert.equal(f.get('Reviewed').checked, false);
  assert.ok(f.calls.every(item => item.method === 'GET' || /\/visual-review-batches(?:\/[^/]+\/approve)?$/.test(item.url)));
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  assert.equal(f.reference('Reader').textContent, sourceText);
});

test('every edit clears saved/approved state and checkbox, even when restored to the saved text', async () => {
  for (const initial of ['draft', 'approved']) {
    const f = fixture({ initial }); await f.open();
    if (initial === 'draft') await f.check();
    await f.edit(editedPrompt + ' changed');
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('Reviewed').disabled, true);
    assert.equal(f.get('Approve').disabled, true);
    assert.match(f.get('Status').textContent, /미저장/);
    await f.edit(editedPrompt);
    assert.equal(f.get('Approve').disabled, true);
    assert.equal(f.get('Save').disabled, false);
    await f.check(); await f.click('Approve');
    assert.equal(f.calls.length, 3);
    await f.click('Save');
    assert.match(f.get('Status').textContent, /초안 저장됨/);
    assert.equal(f.get('Reviewed').checked, false);
  }
});

test('reopen loads saved draft or approved directive without inferring image generation or quality', async () => {
  for (const initial of ['draft', 'approved']) {
    const f = fixture({ initial }); await f.open();
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('Approve').disabled, true);
    await f.edit('Unsent edit'); f.reset();
    assert.equal(f.get('Prompt').value, '');
    await f.reopen();
    assert.equal(f.get('Prompt').value, editedPrompt);
    await f.locale('en');
    assert.equal(f.get('Status').textContent, initial === 'approved' ? 'Scene directive approved' : 'Draft saved');
    assert.doesNotMatch(f.get('').textContent, /generated|quality|published|consent|payment/i);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

test('all five locales translate ordinary labels, review meaning/style/cast/time and warnings without changing raw text', async () => {
  const f = fixture(); await f.open(); await f.edit(editedPrompt);
  const titles = new Set(); const checks = new Set(); const saves = new Set(); const approvals = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale);
    titles.add(f.get('Title').textContent); checks.add(f.get('ReviewText').textContent);
    saves.add(f.get('Save').textContent); approvals.add(f.get('Approve').textContent);
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.reference('Prompt').textContent, originalPrompt);
    assert.equal(f.reference('Reader').textContent, sourceText);
    assert.equal(f.get('Label').attributes.for, 'writerVisualReviewPrompt');
    assert.doesNotMatch(f.get('').textContent, /SHA|checksum|UUID|API|32000|batch|profilePin/i);
  }
  for (const values of [titles, checks, saves, approvals]) assert.equal(values.size, 5);
  assert.equal(f.calls.length, 3);
  await f.locale('en'); assert.match(f.get('ReviewText').textContent, /meaning, style, cast and time against the source/);
  const unavailable = fixture({ legacy: true }); await unavailable.open();
  const warnings = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await unavailable.locale(locale); warnings.add(unavailable.get('Status').textContent);
  }
  assert.equal(warnings.size, 5);
});

test('legacy, empty prose, unverified detail and rejected context fail closed without save/approve', async () => {
  for (const config of [{ legacy: true }, { empty: true }]) {
    const f = fixture(config); await f.open();
    assert.equal(f.calls.length, 2);
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Save').disabled, true);
    assert.equal(f.get('Approve').disabled, true);
    assert.ok(f.get('Status').textContent.length > 0);
    await f.click('Save'); await f.click('Approve');
    assert.equal(f.calls.length, 2);
  }
  for (const status of [409, 404, 403, 401, 503]) {
    const f = fixture();
    f.setIntercept((data, url) => f.response(url.includes('/visual-review/') ? { message: 'PRIVATE_SOURCE_DIAGNOSTIC' } : data,
      url.includes('/visual-review/') ? status : 200));
    await f.open();
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Save').disabled, true);
    assert.equal(f.get('Approve').disabled, true);
    assert.ok(!f.get('').textContent.includes('PRIVATE_SOURCE_DIAGNOSTIC'));
  }
  const f = fixture(); f.show();
  const tampered = f.detail(0); tampered.promptText += 'tampered';
  f.reference('Viewer').hidden = false;
  await f.window.LuminaCreatorVisualReview.show(tampered, f.snapshot, f.active);
  assert.equal(f.calls.length, 0);
  assert.equal(f.get('Prompt').value, '');
  assert.equal(f.get('Approve').disabled, true);
});

test('context and batch contracts verify full identities, hashes, selected mapping, bounds and prompt SHA', async () => {
  const contextMutations = [
    d => { d.contract = 'other'; }, d => { d.workId = manuscriptVersionId; }, d => { d.manuscriptVersionId = workId; },
    d => { d.analysisJobId = workId; }, d => { d.manuscriptHash = 'f'.repeat(64); }, d => { d.sourceChecksum = 'f'.repeat(64); },
    d => { d.profilePinHash = 'missing'; }, d => { d.referenceIndex = 1; }, d => { d.sourceSceneKey = 'other'; },
    d => { d.originalPromptSha256 = 'f'.repeat(64); }, d => { delete d.batch; }
  ];
  const batchMutations = [
    d => { d.contract = 'other'; }, d => { d.workId = manuscriptVersionId; }, d => { d.manuscriptVersionId = workId; },
    d => { d.analysisJobId = workId; }, d => { d.manuscriptHash = 'f'.repeat(64); }, d => { d.sourceChecksum = 'f'.repeat(64); },
    d => { d.profilePinHash = 'f'.repeat(64); }, d => { d.batchId = 'bad'; }, d => { d.batchChecksum = 'bad'; },
    d => { d.generationStarted = true; }, d => { d.published = true; }, d => { d.revision = 2; }, d => { d.status = 'unknown'; },
    d => { d.approvedAt = '2026-09-30T01:00:00Z'; }, d => { d.entries = []; }, d => { d.entries = Array(9).fill(d.entries[0]); },
    d => { d.entries.push(clone(d.entries[0])); }, d => { d.entries[0].referenceIndex = 1; }, d => { d.entries[0].referenceIndex = 10; },
    d => { d.entries[0].sourceSceneKey = 'other'; }, d => { d.entries[0].sourceSceneKey = 123; },
    d => { d.entries[0].originalPromptSha256 = 'f'.repeat(64); }, d => { d.entries[0].bindingSha256 = 'missing'; },
    d => { d.entries[0].partKey = 'other'; }, d => { d.entries[0].partTitle = 'Other'; },
    d => { d.entries[0].promptText += 'tampered'; }, d => { d.entries[0].promptText = 'x'.repeat(32001); },
    d => { d.entries[0].promptText = ' '; }, d => { d.entries[0].promptText += '\0'; }, d => { d.entries[0].promptSha256 = 'f'.repeat(64); }
  ];
  for (const mutate of [...contextMutations, ...batchMutations]) {
    const isBatch = batchMutations.includes(mutate);
    const f = fixture({ initial: isBatch ? 'draft' : null });
    f.setIntercept((data, url) => { if (url.includes('/visual-review/')) mutate(isBatch ? data.batch : data); return f.response(data); });
    await f.open();
    assert.equal(f.get('Prompt').value, '', mutate.toString());
    assert.equal(f.get('Save').disabled, true);
    assert.equal(f.get('Approve').disabled, true);
    assert.equal(f.reference('Prompt').textContent, originalPrompt);
  }
});

test('changed approved profile pin cancels save and approve before POST and requires reopening', async () => {
  for (const action of ['Save', 'Approve']) {
    const f = fixture({ initial: action === 'Approve' ? 'draft' : null }); await f.open();
    if (action === 'Approve') await f.check(); else await f.edit(editedPrompt);
    f.setPin('f'.repeat(64));
    if (action === 'Approve') { const next = f.batch('draft'); next.profilePinHash = 'f'.repeat(64); f.setBatch(next); }
    await f.click(action);
    assert.equal(f.calls.length, 4);
    assert.equal(f.calls.at(-1).method, 'GET');
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Save').disabled, true);
    assert.equal(f.get('Approve').disabled, true);
    await f.locale('en'); assert.match(f.get('Status').textContent, /Reopen the review/);
    f.setBatch(null); await f.reopen();
    assert.equal(f.get('Prompt').value, originalPrompt);
    assert.equal(f.get('Save').disabled, false);
  }
});

test('changed server draft cancels explicit approval; a single-scene checkbox cannot approve a multi-scene batch', async () => {
  const f = fixture({ initial: 'draft' }); await f.open(); await f.check();
  f.setBatch(f.batch('draft', 'Changed elsewhere'));
  await f.click('Approve');
  assert.equal(f.calls.length, 4);
  assert.equal(f.get('Approve').disabled, true);
  const multi = fixture(); const batch = multi.batch('draft');
  const other = clone(batch.entries[0]); other.referenceIndex = 1; other.sourceSceneKey = 'original.scene-1'; batch.entries.push(other);
  multi.setBatch(batch); await multi.open();
  assert.equal(multi.get('Prompt').value, editedPrompt);
  assert.equal(multi.get('Reviewed').disabled, true);
  assert.equal(multi.get('Save').disabled, false);
  await multi.check(); await multi.click('Approve'); assert.equal(multi.calls.length, 3);
  await multi.click('Save'); assert.equal(multi.calls.at(-1).body.entries.length, 1);
  assert.equal(multi.get('Reviewed').checked, false);
  assert.equal(multi.get('Reviewed').disabled, false);
});

test('ambiguous save retains a single idempotency key, retries once without duplicating, and never approves', async () => {
  for (const ambiguous of ['network', '503', 'invalid-receipt']) {
    const f = fixture(); await f.open(); await f.edit(editedPrompt);
    let first = true;
    f.setIntercept((data, url) => {
      if (first && url.endsWith('/visual-review-batches')) {
        first = false;
        if (ambiguous === 'network') throw new Error('PRIVATE_DIAGNOSTIC');
        if (ambiguous === '503') return f.response({ message: 'PRIVATE_DIAGNOSTIC' }, 503);
        data.entries[0].promptSha256 = 'f'.repeat(64);
      }
      return f.response(data);
    });
    await f.click('Save');
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.get('Save').disabled, false);
    assert.equal(f.get('Approve').disabled, true);
    assert.ok(!f.get('').textContent.includes('PRIVATE_DIAGNOSTIC'));
    const firstKey = f.calls.at(-1).body.idempotencyKey;
    await f.click('Save');
    const saves = f.calls.filter(call => call.method === 'POST');
    assert.equal(saves.length, 2);
    assert.equal(saves[1].body.idempotencyKey, firstKey);
    assert.deepEqual(saves[1].body, saves[0].body);
    assert.equal(f.uniqueSaves(), 1);
    assert.match(f.get('Status').textContent, /초안 저장됨/);
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('Approve').disabled, true);
  }
});

test('ambiguous retries retain their key through a failed freshness check, and distinct edits get distinct keys', async () => {
  const f = fixture(); await f.open(); await f.edit(editedPrompt);
  let failSave = true;
  let failContext = false;
  f.setIntercept((data, url) => {
    if (failSave && url.endsWith('/visual-review-batches')) { failSave = false; throw new Error('lost response'); }
    if (failContext && url.includes('/visual-review/')) { failContext = false; throw new Error('offline'); }
    return f.response(data);
  });
  await f.click('Save'); const firstKey = f.calls.at(-1).body.idempotencyKey;
  failContext = true; await f.click('Save');
  assert.equal(f.get('Save').disabled, false);
  await f.click('Save'); assert.equal(f.calls.at(-1).body.idempotencyKey, firstKey);
  await f.edit(editedPrompt + ' second'); await f.click('Save');
  assert.notEqual(f.calls.at(-1).body.idempotencyKey, firstKey);
  assert.equal(f.uniqueSaves(), 2);
});

test('editing while a save response is pending aborts stale state but permits an identical idempotent retry', async () => {
  const f = fixture(); await f.open(); await f.edit(editedPrompt);
  const pending = deferred(); let entered = false;
  f.setIntercept((data, url) => { if (url.endsWith('/visual-review-batches')) { entered = true; return pending.promise; } return f.response(data); });
  const saving = f.click('Save');
  while (!entered) await drain();
  const call = f.calls.at(-1);
  await f.edit(editedPrompt + ' newer');
  assert.equal(call.signal.aborted, true);
  pending.resolve(f.response(f.batch())); await saving;
  assert.equal(f.get('Prompt').value, editedPrompt + ' newer');
  assert.match(f.get('Status').textContent, /미저장/);
  assert.equal(f.get('Approve').disabled, true);
  await f.edit(editedPrompt); f.setIntercept(null); await f.click('Save');
  assert.equal(f.calls.at(-1).body.idempotencyKey, call.body.idempotencyKey);
  assert.equal(f.uniqueSaves(), 1);
});

test('identity, work, manuscript, analysis, source and token invalidation clear all editor text without saving', async () => {
  const mutations = [
    f => f.expire(), f => { f.completed().identity.ownerId = 'other'; }, f => { f.completed().identity.epoch++; },
    f => { f.completed().workId = manuscriptVersionId; }, f => { f.completed().manuscriptVersionId = workId; },
    f => { f.completed().analysisJobId = workId; }, f => { f.complete(null); },
    f => { f.completed().manuscriptHash = 'f'.repeat(64); }, f => { f.completed().sourceChecksum = 'f'.repeat(64); },
    f => { f.snapshot.manuscriptHash = 'f'.repeat(64); }, f => { f.snapshot.importedVisualReferences.checksum = 'f'.repeat(64); },
    f => { f.snapshot.parts[0].title = 'Other'; }, f => { f.snapshot.importedVisualReferences.mappingState = 'unmapped_legacy'; }
  ];
  for (const mutate of mutations) {
    const f = fixture(); await f.open(); await f.edit(editedPrompt); mutate(f); f.tick();
    assert.equal(f.get('').hidden, true, mutate.toString());
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.calls.length, 3);
  }
});

test('parent reset, close, pagehide and changed reference clear unsaved text without auto-save', async () => {
  for (const close of [f => f.reset(), f => f.hide(), f => f.dispatch('pagehide'), f => f.dispatch('lumina:auth-expired')]) {
    const f = fixture(); await f.open(); await f.edit(editedPrompt); await close(f);
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('').hidden, true);
    assert.equal(f.calls.length, 3);
  }
  const f = fixture(); await f.open(); await f.edit(editedPrompt);
  await f.reference('ListNext').fire('click');
  assert.equal(f.get('Prompt').value, originalPrompt);
  assert.equal(f.calls.at(-1).method, 'GET');
  assert.ok(f.calls.every(call => call.method === 'GET'));
  f.reference('Select').value = '9'; await f.reference('Select').fire('change');
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(new URL(f.calls.at(-1).url, 'http://fixture').pathname, basePath + '/visual-review/9');
});

test('late context, save and approval replies cannot restore text after account/close/source invalidation', async () => {
  for (const phase of ['context', 'save', 'approve']) {
    for (const invalidate of ['account', 'close', 'source']) {
      const f = fixture({ initial: phase === 'approve' ? 'draft' : null });
      if (phase !== 'context') await f.open();
      if (phase === 'save') await f.edit(editedPrompt);
      if (phase === 'approve') await f.check();
      const pending = deferred(); let old;
      f.setIntercept((data, url) => {
        const matches = phase === 'context' ? url.includes('/visual-review/') : phase === 'save' ? url.endsWith('/visual-review-batches') : url.endsWith('/approve');
        if (matches) { old = data; return pending.promise; }
        return f.response(data);
      });
      const operation = phase === 'context' ? f.open() : f.click(phase === 'save' ? 'Save' : 'Approve');
      while (!old) await drain();
      const signal = f.calls.at(-1).signal;
      if (invalidate === 'account') f.completed().identity.epoch++;
      if (invalidate === 'close') f.hide();
      if (invalidate === 'source') f.snapshot.importedVisualReferences.checksum = 'f'.repeat(64);
      f.tick();
      assert.equal(signal.aborted, true);
      pending.resolve(f.response(old)); await operation;
      assert.equal(f.get('Prompt').value, '', `${phase}/${invalidate}`);
      assert.equal(f.get('').hidden, true);
      assert.equal(f.get('Approve').disabled, true);
    }
  }
});

test('close/reopen discards old replies even if the transport ignores abort', async () => {
  const f = fixture(); const pending = deferred(); let old; let first = true;
  f.setIntercept((data, url) => {
    if (first && url.includes('/visual-review/')) { first = false; old = data; return pending.promise; }
    return f.response(data);
  });
  const opening = f.open(); while (!old) await drain();
  f.hide(); f.setBatch(f.batch('approved')); await f.reopen();
  assert.equal(f.get('Prompt').value, editedPrompt);
  pending.resolve(f.response(old)); await opening;
  assert.equal(f.get('Prompt').value, editedPrompt);
  assert.match(f.get('Status').textContent, /장면 지시 승인됨/);
  assert.equal(f.get('Approve').disabled, true);
});

test('invalid or oversized edited prompts cannot be saved; approval receipts must preserve saved bindings', async () => {
  const f = fixture(); await f.open();
  for (const text of ['', ' ', 'x'.repeat(32001), 'x\0y']) {
    await f.edit(text); assert.equal(f.get('Save').disabled, true); await f.click('Save'); assert.equal(f.calls.length, 3);
  }
  await f.edit('x'.repeat(32000)); assert.equal(f.get('Save').disabled, false);
  const mutations = [
    d => { d.batchId = workId; }, d => { d.status = 'draft'; d.revision = 1; d.approvedAt = null; },
    d => { d.entries[0].bindingSha256 = 'f'.repeat(64); }, d => { d.approvedAt = 'not-a-date'; },
    d => { d.entries[0].promptText = 'Other'; d.entries[0].promptSha256 = hash('Other'); }, d => { d.generationStarted = true; }
  ];
  for (const mutate of mutations) {
    const other = fixture({ initial: 'draft' }); await other.open(); await other.check();
    other.setIntercept((data, url) => { if (url.endsWith('/approve')) mutate(data); return other.response(data); });
    await other.click('Approve'); await other.locale('en');
    assert.equal(other.get('Status').textContent, 'Approval could not be confirmed. Please review again.');
    assert.equal(other.get('Reviewed').checked, false);
    assert.equal(other.get('Approve').disabled, true);
  }
});

test('a new intentional save after a confirmed edit gets a fresh key even if it returns to an earlier prompt', async () => {
  const f = fixture(); await f.open(); await f.edit(editedPrompt); await f.click('Save');
  const firstKey = f.calls.at(-1).body.idempotencyKey;
  await f.edit('Second directive'); await f.click('Save');
  await f.edit(editedPrompt); await f.click('Save');
  assert.notEqual(f.calls.at(-1).body.idempotencyKey, firstKey);
  assert.equal(f.uniqueSaves(), 3);
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(f.get('Approve').disabled, true);
});

test('the additional monotonic batchVersion field is accepted without exposing it in the editor', async () => {
  const f = fixture({ initial: 'draft' });
  const data = f.batch(); data.batchVersion = 7; f.setBatch(data);
  await f.open(); await f.locale('en');
  assert.equal(f.get('Prompt').value, editedPrompt);
  assert.equal(f.get('Status').textContent, 'Draft saved');
  assert.doesNotMatch(f.get('').textContent, /batchVersion|version 7/);
  await f.check(); await f.click('Approve');
  assert.equal(f.get('Status').textContent, 'Scene directive approved');
});

test('same-scene prose paging preserves unsaved textarea and explicit review state without reloading context', async () => {
  for (const initial of [null, 'draft', 'approved']) {
    const f = fixture({ initial, prose: 'x'.repeat(12001) }); await f.open();
    if (initial === 'draft') await f.check();
    if (initial === null) await f.edit(editedPrompt);
    const text = f.get('Prompt').value;
    const checked = f.get('Reviewed').checked;
    const status = f.get('Status').textContent;
    for (const direction of ['TextNext', 'TextNext', 'TextPrev', 'TextPrev']) {
      await f.reference(direction).fire('click');
      assert.equal(f.get('Prompt').value, text);
      assert.equal(f.get('Reviewed').checked, checked);
      assert.equal(f.get('Status').textContent, status);
      assert.equal(f.reference('Prompt').textContent, originalPrompt);
    }
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.calls.filter(call => call.url.includes('/visual-review/')).length, 1);
    assert.ok(f.calls.every(call => call.method === 'GET'));
    assert.equal(f.get('Approve').disabled, initial !== 'draft');
  }
});

test('prose-page pending and transient failure preserve the full original prompt and unsaved editor', async () => {
  const f = fixture({ prose: 'x'.repeat(12001) }); await f.open(); await f.edit(editedPrompt);
  const pending = deferred(); let old;
  f.setIntercept((data, url) => {
    if (url.includes('textOffset=6000')) { old = data; return pending.promise; }
    return f.response(data);
  });
  const moving = f.reference('TextNext').fire('click'); while (!old) await drain();
  assert.equal(f.get('Prompt').value, editedPrompt);
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  pending.resolve(f.response({ message: 'PRIVATE_DIAGNOSTIC' }, 503)); await moving;
  assert.equal(f.get('Prompt').value, editedPrompt);
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  f.setIntercept(null); await f.reference('Retry').fire('click');
  assert.equal(f.get('Prompt').value, editedPrompt);
  assert.equal(f.calls.filter(call => call.url.includes('/visual-review/')).length, 1);
});

test('unsaved scene-switch cancellation restores selection, cancels list paging, and localizes discard warnings', async () => {
  const f = fixture(); await f.open(); await f.edit(editedPrompt); f.confirmDiscard(false);
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale);
    f.reference('Select').value = '1'; await f.reference('Select').fire('change');
    assert.equal(f.reference('Select').value, '0');
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.calls.length, 3);
  }
  assert.equal(new Set(f.confirmations).size, 5);
  await f.reference('ListNext').fire('click');
  assert.equal(f.calls.length, 3);
  assert.equal(f.get('Prompt').value, editedPrompt);
  f.confirmDiscard(true); f.reference('Select').value = '1'; await f.reference('Select').fire('change');
  assert.equal(f.get('Prompt').value, originalPrompt);
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(f.calls.at(-1).method, 'GET');
  assert.equal(new URL(f.calls.at(-1).url, 'http://fixture').pathname, basePath + '/visual-review/1');
});

test('replies recheck account/source identity themselves without waiting for the interval', async () => {
  for (const change of ['account', 'source']) {
    const f = fixture({ initial: 'draft' }); await f.open(); await f.check();
    const pending = deferred(); let old;
    f.setIntercept((data, url) => {
      if (url.endsWith('/approve')) { old = data; return pending.promise; }
      return f.response(data);
    });
    const approving = f.click('Approve'); while (!old) await drain();
    if (change === 'account') f.completed().identity.ownerId = 'other';
    else f.snapshot.importedVisualReferences.checksum = 'f'.repeat(64);
    pending.resolve(f.response(old)); await approving;
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('').hidden, true);
    assert.equal(f.get('Approve').disabled, true);
    assert.equal(f.calls.at(-1).signal.aborted, true);
  }
});

test('fresh-context or POST conflicts stop save/approve without retrying or displaying private diagnostics', async () => {
  for (const action of ['Save', 'Approve']) {
    for (const phase of ['fresh', 'post']) {
      const f = fixture({ initial: action === 'Approve' ? 'draft' : null }); await f.open();
      if (action === 'Approve') await f.check(); else await f.edit(editedPrompt);
      f.setIntercept((data, url, options) => {
        const rejected = phase === 'fresh' ? url.includes('/visual-review/') : options.method === 'POST';
        return f.response(rejected ? { code: 'STALE_VISUAL_REVIEW_CONTEXT', message: 'PRIVATE_RAW_TEXT' } : data, rejected ? 409 : 200);
      });
      await f.click(action);
      assert.equal(f.get('Prompt').value, '');
      assert.equal(f.get('Save').disabled, true);
      assert.equal(f.get('Approve').disabled, true);
      assert.equal(f.get('Reviewed').checked, false);
      assert.doesNotMatch(f.get('').textContent, /PRIVATE_RAW_TEXT|STALE_VISUAL_REVIEW_CONTEXT/);
      assert.equal(f.calls.filter(call => call.method === 'POST').length, phase === 'fresh' ? 0 : 1);
    }
  }
});

test('same-scene prose paging preserves an in-flight idempotent save and its eventual draft status', async () => {
  const f = fixture({ prose: 'x'.repeat(12001) }); await f.open(); await f.edit(editedPrompt);
  const pending = deferred(); let old;
  f.setIntercept((data, url) => {
    if (url.endsWith('/visual-review-batches')) { old = data; return pending.promise; }
    return f.response(data);
  });
  const saving = f.click('Save'); while (!old) await drain();
  const signal = f.calls.at(-1).signal;
  await f.reference('TextNext').fire('click');
  assert.equal(signal.aborted, false);
  assert.equal(f.get('Prompt').value, editedPrompt);
  pending.resolve(f.response(old)); await saving;
  assert.match(f.get('Status').textContent, /초안 저장됨/);
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(f.get('Approve').disabled, true);
  assert.equal(f.uniqueSaves(), 1);
});

const representativePosts = f => f.calls.filter(call => call.method === 'POST' && call.url.endsWith('/representative'));

test('representative controls stay hidden for legacy contexts and appear only after explicit scene approval', async () => {
  const legacy = fixture({ initial: 'approved' }); await legacy.open();
  assert.equal(legacy.get('Representative').hidden, true);
  await legacy.checkRepresentative(); await legacy.click('SelectRepresentative'); await legacy.click('ClearRepresentative');
  assert.equal(representativePosts(legacy).length, 0);
  const f = fixture({ representative: true }); await f.open();
  assert.equal(f.get('Representative').hidden, true);
  await f.edit(editedPrompt); await f.click('Save');
  assert.equal(f.get('Representative').hidden, true);
  await f.check(); await f.click('Approve');
  assert.equal(f.get('Representative').hidden, false);
  assert.equal(f.get('RepresentativeReviewed').checked, false);
  assert.equal(f.get('SelectRepresentative').disabled, true);
  assert.equal(f.get('ClearRepresentative').disabled, true);
  await f.click('SelectRepresentative'); assert.equal(representativePosts(f).length, 0);
  await f.checkRepresentative(); assert.equal(representativePosts(f).length, 0);
  await f.click('SelectRepresentative');
  const post = representativePosts(f)[0];
  assert.equal(post.url, basePath + '/visual-review/0/representative');
  assert.deepEqual(post.body, { expectedManuscriptHash: 'a'.repeat(64), expectedSourceChecksum: 'b'.repeat(64),
    expectedProfilePinHash: 'c'.repeat(64), idempotencyKey: post.body.idempotencyKey, expectedSelectionVersion: 0,
    mode: 'select', batchId, expectedBatchChecksum: 'e'.repeat(64), representativeReviewed: true });
  assert.match(post.body.idempotencyKey, /^[a-f0-9-]{36}$/);
  const index = f.calls.indexOf(post);
  assert.equal(f.calls[index - 1].method, 'GET'); assert.equal(f.calls[index + 1].method, 'GET');
  assert.deepEqual(clone(post.identity), f.active.identity);
  assert.equal(f.uniqueSelections(), 1);
  await f.locale('en'); assert.equal(f.get('RepresentativeStatus').textContent, 'This guide is selected to represent “Synthetic part”.');
  assert.equal(f.get('SelectRepresentative').disabled, true);
  assert.equal(f.get('ClearRepresentative').disabled, false);
  assert.equal(f.get('RepresentativeReviewed').checked, false);
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  assert.equal(f.reference('Reader').textContent, sourceText);
  assert.ok(f.calls.every(call => call.method === 'GET' || /\/(visual-review-batches(?:\/[^/]+\/approve)?|visual-review\/\d+\/representative)$/.test(call.url)));
});

test('reopen never selects or clears; explicit clear sends no select fields and keeps approved guidance', async () => {
  const f = fixture({ initial: 'approved', representative: true });
  f.setRepresentative(f.representativeContext(f.selection())); await f.open(); await f.locale('en');
  assert.match(f.get('RepresentativeStatus').textContent, /^This guide is selected/);
  assert.equal(f.get('RepresentativeReviewed').checked, false);
  await f.reopen(); assert.equal(representativePosts(f).length, 0);
  await f.click('ClearRepresentative');
  const post = representativePosts(f)[0];
  assert.deepEqual(Object.keys(post.body).sort(), ['expectedManuscriptHash', 'expectedProfilePinHash', 'expectedSelectionVersion', 'expectedSourceChecksum', 'idempotencyKey', 'mode']);
  assert.equal(post.body.mode, 'clear'); assert.equal(post.body.expectedSelectionVersion, 1);
  assert.equal(f.get('ClearRepresentative').disabled, true);
  assert.equal(f.get('SelectRepresentative').disabled, true);
  assert.equal(f.get('RepresentativeReviewed').disabled, false);
  assert.match(f.get('RepresentativeStatus').textContent, /^No representative guide/);
  assert.equal(f.get('Status').textContent, 'Scene directive approved');
  assert.equal(f.get('Prompt').value, editedPrompt);
  f.reset(); await f.reopen(); await f.dispatch('lumina:auth-expired');
  assert.equal(representativePosts(f).length, 1);
  assert.equal(f.get('Representative').hidden, true);
});

test('five locales name the whole part and localize selection, stale mapping and clear without touching prose', async () => {
  const f = fixture({ initial: 'approved', representative: true }); await f.open();
  const labels = new Set(), selectLabels = new Set(), clearLabels = new Set(), statuses = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale);
    labels.add(f.get('RepresentativeText').textContent); selectLabels.add(f.get('SelectRepresentative').textContent);
    clearLabels.add(f.get('ClearRepresentative').textContent); statuses.add(f.get('RepresentativeStatus').textContent);
    assert.ok(f.get('RepresentativeText').textContent.includes('Synthetic part'));
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.reference('Prompt').textContent, originalPrompt);
    assert.doesNotMatch(f.get('').textContent, /SHA|checksum|UUID|API|batch|profilePin/i);
  }
  for (const values of [labels, selectLabels, clearLabels, statuses]) assert.equal(values.size, 5);
  await f.locale('en'); assert.match(f.get('RepresentativeText').textContent, /whole part/);
  assert.equal(f.calls.length, 3);
});

test('old manuscript/profile selections remain visible but never active; selecting and clearing use the current part', async () => {
  for (const action of ['SelectRepresentative', 'ClearRepresentative']) {
    const f = fixture({ initial: 'approved', representative: true });
    const old = f.selection(); Object.assign(old, { current: false, manuscriptVersionId: batchId, analysisJobId: workId,
      manuscriptHash: '1'.repeat(64), sourceChecksum: '2'.repeat(64), profilePinHash: '3'.repeat(64),
      referenceIndex: 1200, sourceSceneKey: 'old.scene', batchId: workId, batchChecksum: '4'.repeat(64) });
    f.setRepresentative(f.representativeContext(old)); await f.open(); await f.locale('en');
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.get('Representative').hidden, false);
    assert.match(f.get('RepresentativeStatus').textContent, /no longer current/);
    assert.equal(f.get('RepresentativeReviewed').disabled, false);
    assert.equal(f.get('ClearRepresentative').disabled, false);
    if (action === 'SelectRepresentative') await f.checkRepresentative();
    await f.click(action);
    assert.equal(representativePosts(f)[0].body.expectedSelectionVersion, 1);
    assert.equal(representativePosts(f)[0].body.expectedProfilePinHash, 'c'.repeat(64));
    assert.match(f.get('RepresentativeStatus').textContent, action === 'SelectRepresentative' ? /^This guide is selected/ : /^No representative guide/);
  }
});

test('another scene can represent the same bound part without marking this guide as selected', async () => {
  const f = fixture({ initial: 'approved', representative: true });
  const other = f.selection(); other.referenceIndex = 1; other.sourceSceneKey = 'original.scene-1'; other.batchId = workId;
  f.setRepresentative(f.representativeContext(other)); await f.open(); await f.locale('en');
  assert.match(f.get('RepresentativeStatus').textContent, /^Another guide/);
  assert.equal(f.get('RepresentativeReviewed').disabled, false);
  await f.click('ClearRepresentative');
  assert.equal(representativePosts(f)[0].url, basePath + '/visual-review/0/representative');
  assert.equal(representativePosts(f)[0].body.expectedSelectionVersion, 1);
  assert.match(f.get('RepresentativeStatus').textContent, /^No representative guide/);
});

test('representative context rejects invalid shape, cross-part targets, and forged current batch associations', async () => {
  const mutations = [
    d => { d.contract = 'other'; }, d => { d.partKey = 'p2'; }, d => { d.partTitle = 'Other'; },
    d => { d.targetSceneKey = 'p2-main'; }, d => { d.targetSceneKey = 'p1-secondary'; },
    d => { d.selectionVersion = -1; }, d => { d.selectionVersion = 1.5; }, d => { delete d.selection; },
    d => { d.selection.contract = 'other'; }, d => { d.selection.id = 'bad'; }, d => { d.selection.workId = batchId; },
    d => { d.selection.manuscriptVersionId = batchId; }, d => { d.selection.analysisJobId = workId; },
    d => { d.selection.manuscriptHash = '1'.repeat(64); }, d => { d.selection.profilePinHash = '2'.repeat(64); },
    d => { d.selection.sourceChecksum = '3'.repeat(64); }, d => { d.selection.selectionChecksum = 'bad'; },
    d => { d.selection.partKey = 'p2'; }, d => { d.selection.targetSceneKey = 'p2-main'; },
    d => { d.selection.selectionVersion = 2; }, d => { d.selection.current = 'true'; },
    d => { d.selection.status = 'draft'; }, d => { d.selection.referenceIndex = -1; }, d => { d.selection.referenceIndex = 10; },
    d => { d.selection.sourceSceneKey = 'other'; }, d => { d.selection.batchId = workId; },
    d => { d.selection.batchChecksum = '1'.repeat(64); }, d => { d.selection.createdAt = 'bad'; },
    d => { d.selection.status = 'cleared'; }, d => { d.selection.referenceIndex = null; },
    d => { d.selection.current = false; d.selection.profilePinHash = 'invalid'; },
    d => { d.selection.current = false; d.selection.manuscriptVersionId = 'invalid'; }
  ];
  for (const mutate of mutations) {
    const f = fixture({ initial: 'approved', representative: true }); f.setRepresentative(f.representativeContext(f.selection()));
    f.setIntercept((data, url) => { if (url.includes('/visual-review/')) mutate(data.representative); return f.response(data); });
    await f.open(); assert.equal(f.get('Save').disabled, true, mutate.toString());
    assert.equal(f.get('Representative').hidden, true);
    assert.equal(f.get('SelectRepresentative').disabled, true);
    assert.equal(representativePosts(f).length, 0);
  }
  const unsupported = fixture({ initial: 'approved', representative: true });
  unsupported.setIntercept((data, url) => { if (url.includes('/visual-review/')) data.representative = null; return unsupported.response(data); });
  await unsupported.open(); assert.equal(unsupported.get('Prompt').value, editedPrompt);
  assert.equal(unsupported.get('Representative').hidden, true);
});

test('select requires unchanged approved editor, explicit checkbox and unchanged fresh selection/profile/guide', async () => {
  const edited = fixture({ initial: 'approved', representative: true }); await edited.open(); await edited.checkRepresentative();
  await edited.edit('Modified'); await edited.edit(editedPrompt);
  assert.equal(edited.get('RepresentativeReviewed').checked, false);
  await edited.checkRepresentative(); await edited.click('SelectRepresentative'); assert.equal(representativePosts(edited).length, 0);
  for (const change of ['pin', 'guide', 'selection', 'capability', 'uncheck']) {
    const f = fixture({ initial: 'approved', representative: true }); await f.open(); await f.checkRepresentative();
    if (change === 'pin') { f.setPin('1'.repeat(64)); const batch = f.batch('approved'); f.setBatch(batch); }
    if (change === 'guide') { const batch = f.batch('approved'); batch.batchId = workId; f.setBatch(batch); }
    if (change === 'selection') f.setRepresentative(f.representativeContext(f.selection('cleared')));
    if (change === 'capability') f.setIntercept((data, url) => { if (url.includes('/visual-review/')) delete data.representative; return f.response(data); });
    if (change === 'uncheck') f.setIntercept(async (data, url) => { if (url.includes('/visual-review/')) await f.checkRepresentative(false); return f.response(data); });
    await f.click('SelectRepresentative');
    assert.equal(representativePosts(f).length, 0, change);
    assert.equal(f.get('SelectRepresentative').disabled, true);
  }
});

test('lost select/clear receipts and confirmation reads retry the identical UUID/body without duplicate selections', async () => {
  for (const mode of ['select', 'clear']) for (const phase of ['network', '503', 'invalid', 'confirmation-read']) {
    const f = fixture({ initial: 'approved', representative: true });
    if (mode === 'clear') f.setRepresentative(f.representativeContext(f.selection()));
    await f.open(); await f.locale('en');
    if (mode === 'select') await f.checkRepresentative();
    let first = true, posted = false;
    f.setIntercept((data, url) => {
      if (url.endsWith('/representative')) {
        posted = true;
        if (first && phase !== 'confirmation-read') {
          first = false;
          if (phase === 'network') throw new Error('PRIVATE_LOST_RESPONSE');
          if (phase === '503') return f.response({ message: 'PRIVATE_LOST_RESPONSE' }, 503);
          data.targetSceneKey = 'wrong-main';
        }
      } else if (first && posted && phase === 'confirmation-read' && url.includes('/visual-review/')) {
        first = false; throw new Error('PRIVATE_CONFIRMATION_FAILURE');
      }
      return f.response(data);
    });
    const action = mode === 'select' ? 'SelectRepresentative' : 'ClearRepresentative';
    await f.click(action);
    assert.doesNotMatch(f.get('RepresentativeStatus').textContent, /^This guide is selected/);
    assert.match(f.get('RepresentativeStatus').textContent, /could not be confirmed/);
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    if (mode === 'select') await f.checkRepresentative();
    await f.click(action);
    const posts = representativePosts(f);
    assert.equal(posts.length, 2, `${mode}/${phase}`);
    assert.deepEqual(posts[1].body, posts[0].body);
    assert.equal(f.uniqueSelections(), 1);
    assert.match(f.get('RepresentativeStatus').textContent, mode === 'select' ? /^This guide is selected/ : /^No representative guide/);
    assert.doesNotMatch(f.get('').textContent, /PRIVATE_/);
  }
});

test('selection receipt and fresh confirmation must agree before any selected indication appears', async () => {
  const f = fixture({ initial: 'approved', representative: true }); await f.open(); await f.checkRepresentative(); await f.locale('en');
  let posted = false;
  f.setIntercept((data, url) => {
    if (url.endsWith('/representative')) posted = true;
    else if (posted && url.includes('/visual-review/')) data.representative = f.representativeContext(f.selection('cleared', 2));
    return f.response(data);
  });
  await f.click('SelectRepresentative');
  assert.equal(representativePosts(f).length, 1);
  assert.equal(f.get('SelectRepresentative').disabled, true);
  assert.doesNotMatch(f.get('RepresentativeStatus').textContent, /^This guide is selected/);
});

test('stale and out-of-order representative replies cannot restore selected state after edit, close, account or newer clear', async () => {
  for (const invalidate of ['edit', 'close', 'account', 'source', 'newer-clear']) {
    const f = fixture({ initial: 'approved', representative: true }); await f.open(); await f.checkRepresentative(); await f.locale('en');
    const pending = deferred(); let old;
    f.setIntercept((data, url) => { if (url.endsWith('/representative')) { old = data; return pending.promise; } return f.response(data); });
    const selecting = f.click('SelectRepresentative'); while (!old) await drain();
    const signal = representativePosts(f)[0].signal;
    if (invalidate === 'edit') await f.edit('Later edit');
    if (invalidate === 'close') f.hide();
    if (invalidate === 'account') f.completed().identity.epoch++;
    if (invalidate === 'source') f.snapshot.manuscriptHash = '1'.repeat(64);
    if (invalidate === 'newer-clear') {
      f.hide(); f.setIntercept(null); await f.reopen(); await f.click('ClearRepresentative');
      assert.match(f.get('RepresentativeStatus').textContent, /^No representative guide/);
    }
    f.tick(); assert.equal(signal.aborted, true);
    pending.resolve(f.response(old)); await selecting;
    assert.doesNotMatch(f.get('RepresentativeStatus').textContent, /^This guide is selected/, invalidate);
    assert.equal(f.get('SelectRepresentative').disabled, true);
    if (invalidate === 'newer-clear') assert.match(f.get('RepresentativeStatus').textContent, /^No representative guide/);
  }
});

test('confirmed select, clear and reselect create distinct intentional keys, never automatic mutations', async () => {
  const f = fixture({ initial: 'approved', representative: true }); await f.open(); await f.checkRepresentative(); await f.click('SelectRepresentative');
  await f.click('ClearRepresentative'); await f.checkRepresentative(); await f.click('SelectRepresentative');
  const posts = representativePosts(f);
  assert.deepEqual(posts.map(post => post.body.expectedSelectionVersion), [0, 1, 2]);
  assert.equal(new Set(posts.map(post => post.body.idempotencyKey)).size, 3);
  await f.dispatch('pagehide'); await f.reopen();
  assert.equal(representativePosts(f).length, 3);
});

test('editing and replacing a selected guide never selects the replacement or hides the stale binding', async () => {
  for (const phase of ['edited-clear', 'saved-clear', 'approved-select']) {
    const f = fixture({ initial: 'approved', representative: true });
    f.setRepresentative(f.representativeContext(f.selection())); await f.open(); await f.locale('en');
    await f.edit('Replacement guide');
    assert.match(f.get('RepresentativeStatus').textContent, /edits are not approved/);
    assert.equal(f.get('SelectRepresentative').disabled, true);
    if (phase === 'edited-clear') {
      await f.edit(editedPrompt); await f.click('ClearRepresentative');
      assert.equal(f.get('Prompt').value, editedPrompt);
      assert.equal(f.get('Save').disabled, false);
      assert.equal(f.get('SelectRepresentative').disabled, true);
    } else {
      await f.click('Save');
      assert.equal(f.get('Representative').hidden, false);
      assert.match(f.get('RepresentativeStatus').textContent, /no longer current/);
      assert.equal(representativePosts(f).length, 0);
      if (phase === 'saved-clear') await f.click('ClearRepresentative');
      else {
        await f.check(); await f.click('Approve');
        assert.match(f.get('RepresentativeStatus').textContent, /no longer current/);
        assert.equal(representativePosts(f).length, 0);
        await f.checkRepresentative(); await f.click('SelectRepresentative');
        assert.match(f.get('RepresentativeStatus').textContent, /^This guide is selected/);
        assert.notEqual(representativePosts(f)[0].body.batchId, batchId);
      }
    }
    assert.equal(representativePosts(f).length, 1, phase);
    assert.equal(representativePosts(f)[0].body.expectedSelectionVersion, 1);
  }
});

test('selection receipts fail closed on wrong version/status/current identity/target and preserve retry intent', async () => {
  const mutations = [
    d => { d.selectionVersion++; d.selection.selectionVersion++; }, d => { d.selection.current = false; },
    d => { d.selection.workId = batchId; }, d => { d.selection.manuscriptVersionId = batchId; },
    d => { d.selection.analysisJobId = workId; }, d => { d.selection.profilePinHash = '1'.repeat(64); },
    d => { d.selection.manuscriptHash = '2'.repeat(64); }, d => { d.selection.sourceChecksum = '3'.repeat(64); },
    d => { d.targetSceneKey = 'p2-main'; d.selection.targetSceneKey = 'p2-main'; },
    d => { d.selection.referenceIndex = 1; d.selection.sourceSceneKey = 'original.scene-1'; },
    d => { d.selection.batchId = workId; }, d => { d.selection.batchChecksum = '4'.repeat(64); },
    d => { d.selection.selectionChecksum = 'bad'; }, d => { d.selection.createdAt = 'bad'; },
    d => { d.selection.status = 'cleared'; d.selection.referenceIndex = d.selection.sourceSceneKey = d.selection.batchId = d.selection.batchChecksum = null; }
  ];
  for (const mutate of mutations) {
    const f = fixture({ initial: 'approved', representative: true }); await f.open(); await f.checkRepresentative(); await f.locale('en');
    let first = true;
    f.setIntercept((data, url) => { if (first && url.endsWith('/representative')) { first = false; mutate(data); } return f.response(data); });
    await f.click('SelectRepresentative');
    assert.match(f.get('RepresentativeStatus').textContent, /could not be confirmed/, mutate.toString());
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    await f.checkRepresentative(); await f.click('SelectRepresentative');
    assert.deepEqual(representativePosts(f)[1].body, representativePosts(f)[0].body);
    assert.match(f.get('RepresentativeStatus').textContent, /^This guide is selected/);
    assert.equal(f.uniqueSelections(), 1);
  }
});

test('stale and failed representative statuses are localized in all five languages', async () => {
  const f = fixture({ initial: 'approved', representative: true });
  const old = f.selection(); old.current = false; old.profilePinHash = '1'.repeat(64);
  f.setRepresentative(f.representativeContext(old)); await f.open();
  const stale = new Set(), failed = new Set();
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale); stale.add(f.get('RepresentativeStatus').textContent);
    assert.ok(f.get('RepresentativeStatus').textContent.includes('Synthetic part'));
  }
  f.setIntercept((data, url) => { if (url.endsWith('/representative')) throw new Error('lost reply'); return f.response(data); });
  await f.checkRepresentative(); await f.click('SelectRepresentative');
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    await f.locale(locale); failed.add(f.get('RepresentativeStatus').textContent);
  }
  assert.equal(stale.size, 5); assert.equal(failed.size, 5);
});

test('proposal review and representative labels distinguish origin in all five locales without refetching', async () => {
  const proposed = fixture({ total: 1, guidanceOrigin: 'manuscript_proposal', initial: 'approved', representative: true });
  const imported = fixture({ total: 1, initial: 'approved', representative: true });
  const before = clone(proposed.snapshot);
  await proposed.open(); await imported.open();
  const titles = {
    ko: ['제안된 장면 시각 가이드', '검토할 제안 가이드', '제안'],
    en: ['Proposed Scene Visual Guidance', 'Proposed guidance to review', 'proposed'],
    ja: ['提案されたシーンのビジュアルガイド', '確認する提案ガイド', '提案'],
    'zh-Hans': ['建议的场景视觉指南', '待审阅的建议指南', '建议'],
    'zh-Hant': ['建議的場景視覺指南', '待審閱的建議指南', '建議']
  };
  for (const [locale, [title, label, marker]] of Object.entries(titles)) {
    await proposed.locale(locale); await imported.locale(locale);
    assert.equal(proposed.get('Title').textContent, title);
    assert.equal(proposed.get('Label').textContent, label);
    for (const suffix of ['Title', 'Label', 'Approve', 'ReviewText', 'Status', 'RepresentativeTitle', 'RepresentativeText', 'RepresentativeStatus']) {
      assert.notEqual(proposed.get(suffix).textContent, imported.get(suffix).textContent, `${locale}/${suffix}`);
      assert.ok(proposed.get(suffix).textContent.toLowerCase().includes(marker), `${locale}/${suffix}`);
    }
    assert.equal(proposed.get('Prompt').value, editedPrompt);
    assert.equal(proposed.reference('Prompt').textContent, originalPrompt);
    assert.equal(proposed.reference('Reader').textContent, sourceText);
    assert.equal(proposed.get('Reviewed').checked, false);
    assert.equal(proposed.get('RepresentativeReviewed').checked, false);
    assert.doesNotMatch(proposed.get('').textContent, /automatic|generated|quality|published/i);
  }
  await imported.locale('en');
  assert.equal(imported.get('Title').textContent, 'Original Scene Visual Directive');
  assert.equal(imported.get('Status').textContent, 'Scene directive approved');
  assert.equal(proposed.calls.length, 3);
  assert.ok(proposed.calls.every(call => call.method === 'GET'));
  assert.deepEqual(proposed.snapshot, before);
});

test('a manuscript proposal still requires separate explicit save, guide approval and representative selection', async () => {
  const f = fixture({ total: 1, guidanceOrigin: 'manuscript_proposal', representative: true });
  const before = clone(f.snapshot);
  await f.open(); await f.locale('en');
  await f.click('Approve'); await f.click('SelectRepresentative');
  assert.equal(f.calls.length, 3);
  assert.equal(f.get('Reviewed').disabled, true);
  assert.equal(f.get('Representative').hidden, true);
  await f.click('Save');
  assert.equal(f.get('Reviewed').checked, false);
  assert.equal(f.get('Approve').disabled, true);
  assert.equal(f.get('Representative').hidden, true);
  await f.click('Approve'); assert.equal(f.calls.length, 5);
  await f.check(); await f.click('Approve');
  assert.equal(f.get('Status').textContent, 'Proposed scene guidance approved');
  assert.equal(f.get('Representative').hidden, false);
  assert.equal(f.get('RepresentativeReviewed').checked, false);
  await f.click('SelectRepresentative'); assert.equal(representativePosts(f).length, 0);
  await f.checkRepresentative(); await f.click('SelectRepresentative');
  assert.equal(representativePosts(f).length, 1);
  assert.match(f.get('RepresentativeStatus').textContent, /^This proposed guide is selected/);
  assert.deepEqual(Object.keys(f.calls.find(call => call.url.endsWith('/visual-review-batches')).body).sort(),
    ['entries', 'expectedManuscriptHash', 'expectedProfilePinHash', 'expectedSourceChecksum', 'idempotencyKey']);
  assert.deepEqual(Object.keys(representativePosts(f)[0].body).sort(),
    ['batchId', 'expectedBatchChecksum', 'expectedManuscriptHash', 'expectedProfilePinHash', 'expectedSelectionVersion', 'expectedSourceChecksum', 'idempotencyKey', 'mode', 'representativeReviewed']);
  const writes = f.calls.filter(call => call.method === 'POST').length;
  await f.reopen();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, writes);
  assert.equal(f.get('RepresentativeReviewed').checked, false);
  assert.equal(f.reference('Prompt').textContent, originalPrompt);
  assert.equal(f.reference('Reader').textContent, sourceText);
  assert.deepEqual(f.snapshot, before);
});

test('direct review entry rejects unknown or mismatched preview/detail origins before loading context', async () => {
  const unknown = ['unknown', '', null, false, 0, {}, []];
  for (const origin of [undefined, 'imported_reference', 'manuscript_proposal']) {
    const rejected = [...unknown, origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal'];
    if (origin === 'manuscript_proposal') rejected.push(undefined);
    for (const detailOrigin of rejected) {
      const f = fixture({ total: 1, guidanceOrigin: origin }); f.show();
      const detail = f.detail(0);
      if (detailOrigin === undefined) delete detail.guidanceOrigin;
      else detail.guidanceOrigin = detailOrigin;
      f.reference('Viewer').hidden = false;
      await f.window.LuminaCreatorVisualReview.show(detail, f.snapshot, f.active);
      assert.equal(f.calls.length, 0);
      assert.equal(f.get('').hidden, true);
      assert.equal(f.get('Prompt').value, '');
      assert.equal(f.get('Save').disabled, true);
      assert.equal(f.get('Approve').disabled, true);
      assert.equal(f.get('SelectRepresentative').disabled, true);
    }
  }
  for (const origin of unknown) {
    const f = fixture(); f.show(); const detail = f.detail(0);
    f.snapshot.importedVisualReferences.guidanceOrigin = origin;
    detail.guidanceOrigin = origin;
    f.reference('Viewer').hidden = false;
    await f.window.LuminaCreatorVisualReview.show(detail, f.snapshot, f.active);
    assert.equal(f.calls.length, 0);
    assert.equal(f.get('').hidden, true);
  }
});

test('review context binds legacy responses locally and rejects an explicit mismatched or unknown origin', async () => {
  for (const origin of ['imported_reference', 'manuscript_proposal']) {
    for (const returned of [undefined, origin, 'unknown', null, origin === 'imported_reference' ? 'manuscript_proposal' : 'imported_reference']) {
      const f = fixture({ total: 1, guidanceOrigin: origin });
      f.setIntercept((data, url) => {
        if (url.includes('/visual-review/') && returned !== undefined) data.guidanceOrigin = returned;
        return f.response(data);
      });
      await f.open();
      const accepted = returned === undefined || returned === origin;
      assert.equal(f.get('Prompt').value, accepted ? originalPrompt : '');
      assert.equal(f.get('Save').disabled, !accepted);
      assert.equal(f.get('Approve').disabled, true);
      assert.equal(f.calls.length, 3);
    }
  }
});

test('same-scene matching includes origin but normalizes legacy imported origin and preserves proposal prose paging', async () => {
  for (const origin of [undefined, 'imported_reference', 'manuscript_proposal']) {
    const f = fixture({ total: 1, guidanceOrigin: origin, initial: 'draft', prose: sourceText.repeat(300) });
    await f.open(); await f.edit('Unsent author guidance');
    if (origin !== 'manuscript_proposal') {
      const snapshot = clone(f.snapshot); const detail = f.detail(0);
      snapshot.importedVisualReferences.guidanceOrigin = 'imported_reference'; detail.guidanceOrigin = 'imported_reference';
      await f.window.LuminaCreatorVisualReview.show(detail, snapshot, f.active);
      assert.equal(f.calls.length, 3);
      assert.equal(f.get('Prompt').value, 'Unsent author guidance');
    }
    await f.reference('TextNext').fire('click');
    assert.equal(f.calls.length, 4);
    assert.equal(f.get('Prompt').value, 'Unsent author guidance');
    const snapshot = clone(f.snapshot); const detail = f.detail(0);
    const next = origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal';
    snapshot.importedVisualReferences.guidanceOrigin = next; detail.guidanceOrigin = next;
    await f.window.LuminaCreatorVisualReview.show(detail, snapshot, f.active);
    assert.equal(f.calls.length, 5);
    assert.equal(f.get('Prompt').value, editedPrompt);
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    await f.locale('en');
    assert.equal(f.get('Title').textContent, next === 'manuscript_proposal' ? 'Proposed Scene Visual Guidance' : 'Original Scene Visual Directive');
  }
});

test('mode changes invalidate pending context/save/approval/selection and ignore late receipts after reopening', async () => {
  for (const origin of ['imported_reference', 'manuscript_proposal']) for (const phase of ['context', 'save', 'approve', 'representative']) {
    const f = fixture({ total: 1, guidanceOrigin: origin, representative: true,
      initial: phase === 'approve' ? 'draft' : phase === 'representative' ? 'approved' : null });
    if (phase !== 'context') await f.open();
    if (phase === 'save') await f.edit(editedPrompt);
    if (phase === 'approve') await f.check();
    if (phase === 'representative') await f.checkRepresentative();
    const pending = deferred(); let old;
    f.setIntercept((data, url) => {
      const matches = phase === 'context' ? url.includes('/visual-review/') : phase === 'save' ? url.endsWith('/visual-review-batches') :
        phase === 'approve' ? url.endsWith('/approve') : url.endsWith('/representative');
      if (matches) { old = data; return pending.promise; }
      return f.response(data);
    });
    const operation = phase === 'context' ? f.open() : f.click(phase === 'save' ? 'Save' : phase === 'approve' ? 'Approve' : 'SelectRepresentative');
    while (!old) await drain();
    const signal = f.calls.at(-1).signal;
    const next = origin === 'manuscript_proposal' ? 'imported_reference' : 'manuscript_proposal';
    f.snapshot.importedVisualReferences.guidanceOrigin = next; f.show();
    assert.equal(signal.aborted, true, `${origin}/${phase}`);
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    assert.equal(f.get('SelectRepresentative').disabled, true);
    f.setIntercept(null); f.setBatch(null); f.setRepresentative(f.representativeContext()); await f.open();
    assert.equal(f.get('Prompt').value, originalPrompt);
    const count = f.calls.length;
    pending.resolve(f.response(old)); await operation; await f.locale('en');
    assert.equal(f.calls.length, count);
    assert.equal(f.get('Prompt').value, originalPrompt);
    assert.equal(f.get('Title').textContent, next === 'manuscript_proposal' ? 'Proposed Scene Visual Guidance' : 'Original Scene Visual Directive');
    assert.equal(f.get('Status').textContent, 'Unsaved draft');
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    assert.equal(f.get('Representative').hidden, true);
  }
});

test('invalidating guidance origin clears saved approval and representative confirmation without writes', async () => {
  for (const origin of ['imported_reference', 'manuscript_proposal']) for (const target of ['preview', 'detail']) {
    const f = fixture({ total: 1, guidanceOrigin: origin, initial: 'approved', representative: true });
    await f.open(); await f.checkRepresentative();
    if (target === 'preview') f.snapshot.importedVisualReferences.guidanceOrigin = 'unknown';
    else {
      const detail = f.detail(0); await f.window.LuminaCreatorVisualReview.show(detail, f.snapshot, f.active);
      detail.guidanceOrigin = 'unknown';
    }
    f.tick();
    assert.equal(f.get('').hidden, true);
    assert.equal(f.get('Prompt').value, '');
    assert.equal(f.get('Reviewed').checked, false);
    assert.equal(f.get('RepresentativeReviewed').checked, false);
    assert.equal(f.get('Approve').disabled, true);
    assert.equal(f.get('SelectRepresentative').disabled, true);
    assert.equal(f.calls.length, 3);
    assert.ok(f.calls.every(call => call.method === 'GET'));
  }
});

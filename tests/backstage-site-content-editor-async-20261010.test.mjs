import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const uiPath = process.env.CMS_CONFLICT_UI_PATH || new URL('../backstage-site-content.js', import.meta.url);
if (typeof uiPath === 'string') assert.match(path.resolve(uiPath), /^E:[\\/]/i);
const uiSource = readFileSync(uiPath, 'utf8');
const sharedSource = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const helperStart = sharedSource.indexOf('async function backstageFetch(');
const helperEnd = sharedSource.indexOf('\nwindow.LuminaBackstageApi =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Missing actual shared fetch');
const sharedFetchSource = sharedSource.slice(helperStart, helperEnd);

const BASE = '/admin/api/v1/backstage/site-content';
const A = '00000000-0000-4000-8000-000000000701';
const B = '00000000-0000-4000-8000-000000000702';
const C = '00000000-0000-4000-8000-000000000703';
const CODE = 'SITE_CONTENT_REVISION_CONFLICT';
const ENGLISH = 'Site content changed; reload its current revision before trying again';
const fields = ['contentKey', 'scope', 'locale', 'pageKey', 'characterSlug', 'modelSlug',
  'title', 'body', 'ctaLabel', 'ctaHref', 'content'];
const options = { timeout: 5000 };
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

const conflict = () => ({ status: 409, body: { success: false, error: {
  code: CODE, message: ENGLISH, details: { id: A, expectedVersion: 7, reloadRequired: true },
} } });
const unavailable = () => ({ status: 503, body: { success: false, error: {
  code: 'SYNTHETIC_UNAVAILABLE', message: 'Synthetic service unavailable',
} } });
const auditError = () => ({ status: 503, body: { success: false, error: {
  code: 'SYNTHETIC_AUDIT_UNAVAILABLE', message: 'Synthetic audit unavailable',
} } });
const log = label => ({ action: label, createdAt: '2026-10-10T00:00:00.000Z',
  metadata: { changedFields: [`${label}.field`] } });

class Element {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.readOnly = false;
    this.html = '';
    this.htmlWrites = [];
    this.texts = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name) };
  }
  set innerHTML(value) { this.html = value; this.htmlWrites.push(value); }
  get innerHTML() { return this.html; }
  set textContent(value) { this.texts.push(value); this.text = value; }
  get textContent() { return this.text || ''; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async emit(type, extra = {}) {
    if (type === 'click') assert.ok(!this.disabled && !this.hidden);
    const listeners = this.listeners.get(type) || [];
    assert.equal(listeners.length, 1, `Expected actual bound ${type} listener`);
    let prevented = false;
    await listeners[0].call(this, { target: this, preventDefault() { prevented = true; }, ...extra });
    if (type === 'submit') assert.equal(prevented, true);
  }
  scrollIntoView() {}
}

function makeForm(names, defaults = {}) {
  const form = new Element();
  form.elements = Object.fromEntries(names.map(name => {
    const element = new Element(); element.value = defaults[name] || ''; return [name, element];
  }));
  const counters = { title: new Element(), body: new Element() };
  form.querySelector = selector => selector === '[data-counter="title"]' ? counters.title
    : selector === '[data-counter="body"]' ? counters.body : null;
  form.reset = () => { for (const name of names) form.elements[name].value = defaults[name] || ''; };
  return form;
}

// Reuses the confirm-target harness shape, not its tests: full unchanged IIFE and real shared fetch.
// DOM/auth/transport are synthetic. No private state export, replacement handler or lifecycle action runs.
function screen() {
  const ids = ['siteContentRows', 'siteContentTotalNote', 'siteContentCountBadge',
    'siteContentEditorCard', 'siteContentEditorTitle', 'siteContentEditorMeta', 'siteContentAuditSection',
    'siteContentAuditList', 'siteContentPreview', 'siteContentFormStatus', 'siteContentCreateButton',
    'siteContentEditorClose', 'siteContentSaveButton', 'siteContentPublishButton',
    'siteContentArchiveButton', 'siteContentRestoreButton'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const form = makeForm(fields, { scope: 'global', locale: 'ko-KR' });
  const filters = makeForm(['pageKey', 'scope', 'characterSlug', 'modelSlug', 'locale', 'search'], { locale: 'ko-KR' });
  elements.set('siteContentForm', form);
  elements.set('siteContentFilterForm', filters);
  const element = id => elements.get(id);
  element('siteContentEditorCard').classList.add('is-hidden');
  element('siteContentAuditSection').hidden = true;
  const entries = new Map([A, B].map((id, index) => [id, {
    id, contentKey: `cms.synthetic.${index ? 'b' : 'a'}`, scope: 'global', locale: 'ko-KR',
    pageKey: null, characterSlug: null, modelSlug: null, title: `SERVER ${index ? 'B' : 'A'} title`,
    body: `SERVER ${index ? 'B' : 'A'} body`, ctaLabel: null, ctaHref: null, content: { server: true },
    status: 'draft', version: index ? 11 : 7, updatedAt: '2026-10-10T00:00:00.000Z',
    updatedByUserId: 'synthetic-operator',
  }]));
  const auditRows = new Map([[A, [log('AUDIT_A_CURRENT')]], [B, [log('AUDIT_B_CURRENT')]]]);
  const auditGates = new Map();
  const requests = [], errors = [];
  let nextWrite, refreshCalls = 0;
  const auth = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', user: { id: 'synthetic-operator' } };
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  class FixtureFormData {
    constructor(target) { this.target = target; }
    get(name) { return this.target.elements[name]?.value ?? null; }
  }
  const context = createContext({ window: {}, URL, FormData: FixtureFormData,
    setTimeout, clearTimeout, BACKSTAGE_API_BASE: 'https://offline.invalid', backstageAuthEpoch: 0,
    dashboardView: { classList: { contains: () => false } }, getBackstageAuth: () => auth,
    refreshBackstageAuthOnce: async () => { refreshCalls++; return null; },
    document: { readyState: 'complete', getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [], addEventListener() { assert.fail('Unexpected deferred initialization'); } },
    fetch: async (url, requestOptions) => {
      const address = new URL(url);
      assert.equal(address.origin, 'https://offline.invalid');
      assert.equal(requestOptions.headers.Authorization, 'Bearer synthetic-access');
      const request = { path: address.pathname, query: address.search, method: requestOptions.method,
        body: requestOptions.body === undefined ? undefined : JSON.parse(requestOptions.body),
        headers: plain(requestOptions.headers) };
      requests.push(request);
      if (request.method === 'GET' && request.path === BASE) {
        return response(200, { items: plain([...entries.values()]), pagination: { total: entries.size } });
      }
      const id = request.path.startsWith(BASE + '/') ? request.path.slice(BASE.length + 1) : null;
      const entry = entries.get(id);
      if (request.method === 'GET' && entry) {
        const item = plain(entry), logs = plain(auditRows.get(id) || []);
        const pending = auditGates.get(id); auditGates.delete(id);
        let outcome;
        if (pending) { pending.entered.resolve(request); outcome = await pending.result.promise; }
        if (outcome?.status) return response(outcome.status, outcome.body);
        return response(200, { item, auditLogs: outcome?.logs ?? logs });
      }
      assert.ok((request.method === 'POST' && request.path === BASE) ||
        (request.method === 'PATCH' && entry), 'Unexpected synthetic transport route');
      const pending = nextWrite; nextWrite = undefined;
      let outcome;
      if (pending) { pending.entered.resolve(request); outcome = await pending.result.promise; }
      if (outcome?.status) return response(outcome.status, outcome.body);
      if (request.method === 'POST') {
        assert.ok(!entries.has(C), 'Only one successful creation is needed per fixture');
        const created = { ...plain(request.body), id: C, status: 'draft', version: 1,
          updatedAt: '2026-10-10T00:01:00.000Z', updatedByUserId: 'synthetic-operator' };
        entries.set(C, created); auditRows.set(C, [log('AUDIT_C_CREATED')]);
        return response(201, { item: plain(created) });
      }
      Object.assign(entry, plain(request.body)); entry.version++;
      return response(200, { item: plain(entry) });
    } });
  runInContext(sharedFetchSource, context, { filename: 'actual-backstage-fetch.js' });
  context.window.adminApiPath = value => '/admin/api/v1' + value;
  context.window.backstageFetch = (url, requestOptions) => context.backstageFetch(url, requestOptions).catch(error => {
    errors.push({ error, body: error.body, bodySnapshot: plain(error.body), originalMessage: error.message });
    throw error;
  });
  context.window.confirm = () => assert.fail('Publish/archive/restore are outside this spec');
  runInContext(uiSource, context, { filename: 'backstage-site-content.js' });

  const snapshot = () => plain({
    fields: Object.fromEntries(fields.map(name => [name, form.elements[name].value])),
    selection: { contentKey: form.elements.contentKey.value, existing: form.elements.contentKey.readOnly },
    editorHidden: element('siteContentEditorCard').classList.contains('is-hidden'),
    title: element('siteContentEditorTitle').textContent, meta: element('siteContentEditorMeta').textContent,
    preview: element('siteContentPreview').innerHTML,
    notice: element('siteContentFormStatus').textContent, tone: element('siteContentFormStatus').dataset.tone,
    noticeWrites: element('siteContentFormStatus').texts.length,
    audit: element('siteContentAuditList').innerHTML,
    auditWrites: element('siteContentAuditList').htmlWrites.length,
    auditHidden: element('siteContentAuditSection').hidden,
    buttons: ['Save', 'Publish', 'Archive', 'Restore'].map(name => {
      const control = element(`siteContent${name}Button`); return { disabled: control.disabled, hidden: control.hidden };
    }),
  });
  async function start() {
    assert.equal(requests.length, 0, 'Attaching the actual IIFE must not dispatch');
    context.window.LuminaSiteContent.load(); await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, BASE); assert.equal(requests[0].method, 'GET');
  }
  async function select(id) {
    const row = { getAttribute: name => name === 'data-site-content-id' ? id : null };
    const button = { closest: selector => selector === '[data-site-content-id]' ? row : null };
    await element('siteContentRows').emit('click', {
      target: { closest: selector => selector === '[data-site-content-action]' ? button : null },
    });
    await flush();
    assert.equal(form.elements.contentKey.value, entries.get(id).contentKey);
    assert.equal(form.elements.contentKey.readOnly, true);
    assert.equal(snapshot().editorHidden, false);
  }
  async function dirty(label, key = form.elements.contentKey.value) {
    const expected = { contentKey: key, scope: 'global', pageKey: null, characterSlug: null,
      modelSlug: null, locale: 'ko-KR', title: `LOCAL ${label} title`,
      body: `LOCAL ${label} body\nkept second line`, ctaLabel: `LOCAL ${label} link`,
      ctaHref: '/characters', content: { localDraft: label } };
    for (const name of fields) {
      form.elements[name].value = name === 'content' ? JSON.stringify(expected.content) : expected[name] ?? '';
    }
    await form.emit('input');
    return expected;
  }
  async function newDraft(label) {
    await element('siteContentCreateButton').emit('click');
    assert.equal(form.elements.contentKey.readOnly, false);
    assert.equal(snapshot().editorHidden, false);
    return dirty(label, `cms.synthetic.new.${label}`);
  }
  function delayWrite() {
    assert.equal(nextWrite, undefined);
    nextWrite = { entered: deferred(), result: deferred() };
    return nextWrite;
  }
  function delayAudit(id) {
    assert.equal(auditGates.has(id), false);
    const pending = { entered: deferred(), result: deferred() };
    auditGates.set(id, pending); return pending;
  }
  return { start, select, dirty, newDraft, delayWrite, delayAudit, snapshot, requests, entries, errors, element,
    save: () => form.emit('submit'), close: () => element('siteContentEditorClose').emit('click'),
    mutations: () => requests.filter(request => request.method !== 'GET'),
    lists: () => requests.filter(request => request.method === 'GET' && request.path === BASE),
    refreshCount: () => refreshCalls };
}

function patchPayload(payload) {
  const { contentKey, ...body } = payload;
  return body;
}

function assertWrite(request, id, payload) {
  assert.equal(request.method, id === null ? 'POST' : 'PATCH');
  assert.equal(request.path, id === null ? BASE : `${BASE}/${id}`);
  assert.equal(request.query, '');
  assert.deepEqual(request.body, id === null ? payload : patchPayload(payload));
  assert.equal(request.headers.Authorization, 'Bearer synthetic-access');
  assert.equal(request.headers['Content-Type'], 'application/json');
}

async function assertSettled(f, requestCount, mutationCount) {
  await flush(); await flush();
  assert.equal(f.requests.length, requestCount, 'No automatic request after the explicit operation settles');
  assert.equal(f.mutations().length, mutationCount, 'No automatic mutation retry');
  assert.equal(f.refreshCount(), 0);
}

// Private selectedId is not exported or assigned by the fixture. This explicit bound submit proves its route.
// It runs only AFTER no-retry/snapshot assertions; when closed it is a programmatic probe, not physical click proof.
async function assertSelectionTarget(f, id) {
  const before = f.requests.length, writes = f.mutations().length;
  const pending = f.delayWrite(), task = f.save();
  const request = await pending.entered.promise;
  assert.equal(request.method, id === null ? 'POST' : 'PATCH');
  assert.equal(request.path, id === null ? BASE : `${BASE}/${id}`);
  pending.result.resolve(unavailable()); await task;
  await assertSettled(f, before + 1, writes + 1);
}

function assertConflictCarrier(f, snapshot) {
  assert.equal(f.errors.length, 1);
  const captured = f.errors[0];
  assert.equal(captured.originalMessage, ENGLISH);
  assert.equal(captured.error.status, 409);
  assert.strictEqual(captured.error.body, captured.body);
  assert.deepEqual(plain(captured.error.body), captured.bodySnapshot);
  assert.equal(captured.error.body.error.code, CODE);
  assert.equal(captured.error.message, snapshot.notice);
  assert.match(snapshot.notice, /\ucda9\ub3cc/);
  assert.match(snapshot.notice, /\uc785\ub825.*\uadf8\ub300\ub85c/);
}

for (const destination of ['B', 'closed', 'new-null']) {
  const prefix = destination === 'B' ? 'CMS-EDITOR-ASYNC-RED:' : 'CMS-EDITOR-ASYNC:';
  test(`${prefix} create response after ${destination} cannot take over the newer editor`, options, async () => {
    const f = screen(); await f.start();
    const payload = await f.newDraft('first');
    const write = f.delayWrite(), task = f.save();
    const request = await write.entered.promise; assertWrite(request, null, payload);
    if (destination === 'B') { await f.select(B); await f.dirty('newer-b'); }
    else if (destination === 'closed') await f.close();
    else await f.newDraft('second');
    const before = f.snapshot(), count = f.requests.length, serverB = plain(f.entries.get(B));
    write.result.resolve(); await task;
    await assertSettled(f, count, 1);
    assert.deepEqual(f.snapshot(), before, 'Late create must not change notice/input/preview/audit/selection/visibility');
    assert.deepEqual(f.entries.get(B), serverB);
    assert.equal(f.entries.get(C).contentKey, payload.contentKey, 'Original creation still commits its own payload');
    assert.equal(f.entries.get(C).body, payload.body);
    await assertSelectionTarget(f, destination === 'B' ? B : null);
  });
}

test('CMS-EDITOR-ASYNC: current create completes its intentional new-id handoff and exact payload', options, async () => {
  const f = screen(); await f.start(); const payload = await f.newDraft('current');
  const write = f.delayWrite(), task = f.save();
  const request = await write.entered.promise; assertWrite(request, null, payload);
  write.result.resolve(); await task; await flush();
  const after = f.snapshot();
  assert.equal(after.editorHidden, false);
  assert.deepEqual(after.selection, { contentKey: payload.contentKey, existing: true });
  assert.equal(after.fields.title, payload.title); assert.equal(after.fields.body, payload.body);
  assert.match(after.preview, /LOCAL current title/); assert.match(after.audit, /AUDIT_C_CREATED/);
  assert.equal(after.auditHidden, false); assert.equal(after.tone, 'success');
  assert.match(after.notice, /draft/); assert.equal(f.lists().length, 2);
  for (const [key, value] of Object.entries(payload)) assert.deepEqual(f.entries.get(C)[key], value);
  await assertSettled(f, 4, 1);
  await assertSelectionTarget(f, C);
});

test('CMS-EDITOR-ASYNC: current null-id create 503 preserves its draft without retry', options, async () => {
  const f = screen(); await f.start(); const payload = await f.newDraft('failed');
  const before = f.snapshot(), write = f.delayWrite(), task = f.save();
  assertWrite(await write.entered.promise, null, payload);
  write.result.resolve(unavailable()); await task; await flush();
  const after = f.snapshot();
  assert.deepEqual(after.fields, before.fields); assert.deepEqual(after.selection, before.selection);
  assert.equal(after.preview, before.preview); assert.equal(after.editorHidden, false);
  assert.equal(after.tone, 'error'); assert.equal(after.notice, 'Synthetic service unavailable');
  assert.equal(f.errors.length, 1); assert.equal(f.errors[0].error.status, 503);
  assert.equal(f.entries.has(C), false); assert.equal(f.lists().length, 1);
  await assertSettled(f, 2, 1);
  await assertSelectionTarget(f, null);
});

for (const destination of ['B', 'reopened-A', 'closed']) {
  for (const outcome of ['success', 'conflict', '503']) {
    test(`CMS-EDITOR-ASYNC: patch ${outcome} after ${destination} cannot write the newer editor status`, options, async () => {
      const f = screen(); await f.start(); await f.select(A);
      const payload = await f.dirty('original-a'), write = f.delayWrite(), task = f.save();
      const request = await write.entered.promise; assertWrite(request, A, payload);
      if (destination === 'B') { await f.select(B); await f.dirty('newer-b'); }
      else if (destination === 'reopened-A') { await f.close(); await f.select(A); await f.dirty('newer-a'); }
      else await f.close();
      const before = f.snapshot(), count = f.requests.length, serverB = plain(f.entries.get(B));
      write.result.resolve(outcome === 'conflict' ? conflict() : outcome === '503' ? unavailable() : undefined);
      await task; await assertSettled(f, count, 1);
      assert.deepEqual(f.snapshot(), before, 'Late patch outcome must not change the newer session');
      assert.deepEqual(f.entries.get(B), serverB);
      assert.equal(f.entries.get(A).version, outcome === 'success' ? 8 : 7);
      assert.equal(f.entries.get(A).body, outcome === 'success' ? payload.body : 'SERVER A body');
      await assertSelectionTarget(f, destination === 'B' ? B : destination === 'reopened-A' ? A : null);
    });
  }
}

test('CMS-EDITOR-ASYNC: current patch keeps its input and exact target through normal success', options, async () => {
  const f = screen(); await f.start(); await f.select(A); const payload = await f.dirty('current-a');
  const before = f.snapshot(), write = f.delayWrite(), task = f.save();
  assertWrite(await write.entered.promise, A, payload);
  write.result.resolve(); await task; await flush();
  const after = f.snapshot();
  assert.deepEqual(after.fields, before.fields); assert.deepEqual(after.selection, before.selection);
  assert.equal(after.preview, before.preview); assert.equal(after.audit, before.audit);
  assert.equal(after.editorHidden, false); assert.equal(after.tone, 'success');
  assert.match(after.notice, /draft/); assert.equal(f.entries.get(A).version, 8);
  assert.equal(f.entries.get(A).body, payload.body); assert.equal(f.lists().length, 2);
  await assertSettled(f, 4, 1);
  await assertSelectionTarget(f, A);
});

for (const outcome of ['conflict', '503']) {
  test(`CMS-EDITOR-ASYNC: current patch ${outcome} remains explicit without draft loss or retry`, options, async () => {
    const f = screen(); await f.start(); await f.select(A); const payload = await f.dirty('failed-a');
    const before = f.snapshot(), write = f.delayWrite(), task = f.save();
    assertWrite(await write.entered.promise, A, payload);
    write.result.resolve(outcome === 'conflict' ? conflict() : unavailable()); await task; await flush();
    const after = f.snapshot();
    assert.deepEqual(after.fields, before.fields); assert.deepEqual(after.selection, before.selection);
    assert.equal(after.preview, before.preview); assert.equal(after.audit, before.audit);
    assert.equal(after.editorHidden, false); assert.equal(after.tone, 'error');
    if (outcome === 'conflict') assertConflictCarrier(f, after);
    else assert.equal(after.notice, 'Synthetic service unavailable');
    assert.equal(f.entries.get(A).version, 7); assert.equal(f.lists().length, 1);
    await assertSettled(f, 3, 1);
    await assertSelectionTarget(f, A);
  });
}

async function staleAudit(destination, outcome) {
  const f = screen(); await f.start(); const audit = f.delayAudit(A);
  await f.select(A);
  const request = await audit.entered.promise;
  assert.equal(request.path, `${BASE}/${A}`); assert.equal(request.method, 'GET');
  assert.equal(request.query, ''); assert.equal(request.body, undefined);
  if (destination === 'B') { await f.select(B); await f.dirty('newer-b'); }
  else if (destination === 'reopened-A') { await f.close(); await f.select(A); await f.dirty('newer-a'); }
  else if (destination === 'closed') await f.close();
  else await f.newDraft('newer-null');
  const before = f.snapshot(), count = f.requests.length, serverRows = plain([...f.entries.values()]);
  audit.result.resolve(outcome === 'error' ? auditError() : { logs: outcome === 'empty' ? [] : [log('AUDIT_A_OLD')] });
  await flush(); await assertSettled(f, count, 0);
  assert.deepEqual(f.snapshot(), before, 'Late audit must not write log/empty/error into another editor session');
  assert.deepEqual(plain([...f.entries.values()]), serverRows, 'Audit has no synthetic server writes');
  await assertSelectionTarget(f, destination === 'B' ? B : destination === 'reopened-A' ? A : null);
}

for (const destination of ['B', 'reopened-A']) {
  for (const outcome of ['logs', 'empty', 'error']) {
    const prefix = destination === 'B' && outcome === 'logs' ? 'CMS-EDITOR-ASYNC-RED:' : 'CMS-EDITOR-ASYNC:';
    test(`${prefix} audit ${outcome} after ${destination} cannot replace its current display`, options,
      () => staleAudit(destination, outcome));
  }
}

test('CMS-EDITOR-ASYNC: audit logs arriving after close cannot write the hidden editor', options,
  () => staleAudit('closed', 'logs'));
test('CMS-EDITOR-ASYNC: audit error after new null-id editor cannot repopulate its cleared audit', options,
  () => staleAudit('new-null', 'error'));

for (const outcome of ['logs', 'empty', 'error']) {
  test(`CMS-EDITOR-ASYNC: current audit ${outcome} still renders for its unchanged target`, options, async () => {
    const f = screen(); await f.start(); const audit = f.delayAudit(A); await f.select(A);
    assert.equal((await audit.entered.promise).path, `${BASE}/${A}`);
    const before = f.snapshot(), count = f.requests.length, serverRows = plain([...f.entries.values()]);
    audit.result.resolve(outcome === 'error' ? auditError() : { logs: outcome === 'empty' ? [] : [log('AUDIT_A_CURRENT_RESULT')] });
    await flush(); await assertSettled(f, count, 0);
    const after = f.snapshot();
    assert.deepEqual(after.fields, before.fields); assert.deepEqual(after.selection, before.selection);
    assert.equal(after.preview, before.preview); assert.equal(after.notice, before.notice);
    assert.equal(after.editorHidden, false); assert.equal(after.auditHidden, false);
    assert.ok(after.auditWrites > before.auditWrites);
    if (outcome === 'logs') { assert.match(after.audit, /AUDIT_A_CURRENT_RESULT/); assert.match(after.audit, /CURRENT_RESULT\.field/); }
    else if (outcome === 'empty') assert.match(after.audit, /\uc544\uc9c1 \uae30\ub85d\ub41c/);
    else assert.match(after.audit, /Synthetic audit unavailable/);
    assert.deepEqual(plain([...f.entries.values()]), serverRows);
    await assertSelectionTarget(f, A);
  });
}

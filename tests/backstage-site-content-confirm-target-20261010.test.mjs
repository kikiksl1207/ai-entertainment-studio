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
const A = '00000000-0000-4000-8000-000000000601';
const B = '00000000-0000-4000-8000-000000000602';
const CODE = 'SITE_CONTENT_REVISION_CONFLICT';
const ENGLISH = 'Site content changed; reload its current revision before trying again';
const fields = ['contentKey', 'scope', 'locale', 'pageKey', 'characterSlug', 'modelSlug',
  'title', 'body', 'ctaLabel', 'ctaHref', 'content'];
const actions = [
  { name: 'publish', initial: 'draft', final: 'published', success: /\ubc1c\ud589\ub418\uc5c8/ },
  { name: 'archive', initial: 'published', final: 'archived', success: /\ubcf4\uad00\ub418\uc5c8/ },
  { name: 'restore', initial: 'archived', final: 'draft', success: /draft.*\ubcf5\uad6c/ },
];
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const conflict = () => ({ status: 409, body: { success: false, error: {
  code: CODE, message: ENGLISH, details: { id: A, expectedVersion: 7, reloadRequired: true },
} } });
const unavailable = () => ({ status: 503, body: { success: false, error: {
  code: 'SYNTHETIC_UNAVAILABLE', message: 'Synthetic service unavailable',
} } });

class Element {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.readOnly = false;
    this.innerHTML = '';
    this.texts = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name) };
  }
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

// Full product IIFE and actual shared fetch; DOM, confirmation, auth and transport are synthetic.
// Pending-list row events model the selection seam, not physical clickability of replaced rows.
function screen(action) {
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
  const entries = new Map([A, B].map((id, index) => [id, {
    id, contentKey: `cms.synthetic.${index ? 'b' : 'a'}`, scope: 'global', locale: 'ko-KR',
    pageKey: null, characterSlug: null, modelSlug: null, title: `SERVER ${index ? 'B' : 'A'} title`,
    body: `SERVER ${index ? 'B' : 'A'} body`, ctaLabel: null, ctaHref: null, content: { server: true },
    status: action.initial, version: index ? 11 : 7, updatedAt: '2026-10-10T00:00:00.000Z',
    updatedByUserId: 'synthetic-operator',
  }]));
  const requests = [], confirmations = [], errors = [];
  let refreshCalls = 0, nextWrite, nextList;
  const auth = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', user: { id: 'synthetic-operator' } };
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const listBody = () => ({ items: plain([...entries.values()]), pagination: { total: 2 } });
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
    fetch: async (url, options) => {
      const address = new URL(url);
      assert.equal(address.origin, 'https://offline.invalid');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access');
      const request = { path: address.pathname, query: address.search, method: options.method,
        body: options.body === undefined ? undefined : JSON.parse(options.body), headers: plain(options.headers) };
      requests.push(request);
      if (request.method === 'GET' && request.path === BASE) {
        const pending = nextList; nextList = undefined;
        if (pending) {
          pending.entered.resolve(request);
          const outcome = await pending.result.promise;
          if (outcome?.status) return response(outcome.status, outcome.body);
        }
        return response(200, listBody());
      }
      const entry = entries.get(request.path.slice(BASE.length + 1));
      if (request.method === 'GET' && entry) return response(200, { item: plain(entry), auditLogs: [] });
      const route = request.path.match(new RegExp('^' + BASE + '/([^/]+)/(publish|archive|restore)$'));
      assert.ok(route && request.method === 'POST', 'Unexpected synthetic transport route');
      const pending = nextWrite; nextWrite = undefined;
      let outcome;
      if (pending) { pending.entered.resolve(request); outcome = await pending.result.promise; }
      if (outcome?.status) return response(outcome.status, outcome.body);
      const target = entries.get(route[1]);
      if (!target) return response(404, { error: { message: 'Synthetic entry unavailable' } });
      target.status = route[2] === 'publish' ? 'published' : route[2] === 'archive' ? 'archived' : 'draft';
      target.version++;
      return response(201, { item: plain(target) });
    } });
  runInContext(sharedFetchSource, context, { filename: 'actual-backstage-fetch.js' });
  context.window.adminApiPath = value => '/admin/api/v1' + value;
  context.window.backstageFetch = (url, options) => context.backstageFetch(url, options).catch(error => {
    errors.push({ error, body: error.body, bodySnapshot: plain(error.body), originalMessage: error.message });
    throw error;
  });
  context.window.openBackstageConfirm = options => confirmations.push(options);
  context.window.confirm = () => assert.fail('Expected deferred actual confirmation callback');
  runInContext(uiSource, context, { filename: 'backstage-site-content.js' });

  const snapshot = () => plain({
    fields: Object.fromEntries(fields.map(name => [name, form.elements[name].value])),
    readOnly: form.elements.contentKey.readOnly,
    editorHidden: element('siteContentEditorCard').classList.contains('is-hidden'),
    title: element('siteContentEditorTitle').textContent, meta: element('siteContentEditorMeta').textContent,
    preview: element('siteContentPreview').innerHTML,
    notice: element('siteContentFormStatus').textContent, tone: element('siteContentFormStatus').dataset.tone,
    noticeWrites: element('siteContentFormStatus').texts.length,
    buttons: ['Save', 'Publish', 'Archive', 'Restore'].map(name => {
      const control = element(`siteContent${name}Button`); return { disabled: control.disabled, hidden: control.hidden };
    }),
  });
  async function select(id) {
    const row = { getAttribute: name => name === 'data-site-content-id' ? id : null };
    const button = { closest: selector => selector === '[data-site-content-id]' ? row : null };
    await element('siteContentRows').emit('click', {
      target: { closest: selector => selector === '[data-site-content-action]' ? button : null },
    });
    await flush();
    assert.equal(form.elements.contentKey.value, entries.get(id).contentKey);
    assert.equal(snapshot().editorHidden, false);
  }
  async function dirty(label) {
    const values = { title: `LOCAL ${label} title`, body: `LOCAL ${label} body\nkept second line`,
      ctaLabel: `LOCAL ${label} link`, ctaHref: '/characters', content: '{"localDraft":true}' };
    for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
    await form.emit('input');
  }
  async function start() {
    assert.equal(requests.length, 0, 'Attaching IIFE must not dispatch');
    context.window.LuminaSiteContent.load(); await flush();
    assert.equal(requests.length, 1);
    await select(A); await dirty('A');
  }
  async function prompt() {
    const writes = requests.filter(request => request.method !== 'GET').length;
    await element(`siteContent${action.name[0].toUpperCase() + action.name.slice(1)}Button`).emit('click');
    assert.equal(confirmations.length, 1);
    assert.equal(typeof confirmations[0].onConfirm, 'function');
    assert.equal(requests.filter(request => request.method !== 'GET').length, writes, 'No write before explicit confirmation');
  }
  function accept() { assert.equal(confirmations.length, 1); return confirmations.shift().onConfirm(); }
  function gate(kind) {
    const pending = { entered: deferred(), result: deferred() };
    if (kind === 'write') { assert.equal(nextWrite, undefined); nextWrite = pending; }
    else { assert.equal(nextList, undefined); nextList = pending; }
    return pending;
  }
  return { start, select, dirty, prompt, accept, snapshot, requests, entries, errors, element,
    close: () => element('siteContentEditorClose').emit('click'),
    filter: () => filters.emit('submit'), delayWrite: () => gate('write'), delayList: () => gate('list'),
    mutations: () => requests.filter(request => request.method !== 'GET'),
    lists: () => requests.filter(request => request.method === 'GET' && request.path === BASE),
    refreshCount: () => refreshCalls };
}

function assertMutation(f, action) {
  assert.equal(f.mutations().length, 1, 'Exactly one confirmed write, never a replay or B write');
  const request = f.mutations()[0];
  assert.equal(request.path, `${BASE}/${A}/${action.name}`);
  assert.equal(request.method, 'POST');
  assert.equal(request.query, '');
  assert.deepEqual(request.body, action.name === 'restore' ? { status: 'draft' } : undefined);
  assert.equal(request.headers['Content-Type'], action.name === 'restore' ? 'application/json' : undefined);
  assert.equal(f.refreshCount(), 0);
}

function assertBUnchanged(f, before, serverB) {
  assert.deepEqual(f.snapshot(), before, 'A result must not change B inputs, preview, notice, controls or editor');
  assert.deepEqual(f.entries.get(B), serverB, 'Synthetic B server row must not receive A operation');
}

for (const action of actions) {
  const prefix = action.name === 'publish' ? 'CMS-CONFIRM-TARGET-RED:' : 'CMS-CONFIRM-TARGET:';
  test(`${prefix} ${action.name} confirmation cannot switch its write from A to B`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    await f.select(B); await f.dirty('B');
    const before = f.snapshot(), serverB = plain(f.entries.get(B)), reads = f.requests.length;
    await f.accept(); await flush();
    assert.equal(f.mutations().length, 0, 'Changing selection before confirm cancels the write');
    assert.equal(f.requests.length, reads, 'Cancelled confirmation must not refresh list or audit');
    assertBUnchanged(f, before, serverB); assert.equal(f.refreshCount(), 0);
  });

  test(`CMS-CONFIRM-TARGET: ${action.name} confirmation after editor close is cancelled without a request`, async () => {
    const f = screen(action); await f.start(); await f.prompt(); await f.close();
    const before = f.snapshot(), reads = f.requests.length;
    await f.accept(); await flush();
    assert.equal(f.mutations().length, 0); assert.equal(f.requests.length, reads);
    assert.deepEqual(f.snapshot(), before); assert.equal(f.refreshCount(), 0);
  });

  test(`CMS-CONFIRM-TARGET: ${action.name} old confirmation cannot activate a reopened A editor`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    await f.select(B); await f.select(A); await f.dirty('REOPENED A');
    const before = f.snapshot(), serverA = plain(f.entries.get(A)), reads = f.requests.length;
    await f.accept(); await flush();
    assert.equal(f.mutations().length, 0, 'Same id after reselect is a different editor epoch');
    assert.equal(f.requests.length, reads); assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.entries.get(A), serverA); assert.equal(f.refreshCount(), 0);
  });

  for (const outcome of ['success', 'conflict']) {
    test(`CMS-CONFIRM-TARGET: ${action.name} ${outcome} arriving after B selection cannot affect B`, async () => {
      const f = screen(action); await f.start(); await f.prompt();
      const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
      await f.select(B); await f.dirty('B');
      const before = f.snapshot(), serverB = plain(f.entries.get(B)), reads = f.lists().length;
      write.result.resolve(outcome === 'conflict' ? conflict() : undefined); await task; await flush();
      assertMutation(f, action); assert.equal(f.lists().length, reads, 'Stale write outcome must not start a list refresh');
      assertBUnchanged(f, before, serverB);
      assert.equal(f.entries.get(A).status, outcome === 'success' ? action.final : action.initial);
    });

    test(`CMS-CONFIRM-TARGET: ${action.name} old ${outcome} cannot affect A reopened during its write`, async () => {
      const f = screen(action); await f.start(); await f.prompt();
      const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
      await f.select(B); await f.select(A); await f.dirty('REOPENED A');
      const before = f.snapshot(), reads = f.lists().length;
      write.result.resolve(outcome === 'conflict' ? conflict() : undefined); await task; await flush();
      assertMutation(f, action); assert.equal(f.lists().length, reads);
      assert.deepEqual(f.snapshot(), before, 'Old A outcome must not overwrite the new A editor');
      assert.equal(f.entries.get(A).status, outcome === 'success' ? action.final : action.initial);
      assert.equal(f.entries.get(B).version, 11);
    });
  }

  test(`CMS-CONFIRM-TARGET: ${action.name} pending list result cannot reopen or close selected B`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const list = f.delayList(), task = f.accept(); await list.entered.promise;
    await f.select(B); await f.dirty('B');
    const before = f.snapshot(), serverB = plain(f.entries.get(B));
    list.result.resolve(); await task; await flush();
    assertMutation(f, action); assert.equal(f.lists().length, 2);
    assertBUnchanged(f, before, serverB);
  });

  test(`CMS-CONFIRM-TARGET: ${action.name} old list result cannot reset A reopened during list refresh`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const list = f.delayList(), task = f.accept(); await list.entered.promise;
    await f.select(B); await f.select(A); await f.dirty('REOPENED A');
    const before = f.snapshot(); list.result.resolve(); await task; await flush();
    assertMutation(f, action); assert.equal(f.lists().length, 2);
    assert.deepEqual(f.snapshot(), before, 'Post-list guard must bind epoch as well as entry id');
    assert.equal(f.entries.get(B).version, 11);
  });

  test(`CMS-CONFIRM-TARGET: ${action.name} deferred success still completes for the unchanged target A`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const write = f.delayWrite(), list = f.delayList(), task = f.accept();
    await write.entered.promise; write.result.resolve(); await list.entered.promise;
    list.result.resolve(); await task; await flush();
    assertMutation(f, action); assert.equal(f.lists().length, 2);
    assert.equal(f.entries.get(A).status, action.final); assert.equal(f.entries.get(A).version, 8);
    assert.ok(f.element('siteContentFormStatus').texts.some(text => action.success.test(text)));
    assert.equal(f.snapshot().editorHidden, action.name === 'archive');
    if (action.name !== 'archive') {
      assert.equal(f.snapshot().fields.contentKey, f.entries.get(A).contentKey);
      assert.equal(f.snapshot().fields.title, f.entries.get(A).title);
      assert.match(f.snapshot().meta, /\ubc84\uc804 8/);
    }
  });

  test(`CMS-CONFIRM-TARGET: ${action.name} deferred current A conflict keeps Korean recovery and original carrier`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const fieldsBefore = f.snapshot(), write = f.delayWrite(), task = f.accept();
    await write.entered.promise; write.result.resolve(conflict()); await task; await flush();
    assertMutation(f, action); assert.equal(f.lists().length, 1);
    const after = f.snapshot();
    assert.deepEqual(after.fields, fieldsBefore.fields); assert.equal(after.preview, fieldsBefore.preview);
    assert.equal(after.editorHidden, false); assert.equal(after.tone, 'error');
    assert.match(after.notice, /\ucda9\ub3cc/); assert.match(after.notice, /\uc785\ub825.*\uadf8\ub300\ub85c/);
    assert.equal(f.errors.length, 1);
    const captured = f.errors[0];
    assert.equal(captured.originalMessage, ENGLISH); assert.equal(captured.error.status, 409);
    assert.strictEqual(captured.error.body, captured.body);
    assert.deepEqual(plain(captured.error.body), captured.bodySnapshot);
    assert.equal(captured.error.body.error.code, CODE); assert.equal(captured.error.message, after.notice);
  });
}

test('CMS-CONFIRM-TARGET: closing the editor during a publish write suppresses its late UI outcome', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  const write = f.delayWrite(), task = f.accept(); await write.entered.promise; await f.close();
  const before = f.snapshot(); write.result.resolve(); await task; await flush();
  assertMutation(f, action); assert.equal(f.lists().length, 1); assert.deepEqual(f.snapshot(), before);
});

test('CMS-CONFIRM-TARGET: closing the editor during archive list refresh does not restore an editor', async () => {
  const action = actions[1], f = screen(action); await f.start(); await f.prompt();
  const list = f.delayList(), task = f.accept(); await list.entered.promise; await f.close();
  const before = f.snapshot(); list.result.resolve(); await task; await flush();
  assertMutation(f, action); assert.deepEqual(f.snapshot(), before); assert.equal(f.snapshot().editorHidden, true);
});

test('CMS-CONFIRM-TARGET: failed archive list refresh cannot close B or overwrite its notice', async () => {
  const action = actions[1], f = screen(action); await f.start(); await f.prompt();
  const list = f.delayList(), task = f.accept(); await list.entered.promise;
  await f.select(B); await f.dirty('B'); const before = f.snapshot(), serverB = plain(f.entries.get(B));
  list.result.resolve(unavailable()); await task; await flush();
  assertMutation(f, action); assertBUnchanged(f, before, serverB);
  assert.match(f.element('siteContentRows').innerHTML, /\ubaa9\ub85d\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4/);
});

test('CMS-CONFIRM-TARGET: stale publish 503 is not displayed as B failure', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
  await f.select(B); await f.dirty('B'); const before = f.snapshot(), serverB = plain(f.entries.get(B));
  write.result.resolve(unavailable()); await task; await flush();
  assertMutation(f, action); assert.equal(f.lists().length, 1); assertBUnchanged(f, before, serverB);
});

test('CMS-CONFIRM-TARGET: current A publish 503 remains an explicit failure without replay', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  const before = f.snapshot(), write = f.delayWrite(), task = f.accept();
  await write.entered.promise; write.result.resolve(unavailable()); await task; await flush();
  assertMutation(f, action); assert.equal(f.lists().length, 1); assert.equal(f.snapshot().tone, 'error');
  assert.equal(f.snapshot().notice, 'Synthetic service unavailable');
  assert.deepEqual(f.snapshot().fields, before.fields); assert.equal(f.snapshot().preview, before.preview);
  assert.equal(f.snapshot().editorHidden, false); assert.equal(f.entries.get(A).status, action.initial);
});

test('CMS-CONFIRM-TARGET: explicit list refresh with B selected cannot activate an older A confirmation', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  const list = f.delayList(); await f.filter(); await list.entered.promise;
  await f.select(B); await f.dirty('B'); const before = f.snapshot(), serverB = plain(f.entries.get(B));
  await f.accept(); assert.equal(f.mutations().length, 0);
  list.result.resolve(); await flush();
  assert.equal(f.lists().length, 2); assertBUnchanged(f, before, serverB); assert.equal(f.refreshCount(), 0);
});

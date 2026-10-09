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
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'Missing actual shared fetch function');
const sharedFetchSource = sharedSource.slice(helperStart, helperEnd);

const BASE = '/admin/api/v1/backstage/site-content';
const ENTRY_ID = '00000000-0000-4000-8000-000000000601';
const CREATED_ID = '00000000-0000-4000-8000-000000000602';
const CODE = 'SITE_CONTENT_REVISION_CONFLICT';
const ENGLISH = 'Site content changed; reload its current revision before trying again';
const LIST_FAILURE_TEXT = '\ubaa9\ub85d\uc744 \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4';
const LIST_EMPTY_TEXT = '\ud45c\uc2dc\ud560 \uc0ac\uc774\ud2b8 \ubb38\uad6c\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.';
const LIST_FAILURE_DETAIL = 'Synthetic list failure <img src=x onerror="synthetic()"> & detail';
const actions = [
  { name: 'edit', method: 'PATCH', suffix: '', status: 'draft', success: /\uc800\uc7a5\ub418\uc5c8/ },
  { name: 'publish', method: 'POST', suffix: '/publish', status: 'draft', success: /\ubc1c\ud589\ub418\uc5c8/ },
  { name: 'archive', method: 'POST', suffix: '/archive', status: 'published', success: /\ubcf4\uad00\ub418\uc5c8/ },
  { name: 'restore', method: 'POST', suffix: '/restore', status: 'archived', success: /draft.*\ubcf5\uad6c/ },
];
const fieldNames = ['contentKey', 'scope', 'locale', 'pageKey', 'characterSlug', 'modelSlug',
  'title', 'body', 'ctaLabel', 'ctaHref', 'content'];
const dirty = { title: '  LOCAL title  ', body: 'LOCAL unsaved body\nsecond line  ',
  ctaLabel: ' LOCAL link ', ctaHref: '/characters', content: '{\n  "localDraft": true\n}' };
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Element {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.value = '';
    this.readOnly = false;
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
    assert.ok(type !== 'click' || (!this.disabled && !this.hidden), 'Fixture clicked an unavailable control');
    const listeners = this.listeners.get(type) || [];
    assert.equal(listeners.length, 1, `Expected actual bound ${type} listener`);
    let prevented = false;
    const event = { target: this, preventDefault() { prevented = true; }, ...extra };
    await listeners[0].call(this, event);
    if (type === 'submit') assert.equal(prevented, true);
  }
  scrollIntoView() {}
}

function makeForm(names, defaults = {}) {
  const form = new Element();
  form.elements = Object.fromEntries(names.map(name => {
    const element = new Element();
    element.value = defaults[name] || '';
    return [name, element];
  }));
  const counters = { title: new Element(), body: new Element() };
  form.querySelector = selector => {
    if (selector === '[data-counter="title"]') return counters.title;
    if (selector === '[data-counter="body"]') return counters.body;
    return null;
  };
  form.reset = () => {
    for (const name of names) form.elements[name].value = defaults[name] || '';
  };
  return form;
}

function failure(status = 409, code = CODE, message = ENGLISH) {
  return { kind: 'http', status, body: { success: false, error: { code, message,
    messageKey: 'siteContent.error.revisionConflict', statusCode: status,
    details: { id: ENTRY_ID, expectedVersion: 7, expectedStatus: 'draft', reloadRequired: true } } } };
}

// Actual UI/shared functions; only DOM, transport, auth state and refresh are synthetic.
// No operating JWT, account grant, backend lifecycle/CAS or real network is exercised.
function screen(action = actions[0]) {
  const ids = ['siteContentRows', 'siteContentTotalNote', 'siteContentCountBadge',
    'siteContentEditorCard', 'siteContentEditorTitle', 'siteContentEditorMeta', 'siteContentAuditSection',
    'siteContentAuditList', 'siteContentPreview', 'siteContentFormStatus', 'siteContentCreateButton',
    'siteContentEditorClose', 'siteContentSaveButton', 'siteContentPublishButton',
    'siteContentArchiveButton', 'siteContentRestoreButton'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const form = makeForm(fieldNames, { scope: 'global', locale: 'ko-KR' });
  const filters = makeForm(['pageKey', 'scope', 'characterSlug', 'modelSlug', 'locale', 'search'], { locale: 'ko-KR' });
  elements.set('siteContentForm', form);
  elements.set('siteContentFilterForm', filters);
  elements.get('siteContentEditorCard').classList.add('is-hidden');
  const requests = [], confirmations = [], capturedErrors = [], constructedErrors = [];
  let refreshCalls = 0, nextList, outcome = { kind: 'success' };
  let auth = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', user: { id: 'synthetic-operator' } };
  let entry = { id: ENTRY_ID, contentKey: 'cms.synthetic.entry', scope: 'global', locale: 'ko-KR',
    pageKey: null, characterSlug: null, modelSlug: null, title: 'SERVER title', body: 'SERVER body',
    ctaLabel: null, ctaHref: null, content: { server: true }, status: action.status, version: 7,
    updatedAt: '2026-10-10T00:00:00.000Z', updatedByUserId: 'synthetic-operator' };
  const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const listBody = () => ({ items: [plain(entry)], pagination: { total: 1 } });
  class RecordedError extends Error {
    constructor(message) { super(message); constructedErrors.push(this); }
  }
  class FixtureFormData {
    constructor(target) { this.target = target; }
    get(name) { return this.target.elements[name]?.value ?? null; }
  }
  const context = createContext({ window: {}, Error: RecordedError, URL, FormData: FixtureFormData,
    setTimeout, clearTimeout, BACKSTAGE_API_BASE: 'https://offline.invalid', backstageAuthEpoch: 0,
    dashboardView: { classList: { contains: () => false } }, getBackstageAuth: () => auth,
    refreshBackstageAuthOnce: async () => { refreshCalls++; return null; },
    document: { readyState: 'complete', getElementById: id => elements.get(id) || null,
      querySelectorAll: () => [], addEventListener() { assert.fail('Unexpected deferred DOM initialization'); } },
    fetch: async (url, options) => {
      const address = new URL(url);
      assert.equal(address.origin, 'https://offline.invalid');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access');
      const body = options.body === undefined ? undefined : JSON.parse(options.body);
      const request = { path: address.pathname, query: address.search, method: options.method, body };
      requests.push(request);
      if (request.method === 'GET' && request.path === BASE) {
        if (nextList) {
          const pending = nextList;
          nextList = undefined;
          return response(200, await pending.promise);
        }
        return response(200, listBody());
      }
      if (request.method === 'GET' && request.path === BASE + '/' + entry.id) {
        return response(200, { item: plain(entry), auditLogs: [] });
      }
      assert.ok(request.method === 'PATCH' || request.method === 'POST', 'Unexpected transport method');
      if (outcome.kind === 'http') return response(outcome.status, outcome.body);
      if (outcome.kind === 'network') throw outcome.error;
      if (outcome.kind === 'session') {
        auth = { ...auth, user: { id: 'synthetic-different-operator' } };
        return response(409, failure().body);
      }
      if (request.method === 'POST' && request.path === BASE) {
        entry = { ...entry, ...body, id: CREATED_ID, status: 'draft', version: 1 };
      } else {
        assert.equal(request.path, BASE + '/' + ENTRY_ID + action.suffix);
        assert.equal(request.method, action.method);
        if (action.name === 'edit') entry = { ...entry, ...body };
        if (action.name === 'publish') entry.status = 'published';
        if (action.name === 'archive') entry.status = 'archived';
        if (action.name === 'restore') {
          assert.deepEqual(body, { status: 'draft' });
          entry.status = 'draft';
        }
        entry.version++;
      }
      return response(request.method === 'POST' ? 201 : 200, { item: plain(entry) });
    } });
  runInContext(sharedFetchSource, context, { filename: 'actual-backstage-fetch.js' });
  context.window.adminApiPath = value => '/admin/api/v1' + value;
  context.window.backstageFetch = (url, options) => context.backstageFetch(url, options).catch(error => {
    capturedErrors.push({ error, status: error.status, code: error.code, body: error.body,
      bodySnapshot: plain(error.body), originalMessage: error.message });
    throw error;
  });
  context.window.openBackstageConfirm = options => confirmations.push(options);
  context.window.confirm = () => { assert.fail('Expected actual confirmation callback path'); };
  runInContext(uiSource, context, { filename: 'backstage-site-content.js' });

  const element = id => elements.get(id);
  const snapshot = () => ({ fields: Object.fromEntries(fieldNames.map(name => [name, form.elements[name].value])),
    contentKeyReadOnly: form.elements.contentKey.readOnly, editorHidden: element('siteContentEditorCard').classList.contains('is-hidden'),
    meta: element('siteContentEditorMeta').textContent, preview: element('siteContentPreview').innerHTML });
  async function typeDraft() {
    for (const [name, value] of Object.entries(dirty)) form.elements[name].value = value;
    await form.emit('input');
  }
  async function start(select = true) {
    assert.equal(requests.length, 0, 'IIFE attachment must not dispatch by itself');
    context.window.LuminaSiteContent.load();
    await flush();
    assert.equal(requests.length, 1);
    assert.ok(element('siteContentRows').innerHTML.includes(entry.contentKey));
    if (select) {
      const row = { getAttribute: name => name === 'data-site-content-id' ? ENTRY_ID : null };
      const button = { closest: selector => selector === '[data-site-content-id]' ? row : null };
      await element('siteContentRows').emit('click', {
        target: { closest: selector => selector === '[data-site-content-action]' ? button : null },
      });
      await flush();
      assert.equal(requests.length, 2, 'Selecting the actual row also reads its audit');
      assert.equal(form.elements.contentKey.value, entry.contentKey);
      assert.equal(element('siteContentEditorCard').classList.contains('is-hidden'), false);
    }
  }
  async function act() {
    if (action.name === 'edit') await form.emit('submit');
    else {
      const id = 'siteContent' + action.name[0].toUpperCase() + action.name.slice(1) + 'Button';
      await element(id).emit('click');
      assert.equal(confirmations.length, 1);
      await confirmations.shift().onConfirm();
    }
    await flush();
  }
  return { start, act, typeDraft, snapshot, element, form, filters, requests, capturedErrors, constructedErrors,
    listBody, setOutcome: value => { outcome = value; }, refreshCount: () => refreshCalls,
    filter: () => filters.emit('submit'), delayList: () => { nextList = deferred(); return nextList; } };
}

function assertOneUnreplayedMutation(f, action, start) {
  const calls = f.requests.slice(start);
  assert.equal(calls.length, 1, 'Rejected mutation must not retry or automatically fetch list/detail');
  assert.equal(calls[0].method, action.method);
  assert.equal(calls[0].path, BASE + '/' + ENTRY_ID + action.suffix);
  if (action.name === 'edit') {
    assert.equal(calls[0].body.title, dirty.title);
    assert.equal(calls[0].body.body, dirty.body);
    assert.deepEqual(calls[0].body.content, { localDraft: true });
    assert.equal(Object.hasOwn(calls[0].body, 'contentKey'), false);
  }
  if (action.name === 'restore') assert.deepEqual(calls[0].body, { status: 'draft' });
}

function assertPreservedCarrier(f) {
  assert.equal(f.capturedErrors.length, 1);
  const captured = f.capturedErrors[0];
  assert.equal(captured.error.status, captured.status);
  assert.equal(captured.error.code, captured.code);
  assert.strictEqual(captured.error.body, captured.body);
  assert.deepEqual(plain(captured.error.body), captured.bodySnapshot);
  if (captured.error instanceof TypeError) assert.equal(f.constructedErrors.length, 0);
  else {
    assert.equal(f.constructedErrors.length, 1, 'No replacement Error may discard the shared carrier');
    assert.strictEqual(f.constructedErrors[0], captured.error);
  }
  return captured;
}

function assertRecovery(f) {
  const status = f.element('siteContentFormStatus');
  assert.equal(status.dataset.tone, 'error');
  const captured = assertPreservedCarrier(f);
  assert.equal(captured.status, 409);
  assert.equal(captured.body.error.code, CODE);
  assert.equal(captured.error.message, status.textContent, 'Only the original carrier message is localized');
  assert.equal(f.refreshCount(), 0);
  assert.match(status.textContent, /\ucda9\ub3cc|\ubcc0\uacbd/, 'Korean conflict explanation required');
  assert.match(status.textContent, /\uc720\uc9c0|\ubcf4\uc874|\uadf8\ub300\ub85c|\ub0a8\uc544/, 'Explain retained inputs');
  assert.match(status.textContent, /\ucd5c\uc2e0|\ubaa9\ub85d/, 'Explain checking the current entry/list');
  assert.ok(!status.textContent.includes(ENGLISH), 'Do not leave the known English conflict as recovery guidance');
}

for (const action of actions) test(`CMS-CONFLICT-RED: ${action.name} localizes the exact safe409 while retaining its draft and carrier`, async () => {
  const f = screen(action);
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length;
  f.setOutcome(failure());
  await f.act();
  assertOneUnreplayedMutation(f, action, count);
  assert.deepEqual(f.snapshot(), before);
  assertRecovery(f);
});

for (const action of actions) test(`successful ${action.name} keeps its existing dispatch and post-success behavior`, async () => {
  const f = screen(action);
  await f.start();
  await f.typeDraft();
  const count = f.requests.length;
  await f.act();
  const calls = f.requests.slice(count), mutations = calls.filter(call => call.method !== 'GET');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].path, BASE + '/' + ENTRY_ID + action.suffix);
  assert.equal(mutations[0].method, action.method);
  assert.equal(calls.filter(call => call.method === 'GET' && call.path === BASE).length, 1);
  assert.ok(f.element('siteContentFormStatus').texts.some(text => action.success.test(text)));
  assert.equal(f.capturedErrors.length, 0);
  assert.equal(f.refreshCount(), 0);
  assert.equal(f.element('siteContentEditorCard').classList.contains('is-hidden'), action.name === 'archive');
  if (action.name === 'edit') assert.equal(f.form.elements.body.value, dirty.body);
  if (action.name === 'publish' || action.name === 'restore') {
    assert.equal(f.form.elements.body.value, 'SERVER body', 'Existing success refresh still opens the server item');
    assert.equal(calls.filter(call => call.method === 'GET' && call.path === BASE + '/' + ENTRY_ID).length, 1);
  }
});

test('successful new draft creation keeps its POST payload, adopted id and normal list/audit reads', async () => {
  const f = screen();
  await f.start(false);
  await f.element('siteContentCreateButton').emit('click');
  f.form.elements.contentKey.value = 'cms.synthetic.created';
  await f.typeDraft();
  const count = f.requests.length;
  await f.form.emit('submit');
  await flush();
  const calls = f.requests.slice(count), mutations = calls.filter(call => call.method !== 'GET');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].method, 'POST');
  assert.equal(mutations[0].path, BASE);
  assert.equal(mutations[0].body.contentKey, 'cms.synthetic.created');
  assert.equal(mutations[0].body.title, dirty.title);
  assert.equal(f.form.elements.contentKey.value, 'cms.synthetic.created');
  assert.equal(f.form.elements.contentKey.readOnly, true);
  assert.ok(f.element('siteContentEditorMeta').textContent.includes('draft'));
  assert.equal(calls.filter(call => call.method === 'GET' && call.path === BASE).length, 1);
  assert.equal(calls.filter(call => call.method === 'GET' && call.path === BASE + '/' + CREATED_ID).length, 1);
  assert.equal(f.capturedErrors.length, 0);
});

const otherFailures = [
  ['401 with the CMS code', failure(401, CODE, 'Synthetic expired session')],
  ['403 with the CMS code', failure(403, CODE, 'Synthetic permission denied')],
  ['400 with the CMS code', failure(400, CODE, 'Synthetic invalid request')],
  ['500 with the CMS code', failure(500, CODE, 'Synthetic server failure')],
  ['409 with another code', failure(409, 'OTHER_CONFLICT', 'Synthetic unrelated conflict')],
  ['409 with no code', { kind: 'http', status: 409,
    body: { success: false, error: { message: 'Synthetic generic conflict', details: { reloadRequired: true } } } }],
  ['409 with only a top-level body code', { kind: 'http', status: 409,
    body: { code: CODE, message: 'Synthetic top-level-only conflict' } }],
  ['local session-change409', { kind: 'session' }],
  ['network rejection', { kind: 'network', error: new TypeError('Synthetic network unknown outcome') }],
];
for (const [name, outcome] of otherFailures) test(`${name} keeps its original message/typed fields and does not gain CMS recovery or replay`, async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length;
  f.setOutcome(outcome);
  await f.act();
  assertOneUnreplayedMutation(f, actions[0], count);
  assert.deepEqual(f.snapshot(), before);
  const captured = assertPreservedCarrier(f);
  assert.equal(captured.error.message, captured.originalMessage);
  assert.equal(f.element('siteContentFormStatus').textContent, captured.originalMessage);
  assert.equal(f.element('siteContentFormStatus').dataset.tone, 'error');
  assert.equal(f.refreshCount(), outcome.status === 401 ? 1 : 0, 'Keep the existing 401 refresh attempt only');
  if (outcome.kind === 'network') assert.strictEqual(captured.error, outcome.error);
  if (outcome.kind === 'session') assert.equal(captured.error.code, 'BACKSTAGE_SESSION_CHANGED');
});

test('a second edit after safe409 requires a second explicit submit with the unchanged draft/id', async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  f.setOutcome(failure());
  const count = f.requests.length, before = f.snapshot();
  await f.act();
  assertOneUnreplayedMutation(f, actions[0], count);
  await flush();
  assert.equal(f.requests.length, count + 1);
  await f.act();
  assert.equal(f.requests.length, count + 2);
  assert.deepEqual(f.requests[count + 1], f.requests[count]);
  assert.deepEqual(f.snapshot(), before);
});

function assertListUnavailable(f) {
  const rows = f.element('siteContentRows').innerHTML;
  assert.ok(rows.includes(LIST_FAILURE_TEXT), 'List failure must be visible in the list, not only the editor status');
  assert.ok(!rows.includes(LIST_EMPTY_TEXT), 'An unavailable list is not a confirmed empty result');
  assert.doesNotMatch(rows, /class="row-empty"|data-site-content-id=/);
  assert.doesNotMatch(rows, /<(?:img|script)\b/i, 'Untrusted failure details must not become markup');
  if (rows.includes('synthetic()')) {
    assert.ok(rows.includes('&lt;img'));
    assert.ok(rows.includes('&quot;synthetic()&quot;'));
    assert.ok(rows.includes('&amp; detail'));
  }
  assert.match(f.element('siteContentTotalNote').textContent,
    /\ubbf8\ud655\uc778|\ud655\uc778.*(?:\ubd88\uac00|\ubabb|\uc5c6|\uc54a)/, 'Failed read must leave the total explicitly unverified');
  assert.doesNotMatch(f.element('siteContentCountBadge').textContent.trim(), /^\d+$/,
    'A failed read must not assert a numeric zero or stale count');
}

for (const fails of [false, true]) test(`${fails ? 'CMS-LIST-STATUS-RED: late failed' : 'late successful'} explicit list read preserves inputs without replaying the conflicted edit`, async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length, pending = f.delayList();
  const listing = f.filter();
  await flush();
  assert.equal(f.requests.length, count + 1);
  f.setOutcome(failure());
  await f.act();
  assertOneUnreplayedMutation(f, actions[0], count + 1);
  assert.deepEqual(f.snapshot(), before);
  assertRecovery(f);
  const recoveryText = f.element('siteContentFormStatus').textContent;
  if (fails) pending.reject(new TypeError(LIST_FAILURE_DETAIL));
  else pending.resolve(f.listBody());
  await listing;
  await flush();
  assert.equal(f.requests.length, count + 2);
  assert.deepEqual(f.snapshot(), before);
  if (fails) {
    assert.equal(f.element('siteContentFormStatus').textContent, recoveryText);
    assert.equal(f.element('siteContentFormStatus').dataset.tone, 'error');
    assertListUnavailable(f);
    assert.equal(f.refreshCount(), 0);
  } else assert.equal(f.element('siteContentFormStatus').textContent, recoveryText);
});

test('CMS-LIST-STATUS: normal list keeps its confirmed count and editor status', async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length;
  const status = f.element('siteContentFormStatus');
  const notice = status.textContent, tone = status.dataset.tone;
  await f.filter();
  await flush();
  assert.equal(f.requests.length, count + 1);
  assert.equal(f.requests[count].method, 'GET');
  assert.equal(f.requests[count].path, BASE);
  assert.ok(f.element('siteContentRows').innerHTML.includes('cms.synthetic.entry'));
  assert.ok(!f.element('siteContentRows').innerHTML.includes(LIST_FAILURE_TEXT));
  assert.equal(f.element('siteContentTotalNote').textContent, '\ucd1d 1\uac74');
  assert.equal(f.element('siteContentCountBadge').textContent, '1');
  assert.deepEqual(f.snapshot(), before);
  assert.equal(status.textContent, notice);
  assert.equal(status.dataset.tone, tone);
  assert.equal(f.capturedErrors.length, 0);
  assert.equal(f.refreshCount(), 0);
});

test('CMS-LIST-STATUS: confirmed empty list is distinct from an unavailable list', async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length, pending = f.delayList();
  const status = f.element('siteContentFormStatus');
  const notice = status.textContent, tone = status.dataset.tone;
  await f.filter();
  await flush();
  pending.resolve({ items: [], pagination: { total: 0 } });
  await flush();
  assert.equal(f.requests.length, count + 1);
  assert.equal(f.requests[count].method, 'GET');
  assert.equal(f.requests[count].path, BASE);
  assert.ok(f.element('siteContentRows').innerHTML.includes(LIST_EMPTY_TEXT));
  assert.ok(!f.element('siteContentRows').innerHTML.includes(LIST_FAILURE_TEXT));
  assert.equal(f.element('siteContentTotalNote').textContent, '\ucd1d 0\uac74');
  assert.equal(f.element('siteContentCountBadge').textContent, '0');
  assert.deepEqual(f.snapshot(), before);
  assert.equal(status.textContent, notice);
  assert.equal(status.dataset.tone, tone);
  assert.equal(f.capturedErrors.length, 0);
  assert.equal(f.refreshCount(), 0);
});

test('CMS-LIST-STATUS: explicit filtered read recovers the list without replaying a conflicted edit', async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length;
  f.setOutcome(failure());
  await f.act();
  assertOneUnreplayedMutation(f, actions[0], count);
  assertRecovery(f);
  const status = f.element('siteContentFormStatus'), recoveryText = status.textContent;
  const pending = f.delayList();
  await f.filter();
  await flush();
  pending.reject(new TypeError(LIST_FAILURE_DETAIL));
  await flush();
  assertListUnavailable(f);
  assert.equal(status.textContent, recoveryText);
  assert.equal(status.dataset.tone, 'error');
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.requests.length, count + 2);
  await flush();
  assert.equal(f.requests.length, count + 2, 'List failure must not trigger an automatic retry');
  f.filters.elements.search.value = ' cms.synthetic.entry ';
  f.filters.elements.scope.value = 'global';
  f.filters.elements.locale.value = ' ko-KR ';
  await f.filter();
  await flush();
  const calls = f.requests.slice(count);
  assert.deepEqual(calls.map(call => call.method), ['PATCH', 'GET', 'GET']);
  assert.ok(calls.slice(1).every(call => call.path === BASE));
  const query = new URLSearchParams(calls[2].query);
  assert.equal(query.get('search'), 'cms.synthetic.entry');
  assert.equal(query.get('scope'), 'global');
  assert.equal(query.get('locale'), 'ko-KR');
  assert.equal(query.get('take'), '100');
  assert.ok(f.element('siteContentRows').innerHTML.includes('cms.synthetic.entry'));
  assert.ok(!f.element('siteContentRows').innerHTML.includes(LIST_FAILURE_TEXT));
  assert.equal(f.element('siteContentTotalNote').textContent, '\ucd1d 1\uac74');
  assert.equal(f.element('siteContentCountBadge').textContent, '1');
  assert.equal(status.textContent, recoveryText);
  assert.equal(status.dataset.tone, 'error');
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.refreshCount(), 0);
  await flush();
  assert.equal(f.requests.length, count + 3);
});

test('CMS-LIST-STATUS: successful edit notice survives its failed list refresh', async () => {
  const f = screen();
  await f.start();
  await f.typeDraft();
  const before = f.snapshot(), count = f.requests.length, pending = f.delayList();
  const saving = f.act();
  await flush();
  const status = f.element('siteContentFormStatus'), successText = status.textContent;
  assert.match(successText, actions[0].success, 'Mutation succeeded before the delayed list read failed');
  assert.equal(status.dataset.tone, 'success');
  assert.deepEqual(f.snapshot(), before);
  const listError = new TypeError(LIST_FAILURE_DETAIL);
  pending.reject(listError);
  await saving;
  await flush();
  const calls = f.requests.slice(count);
  assert.deepEqual(calls.map(call => call.method), ['PATCH', 'GET']);
  assert.equal(calls[0].path, BASE + '/' + ENTRY_ID);
  assert.equal(calls[0].body.title, dirty.title);
  assert.equal(calls[0].body.body, dirty.body);
  assert.equal(calls[1].path, BASE);
  assertListUnavailable(f);
  assert.equal(status.textContent, successText);
  assert.equal(status.dataset.tone, 'success');
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.capturedErrors.length, 1);
  assert.strictEqual(f.capturedErrors[0].error, listError);
  assert.equal(f.refreshCount(), 0);
  await flush();
  assert.equal(f.requests.length, count + 2, 'A failed refresh must not retry the successful mutation or list read');
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
function excerpt(name, next) {
  const pattern = value => new RegExp(`^(?:async )?function ${value}\\(`, 'm');
  const start = source.search(pattern(name));
  assert.ok(start >= 0, `Missing actual function: ${name}`);
  const offset = source.slice(start + 1).search(pattern(next));
  assert.ok(offset >= 0, `Missing exact next boundary: ${next}`);
  return source.slice(start, start + 1 + offset);
}
const runtime = [excerpt('closeConfirmModal', 'runPreparedAction'), excerpt('showLogin', 'showDashboard'),
  'this.api = { login: showLogin, close: closeConfirmModal, auth: getBackstageAuth };'].join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
function classes(initial = []) {
  const values = new Set(initial);
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}
function node(initial = {}) {
  const element = { textContent: '', innerHTML: '', value: '', dataset: {}, classList: classes(), isConnected: true,
    remove() { element.isConnected = false; }, ...initial };
  return element;
}
const actor = id => ({ accessToken: 'synthetic-access', user: { id } });
const markerFields = {
  type: 'synthetic-confirm-type', title: 'synthetic-confirm-title', message: 'synthetic-confirm-message',
  payload: '<div><span>synthetic-confirm-payload</span></div>',
};
const emptyFields = { type: '', title: '', message: '', payload: '' };

// Only showLogin/closeConfirmModal are product excerpts. Auth, provider and render helpers are explicit RAM stubs.
function harness() {
  const storage = new Map([
    ['primary-auth', JSON.stringify(actor('synthetic-actor-a'))],
    ['shared-auth', JSON.stringify(actor('synthetic-actor-a'))],
    ['drafts', JSON.stringify({ synthetic: { reason: 'synthetic-saved-draft' } })],
    ['history', JSON.stringify([{ target: 'synthetic-history-target', note: 'synthetic-history-note' }])],
  ]);
  const rows = [node({ classList: classes(['is-selected']) }), node({ classList: classes(['is-selected']) })];
  const status = node({ textContent: 'synthetic-old-users-status' });
  const filter = node({ value: 'test', disabled: false });
  const roots = { userRows: node({ innerHTML: 'synthetic-old-users' }), userRiskRows: node({ innerHTML: 'synthetic-old-risks' }),
    adminRows: node({ innerHTML: 'synthetic-old-operators' }), adminRequestRows: node({ innerHTML: 'synthetic-old-role-history' }) };
  const loadingCalls = [];
  const moreCalls = [];
  let providerAttempts = 0;
  const sidecar = node({ innerHTML: 'synthetic-classification-history' });
  const failedCommands = new Map([['synthetic-command-scope', new Set(['synthetic-uncertain-command'])]]);
  const usedKeys = new Set(['synthetic-used-key']);
  const context = {
    dashboardView: node(), loginView: node({ classList: classes(['is-hidden']) }),
    selectedDetail: { tableId: 'userRows', meta: { userId: 'synthetic-subject' }, row: ['synthetic-detail'] },
    pendingActionPreview: { target: 'synthetic-confirm-target', note: 'synthetic-confirm-note', canRunApi: true,
      apiRequest: { method: 'GET', path: '/synthetic/read-only' } },
    detailPanel: node(), detailType: node({ textContent: 'synthetic-detail-type' }),
    detailTitle: node({ textContent: 'synthetic-detail-title' }), detailList: node({ innerHTML: 'synthetic-detail-list' }),
    detailMemo: node({ value: 'synthetic-detail-memo' }), detailHistoryList: node({ innerHTML: 'synthetic-detail-history' }),
    detailForm: node({ innerHTML: 'synthetic-editable-form', dataset: { draftKey: 'synthetic-bound-draft' } }),
    userClassificationDetail: { node: sidecar, userId: 'synthetic-subject', history: [{ id: 'synthetic-classification-event' }] },
    userClassificationFailedCommands: failedCommands, userClassificationUsedKeys: usedKeys,
    confirmModal: node(), confirmType: node({ textContent: markerFields.type }), confirmTitle: node({ textContent: markerFields.title }),
    confirmMessage: node({ textContent: markerFields.message }), confirmPayload: node({ innerHTML: markerFields.payload }),
    confirmRunButton: node({ textContent: 'synthetic-run-label', disabled: true }),
    googleButtonFallback: node({ hidden: true }), operatorEmail: node({ textContent: 'synthetic-operator@example.invalid' }),
    sectionState: { users: { cursor: 'synthetic-cursor', hasMore: true, rows: ['synthetic-row'], riskRows: ['synthetic-risk'],
      search: 'synthetic-query', classification: 'test', classificationSupported: true } },
    getBackstageAuth() {
      const raw = storage.get('primary-auth') || storage.get('shared-auth');
      return raw ? JSON.parse(raw) : null;
    },
    document: {
      querySelectorAll(selector) { assert.equal(selector, 'tr.is-selected'); return rows.filter(row => row.classList.contains('is-selected')); },
      getElementById(id) {
        if (id === 'users') return { querySelector(selector) { assert.equal(selector, '[data-users-status]'); return status; } };
        if (id === 'usersClassificationFilter') return filter;
        assert.fail(`Unexpected DOM lookup: ${id}`);
      },
    },
    renderLoadingRow(id) { assert.ok(Object.hasOwn(roots, id)); loadingCalls.push(id); roots[id].innerHTML = `synthetic-loading:${id}`; },
    setLoadMore(section, more) { moreCalls.push([section, more]); },
    prepareGoogleLoginButton() { providerAttempts++; return Promise.reject(new Error('synthetic-unavailable-provider')); },
    fetch() { assert.fail('This reset probe must never fetch'); },
  };
  runInNewContext(runtime, context, { filename: 'backstage.js:confirm-scrub-synthetic', timeout: 1000 });
  return { api: context.api, context, storage, rows, roots, status, filter, sidecar, failedCommands, usedKeys, loadingCalls, moreCalls,
    get providerAttempts() { return providerAttempts; },
    fields() { return { type: context.confirmType.textContent, title: context.confirmTitle.textContent,
      message: context.confirmMessage.textContent, payload: context.confirmPayload.innerHTML }; },
    async logout() { storage.delete('primary-auth'); context.api.login(); await Promise.resolve(); await Promise.resolve(); },
    reenter(id) { storage.set('primary-auth', JSON.stringify(actor(id))); context.dashboardView.classList.remove('is-hidden');
      context.loginView.classList.add('is-hidden'); } };
}

test('logout showLogin hides and clears all four prior synthetic confirmation fields', async () => {
  const h = harness();
  assert.deepEqual(h.fields(), markerFields);
  await h.logout();
  assert.equal(h.context.confirmModal.classList.contains('is-hidden'), true);
  assert.equal(h.context.pendingActionPreview, null);
  assert.deepEqual(h.fields(), emptyFields);
  assert.equal(h.context.confirmRunButton.textContent, 'synthetic-run-label');
  assert.equal(h.context.confirmRunButton.disabled, true);
});

test('shared-auth fallback and same/different synthetic actor reentry do not retain confirmation text', async () => {
  for (const id of ['synthetic-actor-a', 'synthetic-actor-b']) {
    const h = harness();
    await h.logout();
    assert.equal(h.api.auth().user.id, 'synthetic-actor-a', 'RAM shared-auth stub deliberately survives primary logout');
    h.reenter(id);
    assert.equal(h.api.auth().user.id, id);
    assert.equal(h.context.confirmModal.classList.contains('is-hidden'), true);
    assert.equal(h.context.pendingActionPreview, null);
    assert.deepEqual(h.fields(), emptyFields);
  }
});

test('existing users/detail reset and command tombstones, keys, saved drafts/history stay intact', async () => {
  const h = harness();
  const drafts = h.storage.get('drafts');
  const history = h.storage.get('history');
  const commands = plain([...h.failedCommands].map(([key, values]) => [key, [...values]]));
  const keys = [...h.usedKeys];
  await h.logout();
  const c = h.context;
  assert.equal(c.dashboardView.classList.contains('is-hidden'), true);
  assert.equal(c.loginView.classList.contains('is-hidden'), false);
  assert.equal(c.selectedDetail, null);
  assert.equal(c.detailPanel.classList.contains('is-hidden'), true);
  assert.ok(h.rows.every(row => !row.classList.contains('is-selected')));
  assert.deepEqual([c.detailType.textContent, c.detailTitle.textContent, c.detailList.innerHTML,
    c.detailMemo.value, c.detailHistoryList.innerHTML, c.detailForm.innerHTML, c.detailForm.dataset.draftKey], ['', '', '', '', '', '', '']);
  assert.equal(c.detailForm.classList.contains('is-hidden'), true);
  assert.equal(h.sidecar.isConnected, false);
  assert.equal(c.userClassificationDetail, null);
  assert.deepEqual(plain(c.sectionState.users), { cursor: null, hasMore: false, rows: [], riskRows: [], search: '',
    classification: 'all', classificationSupported: false });
  assert.deepEqual(h.loadingCalls.filter(id => id.startsWith('user')), ['userRows', 'userRiskRows']);
  assert.deepEqual(h.loadingCalls.filter(id => id.startsWith('admin')), ['adminRows', 'adminRequestRows']);
  assert.equal(h.context.operatorEmail.textContent, '');
  assert.deepEqual(h.moreCalls, [['users', false]]);
  assert.equal(h.status.textContent, '');
  assert.equal(h.filter.value, 'all');
  assert.equal(h.filter.disabled, true);
  assert.equal(h.providerAttempts, 1);
  assert.equal(c.googleButtonFallback.hidden, false);
  assert.equal(c.userClassificationFailedCommands, h.failedCommands);
  assert.equal(c.userClassificationUsedKeys, h.usedKeys);
  assert.deepEqual(plain([...h.failedCommands].map(([key, values]) => [key, [...values]])), commands);
  assert.deepEqual([...h.usedKeys], keys);
  assert.equal(h.storage.get('drafts'), drafts);
  assert.equal(h.storage.get('history'), history);
});

test('direct closeConfirmModal retains its existing hide/null-only contract without session scrubbing', () => {
  const h = harness();
  const detail = h.context.selectedDetail;
  const users = h.context.sectionState.users;
  h.api.close();
  assert.equal(h.context.pendingActionPreview, null);
  assert.equal(h.context.confirmModal.classList.contains('is-hidden'), true);
  assert.deepEqual(h.fields(), markerFields);
  assert.equal(h.context.selectedDetail, detail);
  assert.equal(h.context.sectionState.users, users);
  assert.equal(h.sidecar.isConnected, true);
  assert.equal(h.context.dashboardView.classList.contains('is-hidden'), false);
  assert.equal(h.loadingCalls.length, 0);
  assert.equal(h.providerAttempts, 0);
  h.api.close();
  assert.deepEqual(h.fields(), markerFields);
});

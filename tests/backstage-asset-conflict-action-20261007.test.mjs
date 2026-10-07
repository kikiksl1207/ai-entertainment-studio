import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const sourcePath = process.env.ADMIN_CONFLICT_UI_PATH || new URL('../backstage.js', import.meta.url);
if (typeof sourcePath === 'string') assert.match(path.resolve(sourcePath), /^E:[\\/]/i);
const source = readFileSync(sourcePath, 'utf8');
function fragment(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm')); assert(start >= 0);
  const end = source.slice(start + 1).search(/^(?:(?:async )?function |const |let |window\.|document\.)/m);
  return source.slice(start, end < 0 ? source.length : start + 1 + end);
}
function fixture(error, invalidate) {
  let requests = 0, hidden = false, owner = 'synthetic-owner', history = 0, reloads = 0, updates = 0;
  const preview = { canRunApi: true, targetType: 'artistAsset', actionGroup: 'Synthetic asset',
    apiRequest: { method: 'POST', path: '/admin/api/v1/assets/upload-intents', body: { mimeType: 'image/webp' } } };
  const context = createContext({ pendingActionPreview: preview, backstagePendingActionRoleContext: null,
    confirmRunButton: { disabled: false, textContent: '' }, confirmMessage: { textContent: '' }, confirmPayload: { innerHTML: '' },
    dashboardView: { classList: { contains: () => hidden } }, document: { querySelector: () => null }, console: { debug() {} },
    getBackstageAuth: () => ({ accessToken: 'synthetic', user: { id: owner } }),
    backstageRoleContextKey: () => 'synthetic-context', backstageRolesReady: () => true, backstageVerifiedRolesCurrent: () => true,
    runBackstageRequest: async () => { requests++; if (invalidate === 'owner') owner = 'changed-owner'; if (invalidate === 'hidden') hidden = true; throw error; },
    renderConfirmSummary: (_value, result) => JSON.stringify(result), appendActionHistory: () => { history++; },
    reloadCurrentSectionAfterAction: async () => { reloads++; }, updateSelectedRowStatus: () => { updates++; } });
  runInContext(['backstageErrorStatus', 'backstageUserFacingError', 'runPreparedAction'].map(fragment).join('\n'), context);
  return { context, run: () => context.runPreparedAction(), counts: () => ({ requests, history, reloads, updates }) };
}
for (const [label, status, code, expected] of [
  ['confirmed duplicate', 409, 'ADMIN_ASSET_STORAGE_CONFLICT', '이미 등록된 자산'],
  ['unrelated conflict', 409, 'OTHER_CONFLICT', '요청을 처리하지'],
  ['unrelated server failure', 500, 'ADMIN_ASSET_STORAGE_CONFLICT', '요청을 처리하지'],
  ['expired authentication', 401, 'ADMIN_ASSET_STORAGE_CONFLICT', '세션이 만료'],
  ['insufficient permission', 403, 'ADMIN_ASSET_STORAGE_CONFLICT', '권한이 없어요'],
]) test(`actual action caller handles ${label} without saving success or retrying`, async () => {
  const f = fixture({ status, body: { error: { code, message: '<script>private storage key</script>' } } }); await f.run();
  assert(f.context.confirmMessage.textContent.includes(expected));
  assert(!f.context.confirmMessage.textContent.includes('<script>') && !f.context.confirmPayload.innerHTML.includes('private storage'));
  assert.equal(f.context.confirmRunButton.disabled, false); assert.equal(f.context.confirmRunButton.textContent, '다시 변경');
  assert.deepEqual(f.counts(), { requests: 1, history: 1, reloads: 0, updates: 0 });
  assert(f.context.confirmPayload.innerHTML.includes('처리 실패'));
});
for (const invalidate of ['owner', 'hidden']) test(`late duplicate error cannot paint after ${invalidate} context changes`, async () => {
  const f = fixture({ status: 409, body: { error: { code: 'ADMIN_ASSET_STORAGE_CONFLICT' } } }, invalidate); await f.run();
  assert.equal(f.context.confirmMessage.textContent, ''); assert.equal(f.context.confirmPayload.innerHTML, '');
  assert.deepEqual(f.counts(), { requests: 1, history: 0, reloads: 0, updates: 0 });
});
test('a second request needs a second explicit action call rather than an automatic retry', async () => {
  const f = fixture({ status: 409, body: { error: { code: 'ADMIN_ASSET_STORAGE_CONFLICT' } } });
  await f.run(); assert.equal(f.counts().requests, 1); await f.run(); assert.equal(f.counts().requests, 2);
  assert.deepEqual(f.counts(), { requests: 2, history: 2, reloads: 0, updates: 0 });
});

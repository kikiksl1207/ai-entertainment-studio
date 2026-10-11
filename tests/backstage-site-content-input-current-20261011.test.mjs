import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const oldBytes = readFileSync(new URL('./backstage-site-content-confirm-target-20261010.test.mjs', import.meta.url));
assert.equal(createHash('sha256').update(oldBytes).digest('hex'),
  '1953af2c228cf6fc7f48b9e57e7398ae28442550f3d3d52bf356a8c0205ba5ff');
const oldSource = oldBytes.toString('utf8');
const harnessStart = oldSource.indexOf("const BASE = '/admin/api/v1/backstage/site-content';");
const harnessEnd = oldSource.indexOf('\nfor (const action of actions) {', harnessStart);
assert.ok(harnessStart > 0 && harnessEnd > harnessStart, 'Missing frozen CMS QA harness');
assert.equal(oldSource.indexOf('\nfor (const action of actions) {', harnessEnd + 1), -1);

// Reuse only the frozen QA harness; its 39 test registrations are not evaluated here.
const infrastructure = createContext({ assert, createContext, runInContext, URL,
  setTimeout, clearTimeout, setImmediate, uiSource, sharedFetchSource });
runInContext(oldSource.slice(harnessStart, harnessEnd) +
  '\nglobalThis.cmsFixture = { screen, actions, A, B, flush, conflict, unavailable, assertMutation };',
  infrastructure, { filename: 'frozen-cms-confirm-target-harness.js', timeout: 1000 });
const { screen, actions, A, B, flush, conflict, unavailable, assertMutation } = infrastructure.cmsFixture;
const labels = { publish: '\ubc1c\ud589', archive: '\ubcf4\uad00', restore: '\ubcf5\uad6c' };
const plain = value => JSON.parse(JSON.stringify(value));
const totals = f => ({ requests: f.requests.length, lists: f.lists().length });

function assertInputsKept(f, before) {
  const after = f.snapshot();
  assert.deepStrictEqual(after.fields, before.fields, 'CMS_INPUT_CURRENT_FIELDS_PRESERVED');
  assert.equal(after.preview, before.preview);
  assert.equal(after.editorHidden, false);
  assert.equal(after.title, before.title);
  assert.equal(after.meta, before.meta);
  assert.deepStrictEqual(after.buttons, before.buttons);
}

function assertRejectedConfirmation(f, action, before, count, serverBefore) {
  assertInputsKept(f, before);
  assert.equal(f.requests.length, count.requests);
  assert.equal(f.lists().length, count.lists);
  assert.equal(f.mutations().length, 0);
  assert.deepStrictEqual(plain(f.entries.get(A)), serverBefore);
  assert.equal(f.snapshot().tone, 'neutral');
  assert.equal(f.snapshot().notice,
    '\uc785\ub825\uc774 \ubc14\ub00c\uc5b4 \uc774\uc804 ' + labels[action.name] +
    ' \ud655\uc778\uc740 \uc801\uc6a9\ud558\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.');
  assert.equal(f.refreshCount(), 0);
}

function assertSuccessfulInputPreservation(f, action, before, count, serverB) {
  assertInputsKept(f, before);
  assertMutation(f, action);
  assert.equal(f.requests.length, count.requests + 2, 'One lifecycle POST and one list GET; no reopen audit GET');
  assert.equal(f.lists().length, count.lists + 1);
  assert.equal(f.entries.get(A).status, action.final);
  assert.equal(f.entries.get(A).version, 8);
  assert.deepStrictEqual(plain(f.entries.get(B)), serverB);
  assert.equal(f.snapshot().tone, 'neutral');
  assert.equal(f.snapshot().notice, labels[action.name] +
    '\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c \uc785\ub825\ud55c \ub0b4\uc6a9\uc740 \uc544\uc9c1 \uc800\uc7a5\ub418\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4.');
  assert.equal(f.errors.length, 0);
}

function assertNormalSuccess(f, action, count) {
  assertMutation(f, action);
  assert.equal(f.entries.get(A).status, action.final);
  assert.equal(f.entries.get(A).version, 8);
  assert.equal(f.entries.get(B).version, 11);
  assert.equal(f.lists().length, count.lists + 1);
  assert.equal(f.requests.length, count.requests + (action.name === 'archive' ? 2 : 3));
  assert.equal(f.snapshot().editorHidden, action.name === 'archive');
  assert.ok(f.element('siteContentFormStatus').texts.some(text => action.success.test(text)));
  assert.equal(f.snapshot().tone, action.name === 'archive' ? 'success' : 'neutral');
  if (action.name === 'archive') assert.ok(action.success.test(f.snapshot().notice));
  else assert.equal(f.snapshot().notice, '');
  if (action.name !== 'archive') {
    assert.equal(f.snapshot().fields.title, f.entries.get(A).title);
    assert.match(f.snapshot().meta, /\ubc84\uc804 8/);
  }
  assert.equal(f.errors.length, 0);
}

for (const action of actions) {
  const red = action.name === 'publish' || action.name === 'restore';
  test(`${red ? 'CMS-INPUT-CURRENT-RED:' : 'CMS-INPUT-CURRENT:'} ${action.name} new input during POST is preserved`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const count = totals(f), serverB = plain(f.entries.get(B));
    const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
    await f.dirty('AFTER DISPATCH'); const before = f.snapshot();
    write.result.resolve(); await task; await flush();
    assertSuccessfulInputPreservation(f, action, before, count, serverB);
  });

  test(`CMS-INPUT-CURRENT: ${action.name} new input during list GET is preserved`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const count = totals(f), serverB = plain(f.entries.get(B));
    const list = f.delayList(), task = f.accept(); await list.entered.promise;
    await f.dirty('AFTER WRITE BEFORE LIST'); const before = f.snapshot();
    list.result.resolve(); await task; await flush();
    assertSuccessfulInputPreservation(f, action, before, count, serverB);
  });

  test(`CMS-INPUT-CURRENT: ${action.name} changed input invalidates the pending confirmation`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const count = totals(f), serverBefore = plain(f.entries.get(A));
    await f.dirty('BEFORE CONFIRM'); const before = f.snapshot();
    await f.accept(); await flush();
    assertRejectedConfirmation(f, action, before, count, serverBefore);
  });

  test(`CMS-INPUT-CURRENT: ${action.name} dirty input before confirmation retains normal behavior`, async () => {
    const f = screen(action); await f.start();
    await f.dirty('BEFORE PROMPT'); await f.prompt();
    const count = totals(f);
    await f.accept(); await flush();
    assertNormalSuccess(f, action, count);
  });

  test(`CMS-INPUT-CURRENT: ${action.name} explicit fresh confirmation can retry after input invalidation`, async () => {
    const f = screen(action); await f.start(); await f.prompt();
    const count = totals(f), serverBefore = plain(f.entries.get(A));
    await f.dirty('RETRY INPUT'); const before = f.snapshot();
    await f.accept(); await flush();
    assertRejectedConfirmation(f, action, before, count, serverBefore);
    await f.prompt();
    await f.accept(); await flush();
    assertNormalSuccess(f, action, count);
  });
}

test('CMS-INPUT-CURRENT: publish failure after new input keeps fields and the original finite error', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  const count = totals(f), serverBefore = plain(f.entries.get(A));
  const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
  await f.dirty('FAILED WRITE INPUT'); const before = f.snapshot();
  write.result.resolve(unavailable()); await task; await flush();
  assertInputsKept(f, before); assertMutation(f, action);
  assert.equal(f.requests.length, count.requests + 1);
  assert.equal(f.lists().length, count.lists);
  assert.deepStrictEqual(plain(f.entries.get(A)), serverBefore);
  assert.equal(f.snapshot().tone, 'error');
  assert.equal(f.snapshot().notice, 'Synthetic service unavailable');
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].error.status, 503);
  assert.equal(f.errors[0].error.body.error.code, 'SYNTHETIC_UNAVAILABLE');
  assert.deepStrictEqual(plain(f.errors[0].error.body), plain(f.errors[0].bodySnapshot));
});

test('CMS-INPUT-CURRENT: restore conflict after new input keeps fields and the original conflict carrier', async () => {
  const action = actions[2], f = screen(action); await f.start(); await f.prompt();
  const count = totals(f), serverBefore = plain(f.entries.get(A));
  const write = f.delayWrite(), task = f.accept(); await write.entered.promise;
  await f.dirty('CONFLICT INPUT'); const before = f.snapshot();
  write.result.resolve(conflict()); await task; await flush();
  assertInputsKept(f, before); assertMutation(f, action);
  assert.equal(f.requests.length, count.requests + 1);
  assert.equal(f.lists().length, count.lists);
  assert.deepStrictEqual(plain(f.entries.get(A)), serverBefore);
  assert.equal(f.snapshot().tone, 'error');
  assert.match(f.snapshot().notice, /\ucda9\ub3cc/);
  assert.match(f.snapshot().notice, /\uc785\ub825.*\uadf8\ub300\ub85c/);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].error.status, 409);
  assert.equal(f.errors[0].error.body.error.code, 'SITE_CONTENT_REVISION_CONFLICT');
  assert.strictEqual(f.errors[0].error.body, f.errors[0].body);
  assert.deepStrictEqual(plain(f.errors[0].error.body), plain(f.errors[0].bodySnapshot));
});

test('CMS-INPUT-CURRENT: an earlier editor epoch cannot write or change the reopened A notice', async () => {
  const action = actions[0], f = screen(action); await f.start(); await f.prompt();
  await f.select(B); await f.select(A); await f.dirty('REOPENED A');
  const before = f.snapshot(), count = totals(f), serverBefore = plain(f.entries.get(A));
  await f.accept(); await flush();
  assert.deepStrictEqual(f.snapshot(), before);
  assert.equal(f.requests.length, count.requests);
  assert.equal(f.lists().length, count.lists);
  assert.equal(f.mutations().length, 0);
  assert.deepStrictEqual(plain(f.entries.get(A)), serverBefore);
  assert.equal(f.entries.get(B).version, 11);
  assert.equal(f.refreshCount(), 0);
});

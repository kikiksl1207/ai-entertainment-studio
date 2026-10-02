import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../pages/creator-branch-visual-review.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../pages/creator-branch-visual-review.css', import.meta.url), 'utf8');
const entry = await readFile(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
const work = n => ({ workId: id(n), title: { value: `Published work ${n}` }, publication: { published: true, activeReleaseId: id(n + 100) } });
const row = (n = 11) => ({ sharedResultId: id(n), title: `Shared branch ${n}`, locale: 'ko', sourceChecksum: 'a'.repeat(64), profilePinHash: 'b'.repeat(64), status: 'unreviewed' });
const branchList = (target = work(1), items = [row()], nextCursor = null) => ({ contract: 'story-shared-branch-visual-list-v1', workId: target.workId,
  releaseId: target.publication.activeReleaseId, releaseChecksum: 'c'.repeat(64), items, nextCursor });
const batch = (promptText = 'Exact visual guidance\r\n\uD55C\uAE00 \uD83C\uDFAC', target = work(1), item = row()) => ({
  contract: 'story-branch-visual-review-batch-v1', batchId: id(501), workId: target.workId, sharedResultId: item.sharedResultId,
  sourceChecksum: item.sourceChecksum, profilePinHash: item.profilePinHash, batchChecksum: 'd'.repeat(64), batchVersion: 1, revision: 1,
  status: 'draft', promptText, promptSha256: sha(promptText), approvedAt: null, generationStarted: false, published: false,
});
const detail = (target = work(1), item = row()) => ({ contract: 'story-shared-branch-visual-review-v1', workId: target.workId, sharedResultId: item.sharedResultId,
  locale: item.locale, sourceChecksum: item.sourceChecksum, profilePinHash: item.profilePinHash, title: item.title,
  prose: 'Private shared branch prose.\nSecond paragraph.', proposedPrompt: 'Exact visual guidance\r\n\uD55C\uAE00 \uD83C\uDFAC', proposalApproved: false,
  currentBatch: null, generationStarted: false, published: false });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function screen({ catalogRead, listRead, detailRead, saveWrite, approveWrite, crypto = webcrypto } = {}) {
  let owner = { ownerId: 'test-owner', epoch: 1 }, language = 'ko', scope = '', discardAnswer = true, catalog = [work(1), work(2)];
  const calls = [], prompts = [], states = [];
  const vm = createContext({ window: {}, URLSearchParams, TextEncoder, TextDecoder, crypto });
  runInContext(source, vm);
  const controller = vm.window.LuminaCreatorBranchVisualReview.createController({
    identity: () => owner, isCurrent: value => Boolean(owner && value?.ownerId === owner.ownerId && value?.epoch === owner.epoch), locale: () => language,
    context: () => scope, confirmDiscard: message => { prompts.push(message); return discardAnswer; }, onChange: state => states.push(plain(state)),
    fetch: async (url, options) => {
      calls.push({ url, options: plain(options) });
      const address = new URL(url, 'https://offline.invalid'), parts = address.pathname.split('/');
      if (parts.length === 6) {
        const base = { items: structuredClone(catalog), nextCursor: null };
        return catalogRead ? catalogRead({ base, cursor: address.searchParams.get('cursor'), calls }) : response(base);
      }
      const target = catalog.find(value => value.workId === parts[6]); assert.ok(target, 'requests only address the owner catalog');
      if (parts.length === 8) {
        const base = branchList(target);
        return listRead ? listRead({ base, cursor: address.searchParams.get('cursor'), calls }) : response(base);
      }
      const item = row(Number(parts[8].slice(-12))), base = detail(target, item);
      if (options.method === 'GET') return detailRead ? detailRead({ base, calls }) : response(base);
      const body = plain(options.body), saved = batch(body.promptText || detail(target, item).proposedPrompt, target, item);
      if (parts.at(-1) === 'approve') {
        const result = { ...saved, status: 'approved', revision: 2, approvedAt: '2026-10-01T00:00:00.000Z' };
        return approveWrite ? approveWrite({ base: result, body, calls }) : response(result);
      }
      return saveWrite ? saveWrite({ base: saved, body, calls }) : response(saved, 201);
    },
  });
  const rev = () => controller.snapshot().revision;
  const ready = async () => { await controller.loadCatalog(); controller.selectWork(id(1), rev()); await controller.loadList(); await controller.openItem(id(11)); };
  return { ...controller, rev, ready, calls, states, prompts, posts: () => calls.filter(call => call.options.method === 'POST'),
    owner: value => { owner = value; }, language: value => { language = value; }, context: value => { scope = value; },
    catalog: value => { catalog = value; }, discard: value => { discardAnswer = value; } };
}
function inert(view) {
  const state = view.snapshot(); assert.equal(state.detail, null); assert.equal(state.batch, null); assert.equal(state.prompt, '');
  assert.equal(state.checked, false); assert.equal(state.canApprove, false); assert.equal(state.canRetry, false);
}

test('entry adds only an unframed section after bookings and mounts after the Studio API', () => {
  assert.match(entry, /href="\/pages\/creator-branch-visual-review\.css/);
  assert.match(entry, /id="writerVisualBooking"[^>]*><\/section>\s*<section id="writerBranchVisualReview" aria-labelledby="writerBranchVisualReviewTitle"><\/section>/);
  assert.ok(entry.indexOf('src="/pages/creator-studio.js') < entry.indexOf('src="/pages/creator-branch-visual-review.js'));
  assert.doesNotMatch(source, /localStorage|sessionStorage|\/admin\/|\/generate|setInterval|writerManuscriptWork[^\n]*\.options/);
  assert.match(source, /!shell\.hidden && section\.classList\.contains\("is-active"\)/);
  assert.match(source, /pagehide.*lumina:auth-expired/);
  assert.match(css, /font-size: 18px; line-height: 1\.8/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.doesNotMatch(css, /position:\s*(fixed|sticky)|max-height|overflow-y:\s*(auto|scroll)|linear-gradient/);
});

test('catalog excludes unpublished rows and follows bounded pages, including an empty page', async () => {
  const view = screen({ catalogRead: ({ cursor }) => response(cursor ? { items: [work(1), { ...work(3), publication: { published: false, activeReleaseId: null } }], nextCursor: null } : { items: [], nextCursor: id(900) }) });
  await view.loadCatalog(); assert.deepEqual(plain(view.snapshot().catalog).map(value => value.id), [id(1)]);
  assert.equal(view.calls[0].url, '/api/v1/me/creator-studio/stories?locale=ko&limit=30');
  assert.equal(view.calls[1].url, `/api/v1/me/creator-studio/stories?locale=ko&limit=30&cursor=${id(900)}`);
  view.selectWork(id(3)); await view.loadList(); assert.equal(view.calls.length, 2);
});

for (const change of ['bad-cursor', 'cycle', 'too-many', 'bad-release', 'no-release', 'bad-title', 'duplicate']) test(`catalog failure never leaves a selectable partial catalog: ${change}`, async () => {
  const view = screen({ catalogRead: ({ base, cursor }) => {
    if (change === 'bad-cursor') base.nextCursor = 'bad';
    if (change === 'cycle') { base.items = cursor ? [] : base.items; base.nextCursor = id(900); }
    if (change === 'too-many') base.items = Array(31).fill(work(1));
    if (change === 'bad-release') base.items[0].publication.activeReleaseId = 'bad';
    if (change === 'no-release') base.items[0].publication.activeReleaseId = null;
    if (change === 'bad-title') base.items[0].title.value = '\uD800';
    if (change === 'duplicate') base.items.push(base.items[0]);
    return response(base);
  } });
  await view.loadCatalog(); assert.equal(view.snapshot().catalogVerified, false); assert.deepEqual(plain(view.snapshot().catalog), []); inert(view);
});

test('catalog request bound stops at forty pages even when every page is empty', async () => {
  let count = 0; const view = screen({ catalogRead: () => response({ items: [], nextCursor: id(1000 + ++count) }) });
  await view.loadCatalog(); assert.equal(count, 41); assert.equal(view.snapshot().catalogVerified, false); inert(view);
});

test('list and detail use exact owner routes and opening never writes', async () => {
  const view = screen(); await view.ready();
  assert.equal(view.calls[1].url, `/api/v1/me/creator-studio/stories/${id(1)}/shared-branches?limit=8`);
  assert.equal(view.calls[2].url, `/api/v1/me/creator-studio/stories/${id(1)}/shared-branches/${id(11)}/visual-review`);
  assert.equal(view.snapshot().detail.prose, detail().prose); assert.equal(view.snapshot().prompt, detail().proposedPrompt);
  assert.equal(view.posts().length, 0);
  for (const call of view.calls) { assert.deepEqual(call.options.identity, { ownerId: 'test-owner', epoch: 1 }); assert.equal(call.options._retried, true); }
});

test('empty list page retains a next cursor, without fake approval or item counts', async () => {
  const view = screen({ listRead: ({ base, cursor }) => response({ ...base, items: cursor ? [row(12)] : [], nextCursor: cursor ? null : id(911) }) });
  await view.loadCatalog(); view.selectWork(id(1)); await view.loadList();
  assert.equal(view.snapshot().messageKey, 'empty'); assert.equal(view.snapshot().list.nextCursor, id(911));
  await view.loadList('next'); assert.equal(view.snapshot().pageIndex, 1); assert.equal(view.snapshot().list.items[0].sharedResultId, id(12));
  assert.equal(view.calls.at(-1).url, `/api/v1/me/creator-studio/stories/${id(1)}/shared-branches?limit=8&cursor=${id(911)}`);
  await view.loadList('previous'); assert.equal(view.snapshot().pageIndex, 0); assert.equal(view.snapshot().list.items.length, 0);
  assert.equal(view.posts().length, 0);
});

test('terminal empty page disables further paging and remains truthful', async () => {
  const view = screen({ listRead: ({ base }) => response({ ...base, items: [] }) });
  await view.loadCatalog(); view.selectWork(id(1)); await view.loadList(); const count = view.calls.length;
  await view.loadList('next'); await view.openItem(id(11)); assert.equal(view.calls.length, count); inert(view);
});

for (const change of ['contract', 'work', 'release', 'hash', 'cursor', 'row-hash', 'status', 'locale', 'duplicate', 'oversize']) test(`malformed list is read-only: ${change}`, async () => {
  const view = screen({ listRead: ({ base }) => {
    if (change === 'contract') base.contract = 'other'; if (change === 'work') base.workId = id(2); if (change === 'release') base.releaseId = id(102);
    if (change === 'hash') base.releaseChecksum = 'A'.repeat(64); if (change === 'cursor') base.nextCursor = 'bad';
    if (change === 'row-hash') base.items[0].sourceChecksum = 'bad'; if (change === 'status') base.items[0].status = 'ready';
    if (change === 'locale') base.items[0].locale = 'zh'; if (change === 'duplicate') base.items.push(base.items[0]); if (change === 'oversize') base.items = Array(9).fill(row());
    return response(base);
  } }); await view.ready(); inert(view); assert.equal(view.posts().length, 0);
});

test('changing release checksum while paging invalidates old review and requires reopening', async () => {
  const view = screen({ listRead: ({ base, cursor }) => response({ ...base, items: cursor ? [row(12)] : [row()], nextCursor: cursor ? null : id(911), releaseChecksum: (cursor ? 'e' : 'c').repeat(64) }) });
  await view.ready(); await view.save(); view.acknowledge(true); await view.loadList('next'); inert(view); assert.equal(view.snapshot().phase, 'conflict');
});

test('cyclic list cursors fail closed', async () => {
  const view = screen({ listRead: ({ base, cursor }) => response({ ...base, items: cursor ? [] : base.items, nextCursor: id(911) }) });
  await view.ready(); await view.loadList('next'); inert(view); assert.equal(view.snapshot().phase, 'error');
});

test('approval requires saved exact text and an explicit checkbox, never the proposal alone', async () => {
  const view = screen(); await view.ready(); view.acknowledge(true); await view.approve(); assert.equal(view.posts().length, 0);
  await view.save(); assert.equal(view.snapshot().batch.status, 'draft'); assert.equal(view.snapshot().checked, false); await view.approve(); assert.equal(view.posts().length, 1);
  view.acknowledge(true); const rev = view.rev(); await view.approve(rev); await view.approve(rev);
  assert.equal(view.posts().length, 2); assert.equal(view.snapshot().batch.status, 'approved'); assert.equal(view.snapshot().checked, false);
  assert.deepEqual(view.posts()[0].options.body, { expectedSourceChecksum: 'a'.repeat(64), expectedProfilePinHash: 'b'.repeat(64), idempotencyKey: view.posts()[0].options.body.idempotencyKey, promptText: detail().proposedPrompt });
  assert.match(view.posts()[0].options.body.idempotencyKey, /^[a-f0-9-]{36}$/);
  assert.deepEqual(view.posts()[1].options.body, { expectedSourceChecksum: 'a'.repeat(64), expectedProfilePinHash: 'b'.repeat(64), expectedBatchChecksum: 'd'.repeat(64), expectedRevision: 1, sceneReviewed: true });
  assert.ok(view.posts()[1].url.endsWith(`/drafts/${id(501)}/approve`));
});

test('editing clears the checkbox immediately, including edit-and-undo, and does not auto-save', async () => {
  const view = screen(); await view.ready(); await view.save(); view.acknowledge(true); const old = view.rev();
  view.edit('New guidance'); assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().canApprove, false);
  view.acknowledge(true); await view.approve(old); assert.equal(view.posts().length, 1);
  view.edit(detail().proposedPrompt); assert.equal(view.snapshot().checked, false); await view.approve(); assert.equal(view.posts().length, 1);
  view.acknowledge(true); await view.approve(); assert.equal(view.posts().length, 2);
});

for (const text of ['', ' \n\t ', 'bad\0text', '\uD800', '\uDC00', 'x'.repeat(32001)]) test(`invalid prompt cannot be saved: ${JSON.stringify(text.slice(0, 16))}`, async () => {
  const view = screen(); await view.ready(); view.edit(text); await view.save(); assert.equal(view.posts().length, 0); assert.equal(view.snapshot().canSave, false);
});

test('valid Unicode, CRLF, whitespace and 32,000 code units are preserved exactly', async () => {
  const text = '\n  \uD83C\uDFAC\r\n' + 'x'.repeat(31991) + '  ', view = screen(); assert.equal(text.length, 32000);
  await view.ready(); view.edit(text); await view.save(); assert.equal(view.posts()[0].options.body.promptText, text); assert.equal(view.snapshot().batch.promptText, text);
});

test('ambiguous save failure is read-only; retry preserves UUID and exact body with no auto-submit', async () => {
  let count = 0; const view = screen({ saveWrite: ({ base }) => { if (++count === 1) throw new Error('connection lost'); return response(base); } });
  await view.ready(); view.edit('  Exact retry\r\n\uD83C\uDFAC  '); await view.save();
  assert.equal(view.posts().length, 1); assert.equal(view.snapshot().canRetry, true); assert.equal(view.snapshot().editable, false); assert.equal(view.snapshot().canApprove, false);
  view.edit('cannot change retry'); view.acknowledge(true); await view.approve(); assert.equal(view.posts().length, 1);
  await view.save(view.rev(), true); assert.equal(view.posts().length, 2); assert.deepEqual(view.posts()[0].options.body, view.posts()[1].options.body);
  assert.equal(view.snapshot().batch.status, 'draft'); assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().canRetry, false);
});

test('reopening after an uncertain save discards the bound retry key', async () => {
  let count = 0; const view = screen({ saveWrite: ({ base }) => ++count === 1 ? response({}, 500) : response(base) });
  await view.ready(); await view.save(); await view.openItem(id(11)); await view.save();
  assert.notEqual(view.posts()[0].options.body.idempotencyKey, view.posts()[1].options.body.idempotencyKey); assert.equal(view.prompts.length, 1);
});

for (const operation of ['list', 'detail', 'save', 'approve']) for (const status of [401, 409, 503, 422]) test(`${operation} HTTP ${status} is not empty or success and never authorizes`, async () => {
  const options = {}, handler = () => response({ message: '<img onerror=attack()>secret diagnostics' }, status);
  if (operation === 'list') options.listRead = handler; if (operation === 'detail') options.detailRead = handler;
  if (operation === 'save') options.saveWrite = handler; if (operation === 'approve') options.approveWrite = handler;
  const view = screen(options); await view.ready(); if (['save', 'approve'].includes(operation)) await view.save(); if (operation === 'approve') { view.acknowledge(true); await view.approve(); }
  const state = view.snapshot(); assert.equal(state.canApprove, false); assert.equal(state.checked, false); assert.equal(state.canRetry, false);
  assert.equal(JSON.stringify(state).includes('secret diagnostics'), false); assert.notEqual(state.messageKey, 'empty'); assert.notEqual(state.messageKey, 'done');
  if ([401, 409, 503].includes(status)) inert(view);
});

for (const change of ['owner', 'epoch', 'logout', 'language', 'context', 'invalidate', 'work']) {
  for (const operation of ['catalog', 'list', 'detail', 'save', 'approve']) test(`late ${operation} cannot survive ${change}`, async () => {
    const pending = deferred(), started = deferred();
    const handler = ({ base }) => { started.resolve(); return pending.promise.then(() => response(base)); };
    const nextOptions = { catalogRead: operation === 'catalog' ? handler : undefined, listRead: operation === 'list' ? handler : undefined,
      detailRead: operation === 'detail' ? handler : undefined, saveWrite: operation === 'save' ? handler : undefined, approveWrite: operation === 'approve' ? handler : undefined };
    // A second screen isolates each delayed operation without timers or background work.
    const target = screen(nextOptions);
    let task;
    if (operation === 'catalog') task = target.loadCatalog();
    else { await target.loadCatalog(); target.selectWork(id(1)); if (operation === 'list') task = target.loadList();
      else { await target.loadList(); if (operation === 'detail') task = target.openItem(id(11));
        else { await target.openItem(id(11)); if (operation === 'save') task = target.save(); else { await target.save(); target.acknowledge(true); task = target.approve(); } } } }
    await started.promise;
    if (change === 'owner') target.owner({ ownerId: 'different-owner', epoch: 1 });
    if (change === 'epoch') target.owner({ ownerId: 'test-owner', epoch: 2 });
    if (change === 'logout') target.owner(null); if (change === 'language') target.language('ja'); if (change === 'context') target.context('other-context');
    if (change === 'invalidate') target.invalidate(); else if (change === 'work') {
      if (operation === 'catalog') target.invalidate(); else target.selectWork(id(2));
    } else target.syncContext();
    pending.resolve(); await task; inert(target); assert.notEqual(target.snapshot().messageKey, 'done');
  });
}

test('changed active release discovered before save or approve prevents POST', async () => {
  for (const operation of ['save', 'approve']) {
    const view = screen(); await view.ready(); if (operation === 'approve') { await view.save(); view.acknowledge(true); }
    const before = view.posts().length; view.catalog([{ ...work(1), publication: { published: true, activeReleaseId: id(999) } }]);
    await view[operation](); assert.equal(view.posts().length, before); inert(view); assert.equal(view.snapshot().phase, 'conflict');
  }
});

test('dirty work, branch, page and refresh navigation asks once and cancellation preserves exact private text', async () => {
  const view = screen({ listRead: ({ base }) => response({ ...base, items: [row(), row(12)], nextCursor: id(911) }) });
  await view.ready(); view.edit('Unsaved private guidance'); view.discard(false); const before = view.calls.length;
  view.selectWork(id(2)); await view.openItem(id(12)); await view.loadList('next'); await view.loadCatalog();
  assert.equal(view.prompts.length, 4); assert.equal(view.calls.length, before); assert.equal(view.snapshot().target.id, id(1));
  assert.equal(view.snapshot().prompt, 'Unsaved private guidance'); view.discard(true); view.selectWork(id(2)); inert(view);
});

for (const mutate of [
  value => { value.contract = 'wrong'; }, value => { value.workId = id(2); }, value => { value.sharedResultId = id(12); },
  value => { value.locale = 'en'; }, value => { value.sourceChecksum = 'e'.repeat(64); }, value => { value.profilePinHash = 'e'.repeat(64); },
  value => { value.prose = ''; }, value => { value.proposedPrompt = '\uD800'; }, value => { value.proposalApproved = true; },
  value => { value.generationStarted = true; }, value => { value.published = true; }, value => { delete value.currentBatch; },
  value => { value.currentBatch = { ...batch(), promptSha256: 'e'.repeat(64) }; },
]) test(`invalid detail is rejected: ${mutate.toString()}`, async () => {
  const view = screen({ detailRead: ({ base }) => { mutate(base); return response(base); } }); await view.ready(); inert(view); assert.equal(view.posts().length, 0);
});

for (const mutate of [
  value => { value.contract = 'wrong'; }, value => { value.workId = id(2); }, value => { value.sharedResultId = id(12); }, value => { value.batchId = 'bad'; },
  value => { value.sourceChecksum = 'e'.repeat(64); }, value => { value.profilePinHash = 'e'.repeat(64); }, value => { value.batchChecksum = 'bad'; },
  value => { value.batchVersion = 0; }, value => { value.revision = 2; }, value => { value.status = 'approved'; },
  value => { value.promptText += ' '; value.promptSha256 = sha(value.promptText); }, value => { value.promptSha256 = 'e'.repeat(64); },
  value => { value.approvedAt = '2026-10-01T00:00:00.000Z'; }, value => { value.generationStarted = true; }, value => { value.published = true; },
]) test(`save receipt must exactly bind text and hashes: ${mutate.toString()}`, async () => {
  const view = screen({ saveWrite: ({ base }) => { mutate(base); return response(base); } }); await view.ready(); await view.save();
  assert.equal(view.snapshot().batch, null); assert.equal(view.snapshot().editable, false); assert.equal(view.snapshot().canApprove, false); assert.equal(view.snapshot().canRetry, false);
});

for (const mutate of [
  value => { value.batchId = id(502); }, value => { value.batchChecksum = 'e'.repeat(64); }, value => { value.batchVersion = 2; },
  value => { value.promptText += ' '; value.promptSha256 = sha(value.promptText); }, value => { value.promptSha256 = 'e'.repeat(64); },
  value => { value.revision = 1; }, value => { value.status = 'draft'; }, value => { value.approvedAt = null; }, value => { value.approvedAt = 'not a date'; },
]) test(`approve receipt cannot change the saved batch: ${mutate.toString()}`, async () => {
  const view = screen({ approveWrite: ({ base }) => { mutate(base); return response(base); } }); await view.ready(); await view.save(); view.acknowledge(true); await view.approve();
  assert.equal(view.snapshot().batch, null); assert.equal(view.snapshot().canApprove, false); assert.notEqual(view.snapshot().messageKey, 'done');
});

test('without WebCrypto digest the structural and exact-text checks still fail closed; UUID remains mandatory', async () => {
  const view = screen({ crypto: { randomUUID: () => id(600) } }); await view.ready(); await view.save(); assert.equal(view.snapshot().batch.status, 'draft');
  const invalid = screen({ crypto: {} }); await invalid.ready(); await invalid.save(); assert.equal(invalid.posts().length, 0); assert.equal(invalid.snapshot().canApprove, false);
});

test('existing approved guidance never implicitly checks a box and an edit requires a new saved draft', async () => {
  const view = screen({ detailRead: ({ base }) => response({ ...base, currentBatch: { ...batch(), status: 'approved', revision: 2, approvedAt: '2026-10-01T00:00:00.000Z' } }) });
  await view.ready(); assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().canApprove, false); assert.equal(view.snapshot().canSave, false);
  view.edit('New guidance after approval'); assert.equal(view.snapshot().canApprove, false); await view.save(); assert.equal(view.snapshot().batch.status, 'draft');
});

test('detail refresh updates a stale approved list row to its latest draft or unreviewed state', async () => {
  for (const currentBatch of [batch(), null]) {
    const view = screen({ listRead: ({ base }) => response({ ...base, items: [{ ...row(), status: 'approved' }] }),
      detailRead: ({ base }) => response({ ...base, currentBatch }) });
    await view.ready(); assert.equal(view.snapshot().list.items[0].status, currentBatch?.status || 'unreviewed');
    assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().canApprove, false);
  }
});

test('private state projections do not retain extra diagnostic fields', async () => {
  const secret = 'PRIVATE_DIAGNOSTIC_NEVER_SHOW';
  const view = screen({ detailRead: ({ base }) => response({ ...base, providerDiagnostic: secret, currentBatch: { ...batch(), diagnostic: secret } }) });
  await view.ready(); assert.equal(JSON.stringify(view.snapshot()).includes(secret), false);
});

test('100,000-byte prose and 32,000-code-unit multibyte guidance are accepted through a real Response', async () => {
  const prose = '\uD55C'.repeat(33333) + 'x', prompt = '\uD55C'.repeat(32000);
  assert.equal(new TextEncoder().encode(prose).length, 100000); assert.equal(new TextEncoder().encode(prompt).length, 96000);
  const view = screen({ detailRead: ({ base }) => new Response(JSON.stringify({ ...base, prose, proposedPrompt: prompt })) });
  await view.ready(); assert.equal(view.snapshot().detail.prose, prose); assert.equal(view.snapshot().prompt, prompt);
  await view.save(); assert.equal(view.posts()[0].options.body.promptText, prompt); assert.equal(view.snapshot().batch.promptSha256, sha(prompt));
});

test('a multibyte prose exceeding 100,000 bytes is rejected without displaying private text', async () => {
  const view = screen({ detailRead: ({ base }) => response({ ...base, prose: '\uD55C'.repeat(33334) }) }); await view.ready(); inert(view);
});

test('oversized response is cancelled at 256 KiB instead of interpreted as success', async () => {
  let cancelled = false;
  const view = screen({ detailRead: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel() { cancelled = true; } })) });
  await view.ready(); inert(view); assert.equal(cancelled, true); assert.equal(view.snapshot().phase, 'error');
});

test('oversized Content-Length, malformed JSON and invalid UTF-8 are all read-only failures', async () => {
  for (const make of [
    () => new Response('{}', { headers: { 'Content-Length': String(256 * 1024 + 1) } }),
    () => new Response('{broken'), () => new Response(new Uint8Array([0xff, 0xff])),
  ]) { const view = screen({ detailRead: make }); await view.ready(); inert(view); assert.equal(view.snapshot().phase, 'error'); }
});

test('all five locale catalogs use the supported locale value', async () => {
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
    const view = screen(); view.language(locale); await view.ready(); assert.equal(view.snapshot().locale, locale);
    assert.equal(new URL(view.calls[0].url, 'https://offline.invalid').searchParams.get('locale'), locale);
  }
});

test('browser QA is opt-in, offline, E-only evidence, and includes real mounted UI at 390, 400 and 1280', async () => {
  const browser = await readFile(new URL('./creator-branch-visual-review.browser.test.mjs', import.meta.url), 'utf8');
  assert.match(browser, /CREATOR_BRANCH_VISUAL_REVIEW_BROWSER_QA === '1'/);
  assert.match(browser, /\[390, 400, 1280\]/); assert.match(browser, /page\.screenshot\(/); assert.match(browser, /route\.abort\(/);
  assert.doesNotMatch(browser, /writeFile|mkdir|download|http\.createServer|listen\(/);
});

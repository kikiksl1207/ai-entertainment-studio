import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const scripts = ['creator-body-preview.js', 'creator-body-trial.js'].map(name =>
  readFileSync(new URL(`../pages/${name}`, import.meta.url), 'utf8'));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const languages = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const response = (value, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(value) });
function library() {
  const forbidden = () => { throw new Error('Unexpected network, storage, or timer'); };
  const window = { fetch: forbidden, localStorage: { getItem: forbidden, setItem: forbidden },
    sessionStorage: { getItem: forbidden, setItem: forbidden }, setTimeout: forbidden, setInterval: forbidden };
  const context = createContext({ window, TextEncoder, TextDecoder, AbortController });
  for (const source of scripts) runInContext(source, context);
  return window;
}
function screen(options = {}) {
  const window = library(), calls = [];
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), revision = 39, position = options.position ?? 0;
  const locale = options.locale || 'ko';
  const approved = () => ({ contract: 'story-author-body-trial-state-v1', workId, state: 'approval_recorded',
    readOnly: true, generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
    approval: { id: id(7), expiresAt: '2099-01-01T00:00:00.000Z' }, budget: {
      knownActualCostKrw: '91.138500', reservedMaximumCostKrw: '0.000000', committedCostKrw: '91.138500',
      approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '9908.861500', requestCount: 2,
      pendingCount: 0, unknownCostCount: 0, verifiedSharedReuseCount: 0, evidenceReadyForBudgetCheck: true,
    } });
  const preview = () => ({ contract: 'story-author-body-preview-v1', workId, locale,
    readOnly: true, imageGenerationStarted: false, progress: {
      progressId: id(2), revision, status: 'active', storyVersion: 1,
      ...(options.missingPosition ? {} : { currentBeatPosition: position }),
      scene: { id: id(3), isGenerated: options.canonical !== true, title: 'Synthetic saved body', endingType: null,
        beats: [1, 2].map(n => ({ id: id(n + 10), position: n, type: 'paragraph', content: `Synthetic paragraph ${n}.` })) },
      choices: [{ id: id(5), label: 'Synthetic next choice', routeKind: 'generation_required' }],
    } });
  const controller = window.LuminaCreatorBodyTrial.createController({
    identity: () => owner, isCurrent: value => value?.ownerId === owner.ownerId && value.epoch === owner.epoch,
    context: () => ({ workId, locale }), locale: () => locale, visible: () => true,
    makeIdempotencyKey: options.makeKey || (() => 'read-unit-key-0001'),
    fetch: async (url, request) => {
      calls.push({ url, request });
      if (request.method === 'GET') return response(url.endsWith('/body-trial-state') ? approved() : preview());
      assert.ok(url.endsWith('/body-trial/read-beats'), 'No paid selection may be dispatched');
      const body = JSON.parse(request.body);
      if (options.post) return options.post({ body, commit, ownerChanged, workChanged });
      return response(commit(body));
    },
  });
  function commit(body) {
    position = 2; revision++;
    return { contract: 'story-author-body-trial-read-v1', workId, progressId: body.progressId,
      sourceRevision: body.expectedRevision, revision, beatPosition: position, idempotentReplay: false,
      generationStarted: false, imageGenerationStarted: false, readOnly: false };
  }
  function ownerChanged() { owner = { ownerId: id(9), epoch: owner.epoch + 1 }; }
  function workChanged() { workId = id(9); }
  return { controller, calls, preview, window, position: () => position };
}

for (const locale of languages) test(`${locale}: explicit read command unlocks only after a fresh verified GET`, async () => {
  const view = screen({ locale });
  assert.equal(await view.controller.load(), true);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 0);
  assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(view.controller.snapshot().canRecordRead, true);
  assert.equal(view.controller.snapshot().messageKey, 'readRequired');
  assert.ok(view.window.LuminaCreatorBodyTrial.copy[locale].recordRead.trim());
  assert.equal(await view.controller.choose(id(5)), false);
  assert.equal(await view.controller.recordRead(), true);
  const posts = view.calls.filter(c => c.request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].request.headers['Idempotency-Key'], /^read-/);
  assert.deepEqual(JSON.parse(posts[0].request.body), { approvalId: id(7), progressId: id(2), expectedRevision: 39, locale });
  assert.equal(posts[0].request.cache, 'no-store');
  assert.equal(posts[0].request._retried, true);
  assert.equal(view.controller.snapshot().canChoose, true);
  assert.equal(view.controller.snapshot().canRecordRead, false);
  assert.equal(view.controller.snapshot().data.preview.progress.revision, 40);
  assert.equal(view.calls.slice(-2).every(c => c.request.method === 'GET'), true);
  assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 1);
});

test('generated legacy response without reading metadata fails closed without a write', async () => {
  const view = screen({ missingPosition: true }); await view.controller.load();
  assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(view.controller.snapshot().canRecordRead, false);
  assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.calls.length, 2);
});
test('partial reading does not unlock a full-body trial choice', async () => {
  const view = screen({ position: 1 }); await view.controller.load();
  assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(view.controller.snapshot().canRecordRead, true);
});
test('canonical choice behavior and completed generated reading are preserved', async () => {
  for (const options of [{ canonical: true }, { position: 2 }]) {
    const view = screen(options); await view.controller.load();
    assert.equal(view.controller.snapshot().canChoose, true);
    assert.equal(view.controller.snapshot().canRecordRead, false);
  }
});
for (const status of [400, 401, 403, 404, 409, 422, 500]) test(`read HTTP ${status} never retries or dispatches generation`, async () => {
  const view = screen({ post: () => response({}, status) }); await view.controller.load();
  assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 1);
  assert.equal(view.controller.snapshot().data, null);
  assert.equal(view.controller.snapshot().canChoose, false);
});
test('lost read receipt is reconciled by explicit GET without repeating POST', async () => {
  const view = screen({ post: ({ body, commit }) => { commit(body); throw new Error('Synthetic response loss'); } });
  await view.controller.load(); assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.controller.snapshot().messageKey, 'readUncertain');
  assert.equal(view.controller.snapshot().canChoose, false);
  assert.equal(await view.controller.load(), true);
  assert.equal(view.controller.snapshot().canChoose, true);
  assert.equal(view.position(), 2);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 1);
});
for (const change of ['ownerChanged', 'workChanged']) test(`late read result after ${change} cannot restore old content`, async () => {
  const view = screen({ post: async actions => { const result = actions.commit(actions.body); actions[change](); return response(result); } });
  await view.controller.load(); assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.controller.snapshot().data, null);
  assert.equal(view.controller.snapshot().canChoose, false);
});
for (const field of ['workId', 'progressId', 'sourceRevision', 'revision', 'beatPosition', 'generationStarted', 'imageGenerationStarted', 'readOnly', 'idempotentReplay']) {
  test(`read receipt rejects wrong ${field}`, async () => {
    const view = screen({ post: ({ body, commit }) => {
      const result = commit(body); result[field] = typeof result[field] === 'string' ? id(99)
        : typeof result[field] === 'number' ? 99 : 'invalid'; return response(result);
    } });
    await view.controller.load(); assert.equal(await view.controller.recordRead(), false);
    assert.equal(view.controller.snapshot().canChoose, false);
    assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 1);
  });
}
test('prefixed read idempotency key must fit server limit before any dispatch', async () => {
  const view = screen({ makeKey: () => 'a'.repeat(120) }); await view.controller.load();
  assert.equal(await view.controller.recordRead(), false);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 0);
});
for (const position of [-1, 3, 41, 0.5, '0', null]) test(`reading metadata rejects ${JSON.stringify(position)}`, () => {
  const view = screen(), value = view.preview(); value.progress.currentBeatPosition = position;
  assert.throws(() => view.window.LuminaCreatorBodyPreview.parsePreview(value, { workId: id(1), locale: 'ko' }));
});

test('stale click ticket cannot record reading', async () => {
  const view = screen(); await view.controller.load();
  const ticket = view.controller.snapshot().ticket;
  view.controller.invalidate(); await view.controller.load();
  assert.equal(await view.controller.recordRead(ticket), false);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 0);
});

test('double click while saving sends exactly one read request', async () => {
  let release;
  const view = screen({ post: async ({ body, commit }) => {
    await new Promise(resolve => { release = resolve; }); return response(commit(body));
  } });
  await view.controller.load();
  const first = view.controller.recordRead();
  assert.equal(await view.controller.recordRead(), false);
  release(); assert.equal(await first, true);
  assert.equal(view.calls.filter(c => c.request.method === 'POST').length, 1);
});

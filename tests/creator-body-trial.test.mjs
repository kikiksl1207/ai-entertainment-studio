import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../pages/creator-body-trial.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../pages/creator-body-trial.css', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const id = value => `${String(value).padStart(8, '0')}-1111-4111-8111-${String(value).padStart(12, '0')}`;
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const future = '2099-12-31T23:59:59.000Z';
const past = '2000-01-01T00:00:00.000Z';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const approvalState = (workId = id(1)) => ({
  contract: 'story-author-body-trial-state-v1', workId, state: 'approval_recorded', readOnly: true,
  generationAuthorized: false, currentAuthorizationVerified: false, imageGenerationStarted: false,
  approval: { id: id(7), expiresAt: future },
  budget: { knownActualCostKrw: '0.250001', reservedMaximumCostKrw: '4000.000000',
    committedCostKrw: '4000.250001', approvedBudgetKrw: '10000.000000', remainingBudgetKrw: '5999.749999',
    requestCount: 2, pendingCount: 1, unknownCostCount: 0, verifiedSharedReuseCount: 0,
    evidenceReadyForBudgetCheck: true }
});
const preview = (workId = id(1), locale = 'ko') => ({
  contract: 'story-author-body-preview-v1', workId, locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 1, status: 'active', storyVersion: 1,
    scene: { id: id(3), isGenerated: false, title: 'Saved private scene', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'paragraph', content: 'Private trial text.\r\n  Exact spacing. \uD55C\uAE00' }] },
    choices: [{ id: id(5), label: 'Original route', routeKind: 'writer_original' },
      { id: id(6), label: 'AI route', routeKind: 'generation_required' }] }
});
const originalReceipt = (extra = {}) => ({
  contract: 'story-author-body-trial-choice-v1', progressId: id(2), revisionAfterRequest: 2,
  status: 'active', generationStarted: false, imageGenerationStarted: false, idempotentReplay: false, ...extra
});
const aiReceipt = (status = 'queued', extra = {}) => ({
  contract: 'story-author-body-trial-choice-v1', continuationId: id(10), status, revisionAfterRequest: 2,
  allowanceRemaining: 1, retryable: ['failed', 'timeout'].includes(status), progressApplied: status === 'completed',
  privateInputReturned: false, providerPayloadReturned: false, internalCostReturned: false,
  resultGeneratedSceneId: status === 'completed' ? id(11) : null, provenance: 'ai_generated',
  idempotentReplay: false, createdAt: '2026-10-02T00:00:00.000Z',
  completedAt: ['completed', 'failed', 'timeout'].includes(status) ? '2026-10-02T00:01:00.000Z' : null,
  imageGenerationStarted: false, ...extra
});
const response = (data, status = 200, extra = {}) => ({
  status, headers: { get: () => null }, text: async () => JSON.stringify(data), ...extra
});

function library(extra = {}) {
  const forbidden = () => { throw new Error('Storage, timers, and global network access are forbidden'); };
  const storage = { getItem: forbidden, setItem: forbidden, removeItem: forbidden, clear: forbidden };
  const crypto = { randomUUID: () => id(90) };
  const window = { crypto, localStorage: storage, sessionStorage: storage, indexedDB: { open: forbidden },
    fetch: forbidden, setInterval: forbidden, setTimeout: forbidden };
  const vm = createContext({ window, crypto, TextEncoder, TextDecoder, AbortController,
    localStorage: storage, sessionStorage: storage, indexedDB: { open: forbidden },
    fetch: forbidden, setInterval: forbidden, setTimeout: forbidden, ...extra });
  runInContext(previewSource, vm);
  runInContext(source, vm);
  return { api: vm.window.LuminaCreatorBodyTrial, vm };
}
function screen(handler = ({ reply }) => reply(), settings = {}) {
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = 'ko', language = 'ko';
  let shown = true, authorized = true, brokenIdentity = false, keyCount = 0;
  const calls = [], states = [], { api, vm } = library(settings.vm);
  const options = {
    fetch: async (url, options) => {
      const target = { workId, locale: sourceLocale };
      const kind = options.method === 'POST' ? 'choice' : url.includes('/body-trial-state') ? 'state' : 'preview';
      const call = { url, options, kind };
      calls.push(call);
      const reply = () => response(kind === 'state' ? approvalState(target.workId)
        : kind === 'preview' ? preview(target.workId, target.locale) : originalReceipt());
      return handler({ ...call, target, calls, reply });
    },
    identity: () => { if (brokenIdentity) throw new Error('Private identity failure'); return owner; },
    isCurrent: value => authorized && owner && owner.ownerId === value?.ownerId && owner.epoch === value?.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => language, visible: () => shown,
    onChange: state => states.push(clone(state)),
    makeIdempotencyKey: () => { keyCount++; return `trial-test-${String(keyCount).padStart(4, '0')}`; }
  };
  if (Object.hasOwn(settings, 'makeIdempotencyKey')) options.makeIdempotencyKey = settings.makeIdempotencyKey;
  if (settings.onDispatch) options.onDispatch = settings.onDispatch;
  if (settings.defaultKey) delete options.makeIdempotencyKey;
  const controller = api.createController(options);
  return { ...controller, calls, states, api, vm, keys: () => keyCount, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; },
    authorized: value => { authorized = value; }, brokenIdentity: value => { brokenIdentity = value; }
  } };
}
const posts = view => view.calls.filter(call => call.options.method === 'POST');
const unresolved = view => Boolean(view.snapshot().unresolved);
const assertCleared = view => {
  assert.equal(view.snapshot().data, null);
  assert.equal(view.snapshot().receipt, null);
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /Private trial text|Saved private scene|Original route/);
};
const assertUncertain = view => {
  assert.equal(unresolved(view), true);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.snapshot().busy, false);
  assert.equal(view.snapshot().receipt, null);
};
const expectedBody = { approvalId: id(7), progressId: id(2), expectedRevision: 1, locale: 'ko' };
function assertReplay(first, replay, epoch = 1) {
  assert.equal(replay.url, first.url);
  assert.equal(replay.options.body, first.options.body);
  assert.equal(replay.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']);
  assert.deepEqual(clone(replay.options.identity), { ownerId: id(8), epoch });
  assert.equal(replay.options._retried, true);
  assert.equal(replay.options.cache, 'no-store');
}

test('exports the agreed API and remains idle without storage, polling, or automatic mutations', async () => {
  const view = screen();
  for (const name of ['parseState', 'parseReceipt', 'createController', 'mount']) assert.equal(typeof view.api[name], 'function');
  assert.equal(typeof view.api.copy, 'object');
  for (const name of ['ticket', 'phase', 'messageKey', 'locale', 'data', 'receipt', 'busy', 'canLoad', 'canChoose', 'canRetry', 'unresolved']) {
    assert.ok(Object.hasOwn(view.snapshot(), name), name);
  }
  for (let i = 0; i < 3; i++) { view.syncContext(); view.snapshot(); view.invalidate(); }
  assert.equal(await view.choose(id(5)), false);
  assert.equal(await view.retry(), false);
  assert.equal(view.calls.length, 0);
  assert.equal(view.keys(), 0);
  assert.equal(unresolved(view), false);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|setInterval|setTimeout|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source, /\/approve|\/images|\/payments|\/generate|\/continuations/);
});

test('explicit load performs the two exact owner GETs in order, without authorizing or choosing', async () => {
  const view = screen();
  assert.equal(await view.load(), true);
  assert.deepEqual(view.calls.map(call => call.url), [
    `/api/v1/me/creator-studio/stories/${id(1)}/body-trial-state`,
    `/api/v1/me/creator-studio/stories/${id(1)}/body-preview?locale=ko`
  ]);
  for (const { options } of view.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options._retried, true); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Cache-Control'], 'no-store'); assert.equal(options.body, undefined); assert.ok(options.signal);
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  }
  assert.deepEqual(clone(view.snapshot().data), { approvalState: approvalState(), preview: preview() });
  assert.equal(view.snapshot().data.approvalState.generationAuthorized, false);
  assert.equal(view.snapshot().data.approvalState.currentAuthorizationVerified, false);
  assert.equal(view.snapshot().canChoose, true); assert.equal(view.snapshot().canRetry, false);
  view.syncContext(); view.snapshot();
  assert.equal(view.calls.length, 2); assert.equal(view.keys(), 0);
});

test('public parsers accept their documented target and command shapes and normalize UUID case', () => {
  const { api } = library(), workId = 'A0000001-ABCD-4ABC-8ABC-ABCDEF000001';
  const value = approvalState(workId); value.approval.id = 'A0000007-ABCD-4ABC-8ABC-ABCDEF000007';
  const normalized = api.parseState(value, { workId: workId.toLowerCase() });
  assert.equal(normalized.workId, workId.toLowerCase()); assert.equal(normalized.approval.id, value.approval.id.toLowerCase());
  assert.throws(() => api.parseState(value, { workId: id(99) }));
  const progressId = 'A0000002-ABCD-4ABC-8ABC-ABCDEF000002';
  const receipt = originalReceipt({ progressId }), body = { progressId: progressId.toLowerCase(), expectedRevision: 1 };
  for (const command of [body, { body }]) {
    assert.deepEqual(clone(api.parseReceipt({ ...receipt, privateDetail: 'discard' }, command)), {
      ...receipt, progressId: progressId.toLowerCase()
    });
  }
  for (const command of [null, [], {}, { progressId: 'bad', expectedRevision: 1 },
    { progressId: id(2), expectedRevision: '1' }, { body: { progressId: id(2), expectedRevision: 0 } }]) {
    assert.throws(() => api.parseReceipt(originalReceipt(), command));
  }
});

test('onDispatch runs only at explicit POST dispatch, including replay, with the command already retained', async () => {
  let count = 0, dispatches = 0, view;
  view = screen(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(originalReceipt({ idempotentReplay: true }));
  }, { onDispatch: () => { dispatches++; assert.equal(unresolved(view), true); assert.equal(view.snapshot().busy, true); } });
  await view.load(); view.syncContext(); assert.equal(dispatches, 0);
  await view.choose(id(99)); assert.equal(dispatches, 0);
  await view.choose(id(5)); assert.equal(dispatches, 1); assertUncertain(view);
  await view.load(); assert.equal(dispatches, 1); await view.retry(); assert.equal(dispatches, 2);
  assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

test('dispatch callback invalidation prevents a now-stale POST and cannot resurrect its display', async () => {
  let view, dispatches = 0;
  view = screen(undefined, { onDispatch: () => { dispatches++; view.invalidate(); } });
  await view.load(); assert.equal(await view.choose(id(5)), false);
  assertCleared(view); assert.equal(dispatches, 1); assert.equal(posts(view).length, 0);
  assert.equal(unresolved(view), true); assert.equal(view.keys(), 1); assert.equal(view.snapshot().canRetry, true);
});

test('state must finish and validate before preview GET is dispatched', async () => {
  const pending = deferred(), view = screen(({ kind, reply }) => kind === 'state' ? pending.promise : reply());
  const task = view.load();
  assert.equal(view.calls.length, 1); assert.equal(view.snapshot().busy, true);
  pending.resolve(response(approvalState()));
  await task;
  assert.equal(view.calls.length, 2); assert.equal(view.snapshot().busy, false);
});

test('state and preview projections drop uncontracted private data', async () => {
  const view = screen(({ kind, reply }) => {
    if (kind === 'state') {
      const value = approvalState(); value.secret = 'Private diagnostics'; value.generationGrant = 'must not retain';
      value.approval.owner = 'Private diagnostics'; value.budget.ledger = ['Private diagnostics']; return response(value);
    }
    const value = preview(); value.imageUrl = 'https://invalid.example/image'; value.progress.prompt = 'Private diagnostics';
    return kind === 'preview' ? response(value) : reply();
  });
  await view.load();
  assert.deepEqual(clone(view.snapshot().data), { approvalState: approvalState(), preview: preview() });
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /diagnostics|generationGrant|imageUrl|ledger|prompt/);
});

const invalidStates = {
  contract: value => { value.contract = 'other'; }, work: value => { value.workId = id(99); },
  'invalid-work': value => { value.workId = '../unsafe'; }, 'unknown-state': value => { value.state = 'authorized'; },
  readonly: value => { value.readOnly = false; }, 'missing-readonly': value => { delete value.readOnly; },
  generation: value => { value.generationAuthorized = true; }, 'generation-type': value => { value.generationAuthorized = 'false'; },
  'missing-generation': value => { delete value.generationAuthorized; },
  authorization: value => { value.currentAuthorizationVerified = true; },
  'missing-authorization': value => { delete value.currentAuthorizationVerified; },
  images: value => { value.imageGenerationStarted = true; }, 'missing-images': value => { delete value.imageGenerationStarted; },
  approval: value => { value.approval = null; }, 'approval-array': value => { value.approval = []; },
  'approval-id': value => { value.approval.id = 'invalid'; }, 'missing-expiry': value => { delete value.approval.expiresAt; },
  expiry: value => { value.approval.expiresAt = 'not-a-date'; }, 'numeric-expiry': value => { value.approval.expiresAt = 1; },
  budget: value => { value.budget = null; }, 'budget-array': value => { value.budget = []; },
  'zero-cap': value => { value.budget.approvedBudgetKrw = '0.000000'; },
  'cap-too-high': value => { value.budget.approvedBudgetKrw = '10000.000001'; },
  'committed-arithmetic': value => { value.budget.committedCostKrw = '4000.250002'; },
  'remaining-arithmetic': value => { value.budget.remainingBudgetKrw = '5999.750000'; },
  'missing-remaining': value => { delete value.budget.remainingBudgetKrw; },
  'unknown-ready': value => { value.budget.unknownCostCount = 1; },
  'ready-type': value => { value.budget.evidenceReadyForBudgetCheck = 'true'; },
  'known-null-remaining': value => { value.budget.remainingBudgetKrw = null; },
  'unknown-numeric-remaining': value => { value.state = 'cost_unknown'; value.budget.unknownCostCount = 1; value.budget.evidenceReadyForBudgetCheck = false; },
  'pending-over-request-count': value => { value.budget.pendingCount = 3; },
  'unknown-over-request-count': value => {
    value.state = 'cost_unknown'; value.budget.unknownCostCount = 3;
    value.budget.evidenceReadyForBudgetCheck = false; value.budget.remainingBudgetKrw = null;
  },
  'reuse-over-request-count': value => { value.budget.verifiedSharedReuseCount = 3; },
  'required-retains-approval': value => { value.state = 'approval_required'; },
  'required-retains-budget': value => { value.state = 'approval_required'; value.approval = null; }
};
for (const field of ['knownActualCostKrw', 'reservedMaximumCostKrw', 'committedCostKrw', 'approvedBudgetKrw', 'remainingBudgetKrw']) {
  for (const [name, amount] of [['number', 1], ['negative', '-1.000000'], ['short', '1.0'], ['integer', '1'],
    ['precision', '1.0000001'], ['leading-zero', '01.000000'], ['exponent', '1e3'], ['whitespace', ' 1.000000'], ['plus', '+1.000000']]) {
    invalidStates[`${field}-${name}`] = value => { value.budget[field] = amount; };
  }
}
for (const field of ['requestCount', 'pendingCount', 'unknownCostCount', 'verifiedSharedReuseCount']) {
  for (const [name, count] of [['negative', -1], ['fraction', 0.5], ['string', '1'], ['unsafe', Number.MAX_SAFE_INTEGER + 1]]) {
    invalidStates[`${field}-${name}`] = value => { value.budget[field] = count; };
  }
}
for (const [name, corrupt] of Object.entries(invalidStates)) test(`invalid trial state fails closed before preview: ${name}`, async () => {
  const view = screen(({ kind, reply }) => {
    if (kind !== 'state') return reply();
    const value = approvalState(); corrupt(value); return response(value);
  });
  assert.equal(await view.load(), false);
  assertCleared(view); assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0);
});

test('state parsing rejects null, arrays, malformed JSON, and missing response readers', async () => {
  for (const result of [response(null), response([]), response(null, 200, { text: async () => '{broken' }), { status: 200 }, { status: '200' }]) {
    const view = screen(() => result); await view.load();
    assertCleared(view); assert.equal(view.snapshot().canChoose, false); assert.equal(view.calls.length, 1);
  }
});

for (const state of ['approval_required', 'approval_expired', 'release_changed', 'cost_unknown', 'budget_over_limit']) {
  test(`valid ${state} remains readable but never permits a choice or renews approval`, async () => {
    const value = approvalState(); value.state = state;
    if (state === 'approval_required') { value.approval = null; value.budget = null; }
    if (state === 'approval_expired') value.approval.expiresAt = past;
    if (state === 'cost_unknown') {
      value.budget.unknownCostCount = 1; value.budget.remainingBudgetKrw = null; value.budget.evidenceReadyForBudgetCheck = false;
    }
    if (state === 'budget_over_limit') {
      value.budget.approvedBudgetKrw = '1000.000000'; value.budget.remainingBudgetKrw = '0.000000';
    }
    const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    assert.equal(await view.load(), true);
    assert.deepEqual(clone(view.snapshot().data.approvalState), value);
    assert.equal(view.snapshot().canChoose, false); assert.equal(await view.choose(id(5)), false);
    assert.equal(view.calls.length, 2); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  });
}

test('fully committed budget is not a new client-side denial of zero-cost original choices', async () => {
  const value = approvalState(); value.budget.approvedBudgetKrw = value.budget.committedCostKrw; value.budget.remainingBudgetKrw = '0.000000';
  const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  assert.equal(await view.load(), true); assert.equal(view.snapshot().canChoose, true);
  assert.equal(await view.choose(id(5)), true); assert.equal(posts(view).length, 1);
});

test('decimal arithmetic stays exact beyond the safe-integer range of scaled Number amounts', async () => {
  const value = approvalState(); value.state = 'budget_over_limit';
  Object.assign(value.budget, { knownActualCostKrw: '999999999998.999999', reservedMaximumCostKrw: '1.000000',
    committedCostKrw: '999999999999.999999', remainingBudgetKrw: '0.000000' });
  const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  assert.equal(await view.load(), true);
  assert.deepEqual(clone(view.snapshot().data.approvalState.budget), value.budget);
});

test('locally expired approval cannot be used even if the recorded server state says approval_recorded', async () => {
  const value = approvalState(); value.approval.expiresAt = past;
  const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  await view.load(); assert.equal(view.snapshot().canChoose, false); assert.equal(await view.choose(id(5)), false);
  assert.equal(posts(view).length, 0); assert.equal(view.keys(), 0);
});

test('approval expiry is checked at the explicit click, not only at load time', async () => {
  let now = Date.parse('2026-10-02T00:00:00.000Z');
  class ClockDate extends Date { static now() { return now; } }
  const value = approvalState(); value.approval.expiresAt = new Date(now + 1000).toISOString();
  const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { vm: { Date: ClockDate } });
  await view.load(); assert.equal(view.snapshot().canChoose, true); now += 1000;
  assert.equal(view.snapshot().canChoose, false); assert.equal(await view.choose(id(5)), false);
  assert.equal(posts(view).length, 0); assert.equal(view.keys(), 0);
});

test('caller mutation of a returned snapshot cannot alter the validated POST command', async () => {
  const view = screen(); await view.load(); const displayed = view.snapshot();
  displayed.data.approvalState.approval.id = id(99); displayed.data.preview.progress.revision = 9;
  displayed.data.preview.progress.choices[0].id = id(99); displayed.data.preview.locale = 'en';
  await view.choose(id(5)); assert.deepEqual(JSON.parse(posts(view)[0].options.body), expectedBody);
});

for (const stage of ['state', 'preview']) for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) {
  test(`${stage} GET ${status} clears old display and never reads diagnostics or retries`, async () => {
    let failing = false, reads = 0;
    const view = screen(({ kind, reply }) => failing && kind === stage
      ? response(null, status, { text: () => { reads++; throw new Error('Private server diagnostics'); } }) : reply());
    await view.load(); failing = true;
    const pending = view.load(); assertCleared(view); await pending;
    assertCleared(view); assert.equal(view.snapshot().canChoose, false); assert.equal(view.snapshot().busy, false);
    assert.equal(reads, 0); assert.equal(view.calls.length, stage === 'state' ? 3 : 4);
    assert.equal(posts(view).length, 0); view.syncContext(); assert.equal(view.calls.length, stage === 'state' ? 3 : 4);
  });
}

test('GET transport and body-reader failures fail closed without automatic refresh or private errors', async () => {
  for (const stage of ['state', 'preview']) for (const streamed of [false, true]) {
    const view = screen(({ kind, reply }) => {
      if (kind !== stage) return reply();
      if (!streamed) throw new Error('Private network diagnostics');
      return response(null, 200, { text: async () => { throw new TypeError('Private stream diagnostics'); } });
    });
    await view.load(); assertCleared(view); assert.equal(view.calls.length, stage === 'state' ? 1 : 2);
    assert.doesNotMatch(JSON.stringify(view.snapshot()), /diagnostics/);
  }
});

for (const kind of ['state', 'preview', 'choice']) {
  test(`${kind} Content-Length bound rejects before consuming private data`, async () => {
    let reads = 0, cancelled = 0;
    const limit = kind === 'preview' ? 256 * 1024 : 16 * 1024;
    const view = screen(({ kind: requested, reply }) => requested !== kind ? reply() : response(null, 200, {
      headers: { get: () => String(limit + 1) }, body: { cancel: async () => { cancelled++; } },
      text: async () => { reads++; return '{}'; }
    }));
    if (kind === 'choice') { await view.load(); await view.choose(id(5)); assertUncertain(view); }
    else { await view.load(); assertCleared(view); }
    assert.equal(reads, 0); assert.equal(cancelled, 1); assert.equal(view.calls.length, kind === 'state' ? 1 : kind === 'preview' ? 2 : 3);
  });
  test(`${kind} missing Content-Length is still byte bounded`, async () => {
    const limit = kind === 'preview' ? 256 * 1024 : 16 * 1024;
    const view = screen(({ kind: requested, reply }) => requested !== kind ? reply() : response(null, 200, {
      text: async () => JSON.stringify({ padding: '\uD55C'.repeat(Math.floor(limit / 3) + 1) })
    }));
    if (kind === 'choice') { await view.load(); await view.choose(id(5)); assertUncertain(view); }
    else { await view.load(); assertCleared(view); }
    assert.equal(view.snapshot().canChoose, false);
  });
}

test('a streaming receipt that exceeds its bound is cancelled and preserves its original command', async () => {
  let reads = 0, cancelled = 0;
  const view = screen(({ kind, reply }) => kind !== 'choice' ? reply() : response(null, 201, {
    body: { getReader: () => ({ read: async () => { reads++; return { done: false, value: new Uint8Array(16385) }; },
      cancel: async () => { cancelled++; }, releaseLock() {} }) }
  }));
  await view.load(); await view.choose(id(5)); assertUncertain(view);
  assert.equal(reads, 1); assert.equal(cancelled, 1); assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
});

test('scope changes during receipt decoding erase display and retain command uncertainty', async () => {
  const pending = deferred(), started = deferred();
  const view = screen(({ kind, reply }) => kind !== 'choice' ? reply() : response(null, 200, {
    text: () => { started.resolve(); return pending.promise; }
  }));
  await view.load(); const task = view.choose(id(5)); await started.promise;
  view.set.owner({ ownerId: id(9), epoch: 1 }); pending.resolve(JSON.stringify(originalReceipt())); await task;
  assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canRetry, false);
  assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
});

for (const [name, corrupt] of Object.entries({
  contract: value => { value.contract = 'other'; }, work: value => { value.workId = id(99); }, locale: value => { value.locale = 'en'; },
  revision: value => { value.progress.revision = 0; }, 'duplicate-choices': value => { value.progress.choices[1].id = id(5); },
  'scene-without-beats': value => { value.progress.scene.beats = []; }, images: value => { value.imageGenerationStarted = true; }
})) test(`preview validation is reused before choices become actionable: ${name}`, async () => {
  const view = screen(({ kind, reply }) => {
    if (kind !== 'preview') return reply();
    const value = preview(); corrupt(value); return response(value);
  });
  await view.load(); assertCleared(view); assert.equal(view.snapshot().canChoose, false);
  assert.equal(await view.choose(id(5)), false); assert.equal(view.calls.length, 2); assert.equal(view.keys(), 0);
});

for (const kind of ['none', 'noScene', 'noChoices', 'pending', 'ai_pending', 'completed', 'unknown', 'ending']) {
  test(`saved progress ${kind} cannot dispatch a new command`, async () => {
    const value = preview();
    if (kind === 'none') value.progress = null;
    else if (kind === 'noScene') { value.progress.scene = null; value.progress.choices = []; }
    else if (kind === 'noChoices') value.progress.choices = [];
    else if (kind === 'ending') value.progress.scene.endingType = 'author_main';
    else { value.progress.status = kind === 'unknown' ? 'future_status' : kind; if (kind === 'completed') value.progress.choices = []; }
    const view = screen(({ kind, reply }) => kind === 'preview' ? response(value) : reply());
    await view.load(); assert.equal(view.snapshot().canChoose, false); assert.equal(await view.choose(id(5)), false);
    assert.equal(posts(view).length, 0); assert.equal(view.keys(), 0);
  });
}

test('only an explicit current choice sends the exact private POST body, key, auth epoch, and no-store options', async () => {
  const view = screen(); await view.load();
  for (const choice of [null, '', '../unsafe', id(99), { id: id(5) }]) assert.equal(await view.choose(choice), false);
  assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  assert.equal(await view.choose(id(5), view.snapshot().ticket), true);
  const { url, options } = posts(view)[0];
  assert.equal(url, `/api/v1/me/creator-studio/stories/${id(1)}/body-trial/choices/${id(5)}`);
  assert.deepEqual(JSON.parse(options.body), expectedBody);
  assert.equal(options.headers['Idempotency-Key'], 'trial-test-0001');
  assert.equal(options.headers['Content-Type'], 'application/json'); assert.equal(options.headers['Cache-Control'], 'no-store');
  assert.equal(options._retried, true); assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
  assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  assert.deepEqual(clone(view.snapshot().receipt), originalReceipt());
  assert.equal(unresolved(view), false); assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.snapshot().canRetry, false); assert.equal(view.calls.length, 3);
  view.syncContext(); assert.equal(await view.retry(), false); assert.equal(await view.choose(id(6)), false);
  assert.equal(view.calls.length, 3); assert.equal(view.keys(), 1);
});

test('an old ticket cannot load, choose, or replay after explicit invalidation', async () => {
  const view = screen(); await view.load(); const old = view.snapshot().ticket;
  view.invalidate(); assert.notEqual(view.snapshot().ticket, old);
  assert.equal(await view.load(old), false); assert.equal(await view.choose(id(5), old), false); assert.equal(await view.retry(old), false);
  assertCleared(view); assert.equal(view.calls.length, 2); assert.equal(view.keys(), 0);
});

for (const operation of ['load', 'choose', 'retry']) {
  test(`busy ${operation} blocks double clicks and all competing operations`, async () => {
    const pending = deferred(); let block = false, firstChoice = true;
    const view = screen(({ kind, reply }) => {
      if (operation === 'retry' && kind === 'choice' && firstChoice) { firstChoice = false; throw new TypeError('Lost response'); }
      return block ? pending.promise : reply();
    });
    if (operation !== 'load') await view.load();
    if (operation === 'retry') await view.choose(id(5));
    block = true;
    const task = operation === 'choose' ? view.choose(id(5)) : view[operation]();
    const count = view.calls.length, keys = view.keys();
    assert.equal(view.snapshot().busy, true);
    assert.equal(await view.load(), false); assert.equal(await view.choose(id(5)), false); assert.equal(await view.retry(), false);
    assert.equal(view.calls.length, count); assert.equal(view.keys(), keys);
    block = false; pending.resolve(response(operation === 'load' ? approvalState() : originalReceipt({ idempotentReplay: operation === 'retry' })));
    await task; assert.equal(view.snapshot().busy, false);
  });
}

for (const status of [400, 401, 403, 404, 409, 422]) {
  test(`first authoritative POST ${status} may clear the command but requires a fresh explicit load`, async () => {
    let failing = true, reads = 0;
    const view = screen(({ kind, reply }) => kind === 'choice' && failing
      ? response(null, status, { text: () => { reads++; throw new Error('Private diagnostic'); } }) : reply());
    await view.load(); assert.equal(await view.choose(id(5)), false);
    assert.equal(reads, 0); assert.equal(unresolved(view), false); assert.equal(view.snapshot().canChoose, false);
    assert.equal(view.snapshot().canRetry, false); assert.equal(await view.choose(id(6)), false);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
    failing = false; await view.load(); assert.equal(await view.choose(id(5)), true);
    assert.equal(posts(view).length, 2); assert.equal(posts(view)[1].options.headers['Idempotency-Key'], 'trial-test-0002');
  });
}

const uncertainResults = {
  transport: () => { throw new TypeError('Private network detail'); },
  'untrusted-error-kind': () => { throw Object.assign(new Error('Private detail'), { kind: 'success' }); },
  server500: () => response(null, 500), server503: () => response(null, 503),
  'body-transport': () => response(null, 200, { text: async () => { throw new TypeError('Connection reset'); } }),
  'invalid-json': () => response(null, 200, { text: async () => '{broken' }),
  'missing-reader': () => ({ status: 200 }), 'invalid-status': () => ({ status: '200' }),
  'empty-success': () => response(null, 204), 'null-receipt': () => response(null), 'array-receipt': () => response([]),
  'wrong-contract': () => response(originalReceipt({ contract: 'other' })),
  'wrong-progress': () => response(originalReceipt({ progressId: id(99) })),
  'wrong-revision': () => response(originalReceipt({ revisionAfterRequest: 3 })),
  'unchanged-revision': () => response(originalReceipt({ revisionAfterRequest: 1 })),
  'string-revision': () => response(originalReceipt({ revisionAfterRequest: '2' })),
  'unsafe-revision': () => response(originalReceipt({ revisionAfterRequest: Number.MAX_SAFE_INTEGER + 1 })),
  'unknown-status': () => response(originalReceipt({ status: 'future_status' })),
  'generation-started': () => response(originalReceipt({ generationStarted: true })),
  'missing-generation-flag': () => { const value = originalReceipt(); delete value.generationStarted; return response(value); },
  'images-started': () => response(originalReceipt({ imageGenerationStarted: true })),
  'missing-image-flag': () => { const value = originalReceipt(); delete value.imageGenerationStarted; return response(value); },
  'replay-type': () => response(originalReceipt({ idempotentReplay: 'false' })),
  'missing-replay-flag': () => { const value = originalReceipt(); delete value.idempotentReplay; return response(value); }
};
for (const [name, result] of Object.entries(uncertainResults)) test(`POST ${name} retains one unresolved command and never creates an automatic replacement`, async () => {
  const view = screen(({ kind, reply }) => kind === 'choice' ? result() : reply());
  await view.load(); assert.equal(await view.choose(id(5)), false);
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true);
  assert.equal(await view.choose(id(6)), false); view.syncContext(); view.snapshot();
  assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /Private network|Private detail|Connection reset/);
});

test('explicit retry uses the original body and key even after a newer GET changes approval and progress', async () => {
  let first = true, newer = false;
  const view = screen(({ kind, reply }) => {
    if (kind === 'choice') { if (first) { first = false; throw new TypeError('Lost receipt'); } return response(originalReceipt({ idempotentReplay: true })); }
    if (!newer) return reply();
    if (kind === 'state') { const value = approvalState(); value.approval.id = id(77); value.state = 'approval_expired'; value.approval.expiresAt = past; return response(value); }
    const value = preview(); value.progress.progressId = id(22); value.progress.revision = 9; value.progress.choices = [{ id: id(55), label: 'Different route', routeKind: 'branch' }]; return response(value);
  });
  await view.load(); await view.choose(id(5)); const firstPost = posts(view)[0];
  newer = true; assert.equal(await view.load(), true);
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true); assert.equal(await view.choose(id(55)), false);
  assert.equal(await view.retry(), true); assertReplay(firstPost, posts(view)[1]);
  assert.deepEqual(JSON.parse(posts(view)[1].options.body), expectedBody);
  assert.equal(view.keys(), 1); assert.equal(unresolved(view), false);
  assert.equal(view.snapshot().receipt.idempotentReplay, true); assert.equal(view.calls.length, 6);
});

for (const status of [400, 401, 403, 404, 409, 422, 500, 503]) {
  test(`failed explicit replay HTTP ${status} retains uncertainty, body, and key`, async () => {
    let attempts = 0, reads = 0;
    const view = screen(({ kind, reply }) => {
      if (kind !== 'choice') return reply();
      if (++attempts === 1) throw new TypeError('Lost receipt');
      return response(null, status, { text: () => { reads++; throw new Error('Private diagnostics'); } });
    });
    await view.load(); await view.choose(id(5));
    for (let i = 0; i < 2; i++) {
      assert.equal(await view.retry(), false); assertUncertain(view); assert.equal(view.snapshot().canRetry, true);
      assertReplay(posts(view)[0], posts(view).at(-1));
    }
    assert.equal(posts(view).length, 3); assert.equal(view.keys(), 1); assert.equal(reads, 0);
    assert.equal(await view.choose(id(6)), false);
  });
}

for (const name of ['transport', 'body-transport', 'invalid-json', 'wrong-progress']) {
  test(`failed explicit replay ${name} also retains the original command`, async () => {
    let attempts = 0;
    const view = screen(({ kind, reply }) => {
      if (kind !== 'choice') return reply();
      if (++attempts === 1) throw new TypeError('Lost receipt');
      return uncertainResults[name]();
    });
    await view.load(); await view.choose(id(5)); await view.retry();
    assertUncertain(view); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
  });
}

test('even a failed GET during uncertainty cannot discard the original command', async () => {
  let failing = false;
  const view = screen(({ kind, reply }) => {
    if (kind === 'choice') throw new TypeError('Lost receipt');
    return failing ? response(null, 403) : reply();
  });
  await view.load(); await view.choose(id(5)); failing = true; await view.load();
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true);
  await view.retry(); assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

const scopeChanges = {
  work: view => view.set.work(id(9)), source: view => view.set.source('en'), language: view => view.set.language('ja'),
  account: view => view.set.owner({ ownerId: id(9), epoch: 1 }), epoch: view => view.set.owner({ ownerId: id(8), epoch: 2 }),
  logout: view => view.set.owner(null), permission: view => view.set.authorized(false), hidden: view => view.set.shown(false),
  'identity-error': view => view.set.brokenIdentity(true)
};
for (const [name, change] of Object.entries(scopeChanges)) {
  test(`display is erased synchronously after ${name} without a request`, async () => {
    const view = screen(); await view.load(); const ticket = view.snapshot().ticket;
    change(view); view.syncContext(); assertCleared(view);
    assert.notEqual(view.snapshot().ticket, ticket); assert.equal(view.snapshot().canChoose, false); assert.equal(view.calls.length, 2);
  });
  for (const stage of ['state', 'preview']) test(`late ${stage} GET cannot restore display after ${name}, even without an event`, async () => {
    const pending = deferred(), started = deferred();
    const view = screen(({ kind, reply }) => { if (kind !== stage) return reply(); started.resolve(); return pending.promise; });
    const task = view.load(); await started.promise; change(view);
    pending.resolve(response(stage === 'state' ? approvalState() : preview())); await task;
    assertCleared(view); assert.equal(view.snapshot().canChoose, false);
    assert.equal(view.calls.length, stage === 'state' ? 1 : 2);
  });
  test(`late choice receipt after ${name} cannot restore display or lose the unresolved command`, async () => {
    const pending = deferred(), view = screen(({ kind, reply }) => kind === 'choice' ? pending.promise : reply());
    await view.load(); const task = view.choose(id(5)); change(view); view.syncContext(); assertCleared(view);
    pending.resolve(response(originalReceipt())); await task;
    assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canChoose, false);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  });
}

for (const [name, change] of Object.entries(scopeChanges)) {
  test(`unresolved command survives ${name}; replay is restricted to its original owner, work, and source`, async () => {
    const view = screen(({ kind, reply }) => { if (kind === 'choice') throw new TypeError('Lost receipt'); return reply(); });
    await view.load(); await view.choose(id(5)); change(view); view.syncContext();
    assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canChoose, false);
    const allowed = ['language', 'epoch'].includes(name);
    assert.equal(view.snapshot().canRetry, allowed);
    assert.equal(await view.retry(), false);
    assert.equal(posts(view).length, allowed ? 2 : 1); assert.equal(view.keys(), 1);
    if (allowed) assertReplay(posts(view)[0], posts(view)[1], name === 'epoch' ? 2 : 1);
  });
}

test('unresolved command blocks a new choice across accounts, works, and source languages, even after GET succeeds', async () => {
  const view = screen(({ kind, reply }) => { if (kind === 'choice') throw new TypeError('Lost receipt'); return reply(); });
  await view.load(); await view.choose(id(5));
  for (const change of [scopeChanges.account, scopeChanges.work, scopeChanges.source]) {
    change(view); view.syncContext(); assert.equal(await view.load(), true);
    assertUncertain(view); assert.equal(view.snapshot().canRetry, false); assert.equal(await view.choose(id(5)), false);
  }
  assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  view.set.owner({ ownerId: id(8), epoch: 4 }); view.set.work(id(1)); view.set.source('ko'); view.syncContext();
  assert.equal(view.snapshot().canRetry, true); await view.retry(); assertReplay(posts(view)[0], posts(view)[1], 4);
});

test('invalidate aborts in-flight requests but never discards a potentially submitted command', async () => {
  const pending = deferred(), view = screen(({ kind, reply }) => kind === 'choice' ? pending.promise : reply());
  await view.load(); const task = view.choose(id(5)); view.invalidate();
  assert.equal(posts(view)[0].options.signal.aborted, true); assertCleared(view); assert.equal(unresolved(view), true);
  pending.reject(new TypeError('Aborted after server acceptance')); await task;
  assertUncertain(view); assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
});

test('switching away and back cannot resurrect an older read over a newer explicit load', async () => {
  const pending = deferred(); let count = 0;
  const view = screen(({ kind, reply }) => kind === 'state' && ++count === 1 ? pending.promise : reply());
  const task = view.load(); view.set.work(id(9)); view.syncContext(); view.set.work(id(1)); view.syncContext();
  await view.load(); const current = clone(view.snapshot());
  pending.resolve(response(approvalState(id(9)))); await task;
  assert.deepEqual(clone(view.snapshot()), current); assert.equal(view.calls.length, 3);
});

test('late replay receipt after a scope change remains unresolved and never populates another work', async () => {
  const pending = deferred(); let count = 0;
  const view = screen(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return pending.promise;
  });
  await view.load(); await view.choose(id(5)); const task = view.retry();
  view.set.work(id(9)); view.syncContext(); pending.resolve(response(originalReceipt({ idempotentReplay: true }))); await task;
  assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canRetry, false);
  assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
});

for (const status of ['active', 'completed']) for (const httpStatus of [200, 201]) {
  test(`canonical original ${status} receipt with HTTP ${httpStatus} is accepted without refreshing or retaining extras`, async () => {
    const value = originalReceipt({ status });
    const view = screen(({ kind, reply }) => kind === 'choice'
      ? response({ ...value, privatePrompt: 'Private diagnostics', imageUrl: 'https://invalid.example/image' }, httpStatus) : reply());
    await view.load(); assert.equal(await view.choose(id(5)), true);
    assert.deepEqual(clone(view.snapshot().receipt), value);
    assert.equal(unresolved(view), false); assert.equal(view.snapshot().canRetry, false); assert.equal(view.calls.length, 3);
  });
}

for (const status of ['queued', 'processing', 'completed', 'failed', 'timeout']) {
  test(`canonical AI ${status} continuation receipt needs no generationStarted field and never starts polling or provider retries`, async () => {
    const value = aiReceipt(status); assert.equal(Object.hasOwn(value, 'generationStarted'), false);
    const view = screen(({ kind, reply }) => kind === 'choice' ? response({ ...value, prompt: 'Private diagnostics' }, 201) : reply());
    await view.load(); assert.equal(await view.choose(id(6)), true);
    const receipt = view.snapshot().receipt;
    assert.equal(receipt.continuationId, id(10)); assert.equal(receipt.status, status);
    assert.equal(receipt.revisionAfterRequest, 2); assert.equal(receipt.imageGenerationStarted, false);
    assert.equal(receipt.progressApplied, status === 'completed'); assert.equal(receipt.idempotentReplay, false);
    assert.equal(view.snapshot().messageKey, status === 'failed' ? 'generationFailed' : status === 'timeout' ? 'generationTimeout'
      : status === 'completed' ? 'accepted' : 'generating');
    assert.doesNotMatch(JSON.stringify(receipt), /Private diagnostics|prompt/);
    assert.equal(unresolved(view), false); assert.equal(view.snapshot().canChoose, false); assert.equal(view.snapshot().canRetry, false);
    view.syncContext(); assert.equal(await view.retry(), false); assert.equal(view.calls.length, 3);
  });
}

for (const [name, corrupt] of Object.entries({
  id: value => { value.continuationId = 'unsafe'; }, revision: value => { value.revisionAfterRequest = 99; },
  status: value => { value.status = 'retry_wait'; }, progress: value => { value.progressApplied = 'false'; },
  'missing-progress': value => { delete value.progressApplied; }, images: value => { value.imageGenerationStarted = true; },
  replay: value => { value.idempotentReplay = 1; }, 'private-input': value => { value.privateInputReturned = true; },
  'provider-payload': value => { value.providerPayloadReturned = true; }, 'internal-cost': value => { value.internalCostReturned = true; }
})) test(`malformed AI receipt ${name} preserves uncertainty instead of claiming acceptance`, async () => {
  const value = aiReceipt(); corrupt(value);
  const view = screen(({ kind, reply }) => kind === 'choice' ? response(value, 201) : reply());
  await view.load(); assert.equal(await view.choose(id(6)), false); assertUncertain(view);
  assert.equal(view.snapshot().canRetry, true); assert.equal(view.keys(), 1); assert.equal(posts(view).length, 1);
});

test('AI receipt replay resolves uncertainty with the same key and no follow-up request', async () => {
  let count = 0;
  const view = screen(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(aiReceipt('processing', { idempotentReplay: true }));
  });
  await view.load(); await view.choose(id(6)); assert.equal(await view.retry(), true);
  assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.snapshot().receipt.status, 'processing');
  assert.equal(unresolved(view), false); assert.equal(view.keys(), 1); assert.equal(view.calls.length, 4);
});

for (const uiLocale of locales) for (const sourceLocale of locales) {
  test(`UI ${uiLocale} and original ${sourceLocale} remain independent for GET, POST, and replay`, async () => {
    let count = 0;
    const view = screen(({ kind, reply }) => {
      if (kind !== 'choice') return reply();
      if (++count === 1) throw new TypeError('Lost receipt');
      return response(originalReceipt({ idempotentReplay: true }));
    });
    view.set.language(uiLocale); view.set.source(sourceLocale); await view.load();
    assert.equal(view.snapshot().locale, uiLocale); assert.equal(view.snapshot().data.preview.locale, sourceLocale);
    assert.ok(view.calls[1].url.endsWith(`?locale=${sourceLocale}`)); await view.choose(id(5));
    assert.equal(JSON.parse(posts(view)[0].options.body).locale, sourceLocale);
    view.set.language(locales[(locales.indexOf(uiLocale) + 1) % locales.length]); view.syncContext(); assertCleared(view);
    assert.equal(view.snapshot().canRetry, true); assert.equal(await view.retry(), true);
    assertReplay(posts(view)[0], posts(view)[1]); assert.equal(view.keys(), 1);
    const words = view.api.copy[uiLocale]; assert.deepEqual(Object.keys(words).sort(), Object.keys(view.api.copy.ko).sort());
    for (const [key, text] of Object.entries(words)) assert.ok(typeof text === 'string' && (key === 'hidden' || text.length > 0), key);
  });
}

for (const [change, value] of [['work', ''], ['work', '../unsafe'], ['source', 'zh'], ['owner', null],
  ['owner', { ownerId: id(8), epoch: '1' }], ['authorized', false], ['shown', false], ['brokenIdentity', true]]) {
  test(`invalid or inaccessible input ${change}=${JSON.stringify(value)} cannot fetch or create a key`, async () => {
    const view = screen(); view.set[change](value); await view.load(); await view.choose(id(5)); await view.retry();
    assertCleared(view); assert.equal(view.calls.length, 0); assert.equal(view.keys(), 0); assert.equal(view.snapshot().canChoose, false);
  });
}

test('default idempotency factory uses secure randomUUID once and keeps it for replay', async () => {
  let generated = 0, count = 0;
  const crypto = { randomUUID: () => { generated++; return id(90); } };
  const view = screen(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(originalReceipt({ idempotentReplay: true }));
  }, { defaultKey: true, vm: { crypto, window: { crypto } } });
  await view.load(); await view.choose(id(5)); await view.retry();
  assert.equal(generated, 1); assert.equal(posts(view)[0].options.headers['Idempotency-Key'], id(90));
  assertReplay(posts(view)[0], posts(view)[1]);
});

test('missing or throwing secure randomness fails closed without a weak fallback POST', async () => {
  for (const crypto of [undefined, {}, { randomUUID: () => { throw new Error('Unavailable'); } }]) {
    const view = screen(undefined, { defaultKey: true, vm: { crypto, window: { crypto } } });
    await view.load(); assert.equal(await view.choose(id(5)), false);
    assert.equal(posts(view).length, 0); assert.equal(unresolved(view), false);
  }
  assert.doesNotMatch(source, /Math\.random\s*\(/);
});

for (const key of [null, 123, 'short', 'x'.repeat(121), 'bad key!!', 'bad\nkey!!', '\uD55C'.repeat(8)]) {
  test(`invalid injected idempotency key is rejected before POST: ${JSON.stringify(key)}`, async () => {
    const view = screen(undefined, { makeIdempotencyKey: () => key }); await view.load();
    assert.equal(await view.choose(id(5)), false); assert.equal(posts(view).length, 0); assert.equal(unresolved(view), false);
  });
}

for (const key of ['key-0001', 'A._:-123', 'x'.repeat(120)]) {
  test(`valid ASCII idempotency boundary ${key.length} is sent unchanged`, async () => {
    const view = screen(undefined, { makeIdempotencyKey: () => key }); await view.load();
    assert.equal(await view.choose(id(5)), true); assert.equal(posts(view)[0].options.headers['Idempotency-Key'], key);
  });
}

test('a new controller cannot recover a previous unresolved command from storage', async () => {
  const first = screen(({ kind, reply }) => { if (kind === 'choice') throw new TypeError('Lost receipt'); return reply(); });
  await first.load(); await first.choose(id(5)); assertUncertain(first);
  const next = first.api.createController({ fetch: () => { throw new Error('Unexpected request'); },
    identity: () => ({ ownerId: id(8), epoch: 1 }), isCurrent: () => true,
    context: () => ({ workId: id(1), locale: 'ko' }), locale: () => 'ko', visible: () => true });
  assert.equal(Boolean(next.snapshot().unresolved), false); assert.equal(next.snapshot().canRetry, false);
  assert.equal(await next.retry(), false); assert.equal(posts(first).length, 1);
});

// Only the small DOM surface used by the two mounts is modeled here.
const walk = node => [node, ...node.children.flatMap(walk)];
class Element {
  constructor(tag = 'div', name = '') {
    this.tagName = tag.toUpperCase(); this.id = name; this.children = []; this.listeners = new Map(); this.attributes = {};
    this.dataset = {}; this.className = ''; this.hidden = false; this.disabled = false; this.value = ''; this._text = '';
    const classes = new Set();
    this.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, callback) { const list = this.listeners.get(type) || []; list.push(callback); this.listeners.set(type, list); }
  fire(type, event = {}) { let result; for (const callback of this.listeners.get(type) || []) result = callback({ type, target: this, ...event }); return result; }
  closest(selector) { return selector === '[data-section]' && this.getAttribute('data-section') !== null ? this : null; }
}
function mounted(handler = ({ reply }) => reply()) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell');
  const section = new Element('section', 'writer-manuscript'), host = new Element('section', 'writerBodyTrial');
  const readonly = new Element('section', 'writerBodyPreview');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = id(1); sourceLocale.value = 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, host, readonly, work, sourceLocale].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = { ownerId: id(8), epoch: 1 }, language = 'ko', accessToken = 'existing-access-token', refreshAttempts = 0;
  const calls = [], observers = [], events = [];
  window.crypto = { randomUUID: () => id(90) };
  window.getAuth = () => ({ accessToken, refreshToken: 'must-not-use' });
  window.luminaI18n = { getLocale: () => language };
  window.dispatchEvent = event => { events.push(event.type); window.fire(event.type); return true; };
  window.LuminaCreatorStudioApi = {
    identity: () => owner,
    isCurrent: value => owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: async (url, options) => {
      if (!options.token || !options._retried) refreshAttempts++;
      const kind = options.method === 'POST' ? 'choice' : url.includes('/body-trial-state') ? 'state' : 'preview';
      const target = { workId: work.value, locale: sourceLocale.value }, call = { url, options, kind };
      calls.push(call);
      const reply = () => response(kind === 'state' ? approvalState(target.workId)
        : kind === 'preview' ? preview(target.workId, target.locale) : originalReceipt());
      return handler({ ...call, target, calls, reply });
    }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { observers.push({ target, options, callback: this.callback }); }
  }
  class Event { constructor(type) { this.type = type; } }
  const { api } = library({ window, document, MutationObserver, Event });
  assert.equal(api.mount(host), null, 'automatic mount is idempotent');
  const button = name => walk(host).find(node => node.id === name);
  return { window, document, shell, section, host, readonly, work, sourceLocale, api, calls, observers, events,
    refresh: () => button('writerBodyTrialRefresh'), retryButton: () => button('writerBodyTrialRetry'),
    choices: () => walk(host).filter(node => node.className === 'body-trial-choice'),
    load: () => button('writerBodyTrialRefresh').fire('click'), retry: () => button('writerBodyTrialRetry').fire('click'),
    loadReadonly: () => walk(readonly).find(node => node.tagName === 'BUTTON').fire('click'),
    setOwner: value => { owner = value; }, setToken: value => { accessToken = value; },
    locale: value => { language = value; }, refreshAttempts: () => refreshAttempts,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); }
  };
}

test('entry includes one unframed trial mount and loads trial after the shared API, auth, and preview parser', () => {
  assert.match(entry, /href="\/pages\/creator-body-trial\.css\?v=[^"]+"/);
  assert.match(entry, /<section id="writerBodyTrial" aria-labelledby="writerBodyTrialTitle"><\/section>/);
  assert.equal((entry.match(/id="writerBodyTrial"/g) || []).length, 1);
  const trial = entry.indexOf('src="/pages/creator-body-trial.js');
  for (const dependency of ['src="/pages/creator-studio.js', 'src="/app.js', 'src="/pages/creator-body-preview.js']) {
    assert.ok(entry.indexOf(dependency) >= 0 && entry.indexOf(dependency) < trial, dependency);
  }
  assert.ok(entry.indexOf('id="writer-manuscript"') < entry.indexOf('id="writerBodyTrial"'));
  assert.ok(entry.indexOf('id="writerBodyTrial"') < entry.indexOf('id="story-intake"'));
});

test('mount stays idle and uses existing token with no shared API refresh, retry, or global network access', async () => {
  const view = mounted(); assert.equal(view.calls.length, 0);
  assert.equal(view.refresh().type, 'button'); assert.ok(view.refresh().title); assert.ok(view.refresh().getAttribute('aria-label'));
  assert.equal(view.retryButton().hidden, true);
  for (const type of ['focus', 'pageshow', 'lumina:localechange', 'storage', 'lumina:authchange']) view.window.fire(type);
  assert.equal(view.calls.length, 0);
  await view.load(); assert.equal(view.calls.length, 2);
  for (const { options } of view.calls) {
    assert.equal(options.token, 'existing-access-token'); assert.equal(options._retried, true); assert.equal(options.cache, 'no-store');
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  }
  assert.equal(view.refreshAttempts(), 0); view.setToken(null); await view.load();
  assert.equal(view.calls.length, 2); assert.equal(view.refreshAttempts(), 0);
  assert.doesNotMatch(view.host.textContent, /Private trial text/);
});

test('mount forwards POST body as an object for shared API serialization and replays the same object values and key', async () => {
  let count = 0;
  const view = mounted(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(originalReceipt({ idempotentReplay: true }), 201);
  });
  await view.load(); await view.choices()[0].fire('click');
  const first = posts(view)[0];
  assert.equal(typeof first.options.body, 'object'); assert.deepEqual(clone(first.options.body), expectedBody);
  assert.equal(first.options.headers['Idempotency-Key'], id(90)); assert.equal(first.options.token, 'existing-access-token');
  assert.equal(view.retryButton().hidden, false); assert.equal(view.retryButton().disabled, false);
  assert.equal(view.choices().length, 0); await view.retry();
  const replay = posts(view)[1];
  assert.equal(typeof replay.options.body, 'object'); assert.deepEqual(clone(replay.options.body), expectedBody);
  assert.equal(replay.url, first.url); assert.equal(replay.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']);
  assert.equal(replay.options._retried, true); assert.equal(replay.options.cache, 'no-store');
  assert.equal(replay.options.token, 'existing-access-token'); assert.equal(view.retryButton().hidden, true);
  assert.equal(view.refreshAttempts(), 0); assert.equal(view.calls.length, 4);
  assert.deepEqual(view.events, ['lumina:author-body-trial-progress-changed', 'lumina:author-body-trial-progress-changed']);
});

test('dispatch invalidates the independent read-only preview immediately, even when the response is lost', async () => {
  const pending = deferred();
  const view = mounted(({ kind, reply }) => kind === 'choice' ? pending.promise : reply());
  await view.loadReadonly(); await view.load(); assert.match(view.readonly.textContent, /Private trial text/);
  const task = view.choices()[0].fire('click');
  assert.doesNotMatch(view.readonly.textContent, /Private trial text|Saved private scene|Original route/);
  assert.equal(view.calls.length, 4); assert.equal(view.refresh().disabled, true);
  assert.deepEqual(view.events, ['lumina:author-body-trial-progress-changed']);
  pending.reject(new TypeError('Lost receipt')); await task;
  assert.equal(view.retryButton().disabled, false); assert.equal(view.calls.length, 4);
});

test('mounted choice controls preserve literal private title, prose, labels, and source language', async () => {
  const attack = '<img src=x onerror=attack()><script>steal()</script><a href="javascript:steal()">open</a>';
  const value = preview(); value.progress.scene.title = attack; value.progress.scene.beats[0].content = attack;
  value.progress.choices[0].label = attack;
  const view = mounted(({ kind, reply }) => kind === 'preview' ? response(value) : reply()); await view.load();
  assert.ok(view.host.textContent.includes(attack)); assert.equal(view.choices()[0].textContent, attack);
  assert.equal(walk(view.host).filter(node => ['IMG', 'SCRIPT', 'A', 'IFRAME', 'INPUT', 'TEXTAREA'].includes(node.tagName)).length, 0);
  assert.equal(walk(view.host).find(node => node.className === 'body-trial-source').lang, 'ko');
  assert.equal(posts(view).length, 0); assert.equal(view.choices().length, 2);
});

for (const uiLocale of locales) test(`mounted ${uiLocale} labels retain Japanese source text and no automatic mutation`, async () => {
  const view = mounted(); view.locale(uiLocale); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
  assert.equal(view.calls.length, 0); await view.load();
  assert.equal(view.host.lang, uiLocale); assert.equal(view.refresh().title, view.api.copy[uiLocale].refresh);
  assert.equal(view.refresh().getAttribute('aria-label'), view.api.copy[uiLocale].refresh);
  assert.equal(view.retryButton().title, view.api.copy[uiLocale].retry);
  assert.equal(walk(view.host).find(node => node.className === 'body-trial-source').lang, 'ja');
  assert.ok(view.host.textContent.includes(preview().progress.scene.beats[0].content));
  assert.ok(view.calls[1].url.endsWith('?locale=ja')); assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0);
  assert.doesNotMatch(view.host.textContent, /approval_recorded|writer_original|generation_required/);
});

test('unknown costs display a translated unknown balance and disable every mounted choice', async () => {
  const value = approvalState(); value.state = 'cost_unknown'; value.budget.unknownCostCount = 1;
  value.budget.evidenceReadyForBudgetCheck = false; value.budget.remainingBudgetKrw = null;
  const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  await view.load();
  const amounts = walk(view.host).find(node => node.className === 'body-trial-budget');
  assert.ok(amounts.textContent.includes(view.api.copy.ko.unknown));
  for (const button of view.choices()) { assert.equal(button.disabled, true); await button.fire('click'); }
  assert.equal(posts(view).length, 0); assert.equal(view.calls.length, 2);
});

for (const name of ['work', 'source', 'authchange', 'expired-window', 'expired-document', 'storage', 'pagehide',
  'tab-click', 'hidden-shell', 'hidden-section', 'hidden-host', 'visibility', 'language']) {
  test(`mounted private DOM clears on ${name}; captured old choice never dispatches`, async () => {
    const view = mounted(); await view.load(); const oldChoice = view.choices()[0];
    assert.match(view.host.textContent, /Private trial text/);
    if (name === 'work') { view.work.value = id(9); view.work.fire('change'); }
    if (name === 'source') { view.sourceLocale.value = 'en'; view.sourceLocale.fire('input'); }
    if (name === 'authchange') view.window.fire('lumina:authchange');
    if (name === 'expired-window') view.window.fire('lumina:auth-expired');
    if (name === 'expired-document') view.document.fire('lumina:auth-expired');
    if (name === 'storage') view.window.fire('storage');
    if (name === 'pagehide') view.window.fire('pagehide');
    if (name === 'tab-click') { const tab = new Element('button'); tab.setAttribute('data-section', 'artist-list'); view.document.fire('click', { target: tab }); }
    if (name === 'hidden-shell') { view.shell.hidden = true; view.mutate(view.shell); }
    if (name === 'hidden-section') { view.section.classList.remove('is-active'); view.mutate(view.section); }
    if (name === 'hidden-host') { view.host.hidden = true; view.mutate(view.host); }
    if (name === 'visibility') { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
    if (name === 'language') { view.locale('en'); view.window.fire('lumina:localechange'); }
    assert.doesNotMatch(view.host.textContent, /Private trial text|Saved private scene|Original route/);
    await oldChoice.fire('click'); assert.equal(view.calls.length, 2); assert.equal(view.events.length, 0);
  });
}

test('mounted hide/show in one task erases a pending response and cannot repopulate private text', async () => {
  const pending = deferred(), view = mounted(() => pending.promise), task = view.load();
  view.section.classList.remove('is-active'); view.section.classList.add('is-active'); view.mutate(view.section);
  pending.resolve(response(approvalState())); await task;
  assert.doesNotMatch(view.host.textContent, /Private trial text|Saved private scene|Original route/);
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.signal.aborted, true);
});

test('trial CSS keeps wrapping prose, fixed icon targets, responsive type, and private print exclusion', () => {
  assert.match(css, /font-family: Pretendard/); assert.match(css, /font-size: 18px/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 100px/);
  assert.match(css, /width: 44px;\s*height: 44px/); assert.match(css, /min-height: 44px/);
  assert.match(css, /white-space: pre-wrap/); assert.match(css, /overflow-wrap: anywhere/); assert.match(css, /letter-spacing: 0/);
  assert.match(css, /font-size: 17px/); assert.match(css, /@media print[^\n]*#writerBodyTrial[^\n]*display: none/);
  assert.doesNotMatch(css, /\d(?:vw|cqw)|linear-gradient|box-shadow|overflow-y|position:\s*(fixed|absolute)/);
});

const budgetSeparationScopes = [
  ['all_recommended_body_requests_for_author_work', 0],
  ['approved_historical_unknown_separation', 2]
];
function scopedApprovalState(costScope = budgetSeparationScopes[1][0]) {
  const value = approvalState();
  Object.assign(value.budget, { costScope, historicalUnknownCostCount: costScope === budgetSeparationScopes[0][0] ? 0 : 2,
    knownActualCostKrw: '45.589500', committedCostKrw: '4045.589500', remainingBudgetKrw: '5954.410500' });
  return value;
}

test('budget separation regression: absent fields preserve the legacy contract without inventing a scope', async () => {
  const value = approvalState(), view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  assert.deepEqual(clone(view.api.parseState(value, { workId: id(1) })), value);
  assert.equal(await view.load(), true);
  const budget = view.snapshot().data.approvalState.budget;
  assert.equal(Object.hasOwn(budget, 'costScope'), false);
  assert.equal(Object.hasOwn(budget, 'historicalUnknownCostCount'), false);
  assert.equal(view.snapshot().canChoose, true); assert.equal(posts(view).length, 0);
});

for (const [costScope, historicalUnknownCostCount] of budgetSeparationScopes) {
  test(`budget separation regression: preserves ${costScope}, its history count, and confirmed costs`, async () => {
    const value = scopedApprovalState(costScope), expected = clone(value);
    value.budget.ledger = ['Private diagnostics'];
    const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    assert.deepEqual(clone(view.api.parseState(value, { workId: id(1) })), expected);
    assert.equal(await view.load(), true);
    assert.deepEqual(clone(view.snapshot().data.approvalState), expected);
    const budget = view.snapshot().data.approvalState.budget;
    assert.equal(budget.costScope, costScope); assert.equal(budget.historicalUnknownCostCount, historicalUnknownCostCount);
    assert.equal(budget.knownActualCostKrw, '45.589500'); assert.equal(budget.committedCostKrw, '4045.589500');
    assert.equal(budget.remainingBudgetKrw, '5954.410500'); assert.equal(Object.hasOwn(budget, 'ledger'), false);
    assert.equal(view.snapshot().canChoose, true); assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0);
    budget.costScope = 'invalid'; budget.historicalUnknownCostCount = 0; budget.knownActualCostKrw = '0.000000';
    assert.deepEqual(clone(view.snapshot().data.approvalState), expected);
  });
}

const invalidBudgetSeparationStates = {};
for (const [costScope] of budgetSeparationScopes) {
  for (const key of ['costScope', 'historicalUnknownCostCount']) {
    invalidBudgetSeparationStates[`${costScope}-missing-${key}`] = value => {
      value.budget.costScope = costScope; delete value.budget[key];
    };
  }
  for (const [name, count] of [['undefined', undefined], ['null', null], ['true', true], ['false', false],
    ['string', '2'], ['array', []], ['object', {}], ['negative', -1], ['fraction', 0.5],
    ['nan', NaN], ['infinity', Infinity], ['unsafe', Number.MAX_SAFE_INTEGER + 1]]) {
    invalidBudgetSeparationStates[`${costScope}-history-${name}`] = value => {
      Object.assign(value.budget, { costScope, historicalUnknownCostCount: count });
    };
  }
  for (const count of costScope === budgetSeparationScopes[0][0] ? [1, 2, 3] : [0, 1, 3]) {
    invalidBudgetSeparationStates[`${costScope}-history-mismatch-${count}`] = value => {
      Object.assign(value.budget, { costScope, historicalUnknownCostCount: count });
    };
  }
}
for (const [name, costScope] of [['undefined', undefined], ['null', null], ['array', []], ['object', {}],
  ['number', 2], ['boolean', false], ['unknown', 'other'],
  ['whitespace', budgetSeparationScopes[0][0] + ' '], ['case', budgetSeparationScopes[1][0].toUpperCase()]]) {
  invalidBudgetSeparationStates[`scope-${name}`] = value => { value.budget.costScope = costScope; };
}
for (const [name, corrupt] of Object.entries(invalidBudgetSeparationStates)) {
  test(`budget separation regression: rejects invalid contract before preview or choices: ${name}`, async () => {
    const value = scopedApprovalState(); corrupt(value);
    const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    assert.throws(() => view.api.parseState(value, { workId: id(1) }), error => error.kind === 'invalid');
    assert.equal(await view.load(), false); assertCleared(view);
    assert.equal(view.snapshot().messageKey, 'invalid'); assert.equal(view.snapshot().canChoose, false);
    for (const choice of preview().progress.choices) assert.equal(await view.choose(choice.id), false);
    assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  });
}

test('budget separation regression: present undefined fields are invalid but JSON omission remains legacy', async () => {
  const value = approvalState();
  value.budget.costScope = undefined; value.budget.historicalUnknownCostCount = undefined;
  const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
  assert.throws(() => view.api.parseState(value, { workId: id(1) }), error => error.kind === 'invalid');
  assert.equal(await view.load(), true);
  assert.deepEqual(clone(view.snapshot().data.approvalState), approvalState());
  assert.equal(view.snapshot().canChoose, true); assert.equal(posts(view).length, 0);
});

for (const [costScope] of budgetSeparationScopes) {
  test(`budget separation regression: current unknown costs still block both choices under ${costScope}`, async () => {
    const value = scopedApprovalState(costScope); value.state = 'cost_unknown';
    Object.assign(value.budget, { unknownCostCount: 1, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false });
    const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    assert.equal(await view.load(), true); assert.deepEqual(clone(view.snapshot().data.approvalState), value);
    assert.equal(view.snapshot().messageKey, 'cost_unknown'); assert.equal(view.snapshot().canChoose, false);
    for (const choice of preview().progress.choices) assert.equal(await view.choose(choice.id), false);
    assert.equal(view.calls.length, 2); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  });
  for (const inconsistent of ['approval_recorded', 'evidence-ready']) {
    test(`budget separation regression: current unknown cannot claim ${inconsistent} under ${costScope}`, async () => {
      const value = scopedApprovalState(costScope); value.state = 'cost_unknown';
      Object.assign(value.budget, { unknownCostCount: 1, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false });
      if (inconsistent === 'approval_recorded') value.state = 'approval_recorded';
      else value.budget.evidenceReadyForBudgetCheck = true;
      const view = screen(({ kind, reply }) => kind === 'state' ? response(value) : reply());
      assert.throws(() => view.api.parseState(value, { workId: id(1) }), error => error.kind === 'invalid');
      assert.equal(await view.load(), false); assertCleared(view);
      assert.equal(view.snapshot().canChoose, false); assert.equal(await view.choose(id(6)), false);
      assert.equal(view.calls.length, 1); assert.equal(posts(view).length, 0);
    });
  }
}

const historicalSeparationCopy = {
  ko: '\uacfc\uac70 \uae08\uc561 \ubbf8\ud655\uc778 2\uac74, \uc774\ubc88 \uc2dc\ud5d8 \ud55c\ub3c4 \ubc16 \ubcc4\ub3c4 \ubcf4\uc874',
  en: "2 historical requests with unconfirmed costs, preserved separately outside this trial's budget limit",
  ja: '\u904e\u53bb\u306e\u91d1\u984d\u672a\u78ba\u8a8d 2 \u4ef6\u3001\u4eca\u56de\u306e\u30c6\u30b9\u30c8\u306e\u4e88\u7b97\u4e0a\u9650\u5916\u3067\u5225\u9014\u4fdd\u6301',
  'zh-Hans': '\u8fc7\u53bb\u91d1\u989d\u672a\u786e\u8ba4 2 \u7b14\uff0c\u5728\u672c\u6b21\u6d4b\u8bd5\u9884\u7b97\u9650\u989d\u5916\u5355\u72ec\u4fdd\u7559',
  'zh-Hant': '\u904e\u53bb\u91d1\u984d\u672a\u78ba\u8a8d 2 \u7b46\uff0c\u5728\u672c\u6b21\u6e2c\u8a66\u9810\u7b97\u9650\u984d\u5916\u55ae\u7368\u4fdd\u7559'
};
for (const language of locales) {
  for (const currentUnknown of [false, true]) {
    test(`budget separation regression: ${language} separates historical 2 from balance with current unknown ${currentUnknown}`, async () => {
      const value = scopedApprovalState();
      if (currentUnknown) {
        value.state = 'cost_unknown';
        Object.assign(value.budget, { unknownCostCount: 1, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false });
      }
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
      view.locale(language); view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change');
      assert.equal(view.calls.length, 0); await view.load(); assert.equal(view.host.lang, language);
      const content = walk(view.host).find(node => node.id === 'writerBodyTrialContent');
      const amounts = walk(view.host).find(node => node.className === 'body-trial-budget');
      const notices = walk(view.host).filter(node => node.id === 'writerBodyTrialHistoricalCosts');
      assert.equal(notices.length, 1); const note = notices[0];
      assert.equal(note.textContent, historicalSeparationCopy[language]); assert.equal(note.getAttribute('role'), 'note');
      assert.ok(content.children.includes(note)); assert.equal(walk(amounts).includes(note), false);
      assert.deepEqual(walk(amounts).filter(node => node.tagName === 'DD').map(node => node.textContent),
        ['10,000 KRW', '4,045.5895 KRW', currentUnknown ? view.api.copy[language].unknown : '5,954.4105 KRW']);
      assert.equal(view.choices().length, 2);
      for (const button of view.choices()) {
        assert.equal(button.disabled, currentUnknown);
        if (currentUnknown) await button.fire('click');
      }
      const state = walk(view.host).find(node => node.id === 'writerBodyTrialState');
      assert.equal(state.textContent, view.api.copy[language][currentUnknown ? 'cost_unknown' : 'approval_recorded']);
      assert.equal(posts(view).length, 0); assert.equal(view.calls.length, 2);
      view.window.fire('lumina:authchange');
      assert.equal(walk(view.host).some(node => node.id === 'writerBodyTrialHistoricalCosts'), false);
    });
  }
  for (const contract of ['legacy', 'all-requests']) {
    test(`budget separation regression: ${language} never invents a historical notice for ${contract}`, async () => {
      const value = contract === 'legacy' ? approvalState() : scopedApprovalState(budgetSeparationScopes[0][0]);
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
      view.locale(language); view.window.fire('lumina:localechange'); await view.load();
      assert.equal(walk(view.host).some(node => node.id === 'writerBodyTrialHistoricalCosts'), false);
      assert.equal(view.choices().length, 2); assert.ok(view.choices().every(button => !button.disabled));
      assert.equal(posts(view).length, 0); assert.equal(view.calls.length, 2);
    });
  }
}

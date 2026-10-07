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
const receiptEnvelope = (url, receipt = originalReceipt()) => {
  const target = new URL(url, 'https://unit.invalid'), parts = target.pathname.split('/');
  return { contract: 'story-author-body-trial-receipt-v1', workId: parts[6], choiceId: parts[9],
    approvalId: target.searchParams.get('approvalId'), progressId: target.searchParams.get('progressId'),
    sourceRevision: Number(target.searchParams.get('expectedRevision')), locale: target.searchParams.get('locale'),
    readOnly: true, generationAuthorized: false, generationStarted: false, imageGenerationStarted: false,
    receipt: { ...receipt, idempotentReplay: true } };
};
const recoveryEnvelope = (command = null, workId = id(1)) => ({ contract: 'story-author-body-trial-recovery-v1', workId,
  readOnly: true, generationAuthorized: false, generationStarted: false, imageGenerationStarted: false, command });

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
      const kind = options.method === 'POST' ? 'choice' : url.endsWith('/body-trial/recovery') ? 'recovery' : url.includes('/receipt?') ? 'receipt'
        : url.includes('/body-trial-state') ? 'state' : 'preview';
      const call = { url, options, kind };
      calls.push(call);
      const reply = () => response(kind === 'state' ? approvalState(target.workId)
        : kind === 'preview' ? preview(target.workId, target.locale) : kind === 'receipt' ? receiptEnvelope(url)
          : kind === 'recovery' ? recoveryEnvelope(null, target.workId) : originalReceipt());
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
  if (Object.hasOwn(settings, 'journal')) options.journal = settings.journal;
  if (settings.defaultKey) delete options.makeIdempotencyKey;
  const controller = api.createController(options);
  return { ...controller, calls, states, api, vm, keys: () => keyCount, set: {
    owner: value => { owner = value; }, work: value => { workId = value; }, source: value => { sourceLocale = value; },
    language: value => { language = value; }, shown: value => { shown = value; },
    authorized: value => { authorized = value; }, brokenIdentity: value => { brokenIdentity = value; }
  } };
}
const posts = view => view.calls.filter(call => call.options.method === 'POST');
const checks = view => view.calls.filter(call => call.kind === 'receipt');
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
  const body = typeof first.options.body === 'string' ? JSON.parse(first.options.body) : first.options.body;
  const query = new URLSearchParams(Object.entries(body)).toString();
  assert.equal(replay.url, first.url + '/receipt?' + query);
  assert.equal(replay.options.method, 'GET'); assert.equal(replay.options.body, undefined);
  assert.equal(replay.options.headers['Content-Type'], undefined);
  assert.equal(replay.options.headers['Idempotency-Key'], first.options.headers['Idempotency-Key']);
  assert.deepEqual(clone(replay.options.identity), { ownerId: id(8), epoch });
  assert.equal(replay.options._retried, false);
  assert.equal(replay.options.cache, 'no-store');
}

test('exports the agreed API and remains idle without storage, polling, or automatic mutations', async () => {
  const view = screen();
  for (const name of ['parseState', 'parseReceipt', 'parseRecovery', 'createController', 'mount']) assert.equal(typeof view.api[name], 'function');
  assert.equal(typeof view.api.copy, 'object');
  for (const name of ['ticket', 'phase', 'messageKey', 'locale', 'data', 'receipt', 'busy', 'canLoad', 'canChoose', 'canRetry', 'canRecover', 'unresolved']) {
    assert.ok(Object.hasOwn(view.snapshot(), name), name);
  }
  for (let i = 0; i < 3; i++) { view.syncContext(); view.snapshot(); view.invalidate(); }
  assert.equal(await view.choose(id(5)), false);
  assert.equal(await view.retry(), false);
  assert.equal(view.calls.length, 0);
  assert.equal(view.keys(), 0);
  assert.equal(unresolved(view), false);
  assert.doesNotMatch(source, /localStorage|indexedDB|setInterval|sendBeacon|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(source.slice(source.indexOf('  function createController('), source.indexOf('  function mount(')), /setTimeout/);
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
    assert.equal(options.method, 'GET'); assert.equal(options._retried, false); assert.equal(options.cache, 'no-store');
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

test('onDispatch runs only at initial POST dispatch, never at receipt GET, with the command already retained', async () => {
  let count = 0, dispatches = 0, view;
  view = screen(({ kind, reply }) => {
    if (kind !== 'choice') return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(originalReceipt({ idempotentReplay: true }));
  }, { onDispatch: () => { dispatches++; assert.equal(unresolved(view), true); assert.equal(view.snapshot().busy, true); } });
  await view.load(); view.syncContext(); assert.equal(dispatches, 0);
  await view.choose(id(99)); assert.equal(dispatches, 0);
  await view.choose(id(5)); assert.equal(dispatches, 1); assertUncertain(view);
  await view.load(); assert.equal(dispatches, 1); await view.retry(); assert.equal(dispatches, 1);
  assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1); assert.equal(posts(view).length, 1);
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
    block = false; pending.resolve(response(operation === 'load' ? approvalState() : operation === 'retry'
      ? receiptEnvelope(checks(view)[0].url) : originalReceipt()));
    assert.equal(await task, true); assert.equal(view.snapshot().busy, false);
    if (operation === 'retry') { assert.equal(checks(view).length, 1); assert.equal(posts(view).length, 1); }
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
    if (kind === 'receipt') return reply();
    if (!newer) return reply();
    if (kind === 'state') { const value = approvalState(); value.approval.id = id(77); value.state = 'approval_expired'; value.approval.expiresAt = past; return response(value); }
    const value = preview(); value.progress.progressId = id(22); value.progress.revision = 9; value.progress.choices = [{ id: id(55), label: 'Different route', routeKind: 'branch' }]; return response(value);
  });
  await view.load(); await view.choose(id(5)); const firstPost = posts(view)[0];
  newer = true; assert.equal(await view.load(), true);
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true); assert.equal(await view.choose(id(55)), false);
  assert.equal(await view.retry(), true); assertReplay(firstPost, checks(view)[0]);
  assert.deepEqual(Object.fromEntries(new URL(checks(view)[0].url, 'https://unit.invalid').searchParams),
    { ...expectedBody, expectedRevision: '1' });
  assert.equal(posts(view).length, 1);
  assert.equal(view.keys(), 1); assert.equal(unresolved(view), false);
  assert.equal(view.snapshot().receipt.idempotentReplay, true); assert.equal(view.calls.length, 6);
});

for (const status of [0, 201, 202, 204, 304, 400, 401, 403, 404, 409, 422, 429, 500, 503]) {
  test(`failed explicit receipt GET HTTP ${status} retains uncertainty, original query, and key`, async () => {
    let attempts = 0, reads = 0;
    const view = screen(({ kind, reply }) => {
      if (!['choice', 'receipt'].includes(kind)) return reply();
      if (++attempts === 1) throw new TypeError('Lost receipt');
      return response(null, status, { text: () => { reads++; throw new Error('Private diagnostics'); } });
    });
    await view.load(); await view.choose(id(5));
    for (let i = 0; i < 2; i++) {
      assert.equal(await view.retry(), false); assertUncertain(view); assert.equal(view.snapshot().canRetry, true);
      assertReplay(posts(view)[0], checks(view).at(-1));
    }
    assert.equal(posts(view).length, 1); assert.equal(checks(view).length, 2); assert.equal(view.keys(), 1); assert.equal(reads, 0);
    assert.equal(await view.choose(id(6)), false);
  });
}

for (const name of ['transport', 'body-transport', 'invalid-json', 'wrong-progress']) {
  test(`failed explicit replay ${name} also retains the original command`, async () => {
    let attempts = 0;
    const view = screen(({ kind, url, reply }) => {
      if (!['choice', 'receipt'].includes(kind)) return reply();
      if (++attempts === 1) throw new TypeError('Lost receipt');
      return name === 'wrong-progress' ? response(receiptEnvelope(url, originalReceipt({ progressId: id(99) }))) : uncertainResults[name]();
    });
    await view.load(); await view.choose(id(5)); await view.retry();
    assertUncertain(view); assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1);
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
  await view.retry(); assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1);
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
    const view = screen(({ kind, reply }) => { if (kind === 'choice') throw new TypeError('Lost receipt');
      return kind === 'receipt' ? response(null, 404) : reply(); });
    await view.load(); await view.choose(id(5)); change(view); view.syncContext();
    assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canChoose, false);
    const allowed = ['language', 'epoch'].includes(name);
    assert.equal(view.snapshot().canRetry, allowed);
    assert.equal(await view.retry(), false);
    assert.equal(posts(view).length, 1); assert.equal(checks(view).length, allowed ? 1 : 0); assert.equal(view.keys(), 1);
    if (allowed) assertReplay(posts(view)[0], checks(view)[0], name === 'epoch' ? 2 : 1);
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
  assert.equal(view.snapshot().canRetry, true); await view.retry(); assertReplay(posts(view)[0], checks(view)[0], 4);
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
    if (!['choice', 'receipt'].includes(kind)) return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return pending.promise;
  });
  await view.load(); await view.choose(id(5)); const task = view.retry();
  view.set.work(id(9)); view.syncContext(); pending.resolve(response(receiptEnvelope(checks(view)[0].url))); await task;
  assertCleared(view); assert.equal(unresolved(view), true); assert.equal(view.snapshot().canRetry, false);
  assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1);
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

test('AI receipt GET resolves uncertainty with the same key and no follow-up request', async () => {
  let count = 0;
  const view = screen(({ kind, url, reply }) => {
    if (!['choice', 'receipt'].includes(kind)) return reply();
    if (++count === 1) throw new TypeError('Lost receipt');
    return response(receiptEnvelope(url, aiReceipt('processing')));
  });
  await view.load(); await view.choose(id(6)); assert.equal(await view.retry(), true);
  assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.snapshot().receipt.status, 'processing');
  assert.equal(unresolved(view), false); assert.equal(view.keys(), 1); assert.equal(view.calls.length, 4);
});

const invalidReceiptEnvelopes = {
  'raw-old-receipt': () => originalReceipt({ idempotentReplay: true }),
  null: () => null, array: () => [], empty: () => ({}),
  contract: value => ({ ...value, contract: 'story-author-body-trial-choice-v1' }),
  'absent-receipt': value => ({ ...value, receipt: null }),
  'array-receipt': value => ({ ...value, receipt: [] }),
  'not-replayed': value => ({ ...value, receipt: { ...value.receipt, idempotentReplay: false } }),
  'string-replay': value => ({ ...value, receipt: { ...value.receipt, idempotentReplay: 'true' } }),
  'nested-progress': value => ({ ...value, receipt: { ...value.receipt, progressId: id(99) } }),
  'nested-revision': value => ({ ...value, receipt: { ...value.receipt, revisionAfterRequest: 9 } }),
  'nested-generation': value => ({ ...value, receipt: { ...value.receipt, generationStarted: true } }),
  'nested-images': value => ({ ...value, receipt: { ...value.receipt, imageGenerationStarted: true } }),
  'nested-status': value => ({ ...value, receipt: { ...value.receipt, status: 'processing' } })
};
for (const key of ['workId', 'choiceId', 'approvalId', 'progressId']) {
  for (const [name, replacement] of [['other', id(99)], ['invalid', '../unsafe'], ['null', null], ['object', {}]]) {
    invalidReceiptEnvelopes[`${key}-${name}`] = value => ({ ...value, [key]: replacement });
  }
}
for (const [name, replacement] of [['other', 2], ['zero', 0], ['negative', -1], ['fraction', 1.5],
  ['string', '1'], ['boolean', true], ['unsafe', Number.MAX_SAFE_INTEGER + 1], ['null', null]]) {
  invalidReceiptEnvelopes[`revision-${name}`] = value => ({ ...value, sourceRevision: replacement });
}
for (const replacement of ['en', 'KO', 'ko ', null, {}]) {
  invalidReceiptEnvelopes[`locale-${JSON.stringify(replacement)}`] = value => ({ ...value, locale: replacement });
}
for (const key of ['readOnly', 'generationAuthorized', 'generationStarted', 'imageGenerationStarted']) {
  for (const replacement of [key !== 'readOnly', String(key === 'readOnly'), null, 0]) {
    invalidReceiptEnvelopes[`${key}-${JSON.stringify(replacement)}`] = value => ({ ...value, [key]: replacement });
  }
}
for (const key of ['contract', 'workId', 'choiceId', 'approvalId', 'progressId', 'sourceRevision', 'locale',
  'readOnly', 'generationAuthorized', 'generationStarted', 'imageGenerationStarted', 'receipt']) {
  invalidReceiptEnvelopes[`missing-${key}`] = value => { delete value[key]; return value; };
}
for (const [name, corrupt] of Object.entries(invalidReceiptEnvelopes)) {
  test(`receipt GET rejects ${name}, retains the original command, and only resolves on a verified manual check`, async () => {
    let failing = true, dispatches = 0;
    const view = screen(({ kind, url, reply }) => {
      if (kind === 'choice') throw new TypeError('Lost receipt');
      return kind === 'receipt' && failing ? response(corrupt(receiptEnvelope(url))) : reply();
    }, { onDispatch: () => { dispatches++; } });
    await view.load(); await view.choose(id(5));
    assert.equal(await view.retry(), false); assertUncertain(view); assertCleared(view);
    assert.equal(view.snapshot().canRetry, true); assertReplay(posts(view)[0], checks(view)[0]);
    view.snapshot(); view.syncContext(); assert.equal(view.calls.length, 4);
    failing = false; assert.equal(await view.retry(), true); assertReplay(posts(view)[0], checks(view)[1]);
    assert.equal(unresolved(view), false); assert.equal(posts(view).length, 1);
    assert.equal(view.keys(), 1); assert.equal(dispatches, 1);
  });
}

for (const key of ['workId', 'choiceId', 'approvalId', 'progressId']) {
  test(`receipt envelope ${key} must exactly match original UUID casing`, async () => {
    const workId = 'a0000001-abcd-4abc-8abc-abcdef000001', choiceId = 'a0000005-abcd-4abc-8abc-abcdef000005';
    const approvalId = 'a0000007-abcd-4abc-8abc-abcdef000007', progressId = 'a0000002-abcd-4abc-8abc-abcdef000002';
    let changed = true;
    const view = screen(({ kind, url, reply }) => {
      if (kind === 'choice') throw new TypeError('Lost receipt');
      if (kind === 'state') { const value = approvalState(workId); value.approval.id = approvalId; return response(value); }
      if (kind === 'preview') { const value = preview(workId); value.progress.progressId = progressId;
        value.progress.choices[0].id = choiceId; return response(value); }
      if (kind !== 'receipt') return reply();
      const value = receiptEnvelope(url, originalReceipt({ progressId }));
      if (changed) value[key] = value[key].toUpperCase(); return response(value);
    });
    view.set.work(workId); await view.load(); await view.choose(choiceId);
    assert.equal(await view.retry(), false); assertUncertain(view);
    changed = false; assert.equal(await view.retry(), true);
    for (const check of checks(view)) assertReplay(posts(view)[0], check);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  });
}

for (const kind of ['absent-response', 'invalid-status', 'missing-reader', 'declared-size', 'actual-size', 'stream-size']) {
  test(`receipt GET ${kind} retains command without consuming diagnostics or auto-retrying`, async () => {
    let reads = 0, cancelled = 0;
    const view = screen(({ kind: stage, url, reply }) => {
      if (stage === 'choice') throw new TypeError('Lost receipt');
      if (stage !== 'receipt') return reply();
      if (kind === 'absent-response') return undefined;
      if (kind === 'invalid-status') return { status: '200' };
      if (kind === 'missing-reader') return { status: 200 };
      if (kind === 'declared-size') return response(null, 200, { headers: { get: () => '16385' },
        text: () => { reads++; throw new Error('Private diagnostics'); }, body: { cancel: () => { cancelled++; } } });
      if (kind === 'actual-size') return response({ ...receiptEnvelope(url), padding: 'x'.repeat(16385) });
      return response(null, 200, { body: { getReader: () => ({
        read: async () => { reads++; return { done: false, value: new Uint8Array(16385) }; },
        cancel: () => { cancelled++; }
      }) } });
    });
    await view.load(); await view.choose(id(5)); assert.equal(await view.retry(), false);
    assertCleared(view); assertUncertain(view); assert.equal(view.snapshot().canRetry, true);
    assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.calls.length, 4);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
    assert.equal(reads, kind === 'stream-size' ? 1 : 0);
    assert.equal(cancelled, ['declared-size', 'stream-size'].includes(kind) ? 1 : 0);
  });
}

for (const status of ['queued', 'processing', 'completed', 'failed', 'timeout', 'active', 'original-completed']) {
  test(`verified receipt GET displays latest ${status} without polling or a replacement POST`, async () => {
    const canonical = status === 'active' || status === 'original-completed'
      ? originalReceipt({ status: status === 'active' ? 'active' : 'completed' }) : aiReceipt(status);
    const view = screen(({ kind, url, reply }) => {
      if (kind === 'choice') throw new TypeError('Lost receipt');
      if (kind !== 'receipt') return reply();
      const value = receiptEnvelope(url, { ...canonical, privateDetail: 'Private diagnostics' });
      value.privateDetail = 'Private diagnostics'; return response(value);
    });
    await view.load(); await view.choose(status.startsWith('original') || status === 'active' ? id(5) : id(6));
    assert.equal(await view.retry(), true);
    const expected = view.api.parseReceipt({ ...canonical, idempotentReplay: true }, expectedBody);
    assert.deepEqual(clone(view.snapshot().receipt), clone(expected));
    assert.equal(view.snapshot().messageKey, status === 'failed' ? 'generationFailed' : status === 'timeout' ? 'generationTimeout'
      : ['queued', 'processing'].includes(status) ? 'generating' : status === 'original-completed' ? 'ending' : 'accepted');
    assert.equal(unresolved(view), false); assert.equal(view.snapshot().canChoose, false);
    assert.equal(await view.retry(), false); assert.equal(await view.choose(id(6)), false);
    assert.equal(view.calls.length, 4); assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
    assert.doesNotMatch(JSON.stringify(view.snapshot()), /Private diagnostics/);
  });
}

for (const state of ['approval_required', 'approval_expired', 'release_changed', 'cost_unknown', 'budget_over_limit']) {
  test(`receipt GET uses the original scope even after current approval becomes ${state}`, async () => {
    let changed = false;
    const view = screen(({ kind, reply }) => {
      if (kind === 'choice') throw new TypeError('Lost receipt');
      if (kind !== 'state' || !changed) return reply();
      const value = approvalState(); value.state = state;
      if (state === 'approval_required') { value.approval = null; value.budget = null; }
      else value.approval.id = id(77);
      if (state === 'approval_expired') value.approval.expiresAt = past;
      if (state === 'cost_unknown') Object.assign(value.budget,
        { unknownCostCount: 1, evidenceReadyForBudgetCheck: false, remainingBudgetKrw: null });
      if (state === 'budget_over_limit') Object.assign(value.budget,
        { approvedBudgetKrw: '1.000000', remainingBudgetKrw: '0.000000' });
      return response(value);
    });
    await view.load(); await view.choose(id(5)); changed = true; assert.equal(await view.load(), true);
    assertUncertain(view); assert.equal(await view.choose(id(6)), false); assert.equal(await view.retry(), true);
    assertReplay(posts(view)[0], checks(view)[0]); assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  });
}

for (const [name, change] of Object.entries(scopeChanges)) {
  test(`late receipt GET after ${name} retains command and cannot display another scope, even without an event`, async () => {
    const pending = deferred();
    const view = screen(({ kind, reply }) => {
      if (kind === 'choice') throw new TypeError('Lost receipt');
      return kind === 'receipt' ? pending.promise : reply();
    });
    await view.load(); await view.choose(id(5)); const task = view.retry();
    change(view); pending.resolve(response(receiptEnvelope(checks(view)[0].url)));
    assert.equal(await task, false); assertCleared(view); assertUncertain(view);
    assert.equal(checks(view)[0].options.signal.aborted, true);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
  });
}

test('older receipt GET cannot overwrite a newer verified GET after invalidation and double clicks stay read-only', async () => {
  const pending = deferred(); let count = 0;
  const view = screen(({ kind, url, reply }) => {
    if (kind === 'choice') throw new TypeError('Lost receipt');
    if (kind !== 'receipt') return reply();
    return ++count === 1 ? pending.promise : response(receiptEnvelope(url, aiReceipt('completed')));
  });
  await view.load(); await view.choose(id(6)); const oldTicket = view.snapshot().ticket, task = view.retry();
  assert.equal(await view.retry(), false); assert.equal(checks(view).length, 1);
  view.invalidate(); assertUncertain(view); assert.equal(await view.retry(oldTicket), false);
  assert.equal(await view.load(), true); assertUncertain(view); assert.equal(await view.retry(), true);
  const latest = clone(view.snapshot());
  pending.resolve(response(receiptEnvelope(checks(view)[0].url, aiReceipt('queued'))));
  assert.equal(await task, false); assert.deepEqual(clone(view.snapshot()), latest);
  assert.equal(view.snapshot().receipt.status, 'completed'); assert.equal(view.calls.length, 7);
  for (const check of checks(view)) assertReplay(posts(view)[0], check);
  assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
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
    assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1);
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
  assertReplay(posts(view)[0], checks(view)[0]);
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
function memoryStorage() {
  const values = new Map(), operations = [], faults = {};
  return { values, operations, faults,
    getItem(key) { operations.push(['read', key]); if (faults.read) throw new Error('Private storage read'); return values.get(key) ?? null; },
    setItem(key, value) { operations.push(['write', key]); if (faults.write) throw new Error('Private storage write'); values.set(key, value); },
    removeItem(key) { operations.push(['remove', key]); if (faults.remove) throw new Error('Private storage remove'); values.delete(key); }
  };
}
function mounted(handler = ({ reply }) => reply(), settings = {}) {
  const window = new Element(), document = new Element(), shell = new Element('main', 'studioShell');
  const section = new Element('section', 'writer-manuscript'), host = new Element('section', 'writerBodyTrial');
  const readonly = new Element('section', 'writerBodyPreview');
  const work = new Element('select', 'writerManuscriptWork'), sourceLocale = new Element('select', 'writerManuscriptLocale');
  section.classList.add('is-active'); work.value = settings.workId ?? id(1); sourceLocale.value = settings.sourceLocale ?? 'ko';
  document.documentElement = new Element('html'); document.documentElement.lang = 'ko'; document.visibilityState = 'visible';
  document.getElementById = name => [shell, section, host, readonly, work, sourceLocale].find(node => node.id === name) || null;
  document.createElement = tag => new Element(tag);
  let owner = Object.hasOwn(settings, 'owner') ? settings.owner : { ownerId: id(8), epoch: 1 };
  let language = settings.language ?? 'ko', accessToken = 'existing-access-token', refreshAttempts = 0;
  const calls = [], observers = [], events = [];
  window.crypto = { randomUUID: () => id(90) };
  window.lucide = settings.lucide;
  const storage = Object.hasOwn(settings, 'storage') ? settings.storage : memoryStorage();
  Object.defineProperty(window, 'sessionStorage', { get: () => {
    if (settings.storageGetterFailure) throw new Error('Private storage getter');
    return storage;
  } });
  window.getAuth = () => ({ accessToken, refreshToken: 'must-not-use' });
  window.luminaI18n = { getLocale: () => language };
  window.dispatchEvent = event => { events.push(event.type); window.fire(event.type); return true; };
  window.LuminaCreatorStudioApi = {
    identity: () => owner,
    isCurrent: value => owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    fetch: async (url, options) => {
      // Count an actual refresh request, not the flags that permit read refresh.
      if (url.includes('/auth/refresh')) { refreshAttempts++; throw new Error('Unexpected direct refresh request'); }
      const kind = options.method === 'POST' ? 'choice' : url.endsWith('/body-trial/recovery') ? 'recovery' : url.includes('/receipt?') ? 'receipt'
        : url.includes('/body-trial-state') ? 'state' : 'preview';
      const target = { workId: work.value, locale: sourceLocale.value }, call = { url, options, kind };
      calls.push(call);
      const reply = () => response(kind === 'state' ? approvalState(target.workId)
        : kind === 'preview' ? preview(target.workId, target.locale) : kind === 'receipt' ? receiptEnvelope(url)
          : kind === 'recovery' ? recoveryEnvelope(null, target.workId) : originalReceipt());
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
  return { window, document, shell, section, host, readonly, work, sourceLocale, api, calls, observers, events, storage,
    refresh: () => button('writerBodyTrialRefresh'), retryButton: () => button('writerBodyTrialRetry'),
    recoverButton: () => button('writerBodyTrialRecover'), recover: () => button('writerBodyTrialRecover').fire('click'),
    choices: () => walk(host).filter(node => node.className === 'body-trial-choice'),
    load: () => button('writerBodyTrialRefresh').fire('click'), retry: () => button('writerBodyTrialRetry').fire('click'),
    loadReadonly: () => walk(readonly).find(node => node.tagName === 'BUTTON').fire('click'),
    setOwner: value => { owner = value; }, setToken: value => { accessToken = value; },
    locale: value => { language = value; }, refreshAttempts: () => refreshAttempts,
    mutate: target => { for (const observer of observers.filter(item => item.target === target)) observer.callback([{ type: 'attributes' }]); }
  };
}

const journalSlot = owner => 'lumina:author-body-trial:pending:v1:' + encodeURIComponent(owner);
const pendingRecord = (extra = {}) => ({ version: 1, ownerId: id(8), workId: id(1), choiceId: id(6),
  key: 'trial-test-0001', body: { ...expectedBody }, ...extra });
const recoveryCommand = (extra = {}) => ({ workId: id(1), choiceId: id(6), key: 'server-choice-original-key-0001',
  body: { ...expectedBody }, ...extra });
function structuredJournal() {
  const entries = new Map(), operations = [];
  return { entries, operations,
    read(owner) { operations.push('read'); return entries.has(owner) ? clone(entries.get(owner)) : null; },
    write(value) { operations.push('write'); if (entries.has(value.ownerId)) throw new Error('Do not overwrite');
      entries.set(value.ownerId, clone(value)); return true; },
    remove(value) { operations.push('remove'); assert.deepEqual(entries.get(value.ownerId), clone(value));
      entries.delete(value.ownerId); return true; }
  };
}
const lostChoice = ({ kind, reply }) => { if (kind === 'choice') throw new Error('Private lost response'); return reply(); };

for (const status of ['queued', 'processing', 'failed', 'timeout', 'completed']) {
  for (const stage of ['POST', 'GET']) {
    test(`receipt invariant: ${stage} ${status} with a contradictory result preserves the exact journal until verified`, async () => {
      const journal = structuredJournal(); let valid = false, dispatches = 0;
      const invalid = aiReceipt(status, { resultGeneratedSceneId: status === 'completed' ? null : id(11) });
      const view = screen(({ kind, url, reply }) => {
        if (kind === 'choice') {
          if (stage === 'GET') throw new Error('Lost initial receipt');
          return response(invalid, 201);
        }
        if (kind === 'receipt') return response(receiptEnvelope(url, valid ? aiReceipt(status) : invalid));
        return reply();
      }, { journal, onDispatch: () => { dispatches++; } });
      assert.throws(() => view.api.parseReceipt(invalid, expectedBody));
      await view.load(); assert.equal(await view.choose(id(6)), false);
      if (stage === 'GET') assert.equal(await view.retry(), false);
      assertUncertain(view); assert.equal(view.snapshot().phase, 'uncertain');
      assert.equal(view.snapshot().canRetry, true); assert.equal(view.keys(), 1);
      assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
      assert.equal(journal.operations.includes('remove'), false);
      const before = view.calls.length;
      view.syncContext(); view.snapshot(); await Promise.resolve();
      assert.equal(view.calls.length, before); assert.equal(dispatches, 1);
      valid = true; assert.equal(await view.retry(), true);
      assertReplay(posts(view)[0], checks(view).at(-1));
      assert.equal(view.snapshot().receipt.status, status); assert.equal(journal.entries.size, 0);
      assert.equal(journal.operations.filter(value => value === 'remove').length, 1);
      assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1); assert.equal(dispatches, 1);
    });
  }
}

test('journal: injected synchronous persistence precedes POST and reload restores only the exact manual GET', async () => {
  const journal = structuredJournal(); let dispatches = 0;
  const first = screen(({ kind, reply }) => {
    if (kind === 'choice') assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
    return lostChoice({ kind, reply });
  }, { journal, onDispatch: () => { dispatches++; assert.deepEqual(journal.entries.get(id(8)), pendingRecord()); } });
  first.set.owner({ ownerId: id(8), epoch: 1, token: 'must-not-persist', privateText: 'must-not-persist' });
  await first.load(); await first.choose(id(6)); assertUncertain(first);
  const next = screen(undefined, { journal, onDispatch: () => { dispatches++; } });
  next.set.owner({ ownerId: id(8), epoch: 19 }); next.invalidate(); next.syncContext(); next.snapshot();
  assertUncertain(next); assert.equal(next.snapshot().phase, 'uncertain'); assert.equal(next.snapshot().canRetry, true);
  assert.equal(next.calls.length, 0); assert.equal(next.keys(), 0); assert.equal(dispatches, 1);
  assert.equal(await next.choose(id(6)), false); assert.equal(await next.retry(), true);
  assertReplay(posts(first)[0], checks(next)[0], 19);
  assert.equal(next.calls.length, 1); assert.equal(posts(next).length, 0); assert.equal(next.keys(), 0);
  assert.equal(dispatches, 1); assert.equal(journal.operations.filter(value => value === 'write').length, 1);
  assert.equal(journal.operations.filter(value => value === 'remove').length, 1); assert.equal(journal.entries.size, 0);
  assert.doesNotMatch(JSON.stringify(first.states), /must-not-persist|Private lost response/);
});

test('journal: sessionStorage reload stays idle and verified receipt invalidates siblings without POST', async () => {
  const storage = memoryStorage(), first = mounted(lostChoice, { storage });
  await first.load(); await first.choices()[1].fire('click');
  const saved = storage.values.get(journalSlot(id(8)));
  assert.deepEqual(JSON.parse(saved), pendingRecord({ key: id(90) }));
  assert.equal(storage.values.size, 1);
  assert.doesNotMatch(saved, /token|epoch|Private|receipt|cost|prose|payload|existing-access-token/);
  const next = mounted(undefined, { storage, owner: { ownerId: id(8), epoch: 5 } });
  for (const name of ['pageshow', 'focus', 'lumina:localechange']) next.window.fire(name);
  assert.equal(next.calls.length, 0); assert.equal(next.events.length, 0);
  assert.equal(next.choices().length, 0); assert.equal(next.retryButton().hidden, false); assert.equal(next.retryButton().disabled, false);
  assert.equal(await next.retry(), true);
  assertReplay(posts(first)[0], checks(next)[0], 5);
  assert.equal(posts(next).length, 0); assert.equal(next.calls.length, 1); assert.equal(next.events.length, 1);
  assert.equal(storage.values.size, 0); assert.equal(next.retryButton().hidden, true);
});

test('journal: double clicks during initial POST and restored GET keep one command and one dispatch', async () => {
  const journal = structuredJournal(), post = deferred(), get = deferred(); let dispatches = 0;
  const first = screen(({ kind, reply }) => kind === 'choice' ? post.promise : reply(), { journal, onDispatch: () => { dispatches++; } });
  await first.load(); const submitting = first.choose(id(6));
  assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
  assert.equal(await first.choose(id(5)), false); assert.equal(await first.retry(), false); assert.equal(await first.load(), false);
  assert.equal(first.snapshot().busy, true); assert.equal(posts(first).length, 1); assert.equal(first.keys(), 1);
  first.invalidate();
  const next = screen(({ kind, reply }) => kind === 'receipt' ? get.promise : reply(), { journal, onDispatch: () => { dispatches++; } });
  const checking = next.retry();
  assert.equal(await next.retry(), false); assert.equal(await next.choose(id(6)), false); assert.equal(await next.load(), false);
  assert.equal(next.snapshot().busy, true); assert.equal(checks(next).length, 1);
  get.resolve(response(receiptEnvelope(checks(next)[0].url, aiReceipt('completed')))); assert.equal(await checking, true);
  const accepted = clone(next.snapshot());
  post.resolve(response(aiReceipt('queued'), 201)); assert.equal(await submitting, false);
  assert.deepEqual(clone(next.snapshot()), accepted); assert.equal(journal.entries.size, 0);
  assert.equal(journal.operations.filter(value => value === 'write').length, 1);
  assert.equal(journal.operations.filter(value => value === 'remove').length, 1); assert.equal(dispatches, 1);
});

test('journal: owner slots never overwrite, restore, or retire another authenticated owner command', async () => {
  const storage = memoryStorage(), first = mounted(lostChoice, { storage });
  await first.load(); await first.choices()[1].fire('click'); const savedA = storage.values.get(journalSlot(id(8)));
  const other = mounted(lostChoice, { storage, owner: { ownerId: 'opaque-owner/B', epoch: 1 } });
  assert.equal(other.retryButton().hidden, true); assert.equal(other.calls.length, 0);
  await other.load(); await other.choices()[1].fire('click');
  const savedB = storage.values.get(journalSlot('opaque-owner/B'));
  assert.equal(JSON.parse(savedB).ownerId, 'opaque-owner/B'); assert.equal(storage.values.size, 2);
  assert.equal(storage.values.get(journalSlot(id(8))), savedA);
  const restoredB = mounted(undefined, { storage, owner: { ownerId: 'opaque-owner/B', epoch: 2 } });
  assert.equal(await restoredB.retry(), true); assert.equal(storage.values.has(journalSlot('opaque-owner/B')), false);
  assert.equal(storage.values.get(journalSlot(id(8))), savedA); assert.equal(restoredB.events.length, 1);
  assert.equal(checks(restoredB)[0].options.identity.ownerId, 'opaque-owner/B');
  const unauthenticated = mounted(undefined, { storage, owner: null });
  const reads = storage.operations.length;
  unauthenticated.window.fire('pageshow'); assert.equal(unauthenticated.calls.length, 0);
  assert.equal(unauthenticated.retryButton().hidden, true); assert.equal(storage.operations.length, reads);
  unauthenticated.setOwner({ ownerId: id(8), epoch: 10 }); unauthenticated.window.fire('lumina:authchange');
  assert.equal(unauthenticated.retryButton().disabled, false); assert.equal(unauthenticated.calls.length, 0);
  assert.equal(storage.values.get(journalSlot(id(8))), savedA);
});

for (const scope of ['work', 'source', 'both']) test(`journal: restored ${scope} mismatch blocks paid choices until original work and locale return`, async () => {
  const storage = memoryStorage(), first = mounted(lostChoice, { storage, sourceLocale: 'ja' });
  await first.load(); await first.choices()[1].fire('click'); const saved = storage.values.get(journalSlot(id(8)));
  const next = mounted(undefined, { storage, workId: scope === 'source' ? id(1) : id(9),
    sourceLocale: scope === 'work' ? 'ja' : 'en', language: 'zh-Hant' });
  assert.equal(next.retryButton().disabled, true); assert.equal(next.calls.length, 0);
  await next.retry(); assert.equal(next.calls.length, 0); await next.load();
  for (const button of next.choices()) { assert.equal(button.disabled, true); await button.fire('click'); }
  assert.equal(posts(next).length, 0); assert.equal(storage.values.get(journalSlot(id(8))), saved);
  next.work.value = id(1); next.work.fire('change'); next.sourceLocale.value = 'ja'; next.sourceLocale.fire('change');
  assert.equal(next.retryButton().disabled, false); assert.equal(await next.retry(), true);
  assertReplay(posts(first)[0], checks(next)[0]); assert.equal(next.events.length, 1); assert.equal(next.calls.length, 3);
});

for (const stage of ['choice', 'receipt']) for (const [name, change] of Object.entries(scopeChanges)) {
  test(`journal: late ${stage} after ${name} cannot remove or change the exact persisted command`, async () => {
    const journal = structuredJournal(), pending = deferred(); let dispatches = 0;
    const view = screen(({ kind, reply }) => {
      if (kind === stage) return pending.promise;
      return lostChoice({ kind, reply });
    }, { journal, onDispatch: () => { dispatches++; } });
    await view.load(); const initial = view.choose(id(6));
    const task = stage === 'receipt' ? (await initial, view.retry()) : initial;
    change(view); view.syncContext();
    pending.resolve(response(stage === 'choice' ? aiReceipt('completed') : receiptEnvelope(checks(view)[0].url, aiReceipt('completed'))));
    assert.equal(await task, false); assertCleared(view); assert.equal(view.snapshot().canChoose, false);
    assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
    assert.equal(journal.operations.filter(value => value === 'remove').length, 0); assert.equal(dispatches, 1);
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
    view.set.owner({ ownerId: id(8), epoch: 8 }); view.set.work(id(1)); view.set.source('ko'); view.set.shown(true);
    view.set.authorized(true); view.set.brokenIdentity(false); view.invalidate();
    assert.equal(view.snapshot().canRetry, true); assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
    assert.equal(view.calls.length, stage === 'choice' ? 3 : 4);
  });
}

for (const name of ['read', 'write', 'write-false', 'write-noop', 'write-readback', 'write-after-save', 'write-false-after-save', 'async-write']) {
  test(`journal: ${name} before dispatch is unavailable without an unresolved submission or receipt retry`, async () => {
    const journal = structuredJournal(); let dispatches = 0, failRead = name === 'read';
    const read = journal.read, write = journal.write;
    journal.read = owner => { if (failRead) throw new Error('Private storage failure'); return read(owner); };
    if (name.startsWith('write') || name === 'async-write') journal.write = value => {
      if (name === 'write') throw Object.assign(new Error('Private storage failure'), { status: 422 });
      if (name === 'write-false') return false;
      if (name === 'write-noop') return true;
      if (name === 'async-write') return Promise.resolve(true);
      if (name === 'write-after-save') { write(value); throw Object.assign(new Error('Private storage failure'), { status: 409 }); }
      if (name === 'write-false-after-save') { write(value); return false; }
      write(value); failRead = true; return true;
    };
    const view = screen(undefined, { journal, onDispatch: () => { dispatches++; } }); await view.load();
    assert.equal(await view.choose(id(6)), false); assert.equal(posts(view).length, 0); assert.equal(dispatches, 0);
    if (name !== 'read') assertCleared(view);
    else assert.deepEqual(clone(view.snapshot().data), { approvalState: approvalState(), preview: preview() });
    assert.equal(view.snapshot().receipt, null); assert.equal(unresolved(view), false); assert.equal(view.snapshot().canRetry, false);
    assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'unavailable');
    assert.equal(await view.retry(), false); assert.equal(checks(view).length, 0);
    const keys = view.keys(); failRead = false; view.invalidate(); await view.load();
    assert.equal(await view.choose(id(5)), false); assert.equal(view.keys(), keys); assert.equal(posts(view).length, 0);
    assert.equal(unresolved(view), false); assert.equal(view.snapshot().canRetry, false);
    assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'unavailable');
    assert.equal(await view.retry(), false); assert.equal(checks(view).length, 0); assert.equal(dispatches, 0);
    assert.equal(view.snapshot().canChoose, false); assert.doesNotMatch(JSON.stringify(view.snapshot()), /Private storage/);
    assert.equal(journal.operations.filter(value => value === 'remove').length, 0);
    const stored = ['write-readback', 'write-after-save', 'write-false-after-save'].includes(name);
    assert.equal(journal.entries.has(id(8)), stored);
    if (stored) assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
    const next = screen(undefined, { journal });
    assert.equal(next.calls.length, 0); assert.equal(next.keys(), 0);
    assert.equal(unresolved(next), stored); assert.equal(next.snapshot().canRetry, stored);
    if (stored) {
      assert.equal(await next.retry(), true); assert.equal(posts(next).length, 0); assert.equal(checks(next).length, 1);
      assert.equal(checks(next)[0].options.headers['Idempotency-Key'], pendingRecord().key);
    } else {
      assert.equal(await next.retry(), false); assert.equal(next.calls.length, 0);
      await next.load(); assert.equal(next.snapshot().canChoose, true); assert.equal(next.keys(), 0);
    }
  });
}

test('journal: a read failure or competing command discovered at click blocks even previously enabled choices', async () => {
  for (const kind of ['throw', 'competing']) {
    const journal = structuredJournal(), view = screen(undefined, { journal }); await view.load();
    assert.equal(view.snapshot().canChoose, true);
    if (kind === 'throw') journal.read = () => { throw new Error('Private read'); };
    else journal.entries.set(id(8), pendingRecord({ key: 'another-command-0001' }));
    assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
    assert.equal(view.snapshot().canChoose, false);
    if (kind === 'competing') { assert.equal(view.snapshot().canRetry, true); assert.equal(await view.retry(), true);
      assert.equal(checks(view)[0].options.headers['Idempotency-Key'], 'another-command-0001'); }
  }
});

for (const outcome of ['verified', 'rejected']) for (const fault of ['throw', 'false', 'noop', 'readback']) {
  test(`journal: ${outcome} retirement ${fault} failure retains the command and permits only receipt GET recovery`, async () => {
    const journal = structuredJournal(), remove = journal.remove, read = journal.read;
    let broken = true, failRead = false, dispatches = 0;
    journal.remove = value => {
      if (!broken) return remove(value);
      if (fault === 'throw') throw new Error('Private remove');
      if (fault === 'false') return false;
      if (fault === 'readback') { failRead = true; return true; }
      return true;
    };
    journal.read = owner => { if (failRead) throw new Error('Private readback'); return read(owner); };
    const view = screen(({ kind, reply }) => kind === 'choice' && outcome === 'rejected' ? response(null, 409) : reply(),
      { journal, onDispatch: () => { dispatches++; } });
    await view.load(); assert.equal(await view.choose(id(6)), false); assertUncertain(view);
    failRead = false; assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
    await view.load(); assert.equal(await view.choose(id(5)), false); assert.equal(view.keys(), 1);
    broken = false; assert.equal(await view.retry(), true); assertReplay(posts(view)[0], checks(view)[0]);
    assert.equal(journal.entries.size, 0); assert.equal(dispatches, 1); assert.equal(posts(view).length, 1);
    await view.load(); assert.equal(view.snapshot().canChoose, true);
  });
}

for (const fault of ['getter', 'missing', 'read', 'write', 'remove', 'write-noop', 'remove-noop']) {
  test(`journal: mounted sessionStorage ${fault} failure is fail-closed and never starts a replacement POST`, async () => {
    const storage = memoryStorage();
    if (['read', 'write', 'remove'].includes(fault)) storage.faults[fault] = true;
    if (fault === 'write-noop') storage.setItem = () => {};
    if (fault === 'remove-noop') storage.removeItem = () => {};
    const view = mounted(undefined, { storage: fault === 'missing' ? undefined : storage, storageGetterFailure: fault === 'getter' });
    await view.load();
    for (const button of view.choices()) { if (!button.disabled) { await button.fire('click'); break; } }
    const dispatched = ['remove', 'remove-noop'].includes(fault);
    assert.equal(posts(view).length, dispatched ? 1 : 0); assert.equal(view.events.length, dispatched ? 1 : 0);
    assert.doesNotMatch(view.host.textContent, /Private storage/);
    if (!dispatched) {
      assert.equal(view.retryButton().hidden, true); assert.equal(view.retryButton().disabled, true);
      assert.equal(storage.values.size, 0);
      assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.unavailable);
      await view.retry(); assert.equal(checks(view).length, 0);
    }
    await view.load(); assert.ok(view.choices().every(button => button.disabled));
    assert.equal(posts(view).length, dispatched ? 1 : 0);
    if (dispatched) {
      assert.equal(storage.values.size, 1); storage.faults.remove = false;
      storage.removeItem = key => storage.values.delete(key);
      assert.equal(await view.retry(), true); assert.equal(view.events.length, 2); assert.equal(storage.values.size, 0);
    }
  });
}

for (const saved of [false, true]) test(`journal: sessionStorage setItem throwing with saved entry ${saved} never implies a submitted draft`, async () => {
  const storage = memoryStorage(), setItem = storage.setItem;
  storage.setItem = (key, value) => { if (saved) setItem(key, value); throw new Error('Private quota failure'); };
  const view = mounted(undefined, { storage }); await view.load(); await view.choices()[1].fire('click');
  assert.equal(posts(view).length, 0); assert.equal(view.events.length, 0);
  assert.equal(view.retryButton().hidden, true); assert.equal(view.retryButton().disabled, true);
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.unavailable);
  const raw = storage.values.get(journalSlot(id(8)));
  if (saved) assert.deepEqual(JSON.parse(raw), pendingRecord({ key: id(90) }));
  else assert.equal(storage.values.size, 0);
  for (const name of ['lumina:authchange', 'pageshow', 'lumina:localechange']) view.window.fire(name);
  await view.load(); await view.retry();
  assert.equal(view.retryButton().hidden, true); assert.equal(view.calls.length, 4); assert.equal(checks(view).length, 0);
  assert.ok(view.choices().every(button => button.disabled)); assert.equal(storage.values.get(journalSlot(id(8))), raw);
  assert.equal(storage.operations.some(([operation]) => operation === 'remove'), false);
  storage.setItem = setItem;
  const next = mounted(({ kind, reply }) => kind === 'receipt' ? response(null, 404) : reply(), { storage });
  assert.equal(next.calls.length, 0); assert.equal(next.events.length, 0);
  assert.equal(next.retryButton().hidden, !saved);
  if (saved) {
    assert.equal(await next.retry(), false); assert.equal(checks(next).length, 1); assert.equal(posts(next).length, 0);
    assert.equal(storage.values.get(journalSlot(id(8))), raw); assert.equal(next.retryButton().disabled, false);
  } else {
    await next.retry(); assert.equal(next.calls.length, 0); await next.load();
    assert.ok(next.choices().every(button => !button.disabled)); assert.equal(posts(next).length, 0);
  }
});

const corruptJournals = {
  'wrong-version': value => { value.version = 2; }, 'string-version': value => { value.version = '1'; },
  'foreign-owner': value => { value.ownerId = id(9); }, 'empty-owner': value => { value.ownerId = ''; },
  'owner-object': value => { value.ownerId = {}; }, 'owner-control': value => { value.ownerId = 'owner\n'; },
  'owner-length': value => { value.ownerId = 'x'.repeat(321); }, 'extra-token': value => { value.token = 'private'; },
  'extra-epoch': value => { value.epoch = 1; }, 'extra-receipt': value => { value.receipt = {}; },
  'extra-cost': value => { value.cost = '10'; }, 'extra-body-prose': value => { value.body.prose = 'private'; },
  'body-array': value => { value.body = []; }, 'body-null': value => { value.body = null; }
};
for (const field of ['version', 'ownerId', 'workId', 'choiceId', 'key', 'body']) corruptJournals[`missing-${field}`] = value => { delete value[field]; };
for (const field of Object.keys(expectedBody)) corruptJournals[`missing-body-${field}`] = value => { delete value.body[field]; };
for (const field of ['workId', 'choiceId', 'approvalId', 'progressId']) for (const invalid of [null, 42, '../unsafe', 'x'.repeat(100), 'A0000001-ABCD-4ABC-8ABC-ABCDEF000001']) {
  corruptJournals[`${field}-${JSON.stringify(invalid)}`] = value => { (field in value ? value : value.body)[field] = invalid; };
}
for (const key of [null, {}, 'short', 'bad key!!', 'bad\nkey!!', 'x'.repeat(121)]) corruptJournals[`key-${JSON.stringify(key)}`] = value => { value.key = key; };
for (const revision of [null, '1', true, 0, -1, 1.5, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
  corruptJournals[`revision-${revision}`] = value => { value.body.expectedRevision = revision; };
}
for (const locale of [null, {}, 'KO', 'ko ', 'zh', '../en']) corruptJournals[`locale-${JSON.stringify(locale)}`] = value => { value.body.locale = locale; };
const corruptJournalJson = Object.fromEntries(Object.entries(corruptJournals).map(([name, corrupt]) => {
  const value = pendingRecord(); corrupt(value); return [name, JSON.stringify(value)];
}));
Object.assign(corruptJournalJson, { malformed: '{broken', null: 'null', array: '[]', empty: '{}',
  oversized: 'x'.repeat(2049), 'oversized-whitespace': ' '.repeat(2049) + JSON.stringify(pendingRecord()),
  'oversized-utf8': JSON.stringify({ padding: '\uD55C'.repeat(700) }),
  'duplicate-key': JSON.stringify(pendingRecord()).replace('"version":1', '"version":2,"version":1'),
  'duplicate-body-key': JSON.stringify(pendingRecord()).replace('"expectedRevision":1', '"expectedRevision":9,"expectedRevision":1'),
  prototype: JSON.stringify({ ...pendingRecord(), ['__proto__']: {} }) });
for (const [name, raw] of Object.entries(corruptJournalJson)) test(`journal: corrupted or tampered session record ${name} never restores, overwrites, or dispatches`, async () => {
  const storage = memoryStorage(); storage.values.set(journalSlot(id(8)), raw);
  const view = mounted(undefined, { storage }); assert.equal(view.calls.length, 0); assert.equal(view.events.length, 0);
  assert.equal(view.retryButton().hidden, true); await view.retry(); await view.load();
  for (const button of view.choices()) { assert.equal(button.disabled, true); await button.fire('click'); }
  view.window.fire('lumina:authchange'); await view.load();
  assert.ok(view.choices().every(button => button.disabled)); assert.equal(posts(view).length, 0); assert.equal(view.events.length, 0);
  assert.equal(storage.values.get(journalSlot(id(8))), raw);
  assert.equal(storage.operations.some(([operation]) => ['write', 'remove'].includes(operation)), false);
});

test('journal: injected records also reject exact-key, accessor, symbol, type, and ownership violations', async () => {
  let accessed = 0;
  const accessor = pendingRecord(); Object.defineProperty(accessor, 'key', { enumerable: true, get: () => { accessed++; return 'key-0001'; } });
  const values = [undefined, Promise.resolve(null), accessor, { ...pendingRecord(), [Symbol('private')]: 'private' },
    ...Object.values(corruptJournals).map(corrupt => { const value = pendingRecord(); corrupt(value); return value; })];
  for (const value of values) {
    let writes = 0;
    const journal = { read: () => value, write: () => { writes++; return true; }, remove: () => true };
    const view = screen(undefined, { journal }); await view.load(); assert.equal(view.snapshot().canRetry, false);
    assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0); assert.equal(writes, 0);
  }
  assert.equal(accessed, 0);
});

for (const journal of [null, {}, { read: () => null }, { read: () => null, write: () => true }]) {
  test(`journal: an incomplete injected API (${Object.keys(journal || {}).join(',') || 'none'}) never permits a paid POST`, async () => {
    const view = screen(undefined, { journal }); await view.load();
    assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  });
}

for (const locale of locales) test(`journal: bounded opaque owner, longest safe key, and safe revision restore ${locale} unchanged`, async () => {
  const owner = '\uD55C'.repeat(320), storage = memoryStorage();
  const saved = pendingRecord({ ownerId: owner, key: 'A._:-123'.repeat(15),
    body: { ...expectedBody, expectedRevision: 2147483646, locale } });
  storage.values.set(journalSlot(owner), JSON.stringify(saved));
  const view = mounted(({ kind, url, reply }) => kind === 'receipt'
    ? response(receiptEnvelope(url, originalReceipt({ revisionAfterRequest: 2147483647 }))) : reply(),
  { storage, owner: { ownerId: owner, epoch: 2 }, sourceLocale: locale, language: 'en' });
  assert.equal(view.calls.length, 0); assert.equal(view.retryButton().disabled, false);
  assert.equal(await view.retry(), true);
  assert.equal(checks(view)[0].options.headers['Idempotency-Key'], saved.key);
  assert.deepEqual(Object.fromEntries(new URL(checks(view)[0].url, 'https://unit.invalid').searchParams),
    { ...saved.body, expectedRevision: String(saved.body.expectedRevision) });
  assert.equal(posts(view).length, 0); assert.equal(view.events.length, 1); assert.equal(storage.values.size, 0);
});

for (const revision of [2147483645, 2147483646, 2147483647]) {
  test(`journal: initial revision ${revision} must fit the receipt GET limit before persistence or POST`, async () => {
    const journal = structuredJournal(); let dispatches = 0;
    const view = screen(({ kind, reply }) => {
      if (kind === 'preview') { const value = preview(); value.progress.revision = revision; return response(value); }
      if (kind === 'choice') return response(aiReceipt('queued', { revisionAfterRequest: revision + 1 }), 201);
      return reply();
    }, { journal, onDispatch: () => { dispatches++; } });
    await view.load(); const allowed = revision <= 2147483646;
    assert.equal(await view.choose(id(6)), allowed);
    assert.equal(posts(view).length, allowed ? 1 : 0); assert.equal(dispatches, allowed ? 1 : 0);
    assert.equal(journal.operations.filter(value => value === 'write').length, allowed ? 1 : 0);
    assert.equal(journal.operations.filter(value => value === 'remove').length, allowed ? 1 : 0);
    assert.equal(journal.entries.size, 0); assert.equal(unresolved(view), false); assert.equal(view.snapshot().canRetry, false);
    if (allowed) assert.equal(JSON.parse(posts(view)[0].options.body).expectedRevision, revision);
    else {
      assertCleared(view); assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'unavailable');
      assert.equal(await view.retry(), false); view.invalidate(); await view.load();
      assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 1); assert.equal(checks(view).length, 0);
    }
  });
}

for (const status of [400, 401, 403, 404, 409, 422, 402, 405, 408, 410, 418, 425, 429, 500]) {
  test(`journal: initial HTTP ${status} preserves the existing explicit rejection list`, async () => {
    const journal = structuredJournal();
    const view = screen(({ kind, reply }) => kind === 'choice' || kind === 'receipt' ? response(null, status) : reply(), { journal });
    await view.load(); assert.equal(await view.choose(id(6)), false);
    const rejected = [400, 401, 403, 404, 409, 422].includes(status);
    assert.equal(journal.entries.has(id(8)), !rejected); assert.equal(unresolved(view), !rejected);
    if (!rejected) { assert.equal(await view.retry(), false); assert.deepEqual(journal.entries.get(id(8)), pendingRecord()); }
    assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
    assert.equal(journal.operations.filter(value => value === 'remove').length, rejected ? 1 : 0);
  });
}

test('journal: record replacement after POST cannot be overwritten or removed by a verified late result', async () => {
  const journal = structuredJournal(), pending = deferred();
  const view = screen(({ kind, reply }) => kind === 'choice' ? pending.promise : reply(), { journal });
  await view.load(); const task = view.choose(id(6));
  const changed = pendingRecord({ key: 'other-command-0002', body: { ...expectedBody, expectedRevision: 9 } });
  journal.entries.set(id(8), changed); pending.resolve(response(aiReceipt('completed'), 201));
  assert.equal(await task, false); assertUncertain(view); assert.deepEqual(journal.entries.get(id(8)), changed);
  assert.equal(journal.operations.filter(value => value === 'remove').length, 0);
  await view.load(); assert.equal(await view.choose(id(5)), false); assert.equal(posts(view).length, 1); assert.equal(view.keys(), 1);
});

test('journal: owner or locale changes during persistence preserve the exact record without dispatch', async () => {
  for (const change of [scopeChanges.account, scopeChanges.work, scopeChanges.source, scopeChanges.language]) {
    const journal = structuredJournal(), write = journal.write; let view, dispatches = 0;
    journal.write = value => { write(value); change(view); return true; };
    view = screen(undefined, { journal, onDispatch: () => { dispatches++; } });
    await view.load(); assert.equal(await view.choose(id(6)), false);
    assert.deepEqual(journal.entries.get(id(8)), pendingRecord()); assert.equal(posts(view).length, 0); assert.equal(dispatches, 0);
    assert.equal(view.snapshot().canChoose, false); assert.equal(view.keys(), 1);
  }
});

test('recovery: manual lookup persists the original server command and waits for a separate exact receipt GET', async () => {
  const journal = structuredJournal(), remote = recoveryCommand(); let dispatches = 0;
  const view = screen(({ kind, url, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote))
    : kind === 'receipt' ? response(receiptEnvelope(url, aiReceipt('processing'))) : reply(),
  { journal, onDispatch: () => { dispatches++; } });
  view.set.owner({ ownerId: id(8), epoch: 5, token: 'must-not-persist' }); view.invalidate();
  assert.equal(view.snapshot().canRecover, true); assert.equal(view.calls.length, 0);
  assert.equal(await view.recover(view.snapshot().ticket), true);
  assert.equal(view.calls.length, 1); const lookup = view.calls[0];
  assert.equal(lookup.url, `/api/v1/me/creator-studio/stories/${id(1)}/body-trial/recovery`);
  assert.equal(lookup.options.method, 'GET'); assert.equal(lookup.options.body, undefined);
  assert.equal(lookup.options.headers['Idempotency-Key'], undefined); assert.equal(lookup.options.headers['Content-Type'], undefined);
  assert.equal(lookup.options.headers['Cache-Control'], 'no-store'); assert.equal(lookup.options.cache, 'no-store');
  assert.equal(lookup.options._retried, false); assert.deepEqual(clone(lookup.options.identity), { ownerId: id(8), epoch: 5 });
  assert.deepEqual(journal.entries.get(id(8)), { version: 1, ownerId: id(8), ...remote });
  assertUncertain(view); assert.equal(view.snapshot().canRetry, true); assert.equal(view.snapshot().canRecover, false);
  view.snapshot(); view.syncContext(); assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0); assert.equal(dispatches, 0);
  assert.equal(await view.recover(), false); assert.equal(await view.choose(id(6)), false);
  assert.equal(await view.retry(), true); assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0);
  assertReplay({ url: `/api/v1/me/creator-studio/stories/${remote.workId}/body-trial/choices/${remote.choiceId}`,
    options: { body: JSON.stringify(remote.body), headers: { 'Idempotency-Key': remote.key } } }, checks(view)[0], 5);
  assert.equal(journal.entries.size, 0); assert.equal(dispatches, 0); assert.equal(view.keys(), 0);
  assert.equal(view.snapshot().receipt.status, 'processing'); assert.equal(view.snapshot().canChoose, false);
  assert.doesNotMatch(JSON.stringify(view.states), /must-not-persist|server-choice-original-key/);
});

test('recovery: legacy controller without an injected journal still supports manual server lookup and receipt GET', async () => {
  const remote = recoveryCommand(), view = screen(({ kind, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote)) : reply());
  assert.equal(await view.recover(), true); assertUncertain(view); assert.equal(view.keys(), 0);
  assert.equal(await view.retry(), true); assert.equal(posts(view).length, 0); assert.equal(view.calls.length, 2);
  assert.equal(checks(view)[0].options.headers['Idempotency-Key'], remote.key); assert.equal(unresolved(view), false);
});

for (const uiLocale of locales) test(`recovery: mounted ${uiLocale} History tooltip, accessible icon, and null notice stay manual`, async () => {
  const icons = [], lucide = { icons: { RefreshCw: 'RefreshCw', RotateCcw: 'RotateCcw', History: 'History', Info: 'Info' },
    createElement: icon => { icons.push(icon); return new Element('svg'); } };
  const view = mounted(undefined, { language: uiLocale, lucide });
  assert.deepEqual(icons.slice(-4), ['RefreshCw', 'RotateCcw', 'History', 'Info']);
  assert.equal(walk(view.host).filter(node => node.className === 'body-trial-tool').length, 4);
  const inspect = walk(view.host).find(node => node.id === 'writerBodyTrialSourceInspect');
  assert.equal(inspect.type, 'button'); assert.equal(inspect.disabled, true);
  assert.equal(inspect.getAttribute('aria-label'), inspect.title);
  assert.equal(inspect.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(view.recoverButton().id, 'writerBodyTrialRecover'); assert.equal(view.recoverButton().type, 'button');
  assert.equal(view.recoverButton().title, view.api.copy[uiLocale].recover);
  assert.equal(view.recoverButton().getAttribute('aria-label'), view.api.copy[uiLocale].recover);
  assert.equal(view.recoverButton().children[0].getAttribute('aria-hidden'), 'true');
  for (const name of ['focus', 'pageshow', 'lumina:localechange', 'lumina:authchange']) view.window.fire(name);
  assert.equal(view.calls.length, 0); assert.equal(view.events.length, 0);
  assert.equal(await view.recover(), true); assert.equal(view.calls.length, 1); assert.equal(view.calls[0].kind, 'recovery');
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy[uiLocale].recoveryEmpty);
  assert.equal(view.retryButton().hidden, true); assert.equal(view.recoverButton().disabled, false);
  assert.equal(inspect.disabled, true);
  assert.equal(view.choices().length, 0); assert.equal(posts(view).length, 0); assert.equal(view.events.length, 0);
  assert.equal(view.storage.values.size, 0); assert.equal(view.refreshAttempts(), 0);
  assert.equal(view.calls[0].options.token, undefined); assert.equal(view.calls[0].options._retried, false);
});

for (const sourceLocale of locales) test(`recovery: latest ${sourceLocale} command retains source locale until exact confirmation scope is selected`, async () => {
  const remote = recoveryCommand({ body: { ...expectedBody, locale: sourceLocale } });
  const view = mounted(({ kind, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote)) : reply());
  await view.recover(); const raw = view.storage.values.get(journalSlot(id(8)));
  assert.deepEqual(JSON.parse(raw), { version: 1, ownerId: id(8), ...remote });
  assert.equal(view.retryButton().disabled, sourceLocale !== 'ko'); assert.equal(view.recoverButton().disabled, true);
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent,
    view.api.copy.ko[sourceLocale === 'ko' ? 'uncertain' : 'unresolvedElsewhere']);
  view.work.value = id(9); view.work.fire('change'); await view.load();
  assert.ok(view.choices().every(button => button.disabled)); assert.equal(view.retryButton().disabled, true);
  await view.retry(); assert.equal(checks(view).length, 0); assert.equal(view.storage.values.get(journalSlot(id(8))), raw);
  view.work.value = id(1); view.work.fire('change'); view.sourceLocale.value = sourceLocale; view.sourceLocale.fire('change');
  view.locale('en'); view.window.fire('lumina:localechange');
  assert.equal(view.retryButton().disabled, false); assert.equal(await view.retry(), true);
  assert.equal(checks(view)[0].options.headers['Idempotency-Key'], remote.key);
  assert.equal(new URL(checks(view)[0].url, 'https://unit.invalid').searchParams.get('locale'), sourceLocale);
  assert.equal(posts(view).length, 0); assert.equal(view.events.length, 1); assert.equal(view.storage.values.size, 0);
});

test('recovery: null clears no command and does not reuse a previously loaded approval to enable paid choices', async () => {
  const journal = structuredJournal(), view = screen(undefined, { journal }); await view.load();
  assert.equal(view.snapshot().canChoose, true); assert.equal(await view.recover(), true); assertCleared(view);
  assert.equal(view.snapshot().messageKey, 'recoveryEmpty'); assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.snapshot().canRetry, false); assert.equal(view.snapshot().canRecover, true);
  assert.equal(journal.operations.filter(value => value === 'write' || value === 'remove').length, 0);
  assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
});

for (const result of [null, recoveryCommand()]) test(`recovery: ${result === null ? 'null' : 'remote command'} never replaces a local journal appearing during GET`, async () => {
  const journal = structuredJournal(), pending = deferred();
  const view = screen(({ kind, reply }) => kind === 'recovery' ? pending.promise : reply(), { journal });
  const task = view.recover(); journal.entries.set(id(8), pendingRecord());
  pending.resolve(response(recoveryEnvelope(result))); assert.equal(await task, false);
  assertUncertain(view); assert.equal(view.snapshot().canRecover, false); assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
  assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0); assert.equal(journal.operations.includes('write'), false);
  assert.equal(journal.operations.includes('remove'), false); assert.equal(await view.retry(), true);
  assert.equal(checks(view)[0].options.headers['Idempotency-Key'], pendingRecord().key); assert.equal(posts(view).length, 0);
});

test('recovery: late null cannot erase a newer memory-only local command after explicit invalidation', async () => {
  const pending = deferred();
  const view = screen(({ kind, reply }) => kind === 'recovery' ? pending.promise : lostChoice({ kind, reply }));
  const task = view.recover(); view.invalidate(); await view.load(); await view.choose(id(6));
  pending.resolve(response(recoveryEnvelope(null))); assert.equal(await task, false); assertUncertain(view);
  assert.equal(await view.retry(), true); assertReplay(posts(view)[0], checks(view)[0]); assert.equal(view.keys(), 1);
});

test('recovery: double click and competing load, choose, retry stay blocked while the recovery GET is busy', async () => {
  const journal = structuredJournal(), pending = deferred();
  const view = screen(({ kind, reply }) => kind === 'recovery' ? pending.promise : reply(), { journal });
  const task = view.recover(); assert.equal(view.snapshot().busy, true); assert.equal(view.snapshot().canRecover, false);
  assert.equal(await view.recover(), false); assert.equal(await view.load(), false);
  assert.equal(await view.choose(id(6)), false); assert.equal(await view.retry(), false); assert.equal(view.calls.length, 1);
  pending.resolve(response(recoveryEnvelope(recoveryCommand()))); assert.equal(await task, true);
  assert.equal(view.snapshot().busy, false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
});

test('recovery: existing unresolved command, journalBlocked, and stale ticket prevent even a recovery GET', async () => {
  const journal = structuredJournal(); journal.entries.set(id(8), pendingRecord());
  const unresolvedView = screen(undefined, { journal }); assert.equal(await unresolvedView.recover(), false);
  assert.equal(unresolvedView.calls.length, 0); assert.deepEqual(journal.entries.get(id(8)), pendingRecord());
  const failed = screen(undefined, { journal: { read: () => { throw new Error('Private storage error'); }, write: () => true, remove: () => true } });
  assert.equal(failed.snapshot().canRecover, false); assert.equal(await failed.recover(), false); assert.equal(failed.calls.length, 0);
  const stale = screen(); const ticket = stale.snapshot().ticket; stale.invalidate();
  assert.equal(await stale.recover(ticket), false); assert.equal(stale.calls.length, 0);
  const discovered = structuredJournal(), current = screen(undefined, { journal: discovered });
  discovered.entries.set(id(8), pendingRecord()); assert.equal(await current.recover(), false); assert.equal(current.calls.length, 0);
  assert.equal(current.snapshot().canRetry, true); assert.equal(current.keys(), 0);
});

for (const [change, value] of [['owner', null], ['authorized', false], ['shown', false], ['source', 'zh'],
  ['work', ''], ['work', '../unsafe'], ['brokenIdentity', true]]) {
  test(`recovery: inaccessible ${change} never dispatches or creates a key`, async () => {
    const view = screen(); view.set[change](value); assert.equal(await view.recover(), false);
    assert.equal(view.snapshot().canRecover, false); assert.equal(view.calls.length, 0); assert.equal(view.keys(), 0);
  });
}

for (const [name, change] of Object.entries(scopeChanges)) test(`recovery: late server command after ${name} is rejected before journal write`, async () => {
  const journal = structuredJournal(), pending = deferred();
  const view = screen(({ kind, reply }) => kind === 'recovery' ? pending.promise : reply(), { journal });
  const task = view.recover(); change(view); pending.resolve(response(recoveryEnvelope(recoveryCommand())));
  assert.equal(await task, false); assertCleared(view); assert.equal(unresolved(view), false);
  assert.equal(journal.entries.size, 0); assert.equal(journal.operations.includes('write'), false);
  assert.equal(view.calls[0].options.signal.aborted, true); assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0);
});

test('recovery: context changes during body decoding cannot attach or journal a server command', async () => {
  const journal = structuredJournal(), pending = deferred(), reading = deferred();
  const view = screen(() => response(null, 200, { text: () => { reading.resolve(); return pending.promise; } }), { journal });
  const task = view.recover(); await reading.promise; view.set.owner({ ownerId: id(9), epoch: 1 });
  pending.resolve(JSON.stringify(recoveryEnvelope(recoveryCommand()))); assert.equal(await task, false);
  assert.equal(journal.entries.size, 0); assert.equal(unresolved(view), false); assertCleared(view);
});

for (const name of ['write', 'false', 'noop', 'write-after-save', 'readback']) {
  test(`recovery: ${name} storage failure retains server-backed command and any saved entry without generation`, async () => {
    const journal = structuredJournal(), write = journal.write, read = journal.read; let failRead = false, dispatches = 0;
    journal.write = value => {
      if (name === 'write') throw new Error('Private storage failure');
      if (name === 'false') return false;
      if (name === 'noop') return true;
      write(value);
      if (name === 'write-after-save') throw Object.assign(new Error('Private storage failure'), { status: 422 });
      failRead = true; return true;
    };
    journal.read = owner => { if (failRead) throw new Error('Private readback failure'); return read(owner); };
    const remote = recoveryCommand(), view = screen(({ kind, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote)) : reply(),
      { journal, onDispatch: () => { dispatches++; } });
    assert.equal(await view.recover(), false); assertUncertain(view); assert.equal(view.snapshot().messageKey, 'unavailable');
    assert.equal(view.snapshot().canRetry, true); assert.equal(view.snapshot().canRecover, false);
    assert.equal(await view.choose(id(6)), false); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
    assert.equal(dispatches, 0); assert.equal(view.calls.length, 1); assert.equal(journal.operations.includes('remove'), false);
    failRead = false; const saved = ['write-after-save', 'readback'].includes(name);
    assert.equal(journal.entries.has(id(8)), saved);
    if (saved) assert.deepEqual(journal.entries.get(id(8)), { version: 1, ownerId: id(8), ...remote });
    assert.equal(await view.retry(), saved); assert.equal(checks(view)[0].options.headers['Idempotency-Key'], remote.key);
    assert.equal(unresolved(view), !saved); assert.equal(posts(view).length, 0); assert.equal(dispatches, 0);
    assert.doesNotMatch(JSON.stringify(view.states), /Private storage|Private readback/);
  });
}

for (const saved of [false, true]) test(`recovery: actual mount preserves server key on setItem failure with saved entry ${saved}`, async () => {
  const storage = memoryStorage(), setItem = storage.setItem, remote = recoveryCommand();
  storage.setItem = (key, value) => { if (saved) setItem(key, value); throw new Error('Private storage failure'); };
  const view = mounted(({ kind, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote)) : reply(), { storage });
  assert.equal(await view.recover(), false); assert.equal(view.retryButton().hidden, false); assert.equal(view.recoverButton().disabled, true);
  assert.equal(posts(view).length, 0); assert.equal(view.events.length, 0); assert.equal(view.calls.length, 1);
  const raw = storage.values.get(journalSlot(id(8))); assert.equal(storage.values.size, saved ? 1 : 0);
  if (saved) assert.deepEqual(JSON.parse(raw), { version: 1, ownerId: id(8), ...remote });
  storage.setItem = setItem;
  const next = mounted(({ kind, reply }) => kind === 'recovery' ? response(recoveryEnvelope(remote)) : reply(), { storage });
  assert.equal(next.calls.length, 0); if (!saved) assert.equal(await next.recover(), true);
  assert.equal(next.retryButton().disabled, false); assert.equal(await next.retry(), true);
  assert.equal(checks(next)[0].options.headers['Idempotency-Key'], remote.key); assert.equal(posts(next).length, 0);
  assert.equal(next.events.length, 1); assert.equal(storage.values.size, 0);
});

for (const status of [201, 204, 400, 401, 403, 404, 409, 422, 429, 500]) test(`recovery: HTTP ${status} authorizes nothing and never starts a replacement paid call`, async () => {
  let reads = 0;
  const journal = structuredJournal(), view = screen(() => response(null, status, { text: () => { reads++; throw new Error('Private diagnostics'); } }), { journal });
  assert.equal(await view.recover(), false); assertCleared(view); assert.equal(unresolved(view), false);
  assert.equal(reads, 0); assert.equal(journal.entries.size, 0); assert.equal(view.keys(), 0);
  assert.equal(view.calls.length, 1); assert.equal(posts(view).length, 0); assert.equal(view.snapshot().canChoose, false);
});

const invalidRecoveries = {
  null: () => null, array: () => [], contract: value => ({ ...value, contract: 'other' }),
  'other-work': value => ({ ...value, workId: id(9) }), 'extra-private': value => ({ ...value, prose: 'Private source' }),
  'extra-owner': value => ({ ...value, ownerId: id(8) }), 'missing-command': value => { delete value.command; return value; },
  'empty-command': value => ({ ...value, command: {} }), 'array-command': value => ({ ...value, command: [] }),
  'foreign-command-work': value => ({ ...value, command: recoveryCommand({ workId: id(9) }) }),
  'command-owner': value => ({ ...value, command: recoveryCommand({ ownerId: id(8) }) }),
  'command-cost': value => ({ ...value, command: recoveryCommand({ cost: '1' }) }),
  'command-authorization': value => ({ ...value, command: recoveryCommand({ generationAuthorized: true }) }),
  'body-private': value => ({ ...value, command: recoveryCommand({ body: { ...expectedBody, prose: 'Private source' } }) })
};
for (const field of ['contract', 'workId', 'readOnly', 'generationAuthorized', 'generationStarted', 'imageGenerationStarted']) {
  invalidRecoveries[`missing-${field}`] = value => { delete value[field]; return value; };
}
for (const field of ['readOnly', 'generationAuthorized', 'generationStarted', 'imageGenerationStarted']) {
  for (const wrong of [field !== 'readOnly', String(field === 'readOnly'), 0]) {
    invalidRecoveries[`${field}-${JSON.stringify(wrong)}`] = value => ({ ...value, [field]: wrong });
  }
}
for (const field of ['workId', 'choiceId', 'key', 'body']) invalidRecoveries[`missing-command-${field}`] = value => { delete value.command[field]; return value; };
for (const field of Object.keys(expectedBody)) invalidRecoveries[`missing-body-${field}`] = value => { delete value.command.body[field]; return value; };
for (const field of ['workId', 'choiceId', 'approvalId', 'progressId']) for (const wrong of [null, '../unsafe', 'A0000001-ABCD-4ABC-8ABC-ABCDEF000001']) {
  invalidRecoveries[`${field}-${JSON.stringify(wrong)}`] = value => {
    (field in value.command ? value.command : value.command.body)[field] = wrong; return value;
  };
}
for (const key of ['short', 'bad key!!', 'x'.repeat(121), null]) invalidRecoveries[`key-${JSON.stringify(key)}`] = value => ({ ...value, command: recoveryCommand({ key }) });
for (const revision of [0, -1, 1.5, '1', 2147483647, Number.MAX_SAFE_INTEGER]) invalidRecoveries[`revision-${revision}`] = value => ({
  ...value, command: recoveryCommand({ body: { ...expectedBody, expectedRevision: revision } }) });
for (const locale of ['KO', 'zh', 'ko ', null]) invalidRecoveries[`locale-${locale}`] = value => ({
  ...value, command: recoveryCommand({ body: { ...expectedBody, locale } }) });
for (const [name, corrupt] of Object.entries(invalidRecoveries)) test(`recovery: strict parser rejects ${name} before journaling or enabling receipt retry`, async () => {
  const journal = structuredJournal(), value = corrupt(recoveryEnvelope(recoveryCommand()));
  const view = screen(() => response(value), { journal });
  assert.throws(() => view.api.parseRecovery(value, { workId: id(1) }), error => error.kind === 'invalid');
  assert.equal(await view.recover(), false); assertCleared(view); assert.equal(view.snapshot().messageKey, 'invalid');
  assert.equal(view.snapshot().canChoose, false); assert.equal(view.snapshot().canRetry, false); assert.equal(view.keys(), 0);
  assert.equal(journal.entries.size, 0); assert.equal(journal.operations.includes('write'), false); assert.equal(posts(view).length, 0);
});

test('recovery: parser accepts null and the journal revision ceiling without retaining flags or mutable server references', () => {
  const { api } = library(); assert.equal(api.parseRecovery(recoveryEnvelope(null), { workId: id(1) }), null);
  const command = recoveryCommand({ body: { ...expectedBody, expectedRevision: 2147483646, locale: 'ja' } });
  const expected = clone(command), value = recoveryEnvelope(command), parsed = api.parseRecovery(value, { workId: id(1) });
  assert.deepEqual(clone(parsed), expected); value.command.body.locale = 'en'; value.command.key = 'different-key';
  assert.equal(parsed.body.locale, 'ja'); assert.equal(parsed.key, expected.key);
  assert.deepEqual(Object.keys(parsed).sort(), ['body', 'choiceId', 'key', 'workId']);
  assert.throws(() => api.parseRecovery(recoveryEnvelope(null), { workId: 'bad' }));
});

for (const kind of ['transport', 'bad-json', 'declared-size', 'actual-size', 'stream-size']) test(`recovery: ${kind} response stays bounded without private diagnostics or follow-up requests`, async () => {
  let consumed = 0, cancelled = 0;
  const view = screen(() => {
    if (kind === 'transport') throw new Error('Private transport');
    if (kind === 'bad-json') return response(null, 200, { text: async () => '{broken' });
    if (kind === 'declared-size') return response(null, 200, { headers: { get: () => '2049' },
      body: { cancel: () => { cancelled++; } }, text: () => { consumed++; return '{}'; } });
    if (kind === 'actual-size') return response({ padding: 'x'.repeat(2049) });
    return response(null, 200, { body: { getReader: () => ({
      read: async () => { consumed++; return { done: false, value: new Uint8Array(2049) }; }, cancel: () => { cancelled++; }
    }) } });
  }, { journal: structuredJournal() });
  assert.equal(await view.recover(), false); assertCleared(view); assert.equal(unresolved(view), false);
  assert.equal(view.calls.length, 1); assert.equal(view.keys(), 0); assert.equal(posts(view).length, 0);
  assert.equal(consumed, kind === 'stream-size' ? 1 : 0); assert.equal(cancelled, ['declared-size', 'stream-size'].includes(kind) ? 1 : 0);
  assert.doesNotMatch(JSON.stringify(view.snapshot()), /Private transport/);
});

test('recovery: four icon slots retain fixed widths and columns with a wrapping mobile header', () => {
  assert.match(css, /body-trial-tools\s*\{[^}]*display: grid;[^}]*grid-template-columns: repeat\(4, 44px\);[^}]*width: 200px;[^}]*gap: 8px/);
  for (const [name, column] of [['Refresh', 1], ['Retry', 2], ['Recover', 3], ['SourceInspect', 4]]) {
    assert.match(css, new RegExp(`#writerBodyTrial${name}\\s*\\{ grid-column: ${column}; \\}`));
  }
  assert.match(css, /body-trial-tool\s*\{[^}]*grid-row: 1/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*body-trial-header \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /body-trial-tools \{ justify-self: end/); assert.equal(4 * 44 + 3 * 8, 200);
});

test('recovery: source remains entirely ASCII and labels the locator as a recent request rather than current progress', () => {
  assert.doesNotMatch(source, /[^\x00-\x7f]/);
  const { api } = library();
  assert.equal(api.copy.en.recover, 'Find recent request');
  assert.equal(api.copy.en.recoveryEmpty, 'No recent request record found.');
  assert.equal(api.copy.ko.recoveryEmpty, '\ucd5c\uadfc \uc694\uccad \uae30\ub85d\uc744 \ucc3e\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.');
});

const receiptResultLabels = { ko: '\uc811\uc218 \uacb0\uacfc', en: 'Receipt result', ja: '\u53d7\u4ed8\u7d50\u679c',
  'zh-Hans': '\u53d7\u7406\u7ed3\u679c', 'zh-Hant': '\u53d7\u7406\u7d50\u679c' };
const displayedReceiptCases = [
  ['original-ending', originalReceipt({ status: 'completed' }), 'ending'],
  ['original-active', originalReceipt(), 'accepted'],
  ['queued', aiReceipt('queued'), 'generating'], ['processing', aiReceipt('processing'), 'generating'],
  ['completed', aiReceipt('completed'), 'accepted'], ['failed', aiReceipt('failed'), 'generationFailed'],
  ['timeout', aiReceipt('timeout'), 'generationTimeout']
];
for (const language of locales) for (const [name, receipt, messageKey] of displayedReceiptCases) {
  test(`recovery: ${language} historical ${name} is a receipt result, not the reset story's current state`, async () => {
    const remote = recoveryCommand();
    const view = mounted(({ kind, url, reply }) => {
      if (kind === 'recovery') return response(recoveryEnvelope(remote));
      if (kind === 'receipt') return response(receiptEnvelope(url, receipt));
      if (kind === 'preview') { const value = preview(); value.progress.revision = 9; return response(value); }
      return reply();
    }, { language });
    const status = () => walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent;
    assert.equal(view.api.copy[language].receiptResult, receiptResultLabels[language]);
    assert.equal(view.calls.length, 0); assert.equal(await view.recover(), true);
    assert.equal(status(), view.api.copy[language].uncertain); assert.equal(view.calls.length, 1); assert.equal(checks(view).length, 0);
    assert.equal(await view.retry(), true);
    assert.equal(status(), receiptResultLabels[language] + ': ' + view.api.copy[language][messageKey]);
    assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0); assert.equal(view.events.length, 1);
    assert.equal(view.choices().length, 0); assert.equal(view.storage.values.size, 0);
    assert.equal(checks(view)[0].options.headers['Idempotency-Key'], remote.key);
    assert.equal(new URL(checks(view)[0].url, 'https://unit.invalid').searchParams.get('expectedRevision'), '1');
    assert.equal(await view.load(), true);
    assert.equal(status(), view.api.copy[language].approval_recorded);
    assert.ok(view.choices().every(button => !button.disabled)); assert.equal(view.calls.length, 4);
    assert.equal(posts(view).length, 0); assert.equal(view.events.length, 1);
  });
}

for (const language of locales) test(`receipt result: ${language} also scopes initial POST receipts without changing controller status policy`, async () => {
  const view = mounted(({ kind, reply }) => kind === 'choice' ? response(originalReceipt({ status: 'completed' })) : reply(), { language });
  await view.load(); assert.equal(await view.choices()[0].fire('click'), true);
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent,
    receiptResultLabels[language] + ': ' + view.api.copy[language].ending);
  assert.equal(posts(view).length, 1); assert.equal(view.calls.length, 3); assert.equal(view.events.length, 2);
  assert.equal(view.retryButton().hidden, true); assert.equal(view.choices().length, 0);
});

test('receipt result: an unverified receipt GET never gains the result prefix', async () => {
  const view = mounted(({ kind, url, reply }) => kind === 'recovery' ? response(recoveryEnvelope(recoveryCommand()))
    : kind === 'receipt' ? response(receiptEnvelope(url, originalReceipt({ revisionAfterRequest: 99 }))) : reply());
  await view.recover(); assert.equal(await view.retry(), false);
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.uncertain);
  assert.equal(view.retryButton().disabled, false); assert.equal(view.storage.values.size, 1);
  assert.equal(view.calls.length, 2); assert.equal(posts(view).length, 0); assert.equal(view.events.length, 0);
});

test('entry pairs the recovered trial script and stylesheet with a fresh matching cache revision', () => {
  const stylesheet = entry.match(/href="\/pages\/creator-body-trial\.css\?v=([^"&]+)"/)?.[1];
  const script = entry.match(/src="\/pages\/creator-body-trial\.js\?v=([^"&]+)"/)?.[1];
  assert.equal(script, 'body-read-20261006');
  assert.equal(stylesheet, script);
  assert.doesNotMatch(entry, /creator-body-trial\.(?:css|js)\?v=body-trial-20261002/);
});

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

test('mount stays idle and forwards bodyless reads to the current shared authentication session', async () => {
  const view = mounted(); assert.equal(view.calls.length, 0);
  assert.equal(view.refresh().type, 'button'); assert.ok(view.refresh().title); assert.ok(view.refresh().getAttribute('aria-label'));
  assert.equal(view.retryButton().hidden, true);
  for (const type of ['focus', 'pageshow', 'lumina:localechange', 'storage', 'lumina:authchange']) view.window.fire(type);
  assert.equal(view.calls.length, 0);
  await view.load(); assert.equal(view.calls.length, 2);
  for (const { options } of view.calls) {
    assert.equal(options.token, undefined); assert.equal(options._retried, false); assert.equal(options.cache, 'no-store');
    assert.deepEqual(clone(options.identity), { ownerId: id(8), epoch: 1 });
  }
  assert.equal(view.refreshAttempts(), 0); view.setToken(null); view.setOwner(null); await view.load();
  assert.equal(view.calls.length, 2); assert.equal(view.refreshAttempts(), 0);
  assert.doesNotMatch(view.host.textContent, /Private trial text/);
});

test('mount forwards initial POST as an object and checks its receipt with a bodyless GET and the same key', async () => {
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
  const replay = checks(view)[0];
  assertReplay(first, replay); assert.equal(posts(view).length, 1);
  assert.equal(replay.options._retried, false); assert.equal(replay.options.cache, 'no-store');
  assert.equal(replay.options.token, undefined); assert.equal(view.retryButton().hidden, true);
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
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) 200px/);
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
        ['10,000 KRW', '4,046 KRW', currentUnknown ? view.api.copy[language].unknown : '5,954 KRW']);
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

const wholeWonDisplayCases = [
  ['0.000000', '0 KRW', '10,000 KRW'],
  ['0.499999', '0 KRW', '10,000 KRW'],
  ['0.500000', '1 KRW', '10,000 KRW'],
  ['0.999999', '1 KRW', '9,999 KRW'],
  ['91.138500', '91 KRW', '9,909 KRW'],
  ['999.499999', '999 KRW', '9,001 KRW'],
  ['999.500000', '1,000 KRW', '9,001 KRW'],
  ['9999.499999', '9,999 KRW', '1 KRW'],
  ['9999.500000', '10,000 KRW', '1 KRW'],
  ['10000.000000', '10,000 KRW', '0 KRW'],
  ['10000.000001', '10,000 KRW', '0 KRW'],
  ['999999999999.499999', '999,999,999,999 KRW', '0 KRW'],
  ['999999999999.500000', '1,000,000,000,000 KRW', '0 KRW'],
];
for (const language of locales) {
  test(`whole-won display: ${language} rounds labels without changing exact budget or authorization`, async () => {
    for (const [cost, spentLabel, remainingLabel] of wholeWonDisplayCases) {
      const value = approvalState(), committed = BigInt(cost.replace('.', '')), cap = 10000000000n;
      const remaining = cap > committed ? cap - committed : 0n;
      value.state = committed > cap ? 'budget_over_limit' : 'approval_recorded';
      Object.assign(value.budget, { knownActualCostKrw: cost, reservedMaximumCostKrw: '0.000000',
        committedCostKrw: cost, remainingBudgetKrw: `${remaining / 1000000n}.${String(remaining % 1000000n).padStart(6, '0')}`,
        pendingCount: 0 });
      const before = clone(value);
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
      await view.load();
      const budget = walk(view.host).find(node => node.className === 'body-trial-budget');
      assert.deepEqual(walk(budget).filter(node => node.tagName === 'DD').map(node => node.textContent),
        ['10,000 KRW', spentLabel, remainingLabel], cost);
      assert.deepEqual(value, before, 'Rendering must not mutate source amounts');
      assert.deepEqual(clone(view.api.parseState(value, { workId: id(1) })), before);
      const status = walk(view.host).find(node => node.id === 'writerBodyTrialState');
      assert.equal(status.textContent, view.api.copy[language][value.state]);
      assert.ok(view.choices().every(button => button.disabled === (committed > cap)), cost);
      if (committed > cap) for (const button of view.choices()) await button.fire('click');
      assert.equal(posts(view).length, 0);
    }
  });
}

for (const cost of ['91.1385', '-1.000000', '1e2', 'NaN', null]) {
  test(`whole-won display: malformed cost ${JSON.stringify(cost)} is not rendered or authorized`, async () => {
    const value = approvalState(); value.budget.committedCostKrw = cost;
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    await view.load();
    assert.equal(walk(view.host).some(node => node.className === 'body-trial-budget'), false);
    assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.invalid);
    assert.equal(view.choices().length, 0); assert.equal(posts(view).length, 0);
  });
}

const nextCostUiCopy = {
  "ko": [
    "\ub2e4\uc74c \ubcf8\ubb38 \uc2dc\ud5d8 \ucd5c\ub300",
    "\ub2e4\uc74c \ubcf8\ubb38 \uc2dc\ud5d8 \ucd5c\ub300 \ube44\uc6a9 \ud655\uc778 \ud544\uc694"
  ],
  "en": [
    "Next text trial maximum",
    "Next text trial maximum cost needs checking."
  ],
  "ja": [
    "\u6b21\u306e\u672c\u6587\u30c6\u30b9\u30c8\u306e\u6700\u5927\u8cbb\u7528",
    "\u6b21\u306e\u672c\u6587\u30c6\u30b9\u30c8\u306e\u6700\u5927\u8cbb\u7528\u306e\u78ba\u8a8d\u304c\u5fc5\u8981"
  ],
  "zh-Hans": [
    "\u4e0b\u6b21\u6b63\u6587\u6d4b\u8bd5\u8d39\u7528\u4e0a\u9650",
    "\u9700\u8981\u786e\u8ba4\u4e0b\u6b21\u6b63\u6587\u6d4b\u8bd5\u7684\u8d39\u7528\u4e0a\u9650"
  ],
  "zh-Hant": [
    "\u4e0b\u6b21\u6b63\u6587\u6e2c\u8a66\u8cbb\u7528\u4e0a\u9650",
    "\u9700\u8981\u78ba\u8a8d\u4e0b\u6b21\u6b63\u6587\u6e2c\u8a66\u7684\u8cbb\u7528\u4e0a\u9650"
  ]
};
function nextCostUiState(amount = '300.000000', workId = id(1)) {
  const value = approvalState(workId);
  Object.assign(value, { nextMaximumCostKrw: amount, nextCostQuoteState: 'prepared', nextCostQuoteReason: null });
  Object.assign(value.budget, { reservedMaximumCostKrw: '0.000000', committedCostKrw: '0.250001',
    remainingBudgetKrw: '9999.749999', pendingCount: 0 });
  return value;
}
const nextCostNotices = view => walk(view.host).filter(node => node.id === 'writerBodyTrialNextCost');
const nextCostExpected = (language, amount) => nextCostUiCopy[language][0] + ' ' + amount + (language === 'ko' ? '\uc6d0' : ' KRW');
function assertNextCostReadOnly(view, expectedReads = 2) {
  assert.equal(posts(view).length, 0);
  assert.equal(view.refreshAttempts(), 0);
  assert.equal(view.calls.length, expectedReads);
  assert.ok(view.calls.every(call => call.options.method === 'GET' && call.options.body === undefined));
}
for (const language of locales) {
  test(`next-cost UI: ${language} displays exactly one prepared maximum without authorizing or dispatching`, async () => {
    const value = nextCostUiState(), before = clone(value);
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
    assert.equal(view.calls.length, 0); await view.load();
    for (let i = 0; i < 3; i++) {
      if (i > 0) await view.load();
      const notices = nextCostNotices(view);
      assert.equal(notices.length, 1); assert.equal(notices[0].textContent, nextCostExpected(language, '300'));
      assert.equal(notices[0].getAttribute('role'), 'note');
      const content = walk(view.host).find(node => node.id === 'writerBodyTrialContent');
      const budget = walk(view.host).find(node => node.className === 'body-trial-budget');
      assert.ok(content.children.includes(notices[0])); assert.equal(walk(budget).includes(notices[0]), false);
    }
    const parsed = view.api.parseState(value, { workId: id(1) });
    assert.equal(parsed.nextMaximumCostKrw, '300.000000');
    assert.equal(parsed.readOnly, true); assert.equal(parsed.generationAuthorized, false);
    assert.equal(parsed.currentAuthorizationVerified, false); assert.equal(parsed.imageGenerationStarted, false);
    assert.equal(parsed.approval.expiresAt, future); assert.deepEqual(value, before);
    assert.ok(view.choices().every(button => !button.disabled), 'Quote never replaces the existing selection gate');
    assertNextCostReadOnly(view, 6);
  });

  test(`next-cost UI: ${language} rounds positive ceilings up and retains exact internal amounts`, async () => {
    for (const [amount, label] of [['0.000001', '1'], ['0.499999', '1'], ['0.500000', '1'], ['1.000000', '1'],
      ['300.000001', '301'], ['999.499999', '1,000'], ['999.500000', '1,000'], ['9999.749999', '10,000']]) {
      const value = nextCostUiState(amount), before = clone(value);
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
      await view.load();
      assert.equal(nextCostNotices(view)[0].textContent, nextCostExpected(language, label));
      assert.equal(view.api.parseState(value, { workId: id(1) }).nextMaximumCostKrw, amount);
      assert.deepEqual(value, before);
      const budget = walk(view.host).find(node => node.className === 'body-trial-budget');
      assert.deepEqual(walk(budget).filter(node => node.tagName === 'DD').map(node => node.textContent),
        ['10,000 KRW', '0 KRW', '10,000 KRW'], 'Existing balance rounding remains unchanged');
      assertNextCostReadOnly(view);
    }
  });

  test(`next-cost UI: ${language} invalid or incomplete quote never displays a zero or a numeric permission`, async () => {
    for (const amount of [null, undefined, 300, -1, NaN, Infinity, -Infinity, '0.000000', '-1.000000',
      'NaN', 'Infinity', '-Infinity', '300.0000000', '300.0', '300', '00300.000000', '3e2', ' 300.000000', {}, [], '<script>private</script>']) {
      const value = nextCostUiState(amount);
      if (amount === undefined) delete value.nextMaximumCostKrw;
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
      await view.load();
      assert.equal(nextCostNotices(view).length, 1);
      assert.equal(nextCostNotices(view)[0].textContent, nextCostUiCopy[language][1]);
      const parsed = view.api.parseState(value, { workId: id(1) });
      assert.equal(parsed.nextMaximumCostKrw, null); assert.equal(parsed.nextCostQuoteState, 'withheld');
      assert.equal(parsed.generationAuthorized, false); assert.equal(parsed.currentAuthorizationVerified, false);
      assert.ok(view.choices().every(button => !button.disabled), 'Malformed quote does not broaden or replace existing gating');
      assertNextCostReadOnly(view);
    }
  });

  test(`next-cost UI: ${language} withheld reasons are localized safely and never expose arbitrary reason text`, async () => {
    const reasons = ['approval_required', 'approval_expired', 'release_changed', 'cost_unknown', 'budget_over_limit',
      'pending_cost', 'approval_pins_changed', 'invalid_next_maximum', 'next_cost_exceeds_remaining', '<script>private provider detail</script>'];
    for (const reason of reasons) {
      const value = nextCostUiState(null); value.nextCostQuoteState = 'withheld'; value.nextCostQuoteReason = reason;
      const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
      await view.load();
      assert.ok(nextCostNotices(view)[0].textContent.startsWith(nextCostUiCopy[language][1]));
      assert.doesNotMatch(nextCostNotices(view)[0].textContent, /300|0 KRW|0\uc6d0|script|private|provider detail/);
      assert.equal(view.api.parseState(value, { workId: id(1) }).nextMaximumCostKrw, null);
      assertNextCostReadOnly(view);
    }
  });

  test(`next-cost UI: ${language} legacy responses display a check-needed status without inventing quote fields`, async () => {
    const value = approvalState();
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply(), { language });
    await view.load();
    assert.equal(nextCostNotices(view)[0].textContent, nextCostUiCopy[language][1]);
    assert.deepEqual(clone(view.api.parseState(value, { workId: id(1) })), value);
    assert.ok(view.choices().every(button => !button.disabled));
    assertNextCostReadOnly(view);
  });
}

for (const mode of ['missing-state', 'missing-reason', 'contradictory-reason', 'contradictory-withheld', 'unknown-state',
  'expired', 'release-changed', 'unknown-cost', 'pending', 'reserved', 'next-over-budget', 'approval-missing']) {
  test(`next-cost UI: prepared value is withheld for ${mode} without changing existing context gating`, async () => {
    const value = nextCostUiState();
    if (mode === 'missing-state') delete value.nextCostQuoteState;
    if (mode === 'missing-reason') delete value.nextCostQuoteReason;
    if (mode === 'contradictory-reason') value.nextCostQuoteReason = 'approval_expired';
    if (mode === 'contradictory-withheld') value.nextCostQuoteState = 'withheld';
    if (mode === 'unknown-state') value.nextCostQuoteState = 'authorized';
    if (mode === 'expired') value.approval.expiresAt = past;
    if (mode === 'release-changed') value.state = 'release_changed';
    if (mode === 'unknown-cost') { value.state = 'cost_unknown'; Object.assign(value.budget,
      { unknownCostCount: 1, remainingBudgetKrw: null, evidenceReadyForBudgetCheck: false }); }
    if (mode === 'pending') value.budget.pendingCount = 1;
    if (mode === 'reserved') Object.assign(value.budget, { reservedMaximumCostKrw: '1.000000',
      committedCostKrw: '1.250001', remainingBudgetKrw: '9998.749999' });
    if (mode === 'next-over-budget') value.nextMaximumCostKrw = '9999.750000';
    if (mode === 'approval-missing') { value.state = 'approval_required'; value.approval = null; value.budget = null; }
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    await view.load();
    assert.equal(nextCostNotices(view).length, 1);
    assert.ok(nextCostNotices(view)[0].textContent.startsWith(nextCostUiCopy.ko[1]));
    assert.doesNotMatch(nextCostNotices(view)[0].textContent, /300\uc6d0|0\uc6d0/);
    const parsed = view.api.parseState(value, { workId: id(1) });
    assert.equal(parsed.nextMaximumCostKrw, null); assert.equal(parsed.nextCostQuoteState, 'withheld');
    assert.equal(parsed.generationAuthorized, false); assert.equal(parsed.currentAuthorizationVerified, false);
    const legacy = clone(value);
    delete legacy.nextMaximumCostKrw; delete legacy.nextCostQuoteState; delete legacy.nextCostQuoteReason;
    const oldGate = screen(({ kind, reply }) => kind === 'state' ? response(legacy) : reply());
    await oldGate.load();
    assert.ok(view.choices().every(button => button.disabled === !oldGate.snapshot().canChoose));
    assertNextCostReadOnly(view);
  });
}

test('next-cost UI: exact equality fits, one micro-won over does not fit, regardless of identical rounded labels', async () => {
  for (const [amount, prepared] of [['300.000000', true], ['300.000001', false]]) {
    const value = nextCostUiState(amount);
    Object.assign(value.budget, { knownActualCostKrw: '9700.000000', committedCostKrw: '9700.000000', remainingBudgetKrw: '300.000000' });
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    await view.load();
    assert.equal(nextCostNotices(view)[0].textContent, prepared ? nextCostExpected('ko', '300') : nextCostUiCopy.ko[1]);
    assert.equal(view.api.parseState(value, { workId: id(1) }).nextMaximumCostKrw, prepared ? amount : null);
    assertNextCostReadOnly(view);
  }
});

for (const flag of ['generationAuthorized', 'currentAuthorizationVerified', 'imageGenerationStarted']) {
  test(`next-cost UI: a prepared quote never accepts unauthorized true flag ${flag}`, async () => {
    const value = nextCostUiState(); value[flag] = true;
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(value) : reply());
    await view.load();
    assert.equal(nextCostNotices(view).length, 0); assert.equal(view.choices().length, 0);
    assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.invalid);
    assert.equal(posts(view).length, 0); assert.equal(view.calls.length, 1);
  });
}

const nextCostInvalidate = {
  account: view => { view.setOwner({ ownerId: id(9), epoch: 2 }); view.window.fire('lumina:authchange'); },
  epoch: view => { view.setOwner({ ownerId: id(8), epoch: 2 }); view.window.fire('lumina:authchange'); },
  work: view => { view.work.value = id(9); view.work.fire('change'); },
  source: view => { view.sourceLocale.value = 'ja'; view.sourceLocale.fire('change'); },
  language: view => { view.locale('en'); view.window.fire('lumina:localechange'); },
  hidden: view => { view.host.hidden = true; view.mutate(view.host); },
  visibility: view => { view.document.visibilityState = 'hidden'; view.document.fire('visibilitychange'); }
};
for (const [name, invalidate] of Object.entries(nextCostInvalidate)) {
  for (const responseKind of ['state', 'preview']) {
    test(`next-cost UI: stale ${responseKind} response after ${name} cannot restore a quote or dispatch`, async () => {
      const pending = deferred(), reached = deferred();
      const view = mounted(({ kind, target, reply }) => {
        if (kind === responseKind) { reached.resolve(); return pending.promise; }
        return kind === 'state' ? response(nextCostUiState('300.000000', target.workId)) : reply();
      });
      const task = view.load();
      await reached.promise;
      assert.ok(view.calls.some(call => call.kind === responseKind));
      assert.equal(nextCostNotices(view).length, 0);
      invalidate(view);
      pending.resolve(response(responseKind === 'state' ? nextCostUiState() : preview()));
      await task;
      assert.equal(nextCostNotices(view).length, 0); assert.equal(view.choices().length, 0);
      assert.equal(posts(view).length, 0); assert.equal(view.refreshAttempts(), 0);
    });
  }
  test(`next-cost UI: current quote and captured choice clear immediately on ${name}`, async () => {
    const view = mounted(({ kind, reply }) => kind === 'state' ? response(nextCostUiState()) : reply());
    await view.load(); const oldChoice = view.choices()[0];
    assert.equal(nextCostNotices(view).length, 1);
    invalidate(view);
    assert.equal(nextCostNotices(view).length, 0); await oldChoice.fire('click');
    assert.equal(posts(view).length, 0); assert.equal(view.refreshAttempts(), 0);
  });
}

test('next-cost UI: unknown POST outcome clears the ceiling and receipt verification stays GET-only', async () => {
  const view = mounted(({ kind, reply }) => kind === 'state' ? response(nextCostUiState())
    : kind === 'choice' ? Promise.reject(new TypeError('Synthetic lost receipt')) : reply());
  await view.load(); await view.choices()[0].fire('click');
  assert.equal(posts(view).length, 1);
  assert.equal(nextCostNotices(view).length, 0);
  assert.equal(walk(view.host).find(node => node.id === 'writerBodyTrialState').textContent, view.api.copy.ko.uncertain);
  await view.retry();
  assert.equal(posts(view).length, 1);
  assert.equal(view.calls.filter(call => call.kind === 'receipt').length, 1);
  assert.equal(view.calls.find(call => call.kind === 'receipt').options.method, 'GET');
  assert.equal(view.refreshAttempts(), 0);
});

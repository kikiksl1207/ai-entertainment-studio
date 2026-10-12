import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-current-fit.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const pump = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const preview = (locale = 'ko') => ({
  contract: 'story-author-body-preview-v1', workId: id(1), locale, readOnly: true, imageGenerationStarted: false,
  progress: { progressId: id(2), revision: 7, storyVersion: 3, status: 'active', currentBeatPosition: 1,
    scene: { id: id(3), isGenerated: false, title: 'SYNTHETIC_SCENE', endingType: null,
      beats: [{ id: id(4), position: 1, type: 'narration', content: 'Synthetic test body.' }] },
    choices: [{ id: id(6), label: 'First choice', routeKind: 'generation_required' },
      { id: id(7), label: 'Second choice', routeKind: 'generation_required' }] }
});
const unavailable = locale => ({
  contract: 'story-author-current-fit-v1', locale, sourceScope: 'latest_private_approval_and_current_reader_source',
  readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
  legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated', outcome: 'current_source_unavailable',
  currentSourceState: 'unavailable', reason: 'context_unavailable', approvalReferenceVerified: false,
  progressRevision: null, manuscriptVersion: null, analysisVersion: null, profileVersion: null, reviewRevision: null, diagnostic: null
});
function clock() {
  let now = 0, sequence = 0;
  const jobs = new Map(), records = [];
  return {
    jobs, records,
    setTimeout(fn, delay) { const key = ++sequence; const job = { key, at: now + delay, delay, fn }; jobs.set(key, job); records.push(job); return key; },
    clearTimeout(key) { jobs.delete(key); },
    async advance(amount) {
      const end = now + amount;
      while (true) {
        const job = [...jobs.values()].filter(value => value.at <= end).sort((a, b) => a.at - b.at || a.key - b.key)[0];
        if (!job) break;
        now = job.at; jobs.delete(job.key); job.fn(); await pump();
      }
      now = end; await pump();
    }
  };
}
function reply(value, { status = 200, read, cancel, length = null } = {}) {
  let sent = false;
  const stats = { read: 0, cancel: 0, release: 0 };
  const stop = () => { stats.cancel++; return cancel ? cancel() : Promise.resolve(); };
  const reader = { read() {
    stats.read++;
    if (read) return read();
    if (sent) return Promise.resolve({ done: true });
    sent = true; return Promise.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(value)) });
  }, cancel: stop, releaseLock() { stats.release++; } };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : name === 'content-type' ? 'application/json' : null },
    body: { getReader: () => reader, cancel: stop }, json() { throw new Error('Unbounded fallback forbidden'); }, text() { throw new Error('Unbounded fallback forbidden'); } };
}
function screen(handler, language = 'ko') {
  const time = clock(), calls = [], states = [];
  let owner = { ownerId: id(8), epoch: 1 }, workId = id(1), sourceLocale = language, uiLocale = language, shown = true;
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
  runInContext(previewSource, vm); runInContext(source, vm);
  const api = vm.window.LuminaCreatorBodyCurrentFit;
  const controller = api.createController({
    fetch(url, options) { calls.push({ url, options }); return handler({ url, options, calls, locale: sourceLocale }); },
    identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId, locale: sourceLocale }), locale: () => uiLocale, visible: () => shown,
    onChange: value => states.push(clone(value))
  });
  return { ...controller, api, time, calls, states,
    setOwner: value => { owner = value; }, setWork: value => { workId = value; },
    setSource: value => { sourceLocale = value; }, setLocale: value => { uiLocale = value; }, setShown: value => { shown = value; } };
}
function observe(promise) {
  const state = { settled: false, result: undefined };
  promise.then(result => { state.settled = true; state.result = result; });
  return state;
}
function cleared(view) {
  const state = view.snapshot();
  assert.equal(state.data, null); assert.equal(state.progressRevision, null); assert.equal(state.storyVersion, null);
  assert.equal(state.selectedChoiceId, ''); assert.deepEqual(clone(state.choices), []);
}
async function prepared(handler, locale = 'ko') {
  const view = screen(args => args.url.includes('/current-fit?') ? handler(args) : reply(preview(args.locale)), locale);
  assert.equal(await view.refresh(), true); assert.equal(view.selectChoice(id(6)), true);
  return view;
}
function timedOut(view, operation, count) {
  assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'transport');
  assert.equal(view.snapshot().canRefresh, true); assert.equal(view.snapshot().canCheck, false);
  assert.equal(view.snapshot().busy, false); cleared(view);
  assert.equal(operation.settled, true); assert.equal(operation.result, false);
  assert.equal(view.time.jobs.size, 0); assert.equal(view.calls.length, count);
  for (const call of view.calls) {
    assert.equal(call.options.method, 'GET'); assert.equal(call.options._retried, true); assert.equal(call.options.cache, 'no-store');
    assert.doesNotMatch(call.url, /generate|approve|payments|auth\/refresh|messages|greeting/);
  }
}

for (const mode of ['refresh', 'check']) test(`CURRENT-FIT-DEADLINE: ${mode} settles when headers never arrive and abort is ignored`, async () => {
  const pending = deferred();
  const view = mode === 'check' ? await prepared(() => pending.promise) : screen(() => pending.promise);
  const result = observe(view[mode]()); await pump();
  assert.equal(view.snapshot().busy, true); await view.time.advance(29999); assert.equal(result.settled, false);
  await view.time.advance(1); timedOut(view, result, mode === 'check' ? 2 : 1);
  assert.equal(view.calls.at(-1).options.signal.aborted, true);
  await view.time.advance(90000); assert.equal(view.calls.length, mode === 'check' ? 2 : 1);
});

test('CURRENT-FIT-DEADLINE: one full-cycle clock covers headers and stalled body with best-effort cancellation', async () => {
  const headers = deferred(), body = deferred();
  const response = reply(null, { read: () => body.promise, cancel: () => new Promise(() => {}) });
  const view = screen(() => headers.promise), result = observe(view.refresh());
  await view.time.advance(20000); headers.resolve(response); await pump();
  assert.equal(response.stats.read, 1); await view.time.advance(9999); assert.equal(result.settled, false);
  await view.time.advance(1); timedOut(view, result, 1);
  assert.equal(response.stats.cancel, 1); assert.equal(view.time.records.length, 1);
  body.resolve({ done: true }); await pump(); timedOut(view, result, 1);
});

test('CURRENT-FIT-DEADLINE: slow and empty chunks do not renew the original clock', async () => {
  let chunk = deferred();
  const response = reply(null, { read: () => chunk.promise });
  const view = await prepared(() => response), result = observe(view.check()); await pump();
  for (let i = 0; i < 3; i++) {
    await view.time.advance(9000); const old = chunk; chunk = deferred(); old.resolve({ done: false, value: new Uint8Array(0) }); await pump();
  }
  await view.time.advance(3000); timedOut(view, result, 2);
  assert.equal(response.stats.cancel, 1); assert.equal(view.time.records.filter(job => job.delay === 30000).length, 2);
});

for (const kind of ['non200', 'oversize', 'invalidChunk']) test(`CURRENT-FIT-DEADLINE: ${kind} cleanup cannot hang the caller`, async () => {
  const response = reply(null, { status: kind === 'non200' ? 503 : 200, length: kind === 'oversize' ? '262145' : null,
    read: kind === 'invalidChunk' ? async () => ({ done: false, value: 'not bytes' }) : undefined,
    cancel: () => new Promise(() => {}) });
  const view = screen(() => response), result = observe(view.refresh()); await pump();
  assert.equal(response.stats.cancel, 1); assert.equal(result.settled, true); assert.equal(result.result, false);
  assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, kind === 'non200' ? 'server' : 'invalid');
  assert.equal(view.time.jobs.size, 0); cleared(view); const before = clone(view.snapshot());
  await view.time.advance(30000); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 1);
});

test('CURRENT-FIT-DEADLINE: rejected cancellation and late transport rejection remain contained', async () => {
  const pending = deferred(), view = screen(() => pending.promise), result = observe(view.refresh());
  await view.time.advance(30000); timedOut(view, result, 1);
  pending.reject(new Error('SYNTHETIC_LATE_ERROR')); await pump(); timedOut(view, result, 1);
  const stalled = reply(null, { read: () => new Promise(() => {}), cancel: async () => { throw new Error('SYNTHETIC_CANCEL_ERROR'); } });
  const other = screen(() => stalled), second = observe(other.refresh()); await pump(); await other.time.advance(30000);
  timedOut(other, second, 1); assert.equal(stalled.stats.cancel, 1);
});

test('CURRENT-FIT-DEADLINE: late old headers cannot overwrite a newer explicit successful refresh', async () => {
  const old = deferred(); let attempts = 0;
  const view = screen(({ locale }) => ++attempts === 1 ? old.promise : reply(preview(locale)));
  const result = observe(view.refresh()); await view.time.advance(30000); timedOut(view, result, 1);
  assert.equal(await view.refresh(), true); const before = clone(view.snapshot());
  const late = reply(preview()); old.resolve(late); await pump();
  assert.deepEqual(clone(view.snapshot()), before); assert.equal(late.stats.read, 0); assert.equal(late.stats.cancel, 1);
  assert.equal(view.time.jobs.size, 0); assert.equal(view.calls.length, 2);
});

for (const change of ['invalidate', 'owner', 'epoch', 'work', 'source', 'locale', 'hidden']) test(`CURRENT-FIT-DEADLINE: ${change} retires and settles the old deadline`, async () => {
  const view = screen(() => new Promise(() => {})), result = observe(view.refresh()); await pump();
  const retired = view.time.records.at(-1);
  if (change === 'invalidate') view.invalidate();
  else {
    if (change === 'owner') view.setOwner({ ownerId: id(9), epoch: 1 });
    if (change === 'epoch') view.setOwner({ ownerId: id(8), epoch: 2 });
    if (change === 'work') view.setWork(id(10));
    if (change === 'source') view.setSource('en');
    if (change === 'locale') view.setLocale('en');
    if (change === 'hidden') view.setShown(false);
    view.syncContext();
  }
  await pump(); assert.equal(result.settled, true); assert.equal(result.result, false);
  assert.equal(view.time.jobs.size, 0); cleared(view); const before = clone(view.snapshot());
  retired.fn(); await pump(); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 1);
});

test('CURRENT-FIT-DEADLINE: choice change immediately settles a stalled check and preserves the new selection', async () => {
  const view = await prepared(() => new Promise(() => {})), result = observe(view.check()); await pump();
  const retired = view.time.records.at(-1); assert.equal(view.selectChoice(id(7)), true); await pump();
  assert.equal(result.settled, true); assert.equal(result.result, false); assert.equal(view.time.jobs.size, 0);
  assert.equal(view.snapshot().selectedChoiceId, id(7)); assert.equal(view.snapshot().canCheck, true);
  const before = clone(view.snapshot()); retired.fn(); await pump(); assert.deepEqual(clone(view.snapshot()), before);
});

for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) test(`CURRENT-FIT-DEADLINE: ${locale} normal completion clears timers without changing parser or source policy`, async () => {
  const view = await prepared(({ locale }) => reply(unavailable(locale)), locale);
  assert.equal(view.time.jobs.size, 0); assert.equal(await view.check(), true); assert.equal(view.time.jobs.size, 0);
  assert.equal(view.snapshot().data.semanticQualityVerified, false); assert.equal(view.snapshot().data.providerCalls, 0);
  assert.equal(view.snapshot().data.operatingWrites, 0); assert.equal(view.snapshot().data.dispatchAuthorized, false);
  const before = clone(view.snapshot()); await view.time.advance(30000); assert.deepEqual(clone(view.snapshot()), before);
  assert.equal(view.calls.length, 2); assert.match(view.calls[1].url, /profileByteBreakdown=v1&expectedProgressRevision=7$/);
});

test('CURRENT-FIT-DEADLINE: unauthorized and fast malformed replies terminate normally without retaining timers', async () => {
  for (const response of [reply(null, { status: 401 }), reply({ injected: true })]) {
    const view = screen(() => response); assert.equal(await view.refresh(), false);
    assert.equal(view.snapshot().phase, 'error'); assert.equal(view.time.jobs.size, 0); cleared(view);
    assert.notEqual(view.snapshot().messageKey, 'transport'); assert.equal(view.calls.length, 1);
  }
});

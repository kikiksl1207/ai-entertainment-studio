import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-original-reference.js', import.meta.url), 'utf8');
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const pump = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const clone = value => JSON.parse(JSON.stringify(value));
const reference = locale => ({ contract: 'story-author-body-original-reference-v1', workId: id(1), locale, readOnly: true,
  referenceScope: 'current_published_original_part', progressRevision: 7, semanticQualityVerified: false, bodySourceAligned: false,
  dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0, outcome: 'reference_ready',
  original: { scenes: [{ position: 1, title: 'Original', beats: [{ position: 1, type: 'narration', content: '  Entire original\nTAIL  ' }] }] },
  savedBody: { isGenerated: true, title: 'Saved', beats: [{ position: 1, type: 'narration', content: '  Entire saved\nTAIL  ' }] } });
function reply(value, { status = 200, read, cancel, length = null } = {}) {
  let sent = false; const stats = { read: 0, cancel: 0 };
  const stop = () => { stats.cancel++; return cancel ? cancel() : Promise.resolve(); };
  const reader = { read() {
    stats.read++; if (read) return read();
    if (sent) return Promise.resolve({ done: true });
    sent = true; return Promise.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(value)) });
  }, cancel: stop, releaseLock() {} };
  return { status, stats, headers: { get: name => name === 'content-length' ? length : null }, body: { getReader: () => reader, cancel: stop } };
}
function screen(handler, language = 'ko', changed = () => {}) {
  let owner = { ownerId: id(8), epoch: 1 }, work = id(1), uiLocale = language, bodyLocale = language, visible = true, sequence = 0;
  const jobs = new Map(), retired = [], calls = [];
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController,
    setTimeout(fn, delay) { const key = ++sequence; jobs.set(key, { fn, delay }); retired.push({ fn, delay }); return key; }, clearTimeout(key) { jobs.delete(key); } });
  runInContext(source, vm);
  const controller = vm.window.LuminaCreatorBodyOriginalReference.createController({
    fetch(url, options) { calls.push({ url, options }); return handler({ url, options, language: bodyLocale, calls }); },
    identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId: work, locale: bodyLocale }), locale: () => uiLocale, visible: () => visible,
    onChange: value => changed(value)
  });
  return { ...controller, calls, jobs, retired,
    async expire() { for (const [key, job] of [...jobs]) { jobs.delete(key); assert.equal(job.delay, 30000); job.fn(); } await pump(); },
    set(change) {
      if (change === 'owner') owner = { ownerId: id(9), epoch: 1 };
      if (change === 'epoch') owner = { ownerId: id(8), epoch: 2 };
      if (change === 'work') work = id(10);
      if (change === 'bodyLocale') bodyLocale = 'en';
      if (change === 'uiLocale') uiLocale = 'en';
      if (change === 'hidden') visible = false;
      controller.syncContext();
    }
  };
}
function watch(promise) { const state = { settled: false, result: undefined }; promise.then(result => { state.settled = true; state.result = result; }); return state; }
function failed(view, result) {
  assert.equal(result.settled, true); assert.equal(result.result, false);
  assert.equal(view.snapshot().phase, 'error'); assert.equal(view.snapshot().messageKey, 'transport');
  assert.equal(view.snapshot().data, null); assert.equal(view.snapshot().canLoad, true); assert.equal(view.jobs.size, 0);
}

test('ORIGINAL-READ-DEADLINE: stalled headers settle without auto retry', async () => {
  const view = screen(() => new Promise(() => {})), result = watch(view.load()); await pump();
  assert.equal(view.snapshot().phase, 'loading'); assert.equal(result.settled, false); await view.expire(); failed(view, result);
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].options.signal.aborted, true);
  assert.equal(view.calls[0].options.method, 'GET'); assert.equal(view.calls[0].options._retried, true);
  assert.equal(view.calls[0].options.cache, 'no-store'); assert.doesNotMatch(view.calls[0].url, /generate|approve|messages|greeting|auth\/refresh/);
});

test('ORIGINAL-READ-DEADLINE: reader cancellation may remain pending without delaying timeout', async () => {
  const pending = deferred(), response = reply(null, { read: () => pending.promise, cancel: () => new Promise(() => {}) });
  const view = screen(() => response), result = watch(view.load()); await pump(); await view.expire(); failed(view, result);
  assert.equal(response.stats.cancel, 1); pending.resolve({ done: true }); await pump(); failed(view, result); assert.equal(response.stats.cancel, 1);
});

test('ORIGINAL-READ-DEADLINE: late full body cannot resurrect private text or overwrite an explicit retry', async () => {
  const old = deferred(); let count = 0;
  const view = screen(({ language }) => ++count === 1 ? old.promise : reply(reference(language)));
  const result = watch(view.load()); await view.expire(); failed(view, result); assert.equal(await view.load(), true);
  const before = clone(view.snapshot()), late = reply(reference('ko')); old.resolve(late); await pump();
  assert.deepEqual(clone(view.snapshot()), before); assert.equal(late.stats.read, 0); assert.equal(late.stats.cancel, 1);
  assert.equal(view.calls.length, 2); assert.equal(view.jobs.size, 0);
});

for (const change of ['owner', 'epoch', 'work', 'bodyLocale', 'uiLocale', 'hidden', 'invalidate']) test(`ORIGINAL-READ-DEADLINE: ${change} settles old reads and fences retired callbacks`, async () => {
  const view = screen(() => new Promise(() => {})), result = watch(view.load()); await pump(); const callback = view.retired.at(-1);
  if (change === 'invalidate') view.invalidate(); else view.set(change);
  await pump(); assert.equal(result.settled, true); assert.equal(result.result, false); assert.equal(view.jobs.size, 0); assert.equal(view.snapshot().data, null);
  const before = clone(view.snapshot()); callback.fn(); await pump(); assert.deepEqual(clone(view.snapshot()), before); assert.equal(view.calls.length, 1);
});

for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) test(`ORIGINAL-READ-DEADLINE: ${locale} normal read preserves complete original and saved prose`, async () => {
  const view = screen(({ language }) => reply(reference(language)), locale); assert.equal(await view.load(), true);
  assert.deepEqual(clone(view.snapshot().data), reference(locale)); assert.equal(view.jobs.size, 0);
  assert.equal(view.snapshot().data.semanticQualityVerified, false); assert.equal(view.snapshot().data.bodySourceAligned, false);
  assert.equal(view.calls.length, 1); assert.match(view.calls[0].url, /original-reference\?locale=/);
});

for (const kind of ['auth', 'oversize', 'chunk']) test(`ORIGINAL-READ-DEADLINE: ${kind} failure does not await hanging cleanup`, async () => {
  const response = reply(null, { status: kind === 'auth' ? 401 : 200, length: kind === 'oversize' ? '999999999' : null,
    read: kind === 'chunk' ? async () => ({ done: false, value: 'not bytes' }) : undefined, cancel: () => new Promise(() => {}) });
  const view = screen(() => response), result = watch(view.load()); await pump();
  assert.equal(result.settled, true); assert.equal(result.result, false); assert.equal(view.snapshot().phase, 'error');
  assert.equal(view.snapshot().messageKey, kind === 'auth' ? 'unauthenticated' : 'invalid'); assert.equal(view.jobs.size, 0); assert.equal(response.stats.cancel, 1);
});

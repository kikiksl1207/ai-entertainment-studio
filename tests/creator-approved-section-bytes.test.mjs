import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-approved-section-bytes.js', import.meta.url), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const id = n => String(n).padStart(8, '0') + '-1111-4111-8111-' + String(n).padStart(12, '0');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const pump = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const sectionKeys = ['branch_behavior', 'canon', 'narrative_devices', 'scene_scale', 'timeline', 'visual_cast', 'visual_direction', 'writing_style'];
const authorFraming = new TextEncoder().encode(JSON.stringify({
  schemaVersion: 'creator-generation-profile-v1', kind: 'story', sections: [],
})).byteLength - 2;
function fixture(requestedWhole) {
  const sections = sectionKeys.map((key, index) => ({
    key, authorSectionBytes: 100 + index, authorValueBytes: 50 + index, approvalEvidenceEntryBytes: 40 + index,
  }));
  const diagnostic = { contract: 'story-approved-profile-section-byte-metric-v1', byteCap: 16384,
    wholeCandidateViewBytes: 0, authorDataBytes: sections.reduce((sum, row) => sum + row.authorSectionBytes, 0) + 9 + authorFraming,
    approvalEvidenceBytes: sections.reduce((sum, row) => sum + row.approvalEvidenceEntryBytes, 0) + 9,
    serverInterpretationBytes: 100, approvalPinBytes: 259, framingBytes: 114, sections,
    sectionsArrayFramingBytes: 9, authorObjectFramingBytes: authorFraming, approvalEvidenceArrayFramingBytes: 9,
    writingStyleSectionBytes: sections[7].authorSectionBytes, writingStyleValueBytes: sections[7].authorValueBytes,
    modelInputFit: 'unmeasured', semanticQualityVerified: false, dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0 };
  const outsideInterpretation = diagnostic.authorDataBytes + diagnostic.approvalEvidenceBytes + diagnostic.approvalPinBytes + diagnostic.framingBytes;
  if (requestedWhole !== undefined) diagnostic.serverInterpretationBytes = requestedWhole - outsideInterpretation;
  diagnostic.wholeCandidateViewBytes = outsideInterpretation + diagnostic.serverInterpretationBytes;
  return { contract: 'story-author-approved-section-bytes-v1', sourceScope: 'latest_owner_approved_profile_section_bytes_only',
    locale: 'ko', manuscriptVersion: 1, analysisVersion: 2, profileVersion: 3, reviewRevision: 4,
    readOnly: true, providerCalls: 0, operatingWrites: 0, dispatchAuthorized: false, semanticQualityVerified: false,
    legalAuthorization: 'not_evaluated', paidApproval: 'not_evaluated', fixedInputTokenLimit: 32768, fixedOutputTokenLimit: 8192,
    diagnostic };
}
function clock() {
  let now = 0, sequence = 0; const jobs = new Map(), records = [];
  return { jobs, records, setTimeout(fn, delay) { const key = ++sequence; const job = { key, at: now + delay, delay, fn }; jobs.set(key, job); records.push(job); return key; },
    clearTimeout(key) { jobs.delete(key); },
    async advance(amount) { const end = now + amount;
      for (;;) { const job = [...jobs.values()].filter(item => item.at <= end).sort((a, b) => a.at - b.at || a.key - b.key)[0];
        if (!job) break; now = job.at; jobs.delete(job.key); job.fn(); await pump(); }
      now = end; await pump(); } };
}
function reply(value, { status = 200, read, cancel, length = null, type = 'application/json', cache = 'private, no-store', vary = 'Authorization' } = {}) {
  let sent = false; const stats = { read: 0, cancel: 0, release: 0 };
  const stop = () => { stats.cancel++; return cancel ? cancel() : Promise.resolve(); };
  return { status, ok: status >= 200 && status < 300, stats,
    headers: { get: name => ({ 'content-type': type, 'content-length': length, 'cache-control': cache, vary })[name.toLowerCase()] ?? null },
    body: { cancel: stop, getReader: () => ({
      read() { stats.read++; if (read) return read(); if (sent) return Promise.resolve({ done: true }); sent = true;
        return Promise.resolve({ done: false, value: new TextEncoder().encode(JSON.stringify(value)) }); },
      cancel: stop, releaseLock() { stats.release++; }
    }) }, json() { throw Error('Unbounded JSON fallback'); }, text() { throw Error('Unbounded text fallback'); } };
}
function screen(handler, uiLanguage = 'ko') {
  let owner = { ownerId: id(8), epoch: 1 }, work = id(1), bodyLocale = 'ko', locale = uiLanguage, visible = true, choice = '';
  const time = clock(), calls = [], states = [];
  const vm = createContext({ window: {}, TextEncoder, TextDecoder, Uint8Array, AbortController, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout });
  runInContext(source, vm); const api = vm.window.LuminaCreatorApprovedSectionBytes;
  const controller = api.createController({
    fetch(url, options) { calls.push({ url, options }); return handler({ calls, url, options }); },
    identity: () => owner, isCurrent: value => !!owner && owner.ownerId === value.ownerId && owner.epoch === value.epoch,
    context: () => ({ workId: work, locale: bodyLocale, selectedChoiceId: choice }), locale: () => locale, visible: () => visible,
    onChange: value => states.push(clone(value))
  });
  return { ...controller, api, time, calls, states,
    set(kind) { if (kind === 'owner') owner = { ownerId: id(9), epoch: 1 }; if (kind === 'epoch') owner = { ownerId: id(8), epoch: 2 };
      if (kind === 'work') work = id(10); if (kind === 'sourceLocale') bodyLocale = 'en'; if (kind === 'uiLocale') locale = 'en';
      if (kind === 'hidden') visible = false; if (kind === 'choice') choice = id(15); if (kind === 'loggedOut') owner = null;
      if (kind === 'invalidWork') work = 'invalid'; if (kind === 'noWork') work = ''; controller.syncContext(); } };
}
function watch(promise) { const result = { settled: false, value: undefined }; promise.then(value => { result.settled = true; result.value = value; }); return result; }

test('SECTION-BYTES-UI: accepts only numeric section accounting without generation or quality authority', () => {
  const view = screen(() => reply(fixture())), parsed = view.api.parseSectionBytes(fixture());
  assert.ok(parsed); assert.equal(parsed.dispatchAuthorized, false); assert.equal(parsed.semanticQualityVerified, false);
  assert.equal(parsed.diagnostic.modelInputFit, 'unmeasured'); assert.equal(view.calls.length, 0);
});
test('SECTION-BYTES-UI: a small style section cannot turn an over-cap whole view into model fit', async () => {
  const view = screen(() => reply(fixture(20000))); assert.equal(await view.load(), true);
  const result = view.snapshot().data; assert.equal(result.diagnostic.wholeCandidateViewBytes > result.diagnostic.byteCap, true);
  assert.equal(result.diagnostic.writingStyleValueBytes < result.diagnostic.byteCap, true); assert.equal(result.diagnostic.modelInputFit, 'unmeasured');
});
test('SECTION-BYTES-UI: strict contract rejects altered caps, scope, identity, authorities, malformed numeric sums and ordered sections and unknown fields', () => {
  const view = screen(() => reply(fixture()));
  const changes = [v => { v.contract = 'other'; }, v => { v.sourceScope = 'current_choice'; }, v => { v.workId = id(1); },
    v => { v.fixedInputTokenLimit = 32769; }, v => { v.fixedOutputTokenLimit = 8193; }, v => { v.semanticQualityVerified = true; },
    v => { v.paidApproval = 'approved'; }, v => { v.operatingWrites = 1; }, v => { v.locale = 'fr'; }, v => { v.reviewRevision = 0; },
    v => { v.diagnostic.byteCap = 16385; }, v => { v.diagnostic.authorDataBytes++; }, v => { v.diagnostic.serverInterpretationBytes = -1; },
    v => { v.diagnostic.wholeCandidateViewBytes = 262145; }, v => { v.diagnostic.modelInputFit = 'within'; },
    v => { v.diagnostic.writingStyleValueBytes++; }, v => { v.diagnostic.sectionsArrayFramingBytes++; },
    v => { v.diagnostic.approvalEvidenceArrayFramingBytes++; }, v => { v.diagnostic.providerCalls = 1; },
    v => { v.diagnostic.payload = 'SYNTHETIC_PRIVATE'; }, v => { v.providerCalls = 1; }, v => { v.dispatchAuthorized = true; },
    v => { v.diagnostic.sections.pop(); }, v => { v.diagnostic.sections[1].key = v.diagnostic.sections[0].key; },
    v => { v.diagnostic.sections.reverse(); }, v => { v.diagnostic.sections[0].sourceRef = id(9); },
    v => { v.diagnostic.sections[0].authorValueBytes = v.diagnostic.sections[0].authorSectionBytes + 1; },
    v => { v.diagnostic.sections[0].authorSectionBytes = 0; }, v => { v.diagnostic.sections[0].approvalEvidenceEntryBytes = 1.5; },
    v => { v.diagnostic.sections[0].authorSectionBytes++; }, v => { v.diagnostic.authorObjectFramingBytes++; },
    v => { v.diagnostic.semanticQualityVerified = true; }, v => { v.diagnostic.dispatchAuthorized = true; }];
  for (const change of changes) { const value = fixture(); change(value); assert.equal(view.api.parseSectionBytes(value), null); }
});
test('SECTION-BYTES-UI: explicit one GET carries only work and measurement, including different UI/source languages', async () => {
  const view = screen(() => reply(fixture()), 'en'); assert.equal(view.calls.length, 0); assert.equal(await view.load(), true);
  assert.equal(view.calls.length, 1); assert.equal(view.calls[0].url, '/api/v1/me/creator-studio/stories/' + id(1) + '/generation-profile/approved-section-bytes?measurement=json-utf8-v1');
  assert.equal(view.calls[0].url.includes('locale='), false); assert.equal(view.calls[0].url.includes('choice'), false);
  assert.equal(view.calls[0].options.method, 'GET'); assert.equal(view.calls[0].options._retried, true);
  assert.equal(view.calls[0].options.cache, 'no-store'); assert.equal(view.snapshot().data.locale, 'ko'); assert.equal(view.time.jobs.size, 0);
});
test('SECTION-BYTES-UI: old click tickets and duplicate in-flight clicks perform no extra read', async () => {
  const pending = deferred(), view = screen(() => pending.promise), ticket = view.snapshot().ticket;
  const first = view.load(ticket); await pump(); assert.equal(await view.load(ticket), false); assert.equal(view.calls.length, 1);
  view.invalidate(); assert.equal(await view.load(ticket), false); pending.resolve(reply(fixture())); assert.equal(await first, false);
});
for (const kind of ['loggedOut', 'invalidWork', 'noWork', 'hidden']) {
  test('SECTION-BYTES-UI: invalid input or missing permission is refused before transport: ' + kind, async () => {
    const view = screen(() => reply(fixture())); view.set(kind); assert.equal(await view.load(), false); assert.equal(view.calls.length, 0);
  });
}
for (const kind of ['owner', 'epoch', 'work', 'sourceLocale', 'uiLocale', 'hidden', 'choice', 'loggedOut']) {
  test('SECTION-BYTES-UI: changed context clears private numeric state and settles an ignored request: ' + kind, async () => {
    const pending = deferred(); let count = 0; const view = screen(() => ++count === 1 ? reply(fixture()) : pending.promise);
    assert.equal(await view.load(), true); assert.ok(view.snapshot().data);
    const result = watch(view.load()); await pump(); assert.equal(view.snapshot().data, null);
    view.set(kind); await pump(); assert.equal(result.settled, true); assert.equal(result.value, false);
    assert.equal(view.snapshot().data, null); assert.equal(view.time.jobs.size, 0); assert.equal(view.calls.length, 2);
    pending.resolve(reply(fixture())); await pump(); assert.equal(view.snapshot().data, null);
  });
}
test('SECTION-BYTES-UI: header deadline independently ends a request whose fetch ignores abort', async () => {
  const view = screen(() => new Promise(() => {})), result = watch(view.load()); await pump();
  assert.equal(view.time.jobs.size, 1); await view.time.advance(30000);
  assert.equal(result.settled, true); assert.equal(result.value, false); assert.equal(view.snapshot().phase, 'error');
  assert.equal(view.snapshot().data, null); assert.equal(view.snapshot().canLoad, true); assert.equal(view.calls.length, 1); assert.equal(view.time.jobs.size, 0);
});
test('SECTION-BYTES-UI: body/cancel stalls share the same whole-request deadline', async () => {
  const headers = deferred(), body = reply(fixture(), { read: () => new Promise(() => {}), cancel: () => new Promise(() => {}) });
  const view = screen(() => headers.promise), result = watch(view.load()); await pump(); await view.time.advance(29999);
  headers.resolve(body); await pump(); assert.equal(view.time.jobs.size, 1); await view.time.advance(1);
  assert.equal(view.time.records.length, 1); assert.equal(view.time.records[0].delay, 30000);
  assert.equal(result.settled, true); assert.equal(result.value, false); assert.equal(view.snapshot().data, null);
  assert.equal(view.time.jobs.size, 0); assert.equal(view.calls.length, 1); assert.ok(body.stats.cancel >= 1);
});
test('SECTION-BYTES-UI: a retired timer cannot erase a later successful explicit read', async () => {
  const pending = deferred(); let count = 0; const view = screen(() => ++count === 1 ? pending.promise : reply(fixture()));
  const first = view.load(); await pump(); const staleTimer = view.time.records[0]; view.invalidate(); assert.equal(await first, false);
  assert.equal(await view.load(), true); staleTimer.fn(); pending.resolve(reply(fixture())); await pump();
  assert.ok(view.snapshot().data); assert.equal(view.time.jobs.size, 0); assert.equal(view.calls.length, 2);
});
for (const options of [{ status: 401 }, { status: 409 }, { status: 503 }, { type: 'text/html' }, { cache: 'public' }, { vary: '' }, { length: '8193' }]) {
  test('SECTION-BYTES-UI: invalid or failed response never keeps private values or retries: ' + JSON.stringify(options), async () => {
    const response = reply(fixture(), options), view = screen(() => response);
    assert.equal(await view.load(), false); assert.equal(view.snapshot().data, null); assert.equal(view.snapshot().phase, 'error');
    assert.equal(view.calls.length, 1); assert.equal(view.time.jobs.size, 0);
  });
}
test('SECTION-BYTES-UI: streamed oversized body is refused without an unbounded fallback', async () => {
  let sent = false; const response = reply(null, { read: () => Promise.resolve(sent ? { done: true }
    : (sent = true, { done: false, value: new Uint8Array(8193) })) });
  const view = screen(() => response); assert.equal(await view.load(), false); assert.equal(view.snapshot().data, null); assert.ok(response.stats.cancel >= 1);
});
test('SECTION-BYTES-UI: explicit manual retry works after a failure and uses a fresh timer', async () => {
  let count = 0; const view = screen(() => ++count === 1 ? reply(null, { status: 503 }) : reply(fixture()));
  assert.equal(await view.load(), false); assert.equal(await view.load(), true); assert.equal(view.calls.length, 2); assert.equal(view.time.jobs.size, 0);
});

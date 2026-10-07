import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { approvalState, bodyReview, clone, deferred, id, library, locales, mounted, permissionFlags,
  preparation, preview, privateMarker, projected, response, screen, source, sourceSha, previewSha, target, withheld
} from './support/creator-body-source-read-20261007.mjs';

const outcomes = [];
async function check(name, body) {
  await test(name, async () => {
    try { await body(); outcomes.push({ name, passed: true }); }
    catch (error) {
      outcomes.push({ name, passed: false, error: { name: error.name, message: error.message, stack: error.stack } });
      throw error;
    }
  });
}
const invalid = fn => assert.throws(fn, error => error.kind === 'invalid' && !error.message.includes(privateMarker));
const sourceCalls = view => view.calls.filter(call => call.kind === 'source');
const stableTrial = state => ({ data: state.data, messageKey: state.messageKey, canChoose: state.canChoose,
  canRecordRead: state.canRecordRead, unresolved: state.unresolved, receipt: state.receipt });
const noEffects = view => assert.deepEqual(view.effects, { storage: 0, timer: 0, network: 0, key: 0, auth: 0, dispatch: 0 });
const parser = () => library().api.parseSourcePreparation;

if (process.env.CREATOR_BODY_SOURCE_READ_MODE === 'baseline') {
  await check('frozen baseline lacks source inspection; explicit load still performs exactly two GETs', async () => {
    const view = screen();
    assert.equal(view.api.parseSourcePreparation, undefined); assert.equal(view.inspectSource, undefined);
    assert.equal(Object.hasOwn(view.snapshot(), 'sourceInspection'), false);
    assert.equal(Object.hasOwn(view.snapshot(), 'canInspectSource'), false);
    assert.equal(view.calls.length, 0); assert.equal(await view.load(), true);
    assert.deepEqual(view.calls.map(call => [call.kind, call.options.method]), [['state', 'GET'], ['preview', 'GET']]);
    assert.equal(view.snapshot().canChoose, true); assert.equal(sourceCalls(view).length, 0); noEffects(view);
  });
} else {
  await check('source API starts idle without automatic requests, storage, timers or key minting', async () => {
    const view = screen();
    assert.equal(typeof view.api.parseSourcePreparation, 'function'); assert.equal(typeof view.inspectSource, 'function');
    assert.equal(view.snapshot().sourceInspection, null); assert.equal(view.snapshot().canInspectSource, false);
    assert.equal(await view.inspectSource(), false);
    for (let index = 0; index < 3; index++) { view.syncContext(); view.snapshot(); view.invalidate(); }
    assert.equal(view.calls.length, 0); noEffects(view);
    const controller = source.slice(source.indexOf('  function createController('), source.indexOf('  function mount('));
    assert.doesNotMatch(controller, /setTimeout|setInterval|sendBeacon|\/approve|\/payments/);
  });

  await check('unchanged load is two GETs; explicit source GET preserves trial and snapshots are isolated', async () => {
    const view = screen(); assert.equal(await view.load(), true);
    assert.deepEqual(view.calls.map(call => call.url), [`/api/v1/me/creator-studio/stories/${id(1)}/body-trial-state`,
      `/api/v1/me/creator-studio/stories/${id(1)}/body-preview?locale=en`]);
    const before = stableTrial(view.snapshot()); assert.equal(view.snapshot().canInspectSource, true);
    assert.equal(await view.inspectSource(view.snapshot().ticket), true);
    const call = sourceCalls(view)[0]; assert.equal(sourceCalls(view).length, 1);
    assert.equal(call.url, `/api/v1/me/creator-studio/stories/${id(1)}/body-review/memory-preparation?locale=en`);
    assert.equal(call.options.method, 'GET'); assert.equal(call.options.body, undefined);
    assert.equal(call.options._retried, false); assert.equal(call.options.cache, 'no-store');
    assert.deepEqual(clone(call.options.identity), { ownerId: id(8), epoch: 1 });
    assert.equal(call.options.headers['Cache-Control'], 'no-store'); assert.ok(call.options.signal);
    assert.deepEqual(stableTrial(view.snapshot()), before);
    assert.deepEqual(clone(view.snapshot().sourceInspection), { phase: 'ready', data: projected(), messageKey: null });
    const external = view.snapshot(); external.sourceInspection.data.bodyReview.decision = 'reject';
    external.data.preview.progress.scene.beats[0].content = 'mutated';
    assert.deepEqual(stableTrial(view.snapshot()), before); assert.equal(view.snapshot().sourceInspection.data.bodyReview.decision, 'approve');
    view.snapshot(); view.syncContext(); assert.equal(view.calls.length, 3); noEffects(view);
  });

  await check('valid human and company projections in five locales discard IDs, hashes, checks and unknown private text', () => {
    const parse = parser();
    for (const locale of locales) for (const basis of ['human_review', 'company_delegation']) {
      const value = preparation(locale); value.latestBodyReview = bodyReview(locale, basis);
      value.privateText = privateMarker; value.sourcePins.privatePayload = privateMarker;
      value.latestBodyReview.privateAuthor = privateMarker; value.participantReference.currentChatIdentity = privateMarker;
      const result = clone(parse(value, target(locale), preview(id(1), locale)));
      assert.deepEqual(result, projected(value.latestBodyReview));
      assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SOURCE_PRIVATE|sourcePins|participant|Reviewed|Hash|Checksum|generation|Memory|Claimed/);
      for (const key of permissionFlags) assert.equal(Object.hasOwn(result, key), false);
    }
    const value = preparation(); value.latestBodyReview = null;
    assert.deepEqual(clone(parse(value, target(), preview())), projected(null));
  });

  await check('contract, readOnly, eight false permissions and work/locale boundaries reject unsafe envelopes', () => {
    const parse = parser(), mutations = [value => { value.contract = 'other'; }, value => { value.readOnly = false; },
      value => { value.workId = id(99); }, value => { value.locale = 'ko'; }, value => { value.state = 'approved'; },
      value => { value.bodyReviewable = false; }];
    for (const key of permissionFlags) for (const flag of [true, null, 0, 'false', undefined]) mutations.push(value => { value[key] = flag; });
    for (const mutate of mutations) { const value = preparation(); mutate(value); invalid(() => parse(value, target(), preview())); }
    for (const value of [null, [], '', false, {}]) invalid(() => parse(value, target(), preview()));
  });

  await check('malformed target scope yields invalid without raw diagnostics', () => {
    const parse = parser();
    for (const scope of [null, undefined, [], false, {}, { workId: privateMarker, locale: 'en' },
      { workId: id(1), locale: privateMarker }, { workId: id(1), locale: 'EN' }]) {
      invalid(() => parse(preparation(), scope, preview()));
    }
  });

  await check('malformed source pins and latest body-review projections reject without inventing authority', () => {
    const parse = parser();
    const mutations = [v => { v.target = null; }, v => { v.sourcePins = []; },
      ...['progressId', 'sceneId'].map(key => v => { v.target[key] = 'bad'; }),
      ...['sourceBindingHash', 'bodyChecksum'].map(key => v => { v.target[key] = 'A'.repeat(64); }),
      v => { v.target.progressRevision = 0; }, v => { v.target.ending = 'false'; },
      v => { v.sourcePins.releaseVersion = 0; }, v => { v.sourcePins.releaseRevision = -1; },
      ...['releaseId', 'manuscriptVersionId'].map(key => v => { v.sourcePins[key] = 'bad'; }),
      ...['releaseChecksum', 'manuscriptHash'].map(key => v => { v.sourcePins[key] = 'bad'; }),
      v => { v.latestBodyReview = undefined; }, v => { v.latestBodyReview = []; },
      ...Object.entries({ id: 'bad', locale: 'xx', version: 0, decision: 'approved', approvalBasis: 'bot', applicability: 'approved',
        styleReviewed: 'true', charactersReviewed: null, timelineReviewed: 1 }).map(([key, value]) => v => { v.latestBodyReview[key] = value; }),
      v => { v.latestBodyReview.locale = 'ko'; }];
    for (const mutate of mutations) { const value = preparation(); mutate(value); invalid(() => parse(value, target(), preview())); }
    for (const key of ['styleReviewed', 'charactersReviewed', 'timelineReviewed']) {
      const value = preparation(); value.latestBodyReview = bodyReview('en', 'company_delegation'); value.latestBodyReview[key] = true;
      invalid(() => parse(value, target(), preview()));
    }
    for (const applicability of ['stale', 'withdrawn', 'superseded']) {
      const value = preparation(); value.latestBodyReview.applicability = applicability; value.latestBodyReview.locale = 'ko';
      assert.deepEqual(clone(parse(value, target(), preview())), projected(value.latestBodyReview));
    }
  });

  await check('old preview IDs/revision/scene/publication/locale/generated state withhold all source proof', () => {
    const parse = parser();
    const mutations = [v => { v.workId = id(99); }, v => { v.locale = 'ko'; }, v => { v.progress = null; },
      v => { v.progress.progressId = id(99); }, v => { v.progress.revision++; }, v => { v.progress.scene.id = id(99); },
      v => { v.progress.storyVersion++; }, v => { v.progress.scene.isGenerated = false; }, v => { v.progress.scene.endingType = 'ai_generated'; }];
    for (const mutate of mutations) { const value = preview(); mutate(value);
      assert.deepEqual(clone(parse(preparation(), target(), value)), withheld('source_changed')); }
    assert.deepEqual(clone(parse(preparation(), target(), null)), withheld('source_changed'));
    const value = preparation(); value.sourcePins.releaseVersion++;
    assert.deepEqual(clone(parse(value, target(), preview())), withheld('source_changed'));
  });

  await check('nonreviewable states require null pins; generated ending matches without new memory/event approval', () => {
    const parse = parser();
    for (const state of ['source_changed', 'not_generated', 'generation_pending']) {
      const value = { ...preparation(), state, bodyReviewable: false, target: null, sourcePins: null, participantReference: null };
      assert.deepEqual(clone(parse(value, target(), preview())), withheld(state));
      for (const key of ['target', 'sourcePins', 'participantReference']) {
        const malformed = clone(value); malformed[key] = {}; invalid(() => parse(malformed, target(), preview()));
      }
    }
    const value = preparation(), body = preview(); value.target.ending = true;
    body.progress.status = 'completed'; body.progress.scene.endingType = 'ai_generated'; body.progress.choices = [];
    assert.deepEqual(clone(parse(value, target(), body)), projected());
  });

  await check('older ticket cannot inspect; pending duplicate blocks source/load/choice/read until one GET settles', async () => {
    const pending = deferred(); const view = screen(call => call.kind === 'source' ? pending.promise : call.reply());
    const old = view.snapshot().ticket; await view.load(); const before = stableTrial(view.snapshot());
    assert.equal(await view.inspectSource(old), false); assert.equal(sourceCalls(view).length, 0);
    const request = view.inspectSource(view.snapshot().ticket);
    assert.equal(view.snapshot().sourceInspection.phase, 'loading'); assert.equal(view.snapshot().busy, true);
    assert.equal(await view.inspectSource(), false); assert.equal(await view.load(), false);
    assert.equal(await view.choose(id(5)), false); assert.equal(await view.recordRead(), false);
    assert.equal(sourceCalls(view).length, 1); pending.resolve(response(preparation())); assert.equal(await request, true);
    assert.deepEqual(stableTrial(view.snapshot()), before); noEffects(view);
  });

  await check('expired or absent approval allows read-only source checks without enabling old trial capabilities', async () => {
    for (const absent of [false, true]) {
      const view = screen(call => { if (call.kind !== 'state') return call.reply(); const state = approvalState();
        if (absent) { state.state = 'approval_required'; state.approval = null; state.budget = null; }
        else { state.state = 'approval_expired'; state.approval.expiresAt = '2000-01-01T00:00:00.000Z'; }
        return response(state); });
      await view.load(); const before = stableTrial(view.snapshot());
      assert.equal(view.snapshot().canInspectSource, true); assert.equal(view.snapshot().canChoose, false);
      assert.equal(view.snapshot().canRecordRead, false); assert.equal(await view.inspectSource(), true);
      assert.deepEqual(stableTrial(view.snapshot()), before); assert.equal(await view.choose(id(5)), false); noEffects(view);
    }
  });

  await check('context and actor changes cancel pending source, clear proof and discard late success', async () => {
    const changes = [view => view.set.owner({ ownerId: id(9), epoch: 1 }), view => view.set.owner({ ownerId: id(8), epoch: 2 }),
      view => view.set.work(id(99)), view => view.set.locale('ko'), view => view.set.language('ja'),
      view => view.set.shown(false), view => view.set.authorized(false)];
    for (const change of changes) {
      const pending = deferred(); let cancelled = 0;
      const view = screen(call => call.kind === 'source' ? pending.promise : call.reply()); await view.load();
      const request = view.inspectSource(); const signal = sourceCalls(view)[0].options.signal;
      change(view); view.syncContext(); assert.equal(signal.aborted, true); assert.equal(view.snapshot().sourceInspection, null);
      pending.resolve(response(preparation(), 200, { body: { cancel: async () => { cancelled++; } } }));
      assert.equal(await request, false); assert.equal(cancelled, 1); assert.equal(view.snapshot().data, null);
      assert.equal(view.snapshot().sourceInspection, null); assert.equal(sourceCalls(view).length, 1); noEffects(view);
    }
  });

  await check('HTTP, transport, invalid JSON, oversized and permission errors preserve old body/message/choices', async () => {
    const cases = [[400, 'invalid'], [401, 'unauthenticated'], [403, 'forbidden'], [404, 'notFound'], [409, 'conflict'], [500, 'server']]
      .map(([status, kind]) => ({ kind, reply: () => response({ privateDetail: privateMarker }, status) }));
    cases.push({ kind: 'transport', reply: () => { throw new Error(privateMarker); } },
      { kind: 'invalid', reply: () => response(null, 200, { text: async () => privateMarker }) },
      { kind: 'invalid', reply: () => response(preparation(), 200, { headers: { get: () => '16385' } }) },
      { kind: 'invalid', reply: () => response({ ...preparation(), readerMemoryApplied: true }) });
    for (const entry of cases) {
      const view = screen(call => call.kind === 'source' ? entry.reply() : call.reply()); await view.load();
      const before = stableTrial(view.snapshot()); assert.equal(await view.inspectSource(), false);
      assert.deepEqual(clone(view.snapshot().sourceInspection), { phase: 'error', data: null, messageKey: entry.kind });
      assert.deepEqual(stableTrial(view.snapshot()), before); assert.equal(view.snapshot().canInspectSource, true);
      assert.doesNotMatch(JSON.stringify(view.snapshot()), /SYNTHETIC_SOURCE_PRIVATE/); assert.equal(view.calls.length, 3); noEffects(view);
    }
  });

  await check('new explicit load clears source proof; saved-scene absence forbids a source request', async () => {
    const view = screen(); await view.load(); await view.inspectSource();
    const before = view.calls.length; assert.equal(await view.load(), true);
    assert.equal(view.snapshot().sourceInspection, null); assert.equal(view.calls.length, before + 2);
    assert.equal(sourceCalls(view).length, 1); noEffects(view);
    const empty = screen(call => { if (call.kind !== 'preview') return call.reply(); const value = preview();
      value.progress.scene = null; value.progress.choices = []; return response(value); });
    await empty.load(); assert.equal(empty.snapshot().canInspectSource, false); assert.equal(await empty.inspectSource(), false);
    assert.equal(empty.calls.length, 2); noEffects(empty);
  });

  await check('actual old choice/read dispatch clears source proof and retains each existing command body', async () => {
    for (const reading of [false, true]) {
      const pending = deferred(); let dispatchProof;
      let view;
      view = screen(call => {
        if (call.kind === 'preview' && reading) { const value = preview(); value.progress.currentBeatPosition = 0; return response(value); }
        if (call.kind === 'choice' || call.kind === 'read') { dispatchProof = view.snapshot().sourceInspection; return pending.promise; }
        return call.reply();
      });
      await view.load(); await view.inspectSource(); const state = view.snapshot();
      const request = reading ? view.recordRead(state.ticket) : view.choose(id(5), state.ticket);
      assert.equal(view.snapshot().sourceInspection, null); assert.equal(dispatchProof, null);
      const post = view.calls.at(-1); assert.equal(post.options.method, 'POST');
      assert.deepEqual(JSON.parse(post.options.body), { approvalId: id(7), progressId: id(2), expectedRevision: 7, locale: 'en' });
      assert.equal(view.effects.dispatch, 1); assert.equal(view.effects.key, 1);
      pending.resolve(response({}, 403)); assert.equal(await request, false); assert.equal(sourceCalls(view).length, 1);
      assert.equal(view.snapshot().sourceInspection, null);
    }
  });

  await check('actual Info icon click alone sends source GET; five locales distinguish company from author review', async () => {
    const titles = ['\ubcf8\ubb38 \ucd9c\ucc98 \ud655\uc778', 'Check text source', '\u672c\u6587\u306e\u51fa\u5178\u3092\u78ba\u8a8d',
      '\u786e\u8ba4\u6b63\u6587\u6765\u6e90', '\u78ba\u8a8d\u6b63\u6587\u4f86\u6e90'];
    for (const [index, locale] of locales.entries()) {
      const value = preparation(locale); value.latestBodyReview = bodyReview(locale, 'company_delegation');
      const view = mounted(locale, value), icon = view.element('writerBodyTrialSourceInspect');
      assert.equal(view.calls.length, 0); assert.equal(icon.disabled, true); assert.equal(icon.title, titles[index]);
      assert.equal(icon.getAttribute('aria-label'), titles[index]); assert.equal(icon.children[0].getAttribute('aria-hidden'), 'true');
      await view.element('writerBodyTrialRefresh').click(); assert.equal(view.calls.length, 2); assert.equal(icon.disabled, false);
      const storageBefore = { ...view.storage }; await icon.click(); assert.equal(view.calls.length, 3);
      assert.ok(view.calls.at(-1).url.endsWith(`/memory-preparation?locale=${locale}`));
      assert.deepEqual(view.storage, storageBefore); assert.equal(view.storage.writes, 0); noEffects(view);
      const panel = view.element('writerBodyTrialSourceStatus'); assert.ok(panel.textContent.length > 0);
      if (locale === 'en') { assert.match(panel.textContent, /Company-delegated approval/); assert.doesNotMatch(panel.textContent, /Author-reviewed approval/); }
      assert.match(view.host.textContent, /Saved body/); assert.equal(view.controller.snapshot().canChoose, true);
    }
  });

  await check('source_changed/error/noncurrent render never labels current approval and preserves body/choice policy', async () => {
    const values = ['source_changed', 'not_generated', 'generation_pending'].map(state => ({ ...preparation(), state,
      bodyReviewable: false, target: null, sourcePins: null, participantReference: null }));
    values.push({ ...preparation(), generatedEventApprovalSupported: true });
    for (const applicability of ['withdrawn', 'stale', 'superseded']) {
      const value = preparation(); value.latestBodyReview.applicability = applicability; values.push(value);
    }
    const rejected = preparation(); rejected.latestBodyReview.decision = 'reject'; values.push(rejected);
    for (const value of values) {
      const view = mounted('en', value); await view.element('writerBodyTrialRefresh').click();
      const before = stableTrial(view.controller.snapshot()); await view.element('writerBodyTrialSourceInspect').click();
      assert.deepEqual(stableTrial(view.controller.snapshot()), before);
      assert.doesNotMatch(view.element('writerBodyTrialSourceStatus').textContent, /Author-reviewed approval|Company-delegated approval/);
      assert.match(view.host.textContent, /Saved body/); assert.equal(view.calls.length, 3); noEffects(view);
    }
  });

  await check('human approval requires all three review checks while rejection keeps its existing boundary', () => {
    const parse = parser(), checks = ['styleReviewed', 'charactersReviewed', 'timelineReviewed'];
    const approved = preparation();
    assert.deepEqual(clone(parse(approved, target(), preview())), projected(approved.latestBodyReview));
    for (const key of checks) {
      const missing = preparation(); delete missing.latestBodyReview[key];
      invalid(() => parse(missing, target(), preview()));
      const unchecked = preparation(); unchecked.latestBodyReview[key] = false;
      invalid(() => parse(unchecked, target(), preview()));
    }
    const unchecked = preparation();
    for (const key of checks) unchecked.latestBodyReview[key] = false;
    invalid(() => parse(unchecked, target(), preview()));
    const rejected = clone(unchecked); rejected.latestBodyReview.decision = 'reject';
    assert.deepEqual(clone(parse(rejected, target(), preview())), projected(rejected.latestBodyReview));
    const delegated = preparation(); delegated.latestBodyReview = bodyReview('en', 'company_delegation');
    assert.deepEqual(clone(parse(delegated, target(), preview())), projected(delegated.latestBodyReview));
  });
}

// Written directly after awaited test bodies; the launcher separately records the final OS child status.
if (process.env.CREATOR_BODY_SOURCE_READ_EVIDENCE) {
  writeFileSync(process.env.CREATOR_BODY_SOURCE_READ_EVIDENCE, JSON.stringify({ schema: 'owner-source-read-unit-v1',
    pid: process.pid, mode: process.env.CREATOR_BODY_SOURCE_READ_MODE || 'fixed', moduleCompleted: true,
    sourceSha, previewSha, count: outcomes.length, passed: outcomes.filter(item => item.passed).length,
    failed: outcomes.filter(item => !item.passed).length, outcomes }, null, 2), { flag: 'wx' });
}

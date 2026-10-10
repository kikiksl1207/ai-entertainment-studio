import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, makeJob, makeGenerationResponse, response, deferred, ids } from './creator-analysis-review.test-support.mjs';

// The full analysis IIFE runs in the existing synthetic DOM/API harness, not a browser or live account.
const profilePath = `/api/v1/me/creator-studio/stories/${ids.work}/generation-profile`;
const prefix = 'GENERATION-PROFILE-READ-CURRENT';
const method = call => call.options.method || 'GET';
const reads = view => view.screen.calls.filter(call => call.path === profilePath && method(call) === 'GET');
const writes = view => view.screen.calls.filter(call => method(call) !== 'GET');

function profile(marker) {
  const value = makeGenerationResponse();
  for (const section of value.profile.draftSettings.sections) section.value.summary = `${marker}: ${section.key} synthetic settings`;
  return value;
}

function heldRead(phase = 'fetch') {
  const entered = deferred(), jsonEntered = deferred(), result = deferred();
  return {
    entered: entered.promise,
    jsonEntered: jsonEntered.promise,
    answer(call) {
      entered.resolve(call);
      if (phase === 'fetch') return result.promise;
      return { ok: true, status: 200, json: () => { jsonEntered.resolve(); return result.promise; } };
    },
    finish(value) { result.resolve(phase === 'fetch' ? response(value) : structuredClone(value)); },
    fail() { result.reject(new Error('SYNTHETIC_PROFILE_READ_FAILED')); }
  };
}

async function boot(plans, { initial = profile('INITIAL'), write } = {}) {
  const unexpected = [];
  let readIndex = 0;
  const screen = createHarness({ receipt: false, job: makeJob(), generationProfile: initial,
    handler: (call, route) => {
      if (call.path === profilePath && method(call) === 'GET') {
        const plan = plans[readIndex++];
        if (plan) return plan(call);
      } else if (write && ((call.path === profilePath && method(call) === 'PATCH') ||
          (call.path === profilePath + '/approve' && method(call) === 'POST'))) {
        return write(call, route);
      } else if (method(call) === 'GET') {
        const target = new URL(call.path, 'https://fixture.invalid');
        if ([`/api/v1/me/creator-studio/stories/${ids.work}/manuscripts`,
          `/api/v1/me/creator-studio/manuscripts/${ids.manuscript}/analyses`,
          `/api/v1/me/creator-studio/analyses/${ids.job}`].includes(target.pathname)) return route(call.path, call.options);
      }
      unexpected.push({ path: call.path, method: method(call) });
      throw new Error('UNEXPECTED_SYNTHETIC_ROUTE');
    } });
  assert.equal(screen.calls.length, 0);
  await screen.elements.writerAnalysisRestore.fire();
  await screen.flush();
  assert.deepEqual(structuredClone(screen.window.LuminaCreatorAnalysis.completed()), {
    manuscriptVersionId: ids.manuscript, workId: ids.work, analysisJobId: ids.job,
    identity: { ownerId: 'fixture-owner', epoch: 1 }
  });
  assert.equal(screen.elements.writerGenerationEntry.hidden, false);
  const view = { screen, unexpected };
  assert.equal(reads(view).length, 1, 'completed analysis must reach the actual first profile GET');
  const first = reads(view)[0];
  assert.deepEqual(structuredClone(first.options.identity), { ownerId: 'fixture-owner', epoch: 1 });
  assert.equal(first.options.signal.aborted, false);
  return view;
}

function open(view) {
  assert.equal(view.screen.elements.writerGenerationEntry.hidden, false);
  const button = view.screen.elements.writerGenerationReviewOpen;
  assert.equal(button.disabled, false);
  return button.fire();
}

function snapshot(view) {
  const elements = view.screen.elements;
  return {
    entryHidden: elements.writerGenerationEntry.hidden,
    modalHidden: elements.writerGenerationModal.classList.contains('is-hidden'),
    entryState: elements.writerGenerationReviewState.textContent,
    title: elements.writerGenerationTitle.textContent,
    status: elements.writerGenerationStatus.textContent,
    saveDisabled: elements.writerGenerationSave.disabled,
    approveDisabled: elements.writerGenerationApprove.disabled,
    sections: elements.writerGenerationSections.children.map(article => ({
      key: article.dataset.key,
      summary: article.querySelector('.writer-generation-summary').value,
      disabled: article.querySelector('.writer-generation-summary').disabled,
      text: article.textContent
    }))
  };
}

function assertDraft(view, value) {
  const state = snapshot(view), sections = value.profile.draftSettings.sections;
  assert.equal(state.entryHidden, false);
  assert.equal(state.modalHidden, false);
  assert.equal(state.saveDisabled, false);
  assert.equal(state.approveDisabled, false);
  assert.deepEqual(state.sections.map(section => section.key), sections.map(section => section.key));
  for (const section of sections) {
    const actual = state.sections.find(row => row.key === section.key);
    assert.equal(actual.summary, section.value.summary);
    assert.equal(actual.disabled, false);
    assert.match(actual.text, /Original analysis evidence\./);
  }
}

function assertReadOnly(view) {
  assert.deepEqual(view.unexpected, []);
  assert.deepEqual(writes(view), []);
  assert.equal(view.screen.calls.some(call => /\/approve$|\/recover-profile$|\/paste$/.test(call.path)), false);
}

async function changeLanguage(view, locale) {
  view.screen.setLocale(locale);
  await view.screen.flush();
}

test(`${prefix}-RED: first GET cancelled by display locale permits exactly one manual current GET`, async () => {
  const old = heldRead(), current = profile('CURRENT');
  const view = await boot([call => old.answer(call), () => response(current)]);
  const call = await old.entered;
  await changeLanguage(view, 'ko-KR');
  assert.equal(call.options.signal.aborted, true);
  assert.equal(reads(view).length, 1, 'locale change must not schedule another profile GET');
  old.finish(profile('OLD'));
  await view.screen.flush();
  assert.equal(snapshot(view).modalHidden, true);
  assert.equal(snapshot(view).sections.length, 0);
  await open(view); await view.screen.flush();
  assert.equal(reads(view).length, 2, 'one explicit current profile GET required after locale cancellation');
  assertDraft(view, current);
  assertReadOnly(view);
});

test(`${prefix}: normal first GET renders the unchanged draft and reopening performs no read or write`, async () => {
  const value = profile('NORMAL'), before = structuredClone(value);
  const view = await boot([() => response(value)], { initial: value });
  assertDraft(view, value);
  await view.screen.elements.writerGenerationClose.fire();
  await open(view); await view.screen.flush();
  assertDraft(view, value);
  assert.equal(reads(view).length, 1);
  assert.deepEqual(value, before);
  assertReadOnly(view);
});

for (const phase of ['fetch', 'json']) {
  for (const outcome of ['success', 'failure']) {
    test(`${prefix}: late old ${phase} ${outcome} cannot replace a newer manual read`, async () => {
      const old = heldRead(phase), current = profile('NEWER');
      const view = await boot([call => old.answer(call), () => response(current)]);
      const call = await old.entered;
      if (phase === 'json') await old.jsonEntered;
      await changeLanguage(view, 'ja-JP');
      assert.equal(call.options.signal.aborted, true);
      assert.equal(reads(view).length, 1);
      await open(view); await view.screen.flush();
      assert.equal(reads(view).length, 2);
      assertDraft(view, current);
      const before = snapshot(view);
      if (outcome === 'success') old.finish(profile('OLD')); else old.fail();
      await view.screen.flush();
      assert.deepEqual(snapshot(view), before);
      assert.equal(reads(view).length, 2);
      assertReadOnly(view);
    });
  }
}

for (const outcome of ['success', 'failure']) {
  test(`${prefix}: old ${outcome} finally cannot unlock a pending newer read`, async () => {
    const old = heldRead(), newer = heldRead(), current = profile('BUSY_CURRENT');
    const view = await boot([call => old.answer(call), call => newer.answer(call)]);
    await changeLanguage(view, 'zh-CN');
    assert.equal(reads(view).length, 1);
    const pending = open(view); await view.screen.flush();
    const call = await newer.entered;
    assert.equal(reads(view).length, 2);
    assert.equal(call.options.signal.aborted, false);
    const before = snapshot(view);
    if (outcome === 'success') old.finish(profile('OLD')); else old.fail();
    await view.screen.flush();
    assert.deepEqual(snapshot(view), before);
    await open(view); await view.screen.flush();
    assert.equal(reads(view).length, 2, 'duplicate open must not escape the newer read lock');
    newer.finish(current); await pending; await view.screen.flush();
    assertDraft(view, current);
    assertReadOnly(view);
  });
}

test(`${prefix}: consecutive locale changes retain only the latest manual read ownership`, async () => {
  const first = heldRead(), second = heldRead('json'), third = heldRead(), current = profile('LATEST');
  const view = await boot([call => first.answer(call), call => second.answer(call), call => third.answer(call)]);
  const firstCall = await first.entered;
  await changeLanguage(view, 'ja-JP');
  const secondTask = open(view); await view.screen.flush();
  const secondCall = await second.entered; await second.jsonEntered;
  await changeLanguage(view, 'zh-TW');
  assert.equal(firstCall.options.signal.aborted, true);
  assert.equal(secondCall.options.signal.aborted, true);
  assert.equal(reads(view).length, 2, 'neither locale change may start an automatic profile GET');
  const thirdTask = open(view); await view.screen.flush();
  const thirdCall = await third.entered;
  assert.equal(reads(view).length, 3);
  const before = snapshot(view);
  first.finish(profile('FIRST')); second.fail(); await secondTask; await view.screen.flush();
  assert.deepEqual(snapshot(view), before);
  assert.equal(thirdCall.options.signal.aborted, false);
  await open(view); await view.screen.flush();
  assert.equal(reads(view).length, 3);
  third.finish(current); await thirdTask; await view.screen.flush();
  assertDraft(view, current);
  assertReadOnly(view);
});

for (const [name, change] of [
  ['work', screen => screen.setContext({ workId: ids.job })],
  ['account', screen => screen.setIdentity({ ownerId: 'other-fixture-owner', epoch: 2 })],
  ['source locale', screen => screen.setContext({ sourceLocale: 'ja' })]
]) {
  test(`${prefix}: ${name} invalidation erases the profile and rejects its late JSON`, async () => {
    const old = heldRead('json'), view = await boot([call => old.answer(call)]);
    const call = await old.entered; await old.jsonEntered;
    change(view.screen); view.screen.tickIdentity(); await view.screen.flush();
    assert.equal(call.options.signal.aborted, true);
    assert.equal(view.screen.window.LuminaCreatorAnalysis.completed(), null);
    assert.equal(snapshot(view).entryHidden, true);
    assert.equal(snapshot(view).modalHidden, true);
    assert.equal(snapshot(view).sections.length, 0);
    const before = snapshot(view);
    old.finish(profile('OLD_SCOPE')); await view.screen.flush();
    assert.deepEqual(snapshot(view), before);
    // A retained bound listener is not a physical click and cannot bypass invalidation.
    await view.screen.elements.writerGenerationReviewOpen.fire(); await view.screen.flush();
    assert.equal(reads(view).length, 1);
    assertReadOnly(view);
  });
}

for (const [name, failed] of [
  ['HTTP 503', () => response({ error: { code: 'SYNTHETIC_UNAVAILABLE' } }, 503)],
  ['transport', () => { throw new Error('SYNTHETIC_TRANSPORT_FAILURE'); }],
  ['JSON', () => ({ ok: true, status: 200, json: async () => { throw new Error('SYNTHETIC_JSON_FAILURE'); } })]
]) {
  test(`${prefix}: current ${name} failure permits only an explicit fresh read`, async () => {
    const current = profile('RETRY_READ'), view = await boot([failed, () => response(current)]);
    assert.equal(reads(view).length, 1);
    assert.equal(snapshot(view).modalHidden, true);
    assert.equal(snapshot(view).sections.length, 0);
    assert.ok(snapshot(view).entryState);
    const before = snapshot(view);
    await view.screen.flush();
    assert.deepEqual(snapshot(view), before);
    assert.equal(reads(view).length, 1);
    await open(view); await view.screen.flush();
    assert.equal(reads(view).length, 2);
    assertDraft(view, current);
    assertReadOnly(view);
  });
}

test(`${prefix}: locale cancellation of a pending PATCH cannot resend or continue approval`, async () => {
  const initial = profile('WRITE_DRAFT'), gate = deferred(), entered = deferred();
  const view = await boot([() => response(initial)], { initial, write: call => {
    assert.equal(call.path, profilePath); assert.equal(method(call), 'PATCH');
    entered.resolve(call); return gate.promise;
  } });
  assertDraft(view, initial);
  const pending = view.screen.elements.writerGenerationApprove.fire();
  const call = await entered.promise;
  assert.deepEqual(JSON.parse(call.options.body), { settings: initial.profile.draftSettings });
  await changeLanguage(view, 'ja-JP');
  assert.equal(call.options.signal.aborted, true);
  const before = snapshot(view);
  await view.screen.elements.writerGenerationSave.fire();
  await view.screen.elements.writerGenerationApprove.fire();
  await open(view); await view.screen.flush();
  assert.equal(writes(view).length, 1);
  assert.equal(reads(view).length, 1);
  gate.resolve(response(initial)); await pending; await view.screen.flush();
  assert.deepEqual(snapshot(view), before);
  assert.equal(writes(view).length, 1);
  assert.equal(view.screen.calls.some(value => value.path.endsWith('/approve')), false);
  assert.deepEqual(view.unexpected, []);
});

test(`${prefix}: locale cancellation of an explicit approval cannot resend or apply its late response`, async () => {
  const initial = profile('APPROVAL_DRAFT'), gate = deferred(), entered = deferred();
  const view = await boot([() => response(initial)], { initial, write: (call, route) => {
    if (method(call) === 'PATCH') return route(call.path, call.options);
    assert.equal(call.path, profilePath + '/approve'); assert.equal(method(call), 'POST');
    entered.resolve(call); return gate.promise;
  } });
  assertDraft(view, initial);
  const pending = view.screen.elements.writerGenerationApprove.fire();
  const call = await entered.promise;
  assert.deepEqual(JSON.parse(call.options.body), { expectedDraftFingerprint: initial.profile.draftFingerprint });
  assert.deepEqual(JSON.parse(writes(view)[0].options.body), { settings: initial.profile.draftSettings });
  await changeLanguage(view, 'zh-CN');
  assert.equal(call.options.signal.aborted, true);
  const before = snapshot(view);
  await view.screen.elements.writerGenerationSave.fire();
  await view.screen.elements.writerGenerationApprove.fire();
  await open(view); await view.screen.flush();
  assert.equal(writes(view).length, 2);
  assert.equal(reads(view).length, 1);
  const approved = structuredClone(initial);
  approved.profile.status = 'approved'; approved.profile.approvedSettings = approved.profile.draftSettings;
  gate.resolve(response(approved)); await pending; await view.screen.flush();
  assert.deepEqual(snapshot(view), before);
  assert.equal(snapshot(view).saveDisabled, false);
  assert.equal(snapshot(view).approveDisabled, false);
  assert.equal(writes(view).length, 2);
  assert.deepEqual(view.unexpected, []);
});

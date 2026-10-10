import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  createHarness, deferred, failure, ids, makeGenerationResponse,
} from './creator-analysis-review.test-support.mjs';

const scripts = ['creator-approved-style.js', 'creator-body-style-reference.js']
  .map(name => ({ name, source: readFileSync(new URL('../pages/' + name, import.meta.url), 'utf8') }));
const eventName = 'creator:generation-profile-changed';
const owner = { ownerId: '66666666-6666-4666-8666-666666666666', epoch: 1 };
const otherWork = '77777777-7777-4777-8777-777777777777';
const marker = 'SYNTHETIC_PREVIOUS_APPROVED_RULE';

function comparison(validated = false) {
  return {
    contract: 'story-author-body-style-reference-read-v1', locale: 'ko',
    sourceScope: 'current_saved_body_and_latest_private_approval', progressRevision: 7,
    readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false,
    semanticQualityVerified: false, dispatchAuthorized: false,
    currentSourceState: validated ? 'validated' : 'unavailable',
    currentProfileVersion: validated ? 4 : null, currentReviewRevision: validated ? 3 : null,
    diagnostic: {
      version: 'story-author-body-style-reference-v1',
      referenceScope: 'stored_completed_origin_request_pin', contextSource: 'caller_supplied_metadata',
      comparison: validated ? 'same_approval_pin' : 'unavailable',
      reason: validated ? 'body_style_reference_same_approval_pin' : 'body_style_reference_pin_unavailable',
      readOnly: true, currentApprovalVerified: false, originalGenerationApprovalVerified: false,
      semanticQualityVerified: false, generatedBodyQualityVerified: false, bodySourceAligned: false,
      dispatchAuthorized: false, providerCalls: 0, operatingWrites: 0,
    },
  };
}

function approvedStyle() {
  return {
    version: 'story-author-approved-style-v1',
    sourceScope: 'latest_private_manuscript_completed_analysis', locale: 'ko',
    manuscriptVersion: 3, analysisVersion: 1, profileVersion: 4, reviewRevision: 3,
    section: { key: 'writing_style', decision: 'accepted', value: { summary: marker }, evidence: [] },
    readOnly: true, providerCalls: 0, operatingWrites: 0, bodySourceAligned: false,
    semanticQualityVerified: false,
  };
}

function draft() {
  const value = makeGenerationResponse();
  value.profile.status = 'needs_review';
  for (const section of value.profile.draftSettings.sections) section.decision = 'accepted';
  return value;
}

function readPlan({ value = comparison(), status = 200, hold = false, stage = 'fetch', reject = false } = {}) {
  const entered = deferred(), gate = deferred();
  const plan = { entered, gate, value, status, stage, reject, call: null, cancelled: 0, released: 0 };
  if (!hold) gate.resolve();
  plan.reply = async call => {
    plan.call = call;
    if (stage === 'fetch') {
      entered.resolve();
      await gate.promise;
      if (reject) throw new Error('Synthetic old transport failure');
    }
    let consumed = false;
    return {
      status, ok: status === 200, headers: { get: () => null },
      body: {
        cancel: async () => { plan.cancelled++; },
        getReader: () => ({
          read: async () => {
            if (consumed) return { done: true };
            consumed = true;
            if (stage === 'stream') {
              entered.resolve();
              await gate.promise;
              if (reject) throw new Error('Synthetic old stream failure');
            }
            return { done: false, value: new TextEncoder().encode(JSON.stringify(value)) };
          },
          cancel: async () => { plan.cancelled++; },
          releaseLock: () => { plan.released++; },
        }),
      },
    };
  };
  return plan;
}

function mutationPlan({ hold = false, stage = 'fetch', status = 200, mutate, reject = false } = {}) {
  const entered = deferred(), gate = deferred();
  if (!hold) gate.resolve();
  return {
    entered, gate,
    async reply(call, route) {
      if (stage === 'fetch') {
        entered.resolve();
        await gate.promise;
        if (reject) throw new Error('Synthetic mutation transport failure');
      }
      const original = status === 200 ? route(call.path, call.options) : failure('SYNTHETIC_REJECTED', status);
      const value = await original.json();
      if (mutate) mutate(value);
      return {
        status, ok: status >= 200 && status < 300,
        json: async () => {
          if (stage === 'json') {
            entered.resolve();
            await gate.promise;
            if (reject) throw new Error('Synthetic mutation JSON failure');
          }
          return structuredClone(value);
        },
      };
    },
  };
}

async function boot({ restore = true, patch, approve } = {}) {
  const plans = { style: [], comparison: [] }, events = [];
  let view;
  const screen = createHarness({
    receipt: false, generationProfile: draft(),
    handler: (call, route) => {
      const kind = call.path.endsWith('/generation-profile/approved-style') ? 'style'
        : call.path.includes('/body-preview/style-reference?') ? 'comparison' : null;
      if (kind) {
        assert.equal(call.options.method, 'GET');
        const plan = plans[kind].shift();
        assert.ok(plan, 'Only explicit read-button clicks may consume read plans');
        return plan.reply(call);
      }
      if (call.options.method === 'PATCH' && call.path.endsWith('/generation-profile')) {
        return patch ? patch.reply(call, route) : route(call.path, call.options);
      }
      if (call.options.method === 'POST' && call.path.endsWith('/generation-profile/approve')) {
        return approve ? approve.reply(call, route) : route(call.path, call.options);
      }
      assert.ok(!call.options.method || call.options.method === 'GET', 'No other mutation is allowed');
      return route(call.path, call.options);
    },
  });
  screen.setIdentity({ ...owner });
  screen.window.LuminaCreatorAnalysis.contextChanged();
  screen.setLocale('ko');

  // Bridge browser dispatch to the existing mounted listener bus without changing shared support.
  class FixtureCustomEvent extends Event {
    constructor(type, options = {}) { super(type, options); this.detail = options.detail ?? null; }
  }
  const dispatcher = new EventTarget();
  screen.window.Event = Event;
  screen.window.CustomEvent = FixtureCustomEvent;
  screen.window.dispatchEvent = dispatcher.dispatchEvent.bind(dispatcher);
  dispatcher.addEventListener(eventName, event => {
    events.push({ event, writes: screen.calls.filter(call => ['PATCH', 'POST'].includes(call.options.method)).length });
    screen.emit(eventName, event);
  });
  screen.window.getAuth = () => ({ accessToken: 'SYNTHETIC_EXISTING_ACCESS' });

  const { document, elements } = screen;
  const create = (tag, id) => {
    const node = document.createElement(tag); node.id = id; elements[id] = node; return node;
  };
  const shell = create('div', 'studioShell'); shell.root = true;
  const section = create('section', 'writer-manuscript'); section.classList.add('is-active');
  const work = create('select', 'writerManuscriptWork'); work.value = ids.work;
  const locale = create('select', 'writerManuscriptLocale'); locale.value = 'ko';
  const styleHost = create('section', 'writerApprovedStyle');
  const referenceHost = create('section', 'writerBodyStyleReference');
  shell.append(section); section.append(work, locale, styleHost, referenceHost);
  document.documentElement = document.createElement('html');
  document.documentElement.lang = 'ko'; document.documentElement.root = true;
  document.visibilityState = 'visible';
  const originalGet = document.getElementById;
  const descendants = node => [node, ...node.children.flatMap(descendants)];
  document.getElementById = id => originalGet(id) || descendants(shell).find(node => node.id === id) || null;
  for (const { name, source } of scripts) {
    vm.runInNewContext(source, {
      window: screen.window, document, TextEncoder, TextDecoder, Uint8Array, AbortController,
      Event, CustomEvent: FixtureCustomEvent,
    }, { filename: name });
  }
  assert.equal(styleHost.dataset.approvedStyleMounted, 'true');
  assert.equal(referenceHost.dataset.bodyStyleReferenceMounted, 'true');
  view = {
    screen, plans, events, styleHost, referenceHost, work, locale,
    node: id => document.getElementById(id),
    reads: () => screen.calls.filter(call => call.path.endsWith('/generation-profile/approved-style')
      || call.path.includes('/body-preview/style-reference?')),
    writes: () => screen.calls.filter(call => ['PATCH', 'POST'].includes(call.options.method)),
    async restore() {
      await elements.writerAnalysisRestore.fire();
      await screen.flush();
      assert.equal(screen.window.LuminaCreatorAnalysis.completed()?.analysisJobId, ids.job);
      assert.equal(elements.writerGenerationModal.classList.contains('is-hidden'), false);
      assert.equal(elements.writerGenerationSave.disabled, false);
      assert.equal(elements.writerGenerationApprove.disabled, false);
      assert.equal(events.length, 0, 'Read-only restoration must not announce a profile mutation');
    },
    async mutation(approval = false) {
      await elements[approval ? 'writerGenerationApprove' : 'writerGenerationSave'].fire();
      await screen.flush();
    },
  };
  if (restore) await view.restore();
  return view;
}

async function startRead(view, kind, options = {}) {
  const plan = readPlan({
    value: kind === 'comparison' ? comparison() : null,
    status: kind === 'comparison' ? 200 : 409, ...options,
  });
  view.plans[kind].push(plan);
  const button = view.node(kind === 'comparison' ? 'writerBodyStyleReferenceCheck' : 'writerApprovedStyleCheck');
  assert.equal(button.disabled, false, 'An explicit current read must be available before waiting on transport');
  const pending = button.fire();
  await plan.entered.promise;
  return { plan, pending };
}

async function heldReads(view, options = {}) {
  const style = await startRead(view, 'style', { hold: true });
  const reference = await startRead(view, 'comparison', { hold: true, ...options });
  return {
    style, reference,
    async finish() {
      style.plan.gate.resolve(); reference.plan.gate.resolve();
      await Promise.all([style.pending, reference.pending]); await view.screen.flush();
    },
  };
}

function cleared(view) {
  for (const id of ['writerApprovedStyleContent', 'writerBodyStyleReferenceContent']) {
    assert.equal(view.node(id).hidden, true, id + ' must not retain a prior profile snapshot');
    assert.equal(view.node(id).children.length, 0);
  }
  assert.equal(view.styleHost.querySelector('.approved-style-state').textContent,
    view.screen.window.LuminaCreatorApprovedStyle.copy.ko.ready);
  assert.equal(view.node('writerBodyStyleReferenceState').textContent,
    view.screen.window.LuminaCreatorBodyStyleReference.copy.ko.ready);
  assert.equal(view.node('writerApprovedStyleCheck').disabled, false);
  assert.equal(view.node('writerBodyStyleReferenceCheck').disabled, false);
}

function unchangedJournal(view, before) {
  assert.deepEqual([...view.screen.storage], before, 'No command/resume journal rewrite');
}

function exactWrites(view, count) {
  for (const { event } of view.events) {
    assert.equal(event.type, eventName);
    assert.ok(event.detail === null || event.detail === undefined, 'Profile mutation notification carries no private detail');
  }
  const writes = view.writes();
  assert.equal(writes.length, count, 'No replay, generation, bootstrap, or extra mutation');
  assert.equal(writes[0].path, '/api/v1/me/creator-studio/stories/' + ids.work + '/generation-profile');
  assert.equal(writes[0].options.method, 'PATCH');
  assert.equal(writes[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(writes[0].options.body), { settings: draft().profile.draftSettings });
  assert.deepEqual(structuredClone(writes[0].options.identity), owner);
  if (count === 2) {
    assert.equal(writes[1].path, '/api/v1/me/creator-studio/stories/' + ids.work + '/generation-profile/approve');
    assert.equal(writes[1].options.method, 'POST');
    assert.deepEqual(JSON.parse(writes[1].options.body), { expectedDraftFingerprint: 'b'.repeat(64) });
    assert.deepEqual(structuredClone(writes[1].options.identity), owner);
  }
}

test('PROFILE-READ-INVALIDATION-RED: verified approval discards a pending pre-approval comparison without auto GET', async () => {
  const view = await boot(), journal = [...view.screen.storage];
  const old = await heldReads(view);
  await view.mutation(true);
  await old.finish();
  cleared(view);
  assert.equal(view.events.length, 2, 'One announcement for validated PATCH and one for validated approval');
  assert.equal(old.style.plan.call.options.signal.aborted, true);
  assert.equal(old.reference.plan.call.options.signal.aborted, true);
  assert.equal(view.reads().length, 2);
  exactWrites(view, 2); unchangedJournal(view, journal);
});

test('PROFILE-READ-INVALIDATION: verified PATCH discards both held reads without automatic refresh', async () => {
  const view = await boot(), old = await heldReads(view);
  await view.mutation();
  await old.finish();
  cleared(view); assert.equal(view.events.length, 1);
  assert.equal(view.reads().length, 2); exactWrites(view, 1);
});

for (const reject of [false, true]) {
  test('PROFILE-READ-INVALIDATION: late comparison stream ' + (reject ? 'failure' : 'success') + ' cannot replace post-save pending UI', async () => {
    const view = await boot(), old = await heldReads(view, { stage: 'stream', reject });
    await view.mutation();
    await old.finish();
    cleared(view); assert.equal(view.events.length, 1);
    assert.equal(old.reference.plan.cancelled, 1);
    assert.equal(old.reference.plan.released, 1);
    assert.equal(view.reads().length, 2); exactWrites(view, 1);
  });
}

test('PROFILE-READ-INVALIDATION: late fetch rejection cannot overwrite the successful approval pending state', async () => {
  const view = await boot(), old = await heldReads(view, { reject: true });
  await view.mutation(true);
  await old.finish();
  cleared(view); assert.equal(view.events.length, 2);
  assert.equal(view.reads().length, 2); exactWrites(view, 2);
});

test('PROFILE-READ-INVALIDATION: verified save clears previously rendered snapshots, not only pending requests', async () => {
  // Earlier read projections precede restoration of the latest needs-review profile.
  // These are sequential synthetic server snapshots, not claimed human/DB approval evidence.
  const view = await boot({ restore: false });
  await (await startRead(view, 'style', { value: approvedStyle(), status: 200 })).pending;
  await (await startRead(view, 'comparison')).pending;
  assert.ok(view.styleHost.textContent.includes(marker));
  assert.equal(view.node('writerBodyStyleReferenceContent').hidden, false);
  await view.restore();
  const journal = [...view.screen.storage];
  await view.mutation();
  cleared(view);
  assert.equal(view.styleHost.textContent.includes(marker), false);
  assert.equal(view.events.length, 1); assert.equal(view.reads().length, 2);
  exactWrites(view, 1); unchangedJournal(view, journal);
});

test('PROFILE-READ-INVALIDATION: manual fresh reads after approval work and retain private GET options', async () => {
  const view = await boot(), old = await heldReads(view);
  await view.mutation(true); await old.finish();
  assert.equal(view.reads().length, 2, 'Mutation never starts a read');
  await (await startRead(view, 'style', { value: approvedStyle(), status: 200 })).pending;
  await (await startRead(view, 'comparison', { value: comparison(true) })).pending;
  assert.ok(view.styleHost.textContent.includes(marker));
  assert.equal(view.node('writerBodyStyleReferenceContent').hidden, false);
  assert.equal(view.node('writerBodyStyleReferenceState').textContent,
    view.screen.window.LuminaCreatorBodyStyleReference.copy.ko.same);
  assert.equal(view.reads().length, 4); assert.equal(view.events.length, 2);
  for (const { options } of view.reads()) {
    assert.equal(options.method, 'GET'); assert.equal(options._retried, true);
    assert.equal(options.cache, 'no-store'); assert.deepEqual(structuredClone(options.identity), owner);
    assert.equal(options.headers['Cache-Control'], 'no-store');
  }
  exactWrites(view, 2);
});

test('PROFILE-READ-INVALIDATION: validated approval invalidates a manual GET started after its preceding PATCH', async () => {
  const approval = mutationPlan({ hold: true }), view = await boot({ approve: approval });
  const mutation = view.mutation(true);
  await approval.entered.promise;
  const eventsAfterPatch = view.events.length;
  const old = await heldReads(view);
  approval.gate.resolve(); await mutation; await old.finish();
  cleared(view);
  assert.equal(eventsAfterPatch, 1, 'PATCH must invalidate independently before approval finishes');
  assert.equal(view.events.length, 2); assert.equal(view.reads().length, 2); exactWrites(view, 2);
});

test('PROFILE-READ-INVALIDATION: mutation event waits for verified fresh PATCH JSON, not HTTP arrival', async () => {
  const patch = mutationPlan({ hold: true, stage: 'json' }), view = await boot({ patch });
  const old = await heldReads(view), mutation = view.mutation();
  await patch.entered.promise;
  assert.equal(view.events.length, 0);
  assert.equal(old.reference.plan.call.options.signal.aborted, false);
  patch.gate.resolve(); await mutation; await old.finish();
  cleared(view); assert.equal(view.events.length, 1); exactWrites(view, 1);
});

test('PROFILE-READ-INVALIDATION: profile GET, unsaved edit and modal close never announce a mutation', async () => {
  const view = await boot();
  await (await startRead(view, 'comparison')).pending;
  const summary = view.screen.elements.writerGenerationSections.querySelector('.writer-generation-summary');
  summary.value = 'SYNTHETIC_UNSAVED_EDIT';
  await summary.fire('input');
  await view.screen.elements.writerGenerationClose.fire();
  await view.screen.elements.writerGenerationReviewOpen.fire();
  await view.screen.flush();
  assert.equal(view.events.length, 0); assert.equal(view.writes().length, 0);
  assert.equal(view.reads().length, 1);
  assert.equal(view.node('writerBodyStyleReferenceContent').hidden, false);
  assert.equal(view.screen.elements.writerGenerationSections.querySelector('.writer-generation-summary').value, 'SYNTHETIC_UNSAVED_EDIT');
});

const rejectedPatchCases = [
  ['HTTP failure', { status: 409 }],
  ['transport failure', { reject: true }],
  ['wrong work response', { mutate: value => { value.workId = otherWork; } }],
  ['invalid settings response', { mutate: value => { value.profile.draftSettings.sections = []; } }],
];
for (const [name, options] of rejectedPatchCases) {
  test('PROFILE-READ-INVALIDATION: PATCH ' + name + ' emits no event and leaves the independent read current', async () => {
    const patch = mutationPlan(options), view = await boot({ patch });
    const old = await heldReads(view), journal = [...view.screen.storage];
    await view.mutation(); await old.finish();
    assert.equal(view.events.length, 0);
    assert.equal(view.node('writerBodyStyleReferenceContent').hidden, false);
    assert.equal(old.reference.plan.call.options.signal.aborted, false);
    assert.equal(view.reads().length, 2); exactWrites(view, 1); unchangedJournal(view, journal);
    assert.equal(view.screen.elements.writerGenerationSave.disabled, false);
  });
}

for (const kind of ['account', 'work', 'locale']) {
  test('PROFILE-READ-INVALIDATION: stale ' + kind + ' PATCH JSON never emits a current mutation event', async () => {
    const patch = mutationPlan({ hold: true, stage: 'json' }), view = await boot({ patch });
    const mutation = view.mutation();
    await patch.entered.promise;
    if (kind === 'account') {
      view.screen.setIdentity({ ...owner, epoch: 2 });
      view.screen.emit('lumina:authchange');
      view.screen.window.LuminaCreatorAnalysis.contextChanged();
    } else if (kind === 'work') {
      view.work.value = otherWork; view.screen.setContext({ workId: otherWork });
      await view.work.fire('change');
      view.screen.window.LuminaCreatorAnalysis.contextChanged();
    } else {
      view.screen.setLocale('en');
    }
    patch.gate.resolve(); await mutation;
    assert.equal(view.events.length, 0); assert.equal(view.reads().length, 0);
    assert.equal(view.writes().length, 1, 'A stale completion must not replay its PATCH');
  });
}

for (const [name, options] of [
  ['HTTP failure', { status: 409 }],
  ['invalid unapproved response', { mutate: value => { value.profile.status = 'needs_review'; } }],
]) {
  test('PROFILE-READ-INVALIDATION: approval ' + name + ' preserves the valid PATCH event without an approval event', async () => {
    const approve = mutationPlan(options), view = await boot({ approve }), old = await heldReads(view);
    await view.mutation(true); await old.finish();
    cleared(view);
    assert.equal(view.events.length, 1, 'The earlier successful PATCH remains committed');
    assert.equal(view.events[0].writes, 1);
    assert.equal(view.reads().length, 2); exactWrites(view, 2);
    assert.equal(view.screen.elements.writerGenerationApprove.disabled, false);
  });
}

test('PROFILE-READ-INVALIDATION: stale approval JSON adds no event after its already validated PATCH', async () => {
  const approval = mutationPlan({ hold: true, stage: 'json' }), view = await boot({ approve: approval });
  const mutation = view.mutation(true);
  await approval.entered.promise;
  const afterPatch = view.events.length;
  view.screen.setIdentity({ ...owner, epoch: 2 });
  view.screen.emit('lumina:authchange');
  view.screen.window.LuminaCreatorAnalysis.contextChanged();
  approval.gate.resolve(); await mutation;
  assert.equal(afterPatch, 1); assert.equal(view.events.length, 1);
  assert.equal(view.reads().length, 0); assert.equal(view.writes().length, 2);
});

test('PROFILE-READ-INVALIDATION: old request cleanup cannot clear or unlock a newer manual read', async () => {
  const view = await boot(), old = await heldReads(view);
  await view.mutation();
  const freshStyle = await startRead(view, 'style', { hold: true });
  const freshValue = comparison(); freshValue.progressRevision = 8;
  const freshReference = await startRead(view, 'comparison', { hold: true, value: freshValue });
  await old.finish();
  assert.equal(view.node('writerApprovedStyleCheck').disabled, true);
  assert.equal(view.node('writerBodyStyleReferenceCheck').disabled, true);
  assert.equal(freshStyle.plan.call.options.signal.aborted, false);
  assert.equal(freshReference.plan.call.options.signal.aborted, false);
  freshStyle.plan.gate.resolve(); freshReference.plan.gate.resolve();
  await Promise.all([freshStyle.pending, freshReference.pending]);
  assert.equal(view.styleHost.querySelector('.approved-style-state').textContent,
    view.screen.window.LuminaCreatorApprovedStyle.copy.ko.conflict);
  assert.equal(view.node('writerBodyStyleReferenceState').textContent,
    view.screen.window.LuminaCreatorBodyStyleReference.copy.ko.pin);
  assert.equal(view.node('writerBodyStyleReferenceContent').children[1].children[1].textContent, '8');
  assert.equal(view.events.length, 1); assert.equal(view.reads().length, 4); exactWrites(view, 1);
});

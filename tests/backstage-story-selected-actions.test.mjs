import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const root = '/admin/api/v1/backstage/story-publication';
const A = { id: '10000000-0000-4000-8000-000000000001', activeReleaseId: '20000000-0000-4000-8000-000000000001', slug: 'the-killer-inherits-the-dead-alpha', status: 'published' };
const B = { id: '10000000-0000-4000-8000-000000000002', activeReleaseId: '20000000-0000-4000-8000-000000000002', slug: 'the-killer-inherits-the-dead-beta', status: 'published' };
const checksum = 'a'.repeat(64), nextRelease = '20000000-0000-4000-8000-000000000003';
const pair = work => ({ workId: work.id, releaseId: work.activeReleaseId });
const approvals = { aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true, generatedResultReuseConfirmed: true, imageTransformationConfirmed: true };
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function view({ works = [A, B], readAi, readCoverage, readVisual, post, activeB = true, choiceReady = true, legacy = false } = {}) {
  let catalog = works;
  const calls = [], listeners = {}, active = new Map([[A.id, false], [B.id, activeB]]);
  const scenes = new Map([[A.id, ['A-one', 'A-two']], [B.id, ['B-one', 'B-two']]]);
  const statusCards = { innerHTML: '', addEventListener: (type, handler) => { listeners[type] = handler; } };
  const list = { innerHTML: '', addEventListener() {} }, status = { textContent: '', className: '' };
  const refreshButton = { disabled: false, addEventListener() {} };
  const api = { fetch: async (url, options = {}) => {
    calls.push({ url, options });
    const address = new URL(url, 'https://unit.invalid');
    if (url === `${root}/submissions`) return { items: [], publishedWorks: structuredClone(catalog) };
    const visualPath = address.pathname.match(/\/story-visuals\/([^/]+)\/(replacement-status|replace-stale)$/);
    const workId = visualPath?.[1] || address.searchParams.get('workId') || catalog[0]?.id;
    const work = catalog.filter(value => value.id === workId)[0];
    const ids = legacy ? {} : { workId, releaseId: address.searchParams.get('releaseId') || work?.activeReleaseId };
    if (options.method === 'POST') {
      if (post) return post(url, options);
      if (url.endsWith('/activate-ai')) {
        active.set(options.body.workId || workId, true);
        return { ...options.body.workId ? { workId: options.body.workId, releaseId: options.body.releaseId } : {}, status: 'active', active: true };
      }
      assert.equal(visualPath?.[2], 'replace-stale', 'no other paid operation is expected');
      scenes.set(workId, scenes.get(workId).filter(key => key !== options.body.sourceSceneKey));
      return { status: 'ready', workId, ...options.body };
    }
    if (address.pathname.endsWith('/inheritor/choice-status')) return { ...ids, status: choiceReady ? 'ready' : 'preparing_choices', preparedParts: choiceReady ? 2 : 0, totalParts: 2 };
    if (address.pathname.endsWith('/inheritor/ai-status')) {
      const base = { ...ids, status: active.get(workId) ? 'active' : 'inactive', active: active.get(workId) || false };
      return readAi ? readAi({ ids, workId, url, base }) : base;
    }
    if (address.pathname.endsWith('/inheritor/choice-coverage')) {
      const total = workId === A.id ? 9 : 17;
      const base = { ...ids, status: 'ready', totalScenes: total, totalParts: total, partsWithoutScenes: 0,
        distribution: { threeValid: total, zero: 0, one: 0, two: 0, otherOrInvalid: 0 },
        routeIssues: { duplicateImmediateTargets: 0, invalidDirectTargets: 0 } };
      return readCoverage ? readCoverage({ ids, workId, url, base }) : base;
    }
    if (visualPath?.[2] === 'replacement-status') {
      const base = { workId, releaseId: work?.activeReleaseId, releaseChecksum: checksum, readyCount: 2,
        staleCount: scenes.get(workId)?.length || 0, items: (scenes.get(workId) || []).map(sourceSceneKey => ({ sourceSceneKey })) };
      return readVisual ? readVisual({ ids: { workId, releaseId: work?.activeReleaseId }, workId, url, base }) : base;
    }
    return { status: 'unavailable', active: false };
  } };
  const context = createContext({ URLSearchParams, window: { LuminaBackstageApi: api }, document: {
    getElementById: id => ({ storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list, storyPublicationState: status, storyPublicationRefreshButton: refreshButton })[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  } });
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.__actions = { state, load, selectChoiceTarget, activateAi, updateAiActivationButton, replaceStoryVisual, readInheritorStatus, inheritorAiReady, inheritorVisualReady, prepareInheritorChoices };\n})();');
  assert.notEqual(instrumented, source); runInContext(instrumented, context);
  const handlers = context.__actions;
  const aiControl = (checked = true, count = 4) => {
    const inputs = Array.from({ length: count }, () => ({ checked }));
    const inline = { textContent: '', className: '' };
    const button = { dataset: { storyAiActivate: 'inheritor' }, disabled: false, closest: () => card };
    const card = { dataset: { storyAiCard: 'inheritor', storyAiReview: String(handlers.state.inheritorConfirmationRevision) },
      querySelectorAll: () => inputs, querySelector: selector => selector === '[data-story-ai-activate]' ? button : inline };
    return { button, card, inputs };
  };
  const visualControl = scene => ({ dataset: { storyVisualReplace: 'inheritor', storyTargetRevision: String(handlers.state.choiceTargetRevision),
    storyVisualRead: String(handlers.state.inheritorReads.visual?.sequence), ...(scene ? { storyVisualScene: scene } : {}) } });
  return { ...handlers, calls, status, statusCards, refreshButton, aiControl, visualControl, listeners,
    setWorks: value => { catalog = value; }, setActive: (id, value) => active.set(id, value),
    refresh: () => handlers.load({ force: true }), select: id => handlers.selectChoiceTarget(id),
    posts: () => calls.filter(call => call.options.method === 'POST'),
    reads: kind => calls.filter(call => call.options.method !== 'POST' && (kind === 'visual' ? call.url.includes('/replacement-status') : call.url.includes(`/inheritor/${kind === 'ai' ? 'ai-status' : 'choice-coverage'}`))) };
}

for (const works of [[A, B], [B, A]]) test(`all selected reads use A's pair independent of list order (${works[0].slug})`, async () => {
  const screen = view({ works }); await screen.refresh();
  assert.equal(screen.reads('ai').length, 0); assert.equal(screen.reads('coverage').length, 0); assert.equal(screen.reads('visual').length, 0);
  await screen.select(A.id);
  for (const kind of ['ai', 'coverage']) {
    const call = screen.reads(kind)[0], url = new URL(call.url, 'https://unit.invalid');
    assert.deepEqual(Object.fromEntries(url.searchParams), pair(A)); assert.equal(call.options.auth, true);
  }
  assert.equal(screen.reads('visual')[0].url, `/admin/api/v1/story-visuals/${A.id}/replacement-status`);
  assert.equal(screen.state.aiStatuses.inheritor.active, false, 'B activation is never inherited by A');
  assert.equal(screen.state.choiceCoverage.inheritor.totalScenes, 9);
  assert.deepEqual(plain(screen.state.visualStatuses.inheritor.items), [{ sourceSceneKey: 'A-one' }, { sourceSceneKey: 'A-two' }]);
  assert.equal(screen.posts().length, 0); assert.equal(screen.inheritorAiReady(), true); assert.equal(screen.inheritorVisualReady(), true);
});

test('single target never auto-activates; an explicit fully confirmed click sends exactly one scoped activation', async () => {
  const screen = view({ works: [A] }); await screen.refresh(); assert.equal(screen.posts().length, 0);
  const unchecked = screen.aiControl(false); screen.updateAiActivationButton(unchecked.card);
  assert.equal(unchecked.button.disabled, true); await screen.activateAi(unchecked.button); assert.equal(screen.posts().length, 0);
  const incomplete = screen.aiControl(true, 3); await screen.activateAi(incomplete.button); assert.equal(screen.posts().length, 0);
  const control = screen.aiControl(); screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, false);
  await screen.activateAi(control.button);
  assert.equal(screen.posts().length, 1); assert.equal(screen.posts()[0].url, `${root}/published/inheritor/activate-ai`);
  assert.deepEqual(plain(screen.posts()[0].options.body), { ...approvals, ...pair(A) });
  assert.equal(screen.state.aiStatuses.inheritor.active, true); assert.match(screen.status.textContent, /활성화했습니다/);
  assert.equal(screen.state.activatingKey, null); assert.equal(screen.refreshButton.disabled, false);
  assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-ai-confirm[^>]*checked/);
  await screen.activateAi(control.button); assert.equal(screen.posts().length, 1, 'old confirmed DOM cannot be reused');
});

test('selection changes reset all checks and reject stale A controls even when B is verified', async () => {
  const screen = view(); await screen.refresh(); await screen.select(A.id);
  const oldAi = screen.aiControl(), oldVisual = screen.visualControl('A-one');
  await screen.select(B.id);
  assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-ai-confirm[^>]*checked|A-one|A-two/);
  screen.updateAiActivationButton(oldAi.card); assert.equal(oldAi.button.disabled, true);
  await screen.activateAi(oldAi.button); await screen.replaceStoryVisual(oldVisual); assert.equal(screen.posts().length, 0);
  await screen.activateAi(screen.aiControl().button);
  assert.deepEqual(plain(screen.posts()[0].options.body), { ...approvals, ...pair(B) });
});

for (const kind of ['ai', 'coverage', 'visual']) test(`late A ${kind} read cannot overwrite B or its verified controls`, async () => {
  const pending = deferred(); let aBase;
  const key = { ai: 'readAi', coverage: 'readCoverage', visual: 'readVisual' }[kind];
  const screen = view({ [key]: ({ workId, base }) => { if (workId === A.id) { aBase = base; return pending.promise; } return base; } });
  await screen.refresh(); const selectingA = screen.select(A.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(screen.inheritorAiReady(), false); assert.equal(screen.inheritorVisualReady(), false);
  await screen.activateAi(screen.aiControl().button); await screen.replaceStoryVisual(screen.visualControl()); assert.equal(screen.posts().length, 0);
  await screen.select(B.id); pending.resolve(aBase); await selectingA;
  assert.equal(screen.state.choiceTarget.workId, B.id);
  assert.equal(screen.state.aiStatuses.inheritor.workId, B.id); assert.equal(screen.state.choiceCoverage.inheritor.workId, B.id);
  assert.equal(screen.state.visualStatuses.inheritor.workId, B.id);
  assert.equal(screen.inheritorAiReady(), true); assert.equal(screen.inheritorVisualReady(), true);
  assert.doesNotMatch(screen.statusCards.innerHTML, /A-one|A-two/);
});

test('same-target overlapping reads are fenced by their individual read revision', async () => {
  let held = false; const pending = deferred();
  const screen = view({ works: [A], readAi: ({ base }) => held ? pending.promise : base });
  await screen.refresh(); held = true;
  const old = screen.readInheritorStatus('ai', screen.state.choiceTarget, screen.state.choiceTargetRevision);
  held = false; await screen.readInheritorStatus('ai', screen.state.choiceTarget, screen.state.choiceTargetRevision);
  pending.resolve({ ...pair(A), status: 'active', active: true }); await old;
  assert.equal(screen.state.aiStatuses.inheritor.active, false);
});

for (const kind of ['ai', 'coverage', 'visual']) for (const variant of ['missing', 'mismatch', 'unavailable', 'failure']) {
  test(`${kind} ${variant} response stays unknown and blocks the corresponding direct action`, async () => {
    const key = { ai: 'readAi', coverage: 'readCoverage', visual: 'readVisual' }[kind];
    const screen = view({ works: [A], [key]: ({ base }) => {
      if (variant === 'failure') throw new Error('offline');
      if (variant === 'unavailable') return { status: 'unavailable' };
      if (variant === 'missing') return { ...base, workId: undefined, releaseId: undefined };
      return { ...base, ...pair(B) };
    } });
    await screen.refresh();
    if (kind === 'visual') {
      assert.equal(screen.inheritorVisualReady(), false); await screen.replaceStoryVisual(screen.visualControl());
      assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-visual-replace="inheritor"/);
    } else {
      assert.equal(screen.inheritorAiReady(), false); const control = screen.aiControl();
      screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, true); await screen.activateAi(control.button);
    }
    assert.equal(screen.posts().length, 0);
  });
}

for (const [label, invalid] of [
  ['missing distribution field', base => ({ ...base, distribution: { ...base.distribution, zero: undefined } })],
  ['negative distribution', base => ({ ...base, distribution: { ...base.distribution, two: -1 } })],
  ['distribution sum mismatch', base => ({ ...base, distribution: { ...base.distribution, threeValid: 8 } })],
  ['invalid total parts', base => ({ ...base, totalParts: Infinity })],
  ['missing total parts', base => ({ ...base, totalParts: undefined })],
  ['parts without scenes out of bounds', base => ({ ...base, partsWithoutScenes: base.totalParts + 1 })],
  ['missing route count', base => ({ ...base, routeIssues: { duplicateImmediateTargets: 0 } })],
  ['negative route count', base => ({ ...base, routeIssues: { duplicateImmediateTargets: 0, invalidDirectTargets: -1 } })]
]) test(`malformed coverage ${label} is unknown and cannot verify activation`, async () => {
  const screen = view({ works: [A], readCoverage: ({ base }) => invalid(base) }); await screen.refresh();
  assert.equal(screen.state.choiceCoverage.inheritor.status, 'unavailable'); assert.equal(screen.inheritorAiReady(), false);
  await screen.activateAi(screen.aiControl().button); assert.equal(screen.posts().length, 0);
});

test('hiding B preserves A scoped reads and activation; hiding selected A never retargets to B', async () => {
  const screen = view({ works: [B, A] }); await screen.refresh(); await screen.select(A.id);
  screen.setWorks([A]); await screen.refresh(); await screen.activateAi(screen.aiControl().button);
  assert.deepEqual(plain(screen.posts()[0].options.body), { ...approvals, ...pair(A) });
  const before = screen.calls.length; screen.setWorks([B]); await screen.refresh();
  assert.equal(screen.state.choiceTargetState, 'changed');
  assert.deepEqual(plain(screen.state.aiStatuses.inheritor), { status: 'unavailable', active: false });
  assert.deepEqual(plain(screen.state.visualStatuses.inheritor), { status: 'unavailable' });
  assert.deepEqual(plain(screen.state.choiceCoverage.inheritor), { status: 'unavailable' });
  await screen.activateAi(screen.aiControl().button); await screen.replaceStoryVisual(screen.visualControl()); assert.equal(screen.posts().length, 1);
  assert.equal(screen.calls.slice(before).some(call => call.url.includes('/inheritor/') || call.url.includes('/story-visuals/')), false);
});

test('release change clears all old status and approvals until explicit reselection', async () => {
  const screen = view({ works: [A] }); await screen.refresh(); const old = screen.aiControl();
  screen.setWorks([{ ...A, activeReleaseId: nextRelease }]); await screen.refresh();
  assert.equal(screen.inheritorAiReady(), false); assert.equal(screen.inheritorVisualReady(), false);
  assert.deepEqual(plain(screen.state.aiStatuses.inheritor), { status: 'unavailable', active: false });
  assert.deepEqual(plain(screen.state.visualStatuses.inheritor), { status: 'unavailable' });
  await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
  await screen.select(A.id); await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
  await screen.activateAi(screen.aiControl().button);
  assert.deepEqual(plain(screen.posts()[0].options.body), { ...approvals, workId: A.id, releaseId: nextRelease });
});

test('activation busy disables selection, refresh and direct competing actions until completion', async () => {
  const pending = deferred(); const screen = view({ works: [A, B], post: () => pending.promise });
  await screen.refresh(); await screen.select(A.id);
  const activating = screen.activateAi(screen.aiControl().button), count = screen.calls.length;
  assert.equal(screen.refreshButton.disabled, true); assert.match(screen.statusCards.innerHTML, /<select data-story-choice-target disabled/);
  await screen.refresh(); await screen.select(B.id); await screen.activateAi(screen.aiControl().button); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.calls.length, count); assert.equal(screen.state.choiceTarget.workId, A.id);
  screen.setActive(A.id, true); pending.resolve({ ...pair(A), status: 'active', active: true }); await activating;
  assert.equal(screen.posts().length, 1); assert.equal(screen.refreshButton.disabled, false);
  assert.match(screen.statusCards.innerHTML, /<select data-story-choice-target\s*>/);
});

for (const variant of ['missing', 'mismatch', 'inactive', 'failure']) test(`activation ${variant} result stays unknown with one request and no automatic retry`, async () => {
  const screen = view({ works: [A], post: () => {
    if (variant === 'failure') throw new Error('offline');
    if (variant === 'inactive') return { ...pair(A), status: 'inactive', active: false };
    return { ...(variant === 'missing' ? {} : pair(B)), status: 'active', active: true };
  } });
  await screen.refresh(); await screen.activateAi(screen.aiControl().button);
  assert.equal(screen.state.aiStatuses.inheritor.status, 'unavailable'); assert.equal(screen.inheritorAiReady(), false);
  const control = screen.aiControl(); await screen.activateAi(control.button); assert.equal(screen.posts().length, 1);
  assert.match(screen.statusCards.innerHTML, /자동으로 재시도하지 않습니다/);
});

test('late activation result is ignored after the source disappears', async () => {
  const pending = deferred(); const screen = view({ works: [A], post: () => pending.promise });
  await screen.refresh(); const activating = screen.activateAi(screen.aiControl().button);
  screen.state.publishedWorks = [B]; pending.resolve({ ...pair(A), status: 'active', active: true }); await activating;
  assert.equal(screen.state.aiStatuses.inheritor.active, false); assert.equal(screen.inheritorAiReady(), false);
  assert.doesNotMatch(screen.status.textContent, /활성화했습니다/); assert.equal(screen.posts().length, 1);
});

test('visual URL and body use the selected exact pair/checksum/scene, never the first listed work', async () => {
  const screen = view({ works: [B, A] }); await screen.refresh(); await screen.select(A.id);
  await screen.replaceStoryVisual(screen.visualControl('A-two'));
  assert.equal(screen.posts().length, 1); assert.equal(screen.posts()[0].url, `/admin/api/v1/story-visuals/${A.id}/replace-stale`);
  assert.deepEqual(plain(screen.posts()[0].options.body), { releaseId: A.activeReleaseId, releaseChecksum: checksum, sourceSceneKey: 'A-two' });
  assert.equal(screen.state.visualStatuses.inheritor.staleCount, 1); assert.match(screen.status.textContent, /1장을 교체했습니다/);
});

test('visual batch is sequential and rechecks exact status before paying for the next scene', async () => {
  const screen = view({ works: [A] }); await screen.refresh(); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.posts().length, 2);
  assert.deepEqual(screen.posts().map(call => call.options.body.sourceSceneKey), ['A-one', 'A-two']);
  const first = screen.calls.indexOf(screen.posts()[0]), second = screen.calls.indexOf(screen.posts()[1]);
  assert.ok(screen.calls.slice(first + 1, second).some(call => call.url === `/admin/api/v1/story-visuals/${A.id}/replacement-status`));
  assert.equal(screen.state.visualStatuses.inheritor.staleCount, 0); assert.equal(screen.refreshButton.disabled, false);
});

for (const variant of ['missing', 'mismatch', 'checksum', 'scene', 'failed', 'failure']) test(`visual ${variant} response aborts the batch and direct repeats`, async () => {
  const screen = view({ works: [A], post: (url, options) => {
    if (variant === 'failure') throw new Error('offline');
    const result = { status: 'ready', ...pair(A), ...options.body };
    if (variant === 'missing') delete result.releaseId;
    if (variant === 'mismatch') result.workId = B.id;
    if (variant === 'checksum') result.releaseChecksum = 'b'.repeat(64);
    if (variant === 'scene') result.sourceSceneKey = 'another-scene';
    if (variant === 'failed') result.status = 'failed';
    return result;
  } });
  await screen.refresh(); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.posts().length, 1); assert.equal(screen.state.visualStatuses.inheritor.status, 'unavailable');
  assert.equal(screen.inheritorVisualReady(), false); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.posts().length, 1); assert.match(screen.statusCards.innerHTML, /0장 교체 확인 후 중단/);
});

for (const variant of ['release', 'checksum', 'unavailable', 'failedRead']) test(`visual status ${variant} between scenes prevents all further requests`, async () => {
  let reads = 0;
  const screen = view({ works: [A], readVisual: ({ base }) => {
    if (++reads === 1) return base;
    if (variant === 'failedRead') throw new Error('offline');
    if (variant === 'unavailable') return { status: 'unavailable' };
    return { ...base, ...(variant === 'release' ? { releaseId: nextRelease } : { releaseChecksum: 'b'.repeat(64) }) };
  } });
  await screen.refresh(); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.posts().length, 1); assert.equal(screen.inheritorVisualReady(), false);
  await screen.replaceStoryVisual(screen.visualControl()); assert.equal(screen.posts().length, 1);
  assert.match(screen.statusCards.innerHTML, /1장 교체 확인 후 중단/);
});

test('visual busy rejects refresh/selection and late source-hidden result never starts the next scene', async () => {
  const pending = deferred(); const screen = view({ works: [A, B], post: () => pending.promise });
  await screen.refresh(); await screen.select(A.id); const replacing = screen.replaceStoryVisual(screen.visualControl());
  const count = screen.calls.length; assert.equal(screen.refreshButton.disabled, true);
  await screen.refresh(); await screen.select(B.id); await screen.activateAi(screen.aiControl().button); await screen.replaceStoryVisual(screen.visualControl());
  assert.equal(screen.calls.length, count);
  screen.state.publishedWorks = [B]; pending.resolve({ status: 'ready', ...pair(A), releaseChecksum: checksum, sourceSceneKey: 'A-one' }); await replacing;
  assert.equal(screen.posts().length, 1); assert.equal(screen.inheritorVisualReady(), false);
  assert.doesNotMatch(screen.status.textContent, /교체했습니다/);
});

test('legacy single AI without IDs stays compatible but no paired client downgrades to unscoped activation', async () => {
  const legacyWork = { ...A, activeReleaseId: undefined };
  const screen = view({ works: [legacyWork], legacy: true, readVisual: () => ({ status: 'unavailable' }) });
  await screen.refresh(); assert.equal(screen.inheritorAiReady(), true);
  await screen.activateAi(screen.aiControl().button);
  assert.deepEqual(plain(screen.posts()[0].options.body), approvals);
  assert.equal(screen.reads('ai').every(call => !call.url.includes('?')), true);
  const paired = view({ works: [A], readAi: ({ base }) => ({ ...base, workId: undefined, releaseId: undefined }) });
  await paired.refresh(); await paired.activateAi(paired.aiControl().button); assert.equal(paired.posts().length, 0);
  assert.deepEqual(Object.fromEntries(new URL(paired.reads('ai')[0].url, 'https://unit.invalid').searchParams), pair(A));
});

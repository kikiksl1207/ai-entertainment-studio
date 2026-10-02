import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const root = '/admin/api/v1/backstage/story-publication';
const checksum = 'a'.repeat(64), nextRelease = '20000000-0000-4000-8000-000000000009';
const slugs = {
  imjin: 'records-of-the-burning-sea-imjin-war',
  norse: 'norse-myth-loki-crossroads',
  monster: 'the-monster-that-did-not-eat-my-name',
  rebellion: 'we-wrote-rebellion-on-each-others-bodies'
};
const keys = Object.keys(slugs);
const works = keys.map((key, index) => ({ id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  activeReleaseId: `20000000-0000-4000-8000-00000000000${index + 1}`, slug: slugs[key], status: 'published' }));
const unrelated = { id: '10000000-0000-4000-8000-000000000008', activeReleaseId: '20000000-0000-4000-8000-000000000008', slug: 'unrelated-published-work', status: 'published' };
const workFor = key => works[keys.indexOf(key)];
const pair = work => ({ workId: work.id, releaseId: work.activeReleaseId });
const sceneKeys = key => [`${key}-one`, `${key}-two`];
const plain = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function view({ catalog = works, readVisual, post } = {}) {
  let currentCatalog = catalog;
  const calls = [], listeners = {}, readCounts = new Map();
  const remaining = new Map(works.map((work, index) => [work.id, sceneKeys(keys[index])]));
  const statusCards = { innerHTML: '', addEventListener: (type, handler) => { listeners[type] = handler; } };
  const list = { innerHTML: '', addEventListener() {} }, status = { textContent: '', className: '' };
  const refreshButton = { disabled: false, addEventListener() {} };
  const api = { fetch: async (url, options = {}) => {
    calls.push({ url, options });
    if (url === `${root}/submissions`) return { items: [], publishedWorks: structuredClone(currentCatalog) };
    const address = new URL(url, 'https://unit.invalid');
    const visualPath = address.pathname.match(/^\/admin\/api\/v1\/story-visuals\/([^/]+)\/(replacement-status|replace-stale)$/);
    if (visualPath) {
      const workId = visualPath[1], work = currentCatalog.filter(candidate => candidate.id === workId)[0];
      const key = keys.find(candidate => slugs[candidate] === work?.slug);
      if (options.method === 'POST') {
        assert.equal(visualPath[2], 'replace-stale');
        const base = { status: 'ready', workId, ...options.body };
        if (post) return post({ url, options, key, workId, base });
        remaining.set(workId, (remaining.get(workId) || []).filter(value => value !== options.body.sourceSceneKey));
        return base;
      }
      assert.equal(visualPath[2], 'replacement-status');
      assert.ok(work, 'visual reads must address a listed work');
      const entries = remaining.get(workId) || [];
      const base = { ...pair(work), releaseChecksum: checksum, readyCount: 2,
        staleCount: entries.length, items: entries.map(sourceSceneKey => ({ sourceSceneKey })) };
      const number = (readCounts.get(workId) || 0) + 1;
      readCounts.set(workId, number);
      return readVisual ? readVisual({ key, workId, url, number, base }) : base;
    }
    if (options.method === 'POST') {
      assert.match(url, /\/activate-ai$/, 'unexpected paid action is visible in the call log');
      return { status: 'active', active: true };
    }
    if (url.endsWith('/ai-status')) return { status: 'inactive', active: false };
    if (url.endsWith('/choice-coverage')) return { status: 'ready', totalParts: 2, totalScenes: 2, partsWithoutScenes: 0,
      distribution: { zero: 0, one: 0, two: 0, threeValid: 2, otherOrInvalid: 0 },
      routeIssues: { duplicateImmediateTargets: 0, invalidDirectTargets: 0 }, incompleteExamples: [] };
    return { status: 'unavailable' };
  } };
  const context = createContext({ URLSearchParams, window: { LuminaBackstageApi: api }, document: {
    getElementById: id => ({ storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list,
      storyPublicationState: status, storyPublicationRefreshButton: refreshButton })[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  } });
  const instrumented = source.replace(/\}\)\(\);\s*$/, 'globalThis.__fixedVisualTest = { state, load, replaceStoryVisual, renderStoryStatus };\n})();');
  assert.notEqual(instrumented, source); runInContext(instrumented, context);
  const handlers = context.__fixedVisualTest;
  const control = (key, scene) => {
    const inline = { textContent: '', className: '' };
    const card = { dataset: { storyVisualCard: key }, querySelector: () => inline };
    return { dataset: { storyVisualReplace: key, storyTargetRevision: String(handlers.state.catalogRevision),
      storyVisualRead: String(handlers.state.fixedVisualReads?.[key]?.sequence), ...(scene ? { storyVisualScene: scene } : {}) },
      disabled: false, textContent: '', closest: () => card, setAttribute() {}, removeAttribute() {} };
  };
  const clickAi = key => {
    const inline = { textContent: '', className: '' };
    const card = { dataset: { storyAiCard: key }, querySelectorAll: () => Array.from({ length: 4 }, () => ({ checked: true })),
      querySelector: () => inline };
    const button = { dataset: { storyAiActivate: key }, disabled: false, textContent: '', closest: () => card };
    return listeners.click({ target: { closest: selector => selector === '[data-story-ai-activate]' ? button : null } });
  };
  const reads = key => calls.filter(call => call.options.method !== 'POST' &&
    call.url === `/admin/api/v1/story-visuals/${workFor(key).id}/replacement-status`);
  return { ...handlers, calls, status, statusCards, refreshButton, control, clickAi, reads,
    refresh: () => handlers.load({ force: true }), setCatalog: value => { currentCatalog = value; },
    removeScene: (key, scene) => remaining.set(workFor(key).id, remaining.get(workFor(key).id).filter(value => value !== scene)),
    posts: () => calls.filter(call => call.options.method === 'POST') };
}

function assertUnknown(screen, key) {
  assert.notEqual(screen.state.fixedVisualReads?.[key]?.status, 'verified', `${key} must not retain a verified read`);
  assert.equal(screen.state.visualStatuses[key]?.status, 'unavailable', `${key} must be explicitly unknown`);
  const buttons = [...screen.statusCards.innerHTML.matchAll(/<button\b[^>]*>/g)]
    .map(([tag]) => tag).filter(tag => tag.includes(`data-story-visual-replace="${key}"`));
  assert.ok(buttons.every(tag => /\bdisabled\b/.test(tag)), `${key} must not expose an enabled visual action`);
}

function assertPost(call, key, scene) {
  const work = workFor(key);
  assert.equal(call.url, `/admin/api/v1/story-visuals/${work.id}/replace-stale`);
  assert.equal(call.options.auth, true);
  assert.deepEqual(plain(call.options.body), { releaseId: work.activeReleaseId, releaseChecksum: checksum, sourceSceneKey: scene });
}

test('initial load validates and records all four fixed visual targets without paying', async () => {
  const screen = view(); await screen.refresh();
  assert.ok(Number.isSafeInteger(screen.state.catalogRevision) && screen.state.catalogRevision > 0);
  assert.ok(Number.isSafeInteger(screen.state.fixedVisualReadSequence) && screen.state.fixedVisualReadSequence >= 4);
  for (const key of keys) {
    const read = screen.state.fixedVisualReads[key], work = workFor(key);
    assert.equal(screen.reads(key).length, 1); assert.equal(screen.reads(key)[0].options.auth, true);
    assert.equal(read.status, 'verified'); assert.equal(read.workId, work.id); assert.equal(read.releaseId, work.activeReleaseId);
    assert.equal(read.revision, screen.state.catalogRevision); assert.ok(Number.isSafeInteger(read.sequence) && read.sequence > 0);
    assert.deepEqual(plain(read.value), { ...pair(work), releaseChecksum: checksum, readyCount: 2, staleCount: 2,
      items: sceneKeys(key).map(sourceSceneKey => ({ sourceSceneKey })) });
    const tag = [...screen.statusCards.innerHTML.matchAll(/<button\b[^>]*>/g)]
      .map(([value]) => value).find(value => value.includes(`data-story-visual-replace="${key}"`));
    assert.ok(tag, `${key} has a rendered visual action`);
    assert.ok(tag.includes(`data-story-target-revision="${read.revision}"`));
    assert.ok(tag.includes(`data-story-visual-read="${read.sequence}"`));
  }
  assert.equal(screen.posts().length, 0);
});

for (const key of keys) for (const reversed of [false, true]) test(`${key} selects its exact slug and sequential pair regardless of order (${reversed})`, async () => {
  const catalog = [unrelated, ...(reversed ? [...works].reverse() : works)];
  const screen = view({ catalog }); await screen.refresh(); await screen.replaceStoryVisual(screen.control(key));
  assert.equal(screen.posts().length, 2);
  assertPost(screen.posts()[0], key, sceneKeys(key)[0]); assertPost(screen.posts()[1], key, sceneKeys(key)[1]);
  const first = screen.calls.indexOf(screen.posts()[0]), second = screen.calls.indexOf(screen.posts()[1]);
  assert.ok(screen.calls.slice(first + 1, second).some(call => call.url === `/admin/api/v1/story-visuals/${workFor(key).id}/replacement-status`));
  assert.equal(screen.state.visualStatuses[key].staleCount, 0); assert.equal(screen.state.replacingKey, null);
  assert.equal(screen.refreshButton.disabled, false);
  assert.equal(screen.calls.some(call => call.url.includes(`/story-visuals/${unrelated.id}/`)), false);
});

for (const key of keys) test(`${key} one-scene click is exact and stale controls reject after a fresh read`, async () => {
  const screen = view(); await screen.refresh(); const old = screen.control(key, sceneKeys(key)[1]);
  await screen.replaceStoryVisual(old); assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], key, sceneKeys(key)[1]);
  assert.equal(screen.state.visualStatuses[key].staleCount, 1);
  await screen.replaceStoryVisual(old); assert.equal(screen.posts().length, 1);
  const stale = screen.control(key, sceneKeys(key)[0]); await screen.refresh();
  assert.notEqual(stale.dataset.storyVisualRead, String(screen.state.fixedVisualReads[key].sequence));
  await screen.replaceStoryVisual(stale); assert.equal(screen.posts().length, 1);
  await screen.replaceStoryVisual(screen.control(key, sceneKeys(key)[0])); assert.equal(screen.posts().length, 2);
});

for (const [label, changed] of [
  ['missing work ID', work => ({ ...work, id: undefined })],
  ['invalid work ID', work => ({ ...work, id: 'not-a-uuid' })],
  ['missing active release', work => ({ ...work, activeReleaseId: undefined })],
  ['invalid active release', work => ({ ...work, activeReleaseId: 'bad-release' })],
  ['draft work', work => ({ ...work, status: 'draft' })],
  ['prefix-only slug', work => ({ ...work, slug: `${work.slug}-not-the-fixed-story` })]
]) test(`catalog ${label} never enables fixed visual scope fallback`, async () => {
  for (const key of keys) {
    const screen = view({ catalog: works.map(work => work.id === workFor(key).id ? changed(work) : work) });
    await screen.refresh(); await screen.replaceStoryVisual(screen.control(key));
    assert.equal(screen.posts().length, 0, key);
    assert.notEqual(screen.state.fixedVisualReads?.[key]?.status, 'verified', key);
    assert.equal(screen.reads(key).length, 0, `${key} should not read a missing/invalid/incorrect fixed source`);
  }
});

test('ambiguous duplicate exact slugs cannot choose the first source', async () => {
  const duplicate = { ...unrelated, slug: slugs.monster };
  const screen = view({ catalog: [duplicate, ...works] }); await screen.refresh();
  await screen.replaceStoryVisual(screen.control('monster'));
  assert.equal(screen.posts().length, 0); assert.notEqual(screen.state.fixedVisualReads?.monster?.status, 'verified');
  assert.equal(screen.reads('monster').length, 0);
  assert.equal(screen.calls.some(call => call.url.includes(`/story-visuals/${duplicate.id}/`)), false);
});

for (const [label, invalid] of [
  ['missing both IDs', base => ({ ...base, workId: undefined, releaseId: undefined })],
  ['missing work ID', base => ({ ...base, workId: undefined })],
  ['missing release ID', base => ({ ...base, releaseId: undefined })],
  ['invalid UUID', base => ({ ...base, releaseId: 'invalid' })],
  ['wrong work', base => ({ ...base, workId: unrelated.id })],
  ['wrong release', base => ({ ...base, releaseId: nextRelease })],
  ['missing checksum', base => ({ ...base, releaseChecksum: undefined })],
  ['invalid checksum', base => ({ ...base, releaseChecksum: 'not-a-checksum' })],
  ['unavailable response', () => ({ status: 'unavailable' })],
  ['read failure', () => { throw new Error('offline'); }]
]) test(`fixed visual GET ${label} remains unknown and rejects direct clicks`, async () => {
  const screen = view({ readVisual: ({ key, base }) => key === 'norse' ? invalid(base) : base });
  await screen.refresh(); assertUnknown(screen, 'norse');
  await screen.replaceStoryVisual(screen.control('norse')); assert.equal(screen.posts().length, 0);
});

for (const [label, invalid] of [
  ['negative ready count', base => ({ ...base, readyCount: -1 })],
  ['fractional count', base => ({ ...base, staleCount: 1.5 })],
  ['infinite count', base => ({ ...base, readyCount: Infinity })],
  ['string count', base => ({ ...base, readyCount: '2' })],
  ['stale exceeds ready', base => ({ ...base, readyCount: 1 })],
  ['item/count mismatch', base => ({ ...base, staleCount: 1 })],
  ['missing items', base => ({ ...base, items: undefined })],
  ['non-array items', base => ({ ...base, items: {} })],
  ['blank scene key', base => ({ ...base, items: [{ sourceSceneKey: '' }, base.items[1]] })],
  ['whitespace scene key', base => ({ ...base, items: [{ sourceSceneKey: '   ' }, base.items[1]] })],
  ['non-string scene key', base => ({ ...base, items: [{ sourceSceneKey: 12 }, base.items[1]] })],
  ['duplicate scene keys', base => ({ ...base, items: [base.items[0], base.items[0]] })]
]) test(`malformed fixed visual ${label} cannot become verified`, async () => {
  const screen = view({ readVisual: ({ key, base }) => key === 'monster' ? invalid(base) : base });
  await screen.refresh(); assertUnknown(screen, 'monster');
  await screen.replaceStoryVisual(screen.control('monster')); assert.equal(screen.posts().length, 0);
});

test('empty stale lists are valid and never start a replacement', async () => {
  const screen = view({ readVisual: ({ base }) => ({ ...base, staleCount: 0, items: [] }) }); await screen.refresh();
  for (const key of keys) {
    assert.equal(screen.state.fixedVisualReads[key].status, 'verified');
    await screen.replaceStoryVisual(screen.control(key));
  }
  assert.equal(screen.posts().length, 0);
});

for (const [label, invalid] of [
  ['missing work', base => ({ ...base, workId: undefined })],
  ['missing release', base => ({ ...base, releaseId: undefined })],
  ['wrong work', base => ({ ...base, workId: unrelated.id })],
  ['wrong release', base => ({ ...base, releaseId: nextRelease })],
  ['missing checksum', base => ({ ...base, releaseChecksum: undefined })],
  ['wrong checksum', base => ({ ...base, releaseChecksum: 'b'.repeat(64) })],
  ['missing scene', base => ({ ...base, sourceSceneKey: undefined })],
  ['wrong scene', base => ({ ...base, sourceSceneKey: 'another-scene' })],
  ['failed result', base => ({ ...base, status: 'failed' })],
  ['request rejection', () => { throw new Error('provider result uncertain'); }]
]) test(`fixed visual POST ${label} aborts after one request and stays blocked`, async () => {
  const screen = view({ post: ({ base }) => invalid(base) }); await screen.refresh();
  const button = screen.control('imjin'); await screen.replaceStoryVisual(button);
  assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], 'imjin', 'imjin-one');
  assertUnknown(screen, 'imjin'); assert.ok(screen.state.fixedVisualFeedback?.imjin, 'uncertain failure feedback survives the final render');
  await screen.replaceStoryVisual(button); await screen.replaceStoryVisual(screen.control('imjin'));
  assert.equal(screen.posts().length, 1, 'neither old nor freshly forged controls can bypass an unknown status');
});

for (const [label, changed] of [
  ['work changes', base => ({ ...base, workId: unrelated.id })],
  ['release changes', base => ({ ...base, releaseId: nextRelease })],
  ['checksum changes', base => ({ ...base, releaseChecksum: 'b'.repeat(64) })],
  ['identity missing', base => ({ ...base, releaseId: undefined })],
  ['unavailable status', () => ({ status: 'unavailable' })],
  ['status GET rejects', () => { throw new Error('offline after first scene'); }],
  ['completed scene still stale', base => ({ ...base, staleCount: 2, items: sceneKeys('rebellion').map(sourceSceneKey => ({ sourceSceneKey })) })]
]) test(`status ${label} after the first fixed scene stops every further paid request`, async () => {
  const screen = view({ readVisual: ({ key, number, base }) => key === 'rebellion' && number > 1 ? changed(base) : base });
  await screen.refresh(); await screen.replaceStoryVisual(screen.control('rebellion'));
  assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], 'rebellion', 'rebellion-one');
  assertUnknown(screen, 'rebellion'); await screen.replaceStoryVisual(screen.control('rebellion'));
  assert.equal(screen.posts().length, 1);
});

for (const key of keys) for (const variant of ['hidden', 'release']) test(`late ${key} GET is ignored when its catalog source is ${variant}`, async () => {
  const pending = deferred(); let held;
  const screen = view({ readVisual: ({ key: current, base }) => { if (current === key) { held = base; return pending.promise; } return base; } });
  const loading = screen.refresh(); await turn();
  assert.ok(held, `${key} status read must have started`);
  screen.state.publishedWorks = variant === 'hidden' ? works.filter(work => work.id !== workFor(key).id) :
    works.map(work => work.id === workFor(key).id ? { ...work, activeReleaseId: nextRelease } : work);
  pending.resolve(held); await loading;
  assert.notEqual(screen.state.fixedVisualReads?.[key]?.status, 'verified');
  await screen.replaceStoryVisual(screen.control(key)); assert.equal(screen.posts().length, 0);
});

for (const key of keys) for (const variant of ['hidden', 'release', 'revision', 'read-sequence']) test(`late ${key} POST is fenced after ${variant} changes`, async () => {
  const pending = deferred(); let held;
  const screen = view({ post: ({ base }) => { held = base; return pending.promise; } });
  await screen.refresh(); const old = screen.control(key); const replacing = screen.replaceStoryVisual(old);
  assert.ok(held, `${key} replacement must have started`);
  if (variant === 'hidden') screen.state.publishedWorks = works.filter(work => work.id !== workFor(key).id);
  if (variant === 'release') screen.state.publishedWorks = works.map(work => work.id === workFor(key).id ? { ...work, activeReleaseId: nextRelease } : work);
  if (variant === 'revision') screen.state.catalogRevision += 1;
  if (variant === 'read-sequence') screen.state.fixedVisualReads[key] = { ...screen.state.fixedVisualReads[key], sequence: screen.state.fixedVisualReads[key].sequence + 1 };
  pending.resolve(held); await replacing;
  assert.equal(screen.posts().length, 1); assert.notEqual(screen.state.visualStatuses[key]?.staleCount, 0);
  assert.doesNotMatch(screen.status.textContent, /교체했습니다|교체.*완료/);
  await screen.replaceStoryVisual(old); assert.equal(screen.posts().length, 1);
});

test('pending visual read renders no enabled controls and rejects a direct replacement', async () => {
  const pending = deferred(); let held;
  const screen = view({ readVisual: ({ key, base }) => { if (key === 'monster') { held = base; return pending.promise; } return base; } });
  const loading = screen.refresh(); await turn(); assert.ok(held);
  await screen.replaceStoryVisual(screen.control('monster')); assert.equal(screen.posts().length, 0);
  assert.equal(screen.refreshButton.disabled, true);
  pending.resolve(held); await loading; assert.equal(screen.state.fixedVisualReads.monster.status, 'verified');
});

test('busy fixed replacement blocks refresh, other visual and fully confirmed AI clicks', async () => {
  const pending = deferred(); let held;
  const screen = view({ post: ({ base }) => { held = base; return pending.promise; } });
  await screen.refresh(); const replacing = screen.replaceStoryVisual(screen.control('imjin'));
  assert.ok(held); assert.equal(screen.refreshButton.disabled, true); const count = screen.calls.length;
  await screen.refresh(); await screen.replaceStoryVisual(screen.control('norse')); await screen.clickAi('monster');
  assert.equal(screen.calls.length, count, 'busy direct handlers must not even refresh or submit another action');
  pending.reject(new Error('uncertain first request')); await replacing;
  assert.equal(screen.posts().length, 1); assertUnknown(screen, 'imjin'); assert.equal(screen.refreshButton.disabled, false);
});

for (const [field, value] of [['activatingKey', 'norse'], ['replacingKey', 'monster'], ['preparingChoices', true], ['reviewingBatchId', 'saved-batch']]) {
  test(`global ${field} busy guard rejects every fixed visual direct handler`, async () => {
    const screen = view(); await screen.refresh(); screen.state[field] = value; screen.renderStoryStatus();
    assert.equal(screen.refreshButton.disabled, true);
    for (const key of keys) await screen.replaceStoryVisual(screen.control(key));
    assert.equal(screen.posts().length, 0);
  });
}

test('unknown visual requests unlock only after an explicit fresh read and never automatically retry', async () => {
  let fail = true;
  const screen = view({ post: ({ key, base, options }) => {
    if (fail) throw new Error('first result uncertain');
    screen.removeScene(key, options.body.sourceSceneKey); return base;
  } });
  await screen.refresh(); await screen.replaceStoryVisual(screen.control('norse', 'norse-one'));
  assert.equal(screen.posts().length, 1); assertUnknown(screen, 'norse');
  fail = false; const stale = screen.control('norse', 'norse-one'); await screen.refresh();
  assert.equal(screen.posts().length, 1, 'fresh read itself never retries a paid action');
  assert.equal(screen.state.fixedVisualReads.norse.status, 'verified');
  await screen.replaceStoryVisual(stale); assert.equal(screen.posts().length, 1);
  await screen.replaceStoryVisual(screen.control('norse', 'norse-one')); assert.equal(screen.posts().length, 2);
});

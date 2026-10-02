import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const root = '/admin/api/v1/backstage/story-publication';
const slugs = {
  imjin: 'records-of-the-burning-sea-imjin-war',
  norse: 'norse-myth-loki-crossroads',
  monster: 'the-monster-that-did-not-eat-my-name',
  rebellion: 'we-wrote-rebellion-on-each-others-bodies'
};
const keys = Object.keys(slugs);
const works = keys.map((key, index) => ({ id: `10000000-0000-4000-8000-00000000000${index + 1}`,
  activeReleaseId: `20000000-0000-4000-8000-00000000000${index + 1}`, slug: slugs[key], status: 'published' }));
const unrelated = { id: '10000000-0000-4000-8000-000000000008', activeReleaseId: '20000000-0000-4000-8000-000000000008', slug: 'unrelated-work', status: 'published' };
const nextRelease = '20000000-0000-4000-8000-000000000009';
const approvals = { aiBranchGenerationConfirmed: true, authorStyleReferenceConfirmed: true,
  generatedResultReuseConfirmed: true, imageTransformationConfirmed: true };
const completePreparation = { totalParts: 32, preparedParts: 32, remainingParts: 0, ready: true, phase: 'ready' };
const workFor = key => works[keys.indexOf(key)];
const pair = work => ({ workId: work.id, releaseId: work.activeReleaseId });
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function view({ catalog = works, readAi, readCoverage, post, submissions } = {}) {
  let currentCatalog = catalog;
  const calls = [], listeners = {}, readCounts = new Map();
  const aiValues = new Map(works.map((work, index) => [work.id, { status: 'inactive', active: false,
    ...(['monster', 'rebellion'].includes(keys[index]) ? { choicePreparation: { ...completePreparation } } : {}) }]));
  const statusCards = { innerHTML: '', addEventListener: (type, handler) => { listeners[type] = handler; } };
  const list = { innerHTML: '', addEventListener() {} }, status = { textContent: '', className: '' };
  const refreshButton = { disabled: false, addEventListener() {} };
  const api = { fetch: async (url, options = {}) => {
    calls.push({ url, options });
    const address = new URL(url, 'https://unit.invalid');
    if (url === `${root}/submissions`) return submissions ? submissions() : { items: [], publishedWorks: structuredClone(currentCatalog) };
    const path = address.pathname.match(/\/published\/(imjin|norse|monster|rebellion)\/(ai-status|choice-coverage|activate-ai)$/);
    if (path) {
      const key = path[1], workId = options.method === 'POST' ? options.body?.workId : address.searchParams.get('workId');
      const releaseId = options.method === 'POST' ? options.body?.releaseId : address.searchParams.get('releaseId');
      const work = currentCatalog.find(item => item.id === workId && item.slug === slugs[key]);
      assert.ok(work, `${key} must never use an unscoped or guessed work`);
      assert.equal(releaseId, work.activeReleaseId, `${key} request must use its exact release`);
      if (options.method === 'POST') {
        assert.equal(path[2], 'activate-ai');
        const base = { ...pair(work), status: 'active', active: true };
        if (post) return post({ key, work, url, options, base });
        aiValues.set(work.id, { ...aiValues.get(work.id), status: 'active', active: true });
        return base;
      }
      const kind = path[2] === 'ai-status' ? 'ai' : 'coverage';
      const counter = `${key}:${kind}`, number = (readCounts.get(counter) || 0) + 1;
      readCounts.set(counter, number);
      const base = kind === 'ai' ? { ...pair(work), ...aiValues.get(work.id) } : {
        ...pair(work), status: 'ready', totalParts: 32, totalScenes: 32, partsWithoutScenes: 0,
        distribution: { zero: 0, one: 0, two: 0, threeValid: 32, otherOrInvalid: 0 },
        routeIssues: { duplicateImmediateTargets: 0, invalidDirectTargets: 0 }, incompleteExamples: []
      };
      const hook = kind === 'ai' ? readAi : readCoverage;
      return hook ? hook({ key, work, workId, url, number, base }) : base;
    }
    const visual = address.pathname.match(/\/story-visuals\/([^/]+)\/(replacement-status|replace-stale)$/);
    if (visual) {
      const work = currentCatalog.find(item => item.id === visual[1]);
      assert.ok(work, 'visual requests must use a listed work');
      if (options.method === 'POST') return { status: 'ready', workId: work.id, ...options.body };
      return { ...pair(work), releaseChecksum: 'a'.repeat(64), readyCount: 1, staleCount: 1,
        items: [{ sourceSceneKey: `${keys.find(key => slugs[key] === work.slug)}-one` }] };
    }
    assert.notEqual(options.method, 'POST', `Unexpected mutation: ${url}`);
    return { status: 'unavailable' };
  } };
  const context = createContext({ URLSearchParams, window: { LuminaBackstageApi: api }, document: {
    getElementById: id => ({ storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list,
      storyPublicationState: status, storyPublicationRefreshButton: refreshButton })[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  } });
  const instrumented = source.replace(/\}\)\(\);\s*$/,
    'globalThis.__fixedAi = { state, load, activateAi, updateAiActivationButton, renderStoryStatus, readFixedStatus, fixedStatusVerified, fixedAiReady, replaceStoryVisual };\n})();');
  assert.notEqual(instrumented, source); runInContext(instrumented, context);
  const handlers = context.__fixedAi;
  const cardTag = key => [...statusCards.innerHTML.matchAll(/<section\b[^>]*>/g)]
    .map(([tag]) => tag).find(tag => tag.includes(`data-story-ai-card="${key}"`));
  const reviewRevision = key => cardTag(key)?.match(/data-story-ai-review="([^"]*)"/)?.[1];
  const cardHtml = key => [...statusCards.innerHTML.matchAll(/<article class="story-publication-status-item">[\s\S]*?<\/article>/g)]
    .map(([html]) => html).find(html => html.includes(`data-story-ai-card="${key}"`));
  const aiControl = (key, checked = true, count = 4) => {
    const inputs = Array.from({ length: count }, () => ({ checked }));
    const inline = { textContent: '', className: '' };
    const card = { dataset: { storyAiCard: key, storyAiReview: reviewRevision(key), storyTargetRevision: String(handlers.state.catalogRevision),
      storyAiRead: String(handlers.state.fixedReads?.[key]?.ai?.sequence),
      storyCoverageRead: String(handlers.state.fixedReads?.[key]?.coverage?.sequence) },
      querySelectorAll: () => inputs, querySelector: selector => selector === '[data-story-ai-activate]' ? button : inline };
    const button = { dataset: { storyAiActivate: key }, disabled: false, textContent: '', closest: () => card,
      setAttribute() {}, removeAttribute() {} };
    return { card, button, inputs, inline };
  };
  const visualControl = key => ({ dataset: { storyVisualReplace: key, storyTargetRevision: String(handlers.state.catalogRevision),
    storyVisualRead: String(handlers.state.fixedVisualReads[key]?.sequence) } });
  return { ...handlers, calls, listeners, status, statusCards, refreshButton, aiControl, visualControl, cardTag, cardHtml, reviewRevision,
    refresh: () => handlers.load({ force: true }), setCatalog: value => { currentCatalog = value; },
    setAi: (key, value) => aiValues.set(workFor(key).id, value),
    posts: () => calls.filter(call => call.options.method === 'POST'),
    reads: (key, kind) => calls.filter(call => call.options.method !== 'POST' &&
      new URL(call.url, 'https://unit.invalid').pathname === `${root}/published/${key}/${kind === 'ai' ? 'ai-status' : 'choice-coverage'}`) };
}

async function assertBlocked(screen, key) {
  const count = screen.posts().length, control = screen.aiControl(key);
  assert.equal(screen.fixedAiReady(key), false, `${key} cannot be ready`);
  screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, true);
  await screen.activateAi(control.button); assert.equal(screen.posts().length, count, 'a direct call cannot bypass verification');
}

async function assertUnknown(screen, key, kind = 'ai') {
  assert.equal(screen.fixedStatusVerified(key, kind), false);
  assert.notEqual(screen.state.fixedReads?.[key]?.[kind]?.status, 'verified');
  assert.equal(screen.state[kind === 'ai' ? 'aiStatuses' : 'choiceCoverage'][key]?.status, 'unavailable');
  await assertBlocked(screen, key);
}

function assertPost(call, key, work = workFor(key)) {
  assert.equal(call.url, `${root}/published/${key}/activate-ai`);
  assert.equal(call.options.auth, true);
  assert.deepEqual(plain(call.options.body), { ...approvals, ...pair(work) });
}

test('initial load records paired AI and coverage reads for all fixed works without paying', async () => {
  const screen = view(); await screen.refresh();
  assert.equal(screen.posts().length, 0);
  assert.ok(Number.isSafeInteger(screen.state.fixedReadSequence) && screen.state.fixedReadSequence >= 8);
  const sequences = [];
  for (const key of keys) {
    for (const kind of ['ai', 'coverage']) {
      const read = screen.state.fixedReads[key][kind], call = screen.reads(key, kind)[0];
      assert.equal(screen.reads(key, kind).length, 1);
      assert.deepEqual(Object.fromEntries(new URL(call.url, 'https://unit.invalid').searchParams), pair(workFor(key)));
      assert.equal(call.options.auth, true); assert.equal(read.status, 'verified');
      assert.equal(read.workId, workFor(key).id); assert.equal(read.releaseId, workFor(key).activeReleaseId);
      assert.equal(read.revision, screen.state.catalogRevision);
      assert.ok(Number.isSafeInteger(read.sequence) && read.sequence > 0); sequences.push(read.sequence);
      assert.equal(read.value, screen.state[kind === 'ai' ? 'aiStatuses' : 'choiceCoverage'][key]);
      assert.equal(screen.fixedStatusVerified(key, kind), true);
    }
    assert.equal(screen.fixedAiReady(key), true);
    assert.ok(/^\d+$/.test(screen.reviewRevision(key)));
    assert.ok(screen.cardTag(key).includes(`data-story-ai-read="${screen.state.fixedReads[key].ai.sequence}"`));
    assert.ok(screen.cardTag(key).includes(`data-story-coverage-read="${screen.state.fixedReads[key].coverage.sequence}"`));
    assert.ok(screen.cardTag(key).includes(`data-story-target-revision="${screen.state.catalogRevision}"`));
    assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-ai-confirm[^>]*checked/);
  }
  assert.equal(new Set(sequences).size, sequences.length);
  assert.equal(new Set(keys.map(screen.reviewRevision)).size, 1, 'review revision is global across fixed cards');
});

for (const key of keys) for (const reversed of [false, true]) test(`${key}: exact scoped activation is independent of catalog order (${reversed})`, async () => {
  const screen = view({ catalog: [unrelated, ...(reversed ? [...works].reverse() : works)] }); await screen.refresh();
  const control = screen.aiControl(key); screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, false);
  await screen.activateAi(control.button);
  assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], key);
  assert.equal(screen.state.aiStatuses[key].active, true); assert.equal(screen.fixedAiReady(key), true);
  assert.match(screen.status.textContent, /활성화했습니다/); assert.equal(screen.state.activatingKey, null);
  assert.equal(screen.refreshButton.disabled, false);
  for (const other of keys.filter(value => value !== key)) assert.equal(screen.state.aiStatuses[other].active, false);
  await screen.activateAi(control.button); assert.equal(screen.posts().length, 1, 'old confirmed controls cannot be reused');
});

for (const [label, change] of [
  ['missing work ID', work => ({ ...work, id: undefined })], ['invalid work ID', work => ({ ...work, id: 'legacy-work' })],
  ['missing release', work => ({ ...work, activeReleaseId: undefined })], ['invalid release', work => ({ ...work, activeReleaseId: 'legacy-release' })],
  ['not published', work => ({ ...work, status: 'draft' })], ['different exact slug', work => ({ ...work, slug: `${work.slug}-another` })]
]) test(`catalog ${label} cannot trigger unscoped reads or activation`, async () => {
  for (const key of keys) {
    const screen = view({ catalog: works.map(work => work.id === workFor(key).id ? change(work) : work) });
    await screen.refresh(); await assertBlocked(screen, key);
    assert.equal(screen.reads(key, 'ai').length, 0); assert.equal(screen.reads(key, 'coverage').length, 0);
  }
});

for (const key of keys) test(`${key}: duplicate published exact slugs never select the first`, async () => {
  const screen = view({ catalog: [{ ...unrelated, slug: slugs[key] }, ...works] }); await screen.refresh();
  await assertBlocked(screen, key); assert.equal(screen.reads(key, 'ai').length, 0); assert.equal(screen.reads(key, 'coverage').length, 0);
});

for (const kind of ['ai', 'coverage']) for (const [label, invalid] of [
  ['missing pair', base => ({ ...base, workId: undefined, releaseId: undefined })],
  ['partial pair', base => ({ ...base, releaseId: undefined })], ['invalid pair', base => ({ ...base, workId: 'legacy-id' })],
  ['different work', base => ({ ...base, workId: unrelated.id })], ['different release', base => ({ ...base, releaseId: nextRelease })],
  ['unavailable', () => ({ status: 'unavailable' })], ['read failure', () => { throw new Error('offline'); }]
]) test(`${kind} ${label} is unknown and disables direct activation`, async () => {
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key, base }) => key === 'norse' ? invalid(base) : base });
  await screen.refresh(); await assertUnknown(screen, 'norse', kind);
});

for (const [label, invalid] of [
  ['active status false flag', base => ({ ...base, status: 'active', active: false })],
  ['inactive status true flag', base => ({ ...base, status: 'inactive', active: true })],
  ['nonboolean active flag', base => ({ ...base, active: 'false' })],
  ['missing active flag', base => ({ ...base, active: undefined })],
  ['unknown status', base => ({ ...base, status: 'pending' })]
]) test(`AI ${label} cannot be displayed as verified`, async () => {
  const screen = view({ readAi: ({ key, base }) => key === 'rebellion' ? invalid(base) : base });
  await screen.refresh(); await assertUnknown(screen, 'rebellion');
  assert.match(screen.cardHtml('rebellion'), /원고 공개 \/ AI 분기 확인 필요/);
  assert.doesNotMatch(screen.cardHtml('rebellion'), /AI 분기 생성<\/strong><span class="status-badge is-approved">활성/);
});

for (const [label, invalid] of [
  ['missing totalParts', base => ({ ...base, totalParts: undefined })], ['negative totalParts', base => ({ ...base, totalParts: -1 })],
  ['fractional totalScenes', base => ({ ...base, totalScenes: 32.5 })], ['string count', base => ({ ...base, totalScenes: '32' })],
  ['infinite count', base => ({ ...base, totalParts: Infinity })], ['unsafe integer', base => ({ ...base, totalParts: Number.MAX_SAFE_INTEGER + 1 })],
  ['missing partsWithoutScenes', base => ({ ...base, partsWithoutScenes: undefined })], ['negative partsWithoutScenes', base => ({ ...base, partsWithoutScenes: -1 })],
  ['partsWithoutScenes out of bounds', base => ({ ...base, partsWithoutScenes: 33 })],
  ['too few scenes for populated parts', base => ({ ...base, totalParts: 33 })],
  ['scenes despite all parts empty', base => ({ ...base, partsWithoutScenes: 32 })],
  ['missing distribution', base => ({ ...base, distribution: undefined })],
  ...['zero', 'one', 'two', 'threeValid', 'otherOrInvalid'].flatMap(field => [
    [`missing ${field}`, base => ({ ...base, distribution: { ...base.distribution, [field]: undefined } })],
    [`negative ${field}`, base => ({ ...base, distribution: { ...base.distribution, [field]: -1 } })]
  ]),
  ['distribution sum mismatch', base => ({ ...base, distribution: { ...base.distribution, one: 1 } })],
  ['missing routeIssues', base => ({ ...base, routeIssues: undefined })],
  ['missing duplicate count', base => ({ ...base, routeIssues: { invalidDirectTargets: 0 } })],
  ['negative duplicate count', base => ({ ...base, routeIssues: { ...base.routeIssues, duplicateImmediateTargets: -1 } })],
  ['missing invalid count', base => ({ ...base, routeIssues: { duplicateImmediateTargets: 0 } })],
  ['fractional invalid count', base => ({ ...base, routeIssues: { ...base.routeIssues, invalidDirectTargets: 0.5 } })]
]) test(`coverage ${label} cannot verify the activation target`, async () => {
  const screen = view({ readCoverage: ({ key, base }) => key === 'monster' ? invalid(base) : base });
  await screen.refresh(); await assertUnknown(screen, 'monster', 'coverage');
});

for (const [label, change] of [
  ['three confirmations', control => control.inputs.pop()], ['five confirmations', control => control.inputs.push({ checked: true })],
  ['one unchecked confirmation', control => { control.inputs[2].checked = false; }],
  ['missing review revision', control => { delete control.card.dataset.storyAiReview; }],
  ['stale review revision', control => { control.card.dataset.storyAiReview = '0'; }],
  ['missing AI sequence', control => { delete control.card.dataset.storyAiRead; }],
  ['stale AI sequence', control => { control.card.dataset.storyAiRead = '0'; }],
  ['missing coverage sequence', control => { delete control.card.dataset.storyCoverageRead; }],
  ['stale coverage sequence', control => { control.card.dataset.storyCoverageRead = '0'; }],
  ['missing target revision', control => { delete control.card.dataset.storyTargetRevision; }],
  ['stale target revision', control => { control.card.dataset.storyTargetRevision = '0'; }],
  ['different card story key', control => { control.card.dataset.storyAiCard = 'norse'; }]
]) test(`${label} blocks both button state and the direct handler`, async () => {
  const screen = view(); await screen.refresh(); const control = screen.aiControl('imjin'); change(control);
  screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, true);
  await screen.activateAi(control.button); assert.equal(screen.posts().length, 0);
});

test('render and fresh reads reset the review boundary without inheriting old confirmations', async () => {
  const screen = view(); await screen.refresh(); const old = screen.aiControl('norse'), revision = screen.reviewRevision('norse');
  screen.renderStoryStatus(); assert.notEqual(screen.reviewRevision('norse'), revision);
  screen.updateAiActivationButton(old.card); assert.equal(old.button.disabled, true);
  await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
  assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-ai-confirm[^>]*checked/);
  for (const kind of ['ai', 'coverage']) {
    const stale = screen.aiControl('norse'); await screen.readFixedStatus('norse', kind);
    screen.updateAiActivationButton(stale.card); assert.equal(stale.button.disabled, true);
    await screen.activateAi(stale.button); assert.equal(screen.posts().length, 0);
  }
});

for (const key of ['monster', 'rebellion']) for (const [label, invalid] of [
  ['missing preparation', () => undefined], ['missing total', prep => ({ ...prep, totalParts: undefined })],
  ['zero total', prep => ({ ...prep, totalParts: 0, preparedParts: 0 })], ['negative prepared', prep => ({ ...prep, preparedParts: -1 })],
  ['missing remaining', prep => ({ ...prep, remainingParts: undefined })], ['negative remaining', prep => ({ ...prep, remainingParts: -1 })],
  ['fractional prepared', prep => ({ ...prep, preparedParts: 31.5, remainingParts: 0.5 })],
  ['string total', prep => ({ ...prep, totalParts: '32' })], ['infinite total', prep => ({ ...prep, totalParts: Infinity })],
  ['unsafe count', prep => ({ ...prep, totalParts: Number.MAX_SAFE_INTEGER + 1 })],
  ['sum mismatch', prep => ({ ...prep, preparedParts: 31 })], ['missing ready', prep => ({ ...prep, ready: undefined })],
  ['nonboolean ready', prep => ({ ...prep, ready: 'true' })], ['missing phase', prep => ({ ...prep, phase: undefined })],
  ['ready with remaining', prep => ({ ...prep, preparedParts: 8, remainingParts: 24, phase: 'preparing' })],
  ['ready wrong phase', prep => ({ ...prep, phase: 'awaiting_promotion' })],
  ['pending zero remaining wrong phase', prep => ({ ...prep, ready: false, phase: 'preparing' })],
  ['pending remaining wrong phase', prep => ({ ...prep, preparedParts: 8, remainingParts: 24, ready: false, phase: 'awaiting_promotion' })],
  ['obsolete pending phase', prep => ({ ...prep, preparedParts: 8, remainingParts: 24, ready: false, phase: 'pending' })]
]) test(`${key}: ${label} preparation cannot be verified`, async () => {
  const screen = view({ readAi: ({ key: reading, base }) => reading === key ? { ...base, choicePreparation: invalid(base.choicePreparation) } : base });
  await screen.refresh(); await assertUnknown(screen, key);
});

for (const key of ['monster', 'rebellion']) test(`${key}: preparation total must agree with verified coverage`, async () => {
  const screen = view({ readAi: ({ key: reading, base }) => reading === key ? {
    ...base, choicePreparation: { ...completePreparation, totalParts: 33, preparedParts: 33 }
  } : base });
  await screen.refresh(); await assertBlocked(screen, key);
});

const incompleteCoverage = base => ({ ...base, distribution: { ...base.distribution, one: 24, threeValid: 8 } });
for (const key of keys) test(`${key}: incomplete coverage is allowed only during explicit fixed-route preparation`, async () => {
  const screen = view({ readCoverage: ({ key: reading, base }) => reading === key ? incompleteCoverage(base) : base });
  await screen.refresh(); await assertBlocked(screen, key);
  if (['monster', 'rebellion'].includes(key)) {
    screen.setAi(key, { status: 'inactive', active: false, choicePreparation: {
      totalParts: 32, preparedParts: 8, remainingParts: 24, ready: false, phase: 'preparing'
    } });
    await screen.readFixedStatus(key, 'ai'); screen.renderStoryStatus();
    assert.equal(screen.fixedAiReady(key), true);
    const control = screen.aiControl(key); screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, false);
  }
});

for (const key of ['imjin', 'norse']) for (const issue of ['duplicateImmediateTargets', 'invalidDirectTargets', 'partsWithoutScenes']) {
  test(`${key}: ${issue} must be cleared before activation`, async () => {
    const screen = view({ readCoverage: ({ key: reading, base }) => reading !== key ? base : issue === 'partsWithoutScenes'
      ? { ...base, partsWithoutScenes: 1 } : { ...base, routeIssues: { ...base.routeIssues, [issue]: 1 } } });
    await screen.refresh(); await assertBlocked(screen, key);
  });
}

test('empty coverage can never approve an AI activation', async () => {
  const screen = view({ readCoverage: ({ base }) => ({ ...base, totalParts: 0, totalScenes: 0,
    distribution: { zero: 0, one: 0, two: 0, threeValid: 0, otherOrInvalid: 0 } }) });
  await screen.refresh(); for (const key of keys) await assertBlocked(screen, key);
});

for (const key of ['monster', 'rebellion']) for (const remaining of [24, 0]) for (const active of [false, true]) {
  test(`${key}: one approved batch (${remaining} remaining, active=${active}) requires matching latest preparation`, async () => {
    const phase = remaining ? 'preparing' : 'awaiting_promotion';
    const prep = { totalParts: 32, preparedParts: 32 - remaining, remainingParts: remaining, ready: false, phase };
    const screen = view({ readCoverage: ({ key: reading, base }) => reading === key ? incompleteCoverage(base) : base,
      post: ({ key: requested, work }) => {
        screen.setAi(requested, { status: active ? 'active' : 'inactive', active,
          choicePreparation: { ...prep, publicChoiceSet: 'legacy' } });
        return { ...pair(work), status: 'preparing_choices', active, totalParts: prep.totalParts,
          preparedParts: prep.preparedParts, remainingParts: remaining, phase };
      } });
    screen.setAi(key, { status: active ? 'active' : 'inactive', active, choicePreparation: {
      totalParts: 32, preparedParts: 0, remainingParts: 32, ready: false, phase: 'preparing'
    } });
    await screen.refresh(); assert.equal(screen.fixedAiReady(key), true);
    const control = screen.aiControl(key); await screen.activateAi(control.button);
    assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], key);
    assert.equal(screen.fixedAiReady(key), true); assert.equal(screen.state.aiStatuses[key].choicePreparation.phase, phase);
    assert.match(screen.status.textContent, new RegExp(`${prep.preparedParts} / 32파트 준비`));
    assert.doesNotMatch(screen.status.textContent, /활성화했습니다|갱신했습니다/);
    await screen.activateAi(control.button); assert.equal(screen.posts().length, 1);
  });
}

for (const [label, invalid] of [
  ['missing pair', base => ({ ...base, workId: undefined, releaseId: undefined })],
  ['partial pair', base => ({ ...base, releaseId: undefined })], ['wrong work', base => ({ ...base, workId: unrelated.id })],
  ['wrong release', base => ({ ...base, releaseId: nextRelease })], ['inactive result', base => ({ ...base, status: 'inactive', active: false })],
  ['active false flag', base => ({ ...base, active: false })], ['unknown status', base => ({ ...base, status: 'failed' })],
  ['request rejection', () => { throw new Error('provider outcome uncertain'); }]
]) test(`activation ${label} stays unknown and never repeats automatically`, async () => {
  const screen = view({ post: ({ base }) => invalid(base) }); await screen.refresh();
  const control = screen.aiControl('imjin'); await screen.activateAi(control.button);
  assert.equal(screen.posts().length, 1); assertPost(screen.posts()[0], 'imjin'); await assertUnknown(screen, 'imjin');
  assert.ok(screen.state.fixedAiFeedback?.imjin); assert.match(screen.status.textContent, /확인|불확실/);
  assert.doesNotMatch(screen.status.textContent, /활성화했습니다/);
  await screen.activateAi(control.button); assert.equal(screen.posts().length, 1);
  assert.equal(screen.state.activatingKey, null); assert.equal(screen.refreshButton.disabled, false);
});

const pendingResult = { status: 'preparing_choices', active: true, totalParts: 32, preparedParts: 8, remainingParts: 24, phase: 'preparing' };
for (const [label, invalid] of [
  ['missing total', base => ({ ...base, totalParts: undefined })], ['zero total', base => ({ ...base, totalParts: 0, preparedParts: 0, remainingParts: 0, phase: 'awaiting_promotion' })],
  ['negative prepared', base => ({ ...base, preparedParts: -1 })], ['missing remaining', base => ({ ...base, remainingParts: undefined })],
  ['negative remaining', base => ({ ...base, remainingParts: -1 })], ['sum mismatch', base => ({ ...base, remainingParts: 23 })],
  ['fractional counters', base => ({ ...base, preparedParts: 8.5, remainingParts: 23.5 })], ['string count', base => ({ ...base, preparedParts: '8' })],
  ['infinite count', base => ({ ...base, totalParts: Infinity })], ['unsafe total', base => ({ ...base, totalParts: Number.MAX_SAFE_INTEGER + 1 })],
  ['nonboolean active', base => ({ ...base, active: 'true' })], ['missing phase', base => ({ ...base, phase: undefined })],
  ['obsolete pending phase', base => ({ ...base, phase: 'pending' })], ['wrong pending phase', base => ({ ...base, phase: 'awaiting_promotion' })],
  ['wrong zero-remaining phase', base => ({ ...base, preparedParts: 32, remainingParts: 0 })],
  ['ready phase during staged application', base => ({ ...base, preparedParts: 32, remainingParts: 0, phase: 'ready' })]
]) test(`preparing response ${label} blocks another paid request`, async () => {
  const screen = view({ post: ({ work }) => invalid({ ...pair(work), ...pendingResult }) }); await screen.refresh();
  await screen.activateAi(screen.aiControl('monster').button);
  assert.equal(screen.posts().length, 1); await assertUnknown(screen, 'monster');
  assert.ok(screen.state.fixedAiFeedback.monster); assert.doesNotMatch(screen.status.textContent, /활성화했습니다|갱신했습니다/);
});

for (const kind of ['ai', 'coverage']) test(`latest ${kind} uncertainty prevents success after a matching activation response`, async () => {
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key, number, base }) => key === 'norse' && number > 1 ? { status: 'unavailable' } : base });
  await screen.refresh(); await screen.activateAi(screen.aiControl('norse').button);
  assert.equal(screen.posts().length, 1); await assertBlocked(screen, 'norse');
  assert.doesNotMatch(screen.status.textContent, /활성화했습니다/);
});

test('inactive latest AI read cannot confirm an active POST', async () => {
  const screen = view({ post: ({ base }) => base }); await screen.refresh();
  await screen.activateAi(screen.aiControl('imjin').button); assert.equal(screen.posts().length, 1);
  await assertUnknown(screen, 'imjin'); assert.doesNotMatch(screen.status.textContent, /활성화했습니다/);
});

for (const field of ['totalParts', 'preparedParts', 'remainingParts', 'phase', 'active']) {
  test(`latest preparation ${field} disagreement cannot confirm a paid batch`, async () => {
    const screen = view({ post: ({ work }) => {
      const prep = field === 'totalParts' ? { totalParts: 40, preparedParts: 8, remainingParts: 32, ready: false, phase: 'preparing' }
        : field === 'phase' ? { totalParts: 32, preparedParts: 32, remainingParts: 0, ready: true, phase: 'ready' }
          : { totalParts: 32, preparedParts: field === 'active' ? 8 : 9, remainingParts: field === 'active' ? 24 : 23,
            ready: false, phase: 'preparing' };
      screen.setAi('monster', { status: field === 'active' ? 'inactive' : 'active', active: field !== 'active', choicePreparation: prep });
      return { ...pair(work), ...pendingResult, ...(field === 'phase' ? { preparedParts: 32, remainingParts: 0, phase: 'awaiting_promotion' } : {}) };
    } });
    await screen.refresh(); await screen.activateAi(screen.aiControl('monster').button);
    assert.equal(screen.posts().length, 1); await assertUnknown(screen, 'monster');
    assert.doesNotMatch(screen.status.textContent, /8 \/ 32파트 준비|활성화했습니다/);
  });
}

for (const key of keys) for (const kind of ['ai', 'coverage']) test(`${key}: late same-target ${kind} read cannot overwrite a newer read`, async () => {
  const pending = deferred(); let hold = false, held;
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key: reading, base }) => {
    if (reading === key && hold) { held = base; return pending.promise; } return base;
  } });
  await screen.refresh(); hold = true; const reading = screen.readFixedStatus(key, kind);
  assert.ok(held); await assertBlocked(screen, key); hold = false;
  if (kind === 'ai') screen.setAi(key, { status: 'active', active: true,
    ...(['monster', 'rebellion'].includes(key) ? { choicePreparation: { ...completePreparation } } : {}) });
  await screen.readFixedStatus(key, kind);
  const current = screen.state.fixedReads[key][kind], collection = kind === 'ai' ? 'aiStatuses' : 'choiceCoverage';
  pending.resolve(kind === 'ai' ? held : { ...held, totalScenes: 33, distribution: { ...held.distribution, threeValid: 33 } });
  await reading;
  assert.equal(screen.state.fixedReads[key][kind], current); assert.equal(screen.state[collection][key], current.value);
  assert.equal(screen.fixedStatusVerified(key, kind), true); assert.equal(screen.posts().length, 0);
  if (kind === 'ai') assert.equal(screen.state.aiStatuses[key].active, true);
});

for (const kind of ['ai', 'coverage']) test(`late old-release ${kind} cannot replace a newly verified release`, async () => {
  const pending = deferred(); let hold = false, held;
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key, base }) => {
    if (key === 'monster' && hold) { held = base; return pending.promise; } return base;
  } });
  await screen.refresh(); const oldControl = screen.aiControl('monster'); hold = true;
  const reading = screen.readFixedStatus('monster', kind); assert.ok(held);
  const catalog = works.map(work => work.id === workFor('monster').id ? { ...work, activeReleaseId: nextRelease } : work);
  screen.setCatalog(catalog); screen.state.publishedWorks = catalog; screen.state.catalogRevision += 1; hold = false;
  await screen.readFixedStatus('monster', 'ai'); await screen.readFixedStatus('monster', 'coverage');
  const current = screen.state.fixedReads.monster[kind]; pending.resolve(held); await reading;
  assert.equal(screen.state.fixedReads.monster[kind], current); assert.equal(current.value.releaseId, nextRelease);
  assert.equal(screen.fixedAiReady('monster'), true);
  await screen.activateAi(oldControl.button); assert.equal(screen.posts().length, 0);
});

for (const kind of ['ai', 'coverage']) test(`a pending ${kind} read blocks activation and old confirmation controls`, async () => {
  const pending = deferred(); let hold = false, held;
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key, base }) => {
    if (key === 'norse' && hold) { held = base; return pending.promise; } return base;
  } });
  await screen.refresh(); const old = screen.aiControl('norse'); hold = true;
  const reading = screen.readFixedStatus('norse', kind); assert.ok(held);
  await assertBlocked(screen, 'norse'); await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
  pending.resolve(held); await reading; screen.updateAiActivationButton(old.card);
  assert.equal(old.button.disabled, true); await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
});

for (const kind of ['ai', 'coverage']) test(`hidden source rejects a late ${kind} reply without restoring its old status`, async () => {
  const pending = deferred(); let hold = false, held;
  const hook = kind === 'ai' ? 'readAi' : 'readCoverage';
  const screen = view({ [hook]: ({ key, base }) => {
    if (key === 'norse' && hold) { held = base; return pending.promise; } return base;
  } }); await screen.refresh(); hold = true;
  const reading = screen.readFixedStatus('norse', kind); assert.ok(held);
  screen.state.publishedWorks = works.filter(work => work.id !== workFor('norse').id);
  pending.resolve(held); await reading;
  const collection = kind === 'ai' ? 'aiStatuses' : 'choiceCoverage';
  assert.equal(screen.state[collection].norse.status, 'unavailable');
  await assertBlocked(screen, 'norse'); assert.equal(screen.posts().length, 0);
});

for (const key of keys) for (const variant of ['hidden', 'release', 'revision', 'ai-sequence', 'coverage-sequence']) {
  test(`${key}: late activation result is fenced after ${variant} changes`, async () => {
    const pending = deferred(); let held;
    const screen = view({ post: ({ base }) => { held = base; return pending.promise; } }); await screen.refresh();
    const old = screen.aiControl(key), activating = screen.activateAi(old.button); assert.ok(held);
    if (variant === 'hidden') screen.state.publishedWorks = works.filter(work => work.id !== workFor(key).id);
    if (variant === 'release') screen.state.publishedWorks = works.map(work => work.id === workFor(key).id ? { ...work, activeReleaseId: nextRelease } : work);
    if (variant === 'revision') screen.state.catalogRevision += 1;
    if (variant.endsWith('-sequence')) {
      const kind = variant.split('-')[0], read = screen.state.fixedReads[key][kind];
      screen.state.fixedReads[key][kind] = { ...read, sequence: read.sequence + 1 };
    }
    const count = screen.calls.length; pending.resolve(held); await activating;
    assert.equal(screen.calls.length, count, 'a stale result must not initiate a refresh or another request');
    assert.equal(screen.posts().length, 1); assert.notEqual(screen.state.aiStatuses[key]?.active, true);
    assert.doesNotMatch(screen.status.textContent, /활성화했습니다|갱신했습니다/);
    await screen.activateAi(old.button); assert.equal(screen.posts().length, 1);
  });
}

test('busy activation locks refresh, visual replacement and other fully confirmed AI handlers', async () => {
  const pending = deferred(); let held;
  const screen = view({ post: ({ base }) => { held = base; return pending.promise; } }); await screen.refresh();
  const ai = screen.aiControl('imjin'), competing = screen.aiControl('norse');
  const activating = screen.activateAi(ai.button); assert.ok(held); assert.equal(screen.refreshButton.disabled, true);
  const count = screen.calls.length;
  await screen.refresh(); await screen.activateAi(competing.button); await screen.replaceStoryVisual(screen.visualControl('monster'));
  assert.equal(screen.calls.length, count);
  pending.reject(new Error('uncertain provider outcome')); await activating;
  assert.equal(screen.posts().length, 1); await assertUnknown(screen, 'imjin');
});

for (const [field, value] of [['activatingKey', 'norse'], ['replacingKey', 'monster'], ['preparingChoices', true], ['reviewingBatchId', 'saved-batch']]) {
  test(`global ${field} guard locks every fixed AI direct handler and refresh`, async () => {
    const screen = view(); await screen.refresh(); const controls = keys.map(key => screen.aiControl(key));
    screen.state[field] = value; screen.renderStoryStatus(); assert.equal(screen.refreshButton.disabled, true);
    const count = screen.calls.length; await screen.refresh();
    for (const control of controls) {
      screen.updateAiActivationButton(control.card); assert.equal(control.button.disabled, true);
      await screen.activateAi(control.button);
    }
    assert.equal(screen.calls.length, count);
  });
}

test('unknown activation requires explicit fresh reads and new confirmations before a separate retry', async () => {
  let fail = true;
  const screen = view({ post: ({ key, base }) => {
    if (fail) throw new Error('outcome uncertain');
    screen.setAi(key, { status: 'active', active: true }); return base;
  } }); await screen.refresh(); const old = screen.aiControl('imjin');
  await screen.activateAi(old.button); assert.equal(screen.posts().length, 1); await assertUnknown(screen, 'imjin');
  fail = false; await screen.refresh(); assert.equal(screen.posts().length, 1, 'read-only refresh cannot retry');
  await screen.activateAi(old.button); await screen.activateAi(screen.aiControl('imjin', false).button);
  assert.equal(screen.posts().length, 1);
  await screen.activateAi(screen.aiControl('imjin').button); assert.equal(screen.posts().length, 2);
  assertPost(screen.posts()[1], 'imjin'); assert.match(screen.status.textContent, /활성화했습니다/);
});

test('catalog reload clears old AI and coverage immediately and failure never restores approval', async () => {
  let fail = false; const pending = deferred();
  const screen = view({ submissions: () => fail ? pending.promise : { items: [], publishedWorks: structuredClone(works) } });
  screen.setAi('norse', { status: 'active', active: true });
  await screen.refresh(); const old = screen.aiControl('norse'); fail = true; const loading = screen.refresh();
  assert.equal(screen.state.catalogVerified, false); assert.equal(screen.refreshButton.disabled, true);
  assert.equal(Object.keys(screen.state.aiStatuses).length, 0); assert.equal(Object.keys(screen.state.choiceCoverage).length, 0);
  for (const key of keys) await assertBlocked(screen, key);
  pending.reject(new Error('catalog offline')); await loading;
  assert.equal(screen.state.catalogVerified, false);
  await screen.activateAi(old.button); assert.equal(screen.posts().length, 0);
});

test('raw status replacements cannot inherit verification from a previous read', async () => {
  const screen = view(); await screen.refresh();
  screen.state.aiStatuses.imjin = { ...pair(workFor('imjin')), status: 'active', active: true };
  await assertBlocked(screen, 'imjin');
  screen.state.choiceCoverage.norse = { ...screen.state.choiceCoverage.norse };
  await assertBlocked(screen, 'norse');
});

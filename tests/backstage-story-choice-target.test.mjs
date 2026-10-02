import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../backstage-story-publication.css', import.meta.url), 'utf8');
const root = '/admin/api/v1/backstage/story-publication';
const A = { id: '10000000-0000-4000-8000-000000000001', activeReleaseId: '20000000-0000-4000-8000-000000000001', slug: 'the-killer-inherits-the-dead-alpha', status: 'published' };
const B = { id: '10000000-0000-4000-8000-000000000002', activeReleaseId: '20000000-0000-4000-8000-000000000002', slug: 'the-killer-inherits-the-dead-beta', status: 'published' };
const nextRelease = '20000000-0000-4000-8000-000000000003';
const pair = work => ({ workId: work.id, releaseId: work.activeReleaseId });
const result = (ids = {}, overrides = {}) => ({ status: 'preparing_choices', preparedParts: 8, totalParts: 32, ...ids, ...overrides });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function view({ works = [A], readStatus, post, batch = null } = {}) {
  const calls = [], listeners = {};
  const statusCards = { innerHTML: '', addEventListener: (type, handler) => { listeners[type] = handler; } };
  const list = { innerHTML: '', addEventListener() {} }, status = { textContent: '', className: '' };
  const inlineStatus = { textContent: '', className: '' };
  let catalog = works, catalogError = null;
  const api = { fetch: async (url, options = {}) => {
    calls.push({ url, options });
    const address = new URL(url, 'https://unit.invalid');
    if (options.method === 'POST') {
      if (post) return post(url, options);
      assert.equal(address.pathname, `${root}/published/inheritor/prepare-choices`, 'no other mutation is authorized');
      return result(options.body || {}, { preparedParts: 16 });
    }
    if (url === `${root}/submissions`) {
      if (catalogError) throw catalogError;
      return { items: [], publishedWorks: structuredClone(catalog) };
    }
    if (address.pathname.endsWith('/inheritor/choice-status')) {
      const workId = address.searchParams.get('workId'), releaseId = address.searchParams.get('releaseId');
      assert.equal(Boolean(workId), Boolean(releaseId), 'query IDs are always paired');
      const ids = workId ? { workId, releaseId } : {};
      if (readStatus) return readStatus(ids, url);
      return result(ids, { preparationBatch: structuredClone(batch) });
    }
    return { status: 'unavailable', active: false, items: [] };
  } };
  const context = createContext({ URLSearchParams, window: { LuminaBackstageApi: api }, document: {
    getElementById: id => ({ storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list, storyPublicationState: status })[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  } });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__targetTest = { state, load, renderStoryStatus, selectChoiceTarget, choiceTargetReady, prepareInheritorChoices, reviewInheritorChoiceBatch, updateChoiceReviewButton, activateAi, updateAiActivationButton, replaceStoryVisual };\n})();');
  assert.notEqual(testSource, source);
  runInContext(testSource, context);
  const handlers = context.__targetTest;
  const prepareButton = { disabled: false, textContent: '', closest: () => ({ querySelector: () => inlineStatus }) };
  const note = { value: '제공자 응답과 청구 내역을 확인했고 재사용할 결과가 없습니다.' }, confirm = { checked: true };
  const reviewButton = { dataset: { storyReviewBatch: 'saved-batch' }, disabled: false, closest: () => review };
  const review = { querySelector: selector => ({ '[data-story-choice-review-note]': note,
    '[data-story-choice-review-confirm]': confirm, '[data-story-review-batch]': reviewButton })[selector] || null };
  const aiButton = { dataset: { storyAiActivate: 'inheritor' }, disabled: false, closest: () => aiCard };
  const aiCard = { dataset: { storyAiCard: 'inheritor' }, querySelectorAll: () => Array.from({ length: 4 }, () => ({ checked: true })),
    querySelector: selector => selector === '[data-story-ai-activate]' ? aiButton : inlineStatus };
  const visualButton = { dataset: { storyVisualReplace: 'inheritor' }, closest: () => ({ querySelector: () => inlineStatus }) };
  const html = () => {
    handlers.renderStoryStatus();
    return [...statusCards.innerHTML.matchAll(/<article class="story-publication-status-item">[\s\S]*?<\/article>/g)]
      .map(([value]) => value).find(value => value.includes('<h3>살인자는 죽은 자의 능력을 계승한다</h3>')) || '';
  };
  return { ...handlers, calls, status, inlineStatus, statusCards, prepareButton, reviewButton, review, note, confirm, aiButton, aiCard, visualButton, html,
    setWorks: value => { catalog = value; }, failCatalog: () => { catalogError = new Error('offline'); },
    refresh: () => handlers.load({ force: true }),
    change: value => listeners.change({ target: { value, matches: selector => selector === '[data-story-choice-target]' } }),
    reads: () => calls.filter(call => new URL(call.url, 'https://unit.invalid').pathname.endsWith('/inheritor/choice-status')),
    posts: () => calls.filter(call => call.options.method === 'POST') };
}

function assertScopedRead(call, work) {
  const url = new URL(call.url, 'https://unit.invalid');
  assert.equal(url.pathname, `${root}/published/inheritor/choice-status`);
  assert.deepEqual(Object.fromEntries(url.searchParams), pair(work));
  assert.equal(call.options.auth, true);
  assert.equal(call.options.method, undefined);
}

test('single real pair is assigned and read automatically, never generated automatically', async () => {
  const screen = view();
  await screen.refresh();
  assert.equal(screen.reads().length, 1);
  assertScopedRead(screen.reads()[0], A);
  assert.equal(screen.choiceTargetReady(), true);
  assert.equal(screen.posts().length, 0);
  assert.match(screen.html(), new RegExp(`<option value="${A.id}" selected`));
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 1);
  assert.deepEqual(plain(screen.posts()[0].options.body), pair(A));
  assert.equal(screen.posts()[0].options.auth, true);
  screen.reads().forEach(call => assertScopedRead(call, A));
});

test('multiple works require explicit selection and clear old counts/batches without unscoped reads', async () => {
  const screen = view({ works: [A, B] });
  screen.state.choiceStatuses.inheritor = result(pair(A), { preparedParts: 777, totalParts: 999, preparationBatch: { id: 'old-batch', status: 'review_required', partKeys: ['part-777'] } });
  await screen.refresh();
  assert.equal(screen.state.choiceTarget, null);
  assert.equal(screen.reads().length, 0);
  assert.equal(screen.choiceTargetReady(), false);
  const html = screen.html();
  assert.match(html, /<select data-story-choice-target/);
  assert.match(html, /직접 선택/);
  assert.match(html, /data-story-prepare-choices disabled/);
  assert.doesNotMatch(html, /old-batch|777|999|작업 파트:/);
  assert.equal(screen.calls.some(call => /inheritor\/(ai-status|choice-coverage)|story-visuals\//.test(call.url)), false);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
});

test('native selection triggers only the selected GET; an explicit click posts only its pair', async () => {
  const screen = view({ works: [A, B] });
  await screen.refresh();
  await screen.change(B.id);
  assert.equal(screen.posts().length, 0);
  assertScopedRead(screen.reads()[0], B);
  assert.equal(screen.state.choiceStatuses.inheritor.workId, B.id);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.deepEqual(plain(screen.posts()[0].options.body), pair(B));
  screen.reads().forEach(call => assertScopedRead(call, B));
});

test('deselecting removes pending counts and batch controls and never posts', async () => {
  const screen = view({ works: [A, B], batch: { id: 'saved-batch', status: 'review_required', partKeys: ['part-9'] } });
  await screen.refresh(); await screen.change(A.id);
  assert.match(screen.html(), /saved-batch/);
  await screen.change('');
  assert.equal(screen.choiceTargetReady(), false);
  assert.doesNotMatch(screen.html(), /saved-batch|작업 파트:|8 \/ 32파트/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 0);
});

test('deselecting a confirmed single work cannot silently auto-pin a newer release on refresh', async () => {
  const screen = view(); await screen.refresh(); await screen.change('');
  screen.setWorks([{ ...A, activeReleaseId: nextRelease }]); await screen.refresh();
  assert.equal(screen.state.choiceTarget, null); assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.reads().length, 1);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 0);
  await screen.change(A.id);
  assertScopedRead(screen.reads().at(-1), { ...A, activeReleaseId: nextRelease });
});

test('explicit selection survives refresh and catalog reordering', async () => {
  const screen = view({ works: [A, B] });
  await screen.refresh(); await screen.change(B.id);
  screen.setWorks([B, A]); await screen.refresh();
  assert.equal(screen.state.choiceTarget.workId, B.id);
  assert.equal(screen.choiceTargetReady(), true);
  screen.reads().forEach(call => assertScopedRead(call, B));
  assert.equal(screen.posts().length, 0);
});

for (const multiple of [false, true]) test(`${multiple ? 'multiple' : 'single'} work release change requires explicit reselection, even if it changes back`, async () => {
  const screen = view({ works: multiple ? [A, B] : [A] });
  await screen.refresh(); if (multiple) await screen.change(A.id);
  const readCount = screen.reads().length;
  screen.setWorks(multiple ? [{ ...A, activeReleaseId: nextRelease }, B] : [{ ...A, activeReleaseId: nextRelease }]);
  await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceTarget.releaseId, A.activeReleaseId, 'never silently changes the paid target');
  assert.equal(screen.reads().length, readCount);
  assert.match(screen.html(), /릴리스가 변경되었습니다/);
  assert.match(screen.html(), /<option value="" selected/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
  screen.setWorks(multiple ? [A, B] : [A]); await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false, 'reselection requirement cannot be erased by a subsequent refresh');
  assert.equal(screen.reads().length, readCount);
  screen.setWorks(multiple ? [{ ...A, activeReleaseId: nextRelease }, B] : [{ ...A, activeReleaseId: nextRelease }]);
  await screen.refresh(); await screen.change(A.id);
  assertScopedRead(screen.reads().at(-1), { ...A, activeReleaseId: nextRelease });
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.deepEqual(plain(screen.posts()[0].options.body), pair({ ...A, activeReleaseId: nextRelease }));
});

test('disappearing selected work does not auto-retarget to the remaining single work', async () => {
  const screen = view({ works: [A, B] });
  await screen.refresh(); await screen.change(B.id);
  screen.setWorks([A]); await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceTarget.workId, B.id);
  assert.equal(screen.reads().length, 1);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
  await screen.change(A.id);
  assertScopedRead(screen.reads().at(-1), A);
});

for (const legacyId of ['mock-work', A.id]) test(`single legacy catalog ${legacyId} preserves omitted query/body only while no pair is known`, async () => {
  const screen = view({ works: [{ ...A, id: legacyId, activeReleaseId: undefined }] });
  await screen.refresh();
  assert.equal(screen.choiceTargetReady(), true);
  assert.equal(screen.reads()[0].url, `${root}/published/inheritor/choice-status`);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 1);
  assert.equal(screen.posts()[0].options.body, undefined);
  assert.equal(screen.reads().every(call => !call.url.includes('?')), true);
});

for (const legacyId of ['mock-work', A.id]) test(`legacy status pins real IDs for ${legacyId} before all subsequent reads and paid requests`, async () => {
  const screen = view({ works: [{ ...A, id: legacyId, activeReleaseId: undefined }], readStatus: () => result(pair(A)) });
  await screen.refresh();
  assert.equal(screen.reads()[0].url, `${root}/published/inheritor/choice-status`);
  await screen.refresh();
  assertScopedRead(screen.reads().at(-1), A);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.deepEqual(plain(screen.posts()[0].options.body), pair(A));
  screen.reads().slice(1).forEach(call => assertScopedRead(call, A));
});

test('a newly advertised release cannot overwrite a pair learned from a legacy status', async () => {
  const screen = view({ works: [{ ...A, activeReleaseId: undefined }], readStatus: () => result(pair(A)) });
  await screen.refresh();
  screen.setWorks([{ ...A, activeReleaseId: nextRelease }]); await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceTarget.releaseId, A.activeReleaseId);
  assert.equal(screen.reads().length, 1);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
});

test('reselecting B after catalog release change displays mismatch in the target status region', async () => {
  let stale = false;
  const screen = view({ works: [A, B], readStatus: ids => result(stale ? pair(B) : ids) });
  await screen.refresh(); await screen.change(B.id);
  screen.setWorks([A, { ...B, activeReleaseId: nextRelease }]); await screen.refresh();
  assert.equal(screen.state.choiceTargetState, 'changed');
  stale = true; await screen.change(B.id);
  assertScopedRead(screen.reads().at(-1), { ...B, activeReleaseId: nextRelease });
  assert.equal(screen.choiceTargetReady(), false);
  assert.match(screen.html(), /data-story-choice-target-state[^>]*>조회 결과의 작품·릴리스가 선택한 대상과 다릅니다/);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 0);
});

for (const invalid of [{ ...A, id: 'not-a-uuid' }, { ...A, activeReleaseId: '' }, { ...A, activeReleaseId: 'bad-release' }]) {
  test(`malformed catalog pair ${invalid.id}/${invalid.activeReleaseId} cannot fall back to an unscoped request`, async () => {
    const screen = view({ works: [invalid] }); await screen.refresh();
    await screen.change(invalid.id); await screen.prepareInheritorChoices(screen.prepareButton);
    assert.equal(screen.reads().length, 0); assert.equal(screen.posts().length, 0);
    assert.equal(screen.choiceTargetReady(), false);
  });
}

test('multiple legacy catalogs without release IDs cannot use single-source fallback', async () => {
  const screen = view({ works: [{ ...A, activeReleaseId: undefined }, { ...B, activeReleaseId: undefined }] });
  await screen.refresh(); await screen.change(A.id); await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.reads().length, 0); assert.equal(screen.posts().length, 0);
});

for (const [label, ids] of [
  ['missing pair', {}], ['partial work', { workId: A.id }], ['partial release', { releaseId: A.activeReleaseId }],
  ['malformed pair', { workId: A.id, releaseId: 'bad-release' }], ['wrong work', pair(B)],
  ['wrong release', { workId: A.id, releaseId: nextRelease }]
]) test(`scoped status ${label} stays unknown and blocks paid prepare/review`, async () => {
  const screen = view({ readStatus: () => result(ids, { preparationBatch: { id: 'saved-batch', status: 'review_required' } }) });
  await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceTargetState, 'error');
  assert.equal(screen.state.choiceStatuses.inheritor, undefined);
  screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, true);
  await screen.prepareInheritorChoices(screen.prepareButton); await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 0);
});

test('legacy status with a partial pair is also invalid, never silently treated as old single source', async () => {
  const screen = view({ works: [{ ...A, activeReleaseId: undefined }], readStatus: () => result({ workId: A.id }) });
  await screen.refresh(); await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.choiceTargetReady(), false); assert.equal(screen.posts().length, 0);
});

test('failed GET blocks prepare and successful explicit reselection recovers with GET only', async () => {
  let fail = true;
  const screen = view({ readStatus: ids => { if (fail) throw new Error('offline'); return result(ids); } });
  await screen.refresh(); await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
  assert.match(screen.html(), /불러오지 못했습니다/);
  fail = false; await screen.change(A.id);
  assert.equal(screen.choiceTargetReady(), true); assert.equal(screen.posts().length, 0);
});

test('a pending selection clears previous batch/counts and late other-target responses are discarded', async () => {
  const old = deferred();
  const screen = view({ works: [A, B], readStatus: ids => ids.workId === A.id ? old.promise : result(ids, { preparedParts: 16 }) });
  await screen.refresh();
  const selectingA = screen.change(A.id);
  assert.equal(screen.choiceTargetReady(), false);
  assert.doesNotMatch(screen.html(), /파트에 선택지 3개 준비|작업 파트:|data-story-choice-review=/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0);
  await screen.change(B.id);
  old.resolve(result(pair(A), { preparedParts: 31, preparationBatch: { id: 'late-A', status: 'review_required' } }));
  await selectingA;
  assert.equal(screen.state.choiceTarget.workId, B.id);
  assert.equal(screen.state.choiceStatuses.inheritor.workId, B.id);
  assert.equal(screen.state.choiceStatuses.inheritor.preparedParts, 16);
  assert.doesNotMatch(screen.html(), /late-A|31 \/ 32/);
  assert.equal(screen.posts().length, 0);
});

test('late rejection from another target cannot erase the current successful selection', async () => {
  const old = deferred();
  const screen = view({ works: [A, B], readStatus: ids => ids.workId === A.id ? old.promise : result(ids) });
  await screen.refresh(); const selectingA = screen.change(A.id); await screen.change(B.id);
  old.reject(new Error('late failure')); await selectingA;
  assert.equal(screen.choiceTargetReady(), true);
  assert.equal(screen.state.choiceTarget.workId, B.id);
});

test('a late response for the same work and release is fenced by read revision', async () => {
  const old = deferred(); let reads = 0;
  const screen = view({ works: [A, B], readStatus: ids => ++reads === 1 ? old.promise : result(ids, { preparedParts: 16 }) });
  await screen.refresh(); const first = screen.change(A.id); await screen.change(A.id);
  old.resolve(result(pair(A), { preparedParts: 31 })); await first;
  assert.equal(screen.state.choiceStatuses.inheritor.preparedParts, 16);
});

test('catalog read failure clears old counts and blocks direct prepare without switching targets', async () => {
  const screen = view(); await screen.refresh(); screen.failCatalog(); await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false); assert.equal(screen.state.catalogVerified, false);
  assert.doesNotMatch(screen.html(), /8 \/ 32파트|작업 파트:/);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 0);
  assert.equal(screen.state.choiceTarget.releaseId, A.activeReleaseId);
});

for (const value of [{ status: 'unavailable' }, { preparedParts: -1 }, { preparedParts: 33 }, { totalParts: '32' }, { preparedParts: NaN }]) {
  test(`unknown or invalid status ${JSON.stringify(value)} cannot enable prepare`, async () => {
    const screen = view({ readStatus: ids => result(ids, value) }); await screen.refresh();
    await screen.prepareInheritorChoices(screen.prepareButton);
    assert.equal(screen.choiceTargetReady(), false); assert.equal(screen.posts().length, 0);
  });
}

test('a mismatched prepare response is not displayed and cannot authorize another paid request', async () => {
  const screen = view({ post: () => result(pair(B)) }); await screen.refresh();
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceStatuses.inheritor, undefined);
  assert.equal(screen.reads().length, 1, 'identity failure is not silently repaired by a new GET');
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 1);
  assert.match(screen.html(), /선택한 대상과 다릅니다/);
});

test('a late paid result from the old release cannot restore readiness after catalog release change', async () => {
  const pending = deferred(); const screen = view({ post: () => pending.promise });
  await screen.refresh(); const preparing = screen.prepareInheritorChoices(screen.prepareButton);
  screen.setWorks([{ ...A, activeReleaseId: nextRelease }]); await screen.refresh();
  pending.resolve(result(pair(A), { preparedParts: 31 })); await preparing;
  assert.equal(screen.choiceTargetReady(), false); assert.equal(screen.state.choiceTargetState, 'changed');
  assert.equal(screen.state.choiceTarget.releaseId, A.activeReleaseId);
  assert.doesNotMatch(screen.html(), /31 \/ 32파트/);
  assert.equal(screen.posts().length, 1);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 1);
});

test('prepare failure checks only its pinned status; failed recovery GET keeps retries blocked', async () => {
  let failed = false;
  const screen = view({ readStatus: ids => { if (failed) throw new Error('offline'); return result(ids); },
    post: () => { failed = true; throw new Error('provider response requires checking'); } });
  await screen.refresh(); await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 1); screen.reads().forEach(call => assertScopedRead(call, A));
  assert.equal(screen.choiceTargetReady(), false);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 1);
});

test('operator review records one separate non-generating request, then requires an explicit paid click', async () => {
  let batch = { id: 'saved-batch', status: 'review_required', reviewContextReady: true, partKeys: ['part-1', 'part-9', 'part-17'] };
  const screen = view({ readStatus: ids => result(ids, { preparationBatch: batch }), post: (url, options) => {
    if (url.endsWith('/review')) { batch = { ...batch, status: 'retry_authorized' }; return { status: 'retry_authorized' }; }
    batch = null; return result(options.body, { preparedParts: 16 });
  } });
  await screen.refresh();
  screen.confirm.checked = false; screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, true);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton); assert.equal(screen.posts().length, 0);
  screen.confirm.checked = true; screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, false);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 1); assert.match(screen.posts()[0].url, /\/choice-batches\/saved-batch\/review$/);
  assert.deepEqual(plain(screen.posts()[0].options.body), { outcome: 'no_reusable_response_confirmed', reviewNote: screen.note.value });
  assert.match(screen.status.textContent, /다음 AI 배치는 별도로 요청/);
  assert.equal(screen.state.reviewingBatchId, null);
  assert.match(screen.statusCards.innerHTML, /<select data-story-choice-target\s*>/, 'final DOM unlocks target selection without a test-triggered render');
  assert.match(screen.statusCards.innerHTML, /data-story-prepare-choices\s*>/, 'final DOM unlocks the separately requested paid retry');
  assert.doesNotMatch(screen.statusCards.innerHTML, /data-story-prepare-choices disabled/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 2); assert.deepEqual(plain(screen.posts()[1].options.body), pair(A));
});

test('verified legacy single target still supports missing context fields and a separately requested paid retry', async () => {
  let batch = { id: 'saved-batch', status: 'review_required' };
  const screen = view({ works: [{ ...A, id: 'mock-work', activeReleaseId: undefined }],
    readStatus: ids => result(ids, { preparationBatch: batch }), post: (url, options) => {
      if (url.endsWith('/review')) { batch = { ...batch, status: 'retry_authorized' }; return { status: 'retry_authorized' }; }
      batch = null; return result(options.body || {});
    } });
  await screen.refresh(); screen.updateChoiceReviewButton(screen.review);
  assert.equal(screen.reviewButton.disabled, false);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 1); assert.match(screen.posts()[0].url, /\/review$/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 2); assert.equal(screen.posts()[1].options.body, undefined);
});

for (const [code, phrase] of [
  ['STORY_PUBLICATION_CHOICE_SOURCE_CHANGED', /작업 당시의 원고와 현재 원고가 다릅니다/],
  ['STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', /현재 승인된 설정이 다릅니다/]
]) for (const action of ['review', 'prepare']) test(`verified ${action} preserves Korean guidance for ${code} without automatic paid retries`, async () => {
  const screen = view({ batch: action === 'review' ? { id: 'saved-batch', status: 'review_required', reviewContextReady: true } : null,
    post: () => { throw Object.assign(new Error('private diagnostic'), { body: { error: { code } } }); } });
  await screen.refresh();
  if (action === 'review') await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  else await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 1);
  assert.match(screen.state.choiceFeedback, phrase);
  assert.match(screen.state.choiceFeedback, /유료 재시도는 별도로 요청/);
  assert.doesNotMatch(screen.state.choiceFeedback, /private diagnostic/);
});

test('explicit false saved context remains blocked even on a verified target', async () => {
  const screen = view({ batch: { id: 'saved-batch', status: 'review_required', reviewContextReady: false, partKeys: [] } });
  await screen.refresh(); screen.updateChoiceReviewButton(screen.review);
  assert.equal(screen.reviewButton.disabled, true);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton); await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 0); assert.match(screen.html(), /옛 작업 범위를 먼저 확인/);
});

for (const unavailable of [false, true]) test(`confirmed false context survives a subsequent ${unavailable ? 'unavailable projection' : 'failed read'} without enabling actions`, async () => {
  let failed = false;
  const batch = { id: 'saved-batch', status: 'retry_authorized', reviewContextReady: false, partKeys: [] };
  const screen = view({ readStatus: ids => {
    if (failed) { if (unavailable) return { status: 'unavailable' }; throw new Error('offline'); }
    return result(ids, { preparationBatch: batch });
  } });
  await screen.refresh(); failed = true; await screen.refresh();
  assert.equal(screen.choiceTargetReady(), false);
  assert.equal(screen.state.choiceStatuses.inheritor.preparationBatch.reviewContextReady, false);
  assert.match(screen.html(), /옛 작업 범위를 먼저 확인/);
  await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 0);
});

for (const initialWorks of [[A], [A, B]]) test(`unverified pinned statuses block mutations even after other works are hidden (${initialWorks.length} initial works)`, async () => {
  const screen = view({ works: initialWorks }); await screen.refresh();
  if (initialWorks.length > 1) await screen.change(A.id);
  screen.setWorks([A]); await screen.refresh();
  screen.state.aiStatuses.inheritor = { status: 'active', active: true };
  screen.state.choiceCoverage.inheritor = { status: 'ready', totalScenes: 777, distribution: { threeValid: 777 } };
  screen.state.visualStatuses.inheritor = { status: 'ready', releaseId: A.activeReleaseId, releaseChecksum: 'checksum', staleCount: 777, items: [{ sourceSceneKey: 'old-source' }] };
  const html = screen.html();
  assert.doesNotMatch(html, /777|old-source|data-story-visual-replace=/);
  assert.match(html, /작품·릴리스별 AI 대상 확인 전/);
  screen.updateAiActivationButton(screen.aiCard); assert.equal(screen.aiButton.disabled, true);
  await screen.activateAi(screen.aiButton); await screen.replaceStoryVisual(screen.visualButton);
  assert.equal(screen.posts().length, 0);
  const reads = screen.calls.filter(call => /inheritor\/(ai-status|choice-coverage)|story-visuals\//.test(call.url));
  assert.ok(reads.length >= 2, 'status verification is attempted, never silently skipped');
  for (const call of reads) {
    const url = new URL(call.url, 'https://unit.invalid');
    if (url.pathname.includes('/story-visuals/')) assert.equal(url.pathname, `/admin/api/v1/story-visuals/${A.id}/replacement-status`);
    else assert.deepEqual(Object.fromEntries(url.searchParams), pair(A), 'no unscoped or arbitrary first-source reads');
  }
});

test('long and unsafe slug uses short option text and escaped exact identifiers in a wrapping details region', async () => {
  const slug = `${A.slug}-${'long'.repeat(80)}-<img src=x onerror=alert(1)>`;
  const screen = view({ works: [{ ...A, slug }] }); await screen.refresh();
  const html = screen.html(), options = [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
  assert.ok(options.every(label => label.length < 45));
  assert.match(html, /class="story-choice-target-facts"/);
  assert.ok(html.includes(slug.replace(/</g, '&lt;').replace(/>/g, '&gt;')));
  assert.doesNotMatch(html, /<img src=x/);
  assert.ok(html.includes(A.id)); assert.ok(html.includes(A.activeReleaseId));
  assert.match(css, /\.story-choice-target-label select\s*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*max-width: 100%;[^}]*min-width: 0;/);
  assert.match(css, /\.story-choice-target-facts dd\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
});

test('mobile publication actions keep native scrolling clear of the fixed navigation and imageless rows use available width', () => {
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.story-publication-controls \[data-story-ai-activate\],\s*\.story-publication-controls \[data-story-visual-replace\],\s*\.story-publication-controls \[data-story-prepare-choices\],\s*\.story-publication-controls \[data-story-review-batch\]\s*\{\s*scroll-margin-bottom: calc\(108px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(css, /\.story-visual-review-row:not\(:has\(img\)\)\s*\{\s*grid-template-columns: minmax\(0, 1fr\) auto;/);
});

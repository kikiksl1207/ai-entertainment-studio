import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const root = '/admin/api/v1/backstage/story-publication';
const scope = ['part-1', 'part-9', 'part-17'];
const initialBatch = overrides => ({ id: 'saved-batch', status: 'review_required',
  reviewContextReady: true, partKeys: [...scope], ...overrides });
const failure = (code, nested = true) => Object.assign(new Error('Private diagnostic must not be shown'), {
  body: nested ? { error: { code, details: { reason: 'private source/settings fingerprint' } } } : { code }
});

function view({ batch = initialBatch(), postError = null, readFails = false, unavailable = false } = {}) {
  const calls = [], statusCards = { innerHTML: '', addEventListener() {} }, list = { innerHTML: '', addEventListener() {} };
  const status = { textContent: '', className: '' }, inlineStatus = { textContent: '', className: '' };
  let choiceStatus = { status: 'preparing_choices', preparedParts: 8, totalParts: 265, preparationBatch: structuredClone(batch) };
  const publishedWorks = [{ id: 'local-work', status: 'published', slug: 'the-killer-inherits-the-dead-local' }];
  const api = { fetch: async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') {
      assert.ok(url === `${root}/published/inheritor/prepare-choices` || url === `${root}/published/inheritor/choice-batches/saved-batch/review`);
      if (postError) throw postError;
      if (url.endsWith('/review')) {
        choiceStatus = { ...choiceStatus, preparationBatch: { ...choiceStatus.preparationBatch, status: 'retry_authorized' } };
        return { status: 'retry_authorized', batchId: 'saved-batch' };
      }
      choiceStatus = { ...choiceStatus, preparedParts: 16, preparationBatch: null };
      return choiceStatus;
    }
    if (url === `${root}/submissions`) return { items: [], publishedWorks };
    if (url.endsWith('/published/inheritor/choice-status')) {
      if (readFails) throw new Error('Local status read unavailable');
      return unavailable ? { status: 'unavailable' } : structuredClone(choiceStatus);
    }
    return { status: 'unavailable', active: false, items: [], readyCount: 0, staleCount: 0 };
  } };
  const context = createContext({ window: { LuminaBackstageApi: api }, document: {
    getElementById: id => ({ storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list, storyPublicationState: status })[id] || null,
    querySelector: () => null, querySelectorAll: () => []
  } });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__choiceTest = { state, renderStoryStatus, updateChoiceReviewButton, reviewInheritorChoiceBatch, prepareInheritorChoices, load };\n})();');
  assert.notEqual(testSource, source); runInContext(testSource, context);
  const handlers = context.__choiceTest;
  handlers.state.publishedWorks = publishedWorks; handlers.state.choiceStatuses.inheritor = structuredClone(choiceStatus);
  handlers.state.catalogVerified = true;
  handlers.state.choiceTargetState = 'ready';
  handlers.state.choiceTarget = { catalogId: publishedWorks[0].id, catalogSlug: publishedWorks[0].slug,
    catalogReleaseId: null, workId: null, releaseId: null, lastStatus: handlers.state.choiceStatuses.inheritor };
  const note = { value: '제공자 응답과 청구 기록을 확인했고 재사용할 결과가 없습니다.' }, confirm = { checked: true };
  const reviewButton = { dataset: { storyReviewBatch: 'saved-batch' }, disabled: false, closest: () => review };
  const review = { querySelector: selector => ({ '[data-story-choice-review-note]': note,
    '[data-story-choice-review-confirm]': confirm, '[data-story-review-batch]': reviewButton })[selector] || null };
  const prepareButton = { disabled: false, textContent: '', closest: () => ({ querySelector: () => inlineStatus }) };
  const html = () => {
    handlers.renderStoryStatus();
    return [...statusCards.innerHTML.matchAll(/<article class="story-publication-status-item">[\s\S]*?<\/article>/g)]
      .map(([value]) => value).find(value => value.includes('<h3>살인자는 죽은 자의 능력을 계승한다</h3>'));
  };
  return { ...handlers, calls, status, inlineStatus, statusCards, reviewButton, prepareButton, review, note, confirm, html,
    posts: () => calls.filter(call => call.options.method === 'POST') };
}

test('actual server part-1/part-9/part-17 keys display exact Korean part numbers without inferring a range', () => {
  const screen = view();
  const html = screen.html();
  assert.match(html.replace(/<wbr>/g, ''), /작업 파트: 1,9,17/);
  assert.doesNotMatch(html, /작업 파트: 1[-~]17|작업 파트: 9[-~]16/);
  assert.equal((html.match(/<wbr>/g) || []).length, 2, 'scope can wrap at commas on narrow screens');
  assert.match(html, /제공자 응답·청구 내역을 먼저 확인/);
  assert.match(html, /재시도는 별도 요청이며 추가 비용/);
  assert.equal(screen.calls.length, 0);
  assert.deepEqual(screen.state.choiceStatuses.inheritor.preparationBatch.partKeys, scope, 'display formatting never changes the saved keys');
  assert.doesNotMatch(html, /작업 파트: part-/);
});

test('numeric legacy part keys retain their display and noncanonical keys are not relabeled', () => {
  const screen = view({ batch: initialBatch({ partKeys: ['1', '9', '17', 'part-final', 'prefix-part-2'] }) });
  assert.match(screen.html().replace(/<wbr>/g, ''), /작업 파트: 1,9,17,part-final,prefix-part-2/);
});

test('all eight saved keys stay in server order and untrusted text is escaped', () => {
  const partKeys = ['part-1', 'part-9', 'part-17', 'part-25', 'part-33', 'part-41', 'part-49', '<img src=x onerror=alert(1)>'];
  const screen = view({ batch: initialBatch({ partKeys }) }), html = screen.html().replace(/<wbr>/g, '');
  assert.match(html, /작업 파트: 1,9,17,25,33,41,49,&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

for (const status of ['review_required', 'retry_authorized', 'in_progress']) {
  test(`explicit false context disables review and paid retry for ${status}`, async () => {
    const screen = view({ batch: initialBatch({ status, reviewContextReady: false, partKeys: [], updatedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString() }) });
    const html = screen.html();
    assert.match(html, /옛 작업 범위를 먼저 확인/); assert.match(html, /이전 작업 범위 확인 필요/);
    assert.match(html, /data-story-prepare-choices disabled/); assert.doesNotMatch(html, /작업 파트:/);
    if (status !== 'retry_authorized') {
      assert.match(html, /data-story-review-batch="saved-batch" disabled/);
      assert.match(html, /data-story-choice-review-note[^>]* disabled/);
      assert.match(html, /data-story-choice-review-confirm disabled/);
    }
    screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, true);
    await screen.reviewInheritorChoiceBatch(screen.reviewButton); await screen.prepareInheritorChoices(screen.prepareButton);
    assert.equal(screen.calls.length, 0, 'disabled actions also reject direct handler invocation');
  });
}

test('old server projections missing both fields preserve review then separate paid retry', async () => {
  const screen = view({ batch: { id: 'saved-batch', status: 'review_required' } });
  assert.doesNotMatch(screen.html(), /작업 파트:|옛 작업 범위|이전 작업 범위 확인 필요/);
  screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, false);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 1); assert.match(screen.posts()[0].url, /\/review$/);
  assert.deepEqual(JSON.parse(JSON.stringify(screen.posts()[0].options.body)), {
    outcome: 'no_reusable_response_confirmed', reviewNote: screen.note.value
  });
  assert.match(screen.status.textContent, /다음 AI 배치는 별도로 요청/);
  assert.doesNotMatch(screen.html(), /data-story-prepare-choices disabled/);
  await screen.prepareInheritorChoices(screen.prepareButton);
  assert.equal(screen.posts().length, 2); assert.match(screen.posts()[1].url, /\/prepare-choices$/);
  assert.equal(screen.posts()[1].options.auth, true); assert.equal(screen.posts()[1].options.body, undefined);
});

test('context-ready review remains gated by confirmation and records only one non-generating request', async () => {
  const screen = view();
  screen.confirm.checked = false; screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, true);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton); assert.equal(screen.posts().length, 0);
  screen.confirm.checked = true; screen.note.value = '짧음'; screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, true);
  screen.note.value = '제공자 청구 내역과 응답을 직접 확인했습니다.';
  screen.updateChoiceReviewButton(screen.review); assert.equal(screen.reviewButton.disabled, false);
  await screen.reviewInheritorChoiceBatch(screen.reviewButton);
  assert.equal(screen.posts().length, 1); assert.match(screen.posts()[0].url, /\/review$/);
  assert.match(screen.html().replace(/<wbr>/g, ''), /작업 파트: 1,9,17/);
});

for (const [code, phrase] of [
  ['STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED', /정확한 파트·장면과 생성 기준이 저장되어 있지/],
  ['STORY_CHOICE_PREPARATION_CONTEXT_CHANGED', /현재 원고·승인 설정과 달라졌습니다/],
  ['STORY_CHOICE_PREPARATION_SOURCE_CHANGED', /작업 당시의 원고와 현재 원고가 다릅니다/],
  ['STORY_CHOICE_PREPARATION_SETTINGS_CHANGED', /현재 승인된 설정이 다릅니다/],
  ['STORY_PUBLICATION_CHOICE_SOURCE_CHANGED', /작업 당시의 원고와 현재 원고가 다릅니다/],
  ['STORY_PUBLICATION_CHOICE_SETTINGS_CHANGED', /현재 승인된 설정이 다릅니다/],
  ['STORY_CHOICE_PREPARATION_RETRY_UNAVAILABLE', /현재 생성 재시도가 허용되지/]
]) for (const action of ['review', 'prepare']) {
  test(`${action} translates ${code} without automatically starting or repeating generation`, async () => {
    const screen = view({ batch: initialBatch({ status: action === 'review' ? 'review_required' : 'retry_authorized' }),
      postError: failure(code, action === 'review'), readFails: true });
    await (action === 'review' ? screen.reviewInheritorChoiceBatch(screen.reviewButton) : screen.prepareInheritorChoices(screen.prepareButton));
    assert.equal(screen.posts().length, 1);
    assert.match(screen.status.textContent, phrase); assert.match(screen.html(), phrase);
    assert.match(screen.status.textContent, /유료 재시도는 별도로 요청/);
    assert.doesNotMatch(screen.status.textContent + screen.html(), /Private diagnostic|private source|STORY_(?:CHOICE_PREPARATION|PUBLICATION_CHOICE)_/);
    assert.match(screen.status.className, /is-error/);
    if (action === 'prepare') assert.equal(screen.calls.filter(call => call.url.endsWith('/choice-status')).length, 1, 'failure reconciles only with a read');
    if (code === 'STORY_CHOICE_PREPARATION_CONTEXT_REQUIRED') {
      assert.equal(screen.state.choiceStatuses.inheritor.preparationBatch.reviewContextReady, false);
      assert.match(screen.html(), /data-story-prepare-choices disabled/);
      await screen.prepareInheritorChoices(screen.prepareButton); assert.equal(screen.posts().length, 1);
    }
  });
}

for (const readFails of [true, false]) {
  test(`unavailable status ${readFails ? 'read' : 'projection'} does not erase a known legacy context block`, async () => {
    const screen = view({ batch: initialBatch({ status: 'retry_authorized', reviewContextReady: false, partKeys: [] }), readFails, unavailable: true });
    await screen.load({ force: true });
    assert.equal(screen.state.choiceStatuses.inheritor.status, 'unavailable');
    assert.equal(screen.state.choiceStatuses.inheritor.preparationBatch.reviewContextReady, false);
    assert.match(screen.html(), /data-story-prepare-choices disabled/);
    await screen.reviewInheritorChoiceBatch(screen.reviewButton); await screen.prepareInheritorChoices(screen.prepareButton);
    assert.equal(screen.posts().length, 0);
  });
}

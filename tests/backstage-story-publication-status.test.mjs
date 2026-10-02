import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const monsterWork = { id: '10000000-0000-4000-8000-000000000003',
  activeReleaseId: '20000000-0000-4000-8000-000000000003', slug: 'the-monster-that-did-not-eat-my-name', status: 'published' };
const pair = work => ({ workId: work.id, releaseId: work.activeReleaseId });
const readyPreparation = { totalParts: 32, preparedParts: 32, remainingParts: 0, ready: true, phase: 'ready' };
function coverageFixture(total = 32) {
  return { status: 'ready', totalParts: total, totalScenes: total, partsWithoutScenes: 0,
    distribution: { zero: 0, one: 0, two: 0, threeValid: total, otherOrInvalid: 0 },
    routeIssues: { duplicateImmediateTargets: 0, invalidDirectTargets: 0 }, incompleteExamples: [] };
}

function bindFixedStatus(state, key, kind, value) {
  const workId = `10000000-0000-4000-8000-00000000000${{ imjin: 1, norse: 2, monster: 3, rebellion: 4 }[key]}`;
  const work = state.publishedWorks.find(item => item.id === workId);
  const collection = kind === 'ai' ? 'aiStatuses' : 'choiceCoverage';
  const paired = { ...pair(work), ...value };
  state[collection][key] = paired;
  state.fixedReads[key] ??= {};
  state.fixedReads[key][kind] = { ...pair(work), revision: state.catalogRevision,
    sequence: ++state.fixedReadSequence, status: 'verified', value: paired };
}

function publicationView() {
  const statusCards = { innerHTML: '', addEventListener() {} };
  const context = createContext({
    URLSearchParams,
    window: { LuminaBackstageApi: null },
    document: {
      getElementById(id) { return id === 'storyPublicationStatusCards' ? statusCards : null; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__publicationTest = { state, knownStories, renderStoryStatus };\n})();');
  assert.notEqual(testSource, source);
  runInContext(testSource, context);
  const { state, knownStories, renderStoryStatus } = context.__publicationTest;
  state.catalogVerified = true;
  state.catalogRevision = 1;
  state.publishedWorks = knownStories.map((story, index) => ({ slug: story.slug, status: 'published',
    id: `10000000-0000-4000-8000-00000000000${index + 1}`,
    activeReleaseId: `20000000-0000-4000-8000-00000000000${index + 1}` }));
  for (const key of ['imjin', 'norse', 'monster', 'rebellion']) {
    bindFixedStatus(state, key, 'ai', { status: ['imjin', 'norse'].includes(key) ? 'active' : 'inactive',
      active: ['imjin', 'norse'].includes(key), ...(['monster', 'rebellion'].includes(key) ? { choicePreparation: { ...readyPreparation } } : {}) });
    bindFixedStatus(state, key, 'coverage', coverageFixture());
  }
  renderStoryStatus();
  return {
    state,
    knownStories,
    renderStoryStatus,
    card(title) {
      return [...statusCards.innerHTML.matchAll(/<article class="story-publication-status-item">[\s\S]*?<\/article>/g)]
        .map(([html]) => html)
        .find((html) => html.includes(`<h3>${title}</h3>`));
    }
  };
}

test('published monster and rebellion manuscripts do not appear AI-ready while branching is inactive', () => {
  const view = publicationView();
  for (const title of ['내 이름을 먹지 않은 괴물', '우리는 서로의 몸에 반역을 썼다']) {
    const card = view.card(title);
    assert.match(card, /<span class="status-badge is-review">원고 공개 \/ AI 분기 미활성<\/span>/);
    assert.match(card, /원고는 독자 화면에 공개 중/);
    assert.match(card, /data-story-ai-card="(?:monster|rebellion)"/);
    assert.equal(card.match(/data-story-ai-confirm/g)?.length, 4);
    assert.match(card, /data-story-ai-activate="(?:monster|rebellion)" disabled/);
    assert.doesNotMatch(card, /<span class="status-badge is-approved">공개 완료<\/span>/);
  }
  const activeCard = view.card('임진왜란');
  assert.match(activeCard, /<span class="status-badge is-approved">원고 공개 \/ AI 생성 활성<\/span>/);
  assert.match(activeCard, /분기 장면은 독자 선택 후 생성/);
  assert.match(activeCard, /분기 장면이 미리 생성된 상태는 아닙니다/);
  assert.equal(activeCard.match(/data-story-ai-confirm/g)?.length, 4);
  assert.match(activeCard, /data-story-ai-activate="imjin" disabled>AI 설정 갱신/);
  assert.doesNotMatch(activeCard, /<span class="status-badge is-approved">공개 완료<\/span>/);
});

test('unavailable AI status is shown as unknown, not inactive', () => {
  const view = publicationView();
  bindFixedStatus(view.state, 'rebellion', 'ai', { status: 'unavailable', active: false });
  view.renderStoryStatus();
  const card = view.card('우리는 서로의 몸에 반역을 썼다');
  assert.match(card, /<span class="status-badge is-review">원고 공개 \/ AI 분기 확인 필요<\/span>/);
  assert.match(card, /AI 분기 생성<\/strong><span class="status-badge is-review">확인 필요<\/span>/);
  assert.match(card, /data-story-ai-activate="rebellion" disabled/);
});

test('contradictory AI status is not presented as active or branch-ready', () => {
  const view = publicationView();
  bindFixedStatus(view.state, 'rebellion', 'ai', { status: 'inactive', active: true, choicePreparation: readyPreparation });
  view.renderStoryStatus();
  const card = view.card('우리는 서로의 몸에 반역을 썼다');
  assert.match(card, /원고 공개 \/ AI 분기 확인 필요/);
  assert.match(card, /AI 분기 생성<\/strong><span class="status-badge is-review">확인 필요<\/span>/);
  assert.doesNotMatch(card, /분기 장면이 미리 생성된 상태는 아닙니다/);
});

test('a published non-AI work retains its publication status and fixed-route controls', () => {
  const view = publicationView();
  view.knownStories.find((story) => story.key === 'norse').aiActivationAvailable = false;
  bindFixedStatus(view.state, 'norse', 'ai', { status: 'inactive', active: false });
  view.renderStoryStatus();
  const card = view.card('북유럽신화');
  assert.match(card, /<span class="status-badge is-approved">공개 완료<\/span>/);
  assert.match(card, /고정 메인 루트/);
  assert.doesNotMatch(card, /data-story-ai-card|data-story-ai-activate/);
});

test('inheritor shows choice preparation progress and blocks activation until ready', () => {
  const view = publicationView();
  view.state.publishedWorks.push({ slug: 'the-killer-inherits-the-dead-abc', status: 'published' });
  view.state.aiStatuses.inheritor = { status: 'inactive', active: false };
  view.state.choiceStatuses.inheritor = { status: 'preparing_choices', preparedParts: 12, totalParts: 265 };
  view.renderStoryStatus();
  const pending = view.card('살인자는 죽은 자의 능력을 계승한다');
  assert.match(pending, /12 \/ 265파트에 선택지 3개 준비/);
  assert.match(pending, /data-story-prepare-choices/);
  assert.match(pending, /한 번에 최대 8파트를 AI로 준비/);
  assert.match(pending, /다음 최대 8파트 준비/);
  assert.match(pending, /선택지 3개 준비가 끝나면 활성화/);

  view.state.choiceStatuses.inheritor.preparationBatch = {
    id: 'review-batch-id', status: 'review_required'
  };
  view.renderStoryStatus();
  const review = view.card('살인자는 죽은 자의 능력을 계승한다');
  assert.match(review, /제공자 응답·청구 내역을 확인한 뒤 운영자 검토/);
  assert.match(review, /작업 ID: review-batch-id/);
  assert.match(review, /data-story-choice-review-note/);
  assert.match(review, /data-story-choice-review-confirm/);
  assert.match(review, /data-story-review-batch="review-batch-id" disabled/);
  assert.match(review, /data-story-prepare-choices disabled/);

  view.state.choiceStatuses.inheritor = {
    status: 'ready', preparedParts: 265, totalParts: 265,
    slug: 'the-killer-inherits-the-dead-abc'
  };
  view.renderStoryStatus();
  const ready = view.card('살인자는 죽은 자의 능력을 계승한다');
  assert.match(ready, /준비 완료/);
  assert.doesNotMatch(ready, /data-story-prepare-choices/);
  assert.match(ready, /data-story-ai-activate="inheritor"/);
  assert.match(ready, /href="\/story-stage\?slug=the-killer-inherits-the-dead-abc"/);
});

test('fixed-route preparation shows a bounded next batch rather than activation success', () => {
  const view = publicationView();
  bindFixedStatus(view.state, 'monster', 'ai', {
    status: 'active', active: true,
    choicePreparation: { totalParts: 32, preparedParts: 8, remainingParts: 24,
      ready: false, phase: 'preparing', publicChoiceSet: 'legacy' }
  });
  view.renderStoryStatus();
  const card = view.card('내 이름을 먹지 않은 괴물');
  assert.match(card, /원고 공개 \/ 선택지 준비 중/);
  assert.match(card, /8 \/ 32파트 선택지 준비/);
  assert.match(card, /기존 선택지는 독자에게 계속 공개 중/);
  assert.match(card, /is-approved">활성/);
  assert.match(card, /data-story-ai-activate="monster" disabled>다음 최대 8파트 준비/);
  assert.doesNotMatch(card, /AI 설정 갱신|AI 분기 활성화<\/button>/);
  view.state.aiStatuses.monster.choicePreparation = {
    totalParts: 32, preparedParts: 32, remainingParts: 0,
    ready: false, phase: 'awaiting_promotion', publicChoiceSet: 'legacy'
  };
  view.renderStoryStatus();
  assert.match(view.card('내 이름을 먹지 않은 괴물'), /disabled>준비된 선택지 적용/);
});

test('published coverage distinguishes an active AI grant from one-choice scenes', () => {
  const view = publicationView();
  bindFixedStatus(view.state, 'monster', 'coverage', {
    ...coverageFixture(), totalScenes: 32, partsWithoutScenes: 0,
    distribution: { zero: 0, one: 24, two: 0, threeValid: 8, otherOrInvalid: 0 },
    incompleteExamples: [{ partPosition: 2, sceneKey: 'chapter-end', choiceCount: 1 }]
  });
  bindFixedStatus(view.state, 'monster', 'ai', { status: 'active', active: true,
    choicePreparation: { totalParts: 32, preparedParts: 8, remainingParts: 24, ready: false, phase: 'preparing' } });
  view.renderStoryStatus();
  const card = view.card('내 이름을 먹지 않은 괴물');
  assert.match(card, /공개 장면 선택지 점검/);
  assert.match(card, /미완료 장면 있음/);
  assert.match(card, /선택지 3개 8 · 2개 0 · 1개 24/);
  assert.match(card, /2파트 chapter-end \(1개\)/);
  assert.match(card, /AI 분기 생성<\/strong><span class="status-badge is-approved">활성/);
});

test('three choices sharing an immediate target remain a review warning', () => {
  const view = publicationView();
  bindFixedStatus(view.state, 'norse', 'coverage', {
    ...coverageFixture(216), totalScenes: 216, partsWithoutScenes: 0,
    distribution: { zero: 0, one: 0, two: 0, threeValid: 216, otherOrInvalid: 0 },
    routeIssues: { duplicateImmediateTargets: 1, invalidDirectTargets: 0 },
  });
  view.renderStoryStatus();
  const card = view.card('북유럽신화');
  assert.match(card, /미완료 장면 있음/);
  assert.match(card, /같은 다음 장면으로 바로 연결된 선택지: 1장면/);
});

test('activation action takes one paid-capable batch per click and reports success only when active', async () => {
  const statusCards = { innerHTML: '', addEventListener() {} };
  const list = { innerHTML: '', addEventListener() {} };
  const status = { textContent: '', className: '' };
  let posts = 0;
  const api = { fetch: async (url, options) => {
    const path = new URL(url, 'https://unit.invalid').pathname;
    if (path.endsWith('/published/monster/activate-ai') && options?.method === 'POST') {
      posts += 1;
      return posts === 1
        ? { ...pair(monsterWork), status: 'preparing_choices', active: true, phase: 'preparing',
          totalParts: 32, preparedParts: 8, remainingParts: 24 }
        : { ...pair(monsterWork), status: 'active', active: true };
    }
    if (url.endsWith('/submissions')) return {
      items: [], publishedWorks: [monsterWork]
    };
    if (path.endsWith('/published/monster/choice-coverage')) return { ...pair(monsterWork), ...coverageFixture() };
    if (path.endsWith('/published/monster/ai-status')) return posts === 1
      ? { ...pair(monsterWork), status: 'active', active: true,
        choicePreparation: { totalParts: 32, preparedParts: 8, remainingParts: 24,
          ready: false, phase: 'preparing', publicChoiceSet: 'legacy' } }
      : { ...pair(monsterWork), status: 'active', active: true, choicePreparation: { ...readyPreparation } };
    return { status: 'unavailable', active: false };
  } };
  const context = createContext({
    URLSearchParams,
    window: { LuminaBackstageApi: api },
    document: {
      getElementById(id) {
        return { storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list,
          storyPublicationState: status }[id] || null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__publicationTest = { state, load, activateAi };\n})();');
  runInContext(testSource, context);
  const { state, load, activateAi } = context.__publicationTest;
  const button = () => {
    const inlineStatus = { textContent: '', className: '' };
    const tag = [...statusCards.innerHTML.matchAll(/<section\b[^>]*>/g)].map(([value]) => value)
      .find(value => value.includes('data-story-ai-card="monster"'));
    const card = { dataset: { storyAiCard: 'monster', storyTargetRevision: String(state.catalogRevision),
      storyAiReview: tag?.match(/data-story-ai-review="([^"]*)"/)?.[1],
      storyAiRead: String(state.fixedReads.monster.ai.sequence), storyCoverageRead: String(state.fixedReads.monster.coverage.sequence) },
      querySelector(selector) { return selector === '[data-story-ai-status]' ? inlineStatus : control; },
      querySelectorAll() { return Array.from({ length: 4 }, () => ({ checked: true })); }
    };
    const control = { dataset: { storyAiActivate: 'monster' }, disabled: false, textContent: '',
      closest() { return card; } };
    return control;
  };

  await load({ force: true });
  await activateAi(button());
  assert.equal(posts, 1);
  assert.match(status.textContent, /8 \/ 32파트 준비/);
  assert.match(status.textContent, /기존 AI 활성화는 유지됩니다/);
  assert.doesNotMatch(status.textContent, /활성화했습니다/);
  assert.match(statusCards.innerHTML, /다음 최대 8파트 준비/);

  await activateAi(button());
  assert.equal(posts, 2);
  assert.match(status.textContent, /설정을 갱신했습니다/);
  assert.match(statusCards.innerHTML, /32 \/ 32파트 선택지 준비/);
});

test('published inheritor preparation runs one paid-capable batch per click', async () => {
  const statusCards = { innerHTML: '', addEventListener() {} };
  const list = { innerHTML: '', addEventListener() {} };
  const status = { textContent: '', className: '' };
  let posts = 0;
  let failNext = false;
  const api = { fetch: async (url, options) => {
    if (url.endsWith('/published/inheritor/prepare-choices') && options?.method === 'POST') {
      posts += 1;
      if (failNext) throw new Error('제공자 응답 확인 필요');
      return { status: 'preparing_choices', preparedParts: posts * 8, totalParts: 265 };
    }
    if (url.endsWith('/submissions')) return {
      items: [], publishedWorks: [{ id: 'inheritor-work',
        slug: 'the-killer-inherits-the-dead-test', status: 'published' }]
    };
    if (url.endsWith('/published/inheritor/choice-status')) return {
      status: 'preparing_choices', preparedParts: Math.min(posts, 2) * 8, totalParts: 265,
      preparationBatch: failNext ? { id: 'review-batch-id', status: 'review_required' } : null
    };
    return { status: 'unavailable', active: false };
  } };
  const context = createContext({
    URLSearchParams,
    window: { LuminaBackstageApi: api },
    document: {
      getElementById(id) {
        return { storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list,
          storyPublicationState: status }[id] || null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__publicationTest = { state, load, prepareInheritorChoices };\n})();');
  runInContext(testSource, context);
  const { load, prepareInheritorChoices } = context.__publicationTest;
  const button = () => {
    const inlineStatus = { textContent: '', className: '' };
    const card = { querySelector(selector) {
      return selector === '[data-story-choice-status]' ? inlineStatus : null;
    } };
    return { disabled: false, textContent: '', closest() { return card; } };
  };

  await load({ force: true });
  await prepareInheritorChoices(button());
  assert.equal(posts, 1);
  assert.match(status.textContent, /8 \/ 265파트 준비/);
  assert.match(status.textContent, /다음 배치는 별도로 실행/);
  await prepareInheritorChoices(button());
  assert.equal(posts, 2);
  assert.match(status.textContent, /16 \/ 265파트 준비/);
  assert.match(statusCards.innerHTML, /data-story-prepare-choices /);
  assert.doesNotMatch(statusCards.innerHTML, /data-story-prepare-choices disabled/);

  failNext = true;
  await prepareInheritorChoices(button());
  assert.equal(posts, 3);
  assert.match(status.textContent, /제공자 응답 확인 필요/);
  assert.match(statusCards.innerHTML, /작업 ID: review-batch-id/);
  assert.match(statusCards.innerHTML, /data-story-prepare-choices disabled/);
});

test('reviewing an interrupted choice batch records evidence without starting paid generation', async () => {
  const statusCards = { innerHTML: '', addEventListener() {} };
  const list = { innerHTML: '', addEventListener() {} };
  const status = { textContent: '', className: '' };
  const calls = [];
  let reviewed = false;
  const api = { fetch: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/choice-batches/review-batch-id/review')) {
      reviewed = true;
      return { status: 'retry_authorized', batchId: 'review-batch-id' };
    }
    if (url.endsWith('/submissions')) return {
      items: [], publishedWorks: [{ id: 'inheritor-work',
        slug: 'the-killer-inherits-the-dead-test', status: 'published' }]
    };
    if (url.endsWith('/published/inheritor/choice-status')) return {
      status: 'preparing_choices', preparedParts: 8, totalParts: 265,
      preparationBatch: { id: 'review-batch-id', status: reviewed ? 'retry_authorized' : 'review_required' }
    };
    return { status: 'unavailable', active: false };
  } };
  const context = createContext({
    URLSearchParams,
    window: { LuminaBackstageApi: api },
    document: {
      getElementById(id) {
        return { storyPublicationStatusCards: statusCards, storyPublicationSubmissionList: list,
          storyPublicationState: status }[id] || null;
      },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    }
  });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__publicationTest = { state, load, reviewInheritorChoiceBatch };\n})();');
  runInContext(testSource, context);
  const { load, reviewInheritorChoiceBatch } = context.__publicationTest;
  const note = { value: 'Provider response and billing logs checked; no reusable result exists.' };
  const confirm = { checked: true };
  const button = { dataset: { storyReviewBatch: 'review-batch-id' }, disabled: false,
    closest() { return review; } };
  const review = { querySelector(selector) {
    return { '[data-story-choice-review-note]': note,
      '[data-story-choice-review-confirm]': confirm,
      '[data-story-review-batch]': button }[selector] || null;
  } };

  await load({ force: true });
  await reviewInheritorChoiceBatch(button);
  const posts = calls.filter(({ options }) => options?.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /choice-batches\/review-batch-id\/review$/);
  assert.equal(posts[0].options.body.outcome, 'no_reusable_response_confirmed');
  assert.equal(posts[0].options.body.reviewNote, note.value);
  assert.match(status.textContent, /다음 AI 배치는 별도로 요청/);
  assert.match(statusCards.innerHTML, /다음 최대 8파트 준비/);
});

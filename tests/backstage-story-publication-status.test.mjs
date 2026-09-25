import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');

function publicationView() {
  const statusCards = { innerHTML: '', addEventListener() {} };
  const context = createContext({
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
  state.publishedWorks = knownStories.map((story) => ({ slug: story.slug, status: 'published' }));
  state.aiStatuses = {
    imjin: { status: 'active', active: true },
    norse: { status: 'active', active: true },
    monster: { status: 'inactive', active: false },
    rebellion: { status: 'inactive', active: false }
  };
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
  assert.doesNotMatch(activeCard, /<span class="status-badge is-approved">공개 완료<\/span>/);
});

test('unavailable AI status is shown as unknown, not inactive', () => {
  const view = publicationView();
  view.state.aiStatuses.rebellion = { status: 'unavailable', active: false };
  view.renderStoryStatus();
  const card = view.card('우리는 서로의 몸에 반역을 썼다');
  assert.match(card, /<span class="status-badge is-review">원고 공개 \/ AI 분기 확인 필요<\/span>/);
  assert.match(card, /AI 분기 생성<\/strong><span class="status-badge is-review">확인 필요<\/span>/);
  assert.match(card, /data-story-ai-activate="rebellion" disabled/);
});

test('contradictory AI status is not presented as active or branch-ready', () => {
  const view = publicationView();
  view.state.aiStatuses.rebellion = { status: 'inactive', active: true };
  view.renderStoryStatus();
  const card = view.card('우리는 서로의 몸에 반역을 썼다');
  assert.match(card, /원고 공개 \/ AI 분기 미활성/);
  assert.match(card, /AI 분기 생성<\/strong><span class="status-badge is-review">비활성<\/span>/);
  assert.doesNotMatch(card, /분기 장면이 미리 생성된 상태는 아닙니다/);
});

test('a published non-AI work retains its publication status and fixed-route controls', () => {
  const view = publicationView();
  view.knownStories.find((story) => story.key === 'norse').aiActivationAvailable = false;
  view.state.aiStatuses.norse = { status: 'inactive', active: false };
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
  assert.match(pending, /선택지 3개 준비가 끝나면 활성화/);

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-publication.js', import.meta.url), 'utf8');
const endpoint = '/admin/api/v1/backstage/story-publication/submissions';
const message = '비공개 원고로 접수했습니다. 작가 스튜디오에서 원고 분석과 생성 기준 승인을 진행해 주세요.';
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptVersionId = '22222222-2222-4222-8222-222222222222';

function receipt(overrides = {}) {
  return { jobId: 'import-job', status: 'awaiting_author_review', workId,
    releaseId: null, processedParts: 0, totalParts: 12,
    writerReview: { manuscriptVersionId, manuscriptHash: 'a'.repeat(64),
      analysisStarted: false, nextAction: 'analyze_and_approve', studioUrl: '/creator-studio' },
    ...overrides };
}

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.innerHTML = '';
    this.disabled = false;
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() {
    return (this.text || '') + this.children.map(child => typeof child === 'string' ? child : child.textContent).join('');
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener() {}
}

function screen(replies, { storyKey = 'imjin', chunked = false } = {}) {
  const calls = [];
  const statuses = Object.fromEntries(['upload', 'submission', 'global'].map(key => [key, new Element()]));
  const list = new Element();
  const statusCards = new Element();
  const uploadButton = new Element();
  const promoteButton = new Element();
  const files = Array.from({ length: storyKey === 'imjin' || chunked ? 1 : 2 }, () => ({
    name: 'manuscript.md', size: chunked ? 600 * 1024 : 10, slice: () => ({})
  }));
  const input = { files };
  const form = {
    dataset: { storyUploadForm: storyKey }, resets: 0,
    querySelector: selector => ({ 'input[type="file"]': input,
      '[data-story-upload-status]': statuses.upload, 'button[type="submit"]': uploadButton })[selector],
    reset() { this.resets++; input.files = []; }
  };
  const card = {
    dataset: { submissionId: 'submission-id' },
    querySelectorAll: () => Array.from({ length: 3 }, () => ({ checked: true })),
    querySelector: selector => ({ '[data-story-promote]': promoteButton,
      '[data-story-submission-status]': statuses.submission })[selector]
  };
  promoteButton.closest = () => card;
  const api = { fetch: async (url, options) => {
    calls.push({ url, options });
    if (options?.method !== 'POST') {
      if (url === endpoint) return { items: [], publishedWorks: [] };
      if (url.endsWith('/ai-status')) return { status: 'inactive', active: false };
      throw new Error(`Unexpected read: ${url}`);
    }
    assert.ok(replies.length, `No automatic requests after the receipt: ${url}`);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  } };
  class TestFormData {
    constructor() { this.entries = []; }
    append(...entry) { this.entries.push(entry); }
  }
  const context = createContext({
    window: { LuminaBackstageApi: api }, FormData: TestFormData,
    document: {
      getElementById: id => ({ storyPublicationSubmissionList: list,
        storyPublicationStatusCards: statusCards, storyPublicationState: statuses.global })[id] || null,
      querySelector: () => null, querySelectorAll: () => [], createElement: () => new Element()
    }
  });
  const testSource = source.replace(/\}\)\(\);\s*$/, 'globalThis.__publicationTest = { state, knownStories, upload, promote, render };\n})();');
  assert.notEqual(testSource, source);
  runInContext(testSource, context, { filename: 'backstage-story-publication.js' });
  const handlers = context.__publicationTest;
  const story = handlers.knownStories.find(candidate => candidate.key === storyKey);
  handlers.state.items = [{ id: card.dataset.submissionId, status: 'received',
    files: story.checksums.map(checksumSha256 => ({ category: 'manuscript', checksumSha256 })) }];
  return { ...handlers, calls, statuses, form, card, list, statusCards, uploadButton, promoteButton,
    act: action => action === 'upload' ? handlers.upload(form) : handlers.promote(promoteButton),
    posts: () => calls.filter(call => call.options?.method === 'POST') };
}

function assertReview(view, action, expectedPosts) {
  const status = view.statuses[action === 'upload' ? 'upload' : 'submission'];
  assert.equal(view.posts().length, expectedPosts);
  assert.equal(view.calls.length, expectedPosts, 'receipt stops all automatic follow-up requests');
  assert.ok(status.textContent.startsWith(message));
  assert.doesNotMatch(status.className, /is-success|is-error/);
  assert.ok(view.statuses.global.textContent.startsWith(message));
  assert.doesNotMatch(view.statuses.global.className, /is-success|is-error/);
  for (const target of [status, view.statuses.global]) {
    const links = target.children.filter(child => typeof child !== 'string');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, '/creator-studio');
    assert.equal(links[0].textContent, '작가 스튜디오 열기');
  }
  assert.equal(view.state.publishedWorks.length, 0);
  assert.equal(view.state.uploadingKey, null);
  assert.equal(view.state.promotingId, null);
  assert.ok(view.posts().every(call => call.url.startsWith(endpoint)), 'no analysis, choices, activation or generation calls');
}

for (const action of ['upload', 'promote']) {
  for (const prefix of [[], [{ jobId: 'import-job', status: 'queued' }],
    [{ jobId: 'import-job', status: 'queued' }, { jobId: 'import-job', status: 'structuring' }]]) {
    test(`${action} stops on author review after ${prefix.length} process calls`, async () => {
      const view = screen([...prefix, receipt()]);
      await view.act(action);
      assertReview(view, action, prefix.length + 1);
      assert.equal(view.posts()[0].url, action === 'upload' ? `${endpoint}/publish-approved` : `${endpoint}/submission-id/promote`);
      assert.equal(view.posts().slice(1).every(call => call.url === `${endpoint}/jobs/import-job/process`), true);
      assert.equal(view.uploadButton.attributes['aria-busy'], undefined);
      assert.equal(view.promoteButton.attributes['aria-busy'], undefined);
      if (action === 'upload') {
        assert.equal(view.form.resets, 1);
        assert.equal(view.uploadButton.disabled, false);
      } else {
        assert.equal(view.promoteButton.disabled, true);
        assert.match(view.statusCards.innerHTML, /비공개 원고 \/ 작가 검토 대기/);
        assert.match(view.list.innerHTML, /<fieldset class="story-publication-confirmations" disabled>/);
        assert.match(view.list.innerHTML, /작가 검토 대기/);
        await view.act(action);
        assert.equal(view.posts().length, prefix.length + 1, 'same submission cannot be promoted again');
        assert.match(view.list.innerHTML, /작가 검토 대기/);
        assert.match(view.list.innerHTML, /href="\/creator-studio"/);
        assert.doesNotMatch(view.statusCards.innerHTML, /승격 완료|공개 완료|독자 화면에 공개 중/);
      }
    });
  }

  test(`${action} accepts author review on the last bounded polling step`, async () => {
    const view = screen([...Array.from({ length: 200 }, () => ({ jobId: 'import-job', status: 'queued' })), receipt()]);
    await view.act(action);
    assertReview(view, action, 201);
  });

  test(`${action} supports a promoted private receipt without a polling job`, async () => {
    const view = screen([receipt({ status: 'promoted', jobId: undefined, workId: undefined,
      work: { id: workId, status: 'draft', activeReleaseId: null } })]);
    await view.act(action);
    assertReview(view, action, 1);
  });

  test(`${action} supports an existing private work replay`, async () => {
    const view = screen([receipt({ status: undefined, jobId: undefined, workId: undefined,
      work: { id: workId, status: 'draft', activeReleaseId: null }, idempotentReplay: true })]);
    await view.act(action);
    assertReview(view, action, 1);
  });

  test(`${action} rejects a promoted private receipt missing its manuscript`, async () => {
    const view = screen([receipt({ status: 'promoted', jobId: undefined, workId: undefined,
      work: { id: workId, status: 'draft', activeReleaseId: null }, writerReview: undefined })]);
    await view.act(action);
    assert.equal(view.calls.length, 1);
    assert.match(view.statuses[action === 'upload' ? 'upload' : 'submission'].className, /is-error/);
    assert.equal(view.form.resets, 0);
    assert.equal(view.state.items[0].status, 'received');
  });

  for (const studioUrl of ['javascript:alert(1)', '//attacker.invalid', 'https://attacker.invalid',
    '/creator-studio?work=" onclick="alert(1)', undefined]) {
    test(`${action} ignores untrusted studio URL ${JSON.stringify(studioUrl)}`, async () => {
      const reviewReceipt = receipt();
      reviewReceipt.writerReview.studioUrl = studioUrl;
      const view = screen([reviewReceipt]);
      await view.act(action);
      assertReview(view, action, 1);
    });
  }

  const malformed = [
    value => { delete value.workId; },
    value => { value.workId = ' '; },
    value => { delete value.writerReview; },
    value => { delete value.writerReview.manuscriptVersionId; },
    value => { value.writerReview.manuscriptVersionId = ' '; },
    value => { delete value.writerReview.manuscriptHash; },
    value => { value.writerReview.manuscriptHash = '<script>'; },
    value => { value.writerReview.analysisStarted = true; },
    value => { value.writerReview.nextAction = 'publish'; },
    value => { value.releaseId = 'unexpected-release'; },
    value => { value.work = { id: workId, status: 'published', activeReleaseId: 'release' }; }
  ];
  for (const [index, mutate] of malformed.entries()) {
    test(`${action} rejects malformed author-review receipt ${index + 1} without further processing`, async () => {
      const reviewReceipt = receipt();
      mutate(reviewReceipt);
      const view = screen([{ jobId: 'import-job', status: 'queued' }, reviewReceipt]);
      await view.act(action);
      const status = view.statuses[action === 'upload' ? 'upload' : 'submission'];
      assert.equal(view.posts().length, 2);
      assert.match(status.className, /is-error/);
      assert.doesNotMatch(status.textContent, /최종본을 공개했습니다|접수를 승격했습니다/);
      assert.equal(status.children.length, 0);
      assert.equal(view.form.resets, 0);
      assert.equal(view.state.items[0].status, 'received');
      assert.equal(view.state.publishedWorks.length, 0);
    });
  }

  for (const [label, replies] of [
    ['request failure', [new Error('controlled API failure')]],
    ['process failure', [{ jobId: 'import-job', status: 'queued' }, new Error('controlled API failure')]],
    ['failed job', [{ jobId: 'import-job', status: 'failed', errorCode: 'CONTROLLED_IMPORT_FAILURE' }]]
  ]) {
    test(`${action} retains ${label} handling`, async () => {
      const view = screen([...replies]);
      await view.act(action);
      const status = view.statuses[action === 'upload' ? 'upload' : 'submission'];
      assert.equal(view.posts().length, replies.length);
      assert.match(status.className, /is-error/);
      assert.match(status.textContent, /controlled API failure|CONTROLLED_IMPORT_FAILURE/);
      assert.equal(view.form.resets, 0);
      assert.equal(view.state.uploadingKey, null);
      assert.equal(view.state.promotingId, null);
    });
  }

  test(`${action} leaves legacy published job outcomes unchanged`, async () => {
    const view = screen([{ jobId: 'legacy-job', status: 'queued' },
      { ...receipt(), jobId: 'legacy-job', status: 'published', releaseId: 'legacy-release',
        work: { id: workId, status: 'published', slug: 'legacy"<&?slug' } }], { storyKey: 'inheritor' });
    await view.act(action);
    assert.equal(view.posts().length, 2);
    assert.equal(view.posts()[1].url, `${endpoint}/jobs/legacy-job/process`);
    assert.equal(view.state.items.length, 0, 'legacy completion still refreshes the list');
    assert.doesNotMatch(view.statuses.global.textContent, /비공개 원고/);
    if (action === 'upload') {
      assert.match(view.statuses.upload.textContent, /최종본을 공개했습니다/);
      assert.match(view.statuses.upload.className, /is-success/);
      const link = view.statuses.upload.children.find(child => typeof child !== 'string');
      assert.equal(link.href, `/story-stage?slug=${encodeURIComponent('legacy"<&?slug')}`);
      assert.equal(link.rel, 'noopener noreferrer');
    }
  });
}

test('legacy published promotion replay still refreshes without a process request', async () => {
  const view = screen([{ work: { id: workId, status: 'published', activeReleaseId: 'release' }, idempotentReplay: true }]);
  await view.act('promote');
  assert.equal(view.posts().length, 1);
  assert.equal(view.state.items.length, 0);
  assert.doesNotMatch(view.statuses.global.textContent, /비공개 원고/);
});

test('an awaiting submission loaded without a promoted work field cannot be promoted again', async () => {
  const view = screen([]);
  view.state.items[0].status = 'awaiting_author_review';
  view.render();
  assert.match(view.list.innerHTML, /<fieldset class="story-publication-confirmations" disabled>/);
  assert.match(view.list.innerHTML, /href="\/creator-studio"/);
  await view.act('promote');
  assert.equal(view.calls.length, 0);
});

test('a new private receipt does not reclassify an already published legacy work', async () => {
  const view = screen([receipt()]);
  const story = view.knownStories.find(candidate => candidate.key === 'imjin');
  view.state.publishedWorks = [{ id: 'legacy-work', slug: story.slug, status: 'published' }];
  view.state.aiStatuses.imjin = { status: 'active', active: true };
  await view.act('promote');
  assert.equal(view.state.publishedWorks[0].status, 'published');
  assert.match(view.statusCards.innerHTML, /원고 공개 \/ AI 분기 확인 필요/);
  assert.equal(view.calls.length, 1);
});

for (const phase of ['start', 'prepare']) {
  test(`chunked upload stops on an author-review receipt from ${phase}`, async () => {
    const replies = phase === 'start' ? [receipt()] : [
      { jobId: 'import-job', status: 'uploading' },
      { jobId: 'import-job', status: 'uploading' },
      { jobId: 'import-job', status: 'uploading' }, receipt()
    ];
    const view = screen(replies, { storyKey: 'norse', chunked: true });
    await view.act('upload');
    assertReview(view, 'upload', phase === 'start' ? 1 : 4);
    assert.equal(view.posts().some(call => call.url.endsWith('/process')), false);
  });
}

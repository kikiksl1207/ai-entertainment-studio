import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-story-finalize.js', import.meta.url), 'utf8');
const workId = '11111111-1111-4111-8111-111111111111';
const manuscriptId = '22222222-2222-4222-8222-222222222222';
const analysisId = '33333333-3333-4333-8333-333333333333';
const resetConsentReview = { consentId: '55555555-5555-4555-8555-555555555555',
  consentRevision: 2, batchHash: 'e'.repeat(64) };

class Element {
  constructor(id = '', document = null) {
    this.id = id; this.document = document; this.children = []; this.listeners = {};
    this.dataset = {}; this.textContent = ''; this.value = ''; this.checked = false;
    this.hidden = false; this.disabled = false;
    const classes = new Set(['is-hidden']);
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name), toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) };
  }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  fire(name) { return this.listeners[name]?.({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  closest(selector) { return selector === 'label' ? this.label : null; }
  querySelector(selector) { return this.matches?.[selector] || null; }
  querySelectorAll(selector) {
    const walk = node => typeof node === 'string' ? [] : [node, ...node.children.flatMap(walk)];
    return this.children.flatMap(walk).filter(node => selector === 'input[data-part-key]' && node.dataset.partKey);
  }
  setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
  focus() { if (this.document) this.document.activeElement = this; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

function fixture(initialLocale = 'ko', { requestError = false, reviewAvailable = true,
  reviewStatus = 'current', canReset = false, reviewOverrides = {}, confirmResult = true,
  beforeFetch = async () => {}, previewOverrides = {} } = {}) {
  const ids = ['Entry', 'EntryTitle', 'EntryState', 'Open', 'Modal', 'Title', 'Close', 'Cancel', 'Parts',
    'Issues', 'WarningsLabel', 'State', 'Stage', 'Prepare', 'Summary', 'Proposals', 'ProfileStatus',
    'SummaryTitle', 'ProposalTitle', 'ContinuityTitle', 'ConfirmationTitle', 'SummaryReviewed',
    'ProposalReviewed', 'ContinuityReviewed', 'Reviewed', 'Rights', 'Ai', 'Warnings'];
  const document = { activeElement: null, addEventListener() {} };
  const elements = Object.fromEntries(ids.map(id => [`writerFinal${id}`, new Element(`writerFinal${id}`, document)]));
  document.getElementById = id => elements[id];
  document.createElement = () => new Element('', document);
  const entryIntro = new Element(); const eyebrow = new Element(); const modalIntro = new Element();
  elements.writerFinalEntry.matches = { 'p:not([id])': entryIntro };
  elements.writerFinalModal.matches = { 'header .eyebrow': eyebrow, '.modal-card > p:not([id])': modalIntro };
  for (const suffix of ['SummaryReviewed', 'ProposalReviewed', 'ContinuityReviewed', 'Reviewed', 'Rights', 'Ai', 'Warnings']) {
    const input = elements[`writerFinal${suffix}`];
    input.label = suffix === 'Warnings' ? elements.writerFinalWarningsLabel : new Element();
    input.label.append(input);
  }
  let locale = initialLocale;
  let releaseId = null;
  let ready = false;
  let job = null;
  let hash = 'manuscript-hash';
  let fingerprint = 'approved-fingerprint';
  let profilePinHash = 'c'.repeat(64);
  let checksum = 'release-checksum';
  let profileStatus = 'approved';
  let originalLabel = 'Original choice';
  let completed = { manuscriptVersionId: manuscriptId, workId, analysisJobId: analysisId,
    identity: { ownerId: 'author', epoch: 1 } };
  let identity = completed.identity;
  const calls = [];
  const confirmations = [];
  const consentPanelEvents = [];
  const intervals = [];
  const parts = [{ partKey: 'p1', title: 'Source title', endingExcerpt: 'Source excerpt', nextPartTitle: 'Source next' }];
  const sections = ['writing_style', 'scene_scale', 'canon', 'timeline', 'narrative_devices',
    'branch_behavior', 'visual_direction', 'visual_cast'].map(key => ({ key, decision: 'accepted',
    value: { summary: 'Author-approved source text' }, evidence: [] }));
  const fetch = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (requestError) return { ok: false, status: 500, json: async () => ({ code: 'INTERNAL_SECRET_CODE' }) };
    let data;
    if (path.endsWith('/choice-review')) {
      if (!reviewAvailable) return { ok: false, status: 503, json: async () => ({ code: 'PRIVATE_DIAGNOSTIC' }) };
      data = { releaseId, status: reviewStatus, code: null, canReset,
        expectedManuscriptHash: hash, expectedApprovedFingerprint: fingerprint,
        expectedProfilePinHash: profilePinHash, expectedReleaseChecksum: checksum,
        resetRequiredScenes: reviewStatus === 'settings_changed' ? 1 : 0,
        preparedScenes: job?.completedParts || 0, generationStarted: false, ...reviewOverrides };
    } else if (path.endsWith('/reset-choices')) {
      delete reviewOverrides.resetConsentReview;
      reviewStatus = 'reset_ready'; canReset = false; ready = false; checksum = 'reset-checksum';
      job = { ...job, status: 'failed', errorCode: 'STUDIO_CHOICES_REPREPARATION_READY' };
      data = { releaseId, status: 'reset_ready', resetScenes: 1, generationStarted: false,
        nextAction: 'explicit_retry_required', idempotentReplay: false };
    } else if (path.endsWith('/retry-choices')) {
      job = { ...job, status: 'queued', errorCode: null }; reviewStatus = 'current';
      data = { releaseId, status: 'queued' };
    } else if (path.endsWith('/generation-profile')) {
      const settings = { schemaVersion: 'creator-generation-profile-v1', kind: 'story', sections };
      data = { workId, manuscript: { id: manuscriptId }, analysis: { id: analysisId },
        profile: { status: profileStatus, approvedFingerprint: fingerprint, approvedSettings: settings, draftSettings: settings } };
    } else {
      assert.ok(path.endsWith(`/linear-draft/${manuscriptId}`), `Unexpected API: ${path}`);
      data = { manuscriptVersionId: manuscriptId, manuscriptHash: hash, analysisJobId: analysisId, parts, issues: [],
        scenes: releaseId ? [{ partKey: 'p1', sceneId: 'source-scene', choiceCount: job?.completedParts === 1 ? 3 : 1,
          originalLabel }] : [], releaseId, ready, choiceJob: job, ...previewOverrides };
    }
    data = structuredClone(data);
    await beforeFetch(path, options);
    return { ok: true, json: async () => data };
  };
  const listeners = {};
  const window = { confirm: message => {
    confirmations.push(message);
    return typeof confirmResult === 'function' ? confirmResult(message) : confirmResult;
  },
    LuminaCreatorStudioApi: { fetch, isCurrent: value => value?.ownerId === identity.ownerId && value?.epoch === identity.epoch },
    LuminaCreatorAnalysis: { completed: () => completed },
    LuminaCreatorChoiceConsentReview: {
      reset: () => consentPanelEvents.push({ type: 'reset' }),
      show: (snapshot, review, scope) => consentPanelEvents.push({ type: 'show',
        snapshot: structuredClone(snapshot), review: structuredClone(review), scope: structuredClone(scope) })
    },
    luminaI18n: { getLocale: () => locale }, addEventListener: (name, listener) => { listeners[name] = listener; } };
  vm.runInNewContext(script, { document, window, setInterval: callback => { intervals.push(callback); } });
  return { elements, entryIntro, eyebrow, modalIntro, document, calls, confirmations, consentPanelEvents,
    checkIdentity: () => intervals[0](), refresh: () => intervals[1](),
    expireAuth: () => listeners['lumina:auth-expired'](),
    changeAccount() { identity = { ownerId: 'other-author', epoch: 2 }; completed = { ...completed, identity }; },
    changeManuscript() { completed = { ...completed, manuscriptVersionId: 'new-manuscript' }; },
    changeAnalysis() { completed = { ...completed, analysisJobId: 'new-analysis' }; },
    changeHash() { hash = 'changed-hash'; }, changeFingerprint() { fingerprint = 'changed-fingerprint'; },
    reapproveUnchangedSettings() { profilePinHash = 'd'.repeat(64); },
    setProfileStatus(value) { profileStatus = value; },
    setReview(status, allowed = false) { reviewStatus = status; canReset = allowed; },
    setReviewOverrides(value) { reviewOverrides = value; },
    setReviewAvailable(value) { reviewAvailable = value; },
    setPreviewOverrides(value) { previewOverrides = value; },
    setOriginalLabel(value) { originalLabel = value; },
    setConfirmResult(value) { confirmResult = value; },
    switchLocale(next) { locale = next; listeners['lumina:localechange'](); },
    setJob(status, errorCode = 'STUDIO_CHOICES_GENERATION_FAILED') {
      releaseId = '44444444-4444-4444-8444-444444444444';
      ready = status === 'completed';
      job = { status, completedParts: 1, totalParts: 1, errorCode };
    } };
}

const expected = {
  ko: { title: '원고 최종 검토', choice: '1번 선택 문구 (선택 입력)', ready: '아직 비공개', failed: '멈췄습니다', rights: '권리를 보유' },
  en: { title: 'Final manuscript review', choice: 'Choice 1 wording (optional)', ready: 'still private', failed: 'stopped', rights: 'hold the rights' },
  ja: { title: '原稿の最終確認', choice: '選択肢1の文言（任意）', ready: 'まだ非公開', failed: '停止しました', rights: '権利を保有' },
  'zh-Hans': { title: '稿件最终核对', choice: '选项 1 文案（可选）', ready: '仍未公开', failed: '停止', rights: '拥有此稿件的权利' },
  'zh-Hant': { title: '稿件最終核對', choice: '選項 1 文字（選填）', ready: '仍未公開', failed: '停止', rights: '擁有此稿件的權利' }
};

for (const [locale, words] of Object.entries(expected)) {
  test(`final review copy and private job states use ${locale}`, async () => {
    const view = fixture(locale);
    const { elements } = view;
    await elements.writerFinalOpen.fire('click');
    assert.equal(elements.writerFinalEntryTitle.textContent, words.title);
    assert.match(view.entryIntro.textContent, /\S/);
    assert.match(view.modalIntro.textContent, /\S/);
    assert.match(view.eyebrow.textContent, /\S/);
    assert.match(elements.writerFinalRights.label.children[1], new RegExp(words.rights));
    assert.equal(elements.writerFinalParts.children[0].children[3].textContent, words.choice);
    assert.match(elements.writerFinalSummary.children[0].children[0].textContent, /\S/);
    view.setJob('failed');
    elements.writerFinalClose.fire('click');
    await elements.writerFinalOpen.fire('click');
    assert.match(elements.writerFinalState.textContent, new RegExp(words.failed));
    assert.doesNotMatch(elements.writerFinalState.textContent, /STUDIO_CHOICES_GENERATION_FAILED/);
    assert.equal(elements.writerFinalPrepare.disabled, false);
    view.setJob('completed');
    elements.writerFinalClose.fire('click');
    await elements.writerFinalOpen.fire('click');
    assert.match(elements.writerFinalState.textContent, new RegExp(words.ready));
    assert.equal(elements.writerFinalPrepare.disabled, true);
  });
}

test('interrupted preparation explains unconfirmed cost in all five languages without retrying automatically', async () => {
  const messages = { ko: '자동으로 다시 생성하지', en: 'will not retry automatically', ja: '自動再生成は行いません',
    'zh-Hans': '不会自动重新生成', 'zh-Hant': '不會自動重新生成' };
  for (const [locale, text] of Object.entries(messages)) {
    const view = fixture(locale, { confirmResult: false });
    view.setJob('failed', 'STUDIO_CHOICES_INTERRUPTED_RETRY_REQUIRED');
    await view.elements.writerFinalOpen.fire('click');
    assert.ok(view.elements.writerFinalState.textContent.includes(text));
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /STUDIO_CHOICES_|\{done\}|\{total\}/);
    assert.equal(view.elements.writerFinalPrepare.disabled, false);
    assert.equal(writes(view).length, 0);
    await click(view);
    assert.equal(view.confirmations.length, 1);
    assert.equal(writes(view).length, 0);
  }
});

test('renewed consent notice uses every locale and completed flags cannot enable generation or readiness', async () => {
  for (const [locale, notice] of [['ko', '권리 승인 내용이 갱신'], ['en', 'Rights approval was renewed'],
    ['ja', '権利の承認内容が更新'], ['zh-Hans', '权利批准已更新'], ['zh-Hant', '權利批准已更新']]) {
    const view = fixture(locale, { reviewStatus: 'consent_changed' }); view.setJob('completed');
    await view.elements.writerFinalOpen.fire('click');
    assert.ok(view.elements.writerFinalState.textContent.includes(notice));
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await view.elements.writerFinalPrepare.fire('click');
    assert.equal(view.calls.some(call => call.method === 'POST'), false);
    assert.equal(view.confirmations.length, 0);
  }
});

test('locale switch re-renders live review without changing typed choice, focus, or consent checks', async () => {
  const view = fixture('ko');
  const { elements, document } = view;
  await elements.writerFinalOpen.fire('click');
  const input = elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0];
  input.value = 'My specific route'; input.focus(); input.setSelectionRange(3, 8);
  elements.writerFinalRights.checked = true;
  view.switchLocale('en-US');
  const translated = elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0];
  assert.equal(translated.value, 'My specific route');
  assert.equal(document.activeElement, translated);
  assert.equal(translated.selectionStart, 3);
  assert.equal(translated.selectionEnd, 8);
  assert.equal(elements.writerFinalRights.checked, true);
  assert.equal(elements.writerFinalStage.textContent, '1/5 Review analysis summary');
  assert.equal(elements.writerFinalParts.children[0].children[3].textContent, 'Choice 1 wording (optional)');
  assert.match(elements.writerFinalState.textContent, /Review the analysis summary/);
});

test('server diagnostic code stays out of localized request errors', async () => {
  const view = fixture('en', { requestError: true });
  await view.elements.writerFinalOpen.fire('click');
  assert.match(view.elements.writerFinalState.textContent, /Could not complete the request/);
  assert.doesNotMatch(view.elements.writerFinalState.textContent, /INTERNAL_SECRET_CODE/);
  assert.equal(view.elements.writerFinalState.classList.contains('is-danger'), true);
});

const writes = view => view.calls.filter(call => call.method && call.method !== 'GET');
const open = view => view.elements.writerFinalOpen.fire('click');
const click = view => view.elements.writerFinalPrepare.fire('click');

test('candidate review is readonly and follows the linear preview; missing review blocks ready and paid retry', async () => {
  for (const status of ['completed', 'failed']) {
    const view = fixture('en', { reviewAvailable: false });
    view.setJob(status);
    await open(view);
    const paths = view.calls.map(call => call.path.split('/').at(-1));
    assert.deepEqual(paths, [manuscriptId, 'choice-review', 'generation-profile']);
    assert.equal(writes(view).length, 0);
    assert.match(view.elements.writerFinalState.textContent, /Could not verify choices against current settings/);
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /PRIVATE_DIAGNOSTIC|All three choices are prepared/);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
  }
});

test('only current review plus existing job readiness checks can declare all choices ready', async () => {
  for (const status of ['current', 'settings_changed', 'approval_required', 'blocked', 'reset_ready']) {
    const view = fixture('en', { reviewStatus: status, canReset: status === 'settings_changed' });
    view.setJob('completed');
    await open(view);
    assert.equal(view.elements.writerFinalState.textContent.includes('All three choices are prepared'), status === 'current');
    assert.equal(view.elements.writerFinalStage.textContent === 'Choices prepared', status === 'current');
  }
});

test('a completed job flag cannot replace verified current choice counts', async () => {
  for (const reviewOverrides of [{ preparedScenes: 0 }, { preparedScenes: 2 },
    { preparedScenes: 4 }, { resetRequiredScenes: 1 }]) {
    const view = fixture('en', { reviewStatus: 'current', reviewOverrides });
    view.setJob('completed');
    await open(view);
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /All three choices are prepared/);
    assert.notEqual(view.elements.writerFinalStage.textContent, 'Choices prepared');
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
  }
});

test('malformed, mismatched, or generation-starting review responses fail closed', async () => {
  for (const reviewOverrides of [{ releaseId: 'other-release' }, { status: 'unknown' },
    { generationStarted: true }, { expectedManuscriptHash: 'wrong-hash' },
    { expectedApprovedFingerprint: 'wrong-fingerprint' }, { expectedReleaseChecksum: null },
    { expectedProfilePinHash: null }, { expectedProfilePinHash: 'not-a-full-pin-hash' },
    { expectedProfilePinHash: 'x'.repeat(64) },
    { expectedManuscriptHash: null }, { resetRequiredScenes: -1 }, { preparedScenes: 1.5 }]) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true, reviewOverrides });
    view.setJob('completed');
    await open(view);
    assert.equal(view.elements.writerFinalPrepare.disabled, true, JSON.stringify(reviewOverrides));
    assert.match(view.elements.writerFinalState.textContent, /Could not verify choices/);
    await click(view);
    assert.equal(writes(view).length, 0);
  }
});

test('stale choices reset with an object body and never chain a generation request', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true });
  view.setJob('failed');
  await open(view);
  assert.equal(view.elements.writerFinalPrepare.textContent, 'Reset outdated choices');
  await click(view);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
  const body = writes(view)[0].body;
  assert.equal(typeof body, 'object');
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { expectedManuscriptHash: 'manuscript-hash',
    expectedApprovedFingerprint: 'approved-fingerprint', expectedProfilePinHash: 'c'.repeat(64),
    expectedReleaseChecksum: 'release-checksum', resetConfirmed: true });
  assert.match(view.confirmations[0], /No AI generation starts and no cost is incurred/);
  assert.match(view.elements.writerFinalState.textContent, /AI generation has not started/);
  assert.equal(view.elements.writerFinalPrepare.textContent, 'Retry choice preparation');
  assert.equal(view.elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].value, 'Original choice');
  assert.equal(view.elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].readOnly, true);
});

test('cancelled reset makes no writes and leaves the reset action available', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true, confirmResult: false });
  view.setJob('failed');
  await open(view);
  await click(view);
  assert.equal(writes(view).length, 0);
  assert.equal(view.elements.writerFinalPrepare.disabled, false);
  assert.equal(view.elements.writerFinalPrepare.textContent, 'Reset outdated choices');
});

test('reset-ready requires another click and an independently cancellable possible-cost confirmation', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true });
  view.setJob('failed');
  await open(view);
  await click(view);
  assert.equal(view.confirmations.length, 1);
  view.setConfirmResult(false);
  await click(view);
  assert.equal(view.confirmations.length, 2);
  assert.match(view.confirmations[1], /requests AI generation, which may be queued and may incur a cost/);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
  view.setConfirmResult(true);
  await click(view);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices', 'retry-choices']);
  assert.equal(view.confirmations.length, 3);
});

test('reset-ready paused jobs offer only a separately confirmed retry', async () => {
  const view = fixture('en', { reviewStatus: 'reset_ready', confirmResult: false });
  view.setJob('paused');
  await open(view);
  assert.equal(view.elements.writerFinalPrepare.disabled, false);
  await click(view);
  assert.match(view.confirmations[0], /may incur a cost/);
  assert.equal(writes(view).length, 0);
});

test('current failed jobs also require a possible-cost confirmation before retry', async () => {
  const view = fixture('en', { confirmResult: false });
  view.setJob('failed');
  await open(view);
  await click(view);
  assert.match(view.confirmations[0], /may incur a cost/);
  assert.equal(writes(view).length, 0);
});

test('active stale jobs, approval-required and blocked reviews offer no destructive or paid action', async () => {
  for (const [status, job, message] of [['settings_changed', 'processing', 'choice job is active'],
    ['settings_changed', 'queued', 'choice job is active'], ['approval_required', 'failed', 'Edit and approve'],
    ['blocked', 'failed', 'cannot be reset or regenerated']]) {
    const view = fixture('en', { reviewStatus: status });
    view.setJob(job);
    if (status === 'approval_required') view.setProfileStatus('needs_review');
    await open(view);
    assert.match(view.elements.writerFinalState.textContent, new RegExp(message));
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
  }
});

test('unavailable review during polling invalidates previously verified choices', async () => {
  const view = fixture('en');
  view.setJob('queued');
  await open(view);
  view.setJob('completed');
  view.setReviewAvailable(false);
  await view.refresh();
  assert.match(view.elements.writerFinalState.textContent, /Could not verify choices/);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
  assert.doesNotMatch(view.elements.writerFinalStage.textContent, /^Choices prepared$/);
  assert.equal(writes(view).length, 0);
});

test('review disappearance or changed settings before confirmation cannot start reset or retry', async () => {
  for (const mutate of ['setReviewAvailable', 'changeHash', 'changeFingerprint', 'reapproveUnchangedSettings']) {
    for (const reviewStatus of ['current', 'settings_changed']) {
      const view = fixture('en', { reviewStatus, canReset: reviewStatus === 'settings_changed' });
      view.setJob('failed');
      await open(view);
      view[mutate](false);
      await click(view);
      assert.equal(writes(view).length, 0, `${mutate} ${reviewStatus}`);
      assert.equal(view.confirmations.length, 0);
      assert.equal(view.elements.writerFinalPrepare.disabled, true);
    }
  }
});

test('account, manuscript, and analysis changes invalidate choice actions', async () => {
  for (const mutate of ['changeAccount', 'changeManuscript', 'changeAnalysis']) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true });
    view.setJob('failed');
    await open(view);
    view[mutate]();
    view.checkIdentity();
    await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
    assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), true);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
});

test('re-approving identical settings requires reopening and sends only the newly reviewed full-pin hash', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true });
  view.setJob('failed'); await open(view);
  view.reapproveUnchangedSettings();
  await click(view);
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 0);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
  assert.match(view.elements.writerFinalState.textContent, /review content changed/i);
  view.elements.writerFinalClose.fire('click'); await open(view);
  await click(view);
  assert.equal(writes(view).length, 1);
  assert.equal(writes(view)[0].body.expectedApprovedFingerprint, 'approved-fingerprint');
  assert.equal(writes(view)[0].body.expectedProfilePinHash, 'd'.repeat(64));
  assert.equal(writes(view)[0].path.endsWith('/reset-choices'), true);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('closing a held status read permits reopening before the old response completes', async () => {
  const held = deferred(); const entered = deferred(); let hold = false;
  const view = fixture('en', { beforeFetch: async path => {
    if (hold && path.endsWith('/choice-review')) { hold = false; entered.resolve(); await held.promise; }
  } });
  view.setJob('queued'); await open(view);
  hold = true; const old = view.refresh(); await entered.promise;
  view.elements.writerFinalClose.fire('click');
  view.setReview('blocked'); await open(view);
  assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), false);
  const message = view.elements.writerFinalState.textContent;
  assert.match(message, /cannot be reset or regenerated/);
  held.resolve(); await old;
  assert.equal(view.elements.writerFinalState.textContent, message);
  assert.equal(writes(view).length, 0);
});

test('a closed status read cannot release the reopened session status-read lock', async () => {
  const oldHeld = deferred(); const newHeld = deferred(); const oldEntered = deferred(); const newEntered = deferred();
  let hold = 0;
  const view = fixture('en', { beforeFetch: async path => {
    if (!path.endsWith('/choice-review')) return;
    if (hold === 1) { hold = 0; oldEntered.resolve(); await oldHeld.promise; }
    else if (hold === 2) { hold = 0; newEntered.resolve(); await newHeld.promise; }
  } });
  view.setJob('queued'); await open(view);
  hold = 1; const old = view.refresh(); await oldEntered.promise;
  view.elements.writerFinalClose.fire('click'); await open(view);
  hold = 2; const currentRead = view.refresh(); await newEntered.promise;
  const reads = view.calls.length;
  oldHeld.resolve(); await old;
  await view.refresh();
  assert.equal(view.calls.length, reads, 'old finally must not unlock a newer status read');
  newHeld.resolve(); await currentRead;
  assert.equal(writes(view).length, 0);
});

test('account replacement unlocks the new review but old write completion cannot unlock its submission', async () => {
  const oldHeld = deferred(); const newHeld = deferred(); const oldEntered = deferred(); const newEntered = deferred();
  let resets = 0;
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    beforeFetch: async path => {
      if (!path.endsWith('/reset-choices')) return;
      if (++resets === 1) { oldEntered.resolve(); await oldHeld.promise; }
      else { newEntered.resolve(); await newHeld.promise; }
    } });
  view.setJob('failed'); await open(view);
  const old = click(view); await oldEntered.promise;
  view.changeAccount(); view.checkIdentity();
  view.setReview('settings_changed', true); view.setJob('failed'); await open(view);
  assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), false);
  const currentWrite = click(view); await newEntered.promise;
  oldHeld.resolve(); await old;
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
  const reads = view.calls.length;
  await click(view);
  assert.equal(view.calls.length, reads, 'old finally must not unlock a newer submission');
  newHeld.resolve(); await currentWrite;
  assert.equal(resets, 2);
  assert.equal(view.confirmations.length, 2);
});

test('invalid job counters and statuses never show progress or offer paid retry', async () => {
  for (const bad of [
    { completedParts: -1 }, { completedParts: 2 }, { completedParts: 0.5 },
    { completedParts: '1' }, { totalParts: 0 }, { totalParts: 2 }, { status: 'unexpected' }
  ]) {
    const view = fixture('en'); view.setJob('failed');
    view.setPreviewOverrides({ choiceJob: { status: 'failed', totalParts: 1, completedParts: 1, ...bad } });
    await open(view);
    assert.match(view.elements.writerFinalState.textContent, /Could not verify the choice-preparation job/);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
  }
});

test('completed flags need one matching three-choice scene per source part', async () => {
  for (const scenes of [[], [{ partKey: 'other', sceneId: 'scene', choiceCount: 3 }],
    [{ partKey: 'p1', sceneId: '', choiceCount: 3 }], [{ partKey: 'p1', sceneId: 'scene', choiceCount: 1 }],
    [{ partKey: 'p1', sceneId: 'scene', choiceCount: 2 }],
    [{ partKey: 'p1', sceneId: 'scene', choiceCount: '3' }],
    [{ partKey: 'p1', sceneId: 'scene', choiceCount: 3 }, { partKey: 'p1', sceneId: 'scene', choiceCount: 3 }]]) {
    const view = fixture('en'); view.setJob('completed'); view.setPreviewOverrides({ scenes });
    await open(view);
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /All three choices are prepared/);
    assert.notEqual(view.elements.writerFinalStage.textContent, 'Choices prepared');
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
  }
});

test('a truthy ready value cannot replace the strict server readiness flag', async () => {
  for (const ready of ['true', 1, {}]) {
    const view = fixture('en'); view.setJob('completed'); view.setPreviewOverrides({ ready });
    await open(view);
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /All three choices are prepared/);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
});

test('background completion updates the saved original label without rebuilding or moving focus', async () => {
  const view = fixture('en'); view.setJob('queued'); view.setOriginalLabel(null); await open(view);
  const input = view.elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0];
  input.focus(); input.setSelectionRange(0, 0);
  assert.equal(input.value, ''); assert.equal(input.readOnly, true);
  view.setJob('completed'); view.setOriginalLabel('Read the letter before leaving'); await view.refresh();
  assert.equal(view.elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0], input);
  assert.equal(input.value, 'Read the letter before leaving');
  assert.equal(view.document.activeElement, input);
  assert.equal(input.selectionStart, 0);
  assert.match(view.elements.writerFinalState.textContent, /All three choices are prepared/);
  assert.equal(writes(view).length, 0);
});

test('multi-part completion requires unique scene identity and matching source order', async () => {
  const parts = [{ partKey: 'p1', title: 'First', endingExcerpt: 'First end', nextPartTitle: 'Last' },
    { partKey: 'p2', title: 'Last', endingExcerpt: 'Last end', nextPartTitle: null }];
  const scenes = [{ partKey: 'p1', sceneId: 'scene-1', choiceCount: 3 },
    { partKey: 'p2', sceneId: 'scene-2', choiceCount: 3 }];
  const overrides = { parts, scenes, choiceJob: { status: 'completed', totalParts: 2, completedParts: 2 } };
  const good = fixture('en', { reviewOverrides: { preparedScenes: 2 } });
  good.setJob('completed'); good.setPreviewOverrides(overrides); await open(good);
  assert.match(good.elements.writerFinalState.textContent, /All three choices are prepared/);
  for (const bad of [
    { scenes: [...scenes].reverse() }, { scenes: [scenes[0], { ...scenes[1], sceneId: 'scene-1' }] },
    { scenes: [scenes[0], { ...scenes[1], partKey: 'p1' }] },
    { parts: [parts[0], { ...parts[1], partKey: 'p1' }] }
  ]) {
    const view = fixture('en', { reviewOverrides: { preparedScenes: 2 } });
    view.setJob('completed'); view.setPreviewOverrides({ ...overrides, ...bad }); await open(view);
    assert.doesNotMatch(view.elements.writerFinalState.textContent, /All three choices are prepared/);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    await click(view);
    assert.equal(writes(view).length, 0);
  }
});

test('double-clicked reset and retry send just one separately confirmed request', async () => {
  for (const reviewStatus of ['current', 'settings_changed']) {
    const held = deferred(); const entered = deferred(); let hold = false;
    const view = fixture('en', { reviewStatus, canReset: reviewStatus === 'settings_changed',
      beforeFetch: async path => { if (hold && path.endsWith('/choice-review')) { hold = false; entered.resolve(); await held.promise; } } });
    view.setJob('failed');
    await open(view);
    hold = true;
    const first = click(view);
    await entered.promise;
    const second = click(view);
    held.resolve();
    await Promise.all([first, second]);
    assert.equal(writes(view).length, 1);
    assert.equal(view.confirmations.length, 1);
  }
});

test('a late choice review cannot revive an invalidated account or manuscript session', async () => {
  for (const mutate of ['changeAccount', 'changeManuscript', 'changeAnalysis']) {
    const held = deferred(); const entered = deferred();
    const view = fixture('en', { beforeFetch: async path => {
      if (path.endsWith('/choice-review')) { entered.resolve(); await held.promise; }
    } });
    view.setJob('completed');
    const pending = open(view);
    await entered.promise;
    view[mutate](); view.checkIdentity();
    held.resolve(); await pending;
    assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), true);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    assert.doesNotMatch(view.elements.writerFinalEntryState.textContent, /All three choices are prepared/);
    assert.equal(writes(view).length, 0);
  }
});

test('a late response from a closed review cannot overwrite a reopened review', async () => {
  const held = deferred(); const entered = deferred(); let once = true;
  const view = fixture('en', { beforeFetch: async path => {
    if (once && path.endsWith('/choice-review')) { once = false; entered.resolve(); await held.promise; }
  } });
  view.setJob('completed');
  const old = open(view);
  await entered.promise;
  view.elements.writerFinalClose.fire('click');
  view.setReview('blocked');
  await open(view);
  const message = view.elements.writerFinalState.textContent;
  held.resolve(); await old;
  assert.equal(view.elements.writerFinalState.textContent, message);
  assert.match(message, /cannot be reset or regenerated/);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
});

test('identity changes while fresh review is pending cannot send paid or reset requests', async () => {
  const held = deferred(); const entered = deferred(); let hold = false;
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    beforeFetch: async path => { if (hold && path.endsWith('/choice-review')) { entered.resolve(); await held.promise; } } });
  view.setJob('failed'); await open(view);
  hold = true;
  const pending = click(view);
  await entered.promise;
  view.changeAccount(); view.checkIdentity();
  held.resolve(); await pending;
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 0);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
});

test('identity changes inside a confirmation still stop both reset and paid requests', async () => {
  for (const reviewStatus of ['current', 'settings_changed']) {
    const view = fixture('en', { reviewStatus, canReset: reviewStatus === 'settings_changed' });
    view.setJob('failed'); await open(view);
    view.setConfirmResult(() => { view.changeAccount(); return true; });
    await click(view);
    assert.equal(view.confirmations.length, 1);
    assert.equal(writes(view).length, 0);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
});

test('a late reset response after auth expiry cannot restore a retry button or ready message', async () => {
  const held = deferred(); const entered = deferred();
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    beforeFetch: async path => { if (path.endsWith('/reset-choices')) { entered.resolve(); await held.promise; } } });
  view.setJob('failed'); await open(view);
  const pending = click(view);
  await entered.promise;
  view.expireAuth();
  held.resolve(); await pending;
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
  assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), true);
  assert.equal(view.elements.writerFinalEntryState.textContent, '');
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
});

test('review outage after reset does not offer generation or chain paid retry', async () => {
  let view;
  view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    beforeFetch: async path => { if (path.endsWith('/reset-choices')) view.setReviewAvailable(false); } });
  view.setJob('failed'); await open(view);
  await click(view);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
  assert.match(view.elements.writerFinalState.textContent, /Could not verify choices/);
  await click(view);
  assert.equal(writes(view).length, 1);
});

test('double-open while loading performs only one readonly preview and review', async () => {
  const held = deferred(); const entered = deferred();
  const view = fixture('en', { beforeFetch: async path => {
    if (path.endsWith('/choice-review')) { entered.resolve(); await held.promise; }
  } });
  view.setJob('completed');
  const first = open(view);
  await entered.promise;
  await open(view);
  held.resolve(); await first;
  assert.equal(view.calls.filter(call => call.path.endsWith('/choice-review')).length, 1);
  assert.equal(writes(view).length, 0);
  assert.match(view.elements.writerFinalState.textContent, /All three choices are prepared/);
});

test('all five locales define every reset/re-review label, state and confirmation without fallback', async () => {
  const dictionary = vm.runInNewContext('(' + script.match(/const copy = ([\s\S]*?);\r?\n  const staticIds/)[1] + ')');
  const keys = ['stepChoiceReview', 'resetChoices', 'choiceReviewUnavailable', 'choiceSettingsChanged',
    'choiceResetWaiting', 'choiceApprovalRequired', 'choiceBlocked', 'choiceResetReady',
    'resetConfirm', 'retryConfirm', 'resettingChoices', 'resetUnconfirmed', 'choiceSettingsConsentChanged',
    'choiceConsentResetWaiting', 'resetConsentConfirm', 'resettingConsentChoices'];
  for (const locale of Object.keys(expected)) {
    for (const key of keys) {
      assert.match(dictionary[locale][key], /\S/, `${locale} ${key}`);
      if (locale !== 'ko') assert.notEqual(dictionary[locale][key], dictionary.ko[key], `${locale} ${key} fallback`);
    }
    assert.deepEqual(Object.keys(dictionary[locale]).sort(), Object.keys(dictionary.ko).sort());
    const view = fixture(locale, { reviewStatus: 'settings_changed', canReset: true });
    view.setJob('failed'); await open(view);
    assert.equal(view.elements.writerFinalPrepare.textContent, dictionary[locale].resetChoices);
    assert.equal(view.elements.writerFinalState.textContent, dictionary[locale].choiceSettingsChanged.replace('{count}', '1'));
    await click(view);
    assert.equal(view.confirmations[0], dictionary[locale].resetConfirm.replace('{count}', '1'));
    assert.equal(view.elements.writerFinalState.textContent, dictionary[locale].choiceResetReady);
    view.setConfirmResult(false); await click(view);
    assert.equal(view.confirmations[1], dictionary[locale].retryConfirm);
  }
  assert.match(dictionary.ko.choiceSettingsChanged, /생성 설정이 변경/);
  assert.match(dictionary.ko.resetConfirm, /AI 생성은 시작하지 않으며 비용이 발생하지 않습니다/);
  assert.match(dictionary.ko.retryConfirm, /AI 생성 요청이 대기열에 등록될 수 있고 비용이 발생할 수 있습니다/);
});

test('mixed changes send all four hashes and renewed-consent bindings in a normal reset body without auto retry', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    reviewOverrides: { resetConsentReview } });
  view.setJob('failed'); await open(view);
  assert.equal(view.consentPanelEvents.at(-1).type, 'reset');
  assert.equal(view.consentPanelEvents.some(event => event.type === 'show'), false);
  await click(view);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
  assert.equal(typeof writes(view)[0].body, 'object');
  assert.deepEqual(JSON.parse(JSON.stringify(writes(view)[0].body)), {
    expectedManuscriptHash: 'manuscript-hash', expectedApprovedFingerprint: 'approved-fingerprint',
    expectedProfilePinHash: 'c'.repeat(64), expectedReleaseChecksum: 'release-checksum', resetConfirmed: true,
    expectedConsentId: resetConsentReview.consentId, expectedConsentRevision: resetConsentReview.consentRevision,
    expectedBatchHash: resetConsentReview.batchHash, consentChangeConfirmed: true
  });
  assert.equal(view.elements.writerFinalParts.children[0].children[1].textContent, 'Source excerpt');
  assert.equal(view.elements.writerFinalParts.children[0].children[2].textContent, 'Original path: Source next');
  assert.equal(view.elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].value, 'Original choice');
  assert.equal(view.elements.writerFinalPrepare.textContent, 'Retry choice preparation');
  assert.equal(view.confirmations.length, 1);
  view.setConfirmResult(false); await click(view);
  assert.match(view.confirmations[1], /may incur a cost/);
  assert.equal(writes(view).length, 1);
  view.setConfirmResult(true); await click(view);
  assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices', 'retry-choices']);
  assert.equal(view.confirmations.length, 3);
});

test('cancelled mixed reset makes no POST and preserves the reset action with consent-only panel hidden', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true, confirmResult: false,
    reviewOverrides: { resetConsentReview } });
  view.setJob('completed'); await open(view); await click(view);
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 1);
  assert.match(view.confirmations[0], /Current rights approval was renewed and the writer style changed/);
  assert.equal(view.elements.writerFinalPrepare.disabled, false);
  assert.equal(view.elements.writerFinalPrepare.textContent, 'Reset outdated choices');
  assert.equal(view.consentPanelEvents.some(event => event.type === 'show'), false);
  assert.equal(view.consentPanelEvents.at(-1).type, 'reset');
});

test('present but malformed renewed-consent review always fails closed with no confirmation or AI action', async () => {
  const invalid = [null, undefined, false, 1, '', [], [resetConsentReview], {},
    { consentId: resetConsentReview.consentId, consentRevision: 2 },
    ...['not-a-uuid', resetConsentReview.consentId + 'x', 123, null].map(consentId => ({ ...resetConsentReview, consentId })),
    ...[0, -1, 1.5, '2', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
      .map(consentRevision => ({ ...resetConsentReview, consentRevision })),
    ...[null, 123, 'e'.repeat(63), 'g'.repeat(64), 'E'.repeat(64)]
      .map(batchHash => ({ ...resetConsentReview, batchHash })),
    { ...resetConsentReview, unexpected: true }];
  for (const status of ['settings_changed', 'current', 'reset_ready']) {
    for (const consent of invalid) {
      const view = fixture('en', { reviewStatus: status, canReset: status === 'settings_changed',
        reviewOverrides: { resetConsentReview: consent } });
      view.setJob('failed'); await open(view); await click(view);
      assert.match(view.elements.writerFinalState.textContent, /Could not verify choices/);
      assert.equal(view.elements.writerFinalPrepare.disabled, true);
      assert.equal(writes(view).length, 0);
      assert.equal(view.confirmations.length, 0);
      assert.equal(view.consentPanelEvents.some(event => event.type === 'show'), false);
      assert.equal(view.consentPanelEvents.at(-1).type, 'reset');
    }
  }
});

test('fresh review must retain the previously shown consent ID, revision, batch and property presence', async () => {
  for (const [before, after] of [
    [resetConsentReview, { ...resetConsentReview, consentId: '66666666-6666-4666-8666-666666666666' }],
    [resetConsentReview, { ...resetConsentReview, consentRevision: 3 }],
    [resetConsentReview, { ...resetConsentReview, batchHash: 'f'.repeat(64) }],
    [resetConsentReview, null], [null, resetConsentReview]
  ]) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: before ? { resetConsentReview: before } : {} });
    view.setJob('failed'); await open(view);
    view.setReviewOverrides(after ? { resetConsentReview: after } : {});
    await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    assert.match(view.elements.writerFinalState.textContent, /review content changed/i);
    view.elements.writerFinalClose.fire('click'); await open(view);
    assert.equal(writes(view).length, 0);
    await click(view);
    assert.equal(writes(view).length, 1);
    assert.equal(writes(view)[0].body.expectedConsentRevision, after?.consentRevision);
    assert.equal(writes(view)[0].body.expectedConsentId, after?.consentId);
    assert.equal(writes(view)[0].body.expectedBatchHash, after?.batchHash);
  }
});

test('a malformed fresh consent binding cannot reuse a previously valid mixed reset review', async () => {
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
    reviewOverrides: { resetConsentReview } });
  view.setJob('failed'); await open(view);
  view.setReviewOverrides({ resetConsentReview: { ...resetConsentReview, consentRevision: '2' } });
  await click(view);
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 0);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
});

test('mixed reset still rejects changed manuscript, analysis, writer settings and full profile pin', async () => {
  for (const mutate of ['changeHash', 'changeFingerprint', 'reapproveUnchangedSettings']) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview } });
    view.setJob('failed'); await open(view); view[mutate](); await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
  for (const overrides of [{ parts: [{ partKey: 'p1', title: 'Changed', endingExcerpt: 'Changed prose' }] },
    { analysisJobId: 'changed-analysis' }]) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview } });
    view.setJob('failed'); await open(view); view.setPreviewOverrides(overrides); await click(view);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
});

test('mixed active jobs cannot reset even when canReset is erroneously true', async () => {
  for (const status of ['queued', 'processing']) {
    for (const canReset of [false, true]) {
      const view = fixture('en', { reviewStatus: 'settings_changed', canReset,
        reviewOverrides: { resetConsentReview } });
      view.setJob(status); await open(view); await click(view);
      assert.match(view.elements.writerFinalState.textContent, /rights approval was renewed and the writer style changed/);
      assert.match(view.elements.writerFinalState.textContent, /choice job is active/);
      assert.equal(view.elements.writerFinalPrepare.disabled, true);
      assert.equal(view.confirmations.length, 0);
      assert.equal(writes(view).length, 0);
    }
  }
});

test('rights-only review remains a readonly reapproval panel and never offers reset or paid retry', async () => {
  const view = fixture('en', { reviewStatus: 'consent_changed' });
  view.setJob('failed'); await open(view); await click(view);
  assert.equal(view.elements.writerFinalPrepare.disabled, true);
  assert.equal(view.consentPanelEvents.at(-1).review.status, 'consent_changed');
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 0);
});

test('polling and locale changes hide the consent-only panel when a review changes to mixed status', async () => {
  const view = fixture('en', { reviewStatus: 'consent_changed' });
  view.setJob('queued'); await open(view);
  assert.equal(view.consentPanelEvents.at(-1).review.status, 'consent_changed');
  const shown = view.consentPanelEvents.filter(event => event.type === 'show').length;
  view.setReview('settings_changed', true); view.setReviewOverrides({ resetConsentReview }); view.setJob('failed');
  await view.refresh();
  assert.equal(view.consentPanelEvents.at(-1).type, 'reset');
  view.switchLocale('ja-JP');
  assert.equal(view.consentPanelEvents.at(-1).type, 'reset');
  assert.equal(view.consentPanelEvents.filter(event => event.type === 'show').length, shown);
  assert.equal(view.elements.writerFinalPrepare.disabled, false);
  assert.equal(writes(view).length, 0);
  assert.equal(view.confirmations.length, 0);
});

test('mixed reset confirmation uses the server union scene count rather than only stale-style choices', async () => {
  const parts = ['p1', 'p2', 'p3'].map(partKey => ({ partKey, title: partKey, endingExcerpt: 'Original prose' }));
  const scenes = parts.map((part, index) => ({ partKey: part.partKey, sceneId: 'scene-' + index, choiceCount: 3 }));
  const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true, confirmResult: false,
    reviewOverrides: { resetConsentReview, resetRequiredScenes: 2, preparedScenes: 3 },
    previewOverrides: { parts, scenes, choiceJob: { status: 'failed', totalParts: 3, completedParts: 3 } } });
  view.setJob('failed'); await open(view); await click(view);
  assert.match(view.elements.writerFinalState.textContent, /in 2 scenes/);
  assert.match(view.confirmations[0], /in 2 scenes/);
  assert.equal(writes(view).length, 0);
});

test('late mixed fresh reviews cannot revive a stale account, manuscript, analysis or expired session', async () => {
  for (const mutate of ['changeAccount', 'changeManuscript', 'changeAnalysis', 'expireAuth']) {
    const held = deferred(); const entered = deferred(); let hold = false;
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview },
      beforeFetch: async path => { if (hold && path.endsWith('/choice-review')) { entered.resolve(); await held.promise; } } });
    view.setJob('failed'); await open(view); hold = true;
    const pending = click(view); await entered.promise;
    view[mutate](); view.checkIdentity(); held.resolve(); await pending;
    assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), true);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    assert.equal(writes(view).length, 0);
    assert.equal(view.confirmations.length, 0);
  }
});

test('mixed reset rechecks identity and session scope immediately after confirmation', async () => {
  for (const mutate of ['changeAccount', 'changeManuscript', 'changeAnalysis', 'expireAuth']) {
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview } });
    view.setJob('failed'); await open(view);
    view.setConfirmResult(() => { view[mutate](); return true; }); await click(view);
    assert.equal(view.confirmations.length, 1);
    assert.equal(writes(view).length, 0);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
  }
});

test('late mixed reset completion after account change or auth expiry cannot enable or chain paid retry', async () => {
  for (const mutate of ['changeAccount', 'expireAuth']) {
    const held = deferred(); const entered = deferred();
    const view = fixture('en', { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview },
      beforeFetch: async path => { if (path.endsWith('/reset-choices')) { entered.resolve(); await held.promise; } } });
    view.setJob('failed'); await open(view);
    const pending = click(view); await entered.promise;
    view[mutate](); view.checkIdentity(); held.resolve(); await pending;
    assert.deepEqual(writes(view).map(call => call.path.split('/').at(-1)), ['reset-choices']);
    assert.equal(view.elements.writerFinalModal.classList.contains('is-hidden'), true);
    assert.equal(view.elements.writerFinalPrepare.disabled, true);
    assert.equal(view.elements.writerFinalEntryState.textContent, '');
  }
});

test('all five mixed-change locales explain renewed rights, writer style, archive/clear, preservation and separate paid consent', async () => {
  const dictionary = vm.runInNewContext('(' + script.match(/const copy = ([\s\S]*?);\r?\n  const staticIds/)[1] + ')');
  const phrases = {
    ko: ['현재 권리 승인이 갱신', '작가 문체가 변경', '보관한 뒤 비', '원문과 원작 경로는 보존',
      'AI 생성은 시작하지 않으며 비용이 발생하지 않습니다', '비용 발생 가능성'],
    en: ['Current rights approval was renewed', 'writer style changed', 'clear', 'Original prose and original paths are preserved',
      'No AI generation starts and no cost is incurred', 'separate possible-cost confirmation'],
    ja: ['現在の権利承認が更新', '作家の文体が変更', 'アーカイブして消去', '原文と原作経路は保持',
      'AI生成は開始せず、費用も発生しません', '費用が発生する可能性'],
    'zh-Hans': ['当前权利批准已更新', '作者文风也已变更', '归档并清空', '原文及原作路径会保留',
      '不会启动 AI 生成，也不会产生费用', '单独'],
    'zh-Hant': ['目前權利批准已更新', '作者文風也已變更', '封存並清空', '原文及原作路徑會保留',
      '不會啟動 AI 生成，也不會產生費用', '單獨']
  };
  for (const [locale, words] of Object.entries(phrases)) {
    let view; const progress = [];
    view = fixture(locale, { reviewStatus: 'settings_changed', canReset: true,
      reviewOverrides: { resetConsentReview },
      beforeFetch: async path => { if (path.endsWith('/reset-choices')) progress.push(view.elements.writerFinalState.textContent); } });
    view.setJob('failed'); await open(view);
    assert.equal(view.elements.writerFinalState.textContent,
      dictionary[locale].choiceSettingsConsentChanged.replace('{count}', '1'));
    await click(view);
    assert.equal(view.confirmations[0], dictionary[locale].resetConsentConfirm.replace('{count}', '1'));
    for (const key of ['choiceSettingsConsentChanged', 'resetConsentConfirm']) {
      for (const word of words) assert.ok(dictionary[locale][key].includes(word), `${locale} ${key} ${word}`);
    }
    assert.deepEqual(progress, [dictionary[locale].resettingConsentChoices]);
    assert.equal(writes(view).length, 1);
    view.setConfirmResult(false); await click(view);
    assert.equal(view.confirmations[1], dictionary[locale].retryConfirm);
    assert.equal(writes(view).length, 1);
  }
});

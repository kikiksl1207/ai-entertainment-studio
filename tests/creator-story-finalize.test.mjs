import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../pages/creator-story-finalize.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const id = '11111111-1111-4111-8111-111111111111';
const manuscriptId = '22222222-2222-4222-8222-222222222222';
const analysisId = '33333333-3333-4333-8333-333333333333';
const releaseId = '44444444-4444-4444-8444-444444444444';

class Element {
  constructor(id = '') {
    this.id = id; this.children = []; this.listeners = {}; this.value = ''; this.checked = false;
    this.hidden = false; this.disabled = false; this.dataset = {}; this.textContent = '';
    const names = new Set(['is-hidden']);
    this.classList = { add: name => names.add(name), remove: name => names.delete(name),
      contains: name => names.has(name), toggle: (name, state) => state ? names.add(name) : names.delete(name) };
  }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  fire(name) { return this.listeners[name]?.({ target: this }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const walk = node => [node, ...node.children.flatMap(walk)];
    return this.children.flatMap(walk).filter(node => selector === 'input[data-part-key]' && node.dataset.partKey);
  }
}

function fixture({ missingJob = false, existingDraft = false, submittedOnly = false, issues = [], profileStatus = 'approved', wrongProfile = false,
  summarylessProfile = false, failMaterializeOnce = false, failConsentResponseOnce = false,
  failPreviewAfterSubmit = false,
  failReadAfterMaterialize = false,
  companySubmission = false, receiptOverride = {}, changedCompanyRead = false, failedCompanyRead = false,
  changedCompanyProfile = false, companyReopen = false, readReviewOverride = {}, readReceiptOverride = {},
  previewErrorCode = null, uiLocale = 'ko',
  workerAvailable } = {}) {
  const ids = ['writerFinalEntry', 'writerFinalModal', 'writerFinalParts', 'writerFinalIssues', 'writerFinalWarningsLabel', 'writerFinalState',
    'writerFinalEntryState', 'writerFinalPrepare', 'writerFinalOpen', 'writerFinalClose', 'writerFinalStage',
    'writerFinalSummary', 'writerFinalProposals', 'writerFinalProfileStatus', 'writerFinalSummaryReviewed',
    'writerFinalProposalReviewed', 'writerFinalContinuityReviewed',
    'writerFinalCancel', 'writerFinalReviewed', 'writerFinalRights', 'writerFinalAi', 'writerFinalWarnings'];
  const elements = Object.fromEntries(ids.map(name => [name, new Element(name)]));
  const calls = [];
  const intervals = [];
  let currentOwnerId = id;
  let reviewState = existingDraft || submittedOnly || companyReopen ? 'submitted' : 'analysis_ready';
  let revision = companyReopen ? 2 : 1; let ready = false;
  let reviewOpen = existingDraft || submittedOnly || companyReopen;
  let companySaved = companyReopen;
  let profileFingerprint = 'a'.repeat(64);
  let submitted = existingDraft || submittedOnly; let consented = existingDraft; let materialized = existingDraft;
  let failedSubmitReads = 0;
  let failedMaterializeReads = 0;
  let failNextPreview = false;
  let job = null;
  const scenes = [0, 1].map(index => ({ partKey: `p${index + 1}`, sceneId: `${index + 5}`.repeat(36).slice(0, 36),
    choiceCount: 1, originalLabel: `원래 길 ${index + 1}` }));
  const companyReview = (receipt = {}, review = {}) => ({ reviewId: id, state: reviewState, revision,
    approvalBasis: 'company_delegation', companySubmission: {
      contract: 'story-company-final-submission-v1', scope: 'manuscript_submission',
      submissionId: '55555555-5555-4555-8555-555555555555', manuscriptVersionId: manuscriptId,
      manuscriptHash: 'a'.repeat(64), analysisJobId: analysisId, reviewRevision: 2,
      bindingHash: 'd'.repeat(64), humanSemanticReview: false, published: false, generationStarted: false,
      ...receipt }, ...review });
  const preview = () => ({ manuscriptVersionId: manuscriptId, manuscriptHash: 'a'.repeat(64),
    analysisJobId: analysisId, issues, review: companySaved ? companyReview(readReceiptOverride, readReviewOverride)
      : reviewOpen ? { reviewId: id, state: reviewState, revision } : null,
    consent: consented ? { active: true, revision: 1 } : null,
    parts: [{ partKey: 'p1', title: '처음', endingExcerpt: '갈림길', nextPartTitle: '다음' },
      { partKey: 'p2', title: '다음', endingExcerpt: '결말', nextPartTitle: null }],
    releaseId: materialized ? releaseId : null, scenes: materialized ? scenes : [], ready,
    choiceJob: materialized ? job : null,
    ...(workerAvailable === undefined ? {} : { choiceWorkerAvailable: workerAvailable }) });
  const sections = ['writing_style', 'scene_scale', 'canon', 'timeline', 'narrative_devices',
    'branch_behavior', 'visual_direction', 'visual_cast'].map(key => ({ key, decision: 'accepted',
    value: summarylessProfile && key === 'canon'
      ? { observations: [{ detail: '작가가 승인한 등장인물 설정' }] }
      : { summary: `${key} 실제 분석 내용` }, evidence: [{ summary: `${key} 원고 근거` }] }));
  const settings = { schemaVersion: 'creator-generation-profile-v1', kind: 'story', sections };
  const generationProfile = () => ({ workId: id, manuscript: { id: wrongProfile ? id : manuscriptId },
    analysis: { id: analysisId }, profile: { status: profileStatus,
      approvedFingerprint: profileFingerprint, approvedSettings: settings, draftSettings: settings } });
  const fetch = async (path, options = {}) => {
    calls.push({ path, ...options });
    let result;
    if (path.endsWith(`/linear-draft/${manuscriptId}`)) {
      if (previewErrorCode) return { ok: false, status: 409, json: async () => ({ code: previewErrorCode }) };
      if (failedSubmitReads > 0 || failedMaterializeReads > 0 || failNextPreview) {
        if (failedSubmitReads > 0) failedSubmitReads--;
        if (failedMaterializeReads > 0) failedMaterializeReads--;
        failNextPreview = false;
        return { ok: false, status: 503, json: async () => ({ code: 'TEMPORARY_FAILURE' }) };
      }
      result = preview();
    }
    else if (path.endsWith('/generation-profile')) result = generationProfile();
    else if (path.endsWith('/choice-review')) result = { releaseId, status: 'current', code: null,
      canReset: false, expectedManuscriptHash: 'a'.repeat(64), expectedApprovedFingerprint: profileFingerprint,
      expectedProfilePinHash: 'c'.repeat(64),
      expectedReleaseChecksum: 'checksum', resetRequiredScenes: 0, preparedScenes: job?.completedParts || 0,
      generationStarted: false };
    else if (path.endsWith('/reviews')) {
      reviewOpen = true;
      if (companySubmission) {
        reviewState = 'submitted'; revision = 2; submitted = true; companySaved = true;
        if (failedCompanyRead) failNextPreview = true;
        if (changedCompanyProfile) profileFingerprint = 'b'.repeat(64);
        result = companyReview(receiptOverride);
        if (changedCompanyRead) revision++;
      } else result = { reviewId: id, state: reviewState, revision };
    }
    else if (path.endsWith('/transition')) {
      reviewState = options.body.toState; revision++;
      result = { reviewId: id, state: reviewState, revision };
    } else if (path.endsWith('/submit')) {
      submitted = true; reviewState = 'submitted'; revision++;
      if (failPreviewAfterSubmit) failedSubmitReads = 2;
      result = { status: 'submitted' };
    }
    else if (path.endsWith('/style-consent')) {
      consented = true;
      if (failConsentResponseOnce) {
        failConsentResponseOnce = false;
        failNextPreview = true;
        return { ok: false, status: 503, json: async () => ({ code: 'TEMPORARY_FAILURE' }) };
      }
      result = { status: 'active' };
    }
    else if (path.endsWith('/materialize')) {
      if (failMaterializeOnce) {
        failMaterializeOnce = false;
        failNextPreview = true;
        return { ok: false, status: 503, json: async () => ({ code: 'TEMPORARY_FAILURE' }) };
      }
      materialized = true;
      if (!missingJob) job = { status: 'queued', totalParts: 2, completedParts: 0, errorCode: null };
      options.body.originalRoutes.forEach((route, index) => { scenes[index].originalLabel = route.label; });
      if (failReadAfterMaterialize) { failedMaterializeReads = 2; failReadAfterMaterialize = false; }
      result = { releaseId, scenes };
    }
    else if (path.endsWith('/retry-choices')) {
      job = { ...job, status: 'queued', errorCode: null };
      result = { releaseId, status: 'queued' };
    }
    else throw new Error(`unexpected ${path}`);
    return { ok: true, json: async () => result };
  };
  const document = { getElementById: name => elements[name], createElement: () => new Element(), addEventListener() {} };
  const window = { confirm: () => true, LuminaCreatorStudioApi: { fetch, isCurrent: identity => identity?.ownerId === currentOwnerId },
    luminaI18n: { getLocale: () => uiLocale },
    LuminaCreatorAnalysis: { completed: () => ({ manuscriptVersionId: manuscriptId, workId: id,
      analysisJobId: analysisId, identity: { ownerId: currentOwnerId } }) }, addEventListener() {} };
  vm.runInNewContext(script, { window, document, setInterval: callback => { intervals.push(callback); return intervals.length; }, console });
  return { elements, calls, scenes,
    changeCompanyRead: (review = {}, receipt = {}) => { readReviewOverride = review; readReceiptOverride = receipt; },
    forgetCompanyReceipt: () => { companySaved = false; },
    changeAccount: () => { currentOwnerId = releaseId; intervals[0](); },
    failPreview: code => { previewErrorCode = code; },
    refresh: () => intervals[1](),
    changeProfile: () => { profileFingerprint = 'b'.repeat(64); },
    setReady: value => { ready = value; },
    setJob: (status, completedParts = 0) => { job = { totalParts: 2, ...job, status, completedParts,
      errorCode: status === 'failed' ? 'STUDIO_CHOICES_GENERATION_FAILED' : null };
      scenes.forEach((scene, index) => { scene.choiceCount = index < completedParts ? 3 : 1; });
      if (status === 'completed') ready = true; } };
}

function authorChecks(elements) {
  for (const name of ['SummaryReviewed', 'ProposalReviewed', 'ContinuityReviewed', 'Reviewed', 'Rights', 'Ai'])
    elements[`writerFinal${name}`].checked = true;
}

test('company manuscript submission refreshes without forged human checks, consent, materialization or paid retry', async () => {
  const { elements, calls } = fixture({ companySubmission: true });
  await elements.writerFinalOpen.fire('click');
  elements.writerFinalSummaryReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(elements.writerFinalState.textContent, '회사 위임 · 원고 제출 완료');
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.some(call => /\/(transition|submit|style-consent|materialize|prepare-choices|retry-choices)$/.test(call.path)), false);
  for (const name of ['ProposalReviewed', 'ContinuityReviewed', 'Reviewed', 'Rights', 'Ai', 'Warnings'])
    assert.equal(elements[`writerFinal${name}`].checked, false);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /권리·AI 승인 항목/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

for (const [field, value] of Object.entries({ contract: 'other', scope: 'publication', submissionId: 'bad',
  manuscriptVersionId: id, manuscriptHash: 'b'.repeat(64), analysisJobId: id, reviewRevision: 3,
  bindingHash: 'bad', humanSemanticReview: true, published: true, generationStarted: true })) {
  test(`company submission rejects an unverifiable ${field} before follow-up writes`, async () => {
    const { elements, calls } = fixture({ companySubmission: true, receiptOverride: { [field]: value } });
    await elements.writerFinalOpen.fire('click');
    elements.writerFinalSummaryReviewed.checked = true;
    await elements.writerFinalPrepare.fire('click');
    assert.match(elements.writerFinalState.textContent, /원고 제출 상태를 확인할 수 없습니다/);
    assert.equal(calls.filter(call => call.method === 'POST' || call.method === 'PUT').length, 1);
  });
}

for (const option of ['changedCompanyRead', 'failedCompanyRead', 'changedCompanyProfile']) {
  test(`company submission preserves an uncertain ${option} failure without paid retry`, async () => {
    const { elements, calls } = fixture({ companySubmission: true, [option]: true });
    await elements.writerFinalOpen.fire('click');
    elements.writerFinalSummaryReviewed.checked = true;
    await elements.writerFinalPrepare.fire('click');
    assert.doesNotMatch(elements.writerFinalState.textContent, /회사 위임 · 원고 제출 완료/);
    assert.equal(calls.filter(call => call.method === 'POST' || call.method === 'PUT').length, 1);
  });
}

test('company POST reconciliation requires the same validated GET receipt before showing the company status', async () => {
  for (const variant of [
    { readReviewOverride: { companySubmission: null } },
    { readReviewOverride: { approvalBasis: 'human_review' } },
    { readReceiptOverride: { bindingHash: 'e'.repeat(64) } },
    { readReceiptOverride: { submissionId: '66666666-6666-4666-8666-666666666666' } },
  ]) {
    const { elements, calls } = fixture({ companySubmission: true, ...variant });
    await elements.writerFinalOpen.fire('click');
    elements.writerFinalSummaryReviewed.checked = true;
    await elements.writerFinalPrepare.fire('click');
    assert.match(elements.writerFinalState.textContent, /검토 내용이 변경/);
    assert.doesNotMatch(elements.writerFinalState.textContent, /회사 위임/);
    assert.equal(elements.writerFinalPrepare.disabled, true);
    authorChecks(elements);
    await elements.writerFinalPrepare.fire('click');
    assert.equal(calls.filter(call => call.method === 'POST' || call.method === 'PUT').length, 1);
  }
});

test('company receipt GET and reopening show only the manuscript status in five locales without writes or consent checks', async () => {
  const statuses = { ko: '회사 위임 · 원고 제출 완료', en: 'Company delegation · Manuscript submitted',
    ja: '会社委任 · 原稿提出完了', 'zh-Hans': '公司委托 · 稿件已提交', 'zh-Hant': '公司委託 · 稿件已提交' };
  for (const [uiLocale, status] of Object.entries(statuses)) {
    const { elements, calls } = fixture({ companyReopen: true, uiLocale });
    await elements.writerFinalOpen.fire('click');
    assert.equal(elements.writerFinalState.textContent, status);
    assert.equal(elements.writerFinalEntryState.textContent, status);
    for (const name of ['Reviewed', 'Rights', 'Ai', 'Warnings']) assert.equal(elements[`writerFinal${name}`].checked, false);
    elements.writerFinalRights.checked = true;
    elements.writerFinalAi.checked = true;
    elements.writerFinalClose.fire('click');
    await elements.writerFinalOpen.fire('click');
    assert.equal(elements.writerFinalState.textContent, status);
    for (const name of ['Reviewed', 'Rights', 'Ai', 'Warnings']) assert.equal(elements[`writerFinal${name}`].checked, false);
    await elements.writerFinalPrepare.fire('click');
    assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
    assert.equal(calls.filter(call => call.path.endsWith(`/linear-draft/${manuscriptId}`)).length, 2);
  }
});

test('invalid or mixed company GET receipts block readiness and preparation without a POST retry', async () => {
  const receipts = { contract: 'other', scope: 'publication', submissionId: 'bad', manuscriptVersionId: id,
    manuscriptHash: 'b'.repeat(64), analysisJobId: id, reviewRevision: 3, bindingHash: 'bad',
    humanSemanticReview: true, published: true, generationStarted: true };
  const variants = Object.entries(receipts).map(([field, value]) => ({ readReceiptOverride: { [field]: value } }));
  variants.push(...[{ approvalBasis: 'human_review' }, { approvalBasis: null }, { companySubmission: null },
    { companySubmission: undefined }, { state: 'final_confirmation' }, { revision: 3 }, { reviewId: 'bad' }]
    .map(readReviewOverride => ({ readReviewOverride })));
  for (const variant of variants) {
    const { elements, calls, setJob } = fixture({ companyReopen: true, existingDraft: true, ...variant });
    setJob('completed', 2);
    await elements.writerFinalOpen.fire('click');
    assert.match(elements.writerFinalState.textContent, /검토 내용이 변경/);
    assert.doesNotMatch(elements.writerFinalState.textContent, /회사 위임|선택지 3개가 모두 준비/);
    assert.equal(elements.writerFinalPrepare.disabled, true);
    assert.doesNotMatch(elements.writerFinalStage.textContent, /준비 완료/);
    authorChecks(elements);
    await elements.writerFinalPrepare.fire('click');
    assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT' || call.path.endsWith('/choice-review')), false);
  }
});

test('changed or missing company receipt evidence stays blocked until reopening, never retrying submission', async () => {
  for (const [review, receipt] of [
    [{}, { bindingHash: 'e'.repeat(64) }],
    [{}, { submissionId: '66666666-6666-4666-8666-666666666666' }],
    [null, {}],
    [{ revision: 3 }, {}],
  ]) {
    const { elements, calls, changeCompanyRead, forgetCompanyReceipt } = fixture({ companyReopen: true });
    await elements.writerFinalOpen.fire('click');
    authorChecks(elements);
    if (review === null) forgetCompanyReceipt();
    else changeCompanyRead(review, receipt);
    await elements.writerFinalPrepare.fire('click');
    assert.match(elements.writerFinalState.textContent, /검토 내용이 변경/);
    assert.equal(elements.writerFinalPrepare.disabled, true);
    changeCompanyRead();
    const reads = calls.length;
    await elements.writerFinalPrepare.fire('click');
    assert.equal(calls.length, reads);
    assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
    if (review !== null) {
      elements.writerFinalClose.fire('click');
      await elements.writerFinalOpen.fire('click');
      assert.equal(elements.writerFinalState.textContent, '회사 위임 · 원고 제출 완료');
      assert.equal(elements.writerFinalRights.checked, false);
      assert.equal(elements.writerFinalAi.checked, false);
    }
  }
});

test('COMPANY_FINAL_SUBMISSION_CHANGED maps GET failures to reviewChanged and blocks all writes', async () => {
  for (const duringPrepare of [false, true]) {
    const { elements, calls, failPreview } = fixture({ companyReopen: true });
    if (!duringPrepare) failPreview('COMPANY_FINAL_SUBMISSION_CHANGED');
    await elements.writerFinalOpen.fire('click');
    if (duringPrepare) {
      authorChecks(elements);
      failPreview('COMPANY_FINAL_SUBMISSION_CHANGED');
      await elements.writerFinalPrepare.fire('click');
    }
    assert.match(elements.writerFinalState.textContent, /검토 내용이 변경/);
    assert.doesNotMatch(elements.writerFinalState.textContent, /COMPANY_FINAL_|회사 위임/);
    assert.equal(elements.writerFinalPrepare.disabled, true);
    assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
  }
});

test('a valid company receipt preserves the separate existing choice readiness status', async () => {
  const { elements, calls, setJob } = fixture({ companyReopen: true, existingDraft: true });
  setJob('completed', 2);
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /^회사 위임 · 원고 제출 완료\n선택지 3개가 모두 준비/);
  assert.equal(elements.writerFinalStage.textContent, '선택지 준비 완료');
  assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
});

test('company submission never replaces explicit author rights and AI consent', async () => {
  const { elements, calls } = fixture({ companyReopen: true });
  await elements.writerFinalOpen.fire('click');
  elements.writerFinalReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
  elements.writerFinalRights.checked = true;
  elements.writerFinalAi.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.some(call => call.path.endsWith('/reviews') || call.path.endsWith('/submit')), false);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
  assert.match(elements.writerFinalState.textContent, /^회사 위임 · 원고 제출 완료\nAI 선택지 준비가 대기 중/);
});

test('account changes close the company receipt and discard its current UI authority', async () => {
  const { elements, calls, changeAccount } = fixture({ companyReopen: true });
  await elements.writerFinalOpen.fire('click');
  authorChecks(elements);
  changeAccount();
  assert.equal(elements.writerFinalModal.classList.contains('is-hidden'), true);
  assert.equal(elements.writerFinalEntryState.textContent, '');
  assert.equal(elements.writerFinalPrepare.disabled, true);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.some(call => call.method === 'POST' || call.method === 'PUT'), false);
});

async function advanceToConfirmation(elements) {
  authorChecks(elements);
  for (let index = 0; index < 4; index++) await elements.writerFinalPrepare.fire('click');
}

test('Studio final review prepares exactly two AI alternatives only after explicit author checks', async () => {
  assert.match(html, /creator-story-finalize\.js/);
  assert.match(html, /writerFinalSummary/);
  assert.match(html, /writerFinalProposals/);
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]').length, 2);
  assert.match(elements.writerFinalSummary.children[0].children[1].textContent, /실제 분석 내용/);
  assert.match(elements.writerFinalProposals.children[0].children[1].textContent, /실제 분석 내용/);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const inputs = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  inputs[0].value = '기록을 가지고 다음 장소로 간다';
  inputs[1].value = '원래 결말을 받아들인다';
  await advanceToConfirmation(elements);
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 4);
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).at(-1).body.decisions.warningAcknowledged, false);
  assert.equal(calls.some(call => call.path.endsWith('/submit')), false);
  assert.equal(calls.some(call => call.path.endsWith('/materialize')), false);
  assert.match(elements.writerFinalState.textContent, /다시 눌러/);
  await elements.writerFinalPrepare.fire('click');
  const materialize = calls.find(call => call.path.endsWith('/materialize'));
  assert.deepEqual(Array.from(materialize.body.originalRoutes, row => row.label),
    ['기록을 가지고 다음 장소로 간다', '원래 결말을 받아들인다']);
  assert.equal(materialize.body.originalRoutesReviewed, true);
  const consent = calls.find(call => call.path.endsWith('/style-consent'));
  assert.equal(consent.body.rightsConfirmed, true);
  assert.equal(consent.body.aiBranchAllowed, true);
  assert.equal(consent.body.imageTransformationAllowed, false);
  assert.equal(calls.filter(call => call.path.endsWith('/prepare-choices')).length, 0);
  assert.ok(calls.findIndex(call => call.path.endsWith('/submit')) < calls.findIndex(call => call.path.endsWith('/materialize')));
  assert.equal(calls.some(call => call.path.endsWith('/finish')), false);
  assert.match(elements.writerFinalState.textContent, /AI 선택지 준비가 대기 중/);
  assert.equal(elements.writerFinalPrepare.disabled, true);
});

test('an author may leave original choice wording empty for private AI preparation', async () => {
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  const inputs = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  assert.equal(inputs.every(input => input.required === false), true);
  assert.match(elements.writerFinalParts.children[0].children[3].textContent, /선택 입력/);
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  const materialize = calls.find(call => call.path.endsWith('/materialize'));
  assert.deepEqual(Array.from(materialize.body.originalRoutes, route => route.label), ['', '']);
  assert.equal(materialize.body.originalRoutesReviewed, true);
  assert.equal(calls.some(call => call.path.endsWith('/style-consent')), true);
  assert.match(elements.writerFinalState.textContent, /준비가 대기 중/);
});

test('failed background choice preparation stays private and can be retried without resubmitting consent', async () => {
  const { elements, calls, setJob } = fixture();
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '첫 기록을 따라간다';
  labels[1].value = '원작 결말을 향한다';
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.some(call => call.path.endsWith('/finish')), false);
  setJob('failed', 1);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /1 \/ 2파트에서 멈췄습니다/);
  assert.equal(elements.writerFinalPrepare.disabled, false);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/retry-choices')).length, 1);
  assert.match(elements.writerFinalState.textContent, /AI 선택지 준비가 대기 중/);
});

test('unresolved critical continuity finding blocks the author approval button', async () => {
  const { elements, calls } = fixture({ issues: [{ severity: 'critical', summary: '앞 파트의 설정과 충돌' }] });
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalPrepare.disabled, true);
  assert.match(elements.writerFinalState.textContent, /심각한 설정 충돌/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('generic original-route labels are rejected before proposal approval or consent writes', async () => {
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = 'Continue';
  labels[1].value = '원래 결말을 받아들인다';
  authorChecks(elements);
  await elements.writerFinalPrepare.fire('click');
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /구체적인 선택/);
  assert.equal(labels[0].focused, true);
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/submit') || call.path.endsWith('/style-consent')), false);

  labels[0].value = '기록을 가지고 다음 장소로 간다';
  for (let index = 0; index < 3; index++) await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 4);
  assert.equal(calls.some(call => call.path.endsWith('/submit')), false);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
  assert.equal(elements.writerFinalPrepare.disabled, true);
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].readOnly, true);
  const writes = calls.filter(call => call.method === 'POST' || call.method === 'PUT').length;
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalPrepare.disabled, true);
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].readOnly, true);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.method === 'POST' || call.method === 'PUT').length, writes);
});

test('materialization response alone does not claim queued work without a persisted job', async () => {
  const { elements } = fixture({ missingJob: true });
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '기록을 가지고 다음 장소로 간다';
  labels[1].value = '원래 결말을 받아들인다';
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /서버의 선택지 준비 작업을 확인할 수 없습니다/);
  assert.doesNotMatch(elements.writerFinalState.textContent, /공개 전 운영 검토가 남아 있습니다/);
  assert.equal(elements.writerFinalPrepare.disabled, false);
});

test('an open review updates from background progress to verified completion', async () => {
  const { elements, setJob, refresh } = fixture();
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '기록을 가지고 다음 장소로 간다';
  labels[1].value = '원래 결말을 받아들인다';
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  setJob('processing', 1);
  await refresh();
  assert.match(elements.writerFinalState.textContent, /1 \/ 2/);
  setJob('completed', 2);
  await refresh();
  assert.match(elements.writerFinalState.textContent, /선택지 3개가 모두 준비/);
  assert.equal(elements.writerFinalPrepare.disabled, true);
});

test('a private candidate from before the worker deployment can queue its saved scenes', async () => {
  const { elements, calls } = fixture({ existingDraft: true });
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalPrepare.disabled, false);
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].readOnly, true);
  for (const name of ['Reviewed', 'Rights', 'Ai']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
  assert.match(elements.writerFinalState.textContent, /AI 선택지 준비가 대기 중/);
});

test('each server review transition needs its own author action and final submission is separate', async () => {
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '첫 기록을 따라간다';
  labels[1].value = '원작 결말을 향한다';
  elements.writerFinalSummaryReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.deepEqual(Array.from(calls.filter(call => call.path.endsWith('/transition')), call => call.body.toState), ['summary_review']);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 1);
  elements.writerFinalProposalReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 2);
  elements.writerFinalContinuityReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 3);
  for (const name of ['Reviewed', 'Rights', 'Ai']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 4);
  assert.equal(calls.some(call => call.path.endsWith('/submit')), false);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
});

test('unapproved or mismatched analysis proposals cannot be silently confirmed', async () => {
  for (const options of [{ profileStatus: 'needs_review' }, { wrongProfile: true }]) {
    const { elements, calls } = fixture(options);
    await elements.writerFinalOpen.fire('click');
    assert.equal(elements.writerFinalPrepare.disabled, true);
    assert.equal(calls.some(call => call.path.endsWith('/transition')), false);
    if (options.profileStatus) assert.match(elements.writerFinalProfileStatus.textContent, /승인되지 않은/);
    else assert.match(elements.writerFinalState.textContent, /현재 원고의 생성 설정/);
  }
});

test('an approved edited setting can be reviewed without a summary field', async () => {
  const { elements } = fixture({ summarylessProfile: true });
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalPrepare.disabled, false);
  assert.match(elements.writerFinalSummary.children[2].children[1].textContent, /작가가 승인한 등장인물 설정/);
});

test('continuity warnings require a visible acknowledgement before final confirmation', async () => {
  const { elements, calls } = fixture({ issues: [{ severity: 'warning', summary: '기존 인물 설정 확인 필요' }] });
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '기록을 가지고 다음 장소로 간다';
  labels[1].value = '원작 결말을 향한다';
  for (const name of ['SummaryReviewed', 'ProposalReviewed', 'ContinuityReviewed', 'Reviewed', 'Rights', 'Ai'])
    elements[`writerFinal${name}`].checked = true;
  for (let index = 0; index < 2; index++) await elements.writerFinalPrepare.fire('click');
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /설정 경고/);
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 2);
  elements.writerFinalWarnings.checked = true;
  await elements.writerFinalPrepare.fire('click');
  await elements.writerFinalPrepare.fire('click');
  const finalTransition = calls.filter(call => call.path.endsWith('/transition')).at(-1);
  assert.equal(finalTransition.body.toState, 'final_confirmation');
  assert.equal(finalTransition.body.decisions.warningAcknowledged, true);
  assert.equal(calls.some(call => call.path.endsWith('/submit')), false);
});

test('reopening an in-progress review resumes its server stage without skipping it', async () => {
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  elements.writerFinalSummaryReviewed.checked = true;
  await elements.writerFinalPrepare.fire('click');
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalStage.textContent, /2\/5/);
  assert.equal(elements.writerFinalProposalReviewed.checked, false);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/transition')).length, 1);
});

test('submitted review resumes after both post-submit reads fail without posting submit twice', async () => {
  const { elements, calls } = fixture({ failPreviewAfterSubmit: true });
  await elements.writerFinalOpen.fire('click');
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /요청을 완료하지 못했습니다/);
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
  assert.match(elements.writerFinalState.textContent, /준비가 대기 중/);
});

test('reopening a submitted-only snapshot shows a continuation action without resubmitting', async () => {
  const { elements, calls } = fixture({ submittedOnly: true });
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /원고 제출이 저장/);
  assert.equal(elements.writerFinalPrepare.disabled, false);
  for (const name of ['Reviewed', 'Rights', 'Ai']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 0);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
});

test('ambiguous consent response is reconciled before retrying materialization', async () => {
  const { elements, calls } = fixture({ failConsentResponseOnce: true });
  await elements.writerFinalOpen.fire('click');
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /다시 열어 이어서/);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
});

test('a failed materialization retries without repeating submitted review or active consent', async () => {
  const { elements, calls } = fixture({ failMaterializeOnce: true });
  await elements.writerFinalOpen.fire('click');
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /다시 열어 이어서/);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /원고 제출이 저장/);
  for (const name of ['Reviewed', 'Rights', 'Ai']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 2);
  assert.match(elements.writerFinalState.textContent, /준비가 대기 중/);
});

test('an ambiguous materialization response resumes the persisted job without duplicate work', async () => {
  const { elements, calls } = fixture({ failReadAfterMaterialize: true });
  await elements.writerFinalOpen.fire('click');
  await advanceToConfirmation(elements);
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /다시 열어 이어서/);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/materialize')).length, 1);
  assert.match(elements.writerFinalState.textContent, /준비가 대기 중/);
});

test('queued work reports unavailable worker and never claims ready from release flag alone', async () => {
  const { elements, setJob, setReady } = fixture({ existingDraft: true, workerAvailable: false });
  setJob('queued');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /운영자 설정이 필요/);
  setReady(true);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.doesNotMatch(elements.writerFinalState.textContent, /선택지 3개가 모두 준비/);
  assert.doesNotMatch(elements.writerFinalStage.textContent, /준비 완료/);
  setJob('completed', 2);
  setReady(false);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /최종 준비 상태가 확인되지/);
  setReady(true);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.match(elements.writerFinalState.textContent, /선택지 3개가 모두 준비/);
});

test('a changed approved profile stops review writes until the author reloads', async () => {
  const { elements, calls, changeProfile } = fixture();
  await elements.writerFinalOpen.fire('click');
  elements.writerFinalSummaryReviewed.checked = true;
  changeProfile();
  await elements.writerFinalPrepare.fire('click');
  assert.match(elements.writerFinalState.textContent, /검토 내용이 변경/);
  assert.equal(calls.some(call => call.path.endsWith('/reviews') || call.path.endsWith('/transition')), false);
});

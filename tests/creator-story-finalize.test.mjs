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
  querySelectorAll(selector) {
    const walk = node => [node, ...node.children.flatMap(walk)];
    return this.children.flatMap(walk).filter(node => selector === 'input[data-part-key]' && node.dataset.partKey);
  }
}

function fixture({ failFirstChoice = false, issues = [] } = {}) {
  const ids = ['writerFinalEntry', 'writerFinalModal', 'writerFinalParts', 'writerFinalIssues', 'writerFinalWarningsLabel', 'writerFinalState',
    'writerFinalEntryState', 'writerFinalPrepare', 'writerFinalOpen', 'writerFinalClose',
    'writerFinalCancel', 'writerFinalReviewed', 'writerFinalRights', 'writerFinalAi', 'writerFinalWarnings'];
  const elements = Object.fromEntries(ids.map(name => [name, new Element(name)]));
  const calls = [];
  let reviewState = 'analysis_ready'; let revision = 1; let ready = false;
  let submitted = false; let consented = false; let materialized = false; let failed = false;
  const scenes = [0, 1].map(index => ({ partKey: `p${index + 1}`, sceneId: `${index + 5}`.repeat(36).slice(0, 36),
    choiceCount: 1, originalLabel: `원래 길 ${index + 1}` }));
  const preview = () => ({ manuscriptVersionId: manuscriptId, manuscriptHash: 'a'.repeat(64),
    analysisJobId: analysisId, issues, review: submitted ? { reviewId: id, state: 'submitted', revision } : null,
    consent: consented ? { active: true, revision: 1 } : null,
    parts: [{ partKey: 'p1', title: '처음', endingExcerpt: '갈림길', nextPartTitle: '다음' },
      { partKey: 'p2', title: '다음', endingExcerpt: '결말', nextPartTitle: null }],
    releaseId: materialized ? releaseId : null, scenes: materialized ? scenes : [], ready });
  const fetch = async (path, options = {}) => {
    calls.push({ path, ...options });
    let result;
    if (path.endsWith(`/linear-draft/${manuscriptId}`)) result = preview();
    else if (path.endsWith('/reviews')) result = { reviewId: id, state: reviewState, revision };
    else if (path.endsWith('/transition')) {
      reviewState = options.body.toState; revision++;
      result = { reviewId: id, state: reviewState, revision };
    } else if (path.endsWith('/submit')) { submitted = true; result = { status: 'submitted' }; }
    else if (path.endsWith('/style-consent')) { consented = true; result = { status: 'active' }; }
    else if (path.endsWith('/materialize')) {
      materialized = true;
      options.body.originalRoutes.forEach((route, index) => { scenes[index].originalLabel = route.label; });
      result = { releaseId, scenes };
    }
    else if (path.endsWith('/prepare-choices')) {
      if (failFirstChoice && !failed) {
        failed = true;
        return { ok: false, json: async () => ({ code: 'STUDIO_CHOICES_GENERATION_FAILED' }) };
      }
      scenes.find(scene => path.includes(scene.sceneId)).choiceCount = 3;
      result = { choiceCount: 3 };
    }
    else if (path.endsWith('/finish')) { ready = true; result = { ready: true }; }
    else throw new Error(`unexpected ${path}`);
    return { ok: true, json: async () => result };
  };
  const document = { getElementById: name => elements[name], createElement: () => new Element(), addEventListener() {} };
  const window = { LuminaCreatorStudioApi: { fetch, isCurrent: () => true },
    LuminaCreatorAnalysis: { completed: () => ({ manuscriptVersionId: manuscriptId, workId: id,
      analysisJobId: analysisId, identity: { ownerId: id } }) }, addEventListener() {} };
  vm.runInNewContext(script, { window, document, setInterval: () => 1, console });
  return { elements, calls, scenes };
}

test('Studio final review prepares exactly two AI alternatives only after explicit author checks', async () => {
  assert.match(html, /creator-story-finalize\.js/);
  const { elements, calls } = fixture();
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]').length, 2);
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
  const inputs = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  inputs[0].value = '기록을 가지고 다음 장소로 간다';
  inputs[1].value = '원래 결말을 받아들인다';
  for (const name of ['Reviewed', 'Rights', 'Ai', 'Warnings']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  const materialize = calls.find(call => call.path.endsWith('/materialize'));
  assert.deepEqual(Array.from(materialize.body.originalRoutes, row => row.label),
    ['기록을 가지고 다음 장소로 간다', '원래 결말을 받아들인다']);
  assert.equal(materialize.body.originalRoutesReviewed, true);
  const consent = calls.find(call => call.path.endsWith('/style-consent'));
  assert.equal(consent.body.rightsConfirmed, true);
  assert.equal(consent.body.aiBranchAllowed, true);
  assert.equal(consent.body.imageTransformationAllowed, false);
  assert.equal(calls.filter(call => call.path.endsWith('/prepare-choices')).length, 2);
  assert.ok(calls.findIndex(call => call.path.endsWith('/submit')) < calls.findIndex(call => call.path.endsWith('/materialize')));
  assert.ok(calls.findIndex(call => call.path.endsWith('/materialize')) < calls.findIndex(call => call.path.endsWith('/finish')));
  assert.match(elements.writerFinalState.textContent, /선택지 3개/);
});

test('failed AI generation stays private and a second reviewed attempt resumes without resubmitting consent', async () => {
  const { elements, calls, scenes } = fixture({ failFirstChoice: true });
  await elements.writerFinalOpen.fire('click');
  const labels = elements.writerFinalParts.querySelectorAll('input[data-part-key]');
  labels[0].value = '첫 기록을 따라간다';
  labels[1].value = '원작 결말을 향한다';
  for (const name of ['Reviewed', 'Rights', 'Ai', 'Warnings']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.some(call => call.path.endsWith('/finish')), false);
  assert.match(elements.writerFinalState.textContent, /STUDIO_CHOICES_GENERATION_FAILED/);
  assert.deepEqual(scenes.map(scene => scene.choiceCount), [1, 1]);
  elements.writerFinalClose.fire('click');
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalParts.querySelectorAll('input[data-part-key]')[0].value, '첫 기록을 따라간다');
  for (const name of ['Reviewed', 'Rights', 'Ai', 'Warnings']) elements[`writerFinal${name}`].checked = true;
  await elements.writerFinalPrepare.fire('click');
  assert.equal(calls.filter(call => call.path.endsWith('/submit')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/style-consent')).length, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/finish')).length, 1);
  assert.deepEqual(scenes.map(scene => scene.choiceCount), [3, 3]);
});

test('unresolved critical continuity finding blocks the author approval button', async () => {
  const { elements, calls } = fixture({ issues: [{ severity: 'critical', summary: '앞 파트의 설정과 충돌' }] });
  await elements.writerFinalOpen.fire('click');
  assert.equal(elements.writerFinalPrepare.disabled, true);
  assert.match(elements.writerFinalState.textContent, /심각한 설정 충돌/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

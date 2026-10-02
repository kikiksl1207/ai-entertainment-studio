import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, makeGenerationResponse, makeVisualGenerationResponse, ids, script } from './creator-analysis-review.test-support.mjs';

async function review(initial = makeVisualGenerationResponse()) {
  const screen = createHarness({ receipt: false, generationProfile: initial, realApi: true });
  await screen.elements.writerAnalysisRestore.fire(); await screen.flush();
  if (initial.profile.status === 'approved') await screen.elements.writerGenerationReviewOpen.fire();
  return screen;
}
const section = (screen, key) => screen.elements.writerGenerationSections.querySelector(`[data-key="${key}"]`);
const field = (article, key) => article.querySelector(`[data-visual-field="${key}"]`);
const rows = article => article.querySelectorAll('.writer-generation-visual-character');
const patches = screen => screen.calls.filter(call => call.options.method === 'PATCH');
const savedSections = screen => JSON.parse(patches(screen).at(-1).options.body).settings.sections;
async function edit(input, value) { input.value = value; await input.fire('input'); }
async function save(screen) { await screen.elements.writerGenerationSave.fire(); await screen.flush(); }
async function decide(article, index) { await article.querySelectorAll('.writer-generation-decisions button')[index].fire(); }

test('visual review: accepted structured fields send an object through the real API bridge with existing values and flags', async () => {
  const initial = makeVisualGenerationResponse();
  initial.profile.draftSettings.sections[6].value.fixedWorldRule = true;
  initial.profile.draftSettings.sections[7].value.identityBoundary = 'source_only';
  const screen = await review(initial);
  await decide(section(screen, 'visual_direction'), 0); await decide(section(screen, 'visual_cast'), 0);
  await save(screen);
  assert.equal(patches(screen).length, 1);
  const call = patches(screen)[0], payload = JSON.parse(call.options.body);
  assert.equal(call.path, `/api/v1/me/creator-studio/stories/${ids.work}/generation-profile`);
  assert.equal(typeof payload, 'object'); assert.equal(typeof payload.settings, 'object');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.equal(call.options.headers.Authorization, 'Bearer local-fixture-token');
  for (const index of [6, 7]) {
    assert.equal(payload.settings.sections[index].decision, 'accepted');
    assert.deepEqual(payload.settings.sections[index].value, {
      ...initial.profile.draftSettings.sections[index].value, visualReviewVersion: 'story-visual-review-v1'
    });
    assert.deepEqual(payload.settings.sections[index].evidence, initial.profile.draftSettings.sections[index].evidence);
  }
  assert.equal(screen.calls.some(call => call.options.method === 'POST'), false);
});

test('visual review: field and cast edits mark edited, preserve interpretations and safely retain unsafe text', async () => {
  const unsafe = '<script>window.bad = true</script><img src=x onerror=alert(1)> & "quote"';
  const screen = await review();
  const world = section(screen, 'visual_direction'), cast = section(screen, 'visual_cast');
  for (const key of ['era', 'artStyle', 'palette']) await edit(field(world, key), unsafe);
  await edit(field(world, 'prohibited'), 'No neon\r\nNo logos\n\n');
  await edit(field(cast, 'name'), unsafe); await edit(field(cast, 'appearance'), unsafe);
  await cast.querySelector('.writer-generation-visual-cast').children.at(-1).fire();
  await edit(field(rows(cast)[1], 'name'), 'New character'); await edit(field(rows(cast)[1], 'appearance'), 'Red scarf');
  await save(screen);
  const saved = savedSections(screen);
  assert.equal(saved[6].decision, 'edited'); assert.equal(saved[7].decision, 'edited');
  assert.deepEqual(saved[6].value.visualBible, { era: unsafe, artStyle: unsafe, palette: unsafe, prohibited: ['No neon', 'No logos'] });
  assert.deepEqual(saved[7].value.characters, [{ name: unsafe, appearance: unsafe }, { name: 'New character', appearance: 'Red scarf' }]);
  assert.deepEqual(saved[6].value.observations, ['Previous AI interpretation.']);
  assert.deepEqual(saved[7].value.observations, ['Previous AI interpretation.']);
  assert.equal(field(section(screen, 'visual_cast'), 'name').value, unsafe);
  assert.equal(screen.elements.writerGenerationSections.querySelectorAll('script').length, 0);
  assert.doesNotMatch(script, /\.innerHTML\s*=|JSON\.stringify\(section/);
});

test('visual review: removed world and cast retain structured data while recording exclusion', async () => {
  const initial = makeVisualGenerationResponse(), screen = await review(initial);
  for (const key of ['visual_direction', 'visual_cast']) await decide(section(screen, key), 2);
  await save(screen);
  for (const index of [6, 7]) {
    const saved = savedSections(screen)[index];
    assert.equal(saved.decision, 'removed');
    assert.deepEqual(saved.value, { ...initial.profile.draftSettings.sections[index].value, visualReviewVersion: 'story-visual-review-v1' });
  }
});

test('visual review: empty cast is structured, last-row removal saves an empty array, and additions stop at 16', async () => {
  const screen = await review(makeVisualGenerationResponse({ characters: [] }));
  let cast = section(screen, 'visual_cast');
  assert.match(cast.textContent, /No characters added/);
  await save(screen);
  assert.deepEqual(savedSections(screen)[7].value.characters, []);
  assert.equal(savedSections(screen)[7].value.visualReviewVersion, 'story-visual-review-v1');
  cast = section(screen, 'visual_cast');
  const add = cast.querySelector('.writer-generation-visual-cast').children.at(-1);
  for (let i = 0; i < 16; i++) await add.fire();
  assert.equal(rows(cast).length, 16); assert.equal(add.disabled, true);
  await add.listeners.click[0](); assert.equal(rows(cast).length, 16);
  for (const row of rows(cast)) await row.querySelector('button').fire();
  assert.equal(rows(cast).length, 0); assert.equal(add.disabled, false);
  await save(screen);
  assert.equal(savedSections(screen)[7].decision, 'edited');
  assert.deepEqual(savedSections(screen)[7].value.characters, []);
});

test('visual review: over-limit seeded cast is never sliced and must be corrected before transport', async () => {
  const characters = Array.from({ length: 17 }, (_, i) => ({ name: `Character ${i}`, appearance: 'Source appearance' }));
  const screen = await review(makeVisualGenerationResponse({ characters }));
  const cast = section(screen, 'visual_cast');
  assert.equal(rows(cast).length, 17); assert.equal(field(rows(cast)[16], 'name').value, 'Character 16');
  assert.match(cast.textContent, /cast limit is 16/);
  await save(screen); assert.equal(patches(screen).length, 0);
  assert.match(screen.elements.writerGenerationStatus.textContent, /entries have been retained/);
  await rows(cast)[0].querySelector('button').fire(); await save(screen);
  assert.deepEqual(savedSections(screen)[7].value.characters, characters.slice(1));
});

test('visual review: incomplete or duplicate trimmed cast rows block saves and approval even when removed', async () => {
  const screen = await review(), cast = section(screen, 'visual_cast');
  await cast.querySelector('.writer-generation-visual-cast').children.at(-1).fire();
  const added = rows(cast)[1], name = field(added, 'name'), appearance = field(added, 'appearance');
  const errors = added.querySelectorAll('.writer-generation-visual-error');
  assert.equal(errors[0].textContent, 'Enter a character name.'); assert.equal(errors[0].hidden, false);
  assert.equal(errors[1].textContent, "Enter this character's appearance.");
  assert.equal(name.attributes['aria-describedby'], errors[0].id);
  await decide(cast, 2); await edit(name, '  '); await edit(appearance, '\t '); await decide(cast, 2);
  await save(screen); await screen.elements.writerGenerationApprove.fire(); await screen.flush();
  assert.equal(patches(screen).length, 0); assert.equal(screen.calls.some(call => call.options.method === 'POST'), false);
  assert.equal(name.value, '  '); assert.equal(appearance.value, '\t ');
  await edit(name, ' Mira '); await edit(appearance, ' Red coat ');
  assert.equal(field(rows(cast)[0], 'name').attributes['aria-invalid'], 'true');
  assert.equal(errors[0].textContent, 'Each character needs a unique name.');
  await save(screen); assert.equal(patches(screen).length, 0);
  await edit(name, ' New author character ');
  assert.equal(errors[0].hidden, true); assert.equal(errors[1].hidden, true);
  assert.equal(field(rows(cast)[0], 'name').attributes['aria-invalid'], 'false');
  await decide(cast, 2); await save(screen);
  assert.equal(savedSections(screen)[7].decision, 'removed');
  assert.deepEqual(savedSections(screen)[7].value.characters, [
    { name: 'Mira', appearance: 'Silver hair and a green coat.' }, { name: 'New author character', appearance: 'Red coat' }
  ]);
});

test('visual review: required and duplicate inline errors are localized and clear after correction in all five languages', async () => {
  for (const [locale, requiredName, requiredAppearance, unique] of [
    ['ko-KR', '등장인물 이름을 입력해 주세요.', '등장인물 외형을 입력해 주세요.', '등장인물마다 다른 이름을 입력해 주세요.'],
    ['en-US', 'Enter a character name.', "Enter this character's appearance.", 'Each character needs a unique name.'],
    ['ja-JP', '登場人物の名前を入力してください。', '登場人物の外見を入力してください。', '登場人物ごとに異なる名前を入力してください。'],
    ['zh-CN', '请输入人物姓名。', '请输入人物外观。', '每位人物的姓名必须不同。'],
    ['zh-Hant', '請輸入人物姓名。', '請輸入人物外觀。', '每位人物的姓名必須不同。']
  ]) {
    const screen = await review(); screen.setLocale(locale); await screen.flush();
    const cast = section(screen, 'visual_cast'); await cast.querySelector('.writer-generation-visual-cast').children.at(-1).fire();
    const row = rows(cast)[1], errors = row.querySelectorAll('.writer-generation-visual-error');
    assert.equal(errors[0].textContent, requiredName); assert.equal(errors[1].textContent, requiredAppearance);
    await edit(field(row, 'name'), ' Mira '); assert.equal(errors[0].textContent, unique);
    await edit(field(row, 'name'), 'Other'); await edit(field(row, 'appearance'), 'Other appearance');
    assert.equal(errors[0].hidden, true); assert.equal(errors[1].hidden, true);
  }
});

test('visual review: every text and prohibited-line limit blocks invalid input without dropping it', async () => {
  for (const [key, value] of [
    ['era', 'x'.repeat(801)], ['artStyle', 'x'.repeat(801)], ['palette', 'x'.repeat(801)],
    ['prohibited', Array.from({ length: 25 }, () => 'No logos').join('\n')], ['prohibited', 'x'.repeat(241)],
    ['name', 'x'.repeat(121)], ['appearance', 'x'.repeat(601)]
  ]) {
    const screen = await review(), article = section(screen, ['name', 'appearance'].includes(key) ? 'visual_cast' : 'visual_direction');
    const input = field(article, key); await edit(input, value); await save(screen);
    assert.equal(patches(screen).length, 0, key); assert.equal(input.value, value);
    assert.equal(input.attributes['aria-invalid'], 'true'); assert.ok(input.validationMessage);
    await screen.elements.writerGenerationClose.fire(); await screen.elements.writerGenerationReviewOpen.fire();
    assert.equal(field(section(screen, article.dataset.key), key).value, value);
  }
});

test('visual review: exact field limits and 24 lines are accepted without truncation', async () => {
  const bible = { era: 'e'.repeat(800), artStyle: 'a'.repeat(800), palette: 'p'.repeat(800), prohibited: Array.from({ length: 24 }, () => 'x'.repeat(240)) };
  const characters = Array.from({ length: 16 }, (_, i) => ({ name: String(i).padStart(2, '0') + 'n'.repeat(118), appearance: 'a'.repeat(600) }));
  const screen = await review(makeVisualGenerationResponse({ visualBible: bible, characters }));
  await save(screen);
  assert.deepEqual(savedSections(screen)[6].value.visualBible, bible);
  assert.deepEqual(savedSections(screen)[7].value.characters, characters);
});

test('visual review: summary changes still clear observations/categories, and missing structured values stay legacy', async () => {
  const initial = makeVisualGenerationResponse(); initial.profile.draftSettings.sections[6].value.categories = ['Old category'];
  const screen = await review(initial);
  await edit(section(screen, 'visual_direction').querySelector('.writer-generation-summary'), 'Corrected world summary');
  await save(screen);
  assert.deepEqual(savedSections(screen)[6].value.observations, []);
  assert.deepEqual(savedSections(screen)[6].value.categories, []);
  assert.deepEqual(savedSections(screen)[6].value.visualBible, initial.profile.draftSettings.sections[6].value.visualBible);
  const legacy = await review(makeGenerationResponse()); await save(legacy);
  for (const index of [6, 7]) assert.equal(Object.hasOwn(savedSections(legacy)[index].value, 'visualReviewVersion'), false);
  assert.equal(legacy.elements.writerGenerationSections.querySelectorAll('.writer-generation-visual-field').length, 0);
});

test('visual review: approved settings, not the draft, render read-only and cannot save or add/remove', async () => {
  const initial = makeVisualGenerationResponse();
  initial.profile.approvedSettings = structuredClone(initial.profile.draftSettings);
  initial.profile.approvedSettings.sections[6].value.visualBible.era = 'Approved era'; initial.profile.status = 'approved';
  const screen = await review(initial);
  assert.equal(field(section(screen, 'visual_direction'), 'era').value, 'Approved era');
  for (const input of screen.elements.writerGenerationSections.querySelectorAll('textarea')) assert.equal(input.disabled, true);
  for (const button of screen.elements.writerGenerationSections.querySelectorAll('button')) assert.equal(button.disabled, true);
  await screen.elements.writerGenerationSave.fire(); await screen.elements.writerGenerationApprove.fire();
  assert.equal(patches(screen).length, 0);
});

test('visual review: author approval sends structured JSON once and locks all controls', async () => {
  const screen = await review();
  for (const article of screen.elements.writerGenerationSections.children) await decide(article, 0);
  await edit(field(section(screen, 'visual_direction'), 'era'), 'Author era');
  await screen.elements.writerGenerationApprove.fire(); await screen.flush();
  assert.equal(patches(screen).length, 1);
  const approvals = screen.calls.filter(call => call.path.endsWith('/approve'));
  assert.equal(approvals.length, 1); assert.deepEqual(JSON.parse(approvals[0].options.body), { expectedDraftFingerprint: 'b'.repeat(64) });
  assert.equal(savedSections(screen)[6].value.visualBible.era, 'Author era');
  for (const input of screen.elements.writerGenerationSections.querySelectorAll('textarea')) assert.equal(input.disabled, true);
});

test('visual review: five languages label world/cast controls and preserve edits across locale changes', async () => {
  for (const [locale, labels, add, remove, empty] of [
    ['ko-KR', ['시대와 배경', '그림 스타일', '색상 기준', '피해야 할 시각 요소', '이름', '외형'], '등장인물 추가', '등장인물 삭제', '등록된 등장인물이 없습니다.'],
    ['en-US', ['Era and setting', 'Art style', 'Color palette', 'Prohibited visual elements', 'Name', 'Appearance'], 'Add character', 'Remove character', 'No characters added.'],
    ['ja-JP', ['時代と舞台', '画風', '配色', '避ける視覚要素', '名前', '外見'], '登場人物を追加', '登場人物を削除', '登場人物は登録されていません。'],
    ['zh-CN', ['时代与背景', '画风', '配色', '禁止的视觉元素', '姓名', '外观'], '添加人物', '删除人物', '尚未添加人物。'],
    ['zh-Hant', ['時代與背景', '畫風', '配色', '禁止的視覺元素', '姓名', '外觀'], '新增人物', '刪除人物', '尚未新增人物。']
  ]) {
    const screen = await review();
    await edit(field(section(screen, 'visual_direction'), 'era'), 'Retained local era');
    await edit(field(section(screen, 'visual_cast'), 'appearance'), 'Retained local appearance');
    screen.setLocale(locale); await screen.flush();
    const text = screen.elements.writerGenerationSections.textContent;
    for (const label of labels) assert.ok(text.includes(label), `${locale}: ${label}`);
    const cast = section(screen, 'visual_cast');
    assert.equal(cast.querySelector('.writer-generation-visual-cast').children.at(-1).attributes['aria-label'], add);
    assert.equal(rows(cast)[0].querySelector('button').title, remove);
    assert.equal(field(section(screen, 'visual_direction'), 'era').value, 'Retained local era');
    assert.equal(field(cast, 'appearance').value, 'Retained local appearance');
    await rows(cast)[0].querySelector('button').fire(); assert.ok(cast.textContent.includes(empty));
  }
});

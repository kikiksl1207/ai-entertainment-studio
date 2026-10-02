import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { verifyStoryStageSource } from '../server/scripts/verify-story-stage-no-raw-key.mjs';

const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const controls = runInNewContext(`${source.slice(source.indexOf('const STORY_CONTROL_COPY ='),
  source.indexOf('const state =', source.indexOf('const STORY_CONTROL_COPY =')))}; STORY_CONTROL_COPY`);
for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) {
  test(`reader source: reset version error is localized and never exposes diagnostics (${locale})`, () => {
    const errorCopy = runInNewContext(`${source.slice(source.indexOf('function errorCode('), source.indexOf('function blockScene('))}; errorCopy`, {
      tr: key => key, controlTr: key => controls[locale][key],
    });
    const privateMessage = 'INTERNAL_DIAGNOSTIC_DO_NOT_RENDER';
    const changed = { status: 409, body: { error: { code: 'STORY_RESET_VERSION_MISMATCH', message: privateMessage } } };
    assert.equal(errorCopy(changed, 'resetFailed'), controls[locale].resetVersionChanged);
    assert.notEqual(errorCopy(changed, 'resetFailed'), controls[locale].resetFailed);
    assert.equal(errorCopy({ ...changed, status: 401 }), 'loginRequired');
    assert.equal(errorCopy({ ...changed, status: 403 }), controls[locale].accessRequired);
    assert.equal(errorCopy({ status: 500, body: { error: { message: privateMessage } } }, 'resetFailed'), controls[locale].resetFailed);
    assert(!errorCopy(changed).includes(privateMessage));
  });
}
const helpers = source.slice(source.indexOf('function readerScope('), source.indexOf('function rememberReadingScroll('));
function reader(positions, position = 0, status = 'active') {
  const scene = { id: 'scene', beats: positions.map((position) => ({ position, content: { value: `full.text.${position}\n\nSecond paragraph.` } })) };
  const state = { sessionId: 'progress', workId: 'work', scene, progress: { scene, currentBeatPosition: position, status, storyVersion: 1 } };
  const api = runInNewContext(`${helpers}; ({ groupReaderBeats, readableBeats, readerScope })`, { state, readerIdentity: () => 'owner', textValue: (value) => value?.en || '' });
  return { state, ...api };
}

test('reader source: a signed request recovers an expired access token through shared auth', async () => {
  const requestSource = source.slice(source.indexOf('async function request('), source.indexOf('function renderLoading('));
  const calls = [];
  const sharedResult = { currentBeatPosition: 2 };
  const request = runInNewContext(`${requestSource}; request`, {
    API_ORIGIN: 'https://api.example.test',
    window: {
      getAuth: () => ({ accessToken: 'expired' }),
      apiFetch: async (path, options) => {
        calls.push({ path, options });
        return sharedResult;
      },
    },
    fetch: async () => ({ status: 401, ok: false }),
  });
  const signal = new AbortController().signal;
  const result = await request('/api/v1/me/story-progress/progress/beat', {
    method: 'POST', auth: true, signal, body: { position: 2 },
  });
  assert.equal(result, sharedResult);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/me/story-progress/progress/beat');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.position, 2);
  assert.equal(calls[0].options.signal, undefined);
  assert.equal(calls[0].options.throwOnError, true);
});

test('reader source: canonical/generated persisted positions and full text are not array-indexed or truncated', () => {
  const canonical = reader([3, 1, 2]);
  assert.equal(canonical.readableBeats().beats[0].text, 'full.text.1\n\nSecond paragraph.');
  assert.equal(canonical.readableBeats().index, 0);
  canonical.state.progress.currentBeatPosition = 2;
  assert.equal(canonical.readableBeats().index, 1);
  assert.equal(reader([0, 1, 2], 1).readableBeats().index, 1);
  assert.equal(reader([1, 2], 9).readableBeats(), null);
  assert.equal(reader([1, 1]).readableBeats(), null);
});

test('reader source: six short beats become three full-page scenes without losing text or positions', () => {
  const runtime = reader([6, 1, 4, 2, 5, 3], 3);
  const grouped = runtime.readableBeats();
  assert.equal(grouped.beats.length, 3);
  assert.deepEqual(Array.from(grouped.beats[0].positions), [1, 2]);
  assert.deepEqual(Array.from(grouped.beats[1].positions), [3, 4]);
  assert.deepEqual(Array.from(grouped.beats[2].positions), [5, 6]);
  assert.equal(grouped.index, 1);
  assert.equal(grouped.beats[1].position, 4);
  assert.equal(grouped.beats[1].text, 'full.text.3\n\nSecond paragraph.\n\nfull.text.4\n\nSecond paragraph.');
  const visualGroups = runtime.groupReaderBeats([
    { position: 1, text: 'one', visualContext: { id: 'pending', generationAvailable: true } },
    { position: 2, text: 'two', visualContext: { id: 'ready', assetReadiness: 'ready' } },
    { position: 3, text: 'three', visualContext: { id: 'third' } },
    { position: 4, text: 'four', visualContext: { id: 'fourth' } },
  ]);
  assert.equal(visualGroups.length, 2);
  assert.equal(visualGroups[0].visualContext.id, 'ready');
  assert.equal(visualGroups[1].visualContext.id, 'third');
});

test('reader source: generated prose turns on sentence boundaries and hides a short unfinished tail', () => {
  const runtime = reader(Array.from({ length: 10 }, (_, index) => index), 0);
  runtime.state.scene.deliveryState = 'ready';
  runtime.state.scene.beats = Array.from({ length: 10 }, (_, index) => ({
    position: index,
    content: { value: index === 3 ? '그는 재빨' : index === 4 ? '리 제지했다.' :
      index === 9 ? '“누가 왔죠?” 그는' : `장면 ${index}이 끝났다.` },
  }));
  const grouped = runtime.readableBeats();
  assert.equal(grouped.beats.length, 3);
  assert.ok(grouped.beats.some((page) => page.text.includes('재빨리 제지했다.')));
  assert.equal(grouped.beats.at(-1).text.endsWith('“누가 왔죠?”'), true);
  assert.ok(grouped.beats.every((page) => /[.!?。！？…][”"'’」』)]*$/.test(page.text)));
});

test('reader source: a long sentence crossing the planned page cut never makes an empty page', () => {
  const runtime = reader([1, 2, 3, 4, 5, 6], 3);
  runtime.state.scene.isGenerated = true;
  runtime.state.scene.beats = [
    '하나의 ', '문장이 ', '계속 ', '이어진다.', '다음 문장이다.', '마지막 문장이다.',
  ].map((text, index) => ({ position: index + 1, content: { value: text } }));
  const grouped = runtime.readableBeats();
  assert.equal(grouped.beats.length, 2);
  assert.deepEqual(Array.from(grouped.beats, (page) => Array.from(page.positions)), [[1, 2, 3, 4], [5, 6]]);
  assert.equal(grouped.beats[0].text, '하나의 문장이 계속 이어진다.');
  assert.equal(grouped.index, 0);
  assert.ok(grouped.beats.every((page) => page.positions.length && page.segments.length));
  assert.deepEqual(Array.from(grouped.beats).flatMap((page) => Array.from(page.positions)), [1, 2, 3, 4, 5, 6]);
});

test('reader source: generated prose without an earlier sentence boundary stays on one page', () => {
  const runtime = reader([1, 2, 3, 4, 5, 6]);
  const grouped = runtime.groupReaderBeats([
    { position: 1, text: '계속 ' }, { position: 2, text: '이어지는 ' },
    { position: 3, text: '긴 ' }, { position: 4, text: '문장을 ' },
    { position: 5, text: '끝까지 ' }, { position: 6, text: '읽었다.' },
  ], true);
  assert.equal(grouped.length, 1);
  assert.deepEqual(Array.from(grouped[0].positions), [1, 2, 3, 4, 5, 6]);
});

test('reader source: previously stored escaped line breaks render as paragraphs', () => {
  const runtime = reader([0, 1, 2, 3], 0);
  runtime.state.scene.isGenerated = true;
  runtime.state.scene.beats[0].content.value = '첫 문장이다.\\r\\n\\r\\n둘째 문장이다.';
  const first = runtime.readableBeats().beats[0];
  assert.ok(first.text.includes('첫 문장이다.\n\n둘째 문장이다.'));
  assert.doesNotMatch(first.text, /\\r\\n/);
  assert.match(source, /segments\.flatMap\(\(segment\) => String\(segment\)\.split/);
});

test('reader source: completed reading cursor stays local and work/release/scene scoped', () => {
  const local = reader([1, 2, 3], 0, 'completed');
  local.state.completedBeat = { scope: local.readerScope(), position: 3 };
  assert.equal(local.readableBeats().index, 2);
  assert.equal(local.state.progress.currentBeatPosition, 0);
  local.state.progress.storyVersion = 2;
  assert.equal(local.readableBeats().index, 0);
  const turn = source.slice(source.indexOf('async function turnBeat('), source.indexOf('function aiRequestOpen('));
  assert.ok(turn.indexOf('state.progress.status === "completed"') < turn.indexOf('await request('));
  assert.match(turn, /body: \{ position: target.position, expectedRevision: revision \}/);
  assert.doesNotMatch(turn, /revision \+ 1|idempotencyKey|\/choices\/|\/purchase|\/reset/);
  assert.match(turn, /await loadScene\(\{ restorePending: false \}\)/);
  assert.match(turn, /identity === readerIdentity\(\).*locale === state.locale/);
});

test('reader source: progress status controls endings and choices wait for the last supplied beat', () => {
  assert.match(source, /const isEnding = state.progress\?\.status === "completed";/);
  assert.match(source, /fixedChoices.length && !isEnding && lastBeat/);
  assert.match(source, /reading.index !== reading.beats.length - 1/);
  assert.doesNotMatch(source, /readBeatKeys|beatRead/);
  assert.match(source, /!scene && isEnding \? `<div class="story-completed"/);
  assert.match(source, /rememberReadingScroll\(\);\s*renderLoading\(tr\("sceneLoading"\)\)/);
  assert.match(source, /state.readingScroll\?\.key === reading.key \? state.readingScroll.top : 0/);
  assert.match(css, /\.story-player-stage \{[^}]*aspect-ratio: 16 \/ 9;/);
  assert.match(css, /\.story-player-copy \{[^}]*overflow: visible;/);
  assert.match(css, /\.story-beat-navigation \{[^}]*margin-bottom: -44px;/);
  assert.match(css, /\.story-reader-shell\[data-visual-layout="portrait"\] \.story-beat-navigation \{[^}]*grid-column: 1 \/ -1;/);
  assert.match(source, /function focusBeatStart\(\)[\s\S]*scrollIntoView\(\{ block: "start", behavior: "instant" \}\)/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /\.story-player-copy \{[^}]*font-family: system-ui,/);
  assert.match(css, /\.story-player-copy p \{[^}]*max-width: 34em;[^}]*font-size: 18px;[^}]*font-weight: 400;[^}]*line-height: 1.78;/);
  assert.match(css, /\.story-choice-list button \{[^}]*font-family: system-ui,[^}]*font-size: 15px;[^}]*font-weight: 500;/);
  assert.match(source, /story-reader-shell[\s\S]*story-player-stage[\s\S]*story-player-copy/);
  assert.match(source, /story-reader-shell-text-only/);
  assert.match(css, /\.story-reader-shell-text-only \{[^}]*grid-template-columns: minmax\(0, 760px\);[^}]*justify-content: center;/);
  assert.match(css, /\.story-reader-progress \{[^}]*position: absolute;[^}]*top: 14px;[^}]*right: 22px;/);
  assert.match(css, /\.story-player-copy \{[^}]*grid-row: 1;/);
  assert.match(css, /\.story-reader-shell:hover \.story-beat-navigation button,[\s\S]*\.story-reader-shell:focus-within \.story-beat-navigation button/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.story-beat-navigation button \{[\s\S]*opacity: 1;/);
  assert.match(source, /\["ArrowLeft", "ArrowRight"\][\s\S]*button\.click\(\)/);
  assert.match(source, /const unavailable = choice\.available === false/);
  assert.match(source, /choice\.available !== false/);
  assert.match(source, /story-choice-unavailable/);
});

test('reader source: five locales have safe names/status copy, including missing-key behavior', () => {
  const result = verifyStoryStageSource(source);
  assert.equal(result.fiveLocaleReader, true);
  assert.equal(result.safeReaderValues, true);
  assert.equal(result.rawKeyFallbackBlocked, true);
  assert.equal(verifyStoryStageSource(source.replace('Previous scene', 'story.reader.previous')).safeReaderValues, false);
  assert.equal(verifyStoryStageSource(source.replace('READER_COPY.en[key] || ""', 'READER_COPY.en[key] || key')).rawKeyFallbackBlocked, false);
});

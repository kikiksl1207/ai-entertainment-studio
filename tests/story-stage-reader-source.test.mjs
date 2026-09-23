import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { verifyStoryStageSource } from '../server/scripts/verify-story-stage-no-raw-key.mjs';

const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function readerScope('), source.indexOf('function rememberReadingScroll('));
function reader(positions, position = 0, status = 'active') {
  const scene = { id: 'scene', beats: positions.map((position) => ({ position, content: { value: `full.text.${position}\n\nSecond paragraph.` } })) };
  const state = { sessionId: 'progress', workId: 'work', scene, progress: { scene, currentBeatPosition: position, status, storyVersion: 1 } };
  const api = runInNewContext(`${helpers}; ({ groupReaderBeats, readableBeats, readerScope })`, { state, readerIdentity: () => 'owner', textValue: (value) => value?.en || '' });
  return { state, ...api };
}

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

test('reader source: six short beats become three scrollable scenes without losing text or positions', () => {
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
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /white-space: pre-wrap/);
  assert.match(css, /\.story-player-copy p \{[^}]*font-size: 17px;[^}]*font-weight: 400;[^}]*line-height: 1.82;/);
  assert.match(source, /story-reader-shell[\s\S]*story-player-stage[\s\S]*story-player-copy/);
  assert.match(source, /story-reader-shell-text-only/);
  assert.match(css, /\.story-reader-shell-text-only \{[^}]*grid-template-columns: minmax\(0, 760px\);[^}]*justify-content: center;/);
  assert.match(css, /\.story-reader-progress \{[^}]*position: absolute;[^}]*top: 14px;[^}]*right: 22px;/);
  assert.match(css, /\.story-player-copy \{[^}]*grid-row: 1;/);
  assert.match(css, /\.story-reader-shell:hover \.story-beat-navigation button,[\s\S]*\.story-reader-shell:focus-within \.story-beat-navigation button/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.story-beat-navigation button \{[\s\S]*opacity: 1;/);
  assert.match(source, /\["ArrowLeft", "ArrowRight"\][\s\S]*button\.click\(\)/);
});

test('reader source: five locales have safe names/status copy, including missing-key behavior', () => {
  const result = verifyStoryStageSource(source);
  assert.equal(result.fiveLocaleReader, true);
  assert.equal(result.safeReaderValues, true);
  assert.equal(result.rawKeyFallbackBlocked, true);
  assert.equal(verifyStoryStageSource(source.replace('Previous scene', 'story.reader.previous')).safeReaderValues, false);
  assert.equal(verifyStoryStageSource(source.replace('READER_COPY.en[key] || ""', 'READER_COPY.en[key] || key')).rawKeyFallbackBlocked, false);
});

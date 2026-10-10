import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/ott.js', import.meta.url), 'utf8');
const start = source.indexOf('  function clearCaptions(');
const end = source.indexOf('  async function loadCaptions(', start);
assert(start >= 0 && end > start);
const runtime = source.slice(start, end);

function fixture(cues = []) {
  const captionDisplay = { hidden: true, textContent: '' };
  Object.defineProperty(captionDisplay, 'innerHTML', { set() { throw Error('Caption HTML injection'); } });
  const context = { captionDisplay, captionsEnabled: true, publicPlayback: null,
    choiceOverlay: { hidden: true }, videoError: { hidden: true },
    demoVideo: { currentTime: 0.5, querySelector: () => ({ track: { activeCues: cues } }), querySelectorAll: () => [] },
    captionRequestId: 0, captionUrl: null, toggleCaptions: { hidden: false },
    syncPlayerControls() {}, URL: { revokeObjectURL() {} } };
  const api = runInNewContext(`${runtime}\n({syncCaptionDisplay, clearCaptions});`, context);
  return { context, captionDisplay, ...api };
}

test('native cue uses browser-parsed text rather than raw entity or style markup', () => {
  const page = fixture([{ text: 'A &amp; <i>B</i>', getCueAsHTML: () => ({ textContent: 'A & B' }) }]);
  page.syncCaptionDisplay();
  assert.equal(page.captionDisplay.textContent, 'A & B');
  assert.equal(page.captionDisplay.hidden, false);
});

test('native overlapping cues preserve order and multiline text', () => {
  const page = fixture([{ text: '<v Voice>First', getCueAsHTML: () => ({ textContent: 'First\nSecond' }) },
    { text: 'Third', getCueAsHTML: () => ({ textContent: 'Third' }) }]);
  page.syncCaptionDisplay(); assert.equal(page.captionDisplay.textContent, 'First\nSecond\nThird');
});

test('native malformed cue conversion cannot stop a valid neighboring cue', () => {
  const page = fixture([{ text: 'bad', getCueAsHTML() { throw Error('Unavailable conversion'); } },
    { text: 'safe', getCueAsHTML: () => ({ textContent: 'safe' }) }]);
  page.syncCaptionDisplay(); assert.equal(page.captionDisplay.textContent, 'safe');
});

test('unsupported native cue API preserves legacy plain text without HTML parsing', () => {
  const page = fixture([{ text: 'Legacy plain text' }]); page.syncCaptionDisplay();
  assert.equal(page.captionDisplay.textContent, 'Legacy plain text');
});

test('invalid native conversion result is excluded', () => {
  const page = fixture([{ text: '<i>bad</i>', getCueAsHTML: () => null }]); page.syncCaptionDisplay();
  assert.equal(page.captionDisplay.textContent, ''); assert.equal(page.captionDisplay.hidden, true);
});

test('multiple invalid native conversions cannot reveal an empty caption panel', () => {
  const page = fixture([{ text: 'one', getCueAsHTML: () => null },
    { text: 'two', getCueAsHTML() { throw Error('Unavailable conversion'); } }]);
  page.syncCaptionDisplay(); assert.equal(page.captionDisplay.textContent, '');
  assert.equal(page.captionDisplay.hidden, true);
});

for (const state of ['captionsOff', 'choice', 'error', 'empty']) {
  test(`native caption display remains hidden in ${state}`, () => {
    const page = fixture(state === 'empty' ? [] : [{ text: 'caption', getCueAsHTML: () => ({ textContent: 'caption' }) }]);
    if (state === 'captionsOff') page.context.captionsEnabled = false;
    if (state === 'choice') page.context.choiceOverlay.hidden = false;
    if (state === 'error') page.context.videoError.hidden = false;
    page.syncCaptionDisplay(); assert.equal(page.captionDisplay.hidden, true);
  });
}

test('public JSON captions stay literal and never use the native cue parser', () => {
  const page = fixture();
  const text = 'Literal &amp; text';
  page.context.publicPlayback = { currentKey: 'one', nodes: new Map([['one', {
    subtitles: [{ startMs: 0, endMs: 1000, text, getCueAsHTML() { throw Error('Must not decode JSON'); } }] }]]) };
  page.syncCaptionDisplay(); assert.equal(page.captionDisplay.textContent, text);
});

test('clearing native captions removes displayed text and keeps the panel hidden', () => {
  const page = fixture([{ text: 'caption', getCueAsHTML: () => ({ textContent: 'caption' }) }]);
  page.syncCaptionDisplay(); page.clearCaptions();
  assert.equal(page.captionDisplay.textContent, ''); assert.equal(page.captionDisplay.hidden, true);
});

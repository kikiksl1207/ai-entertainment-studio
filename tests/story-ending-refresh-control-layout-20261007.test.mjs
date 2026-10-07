import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles/story-stage.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');

test('only a disabled arrow in an ending recovery shell is visually hidden', () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(([, , body]) => /visibility:\s*hidden/u.test(body));
  assert.equal(rules.length, 1);
  assert.equal(rules[0][1].trim(), '.story-reader-shell:has([data-story-ending-read-refresh]) .story-beat-navigation button:disabled');
  assert.equal(rules[0][2].trim(), 'visibility: hidden;');
  assert.match(css, /\.story-beat-navigation button:disabled\s*\{\s*pointer-events:\s*none;\s*\}/u);
});

test('ending recovery remains an explicit reload without enabling a confirmation or paid request', () => {
  assert.ok(source.includes('["changed", "unavailable"].includes(endingStatus)'));
  assert.ok(source.includes('data-story-ending-read-refresh'));
  assert.ok(source.includes('if (event.target.closest("[data-story-ending-read-refresh]")) return loadScene();'));
  assert.ok(source.includes('endingReadSaved || ["checking", "saving", "changed", "unavailable"].includes(endingStatus) ? "disabled"'));
});

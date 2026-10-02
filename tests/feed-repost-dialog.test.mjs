import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../lumina-feed/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../pages/lumina-feed.js', import.meta.url), 'utf8');

test('repost dialog has a real accessible title and restores keyboard focus', () => {
  assert.match(html, /id="feedRepostModal"[^>]*aria-labelledby="feedRepostTitle"/);
  assert.match(script, /<h2 id="feedRepostTitle">리포스트<\/h2>/);
  assert.match(script, /repostReturnFocus = document\.activeElement/);
  assert.match(script, /repostReturnFocus\.focus\(\)/);
  assert.match(script, /e\.key === "Tab" && modal && !modal\.hidden/);
  assert.match(script, /e\.preventDefault\(\); last\.focus\(\)/);
  assert.match(script, /e\.preventDefault\(\); first\.focus\(\)/);
});

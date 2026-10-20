import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function refs(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(src => src.split('?')[0] === '/pages/lumina-feed.js');
}

test('feed entry loads the input-owner guard once with a fresh cache version', () => {
  const html = readFileSync(new URL('../lumina-feed/index.html', import.meta.url), 'utf8');
  const expected = ['/pages/lumina-feed.js?v=feed-search-locale-20261015&amp;content=67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207'];
  const tag = '<script src="' + expected[0] + '"></script>';
  assert.deepEqual(refs(html), expected);
  for (const invalid of [
    html.replace('feed-search-locale-20261015', 'feed-report-safety-20261001'),
    html.replace(tag, ''),
    html.replace('</body>', tag + '</body>'),
  ]) assert.notDeepEqual(refs(invalid), expected);
});

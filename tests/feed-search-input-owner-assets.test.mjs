import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function refs(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(src => src.split('?')[0] === '/pages/lumina-feed.js');
}

test('feed entry loads the input-owner guard once with a fresh cache version', () => {
  const html = readFileSync(new URL('../lumina-feed/index.html', import.meta.url), 'utf8');
  const expected = ['/pages/lumina-feed.js?v=feed-search-owner-20261009'];
  assert.deepEqual(refs(html), expected);
  for (const invalid of [
    html.replace('feed-search-owner-20261009', 'feed-report-safety-20261001'),
    html.replace(/<script src="\/pages\/lumina-feed\.js\?v=feed-search-owner-20261009"><\/script>/, ''),
    html.replace('</body>', '<script src="/pages/lumina-feed.js?v=feed-search-owner-20261009"></script></body>'),
  ]) assert.notDeepEqual(refs(invalid), expected);
});

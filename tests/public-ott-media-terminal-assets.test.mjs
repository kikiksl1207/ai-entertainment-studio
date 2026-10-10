import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('public theater entry loads the caption and terminal-error guard once through a fresh cache version', () => {
  const html = readFileSync(new URL('../ott/index.html', import.meta.url), 'utf8');
  const refs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
    .map(match => match[1]).filter(src => src.split('?')[0] === '/pages/ott.js');
  assert.deepEqual(refs, ['/pages/ott.js?v=ott-native-caption-text-20261011']);
  for (const invalid of [
    html.replace('?v=ott-native-caption-text-20261011', '?v=ott-fullscreen-scope-20261001'),
    html.replace(/<script src="\/pages\/ott\.js\?v=ott-native-caption-text-20261011"><\/script>/, ''),
    html.replace('</body>', '<script src="/pages/ott.js?v=ott-native-caption-text-20261011"></script></body>'),
  ]) {
    const invalidRefs = [...invalid.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)]
      .map(match => match[1]).filter(src => src.split('?')[0] === '/pages/ott.js');
    assert.notDeepEqual(invalidRefs, refs);
  }
});

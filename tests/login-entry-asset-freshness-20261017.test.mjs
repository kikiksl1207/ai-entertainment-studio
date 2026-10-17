import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = 'https://www.lumina-stage.com';
const legacy = new URL('/app.js?v=wallet-session-20261011', host);
const paths = ['index.html', 'creator-studio/index.html'];
const currentHash = createHash('sha256').update(readFileSync(path.join(root, 'app.js'))).digest('hex');

// Exact source-tag contract only, not a general HTML parser or browser cache probe.
function entry(file) {
  const html = readFileSync(path.join(root, file), 'utf8');
  const marker = '<script src="/app.js?v=wallet-session-20261011';
  assert.equal(html.split(marker).length, 2, 'ONE_KNOWN_APP_TAG');
  const start = html.indexOf(marker), close = html.indexOf('</script>', start);
  assert(close > start && close - start < 256, 'BOUNDED_APP_TAG');
  const tag = html.slice(start, close + '</script>'.length);
  assert(tag.startsWith('<script src="') && tag.endsWith('"></script>'), 'KNOWN_APP_TAG_FORM');
  const literal = tag.slice('<script src="'.length, -'"></script>'.length);
  assert(!/["<>\s]/.test(literal), 'SAFE_APP_LITERAL');
  return { file, literal, url: new URL(literal.replaceAll('&amp;', '&'), host) };
}

test('login entries bind their application URL to the current source bytes', () => {
  for (const file of paths) assert.equal(entry(file).url.searchParams.get('content'), currentHash, 'CURRENT_CODE_URL_BINDING');
});

test('new login entry URLs are distinct from the old application cache key', () => {
  for (const file of paths) assert.notEqual(entry(file).url.href, legacy.href, 'NEW_CODE_CACHE_KEY');
});

test('login entry delivery retains the same origin path and legacy version', () => {
  for (const file of paths) {
    const { url } = entry(file);
    assert.equal(url.origin, host);
    assert.equal(url.pathname, '/app.js');
    assert.equal(url.searchParams.get('v'), 'wallet-session-20261011');
    assert.equal(url.hash, '');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.port, '');
    const keys = [...url.searchParams.keys()];
    assert(keys.every(key => ['v', 'content'].includes(key)));
    assert.equal(keys.length, new Set(keys).size);
  }
});

test('root and Studio use one consistent escaped application reference', () => {
  const rows = paths.map(entry);
  assert.equal(rows[0].url.href, rows[1].url.href);
  for (const row of rows) {
    assert.equal(row.literal.includes('&content='), false);
    assert.equal(row.url.searchParams.has('amp;content'), false);
  }
});

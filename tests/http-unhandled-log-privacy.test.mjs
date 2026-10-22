import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Source contract guard; genuine filter behavior is checked separately.
const source = readFileSync(new URL('../server/src/common/http-exception.filter.ts', import.meta.url), 'utf8');

test('unhandled error log keeps a single fixed event without raw exception fields', { timeout: 1000 }, () => {
  assert.equal([...source.matchAll(/this\.logger\.error\s*\(/g)].length, 1);
  assert.match(source, /this\.logger\.error\('Unhandled exception'\);/);
  assert.doesNotMatch(source, /getUnhandledMessage|exception\.stack/);
});

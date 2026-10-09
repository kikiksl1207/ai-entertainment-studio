import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/mypage-following-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

export function htmlWithoutFollowingReadDelta(value, delta = fixture) {
  value = value.replaceAll('\r\n', '\n');
  assert.equal(delta.scope, 'mypage-following-read-exact1-only');
  assert.equal(delta.beforeSHA256, 'd037b4075ae12ab4195f9a328146b67ec41038ebd2099090c7eb5b7082bce34b');
  assert.equal(delta.afterSHA256, '338c23082536d6a58d8c8ce4340b43d8498073bfd36a21c0783a9b7fe6cbe4c7');
  assert.deepEqual(delta.changes.map(change => change.name), ['following']);
  if (sha(value) === delta.beforeSHA256) return value;
  assert.equal(sha(value), delta.afterSHA256, 'Exact one-block following read source');
  const change = delta.changes[0];
  const start = value.indexOf(change.start), end = value.indexOf(change.end, start + change.start.length);
  assert(start >= 0 && end > start);
  assert.equal(value.indexOf(change.start, start + 1), -1);
  assert.equal(value.slice(start, end), change.after);
  value = value.slice(0, start) + change.before + value.slice(end);
  assert.equal(sha(value), delta.beforeSHA256, 'All previous HTML bytes restored');
  return value;
}

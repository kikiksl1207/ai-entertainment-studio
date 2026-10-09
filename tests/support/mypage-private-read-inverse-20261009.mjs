import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { htmlWithoutFollowingReadDelta } from './mypage-following-read-inverse-20261009.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/mypage-private-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

export function htmlWithoutPrivateReadDelta(value, delta = fixture) {
  value = value.replaceAll('\r\n', '\n');
  assert.equal(delta.scope, 'mypage-private-read-exact2-only');
  assert.equal(delta.beforeSHA256, '4bd1baac13f7c048acd4d5d145d15fdc42df7501f7fecb791204dc5571f7235e');
  assert.equal(delta.afterSHA256, 'd037b4075ae12ab4195f9a328146b67ec41038ebd2099090c7eb5b7082bce34b');
  assert.deepEqual(delta.changes.map(change => change.name), ['summary', 'settings']);
  if (sha(value) === delta.beforeSHA256) return value;
  value = htmlWithoutFollowingReadDelta(value);
  assert.equal(sha(value), delta.afterSHA256, 'Exact two-block private read source');
  for (const change of delta.changes) {
    const start = value.indexOf(change.start), end = value.indexOf(change.end, start + change.start.length);
    assert(start >= 0 && end > start);
    assert.equal(value.indexOf(change.start, start + 1), -1);
    assert.equal(value.slice(start, end), change.after);
    value = value.slice(0, start) + change.before + value.slice(end);
  }
  assert.equal(sha(value), delta.beforeSHA256, 'All previous HTML bytes restored');
  return value;
}

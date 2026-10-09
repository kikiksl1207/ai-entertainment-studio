import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/mypage-activation-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

export function htmlWithoutActivationReadDelta(value, delta = fixture) {
  value = value.replaceAll('\r\n', '\n');
  assert.equal(delta.scope, 'mypage-activation-read-exact2-only');
  assert.equal(delta.beforeSHA256, 'c0c66abe67eba7747d6a3694a10b786e69e3cf218f805d6eb97b1fff55546a0e');
  assert.equal(delta.afterSHA256, '4bd1baac13f7c048acd4d5d145d15fdc42df7501f7fecb791204dc5571f7235e');
  assert.deepEqual(delta.changes.map(change => change.name), ['activationRead', 'inlineRefresh']);
  if (sha(value) === delta.beforeSHA256) return value;
  assert.equal(sha(value), delta.afterSHA256, 'Exact two-block participation read source');
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

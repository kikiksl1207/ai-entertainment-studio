import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/backstage-audit-permission-exact-delta-v2-20261009.json', import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex');
const names = ['syncCurrentAdminContext', 'canAccessBackstageSection', 'loadAuditSection', 'loadAuditPage'];

export function sourceWithoutAuditPermissionDelta(source, delta = fixture) {
  assert.equal(delta.scope, 'backstage-audit-permission-exact4-only');
  assert.equal(delta.beforeSHA256, '4780764cf1325e73798af337b3b7bb074dadf96a2a892e94dbd0b36dfc2c342f');
  assert.equal(delta.afterSHA256, '93a2051e3e400348a098fd4924f00cfa8e81e125165d80e7db13ba1e1f71bfb6');
  assert.deepEqual(delta.names, names);
  assert.deepEqual(delta.changes.map(change => change.name), names);
  source = source.replaceAll('\r\n', '\n');
  assert.equal(sha(source), delta.afterSHA256, 'Exact current audit permission source');
  for (const change of delta.changes) {
    const start = source.indexOf(change.start);
    const end = source.indexOf(change.end, start + change.start.length);
    assert(start >= 0 && end > start);
    assert.equal(source.indexOf(change.start, start + 1), -1);
    assert.equal(source.slice(start, end), change.after, 'Only the enumerated audit function may change');
    source = source.slice(0, start) + change.before + source.slice(end);
  }
  assert.equal(sha(source), delta.beforeSHA256, 'All previous source bytes restored before the existing inverse chain');
  return source;
}

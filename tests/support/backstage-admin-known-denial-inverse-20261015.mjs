import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const knownDenialBeforeSHA256 = 'a2ec8324573b8113b1f1f861f08dc46fd4b5e2de18e0dfd7b16be562a759c240';
export const knownDenialAfterSHA256 = '23d49705138ce5d8a5b249ddead30104deb4c5d1186d4ae069b976d7b6fc688d';
export const knownDenialFixtureSHA256 = '5e36cf7bc375ae6f0e00d77cb26b1dcf2e16b91f30a673e7b0affb8b5bf6159d';
const names = ['currentAdminRoleName', 'currentAdminPermissions', 'canAccessBackstageSection', 'applyPermissionVisibility'];
const spanPins = [
  ['91e987cc4bb6730cdb2f3def310a7204d0db84a4cf816c1905b789df60f9b5dc', '915c10c4b8bd02f032f5d113c67d90a26acac6eea6a4abbff7fc660468a8ecaa'],
  ['e251d84ea134cde1e2f3431b86f5569052f612a34111e66abfd05f5e352532b8', '79f702709f9ee6df8b076ff0b561cbc80f32e307823f2112898ff85422802f78'],
  ['f056e171b238b87a4a76360a350b5a1ad9799419e5c526e55c7e41bee59c9d70', '913ac1b5f05a8ff1ca8e46e3102af0561a2866e16e3bc851552560243ad4a545'],
  ['c23e5beaa1f5ce2b59ce511335a842992678d534cf8ce5f08cd58ceb052474a6', 'a5ecd857e97575ebd8963577ec014e9f29e0df89a40f46600fd8e174c770f6a4'],
];
function uniformLF(value) {
  assert.equal(typeof value, 'string');
  assert(!value.startsWith('\uFEFF'), 'Known-denial JS/fixture BOM forbidden');
  if (value.includes('\r')) assert(!/[\r\n]/.test(value.replaceAll('\r\n', '')), 'Known-denial uniform newline required');
  return value.replaceAll('\r\n', '\n');
}
const bytes = readFileSync(new URL('../fixtures/backstage-admin-known-denial-exact-delta-20261015.json', import.meta.url));
assert(bytes.length > 0 && bytes.length <= 65536);
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
assert(Buffer.from(decoded).equals(bytes), 'Exact UTF-8 fixture bytes');
const text = uniformLF(decoded);
assert.equal(sha(text), knownDenialFixtureSHA256, 'Pinned four-function descriptor');
const delta = JSON.parse(text);
assert.deepEqual(Object.keys(delta).sort(), ['afterSHA256', 'baseCommit', 'beforeSHA256', 'changes', 'names', 'scope', 'version']);
assert.equal(delta.version, 1);
assert.equal(delta.scope, 'backstage-admin-known-denial-exact-four-functions-20261015');
assert.equal(delta.baseCommit, '96b5f747cbf442b2a4d4f023bf152256f28ec72c');
assert.equal(delta.beforeSHA256, knownDenialBeforeSHA256);
assert.equal(delta.afterSHA256, knownDenialAfterSHA256);
assert.deepEqual(delta.names, names);
assert.equal(delta.changes.length, names.length);
delta.changes.forEach((change, index) => {
  assert.deepEqual(Object.keys(change).sort(), ['after', 'afterSHA256', 'before', 'beforeSHA256', 'end', 'name', 'start']);
  assert.equal(change.name, names[index]);
  for (const field of ['start', 'end', 'before', 'after']) {
    assert.equal(typeof change[field], 'string'); assert(change[field].length > 0);
    assert.equal(uniformLF(change[field]), change[field]);
  }
  assert.equal(change.beforeSHA256, spanPins[index][0]); assert.equal(change.afterSHA256, spanPins[index][1]);
  assert.equal(sha(change.before), change.beforeSHA256); assert.equal(sha(change.after), change.afterSHA256);
  assert(change.before.startsWith(change.start) && change.after.startsWith(change.start));
  Object.freeze(change);
});
Object.freeze(delta.names); Object.freeze(delta.changes); Object.freeze(delta);

// Historical equivalence only. Unknown bytes are never masked or reclassified.
export function sourceWithoutAdminKnownDenialDelta(value) {
  assert.equal(typeof value, 'string'); assert(value.length <= 1024 * 1024);
  if (sha(value.replaceAll('\r\n', '\n')) !== knownDenialAfterSHA256) return value;
  const candidate = uniformLF(value);
  let source = candidate;
  for (const change of delta.changes) {
    const start = source.indexOf(change.start), end = source.indexOf(change.end, start + change.start.length);
    assert(start >= 0 && end > start);
    assert.equal(source.indexOf(change.start, start + change.start.length), -1, 'Unique known-denial start');
    assert.equal(source.slice(start, end), change.after, 'Exact enumerated function only');
    assert.equal(source.split(change.after).length, 2);
    source = source.slice(0, start) + change.before + source.slice(end);
  }
  assert.equal(sha(source), knownDenialBeforeSHA256, 'Whole exact96 source restored');
  let forward = source;
  for (const change of delta.changes) {
    assert.equal(forward.split(change.before).length, 2);
    forward = forward.replace(change.before, change.after);
  }
  assert.equal(forward, candidate, 'Whole four-function forward equivalence');
  return source;
}

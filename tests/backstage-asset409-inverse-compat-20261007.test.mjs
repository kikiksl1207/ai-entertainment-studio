import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceWithoutAsset409Delta } from './support/backstage-asset409-inverse-compat-20261007.mjs';

const currentBytes = readFileSync(new URL('../backstage.js', import.meta.url));
const current = currentBytes.toString('utf8');
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/backstage-asset409-exact3-delta-20261007.json', import.meta.url), 'utf8'));
const branch = fixture.afterFullText;
const sha = source => createHash('sha256').update(source).digest('hex');
const rejects = (source, message, delta) => assert.throws(
  () => sourceWithoutAsset409Delta(source, delta), { name: 'AssertionError', message });

test('asset409 inverse: exact current branch restores the complete operating080 source pin', () => {
  assert.equal(sha(currentBytes), '1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409');
  assert.equal(current.split(branch).length - 1, 1);
  assert.equal(branch.split('\n').length - 1, 3);
  assert.equal(Buffer.byteLength(branch), 177);
  const index = current.indexOf(branch);
  const restored = sourceWithoutAsset409Delta(current);
  assert.equal(restored, current.slice(0, index) + current.slice(index + branch.length));
  assert.equal(Buffer.byteLength(restored), 260651);
  assert.equal(sha(restored), '62b920293ea88fc2f181d4c118eb725c60b214e298c8fa09ea7bea2a8034d26d');
  assert.equal(restored.slice(0, index) + branch + restored.slice(index), current);
});

for (const [name, replacement] of [
  ['status mutation', branch.replace('status === 409', 'status === 408')],
  ['server-code mutation', branch.replace('ADMIN_ASSET_STORAGE_CONFLICT', 'OTHER_CONFLICT')],
  ['message mutation', branch.replace('return "', 'return "changed: ')],
  ['branch whitespace mutation', branch.replace('  if (', '   if (')],
]) {
  test(`asset409 inverse: rejects ${name}`, () => {
    rejects(current.replace(branch, replacement), /Exact asset409 branch count/);
  });
}

test('asset409 inverse: rejects a missing branch and the already-inverted operating080 source', () => {
  rejects(current.replace(branch, ''), /Exact asset409 branch count/);
});

test('asset409 inverse: rejects duplicate exact branches', () => {
  rejects(current + branch, /Exact asset409 branch count/);
});

test('asset409 inverse: rejects unrelated trailing-byte drift with the branch still present once', () => {
  const drift = current + '\n';
  assert.equal(drift.split(branch).length - 1, 1);
  rejects(drift, /Exact asset409 current full-source SHA256/);
});

test('asset409 inverse: rejects same-length unrelated source drift', () => {
  const drift = current.replace('function backstageUserFacingError(', 'function backstageUserFacingErr0r(');
  assert.notEqual(drift, current);
  assert.equal(Buffer.byteLength(drift), currentBytes.length);
  assert.equal(drift.split(branch).length - 1, 1);
  rejects(drift, /Exact asset409 current full-source SHA256/);
});

for (const [name, patch] of [
  ['arbitrary after SHA', { afterSHA256: sha(current + '\n') }],
  ['arbitrary before SHA', { beforeSHA256: '0'.repeat(64) }],
  ['relaxed branch count', { branchCount: 2 }],
  ['relaxed added-line count', { addedLineCount: 4 }],
  ['nonempty restoration text', { beforeFullText: '\n' }],
]) {
  test(`asset409 inverse: rejects fixture ${name}`, () => {
    rejects(current, /Exact asset409 inverse fixture pins/, { ...fixture, ...patch });
  });
}

test('asset409 inverse: rejects coordinated branch and full-source fixture repinning', () => {
  const changedBranch = branch.replace('status === 409', 'status === 408');
  const drift = current.replace(branch, changedBranch);
  rejects(drift, /Exact asset409 inverse fixture pins/, {
    ...fixture, afterFullText: changedBranch, branchSHA256: sha(changedBranch), afterSHA256: sha(drift),
  });
});

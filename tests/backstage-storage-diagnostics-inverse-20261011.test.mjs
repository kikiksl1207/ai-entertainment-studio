import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceWithoutStorageDiagnosticsDelta, beforeSHA256, afterSHA256 } from './support/backstage-storage-diagnostics-inverse-20261011.mjs';
import { sourceWithoutStorageModeDelta } from './support/backstage-storage-mode-inverse-20261011.mjs';

const current = sourceWithoutStorageModeDelta(readFileSync(new URL('../backstage.js', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const previous = sourceWithoutStorageDiagnosticsDelta(current);

test('storage inverse accepts only the frozen current source and restores the previous whole source', () => {
  assert.equal(sha(current), afterSHA256);
  assert.equal(sha(previous), beforeSHA256);
});
test('storage inverse preserves the exact prior source without a second inverse', () => {
  assert.equal(sourceWithoutStorageDiagnosticsDelta(previous), previous);
});
test('storage inverse rejects unrelated appended content', () => {
  assert.throws(() => sourceWithoutStorageDiagnosticsDelta(current + '\n// unexpected delta\n'));
});
test('storage inverse rejects an altered unknown diagnostic value', () => {
  const changed = current.replace('민감 값 반환 정책: 확인 불가', '민감 값 반환 정책: 안전');
  assert.notEqual(changed, current);
  assert.throws(() => sourceWithoutStorageDiagnosticsDelta(changed));
});
test('storage inverse rejects a duplicate fallback function', () => {
  const fallback = current.match(/^function renderObjectStorageDiagnosticsFallback\(\) \{\n[\s\S]*?^\}/gm);
  assert.equal(fallback.length, 1);
  assert.throws(() => sourceWithoutStorageDiagnosticsDelta(current + '\n' + fallback[0]));
});
test('storage inverse rejects an altered prior baseline', () => {
  assert.throws(() => sourceWithoutStorageDiagnosticsDelta(previous + '\n// unexpected prior delta\n'));
});

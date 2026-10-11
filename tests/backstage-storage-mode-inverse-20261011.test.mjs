import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { modeBeforeSHA256, modeAfterSHA256, sourceWithoutStorageModeDelta } from './support/backstage-storage-mode-inverse-20261011.mjs';

// The parent supplies the canonical capsule, not an unrelated dirty worktree.
const sourceFile = process.env.BACKSTAGE_STORAGE_MODE_SOURCE_FILE || new URL('../backstage.js', import.meta.url);
const current = readFileSync(sourceFile, 'utf8').replaceAll('\r\n', '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const previous = sourceWithoutStorageModeDelta(current);

test('mode inverse restores only the frozen whole source to the exact prior storage source', () => {
  assert.equal(sha(current), modeAfterSHA256);
  assert.equal(sha(previous), modeBeforeSHA256);
});

test('mode inverse leaves the exact old source unchanged', () => {
  assert.equal(sourceWithoutStorageModeDelta(previous), previous);
});

test('mode inverse rejects appended unrelated content', () => {
  assert.throws(() => sourceWithoutStorageModeDelta(current + '\n// unexpected mode delta\n'));
});

test('mode inverse rejects an altered mode value', () => {
  const changed = current.replace('if (value === "metadata_only") return "metadata-only";',
    'if (value === "metadata_only") return "enabled";');
  assert.notEqual(changed, current);
  assert.throws(() => sourceWithoutStorageModeDelta(changed));
});

test('mode inverse rejects a duplicate mode function', () => {
  const definitions = current.match(/^function storageBooleanLabel\([^\n]*\) \{\n[\s\S]*?^\}/gm);
  assert.equal(definitions.length, 1);
  assert.throws(() => sourceWithoutStorageModeDelta(current + '\n' + definitions[0]));
});

test('mode inverse rejects a change outside the three mode functions', () => {
  const changed = current.replace('function storageConfiguredLabel(', 'function storageConfiguredLabelUnexpected(');
  assert.notEqual(changed, current);
  assert.throws(() => sourceWithoutStorageModeDelta(changed));
});

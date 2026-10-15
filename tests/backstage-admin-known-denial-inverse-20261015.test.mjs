import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sourceWithoutAdminKnownDenialDelta, knownDenialBeforeSHA256, knownDenialAfterSHA256 } from './support/backstage-admin-known-denial-inverse-20261015.mjs';
import { sourceWithoutAuditPermissionDelta } from './support/backstage-audit-permission-inverse-20261009.mjs';

const source = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
assert.equal(sha(source.replaceAll('\r\n', '\n')), knownDenialAfterSHA256);

test('KNOWN-DENIAL.INVERSE exact four-function restoration preserves historical guards', () => {
  const restored = sourceWithoutAdminKnownDenialDelta(source);
  assert.equal(sha(restored), knownDenialBeforeSHA256);
  assert.equal(sourceWithoutAdminKnownDenialDelta(restored), restored);
  assert.doesNotThrow(() => sourceWithoutAuditPermissionDelta(source));
});

test('KNOWN-DENIAL.INVERSE unknown inside outside and duplicate bytes are never masked', () => {
  for (const changed of [source.replace('function settlementMath(', 'function changedSettlementMath('),
    source.replace('classificationSupported: false };', 'classificationSupported: true };'),
    source + '\nfunction currentAdminRoleName() {}\n']) {
    assert.notEqual(changed, source);
    assert.equal(sourceWithoutAdminKnownDenialDelta(changed), changed);
    assert.throws(() => sourceWithoutAuditPermissionDelta(changed));
  }
});

test('KNOWN-DENIAL.INVERSE uniform checkout newlines are admitted but mixed input is not', () => {
  const lf = source.replaceAll('\r\n', '\n');
  assert.equal(sha(sourceWithoutAdminKnownDenialDelta(lf.replaceAll('\n', '\r\n'))), knownDenialBeforeSHA256);
  assert.throws(() => sourceWithoutAdminKnownDenialDelta(lf.replace('\n', '\r\n')));
  assert.throws(() => sourceWithoutAdminKnownDenialDelta(null));
  assert.throws(() => sourceWithoutAuditPermissionDelta('\uFEFF' + lf));
});

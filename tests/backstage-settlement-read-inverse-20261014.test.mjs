import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { sourceWithoutSettlementReadDelta, settlementReadBeforeSHA256, settlementReadAfterSHA256,
  settlementReadFixtureSHA256 } from './support/backstage-settlement-read-inverse-20261014.mjs';
import { sourceWithoutStorageModeDelta, modeBeforeSHA256, modeAfterSHA256 } from './support/backstage-storage-mode-inverse-20261011.mjs';
import { sourceWithoutStorageDiagnosticsDelta, beforeSHA256, afterSHA256 } from './support/backstage-storage-diagnostics-inverse-20261011.mjs';
import { sourceWithoutAuditPermissionDelta } from './support/backstage-audit-permission-inverse-20261009.mjs';
import { sourceWithoutPartnerPaginationDelta } from './support/backstage-partner-pagination-inverse-20261015.mjs';

// Authored only; parent owns first execution. No external QA/Git dependency by default.
const sha = value => createHash('sha256').update(value).digest('hex');
const pathKey = 'BACKSTAGE_SETTLEMENT_READ_INVERSE_SOURCE_FILE';
const pinKey = 'BACKSTAGE_SETTLEMENT_READ_INVERSE_SOURCE_SHA256';
const path = process.env[pathKey], pin = process.env[pinKey];
assert.equal(path === undefined, pin === undefined, 'Override requires path + RAW SHA256');
if (path !== undefined) {
  assert.match(path, /^E:[\\/]/i, 'Use an absolute E source override');
  assert.match(pin, /^[a-f0-9]{64}$/i, 'Use an exact RAW SHA256 override');
}
const raw = readFileSync(path || new URL('../backstage.js', import.meta.url));
assert.ok(raw.length > 0 && raw.length <= 1024 * 1024);
assert.equal(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf, false, 'Source BOM forbidden');
if (pin !== undefined) assert.equal(sha(raw), pin.toLowerCase(), 'Override RAW mismatch');
const input = new TextDecoder('utf-8', { fatal: true }).decode(raw);
const current = sourceWithoutPartnerPaginationDelta(input).replaceAll('\r\n', '\n');
assert.equal(sha(current), settlementReadAfterSHA256, 'Select the exact published current source');
const bytes = readFileSync(new URL('./fixtures/backstage-settlement-read-exact-delta-20261014.json', import.meta.url));
const json = bytes.toString('utf8').replaceAll('\r\n', '\n');
const fixture = JSON.parse(json);
const baseline = sourceWithoutSettlementReadDelta(input);
const mutatedFixture = edit => {
  const clone = JSON.parse(json); edit(clone); return Buffer.from(JSON.stringify(clone, null, 2) + '\n');
};
const rejectEntries = value => {
  assert.throws(() => sourceWithoutStorageModeDelta(value), 'Mode entry rejects unsupported source');
  assert.throws(() => sourceWithoutStorageDiagnosticsDelta(value), 'Diagnostics entry rejects unsupported source');
  assert.throws(() => sourceWithoutAuditPermissionDelta(value), 'Audit chain rejects unsupported source');
};

test('SRI01 exact pinned fixture and source reconstruct old D4 once', () => {
  assert.equal(sha(json), settlementReadFixtureSHA256);
  assert.equal(sha(baseline), settlementReadBeforeSHA256);
  assert.equal(settlementReadBeforeSHA256, modeAfterSHA256);
  assert.equal(sourceWithoutSettlementReadDelta(baseline), baseline);
});

test('SRI02 enumerated forward block plus three initializers reproduces exact current9D', () => {
  let forward = baseline;
  for (const change of [fixture.block, ...fixture.initializers]) {
    assert.equal(forward.split(change.before).length, 2);
    forward = forward.replace(change.before, change.after);
  }
  assert.equal(forward, current);
  assert.equal(sha(forward), settlementReadAfterSHA256);
});

test('SRI03 source accepts only equivalent uniform LF and CRLF on the known current identity', () => {
  assert.equal(sourceWithoutSettlementReadDelta(current), baseline);
  assert.equal(sourceWithoutSettlementReadDelta(current.replaceAll('\n', '\r\n')), baseline);
  assert.throws(() => sourceWithoutSettlementReadDelta(current.replace('\n', '\r\n')), /uniform/);
  rejectEntries(current.replace('\n', '\r\n'));
  rejectEntries(current.replace('\n', '\r'));
  rejectEntries('\uFEFF' + current);
});

test('SRI04 fixture accepts LF and uniform CRLF without weakening its normalized RAW pin', () => {
  assert.equal(sourceWithoutSettlementReadDelta(current, Buffer.from(json)), baseline);
  assert.equal(sourceWithoutSettlementReadDelta(current, Buffer.from(json.replaceAll('\n', '\r\n'))), baseline);
  assert.throws(() => sourceWithoutSettlementReadDelta(current, Buffer.from(json.replace('\n', '\r\n'))), /uniform/);
  assert.throws(() => sourceWithoutSettlementReadDelta(current, Buffer.from('\uFEFF' + json)), /BOM/);
  assert.throws(() => sourceWithoutSettlementReadDelta(current, Buffer.from(json + ' ')), /fixture bytes/);
  assert.throws(() => sourceWithoutSettlementReadDelta(current, Buffer.from([0xff])));
});

test('SRI05 fixture field, block, statement and duplicate drift fail closed', () => {
  for (const edit of [delta => { delta.beforeSHA256 = '0'.repeat(64); },
    delta => { delta.block.before += '\n'; }, delta => { delta.block.after += '\n'; },
    delta => { delta.initializers[0].after += ' '; }, delta => { delta.initializers.push(delta.initializers[0]); },
    delta => { delta.scope = 'accept-anything'; }]) {
    assert.throws(() => sourceWithoutSettlementReadDelta(current, mutatedFixture(edit)), /fixture bytes/);
  }
  assert.throws(() => sourceWithoutSettlementReadDelta(baseline, Buffer.from(json + ' ')), /fixture bytes/);
});

test('SRI06 old historical input is passed unchanged only to the original entry guards', () => {
  const unknown = '// unknown historical source\r\n';
  assert.equal(sourceWithoutSettlementReadDelta(unknown), unknown);
  rejectEntries(unknown);
  assert.equal(sourceWithoutSettlementReadDelta(baseline.replaceAll('\n', '\r\n')), baseline.replaceAll('\n', '\r\n'));
});

test('SRI07 both storage entries restore their unchanged original golden hashes', () => {
  const mode = sourceWithoutStorageModeDelta(current);
  assert.equal(sha(mode), modeBeforeSHA256);
  assert.equal(modeBeforeSHA256, afterSHA256);
  assert.equal(sourceWithoutStorageModeDelta(mode), mode);
  assert.equal(sourceWithoutStorageModeDelta(baseline), mode);
  const diagnostics = sourceWithoutStorageDiagnosticsDelta(current);
  assert.equal(sha(diagnostics), beforeSHA256);
  assert.equal(sourceWithoutStorageDiagnosticsDelta(mode), diagnostics);
  assert.equal(sourceWithoutStorageDiagnosticsDelta(diagnostics), diagnostics);
});

test('SRI08 audit consumer still reaches its frozen historical golden through both entries', () => {
  const audit = sourceWithoutAuditPermissionDelta(current);
  assert.equal(sha(audit), '4780764cf1325e73798af337b3b7bb074dadf96a2a892e94dbd0b36dfc2c342f');
  assert.equal(sourceWithoutAuditPermissionDelta(current.replaceAll('\n', '\r\n')), audit);
});

test('SRI09 edits outside settlement scope pass no full old entry', () => {
  const changed = current.replace('function storageConfiguredLabel(', 'function storageConfiguredLabelUnexpected(');
  assert.notEqual(changed, current);
  assert.equal(sourceWithoutSettlementReadDelta(changed), changed);
  rejectEntries(changed);
  rejectEntries(current + '\n// unrelated source\n');
});

test('SRI10 changed financial block or initializer passes no full old entry', () => {
  const changed = current.replace(fixture.block.after, fixture.block.after.replace('take: "20"', 'take: "21"'));
  assert.notEqual(changed, current); rejectEntries(changed);
  const alteredRow = current.replace(fixture.initializers[0].after, fixture.initializers[0].after + ' /* altered */');
  rejectEntries(alteredRow);
});

test('SRI11 duplicate blocks or statements pass no full old entry', () => {
  rejectEntries(current + '\n' + fixture.block.after);
  rejectEntries(current + '\n' + fixture.initializers[0].after);
});

test('SRI12 altered prior D4 and intermediate old goldens remain rejected', () => {
  for (const value of [baseline, sourceWithoutStorageModeDelta(baseline), sourceWithoutStorageDiagnosticsDelta(baseline)]) {
    rejectEntries(value + '\n// historical drift\n');
  }
});

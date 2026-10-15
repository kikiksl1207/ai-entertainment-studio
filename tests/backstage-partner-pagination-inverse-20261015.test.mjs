import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { sourceWithoutPartnerPaginationDelta, partnerPaginationBeforeSHA256, partnerPaginationAfterSHA256 } from './support/backstage-partner-pagination-inverse-20261015.mjs';
import { sourceWithoutSettlementReadDelta, settlementReadBeforeSHA256 } from './support/backstage-settlement-read-inverse-20261014.mjs';

import { sourceWithoutAdminKnownDenialDelta } from './support/backstage-admin-known-denial-inverse-20261015.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const selected = readFileSync(process.env.LUMINA_SETTLEMENT_READ_JS_PATH || new URL('../backstage.js', import.meta.url), 'utf8');
const source = sourceWithoutAdminKnownDenialDelta(selected).replaceAll('\r\n', '\n');
assert.equal(sha(source), partnerPaginationAfterSHA256);

test('PARTNER.INVERSE.01 exact current LF reconstructs only the prior published source', () => {
  assert.equal(sha(sourceWithoutPartnerPaginationDelta(source)), partnerPaginationBeforeSHA256);
});
test('PARTNER.INVERSE.02 uniform CRLF preserves the same exact inverse', () => {
  assert.equal(sha(sourceWithoutPartnerPaginationDelta(source.replaceAll('\n', '\r\n'))), partnerPaginationBeforeSHA256);
});
test('PARTNER.INVERSE.03 historical financial and private-state guard chain retains its original whole-source golden', () => {
  assert.equal(sha(sourceWithoutSettlementReadDelta(source)), settlementReadBeforeSHA256);
});
test('PARTNER.INVERSE.04 unknown money-helper mutation is never normalized away', () => {
  const changed = source.replace('function settlementMath(', 'function alteredSettlementMath(');
  assert.notEqual(changed, source);
  assert.equal(sourceWithoutPartnerPaginationDelta(changed), changed);
  assert.equal(sourceWithoutSettlementReadDelta(changed), changed);
});
test('PARTNER.INVERSE.05 mutation inside a known region is not admitted by a broad block mask', () => {
  const changed = source.replace('state.partnerLoading = true;', 'state.partnerLoading = false;');
  assert.notEqual(changed, source);
  assert.equal(sourceWithoutPartnerPaginationDelta(changed), changed);
});
test('PARTNER.INVERSE.06 mixed newline current-source admission fails closed', () => {
  assert.throws(() => sourceWithoutPartnerPaginationDelta(source.replace('\n', '\r\n')));
});

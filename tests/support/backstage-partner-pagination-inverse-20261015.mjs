import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const partnerPaginationBeforeSHA256 = '9d7695bfad6f710148fc8015d55d77851a7583137e09b3d16225db932b1f4609';
export const partnerPaginationAfterSHA256 = 'a2ec8324573b8113b1f1f861f08dc46fd4b5e2de18e0dfd7b16be562a759c240';
export const partnerPaginationFixtureSHA256 = '8447ac83acd6cca4708720c09e8e77d651f4d5174d619e78b554aadc43854dc1';
const bytes = readFileSync(new URL('../fixtures/backstage-partner-pagination-exact-delta-20261015.json', import.meta.url));
const uniformLF = value => {
  assert.equal(typeof value, 'string');
  assert.equal(value.startsWith('\uFEFF'), false);
  if (value.includes('\r')) assert.equal(/[\r\n]/.test(value.replaceAll('\r\n', '')), false);
  return value.replaceAll('\r\n', '\n');
};
assert.ok(bytes.length > 0 && bytes.length <= 256 * 1024);
assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, 'Fixture BOM forbidden');
const fixtureText = uniformLF(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
assert.equal(sha(fixtureText), partnerPaginationFixtureSHA256);
const delta = JSON.parse(fixtureText);
assert.equal(delta.version, 1);
assert.equal(delta.scope, 'backstage-partner-pagination-exact-two-regions-20261015');
assert.equal(delta.beforeSHA256, partnerPaginationBeforeSHA256);
assert.equal(delta.afterSHA256, partnerPaginationAfterSHA256);
assert.equal(delta.changes.length, 2);
assert.ok(delta.changes[0].after.startsWith('function settlementReadScope('));
assert.ok(delta.changes[1].after.startsWith('document.querySelectorAll("[data-load-more]")'));
delta.changes.forEach(change => { assert.equal(typeof change.before, 'string'); assert.equal(typeof change.after, 'string'); Object.freeze(change); });
Object.freeze(delta.changes); Object.freeze(delta);

export function sourceWithoutPartnerPaginationDelta(value) {
  assert.equal(typeof value, 'string');
  const candidate = value.replaceAll('\r\n', '\n');
  if (sha(candidate) !== partnerPaginationAfterSHA256) return value;
  let source = uniformLF(value);
  for (const change of delta.changes) {
    assert.equal(source.split(change.after).length, 2);
    source = source.replace(change.after, change.before);
  }
  assert.equal(sha(source), partnerPaginationBeforeSHA256);
  return source;
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const settlementReadBeforeSHA256 = 'd4defaf8ecc3be7555958e929cf85b2363bbcdd5981829f3010fec167ce7b785';
export const settlementReadAfterSHA256 = '9d7695bfad6f710148fc8015d55d77851a7583137e09b3d16225db932b1f4609';
export const settlementReadFixtureSHA256 = 'fb161e84285a7e97a86e6204ced3e8ec0bd03ba57dc7c1f9198ade92e9b199bb';
const ids = ['studioSettlementRows', 'settlementRows', 'settlementConversionRows'];
const fixtureBytes = readFileSync(new URL('../fixtures/backstage-settlement-read-exact-delta-20261014.json', import.meta.url));

function uniformLF(text, label) {
  assert.equal(typeof text, 'string', `${label}: string required`);
  assert.equal(text.startsWith('\uFEFF'), false, `${label}: BOM forbidden`);
  if (text.includes('\r')) {
    assert.equal(/[\r\n]/.test(text.replaceAll('\r\n', '')), false, `${label}: only uniform LF/CRLF`);
  }
  return text.replaceAll('\r\n', '\n');
}

function decodeFixture(bytes) {
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 256 * 1024, 'Bounded fixture bytes');
  assert.equal(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, false, 'Fixture BOM forbidden');
  const text = uniformLF(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 'Fixture');
  assert.equal(sha(text), settlementReadFixtureSHA256, 'Exact LF-normalized fixture bytes');
  const delta = JSON.parse(text);
  assert.equal(delta.version, 1);
  assert.equal(delta.scope, 'backstage-settlement-read-exact-block-and-three-initializers-20261014');
  assert.equal(delta.beforeSHA256, settlementReadBeforeSHA256);
  assert.equal(delta.afterSHA256, settlementReadAfterSHA256);
  assert.deepEqual(delta.sourcePins, {
    beforeRawSHA256: settlementReadBeforeSHA256,
    afterRawSHA256: '1567570c50b4c2134a9e0590f4541f2aeb6259464aa72e5546309cd911f584af'
  });
  assert.deepEqual(delta.initializers.map(change => change.id), ids);
  assert.equal(typeof delta.block.before, 'string');
  assert.equal(typeof delta.block.after, 'string');
  assert.ok(delta.block.before.startsWith('async function loadSettlementSection()'));
  assert.ok(delta.block.after.startsWith('function settlementReadScope('));
  Object.freeze(delta.block); Object.freeze(delta.sourcePins);
  delta.initializers.forEach(Object.freeze); Object.freeze(delta.initializers);
  return Object.freeze(delta);
}

const frozen = decodeFixture(fixtureBytes);

// Unknown history is left to the existing exact-source guards, never admitted here.
export function sourceWithoutSettlementReadDelta(value, pinnedFixtureBytes = fixtureBytes) {
  const delta = pinnedFixtureBytes === fixtureBytes ? frozen : decodeFixture(pinnedFixtureBytes);
  assert.equal(typeof value, 'string', 'Source string required');
  const candidate = value.replaceAll('\r\n', '\n');
  if (sha(candidate) !== settlementReadAfterSHA256) return value;
  let source = uniformLF(value, 'Settlement source');
  assert.equal(sha(source), settlementReadAfterSHA256, 'Exact current settlement source');
  const replaceOnce = (after, before) => {
    assert.equal(source.split(after).length, 2, 'Exactly one frozen delta occurrence');
    source = source.replace(after, before);
  };
  replaceOnce(delta.block.after, delta.block.before);
  for (const change of delta.initializers) replaceOnce(change.after, change.before);
  assert.equal(sha(source), settlementReadBeforeSHA256, 'Exact prior source reconstructed');
  return source;
}

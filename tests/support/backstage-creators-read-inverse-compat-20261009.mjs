import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const pinned = Object.freeze({
  scope: 'backstage-creators-read-exact-function-only',
  beforeSHA256: '1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409',
  afterSHA256: 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341',
  fullTextFunctionCount: 1,
  names: ['loadCreatorsSection'],
  startMarker: 'async function loadCreatorsSection() {',
  endMarker: 'async function loadAiContentSection()',
  prefixSHA256: 'cc54cc93fce99bc6c9e5bf49035f55d8e19638c9e32a65e9e3bb7250a351a483',
  suffixSHA256: '14366cf23a47857f26898175941b28c746f9d8b2d1683befab17670fd7eb9b79',
  beforeFullTextSHA256: '338443440a2d2311a931c05bef970f6ce2105c796e8bd6a05b17e511446e24c7',
  afterFullTextSHA256: '9b5e2447a15968be5a7d9528d883e480a9fd917ebde2b5cef91fba59c8757022',
});
const fixture = Object.freeze(JSON.parse(readFileSync(
  new URL('../fixtures/backstage-creators-read-exact-delta-20261009.json', import.meta.url), 'utf8')));
const sha = source => createHash('sha256').update(source, 'utf8').digest('hex');

export function sourceWithoutCreatorsReadDelta(source, delta = fixture) {
  assert.equal(typeof source, 'string', 'Creator read inverse source type');
  source = source.replace(/\r\n/g, '\n');
  const { beforeFullText, afterFullText, ...metadata } = delta;
  assert.deepEqual(metadata, pinned, 'Exact creator read inverse fixture metadata');
  assert.equal(typeof beforeFullText, 'string', 'Creator read inverse before span type');
  assert.equal(typeof afterFullText, 'string', 'Creator read inverse after span type');
  assert.equal(sha(beforeFullText), pinned.beforeFullTextSHA256, 'Exact creator read before span');
  assert.equal(sha(afterFullText), pinned.afterFullTextSHA256, 'Exact creator read after span');
  assert.equal(sha(source), pinned.afterSHA256, 'Exact creator read current LF source');

  const first = source.indexOf(pinned.startMarker);
  const last = source.indexOf(pinned.endMarker, first + pinned.startMarker.length);
  assert(first >= 0 && last > first, 'Creator read inverse source boundaries');
  assert.equal(source.indexOf(pinned.startMarker, first + 1), -1, 'Unique creator read start');
  assert.equal(source.indexOf(pinned.endMarker), last, 'Exact creator read end');
  assert.equal(source.indexOf(pinned.endMarker, last + 1), -1, 'Unique creator read end');
  const prefix = source.slice(0, first), suffix = source.slice(last);
  assert.equal(sha(prefix), pinned.prefixSHA256, 'Unchanged creator read prefix');
  assert.equal(sha(suffix), pinned.suffixSHA256, 'Unchanged creator read suffix');
  assert.equal(source.slice(first, last), afterFullText, 'Exact creator read forward interval');

  const restored = prefix + beforeFullText + suffix;
  assert.equal(sha(restored), pinned.beforeSHA256, 'Every original1843 LF byte restored before asset/finance inverse');
  return restored;
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sourceWithoutCreatorsNativeReadonlyDelta } from './backstage-creators-native-readonly-inverse-20261009.mjs';

const pinned = Object.freeze({
  scope: 'backstage-login-width-exact-interval-v1',
  beforeSHA256: 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341',
  afterSHA256: 'df5f352bae0df49a066035feba1feb9806ff24c2cf35d5e263a8233ed2bf3863',
  beforeStartMarker: 'function renderGoogleLoginButton() {',
  afterStartMarker: '// BEGIN backstage-login-width-20261009',
  endMarker: 'async function prepareGoogleLoginButton()',
  prefixSHA256: 'f676eb2f122ec95e949a382e55882e215933fbbc4b63e1f64a4cee661309aad5',
  suffixSHA256: 'a5f0e2824b4eb3dd6b50e9005b1fe80e2a608f86f8e59db0d0eb8c29db6f6650',
  beforeFullTextSHA256: 'b49ff610cfd838286f87be6dc5b3884d862e299324eb0a1ea658eff9129a70e4',
  afterFullTextSHA256: '3be80163e0fd92b530e09fdc6b491bece82698fceb6c8bd22663cb95dfd10a3b',
});
const fixture = Object.freeze(JSON.parse(readFileSync(
  new URL('../fixtures/backstage-login-width-exact-delta-20261009.json', import.meta.url), 'utf8')));
const sha = source => createHash('sha256').update(source, 'utf8').digest('hex');

export function sourceWithoutLoginWidthDelta(source, delta = fixture) {
  assert.equal(typeof source, 'string', 'Login width inverse source type');
  source = sourceWithoutCreatorsNativeReadonlyDelta(source.replace(/\r\n/g, '\n'));
  const { beforeFullText, afterFullText, ...metadata } = delta;
  assert.deepEqual(metadata, pinned, 'Exact login width fixture metadata');
  assert.equal(typeof beforeFullText, 'string', 'Login width before span type');
  assert.equal(typeof afterFullText, 'string', 'Login width after span type');
  assert.equal(sha(beforeFullText), pinned.beforeFullTextSHA256, 'Exact login width before span');
  assert.equal(sha(afterFullText), pinned.afterFullTextSHA256, 'Exact login width after span');
  if (sha(source) === pinned.beforeSHA256) return source;
  assert.equal(sha(source), pinned.afterSHA256, 'Exact login width current LF source');

  const first = source.indexOf(pinned.afterStartMarker);
  const last = source.indexOf(pinned.endMarker, first + pinned.afterStartMarker.length);
  assert(first >= 0 && last > first, 'Login width inverse boundaries');
  assert.equal(source.indexOf(pinned.afterStartMarker, first + 1), -1, 'Unique login width start');
  assert.equal(source.indexOf(pinned.endMarker), last, 'Exact login width end');
  assert.equal(source.indexOf(pinned.endMarker, last + 1), -1, 'Unique login width end');
  const prefix = source.slice(0, first), suffix = source.slice(last);
  assert.equal(sha(prefix), pinned.prefixSHA256, 'Unchanged login width prefix');
  assert.equal(sha(suffix), pinned.suffixSHA256, 'Unchanged login width suffix');
  assert.equal(source.slice(first, last), afterFullText, 'Exact login width forward interval');
  const restored = prefix + beforeFullText + suffix;
  assert.equal(sha(restored), pinned.beforeSHA256, 'Exact cbb source restored before creators inverse');
  return restored;
}

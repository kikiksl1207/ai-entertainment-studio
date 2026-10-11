import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const walletCacheDelta = Object.freeze({
  scope: 'mypage-wallet-cache-exact1-only',
  baseCommit: '98f797f6c280f17ae4a567387cfb814ec0b36735',
  currentCommit: '581b42c714cbb11c1bd0cc45ee98b9f4dd216c7b',
  beforeSHA256: '338c23082536d6a58d8c8ce4340b43d8498073bfd36a21c0783a9b7fe6cbe4c7',
  afterSHA256: '16abb7dfd8486bf53ed2b6f53b33a83437fdb7094052b1d5b18bd78e8681d03c',
  beforeTag: '<script src="/app.js"></script>',
  afterTag: '<script src="/app.js?v=wallet-session-20261011"></script>',
  lineEndings: 'CRLF-to-LF-only',
});

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

export function htmlWithoutWalletCacheDelta(value, delta = walletCacheDelta) {
  assert.equal(typeof value, 'string', 'HTML must be source text');
  assert.deepEqual(delta, walletCacheDelta, 'Exact wallet cache inverse metadata');
  const html = value.replaceAll('\r\n', '\n');
  const digest = sha(html), legacy = digest === walletCacheDelta.beforeSHA256;
  assert(legacy || digest === walletCacheDelta.afterSHA256, 'Exact whole mypage HTML source');
  assert.equal(html.split(walletCacheDelta.beforeTag).length - 1, legacy ? 1 : 0);
  assert.equal(html.split(walletCacheDelta.afterTag).length - 1, legacy ? 0 : 1);
  const restored = legacy ? html : html.replace(walletCacheDelta.afterTag, walletCacheDelta.beforeTag);
  assert.equal(sha(restored), walletCacheDelta.beforeSHA256, 'All BASE HTML bytes restored');
  const forward = restored.replace(walletCacheDelta.beforeTag, walletCacheDelta.afterTag);
  assert.equal(sha(forward), walletCacheDelta.afterSHA256, 'Only the pinned wallet tag can advance');
  if (!legacy) assert.equal(forward, html, 'Full-byte wallet cache roundtrip');
  return restored;
}

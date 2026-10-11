import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutWalletCacheDelta, walletCacheDelta } from './support/mypage-wallet-cache-inverse-20261011.mjs';

const expected = {
  scope: 'mypage-wallet-cache-exact1-only',
  baseCommit: '98f797f6c280f17ae4a567387cfb814ec0b36735',
  currentCommit: '581b42c714cbb11c1bd0cc45ee98b9f4dd216c7b',
  beforeSHA256: '338c23082536d6a58d8c8ce4340b43d8498073bfd36a21c0783a9b7fe6cbe4c7',
  afterSHA256: '16abb7dfd8486bf53ed2b6f53b33a83437fdb7094052b1d5b18bd78e8681d03c',
  beforeTag: '<script src="/app.js"></script>',
  afterTag: '<script src="/app.js?v=wallet-session-20261011"></script>',
  lineEndings: 'CRLF-to-LF-only',
};
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const rawHtml = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const lfHtml = rawHtml.replaceAll('\r\n', '\n');
assert([expected.beforeSHA256, expected.afterSHA256].includes(sha(lfHtml)), 'Pinned current or BASE fixture only');
const legacy = sha(lfHtml) === expected.beforeSHA256 ? lfHtml : lfHtml.replace(expected.afterTag, expected.beforeTag);
const current = legacy.replace(expected.beforeTag, expected.afterTag);
assert.equal(sha(legacy), expected.beforeSHA256);
assert.equal(sha(current), expected.afterSHA256);

test('wallet cache metadata binds immutable581 current and98f legacy whole HTML pins', () => {
  assert.deepEqual(walletCacheDelta, expected);
  assert(Object.isFrozen(walletCacheDelta));
  assert.equal(current.split(expected.afterTag).length - 1, 1);
  assert.equal(current.split(expected.beforeTag).length - 1, 0);
  assert.equal(legacy.split(expected.beforeTag).length - 1, 1);
  assert.equal(legacy.split(expected.afterTag).length - 1, 0);
});

test('exact current wallet tag inverse restores every historical whole HTML byte', () => {
  const restored = htmlWithoutWalletCacheDelta(current);
  assert.equal(restored, legacy);
  assert.equal(sha(restored), expected.beforeSHA256);
  assert.equal(restored.replace(expected.beforeTag, expected.afterTag), current);
});

test('wallet cache inverse is idempotent only for the full pinned legacy source', () => {
  assert.equal(htmlWithoutWalletCacheDelta(legacy), legacy);
  assert.equal(htmlWithoutWalletCacheDelta(htmlWithoutWalletCacheDelta(current)), legacy);
  assert.throws(() => htmlWithoutWalletCacheDelta(expected.beforeTag));
  assert.throws(() => htmlWithoutWalletCacheDelta(legacy + '\n<!-- synthetic unrelated -->'));
});

test('wallet cache inverse rejects missing duplicated and mixed app tags', () => {
  for (const changed of [
    current.replace(expected.afterTag, ''),
    current.replace(expected.afterTag, expected.afterTag + expected.afterTag),
    current.replace(expected.afterTag, expected.afterTag + expected.beforeTag),
    legacy.replace(expected.beforeTag, ''),
    legacy.replace(expected.beforeTag, expected.beforeTag + expected.beforeTag),
  ]) assert.throws(() => htmlWithoutWalletCacheDelta(changed));
});

test('wallet cache inverse cannot strip unknown queries or exempt altered script attributes', () => {
  for (const tag of [
    '<script src="/app.js?v=wallet-session-20261012"></script>',
    '<script src="/app.js?v=wallet-session-20261011&extra=1"></script>',
    '<script src="/app.js?unknown=1"></script>',
    '<script defer src="/app.js?v=wallet-session-20261011"></script>',
  ]) assert.throws(() => htmlWithoutWalletCacheDelta(current.replace(expected.afterTag, tag)));
});

test('wallet cache inverse rejects unrelated HTML and protected-method changes even with one exact tag', () => {
  for (const value of [current, legacy]) {
    assert(value.includes('async function claimActivationReward'));
    const changed = value.replace('async function claimActivationReward', 'async function syntheticChangedClaim');
    assert.notEqual(changed, value);
    assert.throws(() => htmlWithoutWalletCacheDelta(changed));
    assert.throws(() => htmlWithoutWalletCacheDelta(value + '\n<!-- synthetic unrelated -->'));
  }
});

test('wallet cache inverse preserves only the historical CRLF-to-LF handling', () => {
  for (const value of [current, legacy]) {
    assert.equal(htmlWithoutWalletCacheDelta(value.replaceAll('\n', '\r\n')), legacy);
    assert.throws(() => htmlWithoutWalletCacheDelta(value + '\r'));
    assert.throws(() => htmlWithoutWalletCacheDelta(value.replaceAll('\n', '\r\n') + '<!-- synthetic unrelated -->'));
  }
});

test('wallet cache inverse rejects changed missing extra metadata and non-text input', () => {
  for (const key of Object.keys(expected)) {
    const changed = { ...expected, [key]: 'synthetic-change' }, missing = { ...expected };
    delete missing[key];
    for (const value of [current, legacy]) {
      assert.throws(() => htmlWithoutWalletCacheDelta(value, changed));
      assert.throws(() => htmlWithoutWalletCacheDelta(value, missing));
    }
  }
  assert.throws(() => htmlWithoutWalletCacheDelta(current, { ...expected, extra: 'synthetic' }));
  for (const value of [null, undefined, 123, {}]) assert.throws(() => htmlWithoutWalletCacheDelta(value));
});

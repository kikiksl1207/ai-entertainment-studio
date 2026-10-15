import { htmlWithoutMypageTitlePageLifetimeDelta } from './support/mypage-title-page-lifetime-inverse-20261015.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutWalletConfirmationDelta, walletConfirmationDelta } from './support/mypage-wallet-confirmation-inverse-20261013.mjs';
import { htmlWithoutWalletCacheDelta, walletCacheDelta } from './support/mypage-wallet-cache-inverse-20261011.mjs';

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const after = htmlWithoutMypageTitlePageLifetimeDelta(readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
assert.equal(sha(after), '8a5220be9ae3006cf30222e0dadeeb6f9c1afe08423cb40b28ca6a786a256e27',
  'Use the exact Git-derived candidate, not dirty CLEAN HTML');
const before = htmlWithoutWalletConfirmationDelta(after);
const legacy = before.replace(walletCacheDelta.afterTag, walletCacheDelta.beforeTag);

test('wallet confirmation inverse binds the exact frozen Git candidate and both historical HTML pins', () => {
  assert(Object.isFrozen(walletConfirmationDelta));
  assert.equal(walletConfirmationDelta.scope, 'mypage-wallet-confirmation-exact-block-only');
  assert.equal(walletConfirmationDelta.baseCommit, '772d6bfc0ab7c9fb884e4c0d48b725256eb4d3dc');
  assert.equal(walletConfirmationDelta.beforeSHA256, walletCacheDelta.afterSHA256);
  assert.equal(walletConfirmationDelta.legacySHA256, walletCacheDelta.beforeSHA256);
  assert.equal(walletConfirmationDelta.afterSHA256, sha(after));
  assert.equal(sha(walletConfirmationDelta.beforeBlock), walletConfirmationDelta.beforeBlockSHA256);
  assert.equal(sha(walletConfirmationDelta.afterBlock), walletConfirmationDelta.afterBlockSHA256);
  assert.equal(walletConfirmationDelta.lineEndings, 'CRLF-to-LF-only');
});

test('wallet confirmation inverse restores every prior byte and preserves exact forward reconstruction', () => {
  assert.equal(sha(before), '16abb7dfd8486bf53ed2b6f53b33a83437fdb7094052b1d5b18bd78e8681d03c');
  assert.equal(before.replace(walletConfirmationDelta.beforeBlock, walletConfirmationDelta.afterBlock), after);
  assert.equal(htmlWithoutWalletConfirmationDelta(before), before);
  assert.equal(htmlWithoutWalletConfirmationDelta(legacy), legacy);
  assert.equal(sha(legacy), '338c23082536d6a58d8c8ce4340b43d8498073bfd36a21c0783a9b7fe6cbe4c7');
  assert.equal(htmlWithoutWalletCacheDelta(after), legacy);
  assert.equal(htmlWithoutWalletCacheDelta(before), legacy);
  assert.equal(htmlWithoutWalletCacheDelta(legacy), legacy);
});

test('wallet confirmation inverse rejects missing duplicated mixed and malformed wallet blocks', () => {
  for (const changed of [
    after.replace(walletConfirmationDelta.afterBlock, ''),
    after.replace(walletConfirmationDelta.afterBlock, walletConfirmationDelta.afterBlock.repeat(2)),
    after.replace(walletConfirmationDelta.afterBlock, walletConfirmationDelta.beforeBlock + walletConfirmationDelta.afterBlock),
    after.replace('return Number.isFinite(value) ? value : null;', 'return value || 0;'),
    after.replace('luminaBalance === null ? "--"', 'luminaBalance === null ? "0"'),
    before.replace(walletConfirmationDelta.beforeBlock, walletConfirmationDelta.beforeBlock.repeat(2)),
  ]) {
    assert.notEqual(changed, after);
    assert.throws(() => htmlWithoutWalletConfirmationDelta(changed));
  }
});

test('wallet confirmation inverse rejects unknown whole sources and the dirty unversioned candidate', () => {
  const dirtyCandidate = after.replace(walletCacheDelta.afterTag, walletCacheDelta.beforeTag);
  assert.equal(sha(dirtyCandidate), '81d68167c2c21dd24a960f46e9c39f457131a65fb98374414f9d3516c16a1e54');
  for (const changed of [
    dirtyCandidate,
    after + '\n',
    before + '\n<!-- synthetic unrelated -->',
    legacy + '\n<!-- synthetic unrelated -->',
    after.replace(walletCacheDelta.afterTag, '<script src="/app.js?v=unapproved"></script>'),
    after.replace(walletCacheDelta.afterTag, walletCacheDelta.afterTag + walletCacheDelta.beforeTag),
  ]) assert.throws(() => htmlWithoutWalletConfirmationDelta(changed));
});

test('wallet confirmation inverse rejects adjacent formatting and protected method or event changes', () => {
  for (const [from, to] of [
    ['          renderList(\n', '           renderList(\n'],
    ['async function claimActivationReward', 'async function syntheticChangedClaim'],
    ['loadMypageSummary.currentRead = read;', 'loadMypageSummary.currentRead = null;'],
    ['window.refreshMypageInlineData = refreshMypageInlineData;', 'window.refreshMypageInlineData = null;'],
    ['bindMypageActions();', 'syntheticChangedActions();'],
  ]) {
    assert(after.includes(from), 'Mutation anchor exists');
    const changed = after.replace(from, to);
    assert.notEqual(changed, after);
    assert.throws(() => htmlWithoutWalletConfirmationDelta(changed));
    assert.throws(() => htmlWithoutWalletCacheDelta(changed));
  }
});

test('wallet confirmation inverse preserves only historical CRLF normalization', () => {
  for (const value of [after, before, legacy]) {
    const expected = value === after ? before : value;
    assert.equal(htmlWithoutWalletConfirmationDelta(value.replaceAll('\n', '\r\n')), expected);
    assert.throws(() => htmlWithoutWalletConfirmationDelta(value + '\r'));
    assert.throws(() => htmlWithoutWalletConfirmationDelta('\uFEFF' + value));
  }
});

test('wallet confirmation inverse keeps metadata frozen and rejects changed missing or extra fields', () => {
  for (const key of Object.keys(walletConfirmationDelta)) {
    const changed = { ...walletConfirmationDelta, [key]: 'synthetic-change' };
    const missing = { ...walletConfirmationDelta };
    delete missing[key];
    for (const value of [after, before, legacy]) {
      assert.throws(() => htmlWithoutWalletConfirmationDelta(value, changed));
      assert.throws(() => htmlWithoutWalletConfirmationDelta(value, missing));
    }
  }
  assert.throws(() => htmlWithoutWalletConfirmationDelta(after, { ...walletConfirmationDelta, extra: true }));
  assert.throws(() => { walletConfirmationDelta.afterSHA256 = 'synthetic-change'; });
  assert.equal(walletConfirmationDelta.afterSHA256, sha(after));
});

test('wallet confirmation inverse rejects non-text input without changing historical cache metadata', () => {
  const cacheMetadata = { ...walletCacheDelta };
  for (const value of [null, undefined, 0, true, {}, [], Buffer.from(after)]) {
    assert.throws(() => htmlWithoutWalletConfirmationDelta(value));
  }
  assert.deepEqual(walletCacheDelta, cacheMetadata);
  assert(Object.isFrozen(walletCacheDelta));
  assert.equal(htmlWithoutWalletCacheDelta(legacy), legacy);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const beforeBlock = [
  '          setText("mypageLuminaBalance", fmt(wallet.lumina?.balance ?? wallet.cachedBalance));',
  '          setText("mypageStellaBalance", fmt(wallet.stella?.displayAmount ?? 0));',
  '          setText("mypageWalletStatus", wallet.lumina ? "현재 사용할 수 있는 잔액입니다." : "잔액 정보를 확인하지 못했습니다.");',
].join('\n') + '\n';
const afterBlock = [
  '          const confirmedWalletAmount = raw => {',
  '            const decimal = typeof raw === "string" ? raw.trim() : null;',
  '            const value = typeof raw === "number" ? raw',
  '              : decimal !== null && /^-?\\d+(?:\\.\\d+)?$/.test(decimal) ? Number(decimal) : NaN;',
  '            return Number.isFinite(value) ? value : null;',
  '          };',
  '          const luminaBalance = confirmedWalletAmount(wallet.lumina?.balance ?? wallet.cachedBalance);',
  '          const stellaBalance = confirmedWalletAmount(wallet.stella?.displayAmount);',
  '          setText("mypageLuminaBalance", luminaBalance === null ? "--" : fmt(luminaBalance));',
  '          setText("mypageStellaBalance", stellaBalance === null ? "--" : fmt(stellaBalance));',
  '          setText("mypageWalletStatus", luminaBalance !== null ? "현재 사용할 수 있는 잔액입니다." : "잔액 정보를 확인하지 못했습니다.");',
].join('\n') + '\n';

export const walletConfirmationDelta = Object.freeze({
  scope: 'mypage-wallet-confirmation-exact-block-only',
  baseCommit: '772d6bfc0ab7c9fb884e4c0d48b725256eb4d3dc',
  beforeSHA256: '16abb7dfd8486bf53ed2b6f53b33a83437fdb7094052b1d5b18bd78e8681d03c',
  legacySHA256: '338c23082536d6a58d8c8ce4340b43d8498073bfd36a21c0783a9b7fe6cbe4c7',
  afterSHA256: '8a5220be9ae3006cf30222e0dadeeb6f9c1afe08423cb40b28ca6a786a256e27',
  beforeBlockSHA256: '73a7fe64c1696f8312ce673186f254488bcb7f0c37465dd6e32af28c4ee05302',
  afterBlockSHA256: '201bbb6557647e843f13ec8486dd43c2d8f8b575c34d55a1a003a0d43dbd040f',
  beforeBlock,
  afterBlock,
  lineEndings: 'CRLF-to-LF-only',
});

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const occurrences = (value, block) => value.split(block).length - 1;

export function htmlWithoutWalletConfirmationDelta(value, delta = walletConfirmationDelta) {
  assert.equal(typeof value, 'string', 'HTML must be source text');
  assert.deepEqual(delta, walletConfirmationDelta, 'Exact wallet confirmation inverse metadata');
  const html = value.replaceAll('\r\n', '\n');
  const digest = sha(html);
  const legacy = digest === delta.legacySHA256;
  const before = digest === delta.beforeSHA256;
  const after = digest === delta.afterSHA256;
  assert(legacy || before || after, 'Exact whole wallet confirmation HTML source');
  assert.equal(sha(delta.beforeBlock), delta.beforeBlockSHA256, 'Exact previous wallet block');
  assert.equal(sha(delta.afterBlock), delta.afterBlockSHA256, 'Exact confirmed wallet block');
  assert.equal(occurrences(html, delta.beforeBlock), after ? 0 : 1, 'Previous block occurs exactly');
  assert.equal(occurrences(html, delta.afterBlock), after ? 1 : 0, 'Confirmed block occurs exactly');
  const restored = after ? html.replace(delta.afterBlock, delta.beforeBlock) : html;
  assert.equal(sha(restored), legacy ? delta.legacySHA256 : delta.beforeSHA256,
    'Every byte outside the wallet block is preserved');
  if (!legacy) {
    const forward = restored.replace(delta.beforeBlock, delta.afterBlock);
    assert.equal(sha(forward), delta.afterSHA256, 'Only the pinned wallet block can advance');
    if (after) assert.equal(forward, html, 'Whole HTML wallet confirmation roundtrip');
  }
  return restored;
}

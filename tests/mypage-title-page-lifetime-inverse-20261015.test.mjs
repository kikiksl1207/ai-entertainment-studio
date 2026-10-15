import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutMypageTitlePageLifetimeDelta } from './support/mypage-title-page-lifetime-inverse-20261015.mjs';

const current = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const after = current.replace(/\r\n/g, '\n');
const beforeTag = '<script src="/pages/mypage-titles.js"></script>';
const afterTag = '<script src="/pages/mypage-titles.js?v=mypage-title-pagehide-20261015"></script>';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

test('mypage title lifetime inverse 01 preserves full LF and CRLF HTML', () => {
  assert.equal(sha(after), '5327cb32e959c767791d60466095fa69b01cc5b91fd5f6de2478b50f561a3523');
  for (const value of [after, after.replace(/\n/g, '\r\n')]) {
    const restored = htmlWithoutMypageTitlePageLifetimeDelta(value);
    assert.equal(restored, value.replace(afterTag, beforeTag));
    assert.equal(restored.replace(beforeTag, afterTag), value);
    assert.equal(sha(restored.replace(/\r\n/g, '\n')), '8a5220be9ae3006cf30222e0dadeeb6f9c1afe08423cb40b28ca6a786a256e27');
  }
});

test('mypage title lifetime inverse 02 rejects missing duplicate legacy and wrong tags', () => {
  for (const value of [
    after.replace(afterTag, ''),
    after.replace(afterTag, afterTag + afterTag),
    after.replace(afterTag, beforeTag),
    after + beforeTag,
    after.replace(afterTag, '<script src="/pages/mypage-titles.js?v=unapproved"></script>'),
    after + '<script src="/pages/mypage-titles.js?v=unapproved"></script>',
    after.replace(afterTag, '<script src="/pages/mypage-titles.js?v=mypage-title-pagehide-20261015&extra=1"></script>'),
  ]) assert.throws(() => htmlWithoutMypageTitlePageLifetimeDelta(value));
});

test('mypage title lifetime inverse 03 rejects adjacent bytes and nonuniform decoding changes', () => {
  const walletTag = '<script src="/app.js?v=wallet-session-20261011"></script>';
  assert.equal(after.split(walletTag).length - 1, 1);
  for (const value of [
    ' ' + after, after + ' ',
    after.replace(afterTag, afterTag + '\n'),
    after.replace(walletTag, '<script src="/app.js?v=unapproved"></script>'),
    after.replace('<html', '<html '),
    '\ufeff' + after,
    after.replace('\n', '\r'),
    after.replace('\n', '\r\n'),
  ]) assert.throws(() => htmlWithoutMypageTitlePageLifetimeDelta(value));
});

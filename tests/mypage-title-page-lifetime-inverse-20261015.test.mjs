import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutMypageTitlePageLifetimeDelta, htmlWithoutMypageTitleLocaleDelta } from './support/mypage-title-page-lifetime-inverse-20261015.mjs';

const current = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const after = htmlWithoutMypageTitleLocaleDelta(current).replace(/\r\n/g, '\n');
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

test('mypage title locale inverse 04 retains full previous source and rejects tampering before canonicalization', () => {
  const nextTag = '<script src="/pages/mypage-titles.js?v=mypage-title-locale-20261018"></script>';
  const next = current.replace(/\r\n/g, '\n');
  assert.equal(sha(next), 'ebf2e0531895977c9b6345a2c296fbfec7d749f26761b96e0f803a0c392841d3');
  for (const value of [next, next.replace(/\n/g, '\r\n')]) {
    const restored = htmlWithoutMypageTitleLocaleDelta(value);
    assert.equal(restored, value.replace(nextTag, afterTag));
    assert.equal(sha(restored.replace(/\r\n/g, '\n')), '5327cb32e959c767791d60466095fa69b01cc5b91fd5f6de2478b50f561a3523');
    assert.equal(htmlWithoutMypageTitleLocaleDelta(restored), restored);
    assert.equal(htmlWithoutMypageTitlePageLifetimeDelta(value), restored.replace(afterTag, beforeTag));
  }
  for (const value of [
    ' ' + next, next + ' ', '\ufeff' + next, next.replace('\n', '\r'), next.replace('\n', '\r\n'),
    next.replace(nextTag, ''), next.replace(nextTag, nextTag + nextTag), next + beforeTag,
    next.replace(nextTag, nextTag.replace('20261018', 'unapproved')),
    next.replace(nextTag, nextTag.replace('.js?v=', '.js?extra=1&v=')),
    next.replace('<html', '<html '),
  ]) assert.throws(() => htmlWithoutMypageTitleLocaleDelta(value));
});

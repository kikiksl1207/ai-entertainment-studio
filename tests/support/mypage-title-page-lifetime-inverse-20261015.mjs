import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const beforeTag = '<script src="/pages/mypage-titles.js"></script>';
const afterTag = '<script src="/pages/mypage-titles.js?v=mypage-title-pagehide-20261015"></script>';
const beforeSHA = '8a5220be9ae3006cf30222e0dadeeb6f9c1afe08423cb40b28ca6a786a256e27';
const afterSHA = '5327cb32e959c767791d60466095fa69b01cc5b91fd5f6de2478b50f561a3523';
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');

const localeTag = '<script src="/pages/mypage-titles.js?v=mypage-title-locale-20261018"></script>';
const localeSHA = 'ebf2e0531895977c9b6345a2c296fbfec7d749f26761b96e0f803a0c392841d3';

export function htmlWithoutMypageTitleLocaleDelta(value) {
  assert.equal(typeof value, 'string', 'HTML must be source text');
  assert(!value.startsWith('\ufeff'), 'No HTML BOM substitution');
  assert(!/\r(?!\n)/.test(value), 'No lone CR substitution');
  assert(!(value.includes('\r\n') && /(?<!\r)\n/.test(value)), 'Uniform LF or CRLF only');
  const hash = sha(value.replace(/\r\n/g, '\n'));
  if (hash === afterSHA) return value;
  assert.equal(hash, localeSHA, 'Exact whole locale lifetime HTML');
  assert.equal(value.split(localeTag).length - 1, 1, 'Exactly one locale lifetime tag');
  const scripts = [...value.matchAll(/<script\b[^>]*\ssrc=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
    .map(match => match[1] ?? match[2]);
  assert.deepEqual(scripts.filter(src => src.split(/[?#]/)[0] === '/pages/mypage-titles.js'),
    ['/pages/mypage-titles.js?v=mypage-title-locale-20261018']);
  const restored = value.replace(localeTag, afterTag);
  assert.equal(sha(restored.replace(/\r\n/g, '\n')), afterSHA, 'Every previous HTML byte restored');
  assert.equal(restored.replace(afterTag, localeTag), value, 'Only the exact locale tag can advance');
  return restored;
}

export function htmlWithoutMypageTitlePageLifetimeDelta(value) {
  assert.equal(typeof value, 'string', 'HTML must be source text');
  value = htmlWithoutMypageTitleLocaleDelta(value);
  assert(!value.startsWith('\ufeff'), 'No HTML BOM substitution');
  assert(!/\r(?!\n)/.test(value), 'No lone CR substitution');
  assert(!(value.includes('\r\n') && /(?<!\r)\n/.test(value)), 'Uniform LF or CRLF only');
  assert.equal(value.split(afterTag).length - 1, 1, 'Exactly one approved title lifetime tag');
  assert.equal(value.split(beforeTag).length - 1, 0, 'No previous title script tag');
  const scripts = [...value.matchAll(/<script\b[^>]*\ssrc=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)]
    .map(match => match[1] ?? match[2]);
  assert.deepEqual(scripts.filter(src => src.split(/[?#]/)[0] === '/pages/mypage-titles.js'),
    ['/pages/mypage-titles.js?v=mypage-title-pagehide-20261015'], 'Only the exact approved title script source');
  assert.equal(sha(value.replace(/\r\n/g, '\n')), afterSHA, 'Exact whole title lifetime HTML');
  const restored = value.replace(afterTag, beforeTag);
  assert.equal(sha(restored.replace(/\r\n/g, '\n')), beforeSHA, 'Every original HTML byte restored');
  assert.equal(restored.replace(beforeTag, afterTag), value, 'Only the exact title tag can advance');
  return restored;
}

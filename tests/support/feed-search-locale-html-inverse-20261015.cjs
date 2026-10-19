'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { restoreOwnedFeedLikeAppHtml } = require('./feed-like-app-html-inverse-20261019.cjs');
const { TextDecoder } = require('node:util');
const before = '<script src="/pages/lumina-feed.js?v=feed-search-owner-20261009-deadline-20261011"></script>';
const after = '<script src="/pages/lumina-feed.js?v=feed-search-locale-20261015"></script>';
const pins = {
  "current": [
    [
      "d778963f9f2fd7b9f410472ca434ba9a3bdf0b1e6c8c989b997599d5767a8d15",
      "b1ff4c312396da36f63f9d38157332e0fc37995f"
    ],
    [
      "cb8c3607863b8b1b7e7da48432a7fbf0aa2a9cf2d100bba0f378a04e972fee61",
      "0d67f642c7d4cfdda4b0f338a93ebb3b5e5bcf42"
    ]
  ],
  "previous": [
    [
      "d96758293441989728c303b98280e502cbf43a62d458049c7bb4acd9c721753b",
      "c40eecdf38f35093c4b54c49f1b00080f451e3e4"
    ],
    [
      "5b2a9db0750784378edf7b112b6ceda1eb7016ca77e0c8375e052a83ae3766fd",
      "7b55d605fe648369c20c9376573738bf1fded61d"
    ]
  ]
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
function admitted(text, pairs) {
  const bytes = Buffer.from(text, 'utf8');
  assert.equal(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), text);
  assert(pairs.some(pair => sha(bytes) === pair[0] && blob(bytes) === pair[1]), 'Exact whole HTML SHA/blob pair required');
}
function restoreOwnedRepostAccountScriptCacheDelta(source) {
  source = restoreOwnedFeedLikeAppHtml(source);
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const expectedSha = '4e0b216c07b2cb1ee64d19050295b23cb546e27c9b7b3bea79872778b9a9c7d1';
  const expectedBlob = 'b6f6b0841c9a440e4e00ab9eb0113992165cf112';
  if (actualSha !== expectedSha && actualBlob !== expectedBlob) return source;
  assert(bytes.length === 24673 && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole repost cache HTML SHA/blob/length required');
  const previous = "<script src=\"/pages/lumina-feed.js?v=feed-search-locale-20261015&amp;content=29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4\"></script>";
  const current = "<script src=\"/pages/lumina-feed.js?v=feed-search-locale-20261015&amp;content=4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b\"></script>";
  assert.equal(lf.split(current).length, 2, 'One exact repost script cache reference');
  const restored = lf.replace(current, previous), previousBytes = Buffer.from(restored, 'utf8');
  assert.equal(previousBytes.length, 24673);
  assert.equal(sha(previousBytes), '7e6144f2043acc1cc2031a5f5b5612dc64b1b58806f2d5925bb70040fba9d405');
  assert.equal(blob(previousBytes), '9ff46d03b968eab40285119dad17b7b0f55fd847');
  assert.equal(restored.split(previous).length, 2, 'One exact previous repost script reference');
  assert.equal(restored.replace(previous, current), lf, 'Exact whole repost script cache forward');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function restoreOwnedRepostScriptCacheDelta(source) {
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const expectedSha = '7e6144f2043acc1cc2031a5f5b5612dc64b1b58806f2d5925bb70040fba9d405';
  const expectedBlob = '9ff46d03b968eab40285119dad17b7b0f55fd847';
  if (actualSha !== expectedSha && actualBlob !== expectedBlob) return source;
  assert(bytes.length === 24673 && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole repost cache HTML SHA/blob/length required');
  const previous = '<script src="/pages/lumina-feed.js?v=feed-search-locale-20261015"></script>';
  const current = '<script src="/pages/lumina-feed.js?v=feed-search-locale-20261015&amp;content=29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4"></script>';
  assert.equal(lf.split(current).length, 2, 'One exact repost script cache reference');
  const restored = lf.replace(current, previous), previousBytes = Buffer.from(restored, 'utf8');
  assert.equal(previousBytes.length, 24596);
  assert.equal(sha(previousBytes), 'b7f9df9c6458efd8576025593b7d0e3048585d505ae6ab508409ab81a19316e2');
  assert.equal(blob(previousBytes), '4260a18e51005d7d8e0b5bb54bc9a0853d8a60c7');
  assert.equal(restored.split(previous).length, 2, 'One exact previous repost script reference');
  assert.equal(restored.replace(previous, current), lf, 'Exact whole repost script cache forward');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function htmlWithoutNaverStateAppCacheDelta(source) {
  if (typeof source !== 'string') throw new TypeError('NAVER_STATE_APP_CACHE_HTML_INVERSE_STRING_REQUIRED');
  source = restoreOwnedRepostScriptCacheDelta(restoreOwnedRepostAccountScriptCacheDelta(source));
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const versions = [
    [20210, 'caa90c20868dea871745f39b1d8566b68b3793513ffb284fe189caf235b745e1',
      '8fa6079ec48784acd7388a93885a7c659e557ec6',
      '181a76ea6609ed8525f75afab603262aa7b579d91c9050dc65f74e800c309985',
      '9f08efb86b56858f2e5f11d31d9a177053b7c27c',
      '1722e0229ac0706970d088eab353ec80b1a728a570381d3b82ebd4c510bb1418'],
    [62703, '41e6fe88a9b71a6ef71f62b204f4c8acbd703927b4301662191e98a53df60303',
      '739c14a5a1f296d51f66546f072d7ae8d77b1464',
      '592d4c36d3f7503759d1c3e910c00054efb9027461f5e61ff9f7e0c0db34277a',
      '3dff6c8877d3f45acb9b67a5d39bbde69d93db39',
      '1722e0229ac0706970d088eab353ec80b1a728a570381d3b82ebd4c510bb1418'],
    [24596, '454ea75b588a9ac0db0e05915c2601c03a5db1474700a4c6e2cb7be3bf1b5aca',
      'bb542016a15606c915db759ed1a2adf79bfdc0b0',
      '317cf9442fd863604568e361ab836313130dc94fe79465209dd152c9ab764536',
      '9e3bf9ee1dc29207b97e500b8d17cecbe57e3d53',
      '1722e0229ac0706970d088eab353ec80b1a728a570381d3b82ebd4c510bb1418'],
    [20210, 'e4e18d9bae9d2c9add41424efb1423df8ba6dd490423fa7168dd62dd96f1864d',
      'aa9fdc099927df4385f5119a527b7afcbf15fe51',
      '181a76ea6609ed8525f75afab603262aa7b579d91c9050dc65f74e800c309985',
      '9f08efb86b56858f2e5f11d31d9a177053b7c27c',
      '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61'],
    [62703, '07811e59dacfd174647bc4beedbc91aec27536690db2649485067547647889c9',
      '6a73fc57691fb11691009cf459da3b669b86519b',
      '592d4c36d3f7503759d1c3e910c00054efb9027461f5e61ff9f7e0c0db34277a',
      '3dff6c8877d3f45acb9b67a5d39bbde69d93db39',
      '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61'],
    [24596, 'b7f9df9c6458efd8576025593b7d0e3048585d505ae6ab508409ab81a19316e2',
      '4260a18e51005d7d8e0b5bb54bc9a0853d8a60c7',
      '317cf9442fd863604568e361ab836313130dc94fe79465209dd152c9ab764536',
      '9e3bf9ee1dc29207b97e500b8d17cecbe57e3d53',
      '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61'],
  ];
  const row = versions.find(item => actualSha === item[1] || actualBlob === item[2]);
  if (!row) return source;
  const [expectedBytes, expectedSha, expectedBlob, previousSha, previousBlob, appSha] = row;
  assert(bytes.length === expectedBytes && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole Naver state app cache HTML SHA/blob/length required');
  const appUrl = '/app.js?v=wallet-session-20261011&amp;content=';
  const current = appUrl + appSha;
  const previous = appUrl + '6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c';
  assert.equal(lf.split(current).length, 2, 'One exact Naver state app cache reference');
  const restored = lf.replace(current, previous), beforeBytes = Buffer.from(restored, 'utf8');
  assert.equal(beforeBytes.length, expectedBytes);
  assert.equal(sha(beforeBytes), previousSha);
  assert.equal(blob(beforeBytes), previousBlob);
  assert.equal(restored.split(previous).length, 2, 'One exact prior app cache reference');
  assert.equal(restored.replace(previous, current) === lf, true, 'Exact whole Naver state cache forward');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function htmlWithoutFeedLightboxCacheDelta(text) {
  if (typeof text !== 'string') throw new TypeError('FEED_LIGHTBOX_HTML_INVERSE_STRING_REQUIRED');
  const originalText = text;
  text = htmlWithoutNaverStateAppCacheDelta(text);
  const lf = text.replace(/\r\n/g, '\n'), crlf = text.includes('\r\n');
  if (text.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && text !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return text;
  const bytes = Buffer.from(lf, 'utf8'), actualSha = sha(bytes), actualBlob = blob(bytes);
  const versions = [
    ['317cf9442fd863604568e361ab836313130dc94fe79465209dd152c9ab764536',
      '9e3bf9ee1dc29207b97e500b8d17cecbe57e3d53',
      '6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c'],
    ['f17604dabc043c07f1f382da2dfc510683bba3fa69bbb9074256418886b683c9',
      'a4893cd696951c2a179a076f7a98c0d3d2ee160e',
      '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b'],
    ['6d49aeef9179be2dc843eb2ec83506a327379f5a0017b1aaa72a15283f701914',
      '256f05c5c8bd93ac47fb3246dfa18ce00b6f27ef',
      'ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d'],
    ['694c46006a8f8892aae7a57dd9c403c3034e3b22d67d9aba7d65bc14949bb2ee',
      'ae1f703f8eb1041a71c730def16c518b726da37b',
      '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d'],
  ];
  const admittedVersion = versions.find(row => actualSha === row[0] || actualBlob === row[1]);
  if (!admittedVersion) return originalText;
  const [expectedSha, expectedBlob, appSha] = admittedVersion;
  assert(bytes.length === 24596 && actualSha === expectedSha && actualBlob === expectedBlob,
    'Exact whole lightbox cache HTML SHA/blob/length required');
  const previous = '/app.js?v=wallet-session-20261011';
  const current = previous + '&amp;content=' + appSha;
  assert.equal(lf.split(current).length, 2, 'One exact lightbox app cache reference');
  const restored = lf.replace(current, previous), beforeBytes = Buffer.from(restored);
  assert.equal(beforeBytes.length, 24519);
  assert.equal(sha(beforeBytes), 'd778963f9f2fd7b9f410472ca434ba9a3bdf0b1e6c8c989b997599d5767a8d15');
  assert.equal(blob(beforeBytes), 'b1ff4c312396da36f63f9d38157332e0fc37995f');
  assert.equal(restored.split(previous).length, 2);
  assert.equal(restored.replace(previous, current), lf, 'Only the exact app cache reference changes');
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function htmlWithoutFeedSearchLocaleDelta(text) {
  assert.equal(typeof text, 'string');
  assert(!text.startsWith('\ufeff') && !/\r(?!\n)/.test(text), 'No BOM or lone CR');
  assert(!(text.includes('\r\n') && /(?<!\r)\n/.test(text)), 'Uniform LF or CRLF only');
  text = htmlWithoutFeedLightboxCacheDelta(text);
  admitted(text, pins.current);
  assert.equal(text.split(after).length - 1, 1, 'One approved current feed script tag');
  assert.equal(text.split(before).length - 1, 0, 'No old feed script tag');
  const restored = text.replace(after, before);
  admitted(restored, pins.previous);
  assert.equal(restored.replace(before, after), text, 'Only the exact cache tag can advance');
  assert.equal(restored.includes('\r\n'), text.includes('\r\n'), 'Preserve the original uniform line-ending form');
  return restored;
}
module.exports = Object.freeze({ htmlWithoutNaverStateAppCacheDelta, htmlWithoutFeedLightboxCacheDelta, htmlWithoutFeedSearchLocaleDelta });

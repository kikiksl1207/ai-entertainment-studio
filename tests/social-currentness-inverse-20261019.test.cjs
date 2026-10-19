'use strict';
const { before, test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { TextDecoder } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const APP = Object.freeze({ bytes: 433255,
  sha256: '6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c',
  blob: 'b9985ba4b0121dfc48792ff908c02b7b91e0f5a8' });
const PRIOR = Object.freeze({ bytes: 432976,
  sha256: '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d',
  blob: '609d8253eebaa968b9654e4d961f197a20a8ba6e' });
const FEED = Object.freeze({ bytes: 24596,
  sha256: '317cf9442fd863604568e361ab836313130dc94fe79465209dd152c9ab764536',
  blob: '9e3bf9ee1dc29207b97e500b8d17cecbe57e3d53' });
const FEED_PRIOR = Object.freeze({ bytes: 24519,
  sha256: 'd778963f9f2fd7b9f410472ca434ba9a3bdf0b1e6c8c989b997599d5767a8d15',
  blob: 'b1ff4c312396da36f63f9d38157332e0fc37995f' });
const SPANS = Object.freeze([
  ['  const session = authRequestSession();\n  try {\n    console.info("[Lumina] Kakao code \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911");',
    '  try {\n    console.info("[Lumina] Kakao code \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911");'],
  ['  const session = authRequestSession();\n  try {\n    console.info("[Lumina] Naver access token \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911");',
    '  try {\n    console.info("[Lumina] Naver access token \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911");'],
  ['    console.error("[Lumina] Google access_token \ub204\ub77d");\n    return;\n  }\n  const session = authRequestSession();\n  try {',
    '    console.error("[Lumina] Google access_token \ub204\ub77d");\n    return;\n  }\n  try {'],
  ['    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, "Kakao");',
    '    applyAuthResponse(data, "Kakao");'],
  ['    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, "Naver");',
    '    applyAuthResponse(data, "Naver");'],
  ['    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, "Google");',
    '    applyAuthResponse(data, "Google");'],
].map(row => Object.freeze(row)));
const CHAIN = Object.freeze([
  ['restoreOwnedFeedLightboxLanguagesDelta', 432500,
    'ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d', 'f18ceafed7678b5d42878e086cecd5e4ca096ac8'],
  ['restoreOwnedFeedLightboxFocusDelta', 431019,
    '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b', '45c8bc57f852130d8668d542aefdb7ad47aec5d8'],
  ['restoreOwnedFeedLightboxLifetimeDelta', 430667,
    'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2', '8c9aba0a3cd35b11a676ee123d83f3f4fa84779e'],
  ['restoreOwnedAuthEntryHardeningDelta', 430404,
    '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028', '4e9e2f1861574d25bf6b7bfd9d61a1bd9966adb3'],
  ['restoreOwnedBootstrapDelta', 430162,
    '7ee22fe15e52d715473fe8b0f26b344d3f66377a0827854bab2f80dd83463d36', '4cf6cb0e00ef0ceb4c7276e56e5d8e4bbda24195'],
  ['restoreOwnedLoginDelta', 429783,
    '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87', '7c3a65b55c3e2f12623d3f782663c2e2233243a5'],
].map(row => Object.freeze(row)));
const FEED_ROWS = Object.freeze([
  [APP.sha256, FEED.sha256, FEED.blob],
  [PRIOR.sha256, '694c46006a8f8892aae7a57dd9c403c3034e3b22d67d9aba7d65bc14949bb2ee', 'ae1f703f8eb1041a71c730def16c518b726da37b'],
  ['ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d',
    '6d49aeef9179be2dc843eb2ec83506a327379f5a0017b1aaa72a15283f701914', '256f05c5c8bd93ac47fb3246dfa18ce00b6f27ef'],
  ['653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b',
    'f17604dabc043c07f1f382da2dfc510683bba3fa69bbb9074256418886b683c9', 'a4893cd696951c2a179a076f7a98c0d3d2ee160e'],
].map(row => Object.freeze(row)));
const APP_URL = '/app.js?v=wallet-session-20261011';
const APP_QUERY = '&amp;content=' + APP.sha256;
const FEED_CURRENT_TAG = '<script src="/pages/lumina-feed.js?v=feed-search-locale-20261015"></script>';
const FEED_OLD_TAG = '<script src="/pages/lumina-feed.js?v=feed-search-owner-20261009-deadline-20261011"></script>';
const layouts = Object.freeze([text => text, text => text.replace(/\n/g, '\r\n')]);
const lf = text => text.replace(/\r\n/g, '\n');
const options = Object.freeze({ concurrency: false, timeout: 1000 });
let inverse, html, app, prior, feed, feedPrior, feedSearchPrior;

function same(actual, expected, label) {
  // Do not print whole app/HTML fixtures in a failing assertion.
  assert.equal(actual === expected, true, label);
}
function identity(text) {
  const bytes = Buffer.from(text, 'utf8');
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
}
function known(text, pin, label) { assert.deepEqual(identity(text), pin, label); }
function once(text, from, to) {
  assert.equal(text.split(from).length, 2, 'ONE_EXACT_ORACLE_SPAN');
  return text.replace(from, to);
}
function retreat(text) {
  for (const [owned, previous] of SPANS) text = once(text, owned, previous);
  return text;
}
function advance(text) {
  for (const [owned, previous] of SPANS) text = once(text, previous, owned);
  return text;
}
function readSource(relative, pin, maximum) {
  const bytes = readFileSync(path.join(ROOT, relative));
  assert(bytes.length > 0 && bytes.length <= maximum, 'BOUNDED_PHYSICAL_INPUT');
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.equal(text.startsWith('\uFEFF'), false, 'NO_SOURCE_BOM');
  assert.equal(Buffer.from(text, 'utf8').equals(bytes), true, 'EXACT_UTF8_ROUNDTRIP');
  let canonical = lf(text);
  assert.equal(canonical.includes('\r'), false, 'NO_BARE_CR');
  assert.equal(text === canonical || text === layouts[1](canonical), true, 'UNIFORM_INPUT_EOL');
  if (relative === 'app.js') canonical = inverse.restoreOwnedNaverStateRequiredDelta(canonical);
  if (relative === 'lumina-feed/index.html') canonical = html.htmlWithoutNaverStateAppCacheDelta(canonical);
  known(canonical, pin, 'EXACT_INPUT_IDENTITY');
  return canonical;
}
function appUnchanged(value) {
  same(inverse.restoreOwnedSocialLoginCurrentnessDelta(value), value, 'SOCIAL_UNKNOWN_UNCHANGED');
  same(inverse.restoreOwnedLoginDelta(value), value, 'OUTER_CHAIN_UNKNOWN_UNCHANGED');
}

before(() => {
  inverse = require('./support/auth-login-failclosed-inverse-20261017.cjs');
  html = require('./support/feed-search-locale-html-inverse-20261015.cjs');
  for (const name of ['restoreOwnedSocialLoginCurrentnessDelta', ...CHAIN.map(row => row[0])]) {
    assert.equal(typeof inverse[name], 'function', 'GENUINE_INVERSE_EXPORT');
  }
  for (const name of ['htmlWithoutFeedLightboxCacheDelta', 'htmlWithoutFeedSearchLocaleDelta']) {
    assert.equal(typeof html[name], 'function', 'GENUINE_HTML_EXPORT');
  }
  app = readSource('app.js', APP, 865952);
  feed = readSource('lumina-feed/index.html', FEED, 49192);
  prior = retreat(app);
  known(prior, PRIOR, 'ORACLE_WHOLE_PRIOR_APP');
  feedPrior = once(feed, APP_URL + APP_QUERY, APP_URL);
  known(feedPrior, FEED_PRIOR, 'ORACLE_WHOLE_PRIOR_FEED');
  feedSearchPrior = once(feedPrior, FEED_CURRENT_TAG, FEED_OLD_TAG);
  known(feedSearchPrior, { bytes: Buffer.byteLength(feedSearchPrior),
    sha256: 'd96758293441989728c303b98280e502cbf43a62d458049c7bb4acd9c721753b',
    blob: 'c40eecdf38f35093c4b54c49f1b00080f451e3e4' }, 'ORACLE_WHOLE_FEED_SEARCH_PRIOR');
}, { timeout: 1000 });

test('social inverse exact LF restores only the registered six-span whole source', options, () => {
  const restored = inverse.restoreOwnedSocialLoginCurrentnessDelta(app);
  same(restored, prior, 'EXACT_SIX_SPAN_INVERSE');
  known(restored, PRIOR, 'WHOLE_APP_PRIOR');
  same(advance(restored), app, 'WHOLE_APP_FORWARD');
  assert.equal(Buffer.byteLength(app) - Buffer.byteLength(restored), 279, 'ONLY_279_INSERTED_BYTES');
  same(inverse.restoreOwnedSocialLoginCurrentnessDelta(restored), restored, 'PRIOR_IS_IDENTITY');
});

test('social inverse exact CRLF preserves uniform format and whole forward identity', options, () => {
  const current = layouts[1](app), expected = layouts[1](prior);
  const restored = inverse.restoreOwnedSocialLoginCurrentnessDelta(current);
  same(restored, expected, 'EXACT_CRLF_PRIOR');
  known(lf(restored), PRIOR, 'CRLF_CANONICAL_IDENTITY');
  same(layouts[1](advance(lf(restored))), current, 'EXACT_CRLF_FORWARD');
  same(inverse.restoreOwnedSocialLoginCurrentnessDelta(expected), expected, 'CRLF_PRIOR_IS_IDENTITY');
});

test('social inverse composes with all six unchanged historical inverses', options, () => {
  for (const layout of layouts) for (const [name, bytes, sha256, blob] of CHAIN) {
    const restored = inverse[name](layout(app));
    same(restored, inverse[name](layout(prior)), 'UNCHANGED_HISTORICAL_CHAIN');
    same(restored, layout(lf(restored)), 'CHAIN_UNIFORM_EOL');
    known(lf(restored), { bytes, sha256, blob }, 'HISTORICAL_WHOLE_IDENTITY');
    same(inverse.restoreOwnedSocialLoginCurrentnessDelta(restored), restored, 'HISTORICAL_SOCIAL_NOOP');
  }
});

test('social inverse keeps registered predecessors and unknown strings and rejects non-strings', options, () => {
  for (const value of ['', 'unregistered source\n', prior, layouts[1](prior)]) {
    same(inverse.restoreOwnedSocialLoginCurrentnessDelta(value), value, 'SOCIAL_STRING_IDENTITY');
  }
  for (const value of ['', 'unregistered HTML\n', feedPrior, layouts[1](feedPrior)]) {
    same(html.htmlWithoutFeedLightboxCacheDelta(value), value, 'HTML_STRING_IDENTITY');
  }
  let coercions = 0;
  const hostile = { toString() { coercions++; throw new Error('SYNTHETIC_COERCION_FORBIDDEN'); } };
  const values = [null, undefined, false, 0, 1n, Symbol('synthetic'), [], {}, new String('synthetic'), hostile];
  for (const value of values) {
    assert.throws(() => inverse.restoreOwnedSocialLoginCurrentnessDelta(value),
      { name: 'TypeError', message: 'SOCIAL_CURRENTNESS_INVERSE_STRING_REQUIRED' });
    assert.throws(() => html.htmlWithoutFeedLightboxCacheDelta(value),
      { name: 'TypeError', message: 'FEED_LIGHTBOX_HTML_INVERSE_STRING_REQUIRED' });
  }
  assert.equal(coercions, 0, 'NO_INPUT_COERCION');
});

test('social inverse never admits unrelated source tampering', options, () => {
  for (const layout of layouts) for (const value of [app + '\n', app.slice(0, -1),
    '// synthetic extra\n' + app, 'X' + app.slice(1)]) appUnchanged(layout(value));
});

test('social inverse never admits any partial or duplicated owned span', options, () => {
  for (const [owned, previous] of SPANS) {
    for (const value of [once(app, owned, previous), once(app, owned, owned + owned)]) {
      for (const layout of layouts) appUnchanged(layout(value));
    }
  }
});

test('social inverse and feed cache inverse preserve malformed encodings without admission', options, () => {
  const malformed = text => ['\uFEFF' + text, '\uFEFF' + layouts[1](text),
    text.replace('\n', '\r\n'), text.replace('\n', '\r'), text + '\ud800', text + '\udfff'];
  for (const value of malformed(app)) appUnchanged(value);
  for (const value of malformed(feed)) {
    same(html.htmlWithoutFeedLightboxCacheDelta(value), value, 'MALFORMED_FEED_UNCHANGED');
    assert.throws(() => html.htmlWithoutFeedSearchLocaleDelta(value), { code: 'ERR_ASSERTION' });
  }
});

test('feed cache inverse admits the new row and preserves all three historical rows', options, () => {
  for (const [appSha, sha256, blob] of FEED_ROWS) {
    const query = '&amp;content=' + appSha;
    const current = once(feed, APP_URL + APP_QUERY, APP_URL + query);
    known(current, { bytes: 24596, sha256, blob }, 'EXACT_REGISTERED_FEED_ROW');
    for (const layout of layouts) {
      const restored = html.htmlWithoutFeedLightboxCacheDelta(layout(current));
      same(restored, layout(feedPrior), 'WHOLE_FEED_CACHE_INVERSE');
      known(lf(restored), FEED_PRIOR, 'WHOLE_FEED_PREDECESSOR');
      same(once(restored, APP_URL, APP_URL + query), layout(current), 'WHOLE_FEED_CACHE_FORWARD');
      assert.equal(Buffer.byteLength(current) - Buffer.byteLength(lf(restored)), 77, 'EXACT_QUERY_ONLY_DELTA');
      same(html.htmlWithoutFeedSearchLocaleDelta(layout(current)), layout(feedSearchPrior), 'UNCHANGED_FEED_SEARCH_CHAIN');
    }
  }
});

test('feed cache inverse keeps unknown and tampered inputs unregistered', options, () => {
  for (const value of [feed + '\n', feed.slice(0, -1), '<!-- synthetic -->' + feed,
    once(feed, APP_URL + APP_QUERY, APP_URL + '&amp;content=' + '0'.repeat(64)),
    once(feed, APP_URL + APP_QUERY, APP_URL + APP_QUERY + APP_URL + APP_QUERY)]) {
    for (const layout of layouts) {
      const input = layout(value);
      same(html.htmlWithoutFeedLightboxCacheDelta(input), input, 'UNKNOWN_FEED_UNCHANGED');
      assert.throws(() => html.htmlWithoutFeedSearchLocaleDelta(input), { code: 'ERR_ASSERTION' });
    }
  }
});

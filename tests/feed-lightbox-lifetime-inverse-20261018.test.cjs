'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const inverse = require('./support/auth-login-failclosed-inverse-20261017.cjs');

const bytes = readFileSync(join(__dirname, '../app.js'));
assert(bytes.length >= 432976 && bytes.length <= 865952);
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
assert.equal(decoded.startsWith('\uFEFF'), false);
assert.equal(Buffer.from(decoded).equals(bytes), true);
const source = decoded.replace(/\r\n/g, '\n');
assert.equal(source.includes('\r'), false);
assert.equal(decoded === source || decoded === source.replace(/\n/g, '\r\n'), true);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
assert.equal(sha(source), '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d');
assert.equal(Buffer.byteLength(source), 432976);
assert.equal(source.includes('\r'), false);
const eols = [text => text, text => text.replace(/\n/g, '\r\n')];
const lf = text => text.replace(/\r\n/g, '\n');
const functions = [
  'restoreOwnedFeedLightboxLifetimeDelta',
  'restoreOwnedAuthEntryHardeningDelta',
  'restoreOwnedBootstrapDelta',
  'restoreOwnedLoginDelta',
];

test('lightbox inverse restores only the complete admitted LF or CRLF source', () => {
  for (const eol of eols) {
    const result = inverse.restoreOwnedFeedLightboxLifetimeDelta(eol(source));
    assert.equal(sha(lf(result)), 'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2');
    assert.equal(Buffer.byteLength(lf(result)), 430667);
    assert.equal(result, eol(lf(result)));
  }
});

test('lightbox delta composes with each unchanged historical auth inverse', () => {
  const expected = {
    restoreOwnedAuthEntryHardeningDelta: '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028',
    restoreOwnedBootstrapDelta: '7ee22fe15e52d715473fe8b0f26b344d3f66377a0827854bab2f80dd83463d36',
    restoreOwnedLoginDelta: '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87',
  };
  for (const eol of eols) for (const [name, fingerprint] of Object.entries(expected)) {
    const result = inverse[name](eol(source));
    assert.equal(sha(lf(result)), fingerprint, name);
    assert.equal(result, eol(lf(result)), name);
  }
});

test('previous app input remains a no-op for the new lightbox-only inverse', () => {
  const previous = inverse.restoreOwnedFeedLightboxLifetimeDelta(source);
  for (const eol of eols) {
    const value = eol(previous);
    assert.equal(inverse.restoreOwnedFeedLightboxLifetimeDelta(value), value);
    assert.equal(sha(lf(inverse.restoreOwnedAuthEntryHardeningDelta(value))),
      '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028');
  }
});

test('partial tampered unknown BOM mixed-EOL and invalid-scalar sources are never projected', () => {
  const values = [
    '', 'unknown app', source.slice(0, -1), source + ' ',
    source.replace('let _lightboxBodyOverflow = null;', 'let _lightboxBodyOverflow = undefined;'),
    '\uFEFF' + source, source.replace('\n', '\r\n'), source + '\ud800',
    source.replace('let _lightboxBodyOverflow = null;\n', ''),
  ];
  for (const value of values) for (const eol of eols) for (const name of functions) {
    const input = eol(value);
    assert.equal(inverse[name](input), input, name);
  }
});

test('non-string input retains each existing auth error contract', () => {
  const messages = {
    restoreOwnedFeedLightboxLifetimeDelta: 'FEED_LIGHTBOX_INVERSE_STRING_REQUIRED',
    restoreOwnedAuthEntryHardeningDelta: 'AUTH_ENTRY_HARDENING_INVERSE_STRING_REQUIRED',
    restoreOwnedBootstrapDelta: 'AUTH_BOOTSTRAP_INVERSE_STRING_REQUIRED',
    restoreOwnedLoginDelta: 'AUTH_LOGIN_INVERSE_STRING_REQUIRED',
  };
  for (const value of [null, undefined, 0, {}, Buffer.from('synthetic')]) {
    for (const [name, message] of Object.entries(messages)) {
      assert.throws(() => inverse[name](value), error => error instanceof TypeError && error.message === message);
    }
  }
});

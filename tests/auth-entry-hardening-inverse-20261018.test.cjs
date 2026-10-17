'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { restoreOwnedFeedLightboxLifetimeDelta, restoreOwnedAuthEntryHardeningDelta: restore, restoreOwnedLoginDelta } =
  require('./support/auth-login-failclosed-inverse-20261017.cjs');

function identity(source) {
  const bytes = Buffer.from(source, 'utf8');
  return { sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
}
const AFTER = { sha256: 'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2',
  blob: '8c9aba0a3cd35b11a676ee123d83f3f4fa84779e' };
const BEFORE = { sha256: '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028',
  blob: '4e9e2f1861574d25bf6b7bfd9d61a1bd9966adb3' };
let actual, previous;
before(() => {
  const bytes = readFileSync(path.join(__dirname, '..', 'app.js'));
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.equal(source.startsWith('\uFEFF'), false);
  assert.equal(Buffer.from(source).equals(bytes), true);
  const canonicalApp = source.replace(/\r\n/g, '\n');
  actual = restoreOwnedFeedLightboxLifetimeDelta(canonicalApp);
  assert.equal(actual.includes('\r'), false);
  assert.equal(source === canonicalApp || source === canonicalApp.replace(/\n/g, '\r\n'), true);
  assert.equal(Buffer.byteLength(actual), 430667);
  assert.deepEqual(identity(actual), AFTER);
  previous = restore(actual);
  assert.equal(Buffer.byteLength(previous), 430404);
  assert.deepEqual(identity(previous), BEFORE);
});

test('auth hardening inverse restores only the registered complete LF source', () => {
  assert.equal(restore(actual), previous);
  assert.deepEqual(identity(restore(actual)), BEFORE);
});

test('auth hardening inverse preserves uniform CRLF when restoring exact source', () => {
  const crlf = actual.replace(/\n/g, '\r\n');
  assert.equal(restore(crlf), previous.replace(/\n/g, '\r\n'));
  assert.deepEqual(identity(restore(crlf).replace(/\r\n/g, '\n')), BEFORE);
});

test('auth hardening inverse leaves its original and unrelated strings unchanged', () => {
  for (const value of [previous, previous.replace(/\n/g, '\r\n'), '', 'unregistered\n']) {
    assert.equal(restore(value), value);
  }
});

test('auth hardening inverse never coerces a non-string input', () => {
  for (const value of [undefined, null, 0, false, {}, [], Buffer.from('text')]) {
    assert.throws(() => restore(value), { name: 'TypeError' });
  }
});

test('auth hardening inverse does not admit extra changes or irregular encodings', () => {
  for (const value of [actual + '// extra\n', '\uFEFF' + actual, actual + '\uD800',
    actual.replace('\n', '\r\n'), actual.replace('\n', '\r'),
    actual.replace('const API_BASE =', 'const API_BASE_CHANGED =')]) {
    assert.notEqual(identity(value).sha256, AFTER.sha256);
    assert.equal(restore(value), value);
  }
});

test('auth hardening inverse does not normalize partial or duplicated owned guards', () => {
  const refresh = '        (newRefresh && (typeof newRefresh !== "string" || !newRefresh.trim())) ||\n';
  const deadline = '        (path === "/api/v1/auth/login" || path === "/api/v1/auth/register")))) clearTimeout(timer);';
  assert.equal(actual.split(refresh).length, 2);
  assert.equal(actual.split(deadline).length, 2);
  for (const value of [actual.replace(refresh, ''), actual.replace(refresh, refresh + refresh),
    actual.replace(deadline, '        false))) clearTimeout(timer);')]) {
    assert.notEqual(identity(value).sha256, AFTER.sha256);
    assert.equal(restore(value), value);
  }
});

test('auth hardening inverse preserves the complete existing login inverse chain', () => {
  const historical = restoreOwnedLoginDelta(previous);
  assert.equal(Buffer.byteLength(historical), 429783);
  assert.equal(identity(historical).sha256,
    '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87');
  assert.equal(restoreOwnedLoginDelta(actual), historical);
  assert.equal(restoreOwnedLoginDelta(actual.replace(/\n/g, '\r\n')),
    historical.replace(/\n/g, '\r\n'));
});

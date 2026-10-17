'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { before, test } = require('node:test');
const { restoreOwnedLoginDelta } = require('./support/auth-login-failclosed-inverse-20261017.cjs');

const CURRENT = {
  sha256: '298e13c1933080e9e31b7ceee67589f6d3cf35a564c5e5b16133537745b8f997',
  blob: '548c1db86d704dc1e505ead64b8670cece27e00e',
};
const AFTER = {
  sha256: '6f005936bf0fb0ab4950ab5ed219ceb31c7aa8ae01f5ed24b6a035e0976c50da',
  blob: 'e239f706eac193be6df72690bc3ca19b7e91475a',
};
const BEFORE = {
  sha256: '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87',
  blob: '7c3a65b55c3e2f12623d3f782663c2e2233243a5',
};
const CURRENT_LOGIN_START = 'async function authLogin(email, password) {\n  const session = authRequestSession();';
const CURRENT_GUARD = [
  '  if (!authRequestSessionCurrent(session)) {',
  '    throw new Error("Login response no longer matches the current session");',
  '  }',
  '',
].join('\n');
const BEFORE_LINE = '  if (token) setAuth({ accessToken: token, refreshToken: refresh, user });';
const AFTER_BLOCK = [
  '  if (typeof token !== "string" || !token.trim()) {',
  '    throw new Error("Login response is missing a usable access token");',
  '  }',
  '  setAuth({ accessToken: token, refreshToken: refresh, user });',
].join('\n');

function identity(source) {
  const bytes = Buffer.from(source, 'utf8');
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  };
}

let currentLF;
let afterLF;
let beforeLF;
before(() => {
  const bytes = readFileSync(path.join(__dirname, '..', 'app.js'));
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.equal(source.startsWith('\uFEFF'), false);
  assert.equal(Buffer.from(source, 'utf8').equals(bytes), true);
  const lf = source.replace(/\r\n/g, '\n');
  assert.equal(lf.includes('\r'), false);
  assert.equal(source === lf || source === lf.replace(/\n/g, '\r\n'), true);
  assert.deepEqual(identity(lf), CURRENT, 'Actual app must be the frozen owned current source');
  assert.equal(Buffer.byteLength(lf), 430066);
  assert.equal(lf.split(CURRENT_LOGIN_START).length, 2);
  assert.equal(lf.split(CURRENT_GUARD).length, 2);
  currentLF = lf;
  // Independent tiny inverses bind both intermediate and original whole-file identities.
  afterLF = lf.replace(CURRENT_LOGIN_START, 'async function authLogin(email, password) {').replace(CURRENT_GUARD, '');
  assert.equal(Buffer.byteLength(afterLF), 429900);
  assert.deepEqual(identity(afterLF), AFTER, 'Derived intermediate oracle must match both frozen 6F hashes');
  assert.equal(afterLF.split(AFTER_BLOCK).length, 2);
  beforeLF = afterLF.replace(AFTER_BLOCK, BEFORE_LINE);
  assert.deepEqual(identity(beforeLF), BEFORE, 'Derived before oracle must match both historical hashes');
});

test('owned login inverse: known LF after restores the exact whole-file before', () => {
  const restored = restoreOwnedLoginDelta(afterLF);
  assert.equal(restored, beforeLF);
  assert.equal(Buffer.byteLength(restored), 429783);
  assert.deepEqual(identity(restored), BEFORE);
});

test('owned login inverse: known LF before is an identity input', () => {
  assert.equal(restoreOwnedLoginDelta(beforeLF), beforeLF);
});

test('owned login inverse: known CRLF after preserves uniform CRLF', () => {
  const restored = restoreOwnedLoginDelta(afterLF.replace(/\n/g, '\r\n'));
  assert.equal(restored, beforeLF.replace(/\n/g, '\r\n'));
  assert.equal(restored.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(restored.replace(/\r\n/g, '').includes('\r'), false);
  assert.deepEqual(identity(restored.replace(/\r\n/g, '\n')), BEFORE);
});

test('owned login inverse: known CRLF before is preserved byte for byte', () => {
  const source = beforeLF.replace(/\n/g, '\r\n');
  assert.equal(restoreOwnedLoginDelta(source), source);
});

test('owned login inverse: empty and unregistered strings are unchanged', () => {
  for (const source of ['', 'unregistered historical source\n', 'unpaired-surrogate:\uD800\n']) {
    assert.equal(restoreOwnedLoginDelta(source), source);
  }
});

test('owned login inverse: unrelated after-source tampering is not normalized into admission', () => {
  const source = afterLF + '// unregistered trailing change\n';
  assert.equal(restoreOwnedLoginDelta(source), source);
  assert.notEqual(identity(source).sha256, BEFORE.sha256);
  assert.notEqual(identity(source).sha256, AFTER.sha256);
});

test('owned login inverse: duplicated owned block remains an unregistered input', () => {
  const source = afterLF.replace(AFTER_BLOCK, AFTER_BLOCK + '\n' + AFTER_BLOCK);
  assert.equal(source.split(AFTER_BLOCK).length, 3);
  assert.equal(restoreOwnedLoginDelta(source), source);
  assert.notEqual(identity(source).sha256, BEFORE.sha256);
});

test('owned login inverse: a BOM is retained for the original consumer to reject', () => {
  const source = '\uFEFF' + afterLF;
  assert.equal(restoreOwnedLoginDelta(source), source);
  assert.equal(source.charCodeAt(0), 0xFEFF);
  assert.notEqual(identity(source).sha256, BEFORE.sha256);
});

test('owned login inverse: mixed newlines and bare CR are unchanged', () => {
  for (const source of [afterLF.replace('\n', '\r\n'), afterLF.replace('\n', '\r')]) {
    assert.equal(restoreOwnedLoginDelta(source), source);
    assert.notEqual(identity(source).sha256, BEFORE.sha256);
  }
});

test('owned login inverse: non-string inputs are rejected without coercion', () => {
  for (const source of [undefined, null, 0, {}, Buffer.from('source')]) {
    assert.throws(() => restoreOwnedLoginDelta(source), { name: 'TypeError' });
  }
});

test('owned login inverse: known LF current restores through exact 6F to the whole-file before', () => {
  const restored = restoreOwnedLoginDelta(currentLF);
  assert.equal(restored, beforeLF);
  assert.equal(Buffer.byteLength(restored), 429783);
  assert.deepEqual(identity(restored), BEFORE);
});

test('owned login inverse: known CRLF current preserves uniform CRLF through both inverses', () => {
  const restored = restoreOwnedLoginDelta(currentLF.replace(/\n/g, '\r\n'));
  assert.equal(restored, beforeLF.replace(/\n/g, '\r\n'));
  assert.equal(restored.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(restored.replace(/\r\n/g, '').includes('\r'), false);
  assert.deepEqual(identity(restored.replace(/\r\n/g, '\n')), BEFORE);
});

test('owned login inverse: tampered or nonuniform current source remains unregistered and unchanged', () => {
  for (const source of [
    currentLF + '// unregistered current trailing change\n',
    currentLF.replace(CURRENT_LOGIN_START, 'async function authLogin(email, password) {'),
    currentLF.replace(CURRENT_GUARD, ''),
    currentLF.replace(CURRENT_GUARD, CURRENT_GUARD + CURRENT_GUARD),
    currentLF.replace('Login response no longer matches the current session', 'Unregistered current-session message'),
    '\uFEFF' + currentLF,
    currentLF.replace('\n', '\r\n'),
    currentLF.replace('\n', '\r'),
  ]) {
    assert.equal(restoreOwnedLoginDelta(source), source);
    assert.notEqual(identity(source).sha256, CURRENT.sha256);
    assert.notEqual(identity(source).sha256, AFTER.sha256);
    assert.notEqual(identity(source).sha256, BEFORE.sha256);
  }
});

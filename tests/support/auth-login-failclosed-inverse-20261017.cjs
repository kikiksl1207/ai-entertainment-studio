'use strict';

const { createHash } = require('node:crypto');

const AFTER_SHA256 = '6f005936bf0fb0ab4950ab5ed219ceb31c7aa8ae01f5ed24b6a035e0976c50da';
const AFTER_BLOB = 'e239f706eac193be6df72690bc3ca19b7e91475a';
const BEFORE_SHA256 = '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87';
const BEFORE_BLOB = '7c3a65b55c3e2f12623d3f782663c2e2233243a5';
const LOGIN_START = 'async function authLogin(email, password) {';
const NEXT_FUNCTION = '\nasync function authRegister(';
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

function restoreOwnedLoginDelta(source) {
  if (typeof source !== 'string') throw new TypeError('AUTH_LOGIN_INVERSE_STRING_REQUIRED');
  const lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.includes('\r') || (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;

  const after = identity(lf);
  if (after.sha256 !== AFTER_SHA256 && after.blob !== AFTER_BLOB) return source;
  if (after.sha256 !== AFTER_SHA256 || after.blob !== AFTER_BLOB) {
    throw new Error('AUTH_LOGIN_INVERSE_AFTER_IDENTITY_MISMATCH');
  }

  // Whole-file admission must precede the one owned statement inverse.
  const start = lf.indexOf(LOGIN_START);
  const end = lf.indexOf(NEXT_FUNCTION, start);
  const at = lf.indexOf(AFTER_BLOCK);
  if (start < 0 || lf.indexOf(LOGIN_START, start + 1) !== -1 || end <= start ||
      at < start || at + AFTER_BLOCK.length > end ||
      lf.indexOf(AFTER_BLOCK, at + 1) !== -1 || lf[at - 1] !== '\n' ||
      lf[at + AFTER_BLOCK.length] !== '\n') {
    throw new Error('AUTH_LOGIN_INVERSE_OWNED_BLOCK_MISMATCH');
  }
  const restored = lf.slice(0, at) + BEFORE_LINE + lf.slice(at + AFTER_BLOCK.length);
  const before = identity(restored);
  if (before.sha256 !== BEFORE_SHA256 || before.blob !== BEFORE_BLOB) {
    throw new Error('AUTH_LOGIN_INVERSE_BEFORE_IDENTITY_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

module.exports = { restoreOwnedLoginDelta };

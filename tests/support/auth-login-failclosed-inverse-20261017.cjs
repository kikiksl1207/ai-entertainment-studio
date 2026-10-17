'use strict';

const { createHash } = require('node:crypto');

const BOOTSTRAP_SHA256 = '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028';
const BOOTSTRAP_BLOB = '4e9e2f1861574d25bf6b7bfd9d61a1bd9966adb3';
const REGISTER_SHA256 = '7ee22fe15e52d715473fe8b0f26b344d3f66377a0827854bab2f80dd83463d36';
const REGISTER_BLOB = '4cf6cb0e00ef0ceb4c7276e56e5d8e4bbda24195';
const CURRENT_SHA256 = '298e13c1933080e9e31b7ceee67589f6d3cf35a564c5e5b16133537745b8f997';
const CURRENT_BLOB = '548c1db86d704dc1e505ead64b8670cece27e00e';
const AFTER_SHA256 = '6f005936bf0fb0ab4950ab5ed219ceb31c7aa8ae01f5ed24b6a035e0976c50da';
const AFTER_BLOB = 'e239f706eac193be6df72690bc3ca19b7e91475a';
const BEFORE_SHA256 = '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87';
const BEFORE_BLOB = '7c3a65b55c3e2f12623d3f782663c2e2233243a5';
const LOGIN_START = 'async function authLogin(email, password) {';
const NEXT_FUNCTION = '\nasync function authRegister(';
const CURRENT_CAPTURE = '  const session = authRequestSession();\n';
const REGISTER_START = 'async function authRegister(email, password, displayName, referralCode) {';
const REGISTER_NEXT_FUNCTION = '\nasync function authLogout(';
const REGISTER_GUARD = '  if (!authRequestSessionCurrent(session)) return data;\n';
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

function restoreOwnedFeedLightboxLifetimeDelta(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIGHTBOX_INVERSE_STRING_REQUIRED');
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.includes('\r') || (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b';
  const blob = '45c8bc57f852130d8668d542aefdb7ad47aec5d8';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 431019 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('FEED_LIGHTBOX_INVERSE_IDENTITY_MISMATCH');
  }
  const inverse = [
    ['let _lightboxBodyOverflow = null;\n', ''],
    ['  const wasOpen = _lightboxEl?.classList.contains("is-open") === true;\n', ''],
    ['  if (!wasOpen) _lightboxBodyOverflow = document.body.style.overflow;\n', ''],
    ['  if (_lightboxKeyHandler) document.removeEventListener("keydown", _lightboxKeyHandler);\n', ''],
    ['  if (!_lightboxEl?.classList.contains("is-open")) return;', '  if (!_lightboxEl) return;'],
    ['  document.body.style.overflow = _lightboxBodyOverflow ?? "";\n  _lightboxBodyOverflow = null;',
      '  document.body.style.overflow = "";'],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('FEED_LIGHTBOX_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 430667 ||
      before.sha256 !== 'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2' ||
      before.blob !== '8c9aba0a3cd35b11a676ee123d83f3f4fa84779e') {
    throw new Error('FEED_LIGHTBOX_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedAuthEntryHardeningDelta(source) {
  if (typeof source !== 'string') throw new TypeError('AUTH_ENTRY_HARDENING_INVERSE_STRING_REQUIRED');
  source = restoreOwnedFeedLightboxLifetimeDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.includes('\r') || (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = 'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2';
  const blob = '8c9aba0a3cd35b11a676ee123d83f3f4fa84779e';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 430667 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('AUTH_ENTRY_HARDENING_INVERSE_IDENTITY_MISMATCH');
  }
  const inverse = [
    [[
      '    // Keep entry JSON and the credential-free public catalog inside the existing deadline.',
      '    if (!((path === "/api/v1/ott" && method === "GET" && auth === false &&',
      '      body === undefined && Object.keys(headers).length === 0) ||',
      '      (method === "POST" && auth === false &&',
      '        (path === "/api/v1/auth/login" || path === "/api/v1/auth/register")))) clearTimeout(timer);',
    ].join('\n'), [
      '    // Keep the existing deadline through JSON for the credential-free public catalog.',
      '    if (!(path === "/api/v1/ott" && method === "GET" && auth === false &&',
      '      body === undefined && Object.keys(headers).length === 0)) clearTimeout(timer);',
    ].join('\n')],
    [[
      '      if (typeof newAccess !== "string" || !newAccess.trim() ||',
      '        (newRefresh && (typeof newRefresh !== "string" || !newRefresh.trim())) ||',
      '        (originalUserId && String(user?.id || user?.userId || "") !== String(originalUserId))) {',
    ].join('\n'), '      if (!newAccess || (originalUserId && String(user?.id || user?.userId || "") !== String(originalUserId))) {'],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('AUTH_ENTRY_HARDENING_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 430404 ||
      before.sha256 !== BOOTSTRAP_SHA256 || before.blob !== BOOTSTRAP_BLOB) {
    throw new Error('AUTH_ENTRY_HARDENING_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedBootstrapDelta(source) {
  if (typeof source !== 'string') throw new TypeError('AUTH_BOOTSTRAP_INVERSE_STRING_REQUIRED');
  source = restoreOwnedAuthEntryHardeningDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.includes('\r') || (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  if (after.sha256 !== BOOTSTRAP_SHA256 && after.blob !== BOOTSTRAP_BLOB) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 430404 ||
      after.sha256 !== BOOTSTRAP_SHA256 || after.blob !== BOOTSTRAP_BLOB) {
    throw new Error('AUTH_BOOTSTRAP_INVERSE_IDENTITY_MISMATCH');
  }

  // Only these five substitutions may precede the unchanged registration/login chain.
  const inverse = [
    ['async function initI18n(syncAuthenticatedSettings = true) {', 'async function initI18n() {'],
    ['  if (syncAuthenticatedSettings && isLoggedIn()) {', '  if (isLoggedIn()) {'],
    ['  const explicitLoginEntry = typeof window !== "undefined" &&\n' +
      '    window.location?.pathname === "/" && window.location?.hash === "#login";\n', ''],
    ['  await initI18n(!explicitLoginEntry);', '  await initI18n();'],
    ['  if (!explicitLoginEntry && isLoggedIn()) loadWallet();', '  if (isLoggedIn()) loadWallet();'],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('AUTH_BOOTSTRAP_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 430162 ||
      before.sha256 !== REGISTER_SHA256 || before.blob !== REGISTER_BLOB) {
    throw new Error('AUTH_BOOTSTRAP_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedLoginDelta(source) {
  if (typeof source !== 'string') throw new TypeError('AUTH_LOGIN_INVERSE_STRING_REQUIRED');
  source = restoreOwnedBootstrapDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.includes('\r') || (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;

  let after = identity(lf);
  if (after.sha256 === REGISTER_SHA256 || after.blob === REGISTER_BLOB) {
    if (after.sha256 !== REGISTER_SHA256 || after.blob !== REGISTER_BLOB) {
      throw new Error('AUTH_LOGIN_INVERSE_REGISTER_IDENTITY_MISMATCH');
    }
    // Only the registered 96-byte authRegister delta may precede the login chain.
    const start = lf.indexOf(REGISTER_START);
    const end = lf.indexOf(REGISTER_NEXT_FUNCTION, start);
    const captureAt = start + REGISTER_START.length + 1;
    const gateAt = lf.indexOf(REGISTER_GUARD);
    const owned = lf.slice(start, end);
    if (start < 0 || lf.indexOf(REGISTER_START, start + 1) !== -1 || end <= start ||
        !owned.startsWith(REGISTER_START + '\n' + CURRENT_CAPTURE) ||
        owned.split(CURRENT_CAPTURE).length !== 2 || owned.split(REGISTER_GUARD).length !== 2 ||
        gateAt < captureAt + CURRENT_CAPTURE.length || gateAt + REGISTER_GUARD.length >= end ||
        lf.indexOf(REGISTER_GUARD, gateAt + 1) !== -1 || lf[gateAt - 1] !== '\n') {
      throw new Error('AUTH_LOGIN_INVERSE_REGISTER_BLOCK_MISMATCH');
    }
    lf = lf.slice(0, gateAt) + lf.slice(gateAt + REGISTER_GUARD.length);
    lf = lf.slice(0, captureAt) + lf.slice(captureAt + CURRENT_CAPTURE.length);
    after = identity(lf);
    if (after.sha256 !== CURRENT_SHA256 || after.blob !== CURRENT_BLOB) {
      throw new Error('AUTH_LOGIN_INVERSE_REGISTER_RESTORED_IDENTITY_MISMATCH');
    }
  }
  if (after.sha256 === CURRENT_SHA256 || after.blob === CURRENT_BLOB) {
    if (after.sha256 !== CURRENT_SHA256 || after.blob !== CURRENT_BLOB) {
      throw new Error('AUTH_LOGIN_INVERSE_CURRENT_IDENTITY_MISMATCH');
    }
    // Only the registered 166-byte authLogin delta may precede the existing inverse.
    const start = lf.indexOf(LOGIN_START);
    const end = lf.indexOf(NEXT_FUNCTION, start);
    const captureAt = start + LOGIN_START.length + 1;
    const gateAt = lf.indexOf(CURRENT_GUARD);
    const owned = lf.slice(start, end);
    if (start < 0 || lf.indexOf(LOGIN_START, start + 1) !== -1 || end <= start ||
        !owned.startsWith(LOGIN_START + '\n' + CURRENT_CAPTURE) ||
        owned.split(CURRENT_CAPTURE).length !== 2 || owned.split(CURRENT_GUARD).length !== 2 ||
        gateAt < captureAt + CURRENT_CAPTURE.length || gateAt + CURRENT_GUARD.length >= end ||
        lf.indexOf(CURRENT_GUARD, gateAt + 1) !== -1 || lf[gateAt - 1] !== '\n') {
      throw new Error('AUTH_LOGIN_INVERSE_CURRENT_BLOCK_MISMATCH');
    }
    lf = lf.slice(0, gateAt) + lf.slice(gateAt + CURRENT_GUARD.length);
    lf = lf.slice(0, captureAt) + lf.slice(captureAt + CURRENT_CAPTURE.length);
    after = identity(lf);
    if (after.sha256 !== AFTER_SHA256 || after.blob !== AFTER_BLOB) {
      throw new Error('AUTH_LOGIN_INVERSE_CURRENT_RESTORED_IDENTITY_MISMATCH');
    }
  }
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

module.exports = { restoreOwnedFeedLightboxLifetimeDelta, restoreOwnedAuthEntryHardeningDelta, restoreOwnedBootstrapDelta, restoreOwnedLoginDelta };

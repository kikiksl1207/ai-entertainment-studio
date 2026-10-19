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

function restoreOwnedNaverStateEntropyDelta(source) {
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61';
  const blob = '892c0bd98d93e90f9ec257be57ba5ab7ac6cd75f';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 433479 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('NAVER_STATE_ENTROPY_INVERSE_IDENTITY_MISMATCH');
  }
  const owned = [
    '  let state;',
    '  try {',
    '    const entropy = new Uint8Array(16);',
    '    window.crypto.getRandomValues(entropy);',
    '    state = Array.from(entropy, byte => byte.toString(16).padStart(2, "0")).join("");',
    '  } catch {',
    '    alert("\ub124\uc774\ubc84 \ub85c\uadf8\uc778 \ubcf4\uc548 \uac80\uc99d \uc2e4\ud328");',
    '    return;',
    '  }',
    '',
  ].join('\n');
  const previous = '  const state = Math.random().toString(36).substring(2, 15);\n';
  const at = lf.indexOf(owned);
  if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
    throw new Error('NAVER_STATE_ENTROPY_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
  }
  const restored = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  const before = identity(restored);
  if (Buffer.byteLength(restored, 'utf8') !== 433266 ||
      before.sha256 !== '1722e0229ac0706970d088eab353ec80b1a728a570381d3b82ebd4c510bb1418' ||
      before.blob !== '1ad79903745cf9b8f363cf5126a13b2b16f840f8') {
    throw new Error('NAVER_STATE_ENTROPY_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  const forwardAt = restored.indexOf(previous);
  if (forwardAt < 0 || restored.indexOf(previous, forwardAt + previous.length) !== -1) {
    throw new Error('NAVER_STATE_ENTROPY_INVERSE_FORWARD_SUBSTITUTION_MISMATCH');
  }
  if (restored.slice(0, forwardAt) + owned + restored.slice(forwardAt + previous.length) !== lf) {
    throw new Error('NAVER_STATE_ENTROPY_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function restoreOwnedNaverStateRequiredDelta(source) {
  if (typeof source !== 'string') throw new TypeError('NAVER_STATE_REQUIRED_INVERSE_STRING_REQUIRED');
  source = restoreOwnedNaverStateEntropyDelta(source);
  const lf = source.replace(/\r\n/g, '\n'), crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n')) ||
      Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = '1722e0229ac0706970d088eab353ec80b1a728a570381d3b82ebd4c510bb1418';
  const blob = '1ad79903745cf9b8f363cf5126a13b2b16f840f8';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 433266 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('NAVER_STATE_REQUIRED_INVERSE_IDENTITY_MISMATCH');
  }
  const owned = 'if (!savedState || !state || state !== savedState) {';
  const previous = 'if (savedState && state !== savedState) {';
  const at = lf.indexOf(owned);
  if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
    throw new Error('NAVER_STATE_REQUIRED_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
  }
  const restored = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  const before = identity(restored);
  if (Buffer.byteLength(restored, 'utf8') !== 433255 ||
      before.sha256 !== '6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c' ||
      before.blob !== 'b9985ba4b0121dfc48792ff908c02b7b91e0f5a8') {
    throw new Error('NAVER_STATE_REQUIRED_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  const forwardAt = restored.indexOf(previous);
  if (forwardAt < 0 || restored.indexOf(previous, forwardAt + previous.length) !== -1) {
    throw new Error('NAVER_STATE_REQUIRED_INVERSE_FORWARD_SUBSTITUTION_MISMATCH');
  }
  if (restored.slice(0, forwardAt) + owned + restored.slice(forwardAt + previous.length) !== lf) {
    throw new Error('NAVER_STATE_REQUIRED_INVERSE_FORWARD_MISMATCH');
  }
  return crlf ? restored.replace(/\n/g, '\r\n') : restored;
}

function restoreOwnedSocialLoginCurrentnessDelta(source) {
  if (typeof source !== 'string') throw new TypeError('SOCIAL_CURRENTNESS_INVERSE_STRING_REQUIRED');
  source = restoreOwnedNaverStateRequiredDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = '6089683740bfbc19b3f85e1754169acf5c7576d6b851d4ed38314c423d2ea47c';
  const blob = 'b9985ba4b0121dfc48792ff908c02b7b91e0f5a8';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 433255 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('SOCIAL_CURRENTNESS_INVERSE_IDENTITY_MISMATCH');
  }
  const admitted = lf;
  const inverse = [
    ["  const session = authRequestSession();\n  try {\n    console.info(\"[Lumina] Kakao code \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911\");", "  try {\n    console.info(\"[Lumina] Kakao code \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911\");"],
    ["  const session = authRequestSession();\n  try {\n    console.info(\"[Lumina] Naver access token \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911\");", "  try {\n    console.info(\"[Lumina] Naver access token \uc218\uc2e0, \ubc31\uc5d4\ub4dc \ud638\ucd9c \uc911\");"],
    ["    console.error(\"[Lumina] Google access_token \ub204\ub77d\");\n    return;\n  }\n  const session = authRequestSession();\n  try {", "    console.error(\"[Lumina] Google access_token \ub204\ub77d\");\n    return;\n  }\n  try {"],
    ["    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, \"Kakao\");", "    applyAuthResponse(data, \"Kakao\");"],
    ["    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, \"Naver\");", "    applyAuthResponse(data, \"Naver\");"],
    ["    if (!authRequestSessionCurrent(session)) return;\n    applyAuthResponse(data, \"Google\");", "    applyAuthResponse(data, \"Google\");"],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('SOCIAL_CURRENTNESS_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 432976 ||
      before.sha256 !== '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d' ||
      before.blob !== '609d8253eebaa968b9654e4d961f197a20a8ba6e') {
    throw new Error('SOCIAL_CURRENTNESS_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  let forward = lf;
  for (const [owned, previous] of inverse) {
    const at = forward.indexOf(previous);
    if (at < 0 || forward.indexOf(previous, at + previous.length) !== -1) {
      throw new Error('SOCIAL_CURRENTNESS_INVERSE_FORWARD_SUBSTITUTION_MISMATCH');
    }
    forward = forward.slice(0, at) + owned + forward.slice(at + previous.length);
  }
  if (forward !== admitted) throw new Error('SOCIAL_CURRENTNESS_INVERSE_FORWARD_MISMATCH');
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedFeedLightboxLanguagesDelta(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIGHTBOX_LANGUAGES_INVERSE_STRING_REQUIRED');
  source = restoreOwnedSocialLoginCurrentnessDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d';
  const blob = '609d8253eebaa968b9654e4d961f197a20a8ba6e';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 432976 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('FEED_LIGHTBOX_LANGUAGES_INVERSE_IDENTITY_MISMATCH');
  }
  const admitted = lf;
  const inverse = [
    [
      [
        "  \"detail.gallery.error\": { \"ko-KR\": \"\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.\", \"ja-JP\": \"\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\", \"en-US\": \"Image could not be loaded.\", \"zh-CN\": \"\u65e0\u6cd5\u52a0\u8f7d\u56fe\u7247\u3002\", \"zh-Hant\": \"\u7121\u6cd5\u8f09\u5165\u5716\u7247\u3002\" },",
        "  \"feed.lightbox.name\": { \"ko-KR\": \"\uc0ac\uc9c4 \ubcf4\uae30\", \"ja-JP\": \"\u753b\u50cf\u30d3\u30e5\u30fc\u30a2\", \"en-US\": \"Image viewer\", \"zh-CN\": \"\u56fe\u7247\u67e5\u770b\u5668\", \"zh-Hant\": \"\u5716\u7247\u6aa2\u8996\u5668\" },",
        "",
      ].join('\n'),
      [
        "  \"detail.gallery.error\": { \"ko-KR\": \"\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.\", \"ja-JP\": \"\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\", \"en-US\": \"Image could not be loaded.\", \"zh-CN\": \"\u65e0\u6cd5\u52a0\u8f7d\u56fe\u7247\u3002\", \"zh-Hant\": \"\u7121\u6cd5\u8f09\u5165\u5716\u7247\u3002\" },",
        "",
      ].join('\n'),
    ],
    [
      [
        "    _lightboxEl.setAttribute(\"aria-modal\", \"true\");",
        "    _lightboxEl.setAttribute(\"data-i18n-aria\", \"feed.lightbox.name\");",
        "",
      ].join('\n'),
      [
        "    _lightboxEl.setAttribute(\"aria-modal\", \"true\");",
        "",
      ].join('\n'),
    ],
    [
      [
        "      <button class=\"lightbox-close\" type=\"button\" aria-label=\"\ub2eb\uae30\" data-i18n-aria=\"auth.modal.close\">\u00d7</button>",
        "      <button class=\"lightbox-prev\" type=\"button\" aria-label=\"\uc774\uc804 \uc774\ubbf8\uc9c0\" data-i18n-aria=\"detail.gallery.previous\">\u2039</button>",
        "      <button class=\"lightbox-next\" type=\"button\" aria-label=\"\ub2e4\uc74c \uc774\ubbf8\uc9c0\" data-i18n-aria=\"detail.gallery.next\">\u203a</button>",
      ].join('\n'),
      [
        "      <button class=\"lightbox-close\" type=\"button\" aria-label=\"\ub2eb\uae30\">\u00d7</button>",
        "      <button class=\"lightbox-prev\" type=\"button\" aria-label=\"\uc774\uc804 \uc774\ubbf8\uc9c0\">\u2039</button>",
        "      <button class=\"lightbox-next\" type=\"button\" aria-label=\"\ub2e4\uc74c \uc774\ubbf8\uc9c0\">\u203a</button>",
      ].join('\n'),
    ],
    [
      [
        "        <div class=\"lightbox-error\" data-lightbox-error data-i18n=\"detail.gallery.error\" hidden>\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc5b4\uc694</div>",
      ].join('\n'),
      [
        "        <div class=\"lightbox-error\" data-lightbox-error hidden>\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc5b4\uc694</div>",
      ].join('\n'),
    ],
    [
      [
        "  _lightboxEl.setAttribute(\"aria-label\", t(\"feed.lightbox.name\"));",
        "  applyI18n(_lightboxEl);",
        "  applyLightbox();",
        "  _lightboxEl.classList.add(\"is-open\");",
      ].join('\n'),
      [
        "  applyLightbox();",
        "  _lightboxEl.classList.add(\"is-open\");",
      ].join('\n'),
    ],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('FEED_LIGHTBOX_LANGUAGES_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 432500 ||
      before.sha256 !== 'ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d' ||
      before.blob !== 'f18ceafed7678b5d42878e086cecd5e4ca096ac8') {
    throw new Error('FEED_LIGHTBOX_LANGUAGES_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  let forward = lf;
  for (const [owned, previous] of inverse) {
    const at = forward.indexOf(previous);
    if (at < 0 || forward.indexOf(previous, at + previous.length) !== -1) {
      throw new Error('FEED_LIGHTBOX_LANGUAGES_INVERSE_FORWARD_SUBSTITUTION_MISMATCH');
    }
    forward = forward.slice(0, at) + owned + forward.slice(at + previous.length);
  }
  if (forward !== admitted) throw new Error('FEED_LIGHTBOX_LANGUAGES_INVERSE_FORWARD_MISMATCH');
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedFeedLightboxFocusDelta(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIGHTBOX_FOCUS_INVERSE_STRING_REQUIRED');
  source = restoreOwnedFeedLightboxLanguagesDelta(source);
  let lf = source.replace(/\r\n/g, '\n');
  const crlf = source.includes('\r\n');
  if (lf.startsWith('\uFEFF') || lf.includes('\r') ||
      (crlf && source !== lf.replace(/\n/g, '\r\n'))) return source;
  if (Buffer.from(lf, 'utf8').toString('utf8') !== lf) return source;
  const after = identity(lf);
  const sha256 = 'ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d';
  const blob = 'f18ceafed7678b5d42878e086cecd5e4ca096ac8';
  if (after.sha256 !== sha256 && after.blob !== blob) return source;
  if (Buffer.byteLength(lf, 'utf8') !== 432500 || after.sha256 !== sha256 || after.blob !== blob) {
    throw new Error('FEED_LIGHTBOX_FOCUS_INVERSE_IDENTITY_MISMATCH');
  }
  const admitted = lf;
  const inverse = [
    [
      [
        "let _lightboxBodyOverflow = null;",
        "let _lightboxPreviousFocus = null;",
        "let _lightboxState",
      ].join('\n'),
      [
        "let _lightboxBodyOverflow = null;",
        "let _lightboxState",
      ].join('\n'),
    ],
    [
      [
        "  const wasOpen = _lightboxEl?.classList.contains(\"is-open\") === true;",
        "  const activeBeforeOpen = document.activeElement;",
        "  const ownedFocusBeforeOpen = wasOpen && _lightboxEl.contains?.(activeBeforeOpen) === true;",
        "  if (!wasOpen) _lightboxPreviousFocus = activeBeforeOpen;",
        "  _lightboxState",
      ].join('\n'),
      [
        "  const wasOpen = _lightboxEl?.classList.contains(\"is-open\") === true;",
        "  _lightboxState",
      ].join('\n'),
    ],
    [
      [
        "  _lightboxKeyHandler = e => {",
        "    if (e.key === \"Tab\") {",
        "      const focusable = [..._lightboxEl.querySelectorAll('button:not([disabled])')]",
        "        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== \"hidden\");",
        "      if (!focusable.length) { e.preventDefault(); return; }",
        "      const current = focusable.indexOf(document.activeElement);",
        "      if (current === -1 || (e.shiftKey ? current === 0 : current === focusable.length - 1)) {",
        "        e.preventDefault();",
        "        focusable[e.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true });",
        "      }",
        "      return;",
        "    }",
        "    if (e.key === \"Escape\")",
      ].join('\n'),
      [
        "  _lightboxKeyHandler = e => {",
        "    if (e.key === \"Escape\")",
      ].join('\n'),
    ],
    [
      [
        "  document.addEventListener(\"keydown\", _lightboxKeyHandler);",
        "  const active = document.activeElement;",
        "  const lostOwnedFocus = ownedFocusBeforeOpen &&",
        "    (!activeBeforeOpen.getClientRects().length || getComputedStyle(activeBeforeOpen).visibility === \"hidden\") &&",
        "    (active === activeBeforeOpen || active === document.body || active == null);",
        "  if (!wasOpen || lostOwnedFocus) {",
        "    _lightboxEl.querySelector(\".lightbox-close\")?.focus?.({ preventScroll: true });",
        "  }",
        "}",
      ].join('\n'),
      [
        "  document.addEventListener(\"keydown\", _lightboxKeyHandler);",
        "}",
      ].join('\n'),
    ],
    [
      [
        "function closeLightbox() {",
        "  if (!_lightboxEl?.classList.contains(\"is-open\")) return;",
        "  const previousFocus = _lightboxPreviousFocus;",
        "  const restoreFocus = _lightboxEl.contains?.(document.activeElement) === true;",
        "  _lightboxPreviousFocus = null;",
        "  _lightboxEl.classList.remove(\"is-open\");",
      ].join('\n'),
      [
        "function closeLightbox() {",
        "  if (!_lightboxEl?.classList.contains(\"is-open\")) return;",
        "  _lightboxEl.classList.remove(\"is-open\");",
      ].join('\n'),
    ],
    [
      [
        "    document.removeEventListener(\"keydown\", _lightboxKeyHandler);",
        "    _lightboxKeyHandler = null;",
        "  }",
        "  if (restoreFocus && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });",
        "}",
      ].join('\n'),
      [
        "    document.removeEventListener(\"keydown\", _lightboxKeyHandler);",
        "    _lightboxKeyHandler = null;",
        "  }",
        "}",
      ].join('\n'),
    ],
  ];
  for (const [owned, previous] of inverse) {
    const at = lf.indexOf(owned);
    if (at < 0 || lf.indexOf(owned, at + owned.length) !== -1) {
      throw new Error('FEED_LIGHTBOX_FOCUS_INVERSE_OWNED_SUBSTITUTION_MISMATCH');
    }
    lf = lf.slice(0, at) + previous + lf.slice(at + owned.length);
  }
  const before = identity(lf);
  if (Buffer.byteLength(lf, 'utf8') !== 431019 ||
      before.sha256 !== '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b' ||
      before.blob !== '45c8bc57f852130d8668d542aefdb7ad47aec5d8') {
    throw new Error('FEED_LIGHTBOX_FOCUS_INVERSE_RESTORED_IDENTITY_MISMATCH');
  }
  let forward = lf;
  for (const [owned, previous] of inverse) {
    const at = forward.indexOf(previous);
    if (at < 0 || forward.indexOf(previous, at + previous.length) !== -1) {
      throw new Error('FEED_LIGHTBOX_FOCUS_INVERSE_FORWARD_SUBSTITUTION_MISMATCH');
    }
    forward = forward.slice(0, at) + owned + forward.slice(at + previous.length);
  }
  if (forward !== admitted) throw new Error('FEED_LIGHTBOX_FOCUS_INVERSE_FORWARD_MISMATCH');
  return crlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function restoreOwnedFeedLightboxLifetimeDelta(source) {
  if (typeof source !== 'string') throw new TypeError('FEED_LIGHTBOX_INVERSE_STRING_REQUIRED');
  source = restoreOwnedFeedLightboxFocusDelta(source);
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

module.exports = { restoreOwnedNaverStateRequiredDelta, restoreOwnedSocialLoginCurrentnessDelta, restoreOwnedFeedLightboxLanguagesDelta, restoreOwnedFeedLightboxFocusDelta, restoreOwnedFeedLightboxLifetimeDelta, restoreOwnedAuthEntryHardeningDelta, restoreOwnedBootstrapDelta, restoreOwnedLoginDelta };

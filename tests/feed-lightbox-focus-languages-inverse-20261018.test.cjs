'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const inverse = require('./support/auth-login-failclosed-inverse-20261017.cjs');

function identity(text) {
  const bytes = Buffer.from(text, 'utf8');
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  };
}
const INPUT = {
  bytes: 432976,
  sha256: '5e4f1fbb89c82ca51c2b2cbf89707eac8dcdc571b6799a690e18fc065c235c4d',
  blob: '609d8253eebaa968b9654e4d961f197a20a8ba6e',
};
const CURRENT = {
  bytes: 432500,
  sha256: 'ac1c0c12da29ea90ee93c24224e39aa37b4833bc6fd070ccf60adbe93a0f593d',
  blob: 'f18ceafed7678b5d42878e086cecd5e4ca096ac8',
};
const PREVIOUS = {
  bytes: 431019,
  sha256: '653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b',
  blob: '45c8bc57f852130d8668d542aefdb7ad47aec5d8',
};
const bytes = readFileSync(join(__dirname, '../app.js'));
assert(bytes.length >= INPUT.bytes && bytes.length <= INPUT.bytes * 2, 'LANGUAGES_INVERSE_INPUT_BOUND');
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
assert.equal(decoded.startsWith('\uFEFF'), false, 'FOCUS_INVERSE_INPUT_BOM');
assert.equal(Buffer.from(decoded).equals(bytes), true, 'FOCUS_INVERSE_INPUT_UTF8');
const lf = text => text.replace(/\r\n/g, '\n');
const deliveredSource = lf(decoded);
assert.equal(deliveredSource.includes('\r'), false, 'LANGUAGES_INVERSE_INPUT_BARE_CR');
assert.equal(decoded === deliveredSource || decoded === deliveredSource.replace(/\n/g, '\r\n'), true, 'LANGUAGES_INVERSE_INPUT_UNIFORM_EOL');
const rawSource = inverse.restoreOwnedSocialLoginCurrentnessDelta(deliveredSource);
assert.deepEqual(identity(rawSource), INPUT, 'LANGUAGES_INVERSE_INPUT_WHOLE_IDENTITY');
const source = inverse.restoreOwnedFeedLightboxLanguagesDelta(rawSource);
assert.deepEqual(identity(source), CURRENT, 'FOCUS_INVERSE_INPUT_WHOLE_IDENTITY');
const eols = [text => text, text => text.replace(/\n/g, '\r\n')];
const names = [
  'restoreOwnedFeedLightboxLanguagesDelta',
  'restoreOwnedFeedLightboxFocusDelta',
  'restoreOwnedFeedLightboxLifetimeDelta',
  'restoreOwnedAuthEntryHardeningDelta',
  'restoreOwnedBootstrapDelta',
  'restoreOwnedLoginDelta',
];
const expectedHistorical = {
  restoreOwnedFeedLightboxLifetimeDelta: {
    sha256: 'be93793dc67d1bb0cd848dff28a3f1d212ac2bd09099ac1f959b8ee68b9d2fc2',
    blob: '8c9aba0a3cd35b11a676ee123d83f3f4fa84779e',
  },
  restoreOwnedAuthEntryHardeningDelta: {
    sha256: '5f5b2bd6e568a80d14bbf7c522a0b7e038dc3d116471bfc2bed92cb2c8ad8028',
    blob: '4e9e2f1861574d25bf6b7bfd9d61a1bd9966adb3',
  },
  restoreOwnedBootstrapDelta: {
    sha256: '7ee22fe15e52d715473fe8b0f26b344d3f66377a0827854bab2f80dd83463d36',
    blob: '4cf6cb0e00ef0ceb4c7276e56e5d8e4bbda24195',
  },
  restoreOwnedLoginDelta: {
    sha256: '1eb15f95ab8a43168b6cc7d8ffbe615c3ef827f7e6fd677da08d245fc769ae87',
    blob: '7c3a65b55c3e2f12623d3f782663c2e2233243a5',
  },
};
// Exact six registered source-contract pairs, owned/current first.
const deltas = [
  ["let _lightboxBodyOverflow = null;\nlet _lightboxPreviousFocus = null;\nlet _lightboxState", "let _lightboxBodyOverflow = null;\nlet _lightboxState"],
  ["  const wasOpen = _lightboxEl?.classList.contains(\"is-open\") === true;\n  const activeBeforeOpen = document.activeElement;\n  const ownedFocusBeforeOpen = wasOpen && _lightboxEl.contains?.(activeBeforeOpen) === true;\n  if (!wasOpen) _lightboxPreviousFocus = activeBeforeOpen;\n  _lightboxState", "  const wasOpen = _lightboxEl?.classList.contains(\"is-open\") === true;\n  _lightboxState"],
  ["  _lightboxKeyHandler = e => {\n    if (e.key === \"Tab\") {\n      const focusable = [..._lightboxEl.querySelectorAll('button:not([disabled])')]\n        .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== \"hidden\");\n      if (!focusable.length) { e.preventDefault(); return; }\n      const current = focusable.indexOf(document.activeElement);\n      if (current === -1 || (e.shiftKey ? current === 0 : current === focusable.length - 1)) {\n        e.preventDefault();\n        focusable[e.shiftKey ? focusable.length - 1 : 0].focus({ preventScroll: true });\n      }\n      return;\n    }\n    if (e.key === \"Escape\")", "  _lightboxKeyHandler = e => {\n    if (e.key === \"Escape\")"],
  ["  document.addEventListener(\"keydown\", _lightboxKeyHandler);\n  const active = document.activeElement;\n  const lostOwnedFocus = ownedFocusBeforeOpen &&\n    (!activeBeforeOpen.getClientRects().length || getComputedStyle(activeBeforeOpen).visibility === \"hidden\") &&\n    (active === activeBeforeOpen || active === document.body || active == null);\n  if (!wasOpen || lostOwnedFocus) {\n    _lightboxEl.querySelector(\".lightbox-close\")?.focus?.({ preventScroll: true });\n  }\n}", "  document.addEventListener(\"keydown\", _lightboxKeyHandler);\n}"],
  ["function closeLightbox() {\n  if (!_lightboxEl?.classList.contains(\"is-open\")) return;\n  const previousFocus = _lightboxPreviousFocus;\n  const restoreFocus = _lightboxEl.contains?.(document.activeElement) === true;\n  _lightboxPreviousFocus = null;\n  _lightboxEl.classList.remove(\"is-open\");", "function closeLightbox() {\n  if (!_lightboxEl?.classList.contains(\"is-open\")) return;\n  _lightboxEl.classList.remove(\"is-open\");"],
  ["    document.removeEventListener(\"keydown\", _lightboxKeyHandler);\n    _lightboxKeyHandler = null;\n  }\n  if (restoreFocus && previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true });\n}", "    document.removeEventListener(\"keydown\", _lightboxKeyHandler);\n    _lightboxKeyHandler = null;\n  }\n}"],
];

test('focus inverse restores only the complete admitted LF or CRLF app', () => {
  assert.deepEqual(Object.keys(inverse), ['restoreOwnedSocialLoginCurrentnessDelta', ...names], 'FOCUS_INVERSE_EXPORTS');
  for (const eol of eols) {
    const input = eol(source);
    const result = inverse.restoreOwnedFeedLightboxFocusDelta(input);
    const restored = lf(result);
    assert.deepEqual(identity(restored), PREVIOUS, 'FOCUS_INVERSE_RESTORED_WHOLE_IDENTITY');
    assert.equal(result === eol(restored), true, 'FOCUS_INVERSE_RESTORED_EOL');
    assert.equal(result !== input, true, 'FOCUS_INVERSE_NOT_NOOP');
    let forward = restored;
    for (const [owned, previous] of deltas) {
      assert.equal(forward.split(previous).length, 2, 'FOCUS_INVERSE_UNIQUE_FORWARD_PAIR');
      forward = forward.replace(previous, owned);
    }
    assert.equal(forward === source, true, 'FOCUS_INVERSE_EXACT_FORWARD');
    assert.deepEqual(identity(forward), CURRENT, 'FOCUS_INVERSE_FORWARD_WHOLE_IDENTITY');
  }
});

test('focus delta composes with all four historical inverses', () => {
  for (const eol of eols) for (const [name, expected] of Object.entries(expectedHistorical)) {
    const input = eol(source);
    const result = inverse[name](input);
    const actual = identity(lf(result));
    assert.deepEqual({ sha256: actual.sha256, blob: actual.blob }, expected, name);
    assert.equal(result === eol(lf(result)), true, 'FOCUS_INVERSE_HISTORICAL_EOL');
    const separate = inverse[name](inverse.restoreOwnedFeedLightboxFocusDelta(input));
    assert.equal(result === separate, true, 'FOCUS_INVERSE_HISTORICAL_COMPOSITION');
  }
});

test('previous lifetime app remains a no-op for the focus-only inverse', () => {
  const previous = inverse.restoreOwnedFeedLightboxFocusDelta(source);
  assert.deepEqual(identity(previous), PREVIOUS);
  for (const eol of eols) {
    const input = eol(previous);
    assert.equal(inverse.restoreOwnedFeedLightboxFocusDelta(input) === input, true, 'FOCUS_INVERSE_PREVIOUS_NOOP');
    for (const [name, expected] of Object.entries(expectedHistorical)) {
      const result = inverse[name](input);
      const actual = identity(lf(result));
      assert.deepEqual({ sha256: actual.sha256, blob: actual.blob }, expected, name);
      assert.equal(result === eol(lf(result)), true, 'FOCUS_INVERSE_PREVIOUS_HISTORICAL_EOL');
    }
  }
});

test('partial unknown tampered malformed sources are never projected', () => {
  const values = [
    '', 'synthetic unknown app', source.slice(282165, 288308), source.slice(0, -1), source + ' ',
    '!' + source.slice(1), source + deltas[0][0], '\uFEFF' + source,
    source.replace('\n', '\r\n'), source.replace('\n', '\r'), source + '\ud800', source + '\udc00',
  ];
  const previous = inverse.restoreOwnedFeedLightboxFocusDelta(source);
  for (const [owned, before] of deltas) {
    assert.equal(source.split(owned).length, 2, 'FOCUS_INVERSE_UNIQUE_PARTIAL_OWNED');
    assert.equal(previous.split(before).length, 2, 'FOCUS_INVERSE_UNIQUE_PARTIAL_PREVIOUS');
    values.push(source.replace(owned, before), previous.replace(before, owned));
  }
  assert.equal(values.length, 24, 'FOCUS_INVERSE_FINITE_MALFORMED_VALUES');
  for (const value of values) for (const eol of eols) for (const name of names) {
    const input = eol(value);
    assert.equal(inverse[name](input) === input, true, 'FOCUS_INVERSE_UNKNOWN_NOOP_' + name);
  }
});

test('focus inverse preserves new and historical non-string contracts', () => {
  const messages = {
    restoreOwnedFeedLightboxFocusDelta: 'FEED_LIGHTBOX_FOCUS_INVERSE_STRING_REQUIRED',
    restoreOwnedFeedLightboxLifetimeDelta: 'FEED_LIGHTBOX_INVERSE_STRING_REQUIRED',
    restoreOwnedAuthEntryHardeningDelta: 'AUTH_ENTRY_HARDENING_INVERSE_STRING_REQUIRED',
    restoreOwnedBootstrapDelta: 'AUTH_BOOTSTRAP_INVERSE_STRING_REQUIRED',
    restoreOwnedLoginDelta: 'AUTH_LOGIN_INVERSE_STRING_REQUIRED',
  };
  for (const value of [null, undefined, 0, false, {}, [], Buffer.from('synthetic')]) {
    for (const [name, message] of Object.entries(messages)) {
      assert.throws(() => inverse[name](value), error => error instanceof TypeError && error.message === message,
        'FOCUS_INVERSE_TYPE_CONTRACT_' + name);
    }
  }
});

// Five exact language-contract pairs; independent forward proof over full inputs.
const languageDeltas = [
  ["  \"detail.gallery.error\": { \"ko-KR\": \"\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.\", \"ja-JP\": \"\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\", \"en-US\": \"Image could not be loaded.\", \"zh-CN\": \"\u65e0\u6cd5\u52a0\u8f7d\u56fe\u7247\u3002\", \"zh-Hant\": \"\u7121\u6cd5\u8f09\u5165\u5716\u7247\u3002\" },\n  \"feed.lightbox.name\": { \"ko-KR\": \"\uc0ac\uc9c4 \ubcf4\uae30\", \"ja-JP\": \"\u753b\u50cf\u30d3\u30e5\u30fc\u30a2\", \"en-US\": \"Image viewer\", \"zh-CN\": \"\u56fe\u7247\u67e5\u770b\u5668\", \"zh-Hant\": \"\u5716\u7247\u6aa2\u8996\u5668\" },\n", "  \"detail.gallery.error\": { \"ko-KR\": \"\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc624\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4.\", \"ja-JP\": \"\u753b\u50cf\u3092\u8aad\u307f\u8fbc\u3081\u307e\u305b\u3093\u3067\u3057\u305f\u3002\", \"en-US\": \"Image could not be loaded.\", \"zh-CN\": \"\u65e0\u6cd5\u52a0\u8f7d\u56fe\u7247\u3002\", \"zh-Hant\": \"\u7121\u6cd5\u8f09\u5165\u5716\u7247\u3002\" },\n"],
  ["    _lightboxEl.setAttribute(\"aria-modal\", \"true\");\n    _lightboxEl.setAttribute(\"data-i18n-aria\", \"feed.lightbox.name\");\n", "    _lightboxEl.setAttribute(\"aria-modal\", \"true\");\n"],
  ["      <button class=\"lightbox-close\" type=\"button\" aria-label=\"\ub2eb\uae30\" data-i18n-aria=\"auth.modal.close\">\u00d7</button>\n      <button class=\"lightbox-prev\" type=\"button\" aria-label=\"\uc774\uc804 \uc774\ubbf8\uc9c0\" data-i18n-aria=\"detail.gallery.previous\">\u2039</button>\n      <button class=\"lightbox-next\" type=\"button\" aria-label=\"\ub2e4\uc74c \uc774\ubbf8\uc9c0\" data-i18n-aria=\"detail.gallery.next\">\u203a</button>", "      <button class=\"lightbox-close\" type=\"button\" aria-label=\"\ub2eb\uae30\">\u00d7</button>\n      <button class=\"lightbox-prev\" type=\"button\" aria-label=\"\uc774\uc804 \uc774\ubbf8\uc9c0\">\u2039</button>\n      <button class=\"lightbox-next\" type=\"button\" aria-label=\"\ub2e4\uc74c \uc774\ubbf8\uc9c0\">\u203a</button>"],
  ["        <div class=\"lightbox-error\" data-lightbox-error data-i18n=\"detail.gallery.error\" hidden>\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc5b4\uc694</div>", "        <div class=\"lightbox-error\" data-lightbox-error hidden>\uc774\ubbf8\uc9c0\ub97c \ubd88\ub7ec\uc62c \uc218 \uc5c6\uc5b4\uc694</div>"],
  ["  _lightboxEl.setAttribute(\"aria-label\", t(\"feed.lightbox.name\"));\n  applyI18n(_lightboxEl);\n  applyLightbox();\n  _lightboxEl.classList.add(\"is-open\");", "  applyLightbox();\n  _lightboxEl.classList.add(\"is-open\");"],
];
test('language inverse restores only the complete admitted LF or CRLF app', () => {
  for (const eol of eols) {
    const input = eol(rawSource);
    const result = inverse.restoreOwnedFeedLightboxLanguagesDelta(input);
    const restored = lf(result);
    assert.deepEqual(identity(restored), CURRENT, 'LANGUAGES_INVERSE_RESTORED_WHOLE_IDENTITY');
    assert.equal(result, eol(restored), 'LANGUAGES_INVERSE_RESTORED_EOL');
    assert.notEqual(result, input, 'LANGUAGES_INVERSE_NOT_NOOP');
    let forward = restored;
    for (const [owned, previous] of languageDeltas) {
      assert.equal(forward.split(previous).length, 2, 'LANGUAGES_INVERSE_UNIQUE_FORWARD_PAIR');
      forward = forward.replace(previous, owned);
    }
    assert.equal(forward, rawSource, 'LANGUAGES_INVERSE_EXACT_FORWARD');
    assert.deepEqual(identity(forward), INPUT, 'LANGUAGES_INVERSE_FORWARD_WHOLE_IDENTITY');
  }
});

test('language delta composes with the focus and all four historical inverses', () => {
  const expected = { restoreOwnedFeedLightboxFocusDelta: PREVIOUS, ...expectedHistorical };
  for (const eol of eols) for (const [name, fingerprint] of Object.entries(expected)) {
    const input = eol(rawSource);
    const result = inverse[name](input), actual = identity(lf(result));
    if (fingerprint.bytes !== undefined) assert.equal(actual.bytes, fingerprint.bytes, name);
    assert.deepEqual({ sha256: actual.sha256, blob: actual.blob },
      { sha256: fingerprint.sha256, blob: fingerprint.blob }, name);
    assert.equal(result, eol(lf(result)), 'LANGUAGES_INVERSE_HISTORICAL_EOL');
    const separate = inverse[name](inverse.restoreOwnedFeedLightboxLanguagesDelta(input));
    assert.equal(result, separate, 'LANGUAGES_INVERSE_HISTORICAL_COMPOSITION');
    assert.equal(result, inverse[name](eol(source)), 'LANGUAGES_INVERSE_PRIOR_CHAIN_UNCHANGED');
  }
});

test('language inverse leaves the exact prior focus and lifetime apps unchanged', () => {
  const versions = [[source, CURRENT], [inverse.restoreOwnedFeedLightboxFocusDelta(source), PREVIOUS]];
  for (const [previous, fingerprint] of versions) {
    assert.deepEqual(identity(previous), fingerprint, 'LANGUAGES_INVERSE_PREVIOUS_WHOLE_IDENTITY');
    for (const eol of eols) {
      const input = eol(previous);
      assert.equal(inverse.restoreOwnedFeedLightboxLanguagesDelta(input), input, 'LANGUAGES_INVERSE_PREVIOUS_NOOP');
    }
  }
});

test('language inverse never projects partial unknown tampered or malformed sources', () => {
  const values = [
    '', 'synthetic unknown app', rawSource.slice(282293, 288744), rawSource.slice(0, -1), rawSource + ' ',
    '!' + rawSource.slice(1), rawSource + languageDeltas[0][0], '\uFEFF' + rawSource,
    rawSource.replace('\n', '\r\n'), rawSource.replace('\n', '\r'), rawSource + '\ud800', rawSource + '\udc00',
  ];
  for (const [owned, previous] of languageDeltas) {
    assert.equal(rawSource.split(owned).length, 2, 'LANGUAGES_INVERSE_UNIQUE_PARTIAL_OWNED');
    assert.equal(source.split(previous).length, 2, 'LANGUAGES_INVERSE_UNIQUE_PARTIAL_PREVIOUS');
    values.push(rawSource.replace(owned, previous), source.replace(previous, owned));
  }
  assert.equal(values.length, 22, 'LANGUAGES_INVERSE_FINITE_MALFORMED_VALUES');
  for (const value of values) for (const eol of eols) for (const name of names) {
    const input = eol(value);
    assert.equal(inverse[name](input), input, 'LANGUAGES_INVERSE_UNKNOWN_NOOP_' + name);
  }
});

test('language inverse preserves new and historical non-string contracts', () => {
  const messages = {
    restoreOwnedFeedLightboxLanguagesDelta: 'FEED_LIGHTBOX_LANGUAGES_INVERSE_STRING_REQUIRED',
    restoreOwnedFeedLightboxFocusDelta: 'FEED_LIGHTBOX_FOCUS_INVERSE_STRING_REQUIRED',
    restoreOwnedFeedLightboxLifetimeDelta: 'FEED_LIGHTBOX_INVERSE_STRING_REQUIRED',
    restoreOwnedAuthEntryHardeningDelta: 'AUTH_ENTRY_HARDENING_INVERSE_STRING_REQUIRED',
    restoreOwnedBootstrapDelta: 'AUTH_BOOTSTRAP_INVERSE_STRING_REQUIRED',
    restoreOwnedLoginDelta: 'AUTH_LOGIN_INVERSE_STRING_REQUIRED',
  };
  assert.deepEqual(Object.keys(messages), names, 'LANGUAGES_INVERSE_TYPE_EXPORTS');
  for (const value of [null, undefined, 0, false, {}, [], Buffer.from('synthetic')]) {
    for (const [name, message] of Object.entries(messages)) {
      assert.throws(() => inverse[name](value), error => error instanceof TypeError && error.message === message,
        'LANGUAGES_INVERSE_TYPE_CONTRACT_' + name);
    }
  }
});

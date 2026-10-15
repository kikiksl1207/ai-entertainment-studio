'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
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
function htmlWithoutFeedSearchLocaleDelta(text) {
  assert.equal(typeof text, 'string');
  assert(!text.startsWith('\ufeff') && !/\r(?!\n)/.test(text), 'No BOM or lone CR');
  assert(!(text.includes('\r\n') && /(?<!\r)\n/.test(text)), 'Uniform LF or CRLF only');
  admitted(text, pins.current);
  assert.equal(text.split(after).length - 1, 1, 'One approved current feed script tag');
  assert.equal(text.split(before).length - 1, 0, 'No old feed script tag');
  const restored = text.replace(after, before);
  admitted(restored, pins.previous);
  assert.equal(restored.replace(before, after), text, 'Only the exact cache tag can advance');
  assert.equal(restored.includes('\r\n'), text.includes('\r\n'), 'Preserve the original uniform line-ending form');
  return restored;
}
module.exports = Object.freeze({ htmlWithoutFeedSearchLocaleDelta });

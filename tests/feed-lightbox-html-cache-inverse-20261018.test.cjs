'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { test } = require('node:test');
const { htmlWithoutFeedLightboxCacheDelta: restore, htmlWithoutFeedSearchLocaleDelta } =
  require('./support/feed-search-locale-html-inverse-20261015.cjs');
const bytes = readFileSync(join(__dirname, '../lumina-feed/index.html'));
assert(bytes.length >= 24596 && bytes.length <= 49192);
const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
assert(!decoded.startsWith('\uFEFF') && Buffer.from(decoded).equals(bytes));
const current = decoded.replace(/\r\n/g, '\n');
assert(!current.includes('\r') && (decoded === current || decoded === current.replace(/\n/g, '\r\n')));
const sha = text => createHash('sha256').update(text).digest('hex');
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
assert.equal(sha(current), 'f17604dabc043c07f1f382da2dfc510683bba3fa69bbb9074256418886b683c9');
assert.equal(blob(current), 'a4893cd696951c2a179a076f7a98c0d3d2ee160e');
const layouts = [text => text, text => text.replace(/\n/g, '\r\n')];
const lf = text => text.replace(/\r\n/g, '\n');
const query = '&amp;content=653ed7f0686e0c3d9ccd510706195034a4f3399eef3133bd540904b3722cb45b';

test('feed lightbox cache inverse restores the exact complete LF and CRLF predecessor', () => {
  for (const layout of layouts) {
    const restored = restore(layout(current));
    assert.equal(sha(lf(restored)), 'd778963f9f2fd7b9f410472ca434ba9a3bdf0b1e6c8c989b997599d5767a8d15');
    assert.equal(blob(lf(restored)), 'b1ff4c312396da36f63f9d38157332e0fc37995f');
    assert.equal(Buffer.byteLength(lf(restored)), 24519);
    assert.equal(restored, layout(lf(restored)));
    assert.equal(restored.replace('/app.js?v=wallet-session-20261011',
      '/app.js?v=wallet-session-20261011' + query), layout(current));
  }
});

test('feed lightbox cache inverse leaves predecessor and unrelated strings unchanged', () => {
  const previous = restore(current);
  for (const value of [previous, previous.replace(/\n/g, '\r\n'), '', 'unregistered HTML\n']) {
    assert.equal(restore(value), value);
  }
});

test('feed lightbox cache inverse never projects extra partial tampered or irregular input', () => {
  const values = [current + '<!-- extra -->', current.slice(0, -1), current + '\ud800',
    '\uFEFF' + current, current.replace('\n', '\r\n'), current.replace('\n', '\r'),
    current.replace(query, query.slice(0, -1) + '0'), current + '<script src="/app.js"></script>'];
  for (const value of values) for (const layout of layouts) {
    const input = layout(value);
    assert.equal(restore(input), input);
    assert.throws(() => htmlWithoutFeedSearchLocaleDelta(input));
  }
});

test('feed lightbox cache inverse composes with the unchanged locale inverse and historical pins', () => {
  for (const layout of layouts) {
    const restored = htmlWithoutFeedSearchLocaleDelta(layout(current));
    assert.equal(sha(lf(restored)), 'd96758293441989728c303b98280e502cbf43a62d458049c7bb4acd9c721753b');
    assert.equal(blob(lf(restored)), 'c40eecdf38f35093c4b54c49f1b00080f451e3e4');
    assert.equal(restored, layout(lf(restored)));
    assert(!restored.includes(query));
    assert.equal(restored.split('/app.js?v=wallet-session-20261011').length, 2);
  }
});

test('feed lightbox cache inverse rejects non-string values without changing the old wrapper contract', () => {
  for (const value of [null, undefined, 0, false, {}, [], Buffer.from('synthetic')]) {
    assert.throws(() => restore(value), error => error instanceof TypeError &&
      error.message === 'FEED_LIGHTBOX_HTML_INVERSE_STRING_REQUIRED');
    assert.throws(() => htmlWithoutFeedSearchLocaleDelta(value), { code: 'ERR_ASSERTION' });
  }
});

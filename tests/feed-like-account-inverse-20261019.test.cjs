'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const appFile = path.join(ROOT, 'app.js');
const helperFile = path.join(__dirname, 'support/feed-like-account-lifetime-inverse-20261019.cjs');
const tracked = [appFile, helperFile, __filename];
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
assert.ok(fs.statSync(appFile).size <= 1024 * 1024);
assert.ok([5709, 5845].includes(fs.statSync(helperFile).size), 'only pinned LF or uniform CRLF helper sizes');
const opening = tracked.map(file => sha(fs.readFileSync(file)));
const helperRaw = fs.readFileSync(helperFile);
let helperText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(helperRaw);
assert.equal(Buffer.from(helperText).equals(helperRaw), true);
assert.equal(helperText.startsWith('\uFEFF'), false);
if (helperText.includes('\r')) {
  const rest = helperText.replace(/\r\n/g, '');
  assert.equal(rest.includes('\r'), false);
  assert.equal(rest.includes('\n'), false);
  helperText = helperText.replace(/\r\n/g, '\n');
}
assert.equal(Buffer.byteLength(helperText), 5709);
assert.equal(sha(helperText), '3b1cad5e188b0f1a2b2112b426eade8ee8c2406ee81e5d9bc76d6c280c6ad403');
const raw = fs.readFileSync(appFile);
let app = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
assert.equal(Buffer.from(app).equals(raw), true);
assert.equal(app.startsWith('\uFEFF'), false);
if (app.includes('\r')) {
  const rest = app.replace(/\r\n/g, '');
  assert.equal(rest.includes('\r'), false);
  assert.equal(rest.includes('\n'), false);
  app = app.replace(/\r\n/g, '\n');
}
assert.equal(Buffer.byteLength(app), 434541);
assert.equal(sha(app), '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07');
const helpers = require(helperFile);
assert.deepEqual(Object.keys(helpers), ['restoreOwnedFeedLikeLifetime']);
const restore = helpers.restoreOwnedFeedLikeLifetime;

function assertBefore(value) {
  const bytes = Buffer.from(value);
  assert.equal(bytes.length, 433479);
  assert.equal(sha(bytes), '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61');
  assert.equal(blob(bytes), '892c0bd98d93e90f9ec257be57ba5ab7ac6cd75f');
}

test('Owned feed-like inverse restores only the whole admitted LF and uniform CRLF app', () => {
  const before = restore(app);
  assertBefore(before);
  assert.equal(restore(before), before, 'historical source is preserved on a second call');
  const crlf = app.replace(/\n/g, '\r\n');
  const restoredCrlf = restore(crlf);
  assert.equal(restoredCrlf, before.replace(/\n/g, '\r\n'));
  assertBefore(restoredCrlf.replace(/\r\n/g, '\n'));
  assert.equal(sha(fs.readFileSync(appFile)), opening[0], 'the physical product file is unchanged');
});

test('Unknown modified partial duplicated and malformed inputs are never admitted', () => {
  const at = app.indexOf('\n');
  const modified = app.replace('const pending = new WeakMap();', 'const pending = new Map();');
  assert.notEqual(modified, app);
  const inputs = [
    '', 'synthetic unknown source', app + ' ', modified,
    app.slice(0, -1), app + 'function bindLuminaFeedLike() {}\n',
    '\uFEFF' + app, app + '\uD800',
    app.slice(0, at) + '\r' + app.slice(at + 1),
    app.slice(0, at) + '\r\n' + app.slice(at + 1),
  ];
  for (const input of inputs) {
    assert.equal(restore(input), input);
    assert.notEqual(sha(input), '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61');
  }
  for (const input of [null, undefined, 0, false, {}, [], new String(app), Buffer.from(app)]) {
    assert.throws(() => restore(input), TypeError);
  }
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(file => sha(fs.readFileSync(file))), opening,
    'product helper and test remain unchanged');
});

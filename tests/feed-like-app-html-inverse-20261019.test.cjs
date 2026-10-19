'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const helperFile = path.join(__dirname, 'support/feed-like-app-html-inverse-20261019.cjs');
const editHelperFile = path.join(__dirname, 'support/feed-edit-app-html-inverse-20261020.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
const rows = [
  ['index.html', 20210, '7b44ebef67fe443952c956f202d1caf70c52ed0fcf414368bd81a45fc9634b13',
    'e4e18d9bae9d2c9add41424efb1423df8ba6dd490423fa7168dd62dd96f1864d', 'aa9fdc099927df4385f5119a527b7afcbf15fe51'],
  ['creator-studio/index.html', 62703, '2d2d45c97fc20e33489e43a189211748beb6af7ffaf8080a8fcb28d12acd2543',
    '07811e59dacfd174647bc4beedbc91aec27536690db2649485067547647889c9', '6a73fc57691fb11691009cf459da3b669b86519b'],
  ['lumina-feed/index.html', 24673, 'de3458eb06217b8eac86faab4e6d6325c90ddeff957b2ee35015edda187bb635',
    '4e0b216c07b2cb1ee64d19050295b23cb546e27c9b7b3bea79872778b9a9c7d1', 'b6f6b0841c9a440e4e00ab9eb0113992165cf112'],
];
assert.ok([3419, 3496].includes(fs.statSync(helperFile).size), 'only pinned LF or uniform CRLF helper sizes');
assert.ok([3284, 3359].includes(fs.statSync(editHelperFile).size), 'only pinned LF or uniform CRLF edit HTML helper sizes');
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
assert.equal(Buffer.byteLength(helperText), 3419);
assert.equal(sha(helperText), 'da77205835891dd62588eab8d54f1f39f2b74a357700c0f6477ef497a6d55bcd');
const tracked = [helperFile, editHelperFile, __filename, ...rows.map(row => path.join(ROOT, row[0]))];
for (const row of rows) assert.ok(fs.statSync(path.join(ROOT, row[0])).size <= 128 * 1024);
const opening = tracked.map(file => sha(fs.readFileSync(file)));
const editRaw = fs.readFileSync(editHelperFile);
assert.equal(sha(editRaw), opening[1]);
let editText = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(editRaw);
assert.equal(Buffer.from(editText).equals(editRaw), true);
assert.equal(editText.startsWith('\uFEFF'), false);
if (editText.includes('\r')) {
  const rest = editText.replace(/\r\n/g, '');
  assert.equal(rest.includes('\r'), false);
  assert.equal(rest.includes('\n'), false);
  editText = editText.replace(/\r\n/g, '\n');
}
assert.equal(Buffer.byteLength(editText), 3284);
assert.equal(sha(editText), '84cfc73baf1bed00a2632a99b47a97d18a53583ba08fb2f6aad2f1cdf5a44c3e');
assert.equal(blob(editText), '731a84589a79f7649d9895dbd4bef3b906845b7f');
const inputs = rows.map(row => {
  const file = path.join(ROOT, row[0]);
  const raw = fs.readFileSync(file);
  let text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text).equals(raw), true);
  assert.equal(text.startsWith('\uFEFF'), false);
  if (text.includes('\r')) {
    const rest = text.replace(/\r\n/g, '');
    assert.equal(rest.includes('\r'), false);
    assert.equal(rest.includes('\n'), false);
    text = text.replace(/\r\n/g, '\n');
  }
  assert.equal(Buffer.byteLength(text), row[1]);
  assert.equal(sha(text), row[2]);
  return { row, text };
});
const helpers = require(helperFile);
assert.deepEqual(Object.keys(helpers), ['restoreOwnedFeedLikeAppHtml']);
const restore = helpers.restoreOwnedFeedLikeAppHtml;
const oldHash = '7aac5b75851189fc919f26f5f64ba48c4910237a8c1f0b349a039d346b9d4b61';
const newHash = '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff';

test('Three whole HTML profiles restore exactly in LF and uniform CRLF with full forward equality', () => {
  for (const { row, text } of inputs) {
    const before = restore(text);
    const bytes = Buffer.from(before);
    assert.equal(bytes.length, row[1]);
    assert.equal(sha(bytes), row[3]);
    assert.equal(blob(bytes), row[4]);
    assert.equal(before.split(oldHash).length, 2);
    assert.equal(before.replace(oldHash, newHash), text);
    assert.equal(restore(before), before);
    assert.equal(restore(text.replace(/\n/g, '\r\n')), before.replace(/\n/g, '\r\n'));
  }
});

test('Unknown tampered duplicate partial and malformed HTML cannot acquire a historical view', () => {
  for (const { text } of inputs) {
    const at = text.indexOf('\n');
    const bad = [text + ' ', text.slice(0, -1), text + newHash, '\uFEFF' + text, text + '\uD800',
      text.replace(newHash, oldHash.slice(0, -1) + '0'),
      text.slice(0, at) + '\r' + text.slice(at + 1),
      text.slice(0, at) + '\r\n' + text.slice(at + 1)];
    for (const value of bad) assert.equal(restore(value), value);
  }
  assert.equal(restore('synthetic unknown HTML'), 'synthetic unknown HTML');
  for (const value of [null, undefined, 0, false, {}, [], new String('synthetic'), Buffer.from('synthetic')]) {
    assert.throws(() => restore(value), TypeError);
  }
});

process.once('exit', () => {
  assert.deepEqual(tracked.map(file => sha(fs.readFileSync(file))), opening,
    'HTML helper and guard inputs remain unchanged');
});

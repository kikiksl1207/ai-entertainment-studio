'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const helperFile = path.join(__dirname, 'support/feed-like-app-html-inverse-20261019.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
const rows = [
  ['index.html', 20210, 'd60181988fd81ac7f7645c9e1df5e49205df0e6fb1401bfccc12d114c0ffc6aa',
    'e4e18d9bae9d2c9add41424efb1423df8ba6dd490423fa7168dd62dd96f1864d', 'aa9fdc099927df4385f5119a527b7afcbf15fe51'],
  ['creator-studio/index.html', 62703, '12141298f58a5bcc1441295387132a64445ab0bd755bd12216f0af89830a4ed6',
    '07811e59dacfd174647bc4beedbc91aec27536690db2649485067547647889c9', '6a73fc57691fb11691009cf459da3b669b86519b'],
  ['lumina-feed/index.html', 24673, 'd01c4134bd859d6314b930ae4f16f6fbc10baa565908c640ff69c4da6e30a238',
    '4e0b216c07b2cb1ee64d19050295b23cb546e27c9b7b3bea79872778b9a9c7d1', 'b6f6b0841c9a440e4e00ab9eb0113992165cf112'],
];
assert.equal(fs.statSync(helperFile).size, 3277);
assert.equal(sha(fs.readFileSync(helperFile)), '2ff36bec87ab6ab3d0231817ce7653a79ac20697fcb986d7280df01a6b921ac3');
const tracked = [helperFile, __filename, ...rows.map(row => path.join(ROOT, row[0]))];
for (const row of rows) assert.ok(fs.statSync(path.join(ROOT, row[0])).size <= 128 * 1024);
const opening = tracked.map(file => sha(fs.readFileSync(file)));
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
const newHash = '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07';

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

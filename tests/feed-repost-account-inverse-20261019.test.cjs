'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sourceFile = path.join(ROOT, 'pages/lumina-feed.js');
const helperFile = path.join(ROOT, 'tests/support/feed-repost-account-lifetime-inverse-20261019.cjs');
const ownerHelperFile = path.join(ROOT, 'tests/support/feed-edit-modal-lifetime-inverse-20261019.cjs');
const files = [sourceFile, helperFile, __filename, ownerHelperFile];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const caps = [512 * 1024, 16 * 1024, 128 * 1024, 16 * 1024];
for (const [i, file] of files.entries()) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= caps[i], 'bound before allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
}
const opening = files.map(file => sha(fs.readFileSync(file)));
const raw = fs.readFileSync(sourceFile);
const text = raw.toString('utf8');
assert.equal(Buffer.from(text, 'utf8').equals(raw), true);
assert.equal(text.startsWith('\uFEFF'), false);
assert.equal(/\r(?!\n)/.test(text), false);
assert.equal(text.includes('\r\n') && /(?<!\r)\n/.test(text), false);
function readPinnedHelper(index, bytes, expectedSha, expectedBlob) {
  const input = fs.readFileSync(files[index]);
  assert.equal(sha(input), opening[index]);
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
  assert.equal(Buffer.from(decoded, 'utf8').equals(input), true);
  assert.notEqual(decoded.charCodeAt(0), 0xFEFF);
  assert.equal(/\r(?!\n)/.test(decoded), false);
  const lf = decoded.replace(/\r\n/g, '\n');
  assert.equal(decoded === lf || decoded === lf.replace(/\n/g, '\r\n'), true);
  const canonical = Buffer.from(lf, 'utf8');
  assert.equal(canonical.length, bytes);
  assert.equal(sha(canonical), expectedSha);
  assert.equal(blob(canonical), expectedBlob);
}
readPinnedHelper(3, 9615, '93c4de9c4df3cc65ceeee081c57c5b95320428552b363813e6dbad024b2df8ad', '3265048e8ad17481b0892ce57932a7939010e212');
readPinnedHelper(1, 4624, '67596fef0bcd2efe49395f6aa826f08a372e51f3e7c1eeee20ded47ea6a9dc60', 'd6fd3d94371765151b5f5acd35ed920ac8ecd0ab');
const actual = text.replace(/\r\n/g, '\n');
assert.equal(Buffer.byteLength(actual), 141156);
assert.equal(sha(actual), '67de05ce0342e26be6a06e2261d1380f8f81a49e6bcaf52ba09e900d7102b207');
assert.equal(blob(Buffer.from(actual, 'utf8')), '4ee9e314b7e34059b007adeb252f8dd8f76e9f06');
const ownerView = require(ownerHelperFile).restoreOwnedFeedEditAccountFeed(actual);
assert.equal(Buffer.byteLength(ownerView), 141110);
assert.equal(sha(ownerView), '4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b');
assert.equal(blob(Buffer.from(ownerView, 'utf8')), 'c26788917d62a5517190764ca8fa74269be25f25');
const current = ownerView;
const helper = require(helperFile);
const restore = helper.feedWithoutRepostAccountLifetimeDelta;

test('Repost account whole-source inverse preserves exact predecessor and uniform line endings', () => {
  assert.deepEqual(Object.keys(helper), ['feedWithoutRepostAccountLifetimeDelta']);
  assert.equal(Object.isFrozen(helper), true);
  assert.equal(Buffer.byteLength(current), 141110);
  assert.equal(sha(current), '4f026d788f7e1dfeae1fe36df495070d78a85540830325484094c14b66dac91b');
  assert.equal(blob(Buffer.from(current)), 'c26788917d62a5517190764ca8fa74269be25f25');
  for (const input of [current, current.replace(/\n/g, '\r\n')]) {
    const previous = restore(input);
    const lf = previous.replace(/\r\n/g, '\n');
    assert.equal(Buffer.byteLength(lf), 140113);
    assert.equal(sha(lf), '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4');
    assert.equal(blob(Buffer.from(lf)), '4698f985e99ee52f0a630984cdf51f75c36c7f3a');
    assert.equal(previous.includes('\r\n'), input.includes('\r\n'));
    assert.equal(previous, input.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf);
    assert.equal(restore(previous), previous);
  }
});

test('Repost account whole-source inverse never repairs unknown partial malformed or non-string input', () => {
  const partial = current.replace('  function clearFeedOnAccountChange() {\n    retireRepostOnAccountChange();\n',
    '  function clearFeedOnAccountChange() {\n');
  assert.notEqual(partial, current);
  const unrelated = ['', 'synthetic unrelated source', current + ' ', current.slice(1),
    current.replace('function ownsComposer() {', 'function differentOwner() {'), partial];
  for (const original of unrelated) {
    for (const input of [original, original.replace(/\n/g, '\r\n')]) assert.equal(restore(input), input);
  }
  for (const input of ['\uFEFF' + current, current.replace('\n', '\r'),
    current.replace('\n', '\r\n'), '\uD800' + current, current + '\uDC00']) {
    assert.equal(restore(input), input);
  }
  let coerced = 0;
  const hostile = { toString() { coerced++; return current; } };
  for (const input of [null, undefined, 0, false, {}, [], new String(current), hostile]) {
    assert.throws(() => restore(input), {
      name: 'TypeError', message: 'REPOST_ACCOUNT_INVERSE_STRING_REQUIRED' });
  }
  assert.equal(coerced, 0);
});

process.once('exit', () => {
  assert.deepEqual(files.map(file => sha(fs.readFileSync(file))), opening);
});

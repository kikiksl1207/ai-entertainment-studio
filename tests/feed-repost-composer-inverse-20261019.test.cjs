'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const sourceFile = path.join(ROOT, 'pages/lumina-feed.js');
const helperFile = path.join(ROOT, 'tests/support/feed-repost-composer-lifetime-inverse-20261019.cjs');
const files = [sourceFile, helperFile, __filename];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const opening = files.map(file => sha(fs.readFileSync(file)));
const raw = fs.readFileSync(sourceFile);
const text = raw.toString('utf8');
assert.equal(Buffer.from(text, 'utf8').equals(raw), true);
assert.equal(text.startsWith('\uFEFF'), false);
assert.equal(/\r(?!\n)/.test(text), false);
assert.equal(text.includes('\r\n') && /(?<!\r)\n/.test(text), false);
const current = text.replace(/\r\n/g, '\n');
const helper = require(helperFile);
const restore = helper.feedWithoutRepostComposerLifetimeDelta;

test('Repost whole-source inverse preserves exact predecessor and uniform line endings', () => {
  assert.deepEqual(Object.keys(helper), ['feedWithoutRepostComposerLifetimeDelta']);
  assert.equal(Object.isFrozen(helper), true);
  assert.equal(Buffer.byteLength(current), 140113);
  assert.equal(sha(current), '29537a1f381992c63ffd6b1c40255d1466918a1a287dcf5cf2fdc16c27b0d1e4');
  assert.equal(blob(Buffer.from(current)), '4698f985e99ee52f0a630984cdf51f75c36c7f3a');
  for (const input of [current, current.replace(/\n/g, '\r\n')]) {
    const previous = restore(input);
    const lf = previous.replace(/\r\n/g, '\n');
    assert.equal(Buffer.byteLength(lf), 139831);
    assert.equal(sha(lf), 'ee7c440a7e84c54924c686b6c0016f690247f53b90ec076714ecba860b499fbe');
    assert.equal(blob(Buffer.from(lf)), 'eaa0ffbbae0cd3b7b0121b0c79a92d4244bcbcb5');
    assert.equal(previous.includes('\r\n'), input.includes('\r\n'));
    assert.equal(previous, input.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf);
    assert.equal(restore(previous), previous);
  }
});

test('Repost whole-source inverse never repairs unknown partial malformed or non-string input', () => {
  const partial = current.replace('    modal.dataset.busy = "0";\n    modal.hidden = false;',
    '    modal.hidden = false;');
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
      name: 'TypeError', message: 'REPOST_COMPOSER_INVERSE_STRING_REQUIRED' });
  }
  assert.equal(coerced, 0);
});

process.once('exit', () => {
  assert.deepEqual(files.map(file => sha(fs.readFileSync(file))), opening);
});

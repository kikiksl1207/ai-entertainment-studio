'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update('blob ' + value.length + '\0').update(value).digest('hex');
const OLD = '848556f38941670e90cdec3dc491d387b9c00a6f369cc6aa00002c64fb1dca07';
const NEW = '4730707c2fae82363401f6f11dc5dc3daa68b9bb88b151ffdcec37e65c5e73ff';
const profiles = [
  ['index.html', 20210,
    '7b44ebef67fe443952c956f202d1caf70c52ed0fcf414368bd81a45fc9634b13',
    '1b6fa9bea72d812a4fa8114617022562ee78e1bb',
    'd60181988fd81ac7f7645c9e1df5e49205df0e6fb1401bfccc12d114c0ffc6aa',
    'c0c36bfae35ef0558eb70d80f12ee8c9be97a63f'],
  ['creator-studio/index.html', 62703,
    '2d2d45c97fc20e33489e43a189211748beb6af7ffaf8080a8fcb28d12acd2543',
    '066cae438ba07f5f9abac3f84d456568f0fb3fb8',
    '12141298f58a5bcc1441295387132a64445ab0bd755bd12216f0af89830a4ed6',
    'd89d03a2fd7dad25cb5512b928ef5cded854f55f'],
  ['lumina-feed/index.html', 24673,
    'de3458eb06217b8eac86faab4e6d6325c90ddeff957b2ee35015edda187bb635',
    '50101004cccc3ccc9d73c65f9385834d6febb87f',
    'd01c4134bd859d6314b930ae4f16f6fbc10baa565908c640ff69c4da6e30a238',
    '0773eec72d89b611e2bb145c9babf430f87ce35a'],
];
const helper = path.join(ROOT, 'tests/support/feed-edit-app-html-inverse-20261020.cjs');
const files = [helper, ...profiles.map(row => path.join(ROOT, row[0])), __filename];
function read(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.ok(stat.size > 0 && stat.size <= 128 * 1024, 'size before allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.length, stat.size);
  return bytes;
}
function canonical(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  assert.equal(Buffer.from(text, 'utf8').equals(bytes), true);
  assert.notEqual(text.charCodeAt(0), 0xFEFF);
  assert.equal(/\r(?!\n)/.test(text), false);
  const lf = text.replace(/\r\n/g, '\n');
  assert.ok(text === lf || text === lf.replace(/\n/g, '\r\n'));
  return lf;
}
const opening = files.map(read);
after(() => files.forEach((file, i) => assert.equal(read(file).equals(opening[i]), true)));
const helperBytes = Buffer.from(canonical(opening[0]));
assert.equal(helperBytes.length, 3284);
assert.equal(sha(helperBytes), '84cfc73baf1bed00a2632a99b47a97d18a53583ba08fb2f6aad2f1cdf5a44c3e');
const fixtures = profiles.map((row, i) => {
  const current = canonical(opening[i + 1]);
  const bytes = Buffer.from(current);
  assert.equal(bytes.length, row[1]);
  assert.equal(sha(bytes), row[2]);
  assert.equal(blob(bytes), row[3]);
  assert.equal(current.split(NEW).length, 2);
  const previous = current.replace(NEW, OLD);
  const previousBytes = Buffer.from(previous);
  assert.equal(previousBytes.length, row[1]);
  assert.equal(sha(previousBytes), row[4]);
  assert.equal(blob(previousBytes), row[5]);
  assert.equal(previous.split(OLD).length, 2);
  assert.equal(previous.replace(OLD, NEW), current);
  return { current, previous };
});
const { restoreOwnedFeedEditAppHtml: restore } = require(helper);

test('edit HTML query inverse restores only the three exact LF and CRLF views', () => {
  for (const { current, previous } of fixtures) {
    assert.equal(restore(current), previous);
    assert.equal(restore(current.replace(/\n/g, '\r\n')), previous.replace(/\n/g, '\r\n'));
    assert.equal(restore(previous), previous, 'previous release remains untouched');
  }
});

test('edit HTML query inverse rejects coercion and leaves malformed or unknown text unchanged', () => {
  let coercions = 0;
  const object = { toString() { coercions++; throw new Error('UNEXPECTED_COERCION'); } };
  for (const value of [null, undefined, 0, object, new String(fixtures[0].current)]) {
    assert.throws(() => restore(value), { name: 'TypeError', message: 'FEED_EDIT_APP_HTML_INVERSE_STRING_REQUIRED' });
  }
  assert.equal(coercions, 0);
  assert.equal(restore('unknown text'), 'unknown text');
  for (const { current } of fixtures) {
    const variants = [
      '\uFEFF' + current,
      current.replace('\n', '\r\n'),
      current + '\r',
      current + '\ud800',
      current.replace(NEW, '0'.repeat(64)),
      current + NEW,
      current.slice(0, -1) + 'x',
    ];
    for (const value of variants) assert.equal(restore(value), value);
  }
});

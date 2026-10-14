import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { decodePinnedReadingSource } from './support/owner-reading-source-pin-20261015.mjs';

const lf = Buffer.from('const value = "synthetic";\nvalue;\n');
const crlf = Buffer.from(lf.toString().replace(/\n/g, '\r\n'));
const pins = bytes => [createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'),
  createHash('sha256').update(bytes).digest('hex')];

test('reader source pins admit only equivalent uniform LF and CRLF without rewriting returned source', () => {
  for (const expected of [lf, crlf]) for (const actual of [lf, crlf])
    assert.equal(decodePinnedReadingSource(actual, ...pins(expected)), actual.toString());
});

test('reader source pins reject mixed endings, lone carriage returns and a BOM', () => {
  for (const actual of [Buffer.from('const value = "synthetic";\r\nvalue;\n'),
    Buffer.from('const value = "synthetic";\rvalue;\r'), Buffer.concat([Buffer.from([239, 187, 191]), lf])])
    assert.throws(() => decodePinnedReadingSource(actual, ...pins(lf)));
});

test('reader source pins reject changed content, removed or extra terminal newlines', () => {
  for (const actual of [Buffer.from(lf.toString().replace('synthetic', 'changed')),
    lf.subarray(0, lf.length - 1), Buffer.concat([lf, Buffer.from('\n')])])
    assert.throws(() => decodePinnedReadingSource(actual, ...pins(lf)));
});

test('reader source pins require both fingerprints to match the same representation', () => {
  const [lfBlob, lfSha] = pins(lf), [crlfBlob, crlfSha] = pins(crlf);
  assert.throws(() => decodePinnedReadingSource(lf, lfBlob, crlfSha));
  assert.throws(() => decodePinnedReadingSource(crlf, crlfBlob, lfSha));
});

test('reader source pins reject invalid fingerprints, invalid UTF-8 and unbounded buffers', () => {
  const [blob, sha] = pins(lf);
  for (const actual of [Buffer.alloc(0), Buffer.alloc(131073), Buffer.from([255]), lf.toString()])
    assert.throws(() => decodePinnedReadingSource(actual, blob, sha));
  for (const [badBlob, badSha] of [['0', sha], [blob, '0'], [blob.toUpperCase(), sha]])
    assert.throws(() => decodePinnedReadingSource(lf, badBlob, badSha));
});

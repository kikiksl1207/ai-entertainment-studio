'use strict';

// AUTHOR/UNRUN: pure entry-query data restoration, not UI cancellation behavior.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

const ROOT = path.resolve(__dirname, '..');
const CAP = 128 * 1024;
const OLD_URL = '/pages/creator-story-interactions.js?v=interactions-20261001';
const NEW_URL = '/pages/creator-story-interactions.js?v=interactions-cancel-20261020-6eb98ed7';
const BEFORE = {
  lf: { bytes: 62703, sha256: '03764953dfd8fbb359f185051070f6adf0a50e84c0f6071580abff52e133a5b8',
    blob: '7211a8d47738a397d0453d5708a68e4e3a9682a1' },
  crlf: { bytes: 63507, sha256: 'd43cb981b40be46c548cc10a51a3b544281134207400d1c0110b024616447be4',
    blob: 'e58b4deb1d87c84006f6c811c22046e109d5c1c5' },
};
const INPUTS = [
  {
    relative: 'creator-studio/index.html',
    lf: { bytes: 62719, sha256: '41a27d40735a83e98d5a6977df20082748a3fa81e72fd3528c8240088cb6ef6a',
      blob: '1a20a15b1f0814d722b97bb1abc12f32411c4e58' },
    crlf: { bytes: 63523, sha256: '77123c64ff7c6ce94bf36868fcea6f8d2fa2e2e5451a36a7683aab2e6b5c131d',
      blob: '10286286828722a4e8e6293dd77c75849e316992' },
  },
  {
    relative: 'tests/support/creator-interaction-cancel-inverse-20261020.cjs',
    lf: { bytes: 2382, sha256: '7a181fceda5853dd17dd3fbe604cd32d4098e629428771af5d2ab4cc381984c6',
      blob: '9dfc855aca5dbc50ebdac3e8f6a92b928174c4bc' },
    crlf: { bytes: 2435, sha256: 'ae2697cd3411c2b65e50263fd1e1c8ded29234ec2b1598cbd1dd697ecebf4061',
      blob: '7a61ba03a275323a36722fb5094e992d36abf8b7' },
  },
];

function identity(bytes) {
  return { bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    blob: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
}
function assertIdentity(bytes, expected, label) {
  assert.deepEqual(identity(bytes), expected, label);
}
function readBounded(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'ordinary non-symbolic input');
  assert.ok(stat.size > 0 && stat.size <= CAP, '128KiB cap BEFORE read/allocation');
  assert.equal(fs.realpathSync.native(file).toLowerCase(), path.resolve(file).toLowerCase());
  const raw = fs.readFileSync(file);
  assert.equal(raw.length, stat.size, 'read length matches opening stat');
  return raw;
}
function textView(raw) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  assert.equal(Buffer.from(text, 'utf8').equals(raw), true, 'fatal UTF8 roundtrip');
  assert.notEqual(text.charCodeAt(0), 0xFEFF, 'no BOM');
  assert.equal(/\r(?!\n)/.test(text), false, 'no bare CR');
  const lf = text.replace(/\r\n/g, '\n');
  assert.ok(text === lf || text === lf.replace(/\n/g, '\r\n'), 'LF or uniform CRLF only');
  return { lf, crlf: text !== lf };
}
function replaceUnique(text, from, to) {
  const at = text.indexOf(from);
  assert.ok(from.length > 0 && at >= 0 && text.indexOf(from, at + 1) === -1,
    'independent literal DATA occurs exactly once');
  return text.slice(0, at) + to + text.slice(at + from.length);
}
const styled = (text, style) => style === 'CRLF' ? text.replace(/\n/g, '\r\n') : text;
const tracked = INPUTS.map(row => ({ file: path.join(ROOT, row.relative) }));
tracked.push({ file: __filename });
assert.equal(tracked.length, 3);
const opening = tracked.map(row => readBounded(row.file));
const openingPins = opening.map(identity);
after(() => {
  const errors = [];
  for (let i = 0; i < tracked.length; i++) {
    try {
      const closing = readBounded(tracked[i].file);
      assert.equal(closing.equals(opening[i]), true, 'closing complete raw bytes ' + i);
      assertIdentity(closing, openingPins[i], 'closing raw length/SHA/blob ' + i);
    } catch (error) { errors.push(error); }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'All three closing vectors attempted');
});
const canonical = INPUTS.map((row, i) => {
  const actual = identity(opening[i]);
  const rawProfile = [row.lf, row.crlf].find(expected => actual.bytes === expected.bytes &&
    actual.sha256 === expected.sha256 && actual.blob === expected.blob);
  assert.ok(rawProfile, 'exact whole raw input BEFORE decode/import: ' + row.relative);
  assertIdentity(opening[i], rawProfile, 'raw input identity ' + row.relative);
  const view = textView(opening[i]);
  assert.equal(view.crlf, rawProfile === row.crlf);
  assertIdentity(Buffer.from(view.lf, 'utf8'), row.lf, 'canonical whole input ' + row.relative);
  return view.lf;
});
textView(opening[2]);
const beforeHtml = replaceUnique(canonical[0], NEW_URL, OLD_URL);
assertIdentity(Buffer.from(beforeHtml, 'utf8'), BEFORE.lf, 'independent exact old HTML DATA');
// Every physical subject/helper identity above is admitted before target import.
const helper = require(tracked[1].file);
const restore = helper.restoreCreatorInteractionCancelHtml;

test('exact LF and uniform CRLF entry HTML restore one query with a full roundtrip', () => {
  for (const style of ['LF', 'CRLF']) {
    const input = styled(canonical[0], style);
    const restored = restore(input);
    assert.equal(restored, styled(beforeHtml, style), 'independent whole old HTML');
    assertIdentity(Buffer.from(restored, 'utf8'), style === 'CRLF' ? BEFORE.crlf : BEFORE.lf,
      'exact restored physical identity');
    const view = textView(Buffer.from(restored, 'utf8'));
    assert.equal(view.crlf, style === 'CRLF');
    assertIdentity(Buffer.from(view.lf, 'utf8'), BEFORE.lf, 'exact restored canonical identity');
    const forward = replaceUnique(restored, OLD_URL, NEW_URL);
    assert.equal(forward, input, 'only one literal changes, all outside bytes preserved');
    assertIdentity(Buffer.from(forward, 'utf8'), style === 'CRLF' ? INPUTS[0].crlf : INPUTS[0].lf,
      'exact complete forward physical identity');
  }
});

test('old unrelated poisoned and malformed strings remain unchanged', () => {
  for (const style of ['LF', 'CRLF']) {
    const input = styled(canonical[0], style);
    const old = styled(beforeHtml, style), eol = style === 'CRLF' ? '\r\n' : '\n';
    assert.equal(restore(old), old, 'known old HTML is not another restoration stage');
    const variants = [
      ['empty', ''],
      ['unrelated', '<!doctype html><p>Unrelated source</p>' + eol],
      ['new URL alone', NEW_URL],
      ['old URL alone', OLD_URL],
      ['BOM', '\uFEFF' + input],
      ['mixed EOL', input.replace(eol, style === 'CRLF' ? '\n' : '\r\n')],
      ['bare CR', input.replace(eol, '\r')],
      ['unpaired high', input + '\uD800'],
      ['unpaired low', input + '\uDC00'],
      ['NUL', input + '\0'],
      ['trailing newline', input + eol],
      ['trailing mutation', input + 'x'],
      ['owned mutation', replaceUnique(input, NEW_URL, '!' + NEW_URL.slice(1))],
      ['outside mutation', 'X' + input.slice(1)],
      ['duplicate URL', input + NEW_URL],
    ];
    for (const [label, value] of variants) assert.equal(restore(value), value, label + '/' + style);
  }
});

test('the sole named export rejects nonstrings without coercion', () => {
  assert.deepEqual(Object.keys(helper), ['restoreCreatorInteractionCancelHtml']);
  assert.equal(typeof restore, 'function');
  let coercions = 0;
  const poison = {
    [Symbol.toPrimitive]() { coercions++; throw new Error('COERCION_FORBIDDEN'); },
    toString() { coercions++; throw new Error('COERCION_FORBIDDEN'); },
    valueOf() { coercions++; throw new Error('COERCION_FORBIDDEN'); },
  };
  const nonstrings = [undefined, null, false, 42, 1n, Symbol('not-html'), [], {},
    function notHtml() {}, new String('boxed HTML'), Buffer.from('buffer HTML'), poison];
  for (const value of nonstrings) {
    assert.throws(() => restore(value), error => error instanceof TypeError &&
      error.message === 'CREATOR_INTERACTION_CANCEL_HTML_INVERSE_STRING_REQUIRED');
    assert.equal(coercions, 0);
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { sourceWithoutCreatorsReadDelta } from './support/backstage-creators-read-inverse-compat-20261009.mjs';

const current = readFileSync(new URL('../backstage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/backstage-creators-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const first = current.indexOf(fixture.startMarker), last = current.indexOf(fixture.endMarker, first);
assert(first >= 0 && last > first, 'Prepared inverse source boundaries');
const original = () => current.slice(0, first) + fixture.beforeFullText + current.slice(last);
const rejects = (source, delta = fixture) => assert.throws(
  () => sourceWithoutCreatorsReadDelta(source, delta), { code: 'ERR_ASSERTION' });

test('exact current creator read source restores the original1843 LF source and outside bytes', () => {
  assert.equal(sha(current), 'cbb64fbe98ccfc2b84bb73d1ebcbf85ff8513d062032b8d8c1d12b60de0c0341');
  const restored = sourceWithoutCreatorsReadDelta(current);
  assert.equal(sha(restored), '1843ebacfa7779c72756263196e930c2b8a45d5211bca617fa3d7f629bbfb409');
  assert.equal(restored, original());
  assert.equal(restored.slice(0, first), current.slice(0, first));
  assert.equal(restored.slice(first + fixture.beforeFullText.length), current.slice(last));
});

test('checkout CRLF is the only source normalization accepted', () => {
  assert.equal(sourceWithoutCreatorsReadDelta(current.replace(/\n/g, '\r\n')), original());
  rejects(current.replace(/\n/g, '\r'));
});

test('source changes before within or after the owned interval are rejected', () => {
  for (const value of [
    '// synthetic prefix tamper\n' + current,
    current.replace(fixture.startMarker, fixture.startMarker + '\n// synthetic interval tamper'),
    current + '\n// synthetic suffix tamper\n',
  ]) {
    assert.notEqual(value, current);
    rejects(value);
  }
});

test('old source and missing or duplicated source boundaries cannot bypass current admission', () => {
  rejects(original());
  rejects(current.replace(fixture.startMarker, 'async function sourceRemoved() {'));
  rejects(current.slice(0, last) + fixture.afterFullText + current.slice(last));
});

test('inverse and forward fixture text content or types cannot be replaced', () => {
  for (const field of ['beforeFullText', 'afterFullText']) {
    const content = clone(fixture); content[field] += '\n// synthetic fixture tamper\n';
    rejects(current, content);
    const type = clone(fixture); type[field] = null;
    rejects(current, type);
  }
});

test('fixture scope pins boundary names count and extra keys are exact', () => {
  for (const field of ['scope', 'beforeSHA256', 'afterSHA256', 'prefixSHA256', 'suffixSHA256',
    'beforeFullTextSHA256', 'afterFullTextSHA256', 'startMarker', 'endMarker']) {
    const value = clone(fixture); value[field] += '!'; rejects(current, value);
  }
  const count = clone(fixture); count.fullTextFunctionCount = 2; rejects(current, count);
  const names = clone(fixture); names.names.push('otherFunction'); rejects(current, names);
  const extra = clone(fixture); extra.unadmitted = true; rejects(current, extra);
});

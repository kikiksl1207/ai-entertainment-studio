import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutPrivateReadDelta } from './support/mypage-private-read-inverse-20261009.mjs';
import { htmlWithoutActivationReadDelta } from './support/mypage-activation-read-inverse-20261009.mjs';

const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/mypage-private-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

test('private read exact inverse preserves the earlier participation protection', () => {
  const previous = htmlWithoutPrivateReadDelta(html);
  assert.equal(sha(previous), fixture.beforeSHA256);
  assert.match(previous, /activationProgressRead = null/);
  assert.match(previous, /throwOnError: true/);
  assert.match(previous, /async function claimActivationReward/);
  assert.equal(htmlWithoutPrivateReadDelta(previous), previous);
});

test('both narrow inverse stages restore all earlier HTML bytes', () => {
  assert.equal(sha(htmlWithoutActivationReadDelta(html)), 'c0c66abe67eba7747d6a3694a10b786e69e3cf218f805d6eb97b1fff55546a0e');
});

test('private inverse cannot forgive unrelated HTML or altered protected methods', () => {
  assert.throws(() => htmlWithoutPrivateReadDelta(html + '\n<!-- synthetic unrelated -->'));
  assert.throws(() => htmlWithoutPrivateReadDelta(html.replace('loadMypageSummary.currentRead = read;', 'loadMypageSummary.currentRead = null;')));
  assert.throws(() => htmlWithoutPrivateReadDelta(html.replace('async function claimActivationReward', 'async function syntheticChangedClaim')));
});

test('altered fixture scope, pins or restoration data cannot pass', () => {
  for (const key of ['scope', 'beforeSHA256', 'afterSHA256']) {
    const changed = structuredClone(fixture); changed[key] = 'synthetic-change';
    assert.throws(() => htmlWithoutPrivateReadDelta(html, changed));
  }
  const changed = structuredClone(fixture);
  changed.changes[0].before += '\n// synthetic unexpected';
  assert.throws(() => htmlWithoutPrivateReadDelta(html, changed));
});

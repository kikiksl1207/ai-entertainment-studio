import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { htmlWithoutFollowingReadDelta } from './support/mypage-following-read-inverse-20261009.mjs';
import { htmlWithoutPrivateReadDelta } from './support/mypage-private-read-inverse-20261009.mjs';
import { htmlWithoutActivationReadDelta } from './support/mypage-activation-read-inverse-20261009.mjs';

const html = readFileSync(new URL('../mypage/index.html', import.meta.url), 'utf8');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/mypage-following-read-exact-delta-20261009.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');

test('one following inverse preserves the earlier private read guards', () => {
  const previous = htmlWithoutFollowingReadDelta(html);
  assert.equal(sha(previous), fixture.beforeSHA256);
  assert.match(previous, /loadMypageSummary.currentRead = read/);
  assert.match(previous, /loadMypageSettings.currentRead = read/);
  assert.equal(htmlWithoutFollowingReadDelta(previous), previous);
});

test('exact three-stage chain restores both prior complete HTML hashes', () => {
  assert.equal(sha(htmlWithoutPrivateReadDelta(html)), '4bd1baac13f7c048acd4d5d145d15fdc42df7501f7fecb791204dc5571f7235e');
  assert.equal(sha(htmlWithoutActivationReadDelta(html)), 'c0c66abe67eba7747d6a3694a10b786e69e3cf218f805d6eb97b1fff55546a0e');
});

test('following inverse cannot exempt altered methods or unrelated HTML', () => {
  assert.throws(() => htmlWithoutFollowingReadDelta(html + '\n<!-- synthetic unrelated -->'));
  assert.throws(() => htmlWithoutFollowingReadDelta(html.replace('async function claimActivationReward', 'async function syntheticChangedClaim')));
  const changed = structuredClone(fixture); changed.changes[0].after += '\n// synthetic change';
  assert.throws(() => htmlWithoutFollowingReadDelta(html, changed));
});

test('fixture metadata and restoration tampering are rejected', () => {
  for (const key of ['scope', 'beforeSHA256', 'afterSHA256']) {
    const changed = structuredClone(fixture); changed[key] = 'synthetic-change';
    assert.throws(() => htmlWithoutFollowingReadDelta(html, changed));
  }
  const changed = structuredClone(fixture); changed.changes[0].before += '\n// synthetic change';
  assert.throws(() => htmlWithoutFollowingReadDelta(html, changed));
});

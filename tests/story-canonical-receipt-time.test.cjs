'use strict';
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const file = require.resolve(path.join(root, 'pages/story-canonical-read.js'));
const T = '2026-10-23T12:34:56.789Z', H = 'a'.repeat(64);
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
function pair(confirmedAt = T) {
  const identity = Object.fromEntries(['userId', 'progressId', 'workId', 'ownerUserId', 'releaseId', 'manuscriptVersionId', 'partId', 'sceneId', 'beatId', 'routeNodeId'].map((k, i) => [k, id(i + 1)]));
  Object.assign(identity, { releaseChecksum: H, manuscriptHash: H, sourceChecksum: H, sourceTextHash: H, routeHash: H, beatPosition: 1, actNumber: 1, storyVersion: 1, progressRevision: 3, locale: 'ko' });
  const preview = { contract: 'story-canonical-read-review-v1', identity, sourceChecksum: H, sourceTextHash: H, scopeChecksum: H, expectedRevision: 3, confirmationRecorded: false, readerMemoryApplied: false };
  const receipt = { contract: 'story-canonical-read-receipt-v1', receiptId: id(11), ...Object.fromEntries(['progressId', 'workId', 'sceneId', 'beatId', 'sourceChecksum', 'sourceTextHash', 'locale', 'routeNodeId', 'progressRevision'].map(k => [k, identity[k]])), scopeChecksum: H, confirmedAt, invalidatedAt: null, readerMemoryApplied: false, idempotentReplay: false };
  return { preview, receipt };
}

function load(run) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const cached = require.cache[file];
  try {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
    delete require.cache[file];
    require(file);
    run(globalThis.window.LuminaCanonicalRead.receiptMatches);
  } finally {
    delete require.cache[file];
    if (cached) require.cache[file] = cached;
    if (saved) Object.defineProperty(globalThis, 'window', saved);
    else delete globalThis.window;
  }
}

test('canonical times and existing refusals', () => load(matches => {
  for (const time of [T, '2024-02-29T00:00:00.000Z', '2000-02-29T23:59:59.001Z']) {
    const { preview, receipt } = pair(time);
    for (const idempotentReplay of [false, true]) assert.equal(matches({ ...receipt, idempotentReplay }, preview), true, time);
  }
  const { preview, receipt } = pair();
  for (const patch of [{ scopeChecksum: 'b'.repeat(64) }, { readerMemoryApplied: true }, { invalidatedAt: T }, { confirmedAt: null }, { confirmedAt: 0 }, { confirmedAt: '2026-10-23T12:34:56Z' }, { confirmedAt: '2026-10-23T12:34:56.789+00:00' }, { confirmedAt: 'not-a-date' }]) assert.equal(matches({ ...receipt, ...patch }, preview), false);
}));
test('noncanonical calendar times rejected', () => load(matches => {
  for (const time of ['2026-02-30T00:00:00.000Z', '2025-02-29T00:00:00.000Z', '2026-04-31T00:00:00.000Z', '2026-01-01T24:00:00.000Z']) {
    const { preview, receipt } = pair(time);
    assert.equal(matches(receipt, preview), false, time);
  }
}));
test('timestamp read once after initial guards', () => load(matches => {
  const { preview, receipt } = pair();
  let reads = 0;
  const tracked = r => Object.defineProperty(r, 'confirmedAt', { get() { reads++; return T; } });
  for (const invalid of [null, { ...preview, contract: 'wrong' }, { ...preview, confirmationRecorded: true }]) {
    assert.equal(matches(tracked({ ...receipt }), invalid), false);
    assert.equal(reads, 0);
  }
  for (const patch of [{ contract: 'wrong' }, { receiptId: 'bad' }, { invalidatedAt: T }, { readerMemoryApplied: true }, { idempotentReplay: 'false' }]) {
    assert.equal(matches(tracked({ ...receipt, ...patch }), preview), false);
    assert.equal(reads, 0);
  }
  assert.equal(matches(tracked(receipt), preview), true);
  assert.equal(reads, 1);
}));

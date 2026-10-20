import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const sourceUrl = new URL('../pages/creator-story-interactions.js', import.meta.url);
const sourceProfiles = new Map([
  [36288, '6eb98ed78e28e1f945ff64941f93e30ffbc99b62b0eda6eca05d5d4cff3121e9'],
  [36605, 'a302ebf1f9a9f94ba03b0928d82f1501ba5b3293b0d2daf5e6e6b2be4fe29098'],
]);
const sourceStat = await lstat(sourceUrl);
assert.ok(sourceStat.isFile() && !sourceStat.isSymbolicLink(), 'ordinary current source');
assert.ok(sourceProfiles.has(sourceStat.size), 'bounded exact LF or CRLF source length');
const sourceBytes = await readFile(sourceUrl);
assert.equal(sourceBytes.length, sourceStat.size, 'source length remains stable');
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'),
  sourceProfiles.get(sourceBytes.length), 'exact full raw LF or CRLF source SHA256');
const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const ownerId = id(1), workId = id(2), releaseId = id(3);
const manuscriptVersionId = id(4), artistId = id(5), beatId = id(6);
const sceneId = id(7), partId = id(8), identityProfileId = id(9);
const firstApproval = id(10), secondApproval = id(11);
const sourceText = 'Aster opens the door.';
const pin = {
  ownerUserId: ownerId, workId, releaseId, releaseChecksum: 'a'.repeat(64),
  manuscriptVersionId, manuscriptHash: 'b'.repeat(64), artistId, beatId,
  sceneId, partId, identityProfileId, locale: 'ko',
  sourceChecksum: 'c'.repeat(64), identityPinHash: 'd'.repeat(64),
};
const approval = (approvalId, hashLetter) => ({
  contract: 'story-canonical-interaction-approval-v1', ...pin, approvalId,
  approvalChecksum: hashLetter.repeat(64), interactionKind: 'action',
  evidenceStart: 0, evidenceText: sourceText, memoryText: 'The door was opened.',
  status: 'approved', revision: 1, revokedAt: null, readerMemoryApplied: false,
});

// Only injected synthetic reads reach this genuine, unmodified controller.
function screen() {
  let owner = { ownerId, epoch: 1 };
  const calls = [], emitted = [], attempts = [];
  let heldReview = null;
  const context = createContext({ window: {}, URLSearchParams });
  runInContext(source, context, { timeout: 1000, filename: 'genuine-creator-story-interactions.js' });
  const controller = context.window.LuminaCreatorInteractions.createController({
    identity: () => owner,
    isCurrent: value => Boolean(owner && value?.ownerId === owner.ownerId && value.epoch === owner.epoch),
    locale: () => 'ko', randomUUID: () => id(30),
    onChange: state => emitted.push(plain(state)),
    fetch: async (url, options) => {
      const attempt = { url, method: undefined };
      attempts.push(attempt);
      attempt.method = options?.method ?? 'GET';
      assert.equal(attempt.method, 'GET', 'only injected reads are allowed');
      assert.notEqual(options?.method, 'POST', 'cancel worlds must never send a command');
      assert.deepEqual(plain(options.identity), { ownerId, epoch: 1 });
      calls.push({ url, options: plain(options) });
      assert.ok(calls.length <= 5, 'four setup reads plus at most one held review');
      const address = new URL(url, 'https://synthetic.invalid');
      if (address.pathname === '/api/v1/me/creator-studio/stories') {
        return { items: [{ workId, title: { value: 'Synthetic cancellation work' },
          publication: { published: true, status: 'published', activeReleaseId: releaseId } }], nextCursor: null };
      }
      if (address.pathname === `/api/v1/me/creator-studio/stories/${workId}/interactions/beats`) {
        return { contract: 'story-canonical-interaction-catalog-v1', ...pin,
          items: [{ beatId, sceneId, partId, partPosition: 1, scenePosition: 1, beatPosition: 1,
            beatType: 'narration', sourceAvailable: true, sourceText }], nextAfterBeatId: null };
      }
      if (address.pathname === `/api/v1/me/stories/${workId}/artist-candidates`) {
        return { engaged: [], searchResults: [{ artistId, displayName: 'Aster', visualIdentityReady: true }] };
      }
      if (address.pathname === `/api/v1/me/creator-studio/stories/${workId}/interactions/beats/${beatId}`) {
        if (heldReview) {
          const hold = heldReview;
          heldReview = null;
          hold.signal.entered = true;
          await hold.gate;
        }
        return { contract: 'story-canonical-interaction-review-v1', identity: plain(pin), sourceText,
          artistDisplayName: 'Aster', approvals: [approval(firstApproval, 'e'), approval(secondApproval, 'f')],
          moreApprovals: false, proposalApproved: false, readerMemoryApplied: false };
      }
      assert.fail(`Unexpected synthetic endpoint: ${address.pathname}`);
    },
  });
  const assertAttempts = expected => {
    assert.equal(attempts.length, expected, 'all fetch attempts, including rejected ones');
    assert.equal(calls.length, expected, 'admitted read count');
    assert.deepEqual(attempts.map(attempt => attempt.method), Array(expected).fill('GET'));
    assert.deepEqual(attempts.map(attempt => attempt.url), calls.map(call => call.url));
  };
  const holdNextReview = () => {
    assert.equal(heldReview, null, 'only one synthetic hold may be armed');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const signal = { entered: false, release };
    heldReview = { gate, signal };
    return signal;
  };
  const ready = async () => {
    await controller.loadWorks();
    assert.equal(controller.snapshot().works.length, 1);
    controller.selectWork(workId, controller.snapshot().revision);
    await controller.loadBeats('first', controller.snapshot().revision);
    controller.selectBeat(beatId, controller.snapshot().revision);
    await controller.searchArtists('Aster', controller.snapshot().revision);
    controller.selectArtist(artistId, controller.snapshot().revision);
    await controller.loadReview(controller.snapshot().revision);
    assert.equal(controller.snapshot().review?.approvals.length, 2, 'real parser accepted both synthetic receipts');
    assert.equal(calls.length, 4);
    assertAttempts(4);
  };
  const open = approvalId => {
    controller.requestRevoke(approvalId, controller.snapshot().revision);
    assert.equal(controller.snapshot().revokeId, approvalId);
    return controller.snapshot().revision;
  };
  return { controller, calls, emitted, attempts, assertAttempts, holdNextReview, ready, open, loseIdentity: () => { owner = null; } };
}

test('current withdrawal cancellation clears only its pending dialog without a command', async () => {
  const s = screen(); await s.ready();
  const revision = s.open(firstApproval), before = plain(s.controller.snapshot());
  s.controller.cancelRevoke(revision);
  const after = plain(s.controller.snapshot());
  assert.equal(after.revokeId, null);
  assert.deepEqual(after.review, before.review);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(s.calls.length, 4);
  s.assertAttempts(4);
});

test('a cancellation captured for an older dialog cannot cancel the newer dialog', async () => {
  const s = screen(); await s.ready();
  const oldRevision = s.open(firstApproval);
  const oldCancel = () => s.controller.cancelRevoke(oldRevision);
  s.controller.cancelRevoke(oldRevision);
  s.open(secondApproval);
  const before = plain(s.controller.snapshot()), emissionsBefore = s.emitted.length;
  assert.notEqual(before.revision, oldRevision);
  oldCancel();
  assert.equal(s.controller.snapshot().revokeId, secondApproval, 'old cancellation cleared a newer confirmation');
  assert.deepEqual(plain(s.controller.snapshot()), before);
  assert.equal(s.emitted.length, emissionsBefore);
  assert.equal(s.calls.length, 4);
  s.assertAttempts(4);
});

test('cancellation rechecks unknown identity before emitting private review state', async () => {
  const s = screen(); await s.ready();
  const revision = s.open(firstApproval), emissionsBefore = s.emitted.length;
  s.loseIdentity();
  // No external synchronization event has run: the next action must check itself.
  s.controller.cancelRevoke(revision);
  const after = plain(s.controller.snapshot());
  assert.equal(after.review, null, 'cancel retained private review after identity became unknown');
  assert.equal(after.catalog, null);
  assert.deepEqual(after.works, []);
  assert.equal(after.revokeId, null);
  assert.equal(after.checked, false);
  assert.ok(s.emitted.length > emissionsBefore);
  for (const emission of s.emitted.slice(emissionsBefore)) {
    assert.equal(emission.review, null, 'unknown-identity action emitted a private review');
  }
  assert.equal(s.calls.length, 4);
  s.assertAttempts(4);
});

test('legacy undefined current cancellation preserves the current review', async () => {
  const s = screen(); await s.ready();
  s.open(firstApproval);
  const before = plain(s.controller.snapshot()), emissionsBefore = s.emitted.length;
  s.controller.cancelRevoke();
  assert.deepEqual(plain(s.controller.snapshot()), { ...before, revokeId: null, revision: before.revision + 1 });
  assert.equal(s.emitted.length, emissionsBefore + 1);
  s.assertAttempts(4);
});

test('stable current busy cancellation leaves state revision and emissions unchanged', async () => {
  const s = screen(); await s.ready();
  const held = s.holdNextReview();
  let pending, primary, bodyFailed = false;
  const cleanupErrors = [];
  try {
    pending = s.controller.loadReview(s.controller.snapshot().revision);
    assert.equal(held.entered, true, 'fifth genuine review read entered the synthetic hold');
    const before = plain(s.controller.snapshot()), emissionsBefore = s.emitted.length;
    assert.equal(before.busy, true);
    assert.equal(before.review, null);
    s.assertAttempts(5);
    s.controller.cancelRevoke(before.revision);
    assert.deepEqual(plain(s.controller.snapshot()), before);
    assert.equal(s.emitted.length, emissionsBefore);
    s.assertAttempts(5);
  } catch (error) {
    bodyFailed = true;
    primary = error;
  } finally {
    held.release();
    try { if (pending) await pending; } catch (error) { cleanupErrors.push(error); }
    try { s.assertAttempts(5); } catch (error) { cleanupErrors.push(error); }
  }
  if (bodyFailed && cleanupErrors.length) {
    throw new AggregateError([primary, ...cleanupErrors], 'busy assertion failed; cleanup errors retained', { cause: primary });
  }
  if (bodyFailed) throw primary;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'busy cleanup failed');
  const after = plain(s.controller.snapshot());
  assert.equal(after.busy, false);
  assert.equal(after.review?.approvals.length, 2, 'held genuine review completed after release');
  assert.equal(after.message, 'reviewing');
  s.assertAttempts(5);
});

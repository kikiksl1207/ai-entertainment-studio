import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../pages/creator-story-interactions.js', import.meta.url), 'utf8');
const entry = await readFile(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const ownerId = id(1), workId = id(2), releaseId = id(3), manuscriptVersionId = id(4);
const artistId = id(5), beatId = id(6), sceneId = id(7), partId = id(8), identityProfileId = id(9);
const sourceText = 'Aster opens the door. "Come with me."';
const pin = { ownerUserId: ownerId, workId, releaseId, releaseChecksum: 'a'.repeat(64), manuscriptVersionId,
  manuscriptHash: 'b'.repeat(64), artistId, beatId, sceneId, partId, identityProfileId, locale: 'ko',
  sourceChecksum: 'c'.repeat(64), identityPinHash: 'd'.repeat(64) };
const catalog = { contract: 'story-canonical-interaction-catalog-v1', ...pin,
  items: [{ beatId, sceneId, partId, partPosition: 1, scenePosition: 1, beatPosition: 1,
    beatType: 'narration', sourceAvailable: true, sourceText }], nextAfterBeatId: null };
const review = { contract: 'story-canonical-interaction-review-v1', identity: pin, sourceText,
  artistDisplayName: 'Aster', approvals: [], moreApprovals: false, proposalApproved: false, readerMemoryApplied: false };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function screen(options = {}) {
  let owner = { ownerId, epoch: 1 }, locale = 'ko', sequence = 30;
  const calls = [], context = createContext({ window: {}, URLSearchParams });
  runInContext(source, context);
  const c = context.window.LuminaCreatorInteractions.createController({ identity: () => owner,
    isCurrent: value => Boolean(owner && value?.ownerId === owner.ownerId && value.epoch === owner.epoch),
    locale: () => locale, randomUUID: options.randomUUID || (() => id(sequence++)),
    fetch: async (url, args) => {
      calls.push({ url, ...plain(args) });
      const address = new URL(url, 'https://offline.invalid');
      const base = address.pathname.endsWith('/stories') ? { items: [
        { workId, title: { value: 'Synthetic work' }, publication: { status: 'published', published: true, activeReleaseId: releaseId } },
        { workId: id(20), title: { value: 'Private work' }, publication: { status: 'private', published: false, activeReleaseId: null } },
      ], nextCursor: null } : address.pathname.endsWith('/artist-candidates') ? {
        engaged: [], searchResults: [ { artistId, displayName: 'Aster', visualIdentityReady: true },
          { artistId: id(21), displayName: 'Unready', visualIdentityReady: false } ],
      } : address.pathname.endsWith('/beats') ? { ...catalog, locale: address.searchParams.get('locale') } :
      args.method === 'POST' ? { contract: 'story-canonical-interaction-approval-v1', ...pin,
        approvalId: id(25), approvalChecksum: 'e'.repeat(64), interactionKind: args.body.interactionKind || 'action',
        evidenceStart: args.body.evidenceStart ?? 0, evidenceText: args.body.evidenceText || 'Aster opens the door.',
        memoryText: args.body.memoryText || 'Opened the door together.', status: address.pathname.endsWith('/revoke') ? 'revoked' : 'approved',
        revision: address.pathname.endsWith('/revoke') ? 2 : 1, revokedAt: address.pathname.endsWith('/revoke') ? '2026-10-01T00:00:00Z' : null,
        approvedAt: '2026-10-01T00:00:00Z', readerMemoryApplied: false,
      } : review;
      return options.fetch ? options.fetch(url, args, structuredClone(base), calls) : structuredClone(base);
    } });
  const ready = async () => {
    await c.loadWorks(); c.selectWork(workId); await c.loadBeats(); c.selectBeat(beatId);
    await c.searchArtists('Aster'); c.selectArtist(artistId); await c.loadReview();
  };
  const fill = () => { c.setEvidence(0, 21); c.setMemory('Opened the door together.'); c.acknowledge(true); };
  return { ...c, calls, ready, fill, posts: () => calls.filter(call => call.method === 'POST'),
    setOwner: value => { owner = value; }, setLocale: value => { locale = value; } };
}

test('writer entry connects real API panel and does not grant memory application', () => {
  assert.match(entry, /id="writerInteractions" aria-labelledby="writerInteractionsTitle"/);
  assert.match(entry, /creator-story-interactions\.css\?v=interactions-20261001/);
  assert.ok(entry.indexOf('src="/pages/creator-studio.js') < entry.indexOf('src="/pages/creator-story-interactions.js'));
  assert.doesNotMatch(source, /localStorage|sessionStorage|\/admin\/|generation\/start|payment/);
  for (const locale of ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant']) assert.ok(source.includes(locale));
});
test('owner catalog excludes private works and unready artists cannot be selected', async () => {
  const c = screen(); assert.equal(c.calls.length, 0);
  await c.ready(); assert.equal(c.snapshot().works.length, 1); assert.equal(c.posts().length, 0);
  c.selectArtist(id(21)); assert.equal(c.snapshot().artistId, null); assert.equal(c.snapshot().review, null);
});
test('exact source selection, summary and explicit check produce one bound non-retried command', async () => {
  const c = screen(); await c.ready(); await c.approve(); assert.equal(c.posts().length, 0);
  c.fill(); const rev = c.snapshot().revision; await c.approve(rev); await c.approve(rev);
  assert.equal(c.posts().length, 1); assert.equal(c.snapshot().message, 'saved');
  assert.deepEqual(c.posts()[0].body, { artistId, locale: 'ko', expectedSourceChecksum: pin.sourceChecksum,
    expectedIdentityPinHash: pin.identityPinHash, interactionKind: 'action', evidenceStart: 0,
    evidenceText: sourceText.slice(0, 21), memoryText: 'Opened the door together.', interactionReviewed: true, idempotencyKey: id(30) });
  assert.equal(c.posts()[0]._retried, true); assert.deepEqual(c.posts()[0].identity, { ownerId, epoch: 1 });
});
test('editing any evidence or summary invalidates the explicit check', async () => {
  const c = screen(); await c.ready(); c.fill(); c.setMemory('A revised summary.'); await c.approve();
  assert.equal(c.posts().length, 0); c.acknowledge(true); c.setEvidence(0, 5); await c.approve(); assert.equal(c.posts().length, 0);
});
test('dialogue memory is always an exact quote and cannot be rewritten', async () => {
  const c = screen(); await c.ready(); c.setKind('dialogue'); c.setEvidence(23, 36);
  const evidence = c.snapshot().evidenceText; c.setMemory('Invented dialogue'); assert.equal(c.snapshot().memoryText, evidence);
  c.acknowledge(true); await c.approve(); assert.equal(c.posts()[0].body.memoryText, evidence);
});
test('malformed ranges and broken Unicode are not accepted as evidence', async () => {
  const c = screen(); await c.ready();
  for (const args of [[-1, 5], [3, 2], [0, 500], [0.5, 2], [0, 1]]) { c.setEvidence(...args); assert.equal(c.snapshot().evidenceText, ''); }
});
for (const change of [
  value => { value.ownerUserId = id(99); }, value => { value.releaseId = id(99); },
  value => { value.items[0].sourceText = null; }, value => { value.items.push(value.items[0]); },
  value => { value.nextAfterBeatId = id(99); }, value => { value.locale = 'en'; },
]) test('malformed or foreign canonical catalog fails closed', async () => {
  const c = screen({ fetch: (url, args, value) => { if (new URL(url, 'https://invalid').pathname.endsWith('/beats')) change(value); return value; } });
  await c.loadWorks(); c.selectWork(workId); await c.loadBeats(); assert.equal(c.snapshot().catalog, null); assert.equal(c.posts().length, 0);
});
for (const change of [
  value => { value.identity.artistId = id(99); }, value => { value.identity.manuscriptHash = 'f'.repeat(64); },
  value => { value.readerMemoryApplied = true; }, value => { value.sourceText = 'Other language source'; },
]) test('unbound event review is discarded without enabling approval', async () => {
  const c = screen({ fetch: (url, args, value) => { if (value.contract === 'story-canonical-interaction-review-v1') change(value); return value; } });
  await c.ready(); assert.equal(c.snapshot().review, null); assert.equal(c.posts().length, 0);
});
test('absent exact-language text never becomes a selectable event', async () => {
  const c = screen({ fetch: (url, args, value) => { if (value.contract === catalog.contract) Object.assign(value.items[0], { sourceAvailable: false, sourceText: null }); return value; } });
  await c.loadWorks(); c.selectWork(workId); c.setSourceLocale('en'); await c.loadBeats(); c.selectBeat(beatId);
  assert.equal(c.snapshot().beatId, null); await c.loadReview(); assert.equal(c.calls.length, 2);
});
test('account or locale change discards all private review state and checkbox', async () => {
  for (const change of [c => c.setOwner({ ownerId: id(99), epoch: 2 }), c => c.setLocale('ja'), c => c.setOwner(null)]) {
    const c = screen(); await c.ready(); c.fill(); change(c); await c.approve();
    assert.equal(c.posts().length, 0); assert.equal(c.snapshot().review, null); assert.equal(c.snapshot().works.length, 0);
  }
});
test('a late review after logout cannot expose source or become an approval', async () => {
  const held = deferred(); let delay = false;
  const c = screen({ fetch: (url, args, value) => value.contract === review.contract && delay ? held.promise : value });
  await c.ready(); delay = true; const request = c.loadReview(); c.setOwner(null); c.syncContext(); held.resolve(review); await request;
  assert.equal(c.snapshot().review, null); assert.equal(c.snapshot().works.length, 0);
});
test('ambiguous POST failure is not retried automatically and manual identical retry retains its key', async () => {
  let fail = true;
  const c = screen({ fetch: (url, args, value) => { if (args.method === 'POST' && fail) { fail = false; throw new Error('Synthetic outage'); } return value; } });
  await c.ready(); c.fill(); await c.approve(); assert.equal(c.posts().length, 1); assert.equal(c.snapshot().review, null);
  await c.loadReview(); c.fill(); await c.approve(); assert.equal(c.posts().length, 2);
  assert.equal(c.posts()[0].body.idempotencyKey, c.posts()[1].body.idempotencyKey);
});
test('withdrawal needs a separate confirmation and sends only the reviewed checksum', async () => {
  const c = screen(); await c.ready(); c.fill(); await c.approve(); await c.confirmRevoke(); assert.equal(c.posts().length, 1);
  c.requestRevoke(id(25)); await c.confirmRevoke(); assert.equal(c.posts().length, 2);
  assert.deepEqual(c.posts()[1].body, { expectedApprovalChecksum: 'e'.repeat(64), expectedRevision: 1 });
  assert.equal(c.snapshot().review.approvals[0].status, 'revoked'); c.requestRevoke(id(25)); await c.confirmRevoke(); assert.equal(c.posts().length, 2);
});
test('an unconfirmed approval receipt is never shown as saved', async () => {
  const c = screen({ fetch: (url, args, value) => { if (args.method === 'POST') value.readerMemoryApplied = true; return value; } });
  await c.ready(); c.fill(); await c.approve(); assert.equal(c.snapshot().review, null); assert.equal(c.snapshot().message, 'failed');
});
test('catalog pagination is pinned to the release and does not accept a release change', async () => {
  const c = screen({ fetch: (url, args, value) => { if (value.contract === catalog.contract) {
    if (new URL(url, 'https://invalid').searchParams.has('afterBeatId')) { value.releaseChecksum = 'f'.repeat(64); value.nextAfterBeatId = null; }
    else value.nextAfterBeatId = beatId;
  } return value; } });
  await c.loadWorks(); c.selectWork(workId); await c.loadBeats(); await c.loadBeats('next');
  assert.match(c.calls.at(-1).url, /expectedReleaseChecksum=a{64}/); assert.equal(c.snapshot().catalog, null);
});
test('unavailable secure request key fails closed without an uncaught error or mutation', async () => {
  const c = screen({ randomUUID: () => { throw new Error('Secure UUID unavailable'); } });
  await c.ready(); c.fill(); await c.approve();
  assert.equal(c.posts().length, 0); assert.equal(c.snapshot().checked, false); assert.equal(c.snapshot().message, 'failed');
});

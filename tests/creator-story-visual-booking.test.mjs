import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../pages/creator-story-visual-booking.js', import.meta.url), 'utf8');
const entry = await readFile(new URL('../creator-studio/index.html', import.meta.url), 'utf8');
const studioSource = await readFile(new URL('../pages/creator-studio.js', import.meta.url), 'utf8');
const helperStart = studioSource.indexOf('async function fetchCreatorStudioApi(');
const helperEnd = studioSource.indexOf('\n  window.LuminaCreatorStudioApi', helperStart);
const realHelper = studioSource.slice(helperStart, helperEnd);
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const release = number => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const plain = value => JSON.parse(JSON.stringify(value));
const works = [1, 2].map(number => ({ workId: id(number), slug: `owner-work-${number}`, title: { value: `Actual Story ${number}` },
  publication: { status: 'published', published: true, activeReleaseId: release(number) } }));
const item = (number = 11) => ({ generationId: id(number), sourceSceneKey: `scene-${number}`, status: 'pending', attemptCount: 0,
  reason: 'unbound', canReprepare: true, reviewSha256: 'a'.repeat(64), currentBookingIdentitySha256: 'b'.repeat(64),
  bookedIdentitySha256: null, promptSha256: 'c'.repeat(64) });
const review = (work = works[0], items = [item()], nextAfterId = null) => ({ workId: work.workId, releaseId: work.publication.activeReleaseId,
  releaseChecksum: 'd'.repeat(64), eligible: true, items, nextAfterId });
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function screen({ catalogRead, read, post, apiFetch } = {}) {
  let owner = { ownerId: 'synthetic-author', epoch: 1 }, language = 'ko', catalog = structuredClone(works);
  const calls = [], states = [];
  const context = createContext({ window: {}, URLSearchParams });
  runInContext(source, context);
  const controller = context.window.LuminaCreatorVisualBooking.createController({
    identity: () => owner, isCurrent: value => Boolean(owner && value?.ownerId === owner.ownerId && value?.epoch === owner.epoch),
    locale: () => language, onChange: state => states.push(plain(state)),
    fetch: async (url, options) => {
      calls.push({ url, options: plain(options) });
      if (apiFetch) return apiFetch(url, options);
      const address = new URL(url, 'https://offline.invalid');
      if (address.pathname === '/api/v1/me/creator-studio/stories') {
        const base = { items: structuredClone(catalog), nextCursor: null };
        return catalogRead ? catalogRead({ base, cursor: address.searchParams.get('cursor'), calls }) : base;
      }
      const work = catalog.find(row => row.workId === address.pathname.split('/')[6]);
      assert.ok(work, 'only listed owner works are queried');
      if (options.method === 'POST') {
        assert.ok(address.pathname.endsWith('/visual-bookings/reprepare'));
        const body = plain(options.body);
        const base = { workId: work.workId, releaseId: body.releaseId, releaseChecksum: body.releaseChecksum,
          generationId: body.generationId, sourceSceneKey: body.sourceSceneKey, status: 'pending',
          generationStarted: false, bookingIdentitySha256: body.expectedCurrentBookingIdentitySha256 };
        return post ? post({ base, body, calls }) : base;
      }
      assert.ok(address.pathname.endsWith('/visual-bookings'));
      return read ? read({ base: review(work), afterId: address.searchParams.get('afterId'), calls }) : review(work);
    }
  });
  const rev = () => controller.snapshot().revision;
  const ready = async () => { await controller.loadCatalog(); controller.selectWork(id(1), rev()); await controller.loadReview(); };
  const select = () => controller.selectItem(id(11), rev());
  const approve = () => { select(); controller.acknowledge(true, rev()); controller.requestConfirmation(rev()); };
  return { ...controller, calls, states, rev, ready, select, approve, posts: () => calls.filter(call => call.options.method === 'POST'),
    setCatalog: value => { catalog = structuredClone(value); }, setOwner: value => { owner = value; }, setLocale: value => { language = value; } };
}
function inert(view) { const state = view.snapshot(); assert.equal(state.review, null); assert.equal(state.selected, null); assert.equal(state.checked, false); assert.equal(state.confirmation, null); }

test('author entry connects the panel behind studio access in the writer section, after the real API helper', () => {
  assert.match(entry, /href="\/pages\/creator-story-visual-booking\.css\?v=visual-booking-20261001"/);
  assert.match(entry, /<section id="writerVisualBooking" aria-labelledby="writerVisualBookingTitle"><\/section>/);
  assert.ok(entry.indexOf('id="studioShell"') < entry.indexOf('id="writerVisualBooking"'));
  assert.ok(entry.indexOf('id="writer-manuscript"') < entry.indexOf('id="writerVisualBooking"'));
  assert.ok(entry.indexOf('src="/pages/creator-studio.js') < entry.indexOf('src="/pages/creator-story-visual-booking.js'));
  assert.doesNotMatch(source, /\/admin\/|localStorage|sessionStorage|innerHTML\s*\+=/);
});

test('catalog and review are explicit owner GETs, selection never starts generation', async () => {
  const view = screen(); assert.equal(view.calls.length, 0);
  await view.loadCatalog(); assert.equal(view.calls[0].url, '/api/v1/me/creator-studio/stories?locale=ko&limit=30');
  view.selectWork(id(1), view.rev()); assert.equal(view.calls.length, 1);
  await view.loadReview(); assert.equal(view.calls[1].url, `/api/v1/me/creator-studio/stories/${id(1)}/visual-bookings`);
  assert.deepEqual(view.calls[1].options.identity, { ownerId: 'synthetic-author', epoch: 1 }); assert.equal(view.posts().length, 0);
});

test('one exact command requires checkbox, separate confirmation, and a fresh owner catalog', async () => {
  const view = screen(); await view.ready();
  for (const advance of [() => {}, view.select, () => view.acknowledge(true, view.rev())]) {
    advance(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  }
  view.requestConfirmation(view.rev()); const command = view.rev(); await view.reprepare(command); await view.reprepare(command);
  assert.equal(view.posts().length, 1); assert.equal(view.snapshot().phase, 'done'); inert(view);
  const call = view.posts()[0]; assert.equal(call.url, `/api/v1/me/creator-studio/stories/${id(1)}/visual-bookings/reprepare`);
  assert.equal(call.options._retried, true);
  assert.deepEqual(call.options.body, { generationId: id(11), releaseId: release(1), releaseChecksum: 'd'.repeat(64), sourceSceneKey: 'scene-11',
    promptSha256: 'c'.repeat(64), expectedReviewSha256: 'a'.repeat(64), expectedCurrentBookingIdentitySha256: 'b'.repeat(64), confirmedResume: true });
  assert.equal(view.calls.filter(call => new URL(call.url, 'https://unit.invalid').pathname === '/api/v1/me/creator-studio/stories').length, 2);
});

test('drafts remain unselectable and paginated owner catalog reaches real published releases', async () => {
  const draft = { ...works[0], workId: id(3), publication: { status: 'draft', published: false, activeReleaseId: null } };
  const view = screen({ catalogRead: ({ cursor }) => cursor ? { items: [works[1]], nextCursor: null } : { items: [draft, works[0]], nextCursor: id(1) } });
  await view.loadCatalog(); assert.deepEqual(plain(view.snapshot().catalog).map(work => work.id), [id(1), id(2)]);
  view.selectWork(id(3), view.rev()); assert.equal(view.snapshot().target, null); await view.loadReview(); assert.equal(view.calls.length, 2);
});

for (const mutate of [
  base => { delete base.nextCursor; }, base => { base.items = null; }, base => { base.items[0].workId = 'bad'; },
  base => { delete base.items[0].publication.activeReleaseId; }, base => { base.items[0].publication.published = 'true'; },
  base => { base.items[0].publication.status = 'draft'; }, base => { base.items[0].publication.activeReleaseId = null; },
  base => { base.items[0].title.value = ''; }, base => { base.items[0].title.value = 'x'.repeat(1001); },
  base => { base.items[0].slug = 'x'.repeat(257); }, base => { base.items[0].title.value = 'title\0'; },
  base => { base.items.push(base.items[0]); }, base => { base.items = Array(31).fill(base.items[0]); }
]) test(`malformed owner catalog is inert: ${mutate}`, async () => {
  const view = screen({ catalogRead: ({ base }) => { mutate(base); return base; } }); await view.loadCatalog();
  assert.equal(view.snapshot().catalogVerified, false); assert.equal(view.snapshot().target, null); inert(view); assert.equal(view.posts().length, 0);
});

test('repeated owner catalog cursors stop without partial selection or infinite requests', async () => {
  const view = screen({ catalogRead: ({ cursor }) => ({ items: [cursor ? works[1] : works[0]], nextCursor: id(1) }) });
  await view.loadCatalog(); assert.equal(view.calls.length, 2); assert.equal(view.snapshot().catalogVerified, false); inert(view);
});

test('state keeps only safe booking fields, not injected manuscript or provider diagnostics', async () => {
  const secret = 'PRIVATE_SOURCE_NOT_A_DISPLAY_VALUE';
  const view = screen({ read: ({ base }) => ({ ...base, manuscript: secret,
    items: base.items.map(row => ({ ...row, promptText: secret, providerDiagnostic: secret })) }) });
  await view.ready(); assert.equal(JSON.stringify(view.snapshot()).includes(secret), false);
});

test('more than 1000 catalog rows stop before any partial work selection is available', async () => {
  let counter = 1;
  const view = screen({ catalogRead: () => {
    const rows = Array.from({ length: 30 }, () => { const number = counter++; return { ...works[0], workId: id(number), publication: {
      status: 'published', published: true, activeReleaseId: release(number) } }; });
    return { items: rows, nextCursor: rows.at(-1).workId };
  } });
  await view.loadCatalog(); assert.equal(view.calls.length, 34); assert.equal(view.snapshot().catalogVerified, false);
  assert.deepEqual(plain(view.snapshot().catalog), []); inert(view);
});

for (const change of ['owner', 'epoch', 'logout', 'locale', 'invalidate', 'cancel']) test(`confirmation cannot survive ${change}`, async () => {
  const view = screen(); await view.ready(); view.approve(); const command = view.rev();
  if (change === 'owner') view.setOwner({ ownerId: 'other-author', epoch: 1 });
  if (change === 'epoch') view.setOwner({ ownerId: 'synthetic-author', epoch: 2 });
  if (change === 'logout') view.setOwner(null);
  if (change === 'locale') view.setLocale('en');
  if (change === 'invalidate') view.invalidate();
  if (change === 'cancel') view.cancelConfirmation();
  await view.reprepare(command); assert.equal(view.posts().length, 0); assert.equal(view.snapshot().confirmation, null); assert.equal(view.snapshot().checked, false);
});

for (const mutate of [
  base => { base.workId = id(2); }, base => { base.releaseId = release(2); }, base => { base.releaseChecksum = 'A'.repeat(64); },
  base => { base.eligible = true; base.items[0].attemptCount = 1; }, base => { base.items[0].status = 'generating'; },
  base => { base.items[0].reason = 'attempted'; }, base => { base.items[0].reviewSha256 = null; },
  base => { base.items[0].currentBookingIdentitySha256 = 'bad'; }, base => { base.items[0].bookedIdentitySha256 = undefined; },
  base => { base.items[0].sourceSceneKey = 'a'.repeat(161); }, base => { base.items[0].promptSha256 = 'bad'; },
  base => { base.items.push(base.items[0]); }, base => { base.items = []; base.nextAfterId = id(11); }, base => { base.eligible = false; }
]) test(`malformed booking review clears all editable state: ${mutate}`, async () => {
  const view = screen({ read: ({ base }) => { mutate(base); return base; } }); await view.ready(); inert(view); assert.equal(view.posts().length, 0);
});

for (const reason of ['current', 'in_progress', 'attempted', 'asset_present', 'blocked', 'source_changed']) test(`${reason} row is visible but cannot be reprepared`, async () => {
  const view = screen({ read: ({ base }) => { base.items[0].reason = reason; base.items[0].canReprepare = false; return base; } });
  await view.ready(); view.approve(); await view.reprepare(view.rev()); assert.equal(view.snapshot().review.items[0].reason, reason); assert.equal(view.posts().length, 0);
});

test('unsupported published stories do not acquire approval or a generation action', async () => {
  const view = screen({ read: ({ base }) => ({ ...base, eligible: false, items: [], nextAfterId: null }) });
  await view.ready(); assert.equal(view.snapshot().messageKey, 'unsupported'); view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
});

for (const change of ['release', 'remove', 'title', 'owner', 'locale', 'uncheck']) test(`fresh catalog context blocks a confirmed command after ${change}`, async () => {
  let view, catalogCount = 0;
  view = screen({ catalogRead: ({ base }) => {
    if (++catalogCount > 1) {
      if (change === 'release') base.items[0].publication.activeReleaseId = release(3);
      if (change === 'remove') base.items = [];
      if (change === 'title') base.items[0].title.value = 'Updated';
      if (change === 'owner') view.setOwner({ ownerId: 'other', epoch: 1 });
      if (change === 'locale') view.setLocale('ja');
      if (change === 'uncheck') view.cancelConfirmation();
    }
    return base;
  } });
  await view.ready(); view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0); assert.equal(view.snapshot().confirmation, null);
});

for (const change of ['owner', 'locale', 'invalidate']) test(`late owner review cannot repopulate state after ${change}`, async () => {
  const pending = deferred(); const view = screen({ read: () => pending.promise });
  await view.loadCatalog(); view.selectWork(id(1), view.rev()); const operation = view.loadReview();
  if (change === 'owner') view.setOwner({ ownerId: 'other', epoch: 1 });
  if (change === 'locale') view.setLocale('zh-Hant');
  if (change === 'invalidate') view.invalidate();
  pending.resolve(review()); await operation; inert(view); assert.equal(view.posts().length, 0);
});

for (const mutate of [base => { base.workId = id(2); }, base => { base.releaseId = release(2); }, base => { base.releaseChecksum = '0'.repeat(64); },
  base => { base.generationId = id(12); }, base => { base.sourceSceneKey = 'other'; }, base => { base.status = 'ready'; },
  base => { base.generationStarted = true; }, base => { base.bookingIdentitySha256 = '0'.repeat(64); }]) test(`mismatched POST reply is quarantined without retry: ${mutate}`, async () => {
  const view = screen({ post: ({ base }) => { mutate(base); return base; } }); await view.ready(); view.approve(); await view.reprepare(view.rev());
  assert.equal(view.snapshot().phase, 'error'); inert(view); await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('an unknown POST result leaves no saved confirmation or automatic retry', async () => {
  const view = screen({ post: () => { throw new Error('uncertain'); } }); await view.ready(); view.approve(); await view.reprepare(view.rev());
  inert(view); assert.equal(view.snapshot().messageKey, 'failed'); await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('booking keyset pagination returns fresh pages and discards old checkbox state', async () => {
  const view = screen({ read: ({ base, afterId }) => ({ ...base, items: [item(afterId ? 12 : 11)], nextAfterId: afterId ? null : id(11) }) });
  await view.ready(); view.approve(); await view.loadReview('next', view.rev());
  assert.equal(view.snapshot().pageIndex, 1); assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().selected, null);
  await view.loadReview('previous', view.rev()); assert.equal(view.snapshot().review.items[0].generationId, id(11)); assert.equal(view.posts().length, 0);
});

for (const mode of ['checksum', 'duplicate', 'cycle']) test(`booking pagination rejects ${mode} drift`, async () => {
  const view = screen({ read: ({ base, afterId }) => ({ ...base, releaseChecksum: mode === 'checksum' && afterId ? '0'.repeat(64) : base.releaseChecksum,
    items: [item(afterId && mode !== 'duplicate' ? 12 : 11)], nextAfterId: afterId && mode !== 'cycle' ? null : id(11) }) });
  await view.ready(); await view.loadReview('next', view.rev()); inert(view); assert.equal(view.snapshot().phase, 'error');
});

for (const switched of [false, true]) test(`the real studio helper never refreshes or replays a confirmed 401 POST (owner changed: ${switched})`, async () => {
  let owner = { ownerId: 'synthetic-author', epoch: 1 }, auth = { accessToken: 'synthetic-A', refreshToken: 'synthetic-R' }, refreshes = 0;
  const pending = deferred(), entered = deferred(), calls = [];
  const context = createContext({ window: {}, URLSearchParams, DOMException, apiBase: 'https://offline.invalid',
    currentStudioIdentity: value => value?.ownerId === owner.ownerId && value?.epoch === owner.epoch, readAuth: () => auth,
    refreshStudioAuthOnce: async () => { refreshes++; return auth; }, fetch: async (url, options) => {
      calls.push({ url, options: plain(options) });
      if (options.method === 'POST') { entered.resolve(); return pending.promise; }
      return { ok: true, status: 200, json: async () => new URL(url).pathname.endsWith('/stories') ? { items: works, nextCursor: null } : review() };
    } });
  runInContext(realHelper, context); runInContext(source, context);
  const view = context.window.LuminaCreatorVisualBooking.createController({ identity: () => owner, isCurrent: context.currentStudioIdentity,
    fetch: async (url, options) => { const result = await context.fetchCreatorStudioApi(url, options); if (!result.ok) throw new Error('request'); return result.json(); } });
  await view.loadCatalog(); view.selectWork(id(1), view.snapshot().revision); await view.loadReview();
  view.selectItem(id(11), view.snapshot().revision); view.acknowledge(true, view.snapshot().revision); view.requestConfirmation(view.snapshot().revision);
  const operation = view.reprepare(view.snapshot().revision); await entered.promise;
  if (switched) { owner = { ownerId: 'synthetic-B', epoch: 2 }; auth = { accessToken: 'synthetic-B', refreshToken: 'synthetic-S' }; }
  pending.resolve({ ok: false, status: 401 }); await operation;
  const posts = calls.filter(call => call.options.method === 'POST'); assert.equal(posts.length, 1); assert.equal(refreshes, 0);
  assert.equal(posts[0].options.headers.Authorization, 'Bearer synthetic-A'); inert(view);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(new URL('../backstage-story-visual-booking.js', import.meta.url), 'utf8');
const actualEntry = await readFile(new URL('../backstage/index.html', import.meta.url), 'utf8');
const redirectEntry = await readFile(new URL('../backstage.html', import.meta.url), 'utf8');
const backstageSource = await readFile(new URL('../backstage.js', import.meta.url), 'utf8');
const helperStart = backstageSource.indexOf('async function backstageFetch(');
const helperEnd = backstageSource.indexOf('\nwindow.LuminaBackstageApi =', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart);
const realFetchHelper = backstageSource.slice(helperStart, helperEnd);
const catalogUrl = '/admin/api/v1/backstage/story-publication/submissions';
const id = number => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const release = number => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const works = [1, 2].map(number => ({ id: id(number), activeReleaseId: release(number),
  slug: `published-work-${number}`, status: 'published' }));
const checksum = 'c'.repeat(64), reviewHash = 'd'.repeat(64), identityHash = 'e'.repeat(64), promptHash = 'f'.repeat(64);
const item = (number = 11) => ({ generationId: id(number), sourceSceneKey: `scene-${number}`, status: 'failed',
  attemptCount: 0, reason: 'unbound', canReprepare: true, reviewSha256: reviewHash,
  currentBookingIdentitySha256: identityHash, bookedIdentitySha256: null, promptSha256: promptHash });
const review = (work = works[0], items = [item()], nextAfterId = null) => ({ workId: work.id,
  releaseId: work.activeReleaseId, releaseChecksum: checksum, eligible: true, items, nextAfterId });
const plain = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function screen({ read, post, catalogRead } = {}) {
  let catalog = structuredClone(works), auth = 'operator-session-one';
  const calls = [], states = [];
  const context = createContext({ window: {}, URLSearchParams });
  runInContext(source, context);
  const controller = context.window.LuminaBackstageStoryVisualBooking.createController({
    session: () => auth,
    onChange: state => states.push(plain(state)),
    fetch: async (url, options = {}) => {
      calls.push({ url, options: plain(options) });
      if (url === catalogUrl) return catalogRead ? catalogRead({ catalog, calls }) : { publishedWorks: structuredClone(catalog) };
      const address = new URL(url, 'https://unit.invalid');
      const workId = address.pathname.split('/')[5];
      const work = catalog.find(candidate => candidate.id === workId);
      assert.ok(work, `unlisted work ${url}`);
      if (options.method === 'POST') {
        assert.ok(url.endsWith('/reprepare-booking'), 'no generation or other mutation is allowed');
        const body = plain(options.body);
        const base = { workId, releaseId: body.releaseId, releaseChecksum: body.releaseChecksum,
          generationId: body.generationId, sourceSceneKey: body.sourceSceneKey, status: 'pending',
          bookingIdentitySha256: body.expectedCurrentBookingIdentitySha256, generationStarted: false };
        return post ? post({ body, base }) : base;
      }
      assert.ok(url.endsWith('/booking-review') || address.pathname.endsWith('/booking-review'));
      const base = review(work);
      return read ? read({ base, work, afterId: address.searchParams.get('afterId'), calls }) : base;
    }
  });
  const rev = () => controller.snapshot().revision;
  const ready = async (work = works[0]) => {
    await controller.loadCatalog(); controller.selectWork(work.id, rev()); await controller.loadReview();
  };
  const select = (number = 11) => controller.selectItem(id(number), rev());
  const approve = (number = 11) => { select(number); controller.acknowledge(true, rev()); controller.requestConfirmation(rev()); };
  return { ...controller, calls, states, rev, ready, select, approve,
    posts: () => calls.filter(call => call.options.method === 'POST'),
    setCatalog: value => { catalog = structuredClone(value); }, setAuth: value => { auth = value; } };
}
function assertInert(view) {
  const state = view.snapshot();
  assert.equal(state.review, null);
  assert.equal(state.selected, null);
  assert.equal(state.checked, false);
  assert.equal(state.confirmation, null);
}

for (const changeSession of [false, true]) test(`the real shared helper never replays a confirmed POST after delayed 401 (changed operator: ${changeSession})`, async () => {
  let auth = { accessToken: 'operator-A-token', refreshToken: 'operator-A-refresh' };
  const pending = deferred(), dispatched = deferred(), requests = [];
  let refreshes = 0;
  const context = createContext({ window: {}, BACKSTAGE_API_BASE: 'https://offline.invalid',
    getBackstageAuth: () => auth,
    refreshBackstageAuthOnce: async () => { refreshes++; return auth; },
    fetch: async (url, options) => {
      requests.push({ url, options: plain(options) });
      if (options.method === 'POST') { dispatched.resolve(); return pending.promise; }
      return { ok: true, status: 200, json: async () => url.endsWith('/submissions') ? { publishedWorks: works } : review() };
    } });
  runInContext(realFetchHelper, context);
  runInContext(source, context);
  const controller = context.window.LuminaBackstageStoryVisualBooking.createController({
    session: () => JSON.stringify(auth), fetch: context.backstageFetch,
  });
  await controller.loadCatalog(); controller.selectWork(works[0].id, controller.snapshot().revision); await controller.loadReview();
  controller.selectItem(item().generationId, controller.snapshot().revision);
  controller.acknowledge(true, controller.snapshot().revision); controller.requestConfirmation(controller.snapshot().revision);
  const operation = controller.reprepare(controller.snapshot().revision); await dispatched.promise;
  if (changeSession) auth = { accessToken: 'operator-B-token', refreshToken: 'operator-B-refresh' };
  pending.resolve({ ok: false, status: 401, json: async () => ({ message: 'Expired synthetic session' }) }); await operation;
  const posts = requests.filter(request => request.options.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].options.headers.Authorization, 'Bearer operator-A-token');
  assert.equal(refreshes, 0); assert.equal(controller.snapshot().review, null);
  assert.equal(controller.snapshot().confirmation, null); assert.equal(controller.snapshot().catalogVerified, !changeSession);
});

test('the canonical backstage entry wires the panel inside the authenticated story-publication section', () => {
  assert.match(actualEntry, /<link rel="stylesheet" href="\/backstage-story-visual-booking\.css"\s*\/>/);
  assert.match(actualEntry, /<script src="\/backstage-story-visual-booking\.js"><\/script>/);
  assert.ok(actualEntry.indexOf('src="/backstage.js?') < actualEntry.indexOf('src="/backstage-story-visual-booking.js"'),
    'the shared login/API script must execute before the isolated panel');
  const parents = [];
  let hosts = 0;
  for (const [tag] of actualEntry.matchAll(/<section\b[^>]*>|<\/section\s*>/g)) {
    if (tag.startsWith('</')) { parents.pop(); continue; }
    const sectionId = tag.match(/\bid="([^"]+)"/)?.[1] || null;
    if (sectionId === 'storyVisualBookingPanel') {
      hosts += 1;
      assert.equal(parents.at(-1), 'story-publication', 'the host must belong to the actual story navigation surface');
      assert.ok(parents.includes('backstageDashboardView'), 'the panel must remain behind backstage login');
    }
    parents.push(sectionId);
  }
  assert.equal(hosts, 1);
  assert.doesNotMatch(redirectEntry, /storyVisualBookingPanel|backstage-story-visual-booking\.(?:css|js)/);
  assert.match(redirectEntry, /window\.location\.replace\("\/backstage" \+ qs \+ hash\)/);
  assert.match(redirectEntry, /<title>이동 중/);
});

test('catalog is the publication server endpoint, selection never reads or posts automatically', async () => {
  const view = screen();
  assert.equal(view.calls.length, 0);
  await view.loadCatalog();
  assert.deepEqual(view.calls, [{ url: catalogUrl, options: { auth: true } }]);
  assert.equal(view.snapshot().target, null);
  view.selectWork(works[1].id, view.rev());
  assert.equal(view.calls.length, 1);
  await view.loadReview();
  assert.equal(view.calls[1].url, `/admin/api/v1/story-visuals/${works[1].id}/booking-review`);
  assert.equal(view.snapshot().review.releaseId, works[1].activeReleaseId);
  assert.equal(view.posts().length, 0);
});

test('single-item checkbox, separate confirmation, and fresh catalog gate the exact POST', async () => {
  const view = screen(); await view.ready();
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  view.select(); view.requestConfirmation(view.rev());
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  view.acknowledge(true, view.rev());
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  view.requestConfirmation(view.rev()); await view.reprepare(view.rev());
  assert.equal(view.posts().length, 1);
  assert.deepEqual(view.posts()[0], { url: `/admin/api/v1/story-visuals/${works[0].id}/reprepare-booking`,
    options: { method: 'POST', auth: true, _retried: true, body: { generationId: id(11), releaseId: release(1), releaseChecksum: checksum,
      sourceSceneKey: 'scene-11', promptSha256: promptHash, expectedReviewSha256: reviewHash,
      expectedCurrentBookingIdentitySha256: identityHash, confirmedResume: true } } });
  assert.equal(view.calls.at(-2).url, catalogUrl);
  assert.equal(view.snapshot().phase, 'done'); assertInert(view);
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('selecting another item and canceling confirmation both require a new checkbox', async () => {
  const view = screen({ read: ({ work }) => review(work, [item(11), item(12)]) }); await view.ready();
  view.approve(); view.select(12);
  assert.equal(view.snapshot().checked, false); assert.equal(view.snapshot().confirmation, null);
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  view.approve(12); view.cancelConfirmation(); await view.reprepare(view.rev());
  assert.equal(view.snapshot().checked, false); assert.equal(view.posts().length, 0);
  view.approve(12); await view.reprepare(view.rev());
  assert.equal(view.posts().length, 1); assert.equal(view.posts()[0].options.body.generationId, id(12));
});

for (const reason of ['current', 'in_progress', 'attempted', 'asset_present', 'blocked', 'source_changed']) {
  test(`${reason} is informative, never a reprepare gate`, async () => {
    const view = screen({ read: ({ base }) => ({ ...base, items: [{ ...item(), reason, canReprepare: false,
      reviewSha256: null, currentBookingIdentitySha256: reason === 'current' ? identityHash : null }] }) }); await view.ready();
    assert.equal(view.snapshot().phase, 'ready'); view.approve(); await view.reprepare(view.rev());
    assert.equal(view.posts().length, 0); assert.equal(view.snapshot().checked, false);
  });
}
for (const [label, change] of [
  ['attempted count', { attemptCount: 1 }], ['generating', { status: 'generating' }], ['ready asset', { status: 'ready' }],
  ['blocked status', { status: 'blocked' }],
  ['server disallows', { canReprepare: false }], ['missing review binding', { reviewSha256: null }],
  ['missing current identity', { currentBookingIdentitySha256: null }]
]) test(`${label} cannot send a forged confirmation`, async () => {
  const view = screen({ read: ({ base }) => ({ ...base, items: [{ ...item(), ...change }] }) }); await view.ready();
  view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
});

for (const [label, change] of [
  ['blocked status', { status: 'blocked' }], ['generating status', { status: 'generating' }],
  ['ready status', { status: 'ready' }], ['attempts already made', { attemptCount: 1 }],
  ['current reason', { reason: 'current' }], ['blocked reason', { reason: 'blocked' }],
  ['attempted reason', { reason: 'attempted' }], ['null review identity', { reviewSha256: null }],
  ['null current identity', { currentBookingIdentitySha256: null }]
]) test(`inconsistent canReprepare true with ${label} quarantines the entire read`, async () => {
  const view = screen({ read: ({ base }) => ({ ...base, items: [{ ...item(), ...change }] }) });
  await view.ready(); assert.equal(view.snapshot().phase, 'error'); assertInert(view);
  view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
});

test('server titles use a Korean JSON title or available actual title before the slug', async () => {
  const view = screen();
  view.setCatalog([
    { ...works[0], title: { en: 'English title', ko: ' 한국어 작품 제목 ', ja: 'Japanese title' } },
    { ...works[1], title: { ko: { invalid: 'not a string' }, en: 'Actual English title' } }
  ]);
  await view.loadCatalog();
  assert.equal(view.snapshot().catalog[0].title, '한국어 작품 제목');
  assert.equal(view.snapshot().catalog[1].title, 'Actual English title');
  view.setCatalog([{ ...works[0], title: '<strong>actual title</strong>' }]); await view.loadCatalog();
  assert.equal(view.snapshot().catalog[0].title, '<strong>actual title</strong>');
});

test('unsupported scope and an empty eligible page are valid but never actionable', async () => {
  for (const eligible of [false, true]) {
    const view = screen({ read: ({ base }) => ({ ...base, eligible, items: [] }) }); await view.ready();
    assert.equal(view.snapshot().phase, 'ready'); assert.equal(view.snapshot().review.eligible, eligible);
    view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  }
});

for (const [label, change] of [
  ['cross-work', { workId: works[1].id }], ['cross-release', { releaseId: release(2) }],
  ['bad checksum', { releaseChecksum: 'not-sha256' }], ['missing eligibility', { eligible: undefined }],
  ['uppercase checksum', { releaseChecksum: checksum.toUpperCase() }],
  ['bad cursor', { nextAfterId: 'not-uuid' }], ['missing items', { items: undefined }],
  ['over eight items', { items: Array.from({ length: 9 }, (_, i) => item(11 + i)) }],
  ['duplicate items', { items: [item(), item()] }], ['unsupported nonempty', { eligible: false }],
  ['empty with cursor', { items: [], nextAfterId: id(11) }]
]) test(`GET rejects ${label} and clears an earlier active action`, async () => {
  let bad = false;
  const view = screen({ read: ({ base }) => bad ? { ...base, ...change } : base }); await view.ready(); view.approve();
  bad = true; await view.loadReview(); assertInert(view); assert.equal(view.snapshot().phase, 'error');
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
});

for (const [label, change] of [
  ['invalid generation ID', { generationId: 'bad' }], ['unsafe scene key', { sourceSceneKey: '<img onerror=oops>' }],
  ['long scene key', { sourceSceneKey: 's'.repeat(161) }], ['blank key', { sourceSceneKey: '' }],
  ['unknown reason', { reason: 'new-reason' }], ['unknown status', { status: 'new-status' }],
  ['negative attempts', { attemptCount: -1 }], ['string attempts', { attemptCount: '0' }],
  ['fractional attempts', { attemptCount: 0.1 }], ['nonboolean gate', { canReprepare: 1 }],
  ['missing review hash', { reviewSha256: undefined }], ['invalid review hash', { reviewSha256: 'bad' }],
  ['missing current hash', { currentBookingIdentitySha256: undefined }], ['invalid booked hash', { bookedIdentitySha256: 'bad' }],
  ['missing prompt hash', { promptSha256: null }],
  ['uppercase review SHA', { reviewSha256: reviewHash.toUpperCase() }],
  ['uppercase current identity SHA', { currentBookingIdentitySha256: identityHash.toUpperCase() }],
  ['uppercase booked identity SHA', { bookedIdentitySha256: reviewHash.toUpperCase() }],
  ['uppercase prompt SHA', { promptSha256: promptHash.toUpperCase() }]
]) test(`GET malformed item ${label} fails closed`, async () => {
  const view = screen({ read: ({ base }) => ({ ...base, items: [{ ...item(), ...change }] }) });
  await view.ready(); assertInert(view); view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
});

test('read failure resets confirmation and all pagination instead of leaving a previous action active', async () => {
  let fail = false;
  const view = screen({ read: ({ base }) => { if (fail) throw new Error('offline'); return base; } });
  await view.ready(); view.approve(); fail = true;
  const pending = view.loadReview(); assertInert(view);
  await pending; assertInert(view); assert.equal(view.snapshot().pageCount, 0);
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 0);
  fail = false; await view.loadReview(); view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('work, release, catalog and authentication changes quarantine late GET responses', async () => {
  for (const change of ['work', 'release', 'catalog', 'auth', 'logout']) {
    const held = deferred(); let holding = true;
    const view = screen({ read: ({ base }) => holding ? held.promise : base });
    await view.loadCatalog(); view.selectWork(works[0].id, view.rev());
    const pending = view.loadReview();
    if (change === 'work') view.selectWork(works[1].id, view.rev());
    if (change === 'release') { view.setCatalog([{ ...works[0], activeReleaseId: release(3) }, works[1]]); await view.loadCatalog(); }
    if (change === 'catalog') { view.setCatalog([]); await view.loadCatalog(); }
    if (change === 'auth' || change === 'logout') { view.setAuth(change === 'logout' ? null : 'other-operator'); view.syncSession(); }
    held.resolve(review()); await pending; assertInert(view); assert.equal(view.posts().length, 0);
    holding = false;
  }
});

test('same-session late errors cannot erase a newer verified read', async () => {
  const held = deferred(); let count = 0;
  const view = screen({ read: ({ base }) => ++count === 1 ? held.promise : base });
  await view.loadCatalog(); view.selectWork(works[0].id, view.rev()); const old = view.loadReview();
  view.selectWork(works[1].id, view.rev()); await view.loadReview();
  held.reject(new Error('old failure')); await old;
  assert.equal(view.snapshot().phase, 'ready'); assert.equal(view.snapshot().review.workId, works[1].id);
});

test('stale DOM revisions and changed auth cannot reuse a checkbox or confirmation', async () => {
  const view = screen(); await view.ready(); view.approve(); const old = view.rev();
  await view.loadReview(); view.acknowledge(true, old); view.requestConfirmation(old); await view.reprepare(old);
  assert.equal(view.posts().length, 0); assert.equal(view.snapshot().checked, false);
  view.approve(); view.setAuth('changed-token'); await view.reprepare(view.rev());
  assertInert(view); assert.equal(view.snapshot().catalogVerified, false); assert.equal(view.posts().length, 0);
});

test('controls from a previously selected item or canceled dialog cannot confirm a different item', async () => {
  const view = screen({ read: ({ work }) => review(work, [item(11), item(12)]) }); await view.ready();
  view.approve(11); const old = view.rev();
  view.select(12); view.acknowledge(true, old); view.requestConfirmation(old); await view.reprepare(old);
  assert.equal(view.snapshot().checked, false); assert.equal(view.posts().length, 0);
  view.approve(12); const canceled = view.rev(); view.cancelConfirmation(); view.approve(12);
  await view.reprepare(canceled); assert.equal(view.posts().length, 0);
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
  assert.equal(view.posts()[0].options.body.generationId, id(12));
});

test('preflight catalog changes or failures stop before POST and clear approvals', async () => {
  for (const mode of ['release', 'different work', 'catalog failure', 'invalid catalog']) {
    let reads = 0;
    const view = screen({ catalogRead: ({ catalog }) => {
      reads += 1;
      if (reads > 1 && mode === 'catalog failure') throw new Error('offline');
      if (reads > 1 && mode === 'invalid catalog') return {};
      return { publishedWorks: catalog };
    } });
    await view.ready(); view.approve();
    if (mode === 'release') view.setCatalog([{ ...works[0], activeReleaseId: release(3) }, works[1]]);
    if (mode === 'different work') view.setCatalog([works[0]]);
    await view.reprepare(view.rev()); assertInert(view); assert.equal(view.posts().length, 0);
  }
});

test('catalog ordering does not change the selected binding', async () => {
  const view = screen(); await view.ready(); view.approve(); view.setCatalog([...works].reverse());
  await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('authentication change while preflight catalog is pending prevents POST', async () => {
  const held = deferred(); let count = 0;
  const view = screen({ catalogRead: ({ catalog }) => ++count === 1 ? { publishedWorks: catalog } : held.promise });
  await view.ready(); view.approve(); const pending = view.reprepare(view.rev());
  view.setAuth('other-operator'); held.resolve({ publishedWorks: works }); await pending;
  assertInert(view); assert.equal(view.posts().length, 0); assert.equal(view.snapshot().catalogVerified, false);
});

for (const [label, change] of [
  ['cross-work', { workId: id(2) }], ['cross-release', { releaseId: release(2) }],
  ['checksum changed', { releaseChecksum: 'b'.repeat(64) }], ['wrong generation', { generationId: id(12) }],
  ['wrong scene', { sourceSceneKey: 'other' }], ['wrong status', { status: 'ready' }],
  ['generation started', { generationStarted: true }], ['missing start flag', { generationStarted: undefined }],
  ['wrong identity', { bookingIdentitySha256: 'a'.repeat(64) }], ['bad identity', { bookingIdentitySha256: null }],
  ['uppercase identity', { bookingIdentitySha256: identityHash.toUpperCase() }]
]) test(`POST ${label} invalidates action and never retries`, async () => {
  const view = screen({ post: ({ base }) => ({ ...base, ...change }) }); await view.ready(); view.approve();
  await view.reprepare(view.rev()); assertInert(view); assert.equal(view.snapshot().phase, 'error');
  view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('POST failure never resets attempts locally, leaves no action, and needs a new read', async () => {
  let sent = false;
  const view = screen({ read: ({ base }) => sent ? { ...base, items: [{ ...item(), reason: 'attempted', attemptCount: 1, canReprepare: false }] } : base,
    post: () => { sent = true; throw new Error('uncertain result'); } });
  await view.ready(); view.approve(); await view.reprepare(view.rev());
  assertInert(view); assert.equal(view.snapshot().phase, 'error');
  await view.loadReview(); assert.equal(view.snapshot().review.items[0].attemptCount, 1);
  view.approve(); await view.reprepare(view.rev()); assert.equal(view.posts().length, 1);
});

test('in-flight POST allows no second request and quarantines late success after auth or target reset', async () => {
  for (const change of ['auth', 'work', 'catalog']) {
    const held = deferred(); let base;
    const view = screen({ post: value => { base = value.base; return held.promise; } });
    await view.ready(); view.approve(); const old = view.rev(); const pending = view.reprepare(old);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(view.posts().length, 1); assertInert(view);
    await view.reprepare(old); assert.equal(view.posts().length, 1);
    if (change === 'auth') { view.setAuth('other'); view.syncSession(); }
    if (change === 'work') view.selectWork(works[1].id, view.rev());
    if (change === 'catalog') await view.loadCatalog();
    const state = plain(view.snapshot()); held.resolve(base); await pending;
    assert.deepEqual(plain(view.snapshot()), state, change);
  }
});

test('pagination uses bounded pages and stable previous/next navigation, with no automatic mutation', async () => {
  const view = screen({ read: ({ work, afterId }) => afterId === id(11) ? review(work, [item(12)]) : review(work, [item(11)], id(11)) });
  await view.ready(); view.approve(); await view.loadReview('next', view.rev());
  assert.equal(view.snapshot().pageIndex, 1); assert.equal(view.snapshot().checked, false);
  assert.equal(view.snapshot().selected, null);
  assert.equal(view.calls.at(-1).url, `/admin/api/v1/story-visuals/${id(1)}/booking-review?afterId=${id(11)}`);
  await view.loadReview('previous', view.rev()); assert.equal(view.snapshot().pageIndex, 0);
  await view.loadReview('next', view.rev()); assert.equal(view.snapshot().review.items[0].generationId, id(12));
  assert.equal(view.posts().length, 0);
});

for (const kind of ['self cursor', 'cycle', 'duplicate generation', 'checksum drift', 'changed previous link']) {
  test(`pagination rejects ${kind} without retaining an actionable previous page`, async () => {
    let count = 0;
    const view = screen({ read: ({ work, afterId }) => {
      count += 1;
      if (!afterId && count > 2 && kind === 'changed previous link') return review(work, [item(11)], id(13));
      if (!afterId) return review(work, [item(11)], id(11));
      if (afterId === id(11)) {
        if (kind === 'self cursor') return review(work, [item(12)], id(11));
        if (kind === 'duplicate generation') return review(work, [item(11)]);
        if (kind === 'checksum drift') return { ...review(work, [item(12)]), releaseChecksum: 'a'.repeat(64) };
        return review(work, [item(12)], kind === 'cycle' ? id(12) : null);
      }
      return review(work, [item(13)], id(11));
    } });
    await view.ready(); await view.loadReview('next', view.rev());
    if (kind === 'cycle') await view.loadReview('next', view.rev());
    if (kind === 'changed previous link') await view.loadReview('previous', view.rev());
    assert.equal(view.snapshot().phase, 'error'); assertInert(view); assert.equal(view.posts().length, 0);
  });
}

test('catalog rejects duplicate identifiers, missing collections and invalid releases without fallback', async () => {
  for (const publishedWorks of [undefined, [works[0], works[0]], [{ ...works[0], id: 'bad' }],
    [{ ...works[0], activeReleaseId: 'bad' }]]) {
    const view = screen({ catalogRead: () => ({ publishedWorks }) }); await view.loadCatalog();
    assert.equal(view.snapshot().catalogVerified, false); assert.deepEqual(plain(view.snapshot().catalog), []);
    view.selectWork(id(1), view.rev()); await view.loadReview(); assert.equal(view.calls.length, 1);
  }
});

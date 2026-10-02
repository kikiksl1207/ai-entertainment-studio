import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../pages/story-stage.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const bootstrap = page.lastIndexOf('  updateHeading();\n  if (state.sessionId) loadScene();');
assert.ok(bootstrap > 0, 'page bootstrap must be found before exposing test-only state');
// Execute the real page and event handlers, skipping only its automatic initial fetch.
const source = page.slice(0, bootstrap) + `
  window.participantHarness = { state, COPY, loadPack, searchParticipantArtists, startStory,
    renderParticipantPicker, participantItems, detailAction, renderPack, dismissPack };
})();`;

const workId = '22222222-2222-4222-8222-222222222222';
const partId = '44444444-4444-4444-8444-444444444444';
const progressId = '11111111-1111-4111-8111-111111111111';
const artistA = '11111111-1111-4111-8111-111111111112';
const artistB = '11111111-1111-4111-8111-111111111113';
const pendingId = '11111111-1111-4111-8111-111111111114';
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const cap = { configStatus: 'active', choicePolicy: 'first_public_release', fixedChoices: 3,
  customChoiceEnabled: false, revision: 4, source: 'active_release_capability' };
const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const artist = (artistId, displayName = 'Artist A', ready = true) => ({ artistId, displayName,
  slug: 'artist-name', visualIdentityReady: ready, source: 'search', thumbnail: null });
const candidates = (overrides = {}) => ({ engaged: [artist(artistA), artist(artistB, 'Artist B')],
  searchResults: [], selectedArtistId: null, selectionLocked: false, ...overrides });
const result = () => ({ progressId, revision: 6, choices: [] });
function failure(status = 500, code = 'INTERNAL_TEST_ERROR') {
  return Object.assign(new Error('private diagnostic must stay hidden'), { status, body: { error: { code } } });
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    emit(name, event = {}) { return Promise.all((listeners.get(name) || []).map((listener) => listener(event))); },
  };
}
function openingTag(markup, attribute) {
  const index = markup.indexOf(attribute);
  assert.ok(index >= 0, `missing control ${attribute}`);
  return markup.slice(markup.lastIndexOf('<', index), markup.indexOf('>', index) + 1);
}

function harness({ locale = 'en', resume = false, participant = null, hook = () => undefined } = {}) {
  let auth = { accessToken: 'token-a', user: { id: 'account-a' } };
  let responder = hook;
  const requests = [];
  const root = { ...eventTarget(), innerHTML: '', setAttribute() {}, querySelector: () => null,
    querySelectorAll: () => [], insertAdjacentHTML(_position, html) { this.innerHTML += html; } };
  const document = { ...eventTarget(), activeElement: null,
    getElementById: (id) => id === 'storyStageRoot' ? root : null, querySelector: () => null,
    body: { classList: { add() {}, remove() {} } } };
  const close = { dataset: {}, hasAttribute: () => false, focus() { document.activeElement = close; } };
  const body = { scrollTop: 0 };
  const dialog = { innerHTML: '', close() {}, remove() {},
    querySelector: (selector) => selector === '.story-detail-body' ? body : selector === '[data-story-close]' ? close : null };
  const location = { search: '', origin: 'https://participant.test', href: 'https://participant.test/story-stage' };
  const storage = new Map();
  const access = (authenticated = true) => ({ accessible: true, status: 'free',
    pricing: { amountLumina: '0', currencyCode: 'LUMINA', free: true },
    actions: { authenticationRequired: !authenticated, primary: resume ? 'continue' : 'start',
      canStart: true, canContinue: resume, canPurchase: false } });
  const detail = () => ({ id: workId, slug: 'test-story', title: 'Test story', summary: 'Story summary',
    access: access(false), releaseCapability: copy(cap), parts: [{ id: partId, position: 1, title: 'First part' }] });
  const owner = () => ({ workId, slug: 'test-story', access: access(), aiCapability: copy(cap),
    replay: { continue: resume, reset: resume } });
  const progress = () => ({ statusKey: `story.progress.status.${resume ? 'ready' : 'noProgress'}`,
    canResume: resume, storyAccess: { entitled: true }, releaseCapability: copy(cap),
    ...(participant ? { participantArtist: copy(participant) } : {}) });
  const window = { ...eventTarget(), luminaI18n: { getLocale: () => locale },
    getAuth: () => auth, isLoggedIn: () => Boolean(auth?.accessToken), scrollY: 0, scrollTo() {},
    async apiFetch(path, options = {}) {
      const url = new URL(path, 'https://participant.test');
      const request = { path: url.pathname, query: Object.fromEntries(url.searchParams),
        ...options, body: copy(options.body), identity: auth?.user?.id || '' };
      requests.push(request);
      const response = await responder(request);
      if (response !== undefined) return response;
      if (request.path === '/api/v1/stories/test-story') return detail();
      if (request.path.endsWith('/access')) return owner();
      if (request.path.endsWith('/progress-state')) return progress();
      if (request.path.endsWith('/artist-candidates')) return candidates(participant
        ? { selectedArtistId: participant.artistId, selectionLocked: true, engaged: [copy(participant)] } : {});
      if (request.method === 'POST' && request.path.endsWith('/progress')) return result();
      throw new Error(`Unexpected request ${request.path}`);
    } };
  runInNewContext(source, { window, document, location, URL, URLSearchParams, AbortController,
    setTimeout, clearTimeout, console, history: { replaceState() {}, back() {} },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key) }, fetch() { throw new Error('Network is prohibited in this harness'); } });
  const api = window.participantHarness;
  function target(attribute, value = '') {
    return { dataset: attribute === 'data-story-artist-id' ? { storyArtistId: value } : {}, value,
      hasAttribute: (name) => name === attribute,
      matches: (selector) => selector === `[${attribute}]`,
      closest(selector) {
        if (selector === '.story-detail-modal') return dialog;
        return selector === `[${attribute}]` ? this : null;
      } };
  }
  return { ...api, requests, window, location, root, dialog, progress,
    setHook: (next) => { responder = next; }, setAuth: (next) => { auth = next; },
    async open() { api.state.dialog = dialog; api.state.detailSlug = 'test-story'; await api.loadPack('test-story'); },
    click: (attribute, value) => root.emit('click', { target: target(attribute, value) }),
    input: (value) => root.emit('input', { target: target('data-story-artist-search', value) }),
    search(query) { api.state.participantQuery = query; return api.searchParticipantArtists(); },
    html: () => dialog.innerHTML,
    posts: () => requests.filter((request) => request.method === 'POST') };
}

test('normal selection, readiness, escaping, clearing and no-artist start use real handlers', async () => {
  const h = harness({ hook: (r) => r.path.endsWith('/artist-candidates') ? candidates({ engaged: [
    artist(artistA, '<Artist & A>'), artist(pendingId, 'Pending artist', false),
    artist('not-a-uuid', 'Malformed artist'), artist(artistB, 'Artist B', 'true'),
  ] }) : undefined });
  await h.open();
  assert.equal(h.detailAction(), 'start');
  assert.ok(h.html().includes('&lt;Artist &amp; A&gt;'));
  assert.ok(!h.html().includes('Malformed artist'));
  assert.ok(openingTag(h.html(), `data-story-artist-id="${pendingId}"`).includes('disabled'));
  await h.click('data-story-artist-id', pendingId);
  await h.click('data-story-artist-id', artistB);
  await h.click('data-story-artist-id', 'not-a-uuid');
  assert.equal(h.state.selectedParticipantArtistId, '');
  await h.click('data-story-artist-id', artistA);
  assert.equal(h.state.selectedParticipantArtist.artistId, artistA);
  assert.ok(openingTag(h.html(), `data-story-artist-id="${artistA}"`).includes('aria-pressed="true"'));
  await h.click('data-story-artist-clear');
  assert.equal(h.state.selectedParticipantArtist, null);
  await h.startStory();
  assert.deepEqual(h.posts()[0].body, { mode: 'continue', locale: 'en' });
  assert.equal(h.location.href, `/story-stage?sessionId=${progressId}&workId=${workId}`);
});

for (const next of ['different-results', 'empty-submit', 'search-error']) {
  test(`selected search-only snapshot remains visible and binds after ${next}`, async () => {
    const selected = { ...artist(artistA, 'Search-only artist'), thumbnail: { publicUrl: '/assets/artist.webp' } };
    const h = harness({ hook: (r) => r.path.endsWith('/artist-candidates') ? candidates({ engaged: [],
      searchResults: r.query.q === 'first' ? [selected] : [artist(artistB, 'Other artist')] }) : undefined });
    await h.open();
    await h.search('first');
    await h.click('data-story-artist-id', artistA);
    if (next === 'search-error') h.setHook((r) => { if (r.query.q) throw failure(); });
    await h.search(next === 'empty-submit' ? '' : 'second');
    assert.equal(h.state.selectedParticipantArtistId, artistA);
    assert.ok(h.html().includes('Search-only artist'));
    assert.ok(h.html().includes('/assets/artist.webp'));
    assert.ok(openingTag(h.html(), `data-story-artist-id="${artistA}"`).includes('aria-pressed="true"'));
    h.setHook(() => undefined);
    await h.startStory();
    assert.equal(h.posts()[0].body.participantArtistId, artistA);
  });
}

for (const outcome of ['success', 'error']) {
  test(`latest search wins against a late ${outcome}, including repeated identical queries`, async () => {
    const old = deferred();
    const fresh = deferred();
    let queries = 0;
    const h = harness({ hook: (r) => r.query.q ? (++queries === 1 ? old.promise : fresh.promise) : undefined });
    await h.open();
    const first = h.search('same');
    const second = h.search('same');
    fresh.resolve(candidates({ searchResults: [artist(artistB, 'Latest result')] }));
    await second;
    const rendered = h.html();
    if (outcome === 'success') old.resolve(candidates({ searchResults: [artist(artistA, 'Stale result')] }));
    else old.reject(failure());
    await first;
    assert.equal(h.html(), rendered);
    assert.equal(h.state.participantStatus, 'ready');
    assert.deepEqual(Array.from(h.state.participantSearchResults, (item) => item.artistId), [artistB]);
  });
}

for (const clear of ['empty-submit', 'input-clear']) {
  test(`${clear} fences outstanding searches without losing the selected snapshot`, async () => {
    const gate = deferred();
    const h = harness({ hook: (r) => r.query.q ? gate.promise : undefined });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    const pending = h.search('old');
    if (clear === 'empty-submit') await h.search('');
    else await h.input('');
    gate.resolve(candidates({ searchResults: [artist(artistB, 'Late result')] }));
    await pending;
    assert.equal(h.state.participantStatus, 'ready');
    assert.equal(h.state.participantSearchResults.length, 0);
    assert.equal(h.state.selectedParticipantArtistId, artistA);
  });
}

for (const boundary of ['account-without-event', 'locale', 'work', 'epoch']) {
  test(`artist search completion is fenced by ${boundary}`, async () => {
    const gate = deferred();
    const h = harness({ hook: (r) => r.query.q ? gate.promise : undefined });
    await h.open();
    const pending = h.search('old');
    if (boundary === 'account-without-event') h.setAuth({ accessToken: 'b', user: { id: 'account-b' } });
    if (boundary === 'locale') h.state.locale = 'ja';
    if (boundary === 'work') h.state.pack.id = partId;
    if (boundary === 'epoch') ++h.state.epoch;
    const rendered = h.html();
    gate.resolve(candidates({ searchResults: [artist(artistB, 'Prior context')] }));
    await pending;
    assert.equal(h.state.participantSearchResults.length, 0);
    assert.equal(h.html(), rendered);
  });
}

test('same-tab authchange clears selection and old searches, but same-user refresh preserves it', async () => {
  const gate = deferred();
  const h = harness({ hook: (r) => {
    if (r.query.q) return gate.promise;
    if (r.path.endsWith('/artist-candidates') && r.identity === 'account-b') return candidates({ engaged: [artist(artistB, 'B roster')] });
  } });
  await h.open();
  await h.click('data-story-artist-id', artistA);
  const epoch = h.state.epoch;
  const count = h.requests.length;
  h.setAuth({ accessToken: 'rotated-a', user: { id: 'account-a' } });
  await h.window.emit('lumina:authchange');
  assert.equal(h.state.epoch, epoch);
  assert.equal(h.requests.length, count);
  assert.equal(h.state.selectedParticipantArtistId, artistA);
  const pending = h.search('old');
  h.setAuth({ accessToken: 'b', user: { id: 'account-b' } });
  await h.window.emit('lumina:authchange');
  const rendered = h.html();
  gate.resolve(candidates({ searchResults: [artist(artistA, 'A private roster')] }));
  await pending;
  assert.equal(h.state.readerIdentity, 'account-b');
  assert.equal(h.state.selectedParticipantArtist, null);
  assert.equal(h.state.participantSearchResults.length, 0);
  assert.equal(h.html(), rendered);
  assert.ok(h.html().includes('B roster'));
});

test('same-tab logout removes pinned artist state and never requests private access', async () => {
  const h = harness({ resume: true, participant: artist(artistA, 'Private pinned artist') });
  await h.open();
  const count = h.requests.length;
  h.setAuth(null);
  await h.window.emit('lumina:authchange');
  assert.equal(h.state.readerAccess, null);
  assert.equal(h.state.readerState, null);
  assert.equal(h.state.selectedParticipantArtist, null);
  assert.ok(!h.html().includes('Private pinned artist'));
  assert.ok(h.requests.slice(count).every((request) => request.auth !== true));
  await h.startStory();
  assert.equal(h.posts().length, 0);
});

test('an authenticated session without a user identity cannot select or start', async () => {
  const h = harness();
  h.setAuth({ accessToken: 'malformed-session' });
  await h.open();
  assert.equal(h.detailAction(), 'unavailable');
  await h.click('data-story-artist-id', artistA);
  await h.startStory();
  assert.equal(h.state.selectedParticipantArtistId, '');
  assert.equal(h.posts().length, 0);
});

test('pending start freezes controls and handlers, ignores prior search, and sends one exact artist', async () => {
  const start = deferred();
  const search = deferred();
  const h = harness({ hook: (r) => r.method === 'POST' ? start.promise : r.query.q ? search.promise : undefined });
  await h.open();
  await h.click('data-story-artist-id', artistA);
  const searching = h.search('old');
  const starting = h.startStory();
  for (const attribute of ['data-story-artist-clear', 'data-story-artist-search-submit', 'data-story-artist-search ',
    `data-story-artist-id="${artistA}"`, `data-story-artist-id="${artistB}"`]) {
    assert.ok(openingTag(h.html(), attribute).includes('disabled'));
  }
  await h.click('data-story-artist-id', artistB);
  await h.click('data-story-artist-clear');
  await h.input('new');
  await h.searchParticipantArtists();
  await h.startStory();
  search.resolve(candidates({ selectionLocked: true }));
  await searching;
  assert.equal(h.state.selectedParticipantArtistId, artistA);
  assert.equal(h.state.participantLocked, false);
  assert.equal(h.state.participantQuery, 'old');
  assert.equal(h.posts().length, 1);
  start.resolve(result());
  await starting;
  assert.deepEqual(h.posts()[0].body, { mode: 'continue', locale: 'en', participantArtistId: artistA });
  assert.equal(h.state.detailPending, false);
  assert.equal(h.location.href, `/story-stage?sessionId=${progressId}&workId=${workId}`);
});

for (const outcome of ['success', 'error']) {
  test(`old account start ${outcome} cannot redirect or unfreeze a newer account start`, async () => {
    const old = deferred();
    const fresh = deferred();
    const h = harness({ hook: (r) => r.method === 'POST' ? (r.identity === 'account-a' ? old.promise : fresh.promise) : undefined });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    const first = h.startStory();
    h.setAuth({ accessToken: 'b', user: { id: 'account-b' } });
    await h.window.emit('lumina:authchange');
    await h.click('data-story-artist-id', artistB);
    const second = h.startStory();
    if (outcome === 'success') old.resolve(result());
    else old.reject(failure(409, 'STORY_PARTICIPANT_IDENTITY_NOT_READY'));
    await first;
    assert.equal(h.state.detailPending, true);
    assert.equal(h.state.selectedParticipantArtistId, artistB);
    assert.equal(h.state.participantNotice, '');
    assert.equal(h.location.href, 'https://participant.test/story-stage');
    fresh.resolve(result());
    await second;
    assert.equal(h.state.detailPending, false);
    assert.equal(h.posts()[1].body.participantArtistId, artistB);
    assert.equal(h.location.href, `/story-stage?sessionId=${progressId}&workId=${workId}`);
  });
}

for (const resume of [false, true]) {
  test(`locked-null ${resume ? 'continue' : 'start'} has no editable or invented participant`, async () => {
    const h = harness({ resume, hook: (r) => r.path.endsWith('/artist-candidates') ? candidates({ selectionLocked: true }) : undefined });
    await h.open();
    assert.equal(h.state.participantLocked, true);
    assert.equal(h.state.selectedParticipantArtist, null);
    assert.ok(!h.html().includes('data-story-artist-search'));
    assert.ok(!h.html().includes('data-story-artist-id'));
    if (!resume) assert.ok(h.html().includes(h.COPY.en.participantSelectionLocked));
    await h.click('data-story-artist-id', artistA);
    await h.startStory();
    assert.deepEqual(h.posts()[0].body, { mode: 'continue', locale: 'en' });
  });
}

test('a search response lock clears provisional selection without inventing a progress pin', async () => {
  const h = harness({ hook: (r) => r.query.q ? candidates({ selectionLocked: true, selectedArtistId: artistB }) : undefined });
  await h.open();
  await h.click('data-story-artist-id', artistA);
  await h.search('changed progress');
  assert.equal(h.state.participantLocked, true);
  assert.equal(h.state.selectedParticipantArtistId, '');
  assert.equal(h.state.readerState.participantArtist, undefined);
  assert.ok(!h.html().includes('data-story-artist-id'));
  await h.click('data-story-artist-clear');
  await h.startStory();
  assert.equal(h.posts()[0].body.participantArtistId, undefined);
});

test('actual progress pin remains authoritative, read-only, and included on continue', async () => {
  const fixed = artist(artistA, 'Fixed companion');
  const h = harness({ resume: true, participant: fixed });
  await h.open();
  assert.ok(openingTag(h.html(), `data-story-artist-id="${artistA}"`).includes('disabled'));
  assert.ok(!h.html().includes('data-story-artist-clear'));
  await h.click('data-story-artist-id', artistB);
  await h.click('data-story-artist-clear');
  assert.equal(h.state.selectedParticipantArtistId, artistA);
  await h.startStory();
  assert.equal(h.posts()[0].body.participantArtistId, artistA);
});

test('new readiness metadata updates the retained selection and prevents an unready start', async () => {
  const h = harness({ hook: (r) => r.query.q ? candidates({
    searchResults: [artist(artistA, 'Artist A', false)],
  }) : undefined });
  await h.open();
  await h.click('data-story-artist-id', artistA);
  await h.search('updated readiness');
  assert.equal(h.state.selectedParticipantArtist.visualIdentityReady, false);
  h.setHook((r) => r.query.q ? candidates({ engaged: [] }) : undefined);
  await h.search('different results');
  await h.startStory();
  assert.equal(h.posts().length, 0);
  assert.ok(h.html().includes('Artist A'));
  await h.click('data-story-artist-clear');
  await h.startStory();
  assert.deepEqual(h.posts()[0].body, { mode: 'continue', locale: 'en' });
});

test('optional candidate failure never bypasses a failed authoritative progress read', async () => {
  const h = harness({ hook: (r) => {
    if (r.path.endsWith('/progress-state') || r.path.endsWith('/artist-candidates')) throw failure();
  } });
  await h.open();
  assert.equal(h.detailAction(), 'unavailable');
  await h.startStory();
  assert.equal(h.posts().length, 0);
});

for (const resume of [false, true]) for (const problem of ['offline', '500', 'malformed']) {
  test(`optional candidates ${problem} does not block authorized ${resume ? 'continue' : 'start'}`, async () => {
    const h = harness({ resume, participant: resume ? artist(artistA, 'Fixed companion') : null, hook: (r) => {
      if (!r.path.endsWith('/artist-candidates')) return;
      if (problem === 'malformed') return { engaged: [], searchResults: [], selectionLocked: 'false', selectedArtistId: null };
      throw problem === 'offline' ? new Error('offline') : failure();
    } });
    await h.open();
    assert.equal(h.detailAction(), resume ? 'continue' : 'start');
    assert.equal(h.state.participantStatus, 'error');
    if (resume) assert.ok(h.html().includes('Fixed companion'));
    else assert.ok(h.html().includes(h.COPY.en.participantSearchError));
    await h.startStory();
    assert.equal(h.posts().length, 1);
    assert.equal(h.posts()[0].body.participantArtistId, resume ? artistA : undefined);
  });
}

for (const phase of ['access', 'progress-state', 'artist-candidates']) for (const status of [401, 403]) {
  test(`${phase} ${status} fails closed rather than treating auth as optional`, async () => {
    const h = harness({ hook: (r) => { if (r.path.endsWith(`/${phase}`)) throw failure(status); } });
    await h.open();
    assert.equal(h.state.detailStatus, 'access-error');
    assert.equal(h.detailAction(), 'unavailable');
    await h.startStory();
    assert.equal(h.posts().length, 0);
    assert.ok(!h.html().includes('private diagnostic'));
  });
}

for (const status of [401, 403]) {
  test(`search ${status} clears participant state and blocks start`, async () => {
    const h = harness({ hook: (r) => { if (r.query.q) throw failure(status); } });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    await h.search('denied');
    assert.equal(h.state.readerAccess, null);
    assert.equal(h.state.readerState, null);
    assert.equal(h.state.selectedParticipantArtist, null);
    assert.equal(h.detailAction(), 'unavailable');
    await h.startStory();
    assert.equal(h.posts().length, 0);
  });
}

test('a late prior-account 403 cannot clear the new account picker', async () => {
  const gate = deferred();
  const h = harness({ hook: (r) => r.query.q ? gate.promise : undefined });
  await h.open();
  const pending = h.search('old account');
  h.setAuth({ accessToken: 'b', user: { id: 'account-b' } });
  await h.window.emit('lumina:authchange');
  await h.click('data-story-artist-id', artistB);
  gate.reject(failure(403));
  await pending;
  assert.equal(h.detailAction(), 'start');
  assert.equal(h.state.selectedParticipantArtistId, artistB);
  assert.equal(h.state.participantStatus, 'ready');
});

for (const invalid of [null, {}, candidates({ selectedArtistId: 'bad' }), candidates({ selectedArtistId: artistB }),
  candidates({ engaged: {} }), candidates({ searchResults: {} }), candidates({ selectionLocked: null })]) {
  test(`malformed search envelope never updates candidates or selection: ${JSON.stringify(invalid)}`, async () => {
    const h = harness({ hook: (r) => r.query.q ? invalid : undefined });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    await h.search('malformed');
    assert.equal(h.state.participantStatus, 'error');
    assert.equal(h.state.selectedParticipantArtistId, artistA);
    assert.equal(h.state.participantLocked, false);
    assert.ok(h.html().includes('Artist A'));
    assert.equal(h.posts().length, 0);
  });
}

for (const locale of locales) {
  test(`${locale}: identity-not-ready keeps a localized, recoverable picker`, async () => {
    let rejected = false;
    const h = harness({ locale, hook: (r) => {
      if (r.method === 'POST' && !rejected) { rejected = true; throw failure(409, 'STORY_PARTICIPANT_IDENTITY_NOT_READY'); }
    } });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    await h.startStory();
    assert.equal(h.state.detailPending, false);
    assert.equal(h.detailAction(), 'start');
    assert.equal(h.state.participantNotice, 'participantNotReady');
    assert.ok(h.COPY[locale].participantNotReady);
    assert.ok(h.html().includes(h.COPY[locale].participantNotReady.replaceAll("'", '&#39;')));
    assert.ok(h.html().includes('data-story-artist-clear'));
    assert.ok(h.html().includes('data-story-artist-search'));
    assert.ok(openingTag(h.html(), `data-story-artist-id="${artistA}"`).includes('disabled'));
    await h.startStory();
    assert.equal(h.posts().length, 1, 'not-ready selection must not be resubmitted');
    await h.click('data-story-artist-id', artistB);
    assert.equal(h.state.participantNotice, '');
    await h.startStory();
    assert.equal(h.posts()[1].body.participantArtistId, artistB);
    assert.equal(h.posts()[1].body.locale, locale);
  });
  test(`${locale}: lock-without-artist has its own localized copy`, async () => {
    const h = harness({ locale, hook: (r) => r.path.endsWith('/artist-candidates') ? candidates({ selectionLocked: true }) : undefined });
    await h.open();
    assert.ok(h.COPY[locale].participantSelectionLocked);
    assert.ok(h.html().includes(h.COPY[locale].participantSelectionLocked));
    assert.ok(!h.html().includes(h.COPY[locale].participantLocked));
  });
}

for (const invalid of [{ progressId: 'bad', revision: 1, choices: [] }, { progressId, choices: [] },
  { progressId, revision: 1, choices: [1, 2, 3, 4] }]) {
  test(`malformed start response never navigates or auto-replays: ${JSON.stringify(invalid)}`, async () => {
    const h = harness({ hook: (r) => r.method === 'POST' ? invalid : undefined });
    await h.open();
    await h.startStory();
    assert.equal(h.state.detailPending, false);
    assert.equal(h.detailAction(), 'unavailable');
    assert.equal(h.location.href, 'https://participant.test/story-stage');
    await h.startStory();
    assert.equal(h.posts().length, 1);
  });
}

for (const status of [401, 403]) {
  test(`start ${status} cannot masquerade as a recoverable participant error`, async () => {
    const h = harness({ hook: (r) => { if (r.method === 'POST') throw failure(status, 'STORY_PARTICIPANT_IDENTITY_NOT_READY'); } });
    await h.open();
    await h.click('data-story-artist-id', artistA);
    await h.startStory();
    assert.equal(h.state.readerAccess, null);
    assert.equal(h.state.selectedParticipantArtist, null);
    assert.equal(h.state.participantNotice, '');
    assert.equal(h.detailAction(), 'unavailable');
    assert.equal(h.location.href, 'https://participant.test/story-stage');
  });
}

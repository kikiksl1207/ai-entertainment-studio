import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../pages/story-stage.js', import.meta.url), 'utf8');
const support = await readFile(new URL('./story-stage-reader.test-support.mjs', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function section(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing reader section: ${start}`);
  return text.slice(first, last);
}

// Reuse the reader fixture without importing or registering its browser suite.
const current = runInNewContext(`${section(support, 'function current(options = {}) {', '\n  const beatPosts')}; current`, {
  projection: (count) => ({
    progressId: 'progress-id', status: count ? 'active' : 'completed', revision: 3,
    storyVersion: 1, currentBeatPosition: 0, activeReleaseId: 'release-id',
    releaseCapability: { revision: 1, source: 'approved' },
    scene: { id: 'scene-id', endingType: count ? null : 'author_main' },
    choices: Array.from({ length: count }, (_, index) => ({ id: `choice-${index}`, available: true })),
  }),
});
const runtime = [
  section(source, 'function readerScope(', 'function rememberReadingScroll('),
  section(source, 'function cancelBeatNavigation(', 'function aiRequestOpen('),
  section(source, 'function aiRequestOpen(', 'function aiNoticeCopy('),
  section(source, 'function setBusy(', 'function cancelAiPolling('),
  section(source, 'async function loadScene(', 'function graphTitle('),
  section(source, 'async function submitChoice(', 'async function submitCustomChoice('),
].join('\n');

function reader(options = {}) {
  const generated = options.generated !== false;
  const initial = plain(current({
    completed: options.completed !== false, generated, isGenerated: generated,
    positions: options.positions || (generated ? [1, 2, 3, 4, 5, 6] : [1, 2, 3]),
    position: options.position ?? 0,
  }));
  initial.scene.beats.forEach((beat) => { beat.content = `Sentence ${beat.position}.`; });
  if (generated) {
    if (!options.omitGeneratedSceneId) initial.currentGeneratedSceneId = initial.scene.id;
    initial.scene.deliveryState = 'ready';
    initial.scene.endingType = initial.status === 'completed' ? 'ai_generated' : null;
  }
  const state = {
    sessionId: initial.progressId, workId: 'work-id', locale: 'en', sceneIdentity: 'reader-a',
    progress: initial, scene: initial.scene, choices: initial.choices,
    epoch: 1, operation: 0, busy: false, minimumRevision: 3,
    completedBeat: null, beatOperation: null, beatNotice: '', aiNotice: null,
    controls: null, resetPreview: null,
  };
  let server = plain(initial);
  let identity = 'reader-a';
  let deadline;
  const requests = [];
  const blocks = [];
  const scrollStarts = [];
  const focuses = [];
  const fixture = {
    state, requests, blocks, scrollStarts, focuses,
    setIdentity: (value) => { identity = value; },
    ack: (entry) => ({ ...plain(server), currentBeatPosition: entry.body.position, revision: server.revision + 7 }),
    commit: (entry) => { server = fixture.ack(entry); return plain(server); },
    expire: () => { assert.ok(deadline); deadline(); },
  };
  const request = async (path, config = {}) => {
    const entry = { path, method: config.method || 'GET', auth: config.auth, signal: config.signal,
      body: config.body && plain(config.body) };
    requests.push(entry);
    if (entry.method === 'POST') return options.onPost ? options.onPost(entry, fixture) : fixture.commit(entry);
    return options.onGet ? options.onGet(entry, fixture) : plain(server);
  };
  const noop = () => {};
  Object.assign(fixture, runInNewContext(`${runtime}; ({ readableBeats, readerScope, turnBeat, cancelBeatNavigation, loadScene, submitChoice, confirmEndingRead, endingReadTarget })`, {
    state, request, readerIdentity: () => identity, AbortController,
    root: { setAttribute: noop, querySelector: (selector) => selector === '.story-current-title, .story-reader-shell'
      ? { scrollIntoView: (value) => scrollStarts.push(plain(value)) }
      : selector === '[data-story-scene-focus]' ? { focus: (value) => focuses.push(plain(value)) } : null,
      querySelectorAll: () => [], insertAdjacentHTML: noop },
    setTimeout: (callback, delay) => { assert.equal(delay, 15000); deadline = callback; return 1; },
    clearTimeout: () => { deadline = null; },
    // Only presentation and ancillary controls are stubbed; navigation/refetch guards run unchanged.
    renderScene: noop, renderState: (title, message) => blocks.push(message),
    refreshChangedLocale: async () => {}, cancelAiPolling: noop, rememberReadingScroll: noop,
    renderLoading: noop, readControls: async () => null, restoreAiOperation: noop,
    actionStatus: noop, tr: (key) => key, readerTr: (key) => key, controlTr: (key) => key,
    textValue: (value) => typeof value === 'string' ? value : value?.value || value?.en || '',
    escapeHtml: String,
  }));
  return fixture;
}

function assertCompleted(fixture, position, revision) {
  assert.equal(fixture.state.progress.status, 'completed');
  assert.equal(fixture.state.progress.currentBeatPosition, position);
  assert.equal(fixture.state.progress.revision, revision);
  assert.equal(fixture.state.minimumRevision, revision);
  assert.deepEqual(plain(fixture.state.choices), []);
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.state.beatOperation, null);
}

test('generated completed saves forward/back cursors without reopening status or allowing choices', async () => {
  const fixture = reader();
  assert.equal(fixture.readableBeats().index, 0);
  assert.equal(fixture.requests.length, 0);
  for (const [direction, position, revision] of [[1, 4, 10], [1, 6, 17], [-1, 4, 24]]) {
    await fixture.turnBeat(direction);
    assertCompleted(fixture, position, revision);
    const entry = fixture.requests.at(-1);
    assert.equal(entry.path, '/api/v1/me/story-progress/progress-id/beat?locale=en');
    assert.equal(entry.method, 'POST');
    assert.equal(entry.auth, true);
    assert.ok(entry.signal);
    assert.deepEqual(entry.body, { position, expectedRevision: revision - 7 });
    assert.equal(fixture.state.completedBeat, null);
    if (position === 6) {
      fixture.state.choices = [{ id: 'choice-0', available: true }];
      await fixture.submitChoice('choice-0');
      assert.equal(fixture.requests.length, 2);
      fixture.state.choices = [];
    }
  }
  assert.equal(fixture.state.scene.isGenerated, true);
  assert.equal(fixture.state.scene.endingType, 'ai_generated');
  assert.match(source, /fixedChoices.length && !isEnding && lastBeat/);
});

test('generated completed ignores stale local completedBeat and reloads its saved cursor', async () => {
  const fixture = reader();
  fixture.state.completedBeat = { scope: fixture.readerScope(), position: 6 };
  assert.equal(fixture.readableBeats().index, 0);
  await fixture.turnBeat(1);
  assertCompleted(fixture, 4, 10);
  assert.equal(fixture.state.completedBeat, null);
  fixture.state.completedBeat = { scope: fixture.readerScope(), position: 6 };
  await fixture.loadScene({ restorePending: false });
  assertCompleted(fixture, 4, 10);
  assert.equal(fixture.readableBeats().index, 1);
  assert.equal(fixture.state.completedBeat, null);
  assert.deepEqual(fixture.requests.map((entry) => entry.method), ['POST', 'GET']);
});

test('generated completed rejects invalid/status/choice/scope responses and refetches without POST replay', async () => {
  for (const invalidate of [
    (value) => { value.status = 'active'; },
    (value) => { value.choices = [{ id: 'choice-0' }]; },
    (value) => { value.choices = null; },
    (value) => { value.revision = 3; },
    (value) => { value.currentBeatPosition = 6; },
    (value) => { value.progressId = 'other-progress'; },
    (value) => { value.activeReleaseId = 'other-release'; },
    (value) => { value.currentGeneratedSceneId = 'other-generated'; },
    (value) => { value.scene.isGenerated = false; },
  ]) {
    const fixture = reader({ onPost: (entry, context) => {
      const invalid = context.ack(entry);
      invalidate(invalid);
      return invalid;
    } });
    await fixture.turnBeat(1);
    assertCompleted(fixture, 0, 3);
    assert.deepEqual(fixture.requests.map((entry) => entry.method), ['POST', 'GET']);
    assert.equal(fixture.requests[1].path, '/api/v1/story-sessions/progress-id/current-scene?locale=en');
    assert.equal(fixture.state.beatNotice, 'unconfirmed');
    assert.deepEqual(fixture.blocks, []);
  }
});

test('generated completed failures refetch, while auth or failed refetch blocks without retrying writes', async () => {
  for (const stale of [false, true]) {
    const fixture = reader({ onPost: () => {
      throw stale ? { status: 409, body: { error: { code: 'STORY_PROGRESS_STALE_REVISION' } } } : new Error('Write failed');
    } });
    await fixture.turnBeat(1);
    assertCompleted(fixture, 0, 3);
    assert.deepEqual(fixture.requests.map((entry) => entry.method), ['POST', 'GET']);
    assert.equal(fixture.state.beatNotice, stale ? 'progressChanged' : 'unconfirmed');
  }
  const auth = reader({ onPost: () => { throw { status: 403 }; } });
  await auth.turnBeat(1);
  assertCompleted(auth, 0, 3);
  assert.equal(auth.state.scene, null);
  assert.equal(auth.requests.length, 1);
  assert.deepEqual(auth.blocks, ['accessRequired']);
  for (const onGet of [
    () => { throw new Error('Refetch failed'); },
    () => ({ progressId: 'other-progress', revision: 10, choices: [] }),
  ]) {
    const fixture = reader({ onPost: () => { throw new Error('Unknown outcome'); }, onGet });
    await fixture.turnBeat(1);
    assertCompleted(fixture, 0, 3);
    assert.equal(fixture.state.scene, null);
    assert.equal(fixture.blocks.length, 1);
    assert.deepEqual(fixture.requests.map((entry) => entry.method), ['POST', 'GET']);
  }
});

test('generated completed deadline abort refetches a committed write without replaying it', async () => {
  const fixture = reader({ onPost: (entry, context) => {
    context.commit(entry);
    return new Promise((resolve, reject) => entry.signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('Deadline'), { name: 'AbortError' }));
    }, { once: true }));
  } });
  const pending = fixture.turnBeat(1);
  fixture.expire();
  await pending;
  assert.equal(fixture.requests[0].signal.aborted, true);
  assertCompleted(fixture, 4, 10);
  assert.equal(fixture.readableBeats().index, 1);
  assert.deepEqual(fixture.requests.map((entry) => entry.method), ['POST', 'GET']);
  assert.equal(fixture.state.beatNotice, 'unconfirmed');
});

test('generated completed pending writes are serialized and stale scoped/revision/status/aborted responses ignored', async () => {
  for (const change of [
    (fixture) => { fixture.state.locale = 'ko'; },
    (fixture) => { fixture.state.progress.activeReleaseId = 'other-release'; },
    (fixture) => { fixture.state.progress.revision = 30; fixture.state.minimumRevision = 30; },
    (fixture) => { fixture.state.progress.status = 'ai_pending'; },
    (fixture) => fixture.cancelBeatNavigation(),
  ]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fixture = reader({ onPost: () => gate });
    const pending = fixture.turnBeat(1);
    try {
      await fixture.turnBeat(1);
      await fixture.turnBeat(-1);
      assert.equal(fixture.requests.length, 1);
    } finally {
      const response = fixture.ack(fixture.requests[0]);
      change(fixture);
      const before = plain(fixture.state.progress);
      const floor = fixture.state.minimumRevision;
      release(response);
      await pending;
      assert.deepEqual(plain(fixture.state.progress), before);
      assert.equal(fixture.state.minimumRevision, floor);
    }
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.state.busy, false);
    assert.equal(fixture.state.beatOperation, null);
  }
});

test('canonical completed stays local while canonical/generated active saves retain status and choices', async () => {
  const canonical = reader({ generated: false });
  canonical.state.progress.currentSceneId = null;
  const before = plain(canonical.state.progress);
  await canonical.turnBeat(1);
  await canonical.turnBeat(1);
  assert.equal(canonical.readableBeats().index, 2);
  await canonical.turnBeat(-1);
  assert.equal(canonical.readableBeats().index, 1);
  assert.deepEqual(plain(canonical.state.progress), before);
  assert.deepEqual(canonical.requests, []);
  assertCompleted(canonical, 0, 3);
  for (const generated of [false, true]) {
    const fixture = reader({ generated, completed: false });
    const choices = plain(fixture.state.choices);
    await fixture.turnBeat(1);
    assert.deepEqual(fixture.requests[0].body, { position: generated ? 4 : 2, expectedRevision: 3 });
    assert.equal(fixture.state.progress.status, 'active');
    assert.equal(fixture.state.progress.revision, 10);
    assert.deepEqual(plain(fixture.state.choices), choices);
    await fixture.turnBeat(-1);
    assert.deepEqual(fixture.requests[1].body, { position: generated ? 2 : 1, expectedRevision: 10 });
    assert.equal(fixture.state.progress.status, 'active');
  }
});

test('a one-page generated ending visit does not automatically acknowledge reading', async () => {
  for (const positions of [[1], [1, 2]]) {
    const fixture = reader({ positions });
    await fixture.loadScene({ restorePending: false });
    assert.equal(fixture.readableBeats().beats.length, 1);
    await fixture.turnBeat(1);
    await fixture.turnBeat(-1);
    assertCompleted(fixture, 0, 3);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].method, 'GET');
  }
});

// Borrow only the existing full-IIFE fixture, without registering its contract tests.
const confirmationSuite = await readFile(new URL('./story-generated-ending-read-confirmation.test.mjs', import.meta.url), 'utf8');
const canonical = await readFile(new URL('../pages/story-canonical-read.js', import.meta.url), 'utf8');
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const endingReader = runInNewContext(
  `${section(confirmationSuite, 'function projection(', 'function assertReadPost(')}; fixture`,
  {
    assert, source: source.replace(/\r\n/g, '\n'), canonical, runInNewContext, plain, id,
    hash: text => createHash('sha256').update(text, 'utf8').digest('hex'),
    sentences: { en: 'Synthetic ending.' }, webcrypto, tick, URL, URLSearchParams, TextEncoder, AbortController,
    ArrayBuffer, Uint8Array,
    decode: value => String(value).replace(/&#13;/g, '\r').replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'),
  },
);

function assertReceiptOnly(fixture, before) {
  assert.deepEqual(plain(fixture.state.progress), before);
  assert.equal(fixture.state.minimumRevision, before.revision);
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.state.endingReadOperation, null);
  assert.ok(fixture.posts().every(entry => entry.path.endsWith('/generated-ending-read/confirm')));
}

test('full-page final navigation saves the cursor but does not confirm the ending', async () => {
  const fixture = endingReader({ position: 0 });
  await fixture.ready();
  assert.equal(fixture.button(), null);
  await fixture.api.turnBeat(1);
  await fixture.api.turnBeat(1);
  await fixture.ready();
  assert.deepEqual(plain(fixture.posts().map(entry => entry.body.position)), [4, 6]);
  assert.equal(fixture.state.progress.revision, 9);
  assert.equal(fixture.state.endingRead.status, 'idle');
  assert.equal(fixture.button().disabled, false);
  assert.equal(fixture.posts().filter(entry => entry.path.endsWith('/confirm')).length, 0);
});

test('explicit ending read confirms one-page or final grouped text without a cursor write', async () => {
  for (const options of [{ positions: [1], position: 0 }, { positions: [1, 2], position: 0 }, { position: 5 }]) {
    const fixture = endingReader({ ...options, onScene: (entry, context) => {
      delete context.server.currentGeneratedSceneId;
      return plain(context.server);
    } });
    await fixture.ready();
    const before = plain(fixture.state.progress);
    const target = fixture.api.endingReadTarget();
    assert.equal(fixture.posts().length, 0);
    assert.equal(fixture.reviews().length, 1);
    await fixture.confirm();
    assertReceiptOnly(fixture, before);
    const entry = fixture.posts()[0];
    assert.equal(entry.path, `/api/v1/me/story-progress/${id(2)}/generated-ending-read/confirm`);
    assert.deepEqual(Object.keys(entry.body).sort(), ['displayedAndRead', 'expectedRevision',
      'expectedScopeChecksum', 'expectedSourceTextHash', 'fromPosition', 'idempotencyKey', 'locale']);
    assert.equal(entry.body.fromPosition, target.fromPosition);
    assert.equal(entry.body.expectedRevision, before.revision);
    assert.equal(entry.body.locale, 'en');
    assert.equal(entry.body.displayedAndRead, true);
    assert.match(entry.body.expectedScopeChecksum, /^[0-9a-f]{64}$/);
    assert.match(entry.body.expectedSourceTextHash, /^[0-9a-f]{64}$/);
    assert.match(entry.body.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(entry.headers.Authorization, 'Bearer synthetic-reader-token');
    assert.equal(entry.transport, 'fetch');
    assert.equal(entry.cache, 'no-store');
    assert.ok(entry.signal);
    assert.equal(fixture.state.endingRead.status, 'saved');
    assert.equal(fixture.reviews().length, 2);
    assert.equal(fixture.calls.filter(entry => entry.path.includes('/current-scene?')).length, 1);
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.posts().length, 1);
    await fixture.api.loadScene({ restorePending: false });
    await fixture.ready();
    assertReceiptOnly(fixture, before);
    assert.equal(fixture.state.endingRead.status, 'saved');
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.posts().length, 1);
  }
});

test('explicit ending read verified receipts and ineligible targets never POST', async () => {
  const saved = endingReader({ positions: [1], position: 1,
    onReview: (preview, entry, fixture) => ({ ...preview, confirmation: fixture.receipt(preview) }) });
  await saved.ready();
  const before = plain(saved.state.progress);
  await saved.api.confirmEndingRead();
  await saved.api.confirmEndingRead();
  assertReceiptOnly(saved, before);
  assert.equal(saved.posts().length, 0);
  assert.equal(saved.state.endingRead.status, 'saved');
  const middle = endingReader({ position: 0 });
  await middle.ready();
  assert.equal(middle.api.endingReadTarget().onFinalPage, false);
  await middle.api.confirmEndingRead();
  assert.equal(middle.reviews().length, 0);
  assert.equal(middle.posts().length, 0);
  for (const change of [
    fixture => { fixture.state.progress.status = 'active'; },
    fixture => { fixture.state.scene.isGenerated = false; },
    fixture => { fixture.state.scene = null; },
    fixture => { fixture.state.scene.id = ''; },
    fixture => { fixture.state.progress.scene = { ...fixture.state.progress.scene, id: id(99) }; },
    fixture => { delete fixture.state.scene.deliveryState; },
    fixture => { fixture.state.scene.deliveryState = 'artwork_pending'; },
    fixture => { fixture.state.scene.endingType = 'author_main'; },
    fixture => { fixture.state.sceneIdentity = 'other-reader'; },
    fixture => fixture.setAuth(null),
    fixture => { fixture.state.choices = [{ id: 'choice-0' }]; },
    fixture => { fixture.state.choices = null; },
    fixture => { fixture.state.progress.revision = 0; },
    fixture => { fixture.state.progress.revision = 3.5; },
    fixture => { fixture.state.progress.currentBeatPosition = -1; },
    fixture => { fixture.state.progress.currentBeatPosition = 0.5; },
    fixture => { fixture.state.scene.beats[0].position = 0; },
    fixture => { fixture.state.scene.beats[0].content.value = ' '; },
    fixture => {
      fixture.state.scene.beats[0].content.value = 'Complete sentence. Hidden unfinished tail';
      assert.equal(fixture.api.readableBeats().beats[0].trimmedTail, true);
    },
  ]) {
    const fixture = endingReader({ positions: [1], position: 0 });
    await fixture.ready();
    change(fixture);
    assert.equal(fixture.api.endingReadTarget(), null);
    const calls = fixture.calls.length;
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.calls.length, calls);
    assert.equal(fixture.posts().length, 0);
  }
  for (const change of [
    state => { state.busy = true; },
    state => { state.aiNotice = { kind: 'checking' }; },
    state => { state.resetPreview = {}; },
  ]) {
    const fixture = endingReader({ positions: [1], position: 0 });
    await fixture.ready();
    change(fixture.state);
    const calls = fixture.calls.length;
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.calls.length, calls);
  }
});

test('explicit ending read serializes duplicate clicks and ignores late context or aborted receipts', async () => {
  for (const change of [
    null,
    fixture => fixture.setAuth({ user: { id: id(99) }, accessToken: 'other-token' }),
    fixture => { fixture.state.locale = 'ko'; },
    fixture => { fixture.state.progress.activeReleaseId = id(99); },
    fixture => { fixture.state.progress.revision = 30; fixture.state.minimumRevision = 30; },
    fixture => { fixture.state.progress.status = 'ai_pending'; },
    fixture => fixture.api.cancelEndingRead(),
  ]) {
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const dispatched = new Promise(resolve => { started = resolve; });
    const fixture = endingReader({ positions: [1], position: 0, onPost: async (entry, context) => {
      const receipt = context.receipt(context.review(entry));
      started();
      await gate;
      return receipt;
    } });
    await fixture.ready();
    const pending = fixture.confirm();
    await dispatched;
    try {
      assert.equal(fixture.state.busy, true);
      await fixture.api.confirmEndingRead();
      assert.equal(fixture.posts().length, 1);
    } finally {
      if (change) change(fixture);
      const before = plain(fixture.state.progress);
      const floor = fixture.state.minimumRevision;
      release();
      await pending;
      assert.deepEqual(plain(fixture.state.progress), before);
      assert.equal(fixture.state.minimumRevision, floor);
    }
    assert.equal(fixture.posts().length, 1);
    assert.equal(fixture.reviews().length, 2);
    assert.equal(fixture.state.busy, false);
    assert.equal(fixture.state.endingReadOperation, null);
    if (change) assert.notEqual(fixture.state.endingRead?.status, 'saved');
    else assert.equal(fixture.state.endingRead.status, 'saved');
  }
});

test('explicit ending read unknown write outcomes reconcile receipts by GET only and auth denial blocks', async () => {
  for (const committed of [false, true]) {
    const fixture = endingReader({ positions: [1], position: 0, onPost: (entry, context) => {
      if (committed) context.commit(entry);
      throw new Error('Unknown write outcome');
    } });
    await fixture.ready();
    const before = plain(fixture.state.progress);
    await fixture.confirm();
    assertReceiptOnly(fixture, before);
    assert.equal(fixture.reviews().length, 3);
    assert.equal(fixture.posts().length, 1);
    assert.equal(fixture.state.endingRead.status, committed ? 'saved' : 'unknown');
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.posts().length, 1);
    assert.equal(fixture.reviews().length, committed ? 3 : 4);
  }
  for (const status of [401, 403]) {
    const fixture = endingReader({ positions: [1], position: 0, onPost: () => { throw { status }; } });
    await fixture.ready();
    const before = plain(fixture.state.progress);
    await fixture.confirm();
    assertReceiptOnly(fixture, before);
    assert.equal(fixture.state.scene, null);
    assert.equal(fixture.state.endingRead, null);
    assert.equal(fixture.reviews().length, 2);
    assert.equal(fixture.posts().length, 1);
    const calls = fixture.calls.length;
    await fixture.api.confirmEndingRead();
    assert.equal(fixture.calls.length, calls);
  }
});

test('explicit ending read rejects malformed review or receipt scope and stale confirmation revisions', async () => {
  for (const [field, value] of Object.entries({
    contract: 'other', receiptId: '', progressRevision: 7.5, progressId: id(99), workId: id(99),
    sceneId: id(99), locale: 'ko', fromPosition: 2, throughPosition: 2,
    scopeChecksum: 'f'.repeat(64), sourceTextHash: 'f'.repeat(64), progressMutated: true,
  })) {
    const fixture = endingReader({ positions: [1], position: 0,
      onPost: (entry, context) => ({ ...context.receipt(context.review(entry)), [field]: value }) });
    await fixture.ready();
    const before = plain(fixture.state.progress);
    await fixture.confirm();
    assertReceiptOnly(fixture, before);
    assert.equal(fixture.state.endingRead.status, 'unknown');
    assert.equal(fixture.state.endingRead.receipt, null);
    assert.equal(fixture.posts().length, 1);
    assert.equal(fixture.reviews().length, 3);
  }
  for (const [field, value] of Object.entries({
    contract: 'other', expectedRevision: 8, progressId: id(99), workId: id(99), sceneId: id(99),
    locale: 'ko', fromPosition: 2, throughPosition: 2, sourceTextHash: 'f'.repeat(64), scopeChecksum: 'invalid',
  })) {
    const fixture = endingReader({ positions: [1], position: 0, onReview: (preview, entry, context) =>
      context.reviews().length === 2 ? { ...preview, [field]: value } : preview });
    await fixture.ready();
    const before = plain(fixture.state.progress);
    await fixture.confirm();
    assertReceiptOnly(fixture, before);
    assert.equal(fixture.state.endingRead.status, 'changed');
    assert.equal(fixture.posts().length, 0);
    assert.equal(fixture.reviews().length, 2);
  }
  const conflict = endingReader({ positions: [1], position: 0, onPost: () => { throw { status: 409 }; } });
  await conflict.ready();
  const before = plain(conflict.state.progress);
  await conflict.confirm();
  assertReceiptOnly(conflict, before);
  assert.equal(conflict.state.endingRead.status, 'changed');
  assert.equal(conflict.posts().length, 1);
  assert.equal(conflict.reviews().length, 2);
  await conflict.api.confirmEndingRead();
  assert.equal(conflict.posts().length, 1);
  assert.equal(conflict.reviews().length, 2);
});

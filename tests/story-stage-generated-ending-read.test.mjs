import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('explicit ending read saves a one-page or final grouped target and reloads without scrolling to start', async () => {
  for (const options of [
    { positions: [1] }, { positions: [1, 2] }, { position: 5 },
  ]) {
    const fixture = reader({ ...options, omitGeneratedSceneId: true });
    const originalPosition = fixture.state.progress.currentBeatPosition;
    const position = fixture.endingReadTarget().position;
    assert.equal(Object.hasOwn(fixture.state.progress, 'currentGeneratedSceneId'), false);
    assert.equal(fixture.requests.length, 0);
    await fixture.loadScene({ restorePending: false });
    assertCompleted(fixture, originalPosition, 3);
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.requests[0].method, 'GET');
    await fixture.confirmEndingRead();
    assertCompleted(fixture, position, 10);
    const entry = fixture.requests[1];
    assert.equal(entry.path, '/api/v1/me/story-progress/progress-id/beat?locale=en');
    assert.equal(entry.auth, true);
    assert.ok(entry.signal);
    assert.deepEqual(entry.body, { position, expectedRevision: 3 });
    assert.equal(fixture.state.beatNotice, 'readSaved');
    assert.deepEqual(fixture.scrollStarts, []);
    assert.deepEqual(fixture.focuses.at(-1), { preventScroll: true });
    await fixture.loadScene({ restorePending: false });
    assertCompleted(fixture, position, 10);
    await fixture.confirmEndingRead();
    assert.deepEqual(fixture.requests.map((request) => request.method), ['GET', 'POST', 'GET']);
    assert.deepEqual(fixture.scrollStarts, []);
  }
});

test('explicit ending read already-saved and ineligible targets never POST', async () => {
  const saved = reader({ positions: [1], position: 1, omitGeneratedSceneId: true });
  await saved.confirmEndingRead();
  await saved.confirmEndingRead();
  assertCompleted(saved, 1, 3);
  assert.deepEqual(saved.requests, []);
  const middle = reader({ omitGeneratedSceneId: true });
  assert.equal(middle.endingReadTarget(), null);
  await middle.confirmEndingRead();
  assert.deepEqual(middle.requests, []);
  for (const change of [
    (fixture) => { fixture.state.progress.status = 'active'; },
    (fixture) => { fixture.state.scene.isGenerated = false; },
    (fixture) => { fixture.state.scene = null; },
    (fixture) => { fixture.state.scene.id = ''; },
    (fixture) => { fixture.state.progress.scene = { ...fixture.state.progress.scene, id: 'other-progress-scene' }; },
    (fixture) => { delete fixture.state.scene.deliveryState; },
    (fixture) => { fixture.state.scene.deliveryState = 'artwork_pending'; },
    (fixture) => { fixture.state.scene.endingType = 'author_main'; },
    (fixture) => { fixture.state.sceneIdentity = 'reader-b'; },
    (fixture) => fixture.setIdentity(''),
    (fixture) => { fixture.state.choices = [{ id: 'choice-0' }]; },
    (fixture) => { fixture.state.choices = null; },
    (fixture) => { fixture.state.progress.revision = 0; },
    (fixture) => { fixture.state.progress.revision = 3.5; },
    (fixture) => { fixture.state.progress.currentBeatPosition = -1; },
    (fixture) => { fixture.state.progress.currentBeatPosition = 0.5; },
    (fixture) => { fixture.state.scene.beats[0].position = 0; },
    (fixture) => { fixture.state.scene.beats[0].content = ' '; },
    (fixture) => {
      fixture.state.scene.beats[0].content = 'Complete sentence. Hidden unfinished tail';
      const target = fixture.readableBeats().beats[0];
      assert.equal(target.text, 'Complete sentence.');
      assert.equal(target.trimmedTail, true);
    },
  ]) {
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true });
    change(fixture);
    assert.equal(fixture.endingReadTarget(), null);
    await fixture.confirmEndingRead();
    assert.deepEqual(fixture.requests, []);
  }
  for (const change of [
    (state) => { state.busy = true; },
    (state) => { state.aiNotice = { kind: 'checking' }; },
    (state) => { state.resetPreview = {}; },
  ]) {
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true });
    change(fixture.state);
    await fixture.confirmEndingRead();
    assert.deepEqual(fixture.requests, []);
  }
});

test('explicit ending read serializes duplicate clicks and ignores late context or aborted responses', async () => {
  for (const change of [
    null,
    (fixture) => fixture.setIdentity('reader-b'),
    (fixture) => { fixture.state.locale = 'ko'; },
    (fixture) => { fixture.state.progress.activeReleaseId = 'other-release'; },
    (fixture) => { fixture.state.progress.revision = 30; fixture.state.minimumRevision = 30; },
    (fixture) => { fixture.state.progress.status = 'ai_pending'; },
    (fixture) => fixture.cancelBeatNavigation(),
  ]) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true, onPost: () => gate });
    const pending = fixture.confirmEndingRead();
    try {
      assert.equal(fixture.state.busy, true);
      await fixture.confirmEndingRead();
      assert.equal(fixture.requests.length, 1);
    } finally {
      const response = fixture.ack(fixture.requests[0]);
      if (change) change(fixture);
      const before = plain(fixture.state.progress);
      const floor = fixture.state.minimumRevision;
      release(response);
      await pending;
      if (change) {
        assert.deepEqual(plain(fixture.state.progress), before);
        assert.equal(fixture.state.minimumRevision, floor);
        assert.notEqual(fixture.state.beatNotice, 'readSaved');
      } else assertCompleted(fixture, 1, 10);
    }
    assert.equal(fixture.requests.length, 1);
    assert.equal(fixture.state.busy, false);
    assert.equal(fixture.state.beatOperation, null);
    assert.deepEqual(fixture.scrollStarts, []);
  }
});

test('explicit ending read unknown write outcomes GET-only refetch and permissions block without replay', async () => {
  for (const committed of [false, true]) {
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true, onPost: (entry, context) => {
      if (committed) context.commit(entry);
      throw new Error('Unknown write outcome');
    } });
    await fixture.confirmEndingRead();
    assertCompleted(fixture, committed ? 1 : 0, committed ? 10 : 3);
    assert.deepEqual(fixture.requests.map((request) => request.method), ['POST', 'GET']);
    assert.equal(fixture.state.beatNotice, 'unconfirmed');
    assert.deepEqual(fixture.scrollStarts, []);
    if (committed) {
      await fixture.confirmEndingRead();
      assert.equal(fixture.requests.length, 2);
    }
  }
  for (const status of [401, 403]) {
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true, onPost: () => { throw { status }; } });
    await fixture.confirmEndingRead();
    assertCompleted(fixture, 0, 3);
    assert.equal(fixture.state.scene, null);
    assert.deepEqual(fixture.blocks, [status === 401 ? 'loginRequired' : 'accessRequired']);
    await fixture.confirmEndingRead();
    assert.equal(fixture.requests.length, 1);
  }
});

test('explicit ending read rejects malformed CAS/status/choice/scope replies without accepting confirmation', async () => {
  for (const invalidate of [
    (value) => { value.revision = 3; },
    (value) => { value.revision = 10.5; },
    (value) => { value.currentBeatPosition = 2; },
    (value) => { value.status = 'active'; },
    (value) => { value.choices = [{ id: 'choice-0' }]; },
    (value) => { value.progressId = 'other-progress'; },
    (value) => { value.scene.id = 'other-scene'; },
    (value) => { value.releaseCapability.revision = 2; },
    (value) => { value.scene.deliveryState = 'artwork_pending'; },
    (value) => { delete value.scene.deliveryState; },
    (value) => { value.scene.endingType = 'author_main'; },
    (value) => { delete value.scene.endingType; },
  ]) {
    const fixture = reader({ positions: [1], omitGeneratedSceneId: true, onPost: (entry, context) => {
      const invalid = context.ack(entry);
      invalidate(invalid);
      return invalid;
    } });
    await fixture.confirmEndingRead();
    assertCompleted(fixture, 0, 3);
    assert.deepEqual(fixture.requests[0].body, { position: 1, expectedRevision: 3 });
    assert.deepEqual(fixture.requests.map((request) => request.method), ['POST', 'GET']);
    assert.equal(fixture.state.beatNotice, 'unconfirmed');
    assert.deepEqual(fixture.scrollStarts, []);
  }
  const conflict = reader({ positions: [1], omitGeneratedSceneId: true, onPost: () => {
    throw { status: 409, body: { error: { code: 'STORY_PROGRESS_STALE_REVISION' } } };
  } });
  await conflict.confirmEndingRead();
  assertCompleted(conflict, 0, 3);
  assert.deepEqual(conflict.requests.map((request) => request.method), ['POST', 'GET']);
  assert.equal(conflict.state.beatNotice, 'progressChanged');
});

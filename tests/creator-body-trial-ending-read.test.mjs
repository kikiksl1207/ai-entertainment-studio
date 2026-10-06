import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../pages/creator-body-trial.js', import.meta.url), 'utf8');
const previewSource = readFileSync(new URL('../pages/creator-body-preview.js', import.meta.url), 'utf8');
const support = readFileSync(new URL('./creator-body-trial.test.mjs', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function section(text, start, end) {
  const first = text.indexOf(start), last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing trial fixture: ${start}`);
  return text.slice(first, last);
}
// Load only synthetic helpers; no existing read/auth/choice suite is registered.
const helpers = [
  section(support, 'const clone =', 'const posts ='),
  section(support, 'const walk =', 'const journalSlot ='),
].join('\n');
const { screen, mounted, walk, approvalState, preview, response, id, past, deferred } = runInNewContext(
  `${helpers}; ({ screen, mounted, walk, approvalState, preview, response, id, past, deferred })`,
  { source, previewSource, assert, createContext, runInContext, TextEncoder, TextDecoder, AbortController },
);
const locales = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const root = `/api/v1/me/creator-studio/stories/${id(1)}`;
const posts = view => view.calls.filter(call => call.options.method === 'POST');
const readButton = view => walk(view.host).find(node => node.id === 'writerBodyTrialRead');
const journalSlot = `lumina:author-body-trial:pending:v1:${encodeURIComponent(id(8))}`;
const pendingCommand = (extra = {}) => ({ version: 1, ownerId: id(8), workId: id(9), choiceId: id(6),
  key: 'external-choice-key-0001', body: { approvalId: id(7), progressId: id(2), expectedRevision: 7, locale: 'ko' }, ...extra });
function journal() {
  return { row: null, writes: 0, removes: 0, read() { return this.row && plain(this.row); },
    write() { this.writes++; throw new Error('Unexpected journal write'); },
    remove() { this.removes++; throw new Error('Unexpected journal removal'); } };
}
function ending(options = {}) {
  const locale = options.locale || 'ko';
  const approved = approvalState();
  const saved = preview(id(1), locale);
  Object.assign(saved.progress, { revision: 7, status: 'completed', currentBeatPosition: 0, choices: [] });
  Object.assign(saved.progress.scene, { isGenerated: true, endingType: 'ai_generated',
    beats: [1, 3].map(position => ({ id: id(10 + position), position, type: 'paragraph', content: `Synthetic ending ${position}.` })) });
  options.change?.({ approved, saved });
  function commit(body) {
    saved.progress.currentBeatPosition = saved.progress.scene.beats.at(-1).position;
    saved.progress.revision = body.expectedRevision + 1;
    return { contract: 'story-author-body-trial-read-v1', workId: id(1), progressId: id(2),
      sourceRevision: body.expectedRevision, revision: saved.progress.revision,
      beatPosition: saved.progress.currentBeatPosition, idempotentReplay: false,
      generationStarted: false, imageGenerationStarted: false, readOnly: false };
  }
  const handler = async call => {
    if (call.options.method === 'GET') {
      if (call.url === `${root}/body-trial-state`) return options.stateGet ? options.stateGet({ approved, saved, call }) : response(approved);
      assert.equal(call.url, `${root}/body-preview?locale=${locale}`);
      return options.previewGet ? options.previewGet({ approved, saved, call }) : response(saved);
    }
    assert.equal(call.url, `${root}/body-trial/read-beats`, 'No additional choice, generation, or public endpoint');
    const body = typeof call.options.body === 'string' ? JSON.parse(call.options.body) : plain(call.options.body);
    return options.post ? options.post({ call, body, commit, approved, saved }) : response(commit(body));
  };
  const view = options.mount ? mounted(handler, { language: locale, sourceLocale: locale, ...options.settings })
    : screen(handler, options.settings);
  if (!options.mount) { view.set.language(locale); view.set.source(locale); }
  return { view, saved, approved };
}
function assertCompleted(view) {
  const state = view.snapshot();
  assert.equal(state.data.preview.progress.status, 'completed');
  assert.deepEqual(plain(state.data.preview.progress.choices), []);
  assert.equal(state.canChoose, false);
}
function assertReadPost(view, locale, mountedBody = false) {
  const writes = posts(view);
  assert.equal(writes.length, 1);
  const { options, url } = writes[0];
  assert.equal(url, `${root}/body-trial/read-beats`);
  const body = mountedBody ? plain(options.body) : JSON.parse(options.body);
  assert.deepEqual(body, { approvalId: id(7), progressId: id(2), expectedRevision: 7, locale });
  assert.equal(Object.keys(body).length, 4);
  assert.match(options.headers['Idempotency-Key'], /^read-[A-Za-z0-9._:-]+$/);
  assert.ok(options.headers['Idempotency-Key'].length <= 120);
  assert.equal(options._retried, true);
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers['Cache-Control'], 'no-store');
  assert.deepEqual(plain(options.identity), { ownerId: id(8), epoch: 1 });
  assert.ok(options.signal);
  if (mountedBody) assert.equal(options.token, 'existing-access-token');
}

for (const locale of locales) {
  test(`${locale}: completed ending explicit read preserves completed and never enables another choice`, async () => {
    const { view, saved } = ending({ locale });
    assert.equal(view.calls.length, 0);
    assert.equal(await view.load(), true);
    assert.equal(posts(view).length, 0);
    assertCompleted(view);
    assert.equal(view.snapshot().canRecordRead, true);
    assert.equal(await view.choose(id(6)), false);
    assert.equal(await view.recordRead(), true);
    assertReadPost(view, locale);
    assertCompleted(view);
    assert.equal(view.snapshot().canRecordRead, false);
    assert.equal(view.snapshot().data.preview.progress.currentBeatPosition, 3);
    assert.equal(view.snapshot().data.preview.progress.revision, 8);
    assert.equal(saved.progress.status, 'completed');
    assert.deepEqual(plain(saved.progress.choices), []);
    assert.deepEqual(plain(view.calls.map(call => call.options.method)), ['GET', 'GET', 'POST', 'GET', 'GET']);
    assert.equal(await view.recordRead(), false);
    assert.equal(await view.choose(id(6)), false);
    assert.equal(posts(view).length, 1);
  });

  test(`${locale}: actual mount shows one manual ending-read button then removes it after GET`, async () => {
    const { view, saved } = ending({ locale, mount: true });
    assert.equal(view.calls.length, 0);
    await view.load();
    const button = readButton(view);
    assert.ok(button);
    assert.equal(button.title, view.api.copy[locale].recordRead);
    assert.equal(button.textContent, view.api.copy[locale].recordRead);
    assert.equal(view.host.lang, locale);
    assert.equal(posts(view).length, 0);
    assert.equal(view.choices().length, 0);
    assert.ok(view.host.textContent.includes(view.api.copy[locale].ending));
    await button.fire('click');
    assertReadPost(view, locale, true);
    assert.equal(readButton(view), undefined);
    assert.equal(view.choices().length, 0);
    assert.equal(saved.progress.status, 'completed');
    assert.equal(saved.progress.currentBeatPosition, 3);
    assert.ok(view.host.textContent.includes(view.api.copy[locale].ending));
    assert.deepEqual(plain(view.calls.map(call => call.options.method)), ['GET', 'GET', 'POST', 'GET', 'GET']);
    assert.deepEqual(plain(view.events), ['lumina:author-body-trial-progress-changed', 'lumina:author-body-trial-progress-changed']);
    assert.equal(view.storage.operations.filter(operation => operation[0] !== 'read').length, 0);
    await button.fire('click');
    assert.equal(posts(view).length, 1, 'An old mounted button cannot record again');
  });
}

const blocked = {
  'author-main ending': ({ saved }) => { saved.progress.scene.endingType = 'author_main'; },
  'author-sub ending': ({ saved }) => { saved.progress.scene.endingType = 'author_sub'; },
  'missing ending type': ({ saved }) => { saved.progress.scene.endingType = null; },
  'unknown ending type': ({ saved }) => { saved.progress.scene.endingType = 'future_ending'; },
  'canonical ending': ({ saved }) => { saved.progress.scene.isGenerated = false; },
  'active ending marker': ({ saved }) => { saved.progress.status = 'active'; },
  'pending generated ending': ({ saved }) => { saved.progress.status = 'ai_pending'; },
  'unknown progress status': ({ saved }) => { saved.progress.status = 'future_status'; },
  'fully read ending': ({ saved }) => { saved.progress.currentBeatPosition = 3; },
  'missing reading position': ({ saved }) => { delete saved.progress.currentBeatPosition; },
  'missing scene': ({ saved }) => { saved.progress.scene = null; },
  'ending with choices': ({ saved }) => { saved.progress.choices = [{ id: id(6), label: 'Invalid ending choice', routeKind: 'generation_required' }]; },
  'locally expired approval': ({ approved }) => { approved.approval.expiresAt = past; },
  'expired approval state': ({ approved }) => { approved.state = 'approval_expired'; approved.approval.expiresAt = past; },
  'changed release': ({ approved }) => { approved.state = 'release_changed'; },
};
for (const [name, change] of Object.entries(blocked)) test(`ending read blocks ${name} without POST`, async () => {
  const { view } = ending({ change });
  await view.load();
  assert.equal(view.snapshot().canRecordRead, false);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(await view.recordRead(), false);
  assert.equal(posts(view).length, 0);
});

test('partial ending remains readable, while the active nonending choice gate stays unchanged', async () => {
  const partial = ending({ change: ({ saved }) => { saved.progress.currentBeatPosition = 1; } }).view;
  await partial.load();
  assert.equal(partial.snapshot().canRecordRead, true);
  assert.equal(partial.snapshot().canChoose, false);
  const { view } = ending({ change: ({ saved }) => {
    saved.progress.status = 'active'; saved.progress.scene.endingType = null;
    saved.progress.choices = [{ id: id(6), label: 'Existing active choice', routeKind: 'generation_required' }];
  } });
  await view.load();
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.snapshot().canRecordRead, true);
  await view.recordRead();
  assert.equal(view.snapshot().data.preview.progress.status, 'active');
  assert.equal(view.snapshot().canChoose, true);
  assert.equal(view.snapshot().canRecordRead, false);
});

test('approval that expires after ending GET is rejected at the explicit read click', async () => {
  let now = Date.parse('2026-10-06T00:00:00.000Z');
  class ClockDate extends Date { static now() { return now; } }
  const { view, approved } = ending({ settings: { vm: { Date: ClockDate } } });
  await view.load();
  assert.equal(view.snapshot().canRecordRead, true);
  now = Date.parse(approved.approval.expiresAt);
  assert.equal(await view.recordRead(), false);
  assert.equal(view.snapshot().canRecordRead, false);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(posts(view).length, 0);
});

for (const when of ['before load', 'at read click']) test(`external journal command ${when} blocks ending read and is preserved`, async () => {
  const storage = journal();
  if (when === 'before load') storage.row = pendingCommand();
  const { view } = ending({ settings: { journal: storage } });
  await view.load();
  if (when === 'at read click') { assert.equal(view.snapshot().canRecordRead, true); storage.row = pendingCommand(); }
  const before = plain(storage.row);
  assert.equal(await view.recordRead(), false);
  assert.equal(view.snapshot().canRecordRead, false);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(posts(view).length, 0);
  assert.deepEqual(storage.row, before);
  assert.equal(storage.writes + storage.removes, 0);
});

test('mounted external command appearing at ending-read click prevents dispatch and journal writes', async () => {
  const { view } = ending({ mount: true });
  await view.load();
  const button = readButton(view);
  const command = pendingCommand();
  view.storage.values.set(journalSlot, JSON.stringify(command));
  await button.fire('click');
  assert.equal(posts(view).length, 0);
  assert.equal(readButton(view), undefined);
  assert.deepEqual(JSON.parse(view.storage.values.get(journalSlot)), command);
  assert.equal(view.storage.operations.filter(operation => operation[0] !== 'read').length, 0);
});

test('ending read respects journal failure, changed identity, stale ticket, and in-flight load', async () => {
  const broken = journal(); broken.read = () => { throw new Error('Synthetic journal unavailable'); };
  const invalid = ending({ settings: { journal: broken } }).view;
  await invalid.load();
  assert.equal(await invalid.recordRead(), false);
  assert.equal(posts(invalid).length, 0);
  const owner = ending().view;
  await owner.load(); owner.set.authorized(false);
  assert.equal(await owner.recordRead(), false);
  assert.equal(owner.snapshot().data, null);
  assert.equal(posts(owner).length, 0);
  const stale = ending().view;
  await stale.load(); const ticket = stale.snapshot().ticket;
  stale.invalidate(); await stale.load();
  assert.equal(await stale.recordRead(ticket), false);
  assert.equal(posts(stale).length, 0);
  const gate = deferred();
  const loading = ending({ previewGet: () => gate.promise });
  const pending = loading.view.load();
  await Promise.resolve();
  assert.equal(await loading.view.recordRead(), false);
  gate.resolve(response(loading.saved)); await pending;
  assert.equal(posts(loading.view).length, 0);
});

for (const status of [401, 403, 409, 500]) test(`completed ending read HTTP ${status} stays blocked until an explicit GET`, async () => {
  const { view, saved } = ending({ post: () => response({}, status) });
  await view.load();
  assert.equal(await view.recordRead(), false);
  assert.equal(view.snapshot().data, null);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(view.snapshot().canRecordRead, false);
  assert.equal(await view.recordRead(), false);
  assert.equal(view.calls.length, 3);
  assert.equal(saved.progress.currentBeatPosition, 0);
  await view.load();
  assertCompleted(view);
  assert.equal(view.snapshot().canRecordRead, true);
  assert.equal(posts(view).length, 1);
});

for (const committed of [false, true]) test(`lost ending read receipt, committed=${committed}: manual GET reconciles without replay`, async () => {
  const { view } = ending({ post: ({ body, commit }) => {
    if (committed) commit(body);
    throw new Error('Synthetic receipt lost');
  } });
  await view.load();
  assert.equal(await view.recordRead(), false);
  assert.equal(view.snapshot().messageKey, 'readUncertain');
  assert.equal(view.snapshot().data, null);
  assert.equal(await view.recordRead(), false);
  assert.equal(view.calls.length, 3);
  await view.load();
  assertCompleted(view);
  assert.equal(view.snapshot().data.preview.progress.currentBeatPosition, committed ? 3 : 0);
  assert.equal(view.snapshot().canRecordRead, !committed);
  assert.equal(posts(view).length, 1);
});

test('wrong ending read receipt and failed post-success GET never enable a choice or accept an optimistic cursor', async () => {
  for (const mode of ['wrong receipt', 'failed GET']) {
    let readRequested = false;
    const { view } = ending({
      post: ({ body, commit }) => { readRequested = true; const receipt = commit(body);
        if (mode === 'wrong receipt') receipt.revision++;
        return response(receipt); },
      previewGet: ({ saved }) => mode === 'failed GET' && readRequested ? response({}, 500) : response(saved),
    });
    await view.load();
    assert.equal(await view.recordRead(), false);
    assert.equal(view.snapshot().data, null);
    assert.equal(view.snapshot().canChoose, false);
    assert.equal(view.snapshot().canRecordRead, false);
    assert.equal(posts(view).length, 1);
  }
});

test('ending read double click stays serialized and late identity change cannot restore ending data', async () => {
  const gate = deferred();
  const { view } = ending({ post: async ({ body, commit }) => { await gate.promise; return response(commit(body)); } });
  await view.load();
  const pending = view.recordRead();
  assert.equal(await view.recordRead(), false);
  assert.equal(posts(view).length, 1);
  view.set.owner({ ownerId: id(9), epoch: 2 });
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(view.snapshot().data, null);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(posts(view).length, 1);
});

test('prefixed ending read key overflow is rejected before any POST', async () => {
  const { view } = ending({ settings: { makeIdempotencyKey: () => 'x'.repeat(120) } });
  await view.load();
  assert.equal(await view.recordRead(), false);
  assert.equal(view.snapshot().canChoose, false);
  assert.equal(posts(view).length, 0);
});
